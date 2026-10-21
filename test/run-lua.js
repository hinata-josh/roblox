// 用法：node test/run-lua.js file.lua  —— 在 Node 直接跑一段 Luau(不含 Roblox API)
const L = require('../luau.js');
const I = new L.Interp({ output: (k, t) => console.log(t) });
try { I.runSync(I.compile(require('fs').readFileSync(process.argv[2], 'utf8'), 'Script')); }
catch (e) { console.log('ERROR:', e.message); }
