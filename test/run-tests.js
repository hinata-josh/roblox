// 用法：node test/run-tests.js —— 直譯器語意測試 + Roblox 執行環境測試
const fs = require('fs');
const path = require('path');
const L = require('../luau.js');
const Rbx = require('../roblox.js');
let pass = 0, fail = 0;
const fmt = (I, v) => v === undefined ? 'nil' : typeof v === 'string' ? JSON.stringify(v) : I.tostr(v);

console.log('▶ 直譯器語意 (semantics.lua)');
{
  const I = new L.Interp({ output: (k, t) => console.log('   [' + k + '] ' + t) });
  I.G.set('check', L.nat('check', (a) => {
    const [name, got, want] = a;
    if (got === want || (got !== got && want !== want)) pass++;
    else { fail++; console.log(`  ✗ ${name}: 得到 ${fmt(I, got)}，應為 ${fmt(I, want)}`); }
  }));
  try { I.runSync(I.compile(fs.readFileSync(path.join(__dirname, 'semantics.lua'), 'utf8'), 'semantics')); }
  catch (e) { fail++; console.log('  ✗ 例外：' + e.message); }
}

console.log('▶ 語法錯誤訊息');
for (const [src, re] of [
  ['if x then\nprint(1)\n', /Expected 'end' \(to close 'if' at line 1\)/],
  ['print("a"', /Expected '\)'/],
  ['local = 5', /Expected identifier/],
  ['x == 5', /Expected '=' \(assignment\)/],
  ['print("abc)', /unfinished string/],
  ['for i = 1 10 do end', /Expected ','/],
  ['local t = {1, 2', /Expected '}'/],
  ['end', /多了一個 end/],
]) {
  try { L.parse(src, 'S'); fail++; console.log('  ✗ 應該要報錯：' + JSON.stringify(src)); }
  catch (e) { if (re.test(e.message)) pass++; else { fail++; console.log(`  ✗ ${JSON.stringify(src)} → ${e.message}`); } }
}

