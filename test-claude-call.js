'use strict';
const { spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const GIT_BASH_EXEC = 'D:/nodes/Git/bin/bash.exe';
const GIT_BASH_ENV  = 'D:\\nodes\\Git\\bin\\bash.exe';

const promptFile = path.join(__dirname, '_claude_prompt.txt');
fs.writeFileSync(promptFile, '今天是2026-04-18。用户说「炉夭夭烤鱼 先放一放」，只返回JSON数组: [{"store":"炉夭夭","date":"2026-04-25"}]');

const promptUnix = promptFile.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
const env = { ...process.env, CLAUDE_CODE_GIT_BASH_PATH: GIT_BASH_ENV };

console.log('promptUnix:', promptUnix);
console.log('调用 claude...');

const r = spawnSync(
  GIT_BASH_EXEC,
  ['-c', `claude -p --dangerously-skip-permissions < '${promptUnix}'`],
  { encoding: 'utf8', timeout: 90000, shell: false, env }
);

console.log('stdout:', r.stdout?.slice(0, 300));
console.log('stderr:', r.stderr?.slice(0, 200));
console.log('error:', r.error?.message);
try { fs.unlinkSync(promptFile); } catch {}
