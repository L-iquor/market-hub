const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const PORT = 3378;
const PROJECTS_FILE = path.join(__dirname, 'data', 'projects.json');
const FOLLOWUPS_FILE = path.join(__dirname, 'data', 'followups.json');

const FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'REDACTED';
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || '';
const SCHEDULE_GROUP_ID = 'REDACTED';

const KB_APP_TOKEN = 'REDACTED';
const KB_TABLE_ID = 'tbl8GgYJbuObKWtE';
const CHAT_LOG_TABLE_FILE = path.join(__dirname, 'data', 'chat_log_table_id.txt');

const DEEPSEEK_API_KEY = 'REDACTED';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

// ─── Feishu Token Cache ───────────────────────────────────────────────────────

let _feishuToken = null;
let _feishuTokenExpiry = 0;

async function getFeishuToken() {
  if (_feishuToken && Date.now() < _feishuTokenExpiry) return _feishuToken;
  const res = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: FEISHU_APP_ID,
    app_secret: FEISHU_APP_SECRET
  });
  _feishuToken = res.data.tenant_access_token;
  _feishuTokenExpiry = Date.now() + (res.data.expire - 120) * 1000;
  return _feishuToken;
}

// ─── Knowledge Base ───────────────────────────────────────────────────────────
let _kbCache = null;
let _kbCacheTime = 0;