console.log('▶ Roblox 執行環境');
function runRbx(src, secs = 2, extra) {
  const logs = [];
  const rt = new Rbx.Runtime({ output: (k, t) => logs.push(k === 'print' ? t : `[${k}] ${t}`) });
  rt.load([{ id: 's', name: 'Script', type: 'Script', parent: 'ServerScriptService', source: src }, ...(extra || [])]);
  rt.start();
  for (let i = 0; i < secs * 60; i++) rt.step(1 / 60);
  return { logs, rt };
}
function expect(name, src, want, secs, extra) {
  const { logs } = runRbx(src, secs, extra);
  const got = logs.join('\n');
  const ok = want instanceof RegExp ? want.test(got) : got === want;
  if (ok) pass++; else { fail++; console.log(`  ✗ ${name}\n     得到：${JSON.stringify(got).slice(0, 300)}\n     應為：${want}`); }
}
expect('task.wait 回傳經過時間', 'local t = task.wait(0.5) print(t >= 0.5 and t < 0.6)', 'true');
expect('wait 順序', 'task.spawn(function() task.wait(0.2) print("b") end) task.spawn(function() task.wait(0.1) print("a") end)', 'a\nb');
expect('task.spawn 立即執行', 'task.spawn(function() print(1) end) print(2)', '1\n2');
expect('task.defer 延後', 'task.defer(function() print(1) end) print(2)', '2\n1');
expect('task.delay', 'task.delay(0.3, function(x) print("delay", x) end, 7) print("now")', 'now\ndelay 7');
expect('Instance 屬性型別檢查', 'local p = Instance.new("Part") print(pcall(function() p.Anchored = "yes" end))', /false .*boolean expected, got string/);
expect('不存在的成員', 'print(pcall(function() return workspace.Nope end))', /false .*Nope is not a valid member of Workspace "Workspace"/);
expect('Parent 與 FindFirstChild', 'local f = Instance.new("Folder", workspace) f.Name = "F" local p = Instance.new("Part") p.Parent = f print(workspace.F.Part == p, workspace:FindFirstChild("Part", true) == p, p:GetFullName())', 'true true Workspace.F.Part');
expect('Destroy 後 Parent 鎖住', 'local p = Instance.new("Part", workspace) p:Destroy() print(p.Parent, pcall(function() p.Parent = workspace end))', /nil false .*locked/);
expect('Clone', 'local m = Instance.new("Model") local p = Instance.new("Part", m) m.PrimaryPart = p local c = m:Clone() print(#c:GetChildren(), c.PrimaryPart == c.Part, c.PrimaryPart ~= p)', '1 true true');
expect('Changed 事件', 'local v = Instance.new("IntValue") v.Changed:Connect(function(x) print("changed", x) end) v.Value = 5 v.Value = 5 v.Value = 6', 'changed 5\nchanged 6');
expect('GetPropertyChangedSignal', 'local p = Instance.new("Part") p:GetPropertyChangedSignal("Transparency"):Connect(function() print("t", p.Transparency) end) p.Transparency = 0.5', 't 0.5');
expect('Signal:Wait', 'local b = Instance.new("BindableEvent") task.delay(0.2, function() b:Fire("hi", 3) end) print(b.Event:Wait())', 'hi 3');
expect('Disconnect', 'local b = Instance.new("BindableEvent") local c c = b.Event:Connect(function() print("x") c:Disconnect() end) b:Fire() task.wait() b:Fire() task.wait() print(c.Connected)', 'x\nfalse');
expect('Once', 'local b = Instance.new("BindableEvent") b.Event:Once(function(v) print(v) end) b:Fire(1) b:Fire(2)', '1');
expect('WaitForChild 等待', 'task.delay(0.3, function() local f = Instance.new("Folder") f.Name = "Late" f.Parent = workspace end) print(workspace:WaitForChild("Late").Name)', 'Late');
expect('WaitForChild 逾時', 'print(workspace:WaitForChild("Never", 0.2))', 'nil');
expect('Vector3 運算', 'local v = Vector3.new(1, 2, 3) print(v + Vector3.one, v * 2, -v, v.Magnitude == math.sqrt(14), Vector3.new(3,4,0).Unit)', '2, 3, 4 2, 4, 6 -1, -2, -3 true 0.6, 0.8, 0');
expect('CFrame 運算', 'local cf = CFrame.new(1, 2, 3) * CFrame.Angles(0, math.pi, 0) local p = cf * Vector3.new(1, 0, 0) print(math.round(p.X), math.round(p.Y), math.round(p.Z), cf.Position)', '0 2 3 1, 2, 3');
expect('CFrame lookAt', 'local cf = CFrame.lookAt(Vector3.new(0,0,0), Vector3.new(0,0,-10)) print(cf.LookVector)', '0, 0, -1');
expect('CFrame Inverse', 'local cf = CFrame.new(5, 0, 0) * CFrame.Angles(0, 1, 0) local r = cf * cf:Inverse() print(r.Position.Magnitude < 1e-9)', 'true');
expect('Orientation 往返', 'local p = Instance.new("Part") p.Orientation = Vector3.new(10, 45, 0) print(math.round(p.Orientation.X), math.round(p.Orientation.Y))', '10 45');
expect('Color3', 'local c = Color3.fromRGB(255, 128, 0) print(math.round(c.G * 255), c:ToHex(), Color3.fromHSV(0, 1, 1))', '128 FF8000 1, 0, 0');
expect('BrickColor', 'local p = Instance.new("Part") p.BrickColor = BrickColor.new("Bright red") print(p.BrickColor.Name, p.BrickColor == BrickColor.new("Bright red"))', 'Bright red true');
expect('Enum', 'local p = Instance.new("Part") p.Material = "Neon" print(p.Material, p.Material == Enum.Material.Neon, Enum.KeyCode.E.Name)', 'Enum.Material.Neon true E');
expect('UDim2', 'local u = UDim2.new(0.5, 10, 0, 20) + UDim2.fromOffset(5, 5) print(u.X.Scale, u.X.Offset, u.Y.Offset)', '0.5 15 25');
expect('Tween 完成', 'local p = Instance.new("Part", workspace) p.Anchored = true local tw = game:GetService("TweenService"):Create(p, TweenInfo.new(0.5), {Position = Vector3.new(10, 0, 0), Transparency = 1}) tw:Play() tw.Completed:Wait() print(p.Position.X, p.Transparency)', '10 1', 2);
expect('重力與落地', 'local p = Instance.new("Part", workspace) p.Size = Vector3.new(2,2,2) p.Position = Vector3.new(30, 20, 30) task.wait(2) print(math.abs(p.Position.Y - 1) < 0.05)', 'true', 3);
expect('Touched 事件', 'local pad = Instance.new("Part", workspace) pad.Anchored = true pad.Size = Vector3.new(10,1,10) pad.Position = Vector3.new(40, 0.5, 40) local b = Instance.new("Part", workspace) b.Position = Vector3.new(40, 10, 40) pad.Touched:Connect(function(h) print("hit", h == b) end)', /^hit true/, 2);
expect('角色生成', 'game.Players.PlayerAdded:Connect(function(p) p.CharacterAdded:Connect(function(c) print(c.Name, c:FindFirstChild("Humanoid").Health, c.PrimaryPart.Name) end) end)', 'Player1 100 HumanoidRootPart', 1);
expect('Humanoid 死亡', 'game.Players.PlayerAdded:Connect(function(p) local c = p.CharacterAdded:Wait() c.Humanoid.Died:Connect(function() print("died") end) c.Humanoid:TakeDamage(30) print(c.Humanoid.Health) c.Humanoid.Health = 0 end)', '70\ndied', 1);
expect('角色站在重生點', 'local p = game.Players.PlayerAdded:Wait() local c = p.CharacterAdded:Wait() task.wait(1) print(math.round(c.HumanoidRootPart.Position.Y))', '4', 2);
expect('Raycast 過濾', 'local a = Instance.new("Part", workspace) a.Anchored = true a.Position = Vector3.new(50, 5, 50) local prm = RaycastParams.new() prm.FilterDescendantsInstances = {a} prm.FilterType = Enum.RaycastFilterType.Exclude local r1 = workspace:Raycast(Vector3.new(50, 20, 50), Vector3.new(0, -40, 0)) local r2 = workspace:Raycast(Vector3.new(50, 20, 50), Vector3.new(0, -40, 0), prm) print(r1.Instance == a, r2.Instance.Name)', 'true Baseplate');
expect('require ModuleScript', 'local M = require(game.ReplicatedStorage.Mod) print(M.add(2, 3), require(game.ReplicatedStorage.Mod) == M)', '5 true', 1, [{ id: 'm', name: 'Mod', type: 'ModuleScript', parent: 'ReplicatedStorage', source: 'return { add = function(a, b) return a + b end }' }]);
expect('LocalScript 拿到 LocalPlayer', 'print("server")', /server\nPlayer1 true/, 1, [{ id: 'l', name: 'LS', type: 'LocalScript', parent: 'StarterPlayerScripts', source: 'local p = game:GetService("Players").LocalPlayer print(p.Name, script.Parent.Name == "PlayerScripts")' }]);
expect('RemoteEvent', 'local re = Instance.new("RemoteEvent", game.ReplicatedStorage) re.Name = "RE" re.OnServerEvent:Connect(function(plr, x) print("server got", plr.Name, x) end)', /server got Player1 42/, 1, [{ id: 'l', name: 'LS', type: 'LocalScript', parent: 'StarterPlayerScripts', source: 'game.ReplicatedStorage:WaitForChild("RE"):FireServer(42)' }]);
expect('DataStore 存取', 'local ds = game:GetService("DataStoreService"):GetDataStore("Test") ds:SetAsync("k", {coins = 5}) print(ds:GetAsync("k").coins, ds:IncrementAsync("n", 2))', '5 2');
expect('HttpService JSON', 'local H = game:GetService("HttpService") local s = H:JSONEncode({a = 1, list = {1, 2}}) local t = H:JSONDecode(s) print(t.a, #t.list)', '1 2');
expect('CollectionService', 'local CS = game:GetService("CollectionService") local p = Instance.new("Part", workspace) CS:AddTag(p, "Lava") print(#CS:GetTagged("Lava"), CS:HasTag(p, "Lava"))', '1 true');
expect('錯誤附堆疊', 'local function f() local x = nil return x.y end f()', /\[error\] ServerScriptService\.Script:1: attempt to index nil with 'y'[\s\S]*\[stack\] Script 'ServerScriptService\.Script', Line 1 - function f/);
expect('無限迴圈不會卡死(budget 讓出)', 'task.spawn(function() while true do end end) task.wait(0.2) print("still alive")', 'still alive', 1);
expect('Heartbeat dt', 'local n = 0 local c c = game:GetService("RunService").Heartbeat:Connect(function(dt) n += 1 if n == 3 then print(dt > 0) c:Disconnect() end end)', 'true');
expect('Debris', 'local p = Instance.new("Part", workspace) game:GetService("Debris"):AddItem(p, 0.2) task.wait(0.4) print(p.Parent)', 'nil');
expect('script 變數', 'print(script.Name, script.Parent.Name, typeof(script))', 'Script ServerScriptService Instance');
expect('每支腳本各自的全域變數', 'shared.x = 1 globalX = 5 task.wait(0.1) print(globalX)', 'Other nil\n5', 1, [{ id: 'o', name: 'Other', type: 'Script', parent: 'ServerScriptService', source: 'task.wait() print(script.Name, globalX)' }]);
expect('Explosion 擊殺', 'local p = game.Players.PlayerAdded:Wait() local c = p.CharacterAdded:Wait() c.Humanoid.Died:Connect(function() print("boom dead") end) local e = Instance.new("Explosion") e.Position = c.HumanoidRootPart.Position e.Parent = workspace', 'boom dead', 1);

