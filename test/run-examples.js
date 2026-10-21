// 用法：node test/run-examples.js —— 每個內建範例在無畫面的 Runtime 跑 6 秒，回報錯誤
const Rbx = require('../roblox.js');
global.window = {};
require('../examples.js');
const EX = window.EXAMPLES;
let bad = 0;
for (const ex of EX) {
  const logs = [];
  const rt = new Rbx.Runtime({ output: (k, t) => logs.push([k, t]) });
  rt.load(ex.scripts.map((s, i) => ({ id: 'x' + i, name: s.name, type: s.type, parent: s.parent, source: s.source.replace(/^\n/, '') })));
  rt.start();
  for (let i = 0; i < 360; i++) {
    if (i === 60) { rt.keyInput('E', true); rt.keyInput('E', false); rt.keyInput('R', true); rt.keyInput('R', false); rt.keyInput('W', true); }
    if (i === 90) { rt.keyInput('F', true); rt.keyInput('F', false); }
    rt.step(1 / 60);
  }
  const errs = logs.filter(([k]) => k === 'error' || k === 'warn');
  const expectErr = /除錯練習/.test(ex.title);
  const ok = expectErr ? errs.length > 0 : errs.length === 0;
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${ex.title}  (輸出 ${logs.length} 行, 錯誤 ${errs.length}, 零件 ${rt.workspaceParts().length})`);
  for (const [k, t] of logs.slice(0, 12)) console.log(`    [${k}] ${t.split('\n')[0].slice(0, 110)}`);
}
console.log(bad ? `\n${bad} 個範例有問題` : '\n全部範例正常');
process.exit(bad ? 1 : 0);
