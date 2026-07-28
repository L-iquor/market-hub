'use strict';
// 完整模拟 handleMessage 的逻辑链：loadState → fetchAllRecords → parseWithClaude
const { spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const GIT_BASH_EXEC = 'D:/nodes/Git/bin/bash.exe';
const GIT_BASH_ENV  = 'D:\\nodes\\Git\\bin\\bash.exe';
const BASE_TOKEN    = process.env.FEISHU_BASE_TOKEN || '';
const TABLE_ID      = 'tbltqx50D84QXj6X';

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }

// ── lark-cli 调用 ──
function lark(...args) {
  const r = spawnSync('lark-cli', args, { encoding:'utf8', timeout:30000, shell:true });
  if (r.error) throw new Error('spawn: ' + r.error.message);
  const parsed = JSON.parse(r.stdout.trim());
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error || parsed));
  return parsed;
}

// ── fetchAllRecords（分页） ──
function fetchAllRecords() {
  log('fetchAllRecords: 拉取全量...');
  let allRows=[], allIds=[], headers=null, offset=0;
  while (true) {
    const r = lark('base', '+record-list', '--as','bot','--base-token',BASE_TOKEN,'--table-id',TABLE_ID,'--limit','200','--offset',String(offset));
    const d = r.data;
    if (!headers) headers = d.fields;
    allRows = allRows.concat(d.data);
    allIds  = allIds.concat(d.record_id_list);
    if (!d.has_more) break;
    offset += 200;
  }
  const I = name => headers.indexOf(name);
  const I_NAME=I('店名'), I_FOL=I('跟进时间'), I_RPT=I('最新汇报时间'), I_SUM=I('客情汇总'), I_SAL=I('销售情况'), I_STATE=I('合作状态');
  const records = allIds.map((id,i) => {
    const row = allRows[i];
    const st  = Array.isArray(row[I_STATE]) ? row[I_STATE][0] : row[I_STATE];
    return { id, name: String(row[I_NAME]||''), state: st||'',
      summary: String(row[I_SUM]||''), sales: String(row[I_SAL]||'') };
  }).filter(r => r.name && r.state !== '结束合作');
  log(`fetchAllRecords: ${records.length} 条有效店铺`);
  return records;
}

// ── callClaude ──
function callClaude(prompt) {
  const promptFile = path.join(__dirname, '_claude_prompt.txt');
  fs.writeFileSync(promptFile, prompt, 'utf8');
  const promptUnix = promptFile.replace(/\\/g,'/').replace(/^([A-Za-z]):/,(_,d)=>`/${d.toLowerCase()}`);
  const env = { ...process.env, CLAUDE_CODE_GIT_BASH_PATH: GIT_BASH_ENV };
  log('callClaude: 调用中...');
  const r = spawnSync(GIT_BASH_EXEC, ['-c', `claude -p --dangerously-skip-permissions < '${promptUnix}'`],
    { encoding:'utf8', timeout:90000, shell:false, env });
  try { fs.unlinkSync(promptFile); } catch {}
  if (r.error) throw new Error('spawn: ' + r.error.message);
  const out = (r.stdout||'').trim();
  if (!out) throw new Error((r.stderr||'').slice(0,300) || 'claude无输出');
  log(`callClaude: 返回 ${out.length} 字符`);
  return out;
}

// ── parseWithClaude ──
function parseWithClaude(userMsg, stores) {
  const t = new Date(); t.setHours(0,0,0,0);
  const fmt = d => d.toISOString().slice(0,10);
  const nextMon = new Date(t.getTime() + (((8-t.getDay())%7)||7)*86400000);
  const storeList = stores.slice(0,30).map(s => `- ${s.name}（record_id: ${s.id}）`).join('\n');

  const prompt = `今天是 ${fmt(t)}（周${'日一二三四五六'[t.getDay()]}）。
下周一=${fmt(nextMon)}
先放一放=+7天=${fmt(new Date(t.getTime()+7*86400000))}

店铺列表（部分）：
${storeList}

用户说：「${userMsg}」

解析意图，返回JSON数组，每条格式：
{"record_id":"recXXX","store":"店名","action":"update_follow_time"|"update_report_time"|"append_summary"|"clear_follow_date","date":"YYYY-MM-DD","value":"文本","label":"中文说明"}

只返回JSON数组，不加任何其他内容。`;

  const raw = callClaude(prompt);
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) { log('无JSON数组，原始返回: ' + raw.slice(0,200)); return []; }
  try { return JSON.parse(match[0]); }
  catch(e) { log('JSON解析失败: ' + raw.slice(0,200)); return []; }
}

// ── 主测试 ──
(async () => {
  try {
    const testMsg = '1. 回味黑鸭煲：最新跟进时间和最新汇报时间改成上周4月13号\n2. 黔乡妹活油烙锅：跟进时间设为下个周一\n3. 其他几个：跟进时间改为下周二';
    log(`测试消息: ${testMsg.slice(0,60)}...`);

    const stores = fetchAllRecords();
    const parsed = parseWithClaude(testMsg, stores);

    log(`\n=== 解析结果 ===`);
    if (parsed.length === 0) {
      log('❌ 无结果');
    } else {
      parsed.forEach(p => log(`✅ ${p.store} → ${p.action} ${p.date||p.value||''} [${p.label}]`));
    }
  } catch(e) {
    log('❌ 异常: ' + e.message);
  }
})();
