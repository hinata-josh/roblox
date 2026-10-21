// 接水果範例的邏輯測試：①亂數固定 → 水果都掉在頭正上方 → 應該全部接到加分
//                        ②角色不動、水果隨機 → 漏接扣命 → 生命歸零遊戲結束 → 再玩一次
const Rbx = require('../roblox.js');
global.window = {};
require('../examples.js');
const ex = window.EXAMPLES.find(e => /接水果/.test(e.title));
let fail = 0;
const ok = (c, name, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  (' + extra + ')' : '')); if (!c) fail++; };

function make(randFn) {
  const logs = [];
  const rt = new Rbx.Runtime({ output: (k, t) => logs.push(`[${k}] ${t}`) });
  if (randFn) rt.I.rand = randFn;
  rt.load(ex.scripts.map((s, i) => ({ id: 'f' + i, name: s.name, type: s.type, parent: s.parent, source: s.source.replace(/^\n/, '') })));
  rt.start();
  return { rt, logs };
}
const run = (rt, secs) => { for (let i = 0; i < secs * 60; i++) rt.step(1 / 60); };
const stat = (rt, n) => rt.localPlayer.findChild('leaderstats').findChild(n).p.Value;

console.log('▶ 水果都掉在頭上');
{
  const { rt, logs } = make(() => 0.5);
  run(rt, 12);
  const errs = logs.filter(l => /\[error\]|\[warn\]/.test(l));
  ok(errs.length === 0, '沒有錯誤', errs.join(' | '));
  ok(!rt.game.findChild('ServerStorage').findChild('Hello').ran, 'ServerStorage 裡的 Hello 沒有執行');
  ok(rt.workspace.findChild('Basket') && rt.workspace.findChild('Basket').children.length === 6, '頭上有籃子');
  const head = rt.char.findChild('Head').p.CFrame, bottom = rt.workspace.findChild('Basket').children[0].p.CFrame;
  ok(Math.abs(bottom.x - head.x) < 0.01 && bottom.y > head.y, '籃子在頭正上方', `head y ${head.y.toFixed(2)} 籃底 y ${bottom.y.toFixed(2)}`);
  ok(stat(rt, 'Score') >= 8, '接到水果有加分', stat(rt, 'Score'));
  ok(rt.localPlayer.findChild('Lives').p.Value === 5, '全部接到沒扣命', rt.localPlayer.findChild('Lives').p.Value);
  // 走動後籃子跟著頭
  rt.keyInput('D', true); run(rt, 0.5); rt.keyInput('D', false); run(rt, 0.1);
  const h2 = rt.char.findChild('Head').p.CFrame, b2 = rt.workspace.findChild('Basket').children[0].p.CFrame;
  ok(Math.abs(b2.x - h2.x) < 0.01 && Math.abs(b2.z - h2.z) < 0.01 && Math.hypot(h2.x - head.x, h2.z - head.z) > 3, '角色移動籃子跟著走');
}

console.log('▶ 一直漏接 → 遊戲結束 → 再玩一次');
{
  let n = 0;
  const { rt, logs } = make(() => ((n = (n * 9301 + 49297) % 233280) / 233280));
  const pl = rt.localPlayer;
  for (let i = 0; i < 6000 && !(pl.findChild('GameOver') && pl.findChild('GameOver').p.Value); i++) rt.step(1 / 60);
  ok(pl.findChild('GameOver').p.Value === true, '生命用完遊戲結束', 'lives=' + pl.findChild('Lives').p.Value);
  ok(Object.keys(rt.workspace.children.filter(c => c.findChild && c.findChild('BodyVelocity'))).length === 0, '結束後天上的水果清掉');
  const over = pl.findChild('PlayerGui').findChild('FruitGui');
  ok(!!over, 'GUI 建立了');
  const again = over.descendants().find(d => d.ClassName === 'TextButton');
  rt.guiEvent(again, 'MouseButton1Click');
  run(rt, 0.5);
  ok(pl.findChild('GameOver').p.Value === false && pl.findChild('Lives').p.Value === 5 && stat(rt, 'Score') === 0, '按「再玩一次」重新開始');
  ok(logs.filter(l => /\[error\]/.test(l)).length === 0, '沒有錯誤', logs.filter(l => /\[error\]/.test(l)).join(' | '));
}
console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
process.exit(fail ? 1 : 0);