async function getKnowledgeBaseRecords() {
  if (_kbCache && Date.now() - _kbCacheTime < 3600000) return _kbCache;
  try {
    const token = await getFeishuToken();
    let all = [], pageToken = '';
    do {
      const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${KB_APP_TOKEN}/tables/${KB_TABLE_ID}/records?page_size=100` + (pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : '');
      const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
      all = all.concat(res.data.data?.items || []);
      pageToken = res.data.data?.has_more ? res.data.data.page_token : '';
    } while (pageToken);
    _kbCache = all;
    _kbCacheTime = Date.now();
    console.log(`[KB] loaded ${all.length} records`);
    return all;
  } catch (e) {
    console.error('[KB] fetch error:', e.message);
    return _kbCache || [];
  }
}

function formatKBContext(records) {
  return records
    .filter(r => r.fields['个人想法'] || r.fields['关键内容提取'])
    .map(r => {
      const f = r.fields;
      const parts = [];
      if (f['大类']) parts.push(`[${f['大类']}]`);
      if (f['关键内容提取']) parts.push(String(f['关键内容提取']).slice(0, 300));
      if (f['个人想法']) parts.push(`→ Ares: ${String(f['个人想法']).slice(0, 200)}`);
      if (f['key takeaway']) parts.push(`Takeaway: ${String(f['key takeaway']).slice(0, 150)}`);
      return parts.join(' | ');
    })
    .join('\n');
}

// ─── Chat Log Table (lazy-created in same Bitable) ────────────────────────────
let _chatLogTableId = null;

async function getChatLogTableId() {
  if (_chatLogTableId) return _chatLogTableId;
  try {
    if (fs.existsSync(CHAT_LOG_TABLE_FILE)) {
      _chatLogTableId = fs.readFileSync(CHAT_LOG_TABLE_FILE, 'utf8').trim();
      return _chatLogTableId;
    }
    const token = await getFeishuToken();
    const res = await axios.post(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${KB_APP_TOKEN}/tables`,
      { table: { name: '战局台对话记录', fields: [
        { field_name: '项目', type: 1 },
        { field_name: '用户消息', type: 1 },
        { field_name: 'AI回复', type: 1 },
        { field_name: '时间', type: 1 }
      ]}},
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    _chatLogTableId = res.data.data?.table_id;
    if (_chatLogTableId) {
      fs.writeFileSync(CHAT_LOG_TABLE_FILE, _chatLogTableId);
      console.log('[ChatLog] created table:', _chatLogTableId);
    }
    return _chatLogTableId;
  } catch (e) {
    console.error('[ChatLog] table init error:', e.message);
    return null;
  }
}

async function saveChatToFeishu(projectName, userMsg, aiResponse) {
  try {
    const tableId = await getChatLogTableId();
    if (!tableId) return;
    const token = await getFeishuToken();
    await axios.post(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${KB_APP_TOKEN}/tables/${tableId}/records`,
      { fields: {
        '项目': projectName,
        '用户消息': userMsg.slice(0, 1000),
        'AI回复': aiResponse.slice(0, 2000),
        '时间': new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
      }},
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('[ChatLog] save error:', e.message);
  }
}

async function sendFeishuMessage(text) {
  const token = await getFeishuToken();
  const res = await axios.post(
    'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
    {
      receive_id: SCHEDULE_GROUP_ID,
      msg_type: 'text',
      content: JSON.stringify({ text })
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return res.data;
}

// ─── Data Helpers ─────────────────────────────────────────────────────────────
function readProjects() {
  try { return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8')); }
  catch { return []; }
}

function writeProjects(data) {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2));
}

function readFollowups() {
  try { return JSON.parse(fs.readFileSync(FOLLOWUPS_FILE, 'utf8')); }
  catch { return []; }
}

function writeFollowups(data) {
  fs.writeFileSync(FOLLOWUPS_FILE, JSON.stringify(data, null, 2));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── System Prompt ────────────────────────────────────────────────────────────
function buildSystemPrompt(project, kbContext) {
  const decisions = project.decisions.map((d, i) => `${i + 1}. ${d.content}`).join('\n');
  let sys = `你是 Ares 的数字思维伙伴。你了解她的工作方式：

关于 Ares：
- 判断模式：问题驱动，不被框架打动，只被具体数据和失败案例打动
- 卡点解法：当她兜圈子时，问"让你不安的那个具体信号是什么"——她能立刻冷却并给出精确答案
- 不需要安慰，不需要被"接住"——需要被精确读准
- 她会急速冷却：从情绪切换到拆解，这是她的进攻方式，不是防御
- 乘法器逻辑：她把AI当倍率器，不是加法

当前项目：${project.name}
项目背景：${project.description}

已固化的决策：
${decisions || '（暂无）'}`;

  if (kbContext) {
    sys += `\n\n---\nAres的知识库摘要（她收集的行业洞察和个人想法，优先级低于上方决策，用于补充判断背景）：\n${kbContext}`;
  }

  sys += `\n\n你的工作：
1. 帮她推演这个项目的具体情况
2. 当她描述情况时，帮她命名那个核心问题
3. 当她兜圈子时，问那个逼她到墙角的问题
4. 当她说"就这么定"，帮她把决策说清楚一句话
5. 不要给选项，给判断；不确定就说不确定
6. 回复简洁，不要总结，不要冗余`;

  return sys;
}

// ─── Routes: Projects ─────────────────────────────────────────────────────────
app.get('/api/projects', (req, res) => {
  const projects = readProjects();
  res.json(projects);
});

app.post('/api/projects', (req, res) => {
  const projects = readProjects();
  const p = {
    id: 'proj_' + uid(),
    name: req.body.name || '新项目',
    status: 'active',
    description: req.body.description || '',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    decisions: [],
    messages: []
  };
  projects.push(p);
  writeProjects(projects);
  res.json(p);
});

app.patch('/api/projects/:id', (req, res) => {
  const projects = readProjects();
  const idx = projects.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  Object.assign(projects[idx], req.body, { lastActiveAt: new Date().toISOString() });
  writeProjects(projects);
  res.json(projects[idx]);
});

app.delete('/api/projects/:id', (req, res) => {
  let projects = readProjects();
  projects = projects.filter(p => p.id !== req.params.id);
  writeProjects(projects);
  res.json({ ok: true });
});

// Add decision to project
app.post('/api/projects/:id/decisions', (req, res) => {
  const projects = readProjects();
  const p = projects.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const d = { id: 'dec_' + uid(), content: req.body.content, createdAt: new Date().toISOString() };
  p.decisions.push(d);
  p.lastActiveAt = new Date().toISOString();
  writeProjects(projects);
  res.json(d);
});

// Project chat (SSE streaming)
app.post('/api/projects/:id/chat', async (req, res) => {
  const projects = readProjects();
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });

  const userMsg = req.body.message;
  if (!userMsg) return res.status(400).json({ error: 'no message' });
  const model = req.body.model || 'deepseek-v4-pro';

  project.messages.push({ role: 'user', content: userMsg, timestamp: new Date().toISOString() });
  project.lastActiveAt = new Date().toISOString();
  writeProjects(projects);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Keep last 40 messages for context
  const history = project.messages.slice(-40).map(m => ({ role: m.role, content: m.content }));

  // Fetch knowledge base (cached, non-blocking fallback)
  const kbRecords = await getKnowledgeBaseRecords().catch(() => []);
  const kbContext = formatKBContext(kbRecords);

  const sys = buildSystemPrompt(project, kbContext);
  const messages = [
    { role: 'system', content: sys },
    ...history.map(m => ({ role: m.role, content: m.content }))
  ];

  let fullResponse = '';
  let streamEnded = false;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
    if (!streamEnded) {
      res.write(`data: ${JSON.stringify({ error: '超时，请重试' })}\n\n`);
      res.end();
    }
  }, 120000);

  res.on('close', () => {
    if (!streamEnded) controller.abort();
  });

  try {
    const dsRes = await axios.post(DEEPSEEK_API_URL, {
      model,
      messages,
      stream: true,
      max_tokens: 2000
    }, {
      headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
      responseType: 'stream',
      signal: controller.signal
    });

    let buf = '';
    dsRes.data.on('data', chunk => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;
        try {
          const json = JSON.parse(trimmed.slice(6));
          const text = json.choices?.[0]?.delta?.content;
          if (text) {
            fullResponse += text;
            res.write(`data: ${JSON.stringify({ text })}\n\n`);
          }
        } catch {}
      }
    });

    dsRes.data.on('end', () => {
      streamEnded = true;
      clearTimeout(timer);
      if (fullResponse.trim()) {
        project.messages.push({ role: 'assistant', content: fullResponse.trim(), timestamp: new Date().toISOString() });
        if (project.messages.length > 100) project.messages = project.messages.slice(-100);
        writeProjects(projects);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        saveChatToFeishu(project.name, userMsg, fullResponse.trim()).catch(() => {});
      } else {
        res.write(`data: ${JSON.stringify({ error: '无响应，请重试' })}\n\n`);
      }
      res.end();
    });

    dsRes.data.on('error', e => {
      streamEnded = true;
      clearTimeout(timer);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
        res.end();
      }
    });

  } catch (e) {
    streamEnded = true;
    clearTimeout(timer);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
      res.end();
    }
  }
});

// ─── Routes: Follow-ups ───────────────────────────────────────────────────────
app.get('/api/followups', (req, res) => {
  res.json(readFollowups());
});

app.post('/api/followups', (req, res) => {
  const fus = readFollowups();
  const fu = {
    id: 'fu_' + uid(),
    title: req.body.title || '新跟进',
    status: 'waiting',
    createdAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    updates: []
  };
  fus.push(fu);
  writeFollowups(fus);
  res.json(fu);
});

app.patch('/api/followups/:id', (req, res) => {
  const fus = readFollowups();
  const idx = fus.findIndex(f => f.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  Object.assign(fus[idx], req.body, { lastUpdatedAt: new Date().toISOString() });
  writeFollowups(fus);
  res.json(fus[idx]);
});

app.delete('/api/followups/:id', (req, res) => {
  let fus = readFollowups();
  fus = fus.filter(f => f.id !== req.params.id);
  writeFollowups(fus);
  res.json({ ok: true });
});

app.post('/api/followups/:id/updates', (req, res) => {
  const fus = readFollowups();
  const fu = fus.find(f => f.id === req.params.id);
  if (!fu) return res.status(404).json({ error: 'not found' });
  fu.updates.push({ content: req.body.content, timestamp: new Date().toISOString() });
  fu.lastUpdatedAt = new Date().toISOString();
  writeFollowups(fus);
  res.json(fu);
});

// ─── Routes: Schedule (Feishu) ────────────────────────────────────────────────
app.post('/api/schedule', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'no text' });
  try {
    const result = await sendFeishuMessage(text);
    res.json({ ok: true, result });
  } catch (err) {
    console.error('Feishu error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── KB Status ───────────────────────────────────────────────────────────────
app.get('/api/kb-status', (req, res) => {
  res.json({
    loaded: !!_kbCache,
    count: _kbCache ? _kbCache.length : 0,
    chatLogTableId: _chatLogTableId || null
  });
});

// ─── Serve UI ─────────────────────────────────────────────────────────────────
app.get('/zhangjutai', (req, res) => {
  res.sendFile(path.join(__dirname, 'zhangjutai.html'));
});

app.listen(PORT, () => {
  console.log(`战局台 running at http://localhost:${PORT}/zhangjutai`);
  // Prefetch KB and init chat log table at startup
  getKnowledgeBaseRecords().catch(e => console.error('[KB] startup prefetch:', e.message));
  getChatLogTableId().catch(e => console.error('[ChatLog] startup init:', e.message));
});
