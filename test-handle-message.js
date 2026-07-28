'use strict';
// 直接 require debt-tracker 内部函数并测试 handleMessage
// 注意：会真实发消息到群，用bot身份

// Patch: 跳过单例检查和定时任务
process.argv.push('--test');

// 临时重写 PID 文件检查
const fs = require('fs');
const pidFile = 'C:/Users/Aris/market-hub/logs/debt-tracker.pid';
try { fs.unlinkSync(pidFile); } catch {}

// 直接 require 并调用内部逻辑
// 因为 debt-tracker.js 不导出函数，我们用子进程注入测试消息到 handleMessage

const { spawnSync } = require('child_process');

// 先向监听中的进程发送一条模拟消息
// 通过读取其 WebSocket 事件流是不可行的，所以改用直接调用方式

// 写一个 inline 测试
const testScript = `
const {spawnSync} = require('child_process');
const fs = require('fs');
const path = require('path');

const GIT_BASH_EXEC = 'D:/nodes/Git/bin/bash.exe';
const GIT_BASH_ENV  = 'D:\\\\nodes\\\\Git\\\\bin\\\\bash.exe';
const LARK_CMD = 'C:\\\\Users\\\\Aris\\\\AppData\\\\Roaming\\\\npm\\\\lark-cli.cmd';
const BASE_TOKEN = process.env.FEISHU_BASE_TOKEN || '';
const TABLE_ID   = 'tbltqx50D84QXj6X';
const CHAT_ID    = process.env.MARKETING_GROUP_ID || '';

function lark(...args) {
  const r = spawnSync('lark-cli', args, {encoding:'utf8',timeout:30000,shell:true});
  if (r.error) throw new Error(r.error.message);
  const p = JSON.parse(r.stdout.trim());
  if (!p.ok) throw new Error(JSON.stringify(p.error||p));
  return p;
}

function sendMsg(text) {
  const r = spawnSync('lark-cli', ['--as','bot','im','+messages-send','--chat-id',CHAT_ID,'--msg-type','text','--content',JSON.stringify({text})],
    {encoding:'utf8',timeout:30000,shell:true});
  const p = JSON.parse(r.stdout?.trim()||'{}');
  console.log('sendMsg:', p.ok ? 'ok' : JSON.stringify(p));
}

function callClaude(prompt) {
  const f = path.join('C:/Users/Aris/market-hub','_claude_prompt.txt');
  fs.writeFileSync(f, prompt);
  const u = f.replace(/\\\\/g,'/').replace(/^([A-Za-z]):/,(_,d)=>\`/\${d.toLowerCase()}\`);
  const env = {...process.env, CLAUDE_CODE_GIT_BASH_PATH: GIT_BASH_ENV};
  const r = spawnSync(GIT_BASH_EXEC,['-c',\`claude -p --dangerously-skip-permissions < '\${u}'\`],
    {encoding:'utf8',timeout:90000,shell:false,env});
  try{fs.unlinkSync(f);}catch{}
  if(r.error) throw new Error(r.error.message);
  const out = (r.stdout||'').trim();
  if(!out) throw new Error((r.stderr||'').slice(0,200)||'无输出');
  return out;
}

// 拉全量
let allRows=[],allIds=[],headers=null,offset=0;
while(true){
  const r=lark('base','+record-list','--as','bot','--base-token',BASE_TOKEN,'--table-id',TABLE_ID,'--limit','200','--offset',String(offset));
  const d=r.data;
  if(!headers)headers=d.fields;
  allRows=allRows.concat(d.data);
  allIds=allIds.concat(d.record_id_list);
  if(!d.has_more)break;
  offset+=200;
}
const IN=name=>headers.indexOf(name);
const allRecs=allIds.map((id,i)=>{
  const row=allRows[i];
  const st=Array.isArray(row[IN('合作状态')])?row[IN('合作状态')][0]:row[IN('合作状态')];
  return{id,name:String(row[IN('店名')]||''),state:st||'',summary:String(row[IN('客情汇总')]||'')};
}).filter(r=>r.name&&r.state!=='结束合作');

console.log('店铺数:',allRecs.length);

// 播报列表（今天的5家）
const broadcastStores = allRecs.filter(r=>['老船舫鲜鱼','炉夭夭烤鱼','回味黑鸭煲','黔乡妹活油烙锅','熊宝烤肉'].some(n=>r.name.includes(n)));
console.log('播报店铺:', broadcastStores.map(s=>s.name));

const userMsg = '1. 回味黑鸭煲：最新跟进时间和最新汇报时间改成上周4月13号\\n2. 黔乡妹活油烙锅：跟进时间设为下个周一\\n3. 其他几个：跟进时间改为下周二';
const t=new Date();t.setHours(0,0,0,0);
const fmt=d=>d.toISOString().slice(0,10);
const nextMon=new Date(t.getTime()+(((8-t.getDay())%7)||7)*86400000);

const storeList=broadcastStores.map(s=>\`- \${s.name}（record_id: \${s.id}）\`).join('\\n');
const prompt=\`今天是\${fmt(t)}（周\${'日一二三四五六'[t.getDay()]}）。下周一=\${fmt(nextMon)}，先放一放=\${fmt(new Date(t.getTime()+7*86400000))}。

这次清债播报的店铺列表（仅在此列表中匹配，不匹配列表外的店铺）：
\${storeList}

用户说：「\${userMsg}」

只针对上述播报列表中的店铺解析意图，返回JSON数组：
[{"record_id":"recXXX","store":"店名","action":"update_follow_time"|"update_report_time","date":"YYYY-MM-DD","label":"说明"}]
只返回JSON数组。\`;

console.log('调用Claude...');
const raw=callClaude(prompt);
console.log('原始返回(前500字):', raw.slice(0,500));
const match=raw.match(/\\[[\\s\\S]*\\]/);
if(!match){console.log('无JSON数组');process.exit(1);}
const parsed=JSON.parse(match[0]);
console.log('解析结果:');
parsed.forEach(p=>console.log(' ',p.store,'→',p.action,p.date,'['+p.label+']'));

// 发确认消息到群
const lines=parsed.map(p=>\`· \${p.store} → \${p.label}\`).join('\\n');
sendMsg(\`【解析结果，请确认】\\n\${lines}\\n\\n回复「确认」写入\`);
`;

console.log('运行测试...');
const r = spawnSync('node', ['-e', testScript], {
  encoding: 'utf8', timeout: 180000, shell: true,
  cwd: 'C:/Users/Aris/market-hub'
});
console.log(r.stdout);
if (r.stderr) console.error('stderr:', r.stderr.slice(0, 500));
if (r.error) console.error('error:', r.error.message);
