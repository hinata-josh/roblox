// 用法：node test/run-rbx.js file.lua [秒數]  —— 在 Node 跑 Roblox 執行環境(無畫面)，模擬 N 秒
const Rbx = require('../roblox.js');
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const secs = +(process.argv[3] || 3);
const rt = new Rbx.Runtime({
  output: (k, t) => console.log(k === 'print' ? t : `[${k}] ${t}`),
});
rt.load([{ id: 's1', name: 'Script', type: 'Script', parent: 'ServerScriptService', source: src }]);
rt.start();
for (let i = 0; i < secs * 60; i++) rt.step(1 / 60);
