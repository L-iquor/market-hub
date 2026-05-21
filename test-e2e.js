'use strict';
const { spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const GIT_BASH_EXEC = 'D:/nodes/Git/bin/bash.exe';
const GIT_BASH_ENV  = 'D:\\nodes\\Git\\bin\\bash.exe';
const BASE_TOKEN = 'REDACTED';
const TABLE_ID   = 'tbltqx50D84QXj6X';
const CHAT_ID    = 'REDACTED';

function lark(...args) {
  const r = spawnSync('lark-cli', args, { encoding: 'utf8', timeout: 30000, shell: true });
  if (r.error) throw new Error(r.error.message);
  const p = JSON.parse(r.stdout.trim());
  if (!p.ok) throw new Error(JSON.stringify(p.error || p));
  return p;
}

function sendMsg(text) {
  lark('--as', 'bot', 'im', '+messages-send', '--chat-id', CHAT_ID, '--msg-type', 'text', '--content', JSON.stringify({ text }));
  console.log('✅ 消息已发送到群');
}

function callClaude(prompt) {
  const f = path.join(__dirname, '_claude_prompt.txt');
  fs.writeFileSync(f, prompt, 'utf8');
  const u = f.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
  const env = { ...process.env, CLAUDE_CODE_GIT_BASH_PATH: GIT_BASH_ENV };
  console.log('callClaude 调用中...');
  const r = spawnSync(GIT_BASH_EXEC, ['-c', `claude -p --dangerously-skip-permissions < '${u}'`],
    { encoding: 'utf8', timeout: 90000, shell: false, env });
  try { fs.unlinkSync(f); } catch {}
  if (r.error) throw new Error(r.error.message);
  const out = (r.stdout || '').trim();
  if (!out) throw new Error((r.stderr || '').slice(0, 200) || '无输出');
  console.log(`callClaude 返回 ${out.length} 字符`);
  return out;
}

// ── 拉全量记录 ──
console.log('拉取全量记录...');
let allRows = [], allIds = [], headers = null, offset = 0;
while (true) {
  const r = lark('base', '+record-list', '--as', 'bot', '--base-token', BASE_TOKEN, '--table-id', TABLE_ID, '--limit', '200', '--offset', String(offset));
  const d = r.data;
  if (!headers) headers = d.fields;
  allRows = allRows.concat(d.data);
  allIds  = allIds.concat(d.record_id_list);
  if (!d.has_more) break;
  offset += 200;
}
const IN = name => headers.indexOf(name);
const allRecs = allIds.map((id, i) => {
  const row = allRows[i];
  const st  = Array.isArray(row[IN('合作状态')]) ? row[IN('合作状态')][0] : row[IN('合作状态')];
  return { id, name: String(row[IN('店名')] || ''), state: st || '', summary: String(row[IN('客情汇总')] || '') };
}).filter(r => r.name && r.state !== '结束合作');
console.log(`有效店铺 ${allRecs.length} 条`);

// ── 今日播报店铺（从状态文件读取） ──
const stateFile = path.join(__dirname, 'debt-tracker-state.json');
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const broadcastNames = (state.stores || []).map(s => s.name);
const broadcastStores = allRecs.filter(r => broadcastNames.some(n => r.name.includes(n.replace(/（[^）]*）|\([^)]*\)/g, '').replace(/店$/,''))));
console.log('播报店铺:', broadcastStores.map(s => s.name));

// ── 模拟用户消息 ──
const userMsg = '1. 回味黑鸭煲：最新跟进时间和最新汇报时间改成上周4月13号\n2. 黔乡妹活油烙锅：老板同意把我们的酒上在店里面，跟进时间设为下个周一，最新汇报时间设为4月13日\n3. 其他几个：跟进时间改为下周二';

// ── 构建 prompt（只匹配播报列表） ──
const t = new Date(); t.setHours(0, 0, 0, 0);
const fmt = d => d.toISOString().slice(0, 10);
const nextMon = new Date(t.getTime() + (((8 - t.getDay()) % 7) || 7) * 86400000);
const storeList = broadcastStores.map(s => `- ${s.name}（record_id: ${s.id}）`).join('\n');

const prompt = `今天是${fmt(t)}（周${'日一二三四五六'[t.getDay()]}）。
下周一=${fmt(nextMon)}
先放一放=+7天=${fmt(new Date(t.getTime() + 7 * 86400000))}

【重要】仅在以下播报店铺列表中匹配，不匹配列表以外的店铺：
${storeList}

用户说：「${userMsg}」

解析意图，返回JSON数组，每条格式：
{"record_id":"recXXX","store":"店名","action":"update_follow_time"|"update_report_time","date":"YYYY-MM-DD","label":"中文说明"}

"其他几个"=播报列表中除已明确提及的店铺之外的所有店铺。
只返回JSON数组。`;

const raw = callClaude(prompt);
const match = raw.match(/\[[\s\S]*\]/);
if (!match) { console.log('❌ 无JSON数组，原始返回:', raw.slice(0, 300)); process.exit(1); }
const parsed = JSON.parse(match[0]);

console.log('\n=== 解析结果 ===');
parsed.forEach(p => console.log(` ✅ ${p.store} → ${p.action} ${p.date} [${p.label}]`));

// ── 发到群里让用户确认 ──
const byStore = {};
parsed.forEach(p => { (byStore[p.store] = byStore[p.store] || []).push(p.label); });
const lines = Object.entries(byStore).map(([s, ls]) => `· ${s}：${ls.join('，')}`).join('\n');
sendMsg(`【清债回复解析结果】\n${lines}\n\n回复「确认」写入`);