console.log('▶ 除錯器 API');
{
  const rt = new Rbx.Runtime({ output: () => {} });
  let paused = null;
  rt.opts.onPause = (sig) => { paused = sig; };
  rt.load([{ id: 'd', name: 'D', type: 'Script', parent: 'ServerScriptService', source: 'local total = 0\nfor i = 1, 3 do\n\ttotal += i\nend\nprint(total)\n' }]);
  rt.setBreakpoints('d', [3]);
  rt.start();
  const t = (name, c) => { if (c) pass++; else { fail++; console.log('  ✗ ' + name); } };
  t('停在第 3 行', paused && paused.line === 3);
  const vars = rt.I.frameVars(paused.stack[paused.stack.length - 1]);
  t('區域變數 i = 1', vars.locals.some(([k, v]) => k === 'i' && v === 1));
  rt.resume('run'); paused = null; rt.step(1 / 60);
  t('繼續後再停(i = 2)', paused && rt.I.frameVars(paused.stack[paused.stack.length - 1]).locals.some(([k, v]) => k === 'i' && v === 2));
  rt.setBreakpoints('d', []);
  rt.resume('over'); paused = null; rt.step(1 / 60);
  t('step over 到第 2 行(迴圈頭)或第 3 行', paused && (paused.line === 3 || paused.line === 2));
}

console.log(`\n通過 ${pass}，失敗 ${fail}`);
process.exit(fail ? 1 : 0);
