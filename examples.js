/* examples.js — 內建範例專案 */
window.EXAMPLES = [
{
  title: '🧺 接水果：頭頂籃子接住天上的水果',
  desc: '控制角色、籃子跟著頭走、隨機水果、計分、生命、炸彈、最高分存檔',
  scripts: [
    { name: 'FruitCatch', type: 'Script', parent: 'ServerScriptService', source: `
-- 🧺 接水果：角色頭上頂著籃子，接住天上掉下來的水果得分！
-- 操作：點一下 3D 畫面，WASD 移動、空白鍵跳。小心 💣 炸彈！
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local DataStoreService = game:GetService("DataStoreService")

local MAX_LIVES = 5
local bestStore = DataStoreService:GetDataStore("FruitBest")

-- 📋 log 開關：想看程式怎麼運作就設 true，看膩了改 false
local SHOW_LOG = true
local SHOW_FRUIT_LOG = true     -- 每顆水果出生 / 接到 / 漏接 都印（比較多）
local function log(...)
	if SHOW_LOG then print(string.format("[%5.2f秒][伺服器 FruitCatch]", time()), ...) end
end
local function fruitLog(...)
	if SHOW_LOG and SHOW_FRUIT_LOG then print(string.format("[%5.2f秒][伺服器 FruitCatch]", time()), ...) end
end
log("① 腳本開始執行（這時候玩家還沒進來）")

-- 水果種類：weight 越大越常出現
local FRUITS = {
	{ name = "Apple",      emoji = "🍎", color = Color3.fromRGB(220, 40, 40),  size = 1.6, points = 1, weight = 30 },
	{ name = "Orange",     emoji = "🍊", color = Color3.fromRGB(255, 150, 30), size = 1.6, points = 1, weight = 25 },
	{ name = "Banana",     emoji = "🍌", color = Color3.fromRGB(250, 220, 60), size = 1.5, points = 2, weight = 15 },
	{ name = "Grape",      emoji = "🍇", color = Color3.fromRGB(130, 60, 170), size = 1.4, points = 3, weight = 12 },
	{ name = "Watermelon", emoji = "🍉", color = Color3.fromRGB(60, 170, 70),  size = 2.4, points = 5, weight = 6 },
	{ name = "Bomb",       emoji = "💣", color = Color3.fromRGB(30, 30, 30),   size = 1.8, points = 0, weight = 12, bad = true },
}
local totalWeight = 0
for _, f in ipairs(FRUITS) do totalWeight += f.weight end

local function randomFruit()
	local r = math.random() * totalWeight
	for _, f in ipairs(FRUITS) do
		r -= f.weight
		if r <= 0 then return f end
	end
	return FRUITS[1]
end

-- 遊戲重來用的 RemoteEvent（GUI 的「再玩一次」按鈕會呼叫）
local restartEvent = Instance.new("RemoteEvent")
restartEvent.Name = "RestartFruit"
restartEvent.Parent = ReplicatedStorage
log("② 建立 RemoteEvent：ReplicatedStorage.RestartFruit（給 GUI 的「再玩一次」用）")

local state = {}    -- 每個玩家的狀態
local fruits = {}   -- 天上正在掉的水果 { [part] = 資料 }

---------------------------------------------------------------- 籃子
local BASKET_HALF = 2.2      -- 籃子內寬的一半
local BASKET_BOTTOM = 0.65   -- 籃底在頭頂上方多高
local BASKET_RIM = 2.3       -- 籃口高度

local function makeBasket()
	local basket = Instance.new("Model")
	basket.Name = "Basket"
	local pieces = {}
	local function piece(size, offset, color)
		local p = Instance.new("Part")
		p.Size = size
		p.Color = color or Color3.fromRGB(160, 110, 60)
		p.Material = Enum.Material.WoodPlanks
		p.Anchored = true
		p.CanCollide = false
		p.Parent = basket
		table.insert(pieces, { part = p, offset = offset })
	end
	piece(Vector3.new(4.6, 0.3, 4.6), CFrame.new(0, BASKET_BOTTOM, 0))                -- 底
	piece(Vector3.new(4.6, 1.6, 0.3), CFrame.new(0, 1.5, 2.15))                         -- 前
	piece(Vector3.new(4.6, 1.6, 0.3), CFrame.new(0, 1.5, -2.15))                        -- 後
	piece(Vector3.new(0.3, 1.6, 4.6), CFrame.new(2.15, 1.5, 0))                         -- 左
	piece(Vector3.new(0.3, 1.6, 4.6), CFrame.new(-2.15, 1.5, 0))                        -- 右
	piece(Vector3.new(5, 0.25, 5), CFrame.new(0, BASKET_RIM, 0) * CFrame.new(0, 0, 0), Color3.fromRGB(200, 150, 90))
	pieces[#pieces].part.Transparency = 0.85                                           -- 籃口只畫淡淡一圈
	basket.Parent = workspace
	log("   🧺 籃子做好了：" .. #pieces .. " 塊木板，放進 Workspace")
	return basket, pieces
end

---------------------------------------------------------------- 計分小動畫
local function popup(part, text, color)
	local gui = Instance.new("BillboardGui")
	gui.Size = UDim2.new(0, 120, 0, 40)
	gui.StudsOffset = Vector3.new(0, 3, 0)
	gui.AlwaysOnTop = true
	local label = Instance.new("TextLabel")
	label.Size = UDim2.new(1, 0, 1, 0)
	label.BackgroundTransparency = 1
	label.Text = text
	label.TextScaled = true
	label.Font = Enum.Font.GothamBold
	label.TextColor3 = color
	label.TextStrokeTransparency = 0.3
	label.Parent = gui
	gui.Parent = part
	task.spawn(function()
		for i = 1, 20 do
			gui.StudsOffset = Vector3.new(0, 3 + i * 0.12, 0)
			label.TextTransparency = i / 20
			task.wait(0.03)
		end
		gui:Destroy()
	end)
end

---------------------------------------------------------------- 玩家
local function clearFruits()
	for fruit in pairs(fruits) do fruit:Destroy() end
	fruits = {}
end

local function startGame(player)
	local st = state[player]
	if not st then return end
	clearFruits()
	st.score.Value = 0
	st.lives.Value = MAX_LIVES
	st.gameOver.Value = false
	st.playing = true
	log("▶ 遊戲開始！", player.Name, "分數歸零、生命 =", st.lives.Value)
end

local function endGame(player)
	local st = state[player]
	st.playing = false
	st.gameOver.Value = true
	log("■ 遊戲結束！", player.Name, "最後得分 =", st.score.Value, "最高分 =", st.best.Value)
	clearFruits()
	if st.score.Value > st.best.Value then
		st.best.Value = st.score.Value
		bestStore:SetAsync(tostring(player.UserId), st.best.Value)
		print("🏆 新紀錄！", st.best.Value)
	end
end

log("③ 掛好 PlayerAdded 事件，等玩家進來…")
Players.PlayerAdded:Connect(function(player)
	log("④ PlayerAdded：玩家", player.Name, "進來了，建立 leaderstats / Lives / GameOver")
	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"
	leaderstats.Parent = player
	local score = Instance.new("IntValue")
	score.Name = "Score"
	score.Parent = leaderstats
	local best = Instance.new("IntValue")
	best.Name = "Best"
	best.Value = bestStore:GetAsync(tostring(player.UserId)) or 0
	log("   從 DataStore 讀到最高分 =", best.Value)
	best.Parent = leaderstats
	local lives = Instance.new("IntValue")
	lives.Name = "Lives"
	lives.Value = MAX_LIVES
	lives.Parent = player
	local gameOver = Instance.new("BoolValue")
	gameOver.Name = "GameOver"
	gameOver.Parent = player

	state[player] = { score = score, best = best, lives = lives, gameOver = gameOver, playing = false }

	player.CharacterAdded:Connect(function(character)
		log("⑤ CharacterAdded：角色", character.Name, "生出來了，幫他戴上籃子")
		local st = state[player]
		if st.basket then st.basket:Destroy() end
		st.basket, st.pieces = makeBasket()
		st.head = character:WaitForChild("Head")
		character:WaitForChild("Humanoid").WalkSpeed = 22   -- 跑快一點比較好接
		if not st.playing and not st.gameOver.Value then startGame(player) end
	end)
end)

restartEvent.OnServerEvent:Connect(function(player)
	log("🔄 收到 GUI 送來的 RestartFruit（玩家按了「再玩一次」）")
	startGame(player)
end)

---------------------------------------------------------------- 掉水果
local function spawnFruit(player)
	local st = state[player]
	if not st.head or not st.head.Parent then return end
	local f = randomFruit()
	local speed = math.min(16 + st.score.Value * 0.35, 42)   -- 分數越高掉越快
	local center = st.head.Position
	local fruit = Instance.new("Part")
	fruit.Name = f.name
	fruit.Shape = Enum.PartType.Ball
	fruit.Size = Vector3.new(f.size, f.size, f.size)
	fruit.Color = f.color
	fruit.Material = f.bad and Enum.Material.Metal or Enum.Material.SmoothPlastic
	fruit.CanCollide = false
	fruit.Position = Vector3.new(center.X + math.random(-16, 16), center.Y + 45, center.Z + math.random(-16, 16))
	-- 用 BodyVelocity 讓水果等速往下掉（不然重力太快很難接）
	local bv = Instance.new("BodyVelocity")
	bv.Velocity = Vector3.new(0, -speed, 0)
	bv.Parent = fruit
	-- 水果上面放一個表情符號，比較好認
	local gui = Instance.new("BillboardGui")
	gui.Size = UDim2.new(f.size * 1.4, 0, f.size * 1.4, 0)
	gui.AlwaysOnTop = true
	local icon = Instance.new("TextLabel")
	icon.Size = UDim2.new(1, 0, 1, 0)
	icon.BackgroundTransparency = 1
	icon.Text = f.emoji
	icon.TextScaled = true
	icon.Parent = gui
	gui.Parent = fruit
	fruit.Parent = workspace
	fruits[fruit] = { info = f, lastY = fruit.Position.Y }
	fruitLog(string.format("   %s 出生在 (%.0f, %.0f, %.0f)，往下掉速度 %.1f", f.emoji, fruit.Position.X, fruit.Position.Y, fruit.Position.Z, speed))
end

-- 每隔一段時間掉一顆，分數越高掉越密
log("   開始「掉水果」的迴圈（用 task.spawn 另開一條執行緒，才不會卡住下面的程式）")
task.spawn(function()
	while true do
		local interval = 1
		for player, st in pairs(state) do
			if st.playing then
				spawnFruit(player)
				interval = math.max(0.35, 1 - st.score.Value * 0.012)
			end
		end
		task.wait(interval)
	end
end)

---------------------------------------------------------------- 每格：籃子跟著頭、檢查接到沒
local firstBeat = true
log("   掛好 Heartbeat（每一格畫面都會跑一次：讓籃子跟著頭、檢查有沒有接到）")
RunService.Heartbeat:Connect(function(dt)
	if firstBeat then
		firstBeat = false
		log("   第一次 Heartbeat，這一格經過", string.format("%.3f", dt), "秒（之後每格都會跑，但不再印，免得洗版）")
	end
	for player, st in pairs(state) do
		-- 籃子黏在頭頂
		if st.head and st.head.Parent and st.pieces then
			local headCF = st.head.CFrame * CFrame.new(0, 0.5, 0)
			for _, p in ipairs(st.pieces) do
				p.part.CFrame = headCF * p.offset
			end
			st.bottomY = headCF.Y + BASKET_BOTTOM
			st.rimY = headCF.Y + BASKET_RIM
			st.center = headCF.Position
		end
	end

	for fruit, data in pairs(fruits) do
		if not fruit.Parent then
			fruits[fruit] = nil
			continue
		end
		local pos = fruit.Position
		local caughtBy = nil
		for player, st in pairs(state) do
			if st.playing and st.center then
				local inside = math.abs(pos.X - st.center.X) < BASKET_HALF and math.abs(pos.Z - st.center.Z) < BASKET_HALF
				-- 這一格和上一格之間有穿過籃子的高度範圍 → 接到了（掉很快也不會漏接）
				if inside and pos.Y <= st.rimY and data.lastY >= st.bottomY then
					caughtBy = player
				end
			end
		end
		data.lastY = pos.Y

		if caughtBy then
			local st = state[caughtBy]
			local f = data.info
			fruits[fruit] = nil
			fruit:Destroy()
			if f.bad then
				fruitLog("   💥 接到炸彈！生命", st.lives.Value, "→", st.lives.Value - 1)
				st.lives.Value -= 1
				popup(st.pieces[1].part, "💥 -1 ❤", Color3.fromRGB(255, 80, 80))
				local boom = Instance.new("Explosion")
				boom.Position = st.center + Vector3.new(0, 2, 0)
				boom.BlastPressure = 0
				boom.DestroyJointRadiusPercent = 0
				boom.Parent = workspace
				if st.lives.Value <= 0 then endGame(caughtBy) end
			else
				st.score.Value += f.points
				fruitLog("   ✅ 接到", f.emoji, "+" .. f.points, "分，現在", st.score.Value, "分")
				popup(st.pieces[1].part, "+" .. f.points .. " " .. f.emoji, Color3.fromRGB(255, 230, 80))
			end
		elseif pos.Y < 2.5 then
			-- 掉到地上：好水果沒接到要扣命，炸彈掉地上沒事
			fruits[fruit] = nil
			fruit:Destroy()
			if data.info.bad then fruitLog("   💣 炸彈掉到地上，沒事") end
			if not data.info.bad then
				for player, st in pairs(state) do
					if st.playing then
						fruitLog("   ❌ 漏接", data.info.emoji, "掉到地上，生命", st.lives.Value, "→", st.lives.Value - 1)
						st.lives.Value -= 1
						if st.lives.Value <= 0 then endGame(player) end
					end
				end
			end
		end
	end
end)
` },
    { name: 'FruitGui', type: 'LocalScript', parent: 'StarterPlayerScripts', source: `
-- 畫面上的分數、生命、遊戲結束視窗
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local player = Players.LocalPlayer

local SHOW_LOG = true
local function log(...)
	if SHOW_LOG then print(string.format("[%5.2f秒][畫面 FruitGui]", time()), ...) end
end
log("Ⓐ LocalScript 開始執行（玩家進來後才會跑），LocalPlayer =", player.Name)

local gui = Instance.new("ScreenGui")
gui.Name = "FruitGui"
gui.ResetOnSpawn = false
gui.Parent = player:WaitForChild("PlayerGui")

-- 左上角：分數和愛心
local panel = Instance.new("Frame")
panel.Position = UDim2.new(0, 12, 0, 12)
panel.Size = UDim2.new(0, 230, 0, 86)
panel.BackgroundColor3 = Color3.fromRGB(25, 25, 35)
panel.BackgroundTransparency = 0.25
panel.Parent = gui
Instance.new("UICorner", panel).CornerRadius = UDim.new(0, 12)

local scoreLabel = Instance.new("TextLabel")
scoreLabel.Size = UDim2.new(1, -16, 0, 44)
scoreLabel.Position = UDim2.new(0, 8, 0, 4)
scoreLabel.BackgroundTransparency = 1
scoreLabel.Font = Enum.Font.GothamBold
scoreLabel.TextScaled = true
scoreLabel.TextXAlignment = Enum.TextXAlignment.Left
scoreLabel.TextColor3 = Color3.fromRGB(255, 230, 90)
scoreLabel.Text = "🧺 0"
scoreLabel.Parent = panel

local heartLabel = Instance.new("TextLabel")
heartLabel.Size = UDim2.new(1, -16, 0, 30)
heartLabel.Position = UDim2.new(0, 8, 0, 50)
heartLabel.BackgroundTransparency = 1
heartLabel.TextScaled = true
heartLabel.TextXAlignment = Enum.TextXAlignment.Left
heartLabel.Text = ""
heartLabel.Parent = panel

-- 中間：遊戲結束
local over = Instance.new("Frame")
over.AnchorPoint = Vector2.new(0.5, 0.5)
over.Position = UDim2.new(0.5, 0, 0.5, 0)
over.Size = UDim2.new(0, 300, 0, 190)
over.BackgroundColor3 = Color3.fromRGB(30, 30, 45)
over.BackgroundTransparency = 0.1
over.Visible = false
over.Parent = gui
Instance.new("UICorner", over).CornerRadius = UDim.new(0, 16)

local overText = Instance.new("TextLabel")
overText.Size = UDim2.new(1, -20, 0, 100)
overText.Position = UDim2.new(0, 10, 0, 10)
overText.BackgroundTransparency = 1
overText.TextColor3 = Color3.new(1, 1, 1)
overText.Font = Enum.Font.GothamBold
overText.TextScaled = true
overText.TextWrapped = true
overText.Parent = over

local again = Instance.new("TextButton")
again.Size = UDim2.new(0, 200, 0, 50)
again.Position = UDim2.new(0.5, -100, 1, -66)
again.BackgroundColor3 = Color3.fromRGB(60, 190, 90)
again.TextColor3 = Color3.new(1, 1, 1)
again.Font = Enum.Font.GothamBold
again.TextSize = 22
again.Text = "🔄 再玩一次"
again.Parent = over
Instance.new("UICorner", again).CornerRadius = UDim.new(0, 10)

-- 開場提示
local hint = Instance.new("TextLabel")
hint.AnchorPoint = Vector2.new(0.5, 0)
hint.Position = UDim2.new(0.5, 0, 0, 110)
hint.Size = UDim2.new(0, 420, 0, 40)
hint.BackgroundColor3 = Color3.fromRGB(0, 0, 0)
hint.BackgroundTransparency = 0.4
hint.TextColor3 = Color3.new(1, 1, 1)
hint.TextScaled = true
hint.Text = "點一下畫面，用 WASD 移動接水果！小心 💣"
hint.Parent = gui
Instance.new("UICorner", hint)
task.delay(5, function() hint.Visible = false end)
log("Ⓑ 畫面元件都建好了（分數框、愛心、遊戲結束視窗、提示）")

-- 數值變了就更新畫面
log("Ⓒ 用 WaitForChild 等伺服器建立 leaderstats…")
local leaderstats = player:WaitForChild("leaderstats")
local score = leaderstats:WaitForChild("Score")
local best = leaderstats:WaitForChild("Best")
local lives = player:WaitForChild("Lives")
local gameOver = player:WaitForChild("GameOver")
log("Ⓓ 等到了！Score / Best / Lives / GameOver 都拿到，開始監聽 .Changed")

local function refresh()
	scoreLabel.Text = "🧺 " .. score.Value
	heartLabel.Text = string.rep("❤️", lives.Value) .. string.rep("🤍", math.max(0, 5 - lives.Value))
	over.Visible = gameOver.Value
	if gameOver.Value then
		overText.Text = "遊戲結束！\\n得分 " .. score.Value .. "\\n最高 " .. best.Value
	end
end
score.Changed:Connect(refresh)
best.Changed:Connect(refresh)
lives.Changed:Connect(function(v) log("Lives.Changed → 畫面愛心更新為", v) refresh() end)
gameOver.Changed:Connect(function(v) log("GameOver.Changed →", v and "顯示「遊戲結束」視窗" or "隱藏「遊戲結束」視窗") refresh() end)
refresh()

again.MouseButton1Click:Connect(function()
	log("按了「再玩一次」→ 用 RemoteEvent:FireServer() 通知伺服器")
	ReplicatedStorage:WaitForChild("RestartFruit"):FireServer()
end)
log("Ⓔ GUI 準備完成，接下來就是等事件發生")
` },
    { name: 'Hello', type: 'Script', parent: 'ServerStorage', source: `
-- 這支 Hello 放在 ServerStorage，所以按執行時「不會」跑。
-- 想再跑它：在檔案總管點 Hello，屬性面板把 Parent 改回 ServerScriptService。
print("Hello, Luau!")
` },
  ],
},
{
  title: '👋 第一支程式：Hello Luau',
  desc: 'print、變數、迴圈、函式、表格 — 適合先試中斷點',
  scripts: [{ name: 'Hello', type: 'Script', parent: 'ServerScriptService', source: `
-- 👋 歡迎！按 F5（或上面的 ▶ 執行）跑這支程式，結果會出現在下面的「輸出」視窗
print("Hello, Luau!")

-- 變數：用 local 宣告
local name = "小明"
local age = 10
print(name .. " 今年 " .. age .. " 歲")
print(\`明年就 {age + 1} 歲了\`)          -- 反引號字串可以直接把運算放進 { }

-- 迴圈：從 1 數到 5
for i = 1, 5 do
	print("第", i, "次")
end

-- 函式：可以重複使用的一段程式
local function square(n)
	local result = n * n   -- 🔴 試試在這行的行號左邊點一下設「中斷點」，再按 F5
	return result
end

local total = 0
for i = 1, 4 do
	total += square(i)     -- += 是「加上去」
end
print("1² + 2² + 3² + 4² =", total)

-- 表格(table)：一次裝很多東西
local fruits = {"蘋果", "香蕉", "葡萄"}
table.insert(fruits, "西瓜")
for index, fruit in ipairs(fruits) do
	print(index, fruit)
end

local pet = { name = "Lucky", kind = "狗", legs = 4 }
print(pet.name .. " 是一隻有 " .. pet.legs .. " 條腿的" .. pet.kind)
print(pet)   -- 直接印表格會展開內容

-- 💡 除錯小技巧：
-- 1. 在第 20 行設中斷點後按 F5，程式會停在那裡
-- 2. 看「變數 / 監看」分頁：n 和 result 現在是多少？
-- 3. 按 F10 一行一行往下走，或 F5 繼續跑到下一次停下
` }],
},
{
  title: '🌈 彩虹階梯',
  desc: '用迴圈和 Instance.new 蓋出一座彩色樓梯',
  scripts: [{ name: 'RainbowStairs', type: 'Script', parent: 'ServerScriptService', source: `
-- 🌈 用程式蓋一座彩虹樓梯，蓋好後用 WASD 走上去、空白鍵跳！
local STEPS = 30

local folder = Instance.new("Folder")
folder.Name = "Stairs"
folder.Parent = workspace

for i = 1, STEPS do
	local step = Instance.new("Part")
	step.Name = "Step" .. i
	step.Size = Vector3.new(6, 1, 4)
	step.Anchored = true   -- 不加這行的話，方塊會掉下去喔
	-- 一圈一圈往上繞
	local angle = math.rad(i * 18)
	local radius = 14
	step.Position = Vector3.new(math.cos(angle) * radius, i * 1.2, math.sin(angle) * radius)
	step.Orientation = Vector3.new(0, -i * 18, 0)
	-- 顏色：HSV 的 H 從 0 走到 1 就是一道彩虹
	step.Color = Color3.fromHSV(i / STEPS, 0.8, 1)
	step.Material = Enum.Material.SmoothPlastic
	step.Parent = folder
	task.wait(0.05)        -- 慢慢蓋，看得到過程
end

-- 頂端放一顆會發光的球
local top = Instance.new("Part")
top.Shape = Enum.PartType.Ball
top.Size = Vector3.new(4, 4, 4)
top.Position = Vector3.new(0, STEPS * 1.2 + 4, 0)
top.Anchored = true
top.Material = Enum.Material.Neon
top.Color = Color3.fromRGB(255, 220, 80)
top.Parent = workspace
print("樓梯蓋好了，共", #folder:GetChildren(), "階")
` }],
},
{
  title: '🔥 熔岩陷阱 + 金幣排行榜',
  desc: 'Touched、leaderstats、Humanoid、旋轉金幣、debounce',
  scripts: [
    { name: 'Leaderstats', type: 'Script', parent: 'ServerScriptService', source: `
-- 玩家加入時建立 leaderstats（右上角的排行榜）
local Players = game:GetService("Players")

Players.PlayerAdded:Connect(function(player)
	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"     -- 名字一定要是 leaderstats
	leaderstats.Parent = player

	local coins = Instance.new("IntValue")
	coins.Name = "Coins"
	coins.Value = 0
	coins.Parent = leaderstats

	local deaths = Instance.new("IntValue")
	deaths.Name = "Deaths"
	deaths.Parent = leaderstats

	player.CharacterAdded:Connect(function(character)
		local humanoid = character:WaitForChild("Humanoid")
		humanoid.Died:Connect(function()
			deaths.Value += 1
			print(player.Name .. " 掉進熔岩了！")
		end)
	end)
end)
` },
    { name: 'Coins', type: 'Script', parent: 'ServerScriptService', source: `
-- 在場地上撒金幣，碰到就加分
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local coins = {}

local function makeCoin(position)
	local coin = Instance.new("Part")
	coin.Name = "Coin"
	coin.Shape = Enum.PartType.Cylinder
	coin.Size = Vector3.new(0.4, 2.5, 2.5)
	coin.Color = Color3.fromRGB(255, 200, 40)
	coin.Material = Enum.Material.Neon
	coin.Anchored = true
	coin.CanCollide = false
	coin.Position = position
	coin.Parent = workspace

	local taken = false   -- debounce：避免同一枚金幣被算很多次
	coin.Touched:Connect(function(hit)
		if taken then return end
		local character = hit.Parent
		local player = Players:GetPlayerFromCharacter(character)
		if player then
			taken = true
			player.leaderstats.Coins.Value += 1
			coin:Destroy()
		end
	end)
	table.insert(coins, coin)
end

for i = 1, 12 do
	local angle = i / 12 * math.pi * 2
	makeCoin(Vector3.new(math.cos(angle) * 20, 2, math.sin(angle) * 20))
end

-- 讓金幣轉圈圈
RunService.Heartbeat:Connect(function(dt)
	for _, coin in ipairs(coins) do
		if coin.Parent then
			coin.CFrame = coin.CFrame * CFrame.Angles(0, dt * 3, 0)
		end
	end
end)
` },
    { name: 'Lava', type: 'Script', parent: 'ServerScriptService', source: `
-- 熔岩：碰到就 Health = 0
local lava = Instance.new("Part")
lava.Name = "Lava"
lava.Size = Vector3.new(10, 1, 10)
lava.Position = Vector3.new(0, 0.6, -12)
lava.Anchored = true
lava.Material = Enum.Material.Neon
lava.Color = Color3.fromRGB(255, 80, 20)
lava.Parent = workspace

lava.Touched:Connect(function(hit)
	local humanoid = hit.Parent:FindFirstChild("Humanoid")
	if humanoid then
		humanoid.Health = 0
	end
end)

-- 會一閃一閃的熔岩
while true do
	for t = 0, 1, 0.05 do
		lava.Color = Color3.fromRGB(255, 60 + t * 80, 20)
		task.wait(0.03)
	end
	for t = 1, 0, -0.05 do
		lava.Color = Color3.fromRGB(255, 60 + t * 80, 20)
		task.wait(0.03)
	end
end
` },
  ],
},
{
  title: '🛗 移動平台 + TweenService',
  desc: 'Tween 動畫、會轉的風車、會變色的地板',
  scripts: [{ name: 'Platforms', type: 'Script', parent: 'ServerScriptService', source: `
local TweenService = game:GetService("TweenService")
local RunService = game:GetService("RunService")

-- 1) 來回移動的平台：站上去會被載著走
local platform = Instance.new("Part")
platform.Name = "MovingPlatform"
platform.Size = Vector3.new(8, 1, 8)
platform.Position = Vector3.new(0, 1, -16)
platform.Anchored = true
platform.Color = Color3.fromRGB(80, 160, 255)
platform.Parent = workspace

local info = TweenInfo.new(
	3,                          -- 秒數
	Enum.EasingStyle.Sine,      -- 緩動
	Enum.EasingDirection.InOut,
	-1,                         -- 重複次數，-1 = 永遠
	true                        -- 來回
)
local tween = TweenService:Create(platform, info, { Position = Vector3.new(0, 12, -40) })
tween:Play()

-- 終點平台
local goal = Instance.new("Part")
goal.Size = Vector3.new(12, 1, 12)
goal.Position = Vector3.new(0, 11.5, -50)
goal.Anchored = true
goal.Color = Color3.fromRGB(60, 200, 90)
goal.Parent = workspace

-- 2) 一直轉的風車
local spinner = Instance.new("Part")
spinner.Name = "Spinner"
spinner.Size = Vector3.new(24, 1, 2)
spinner.Position = Vector3.new(20, 1.5, 0)
spinner.Anchored = true
spinner.Color = Color3.fromRGB(255, 90, 90)
spinner.Parent = workspace

RunService.Heartbeat:Connect(function(dt)
	spinner.CFrame = spinner.CFrame * CFrame.Angles(0, dt * 1.5, 0)
end)

-- 3) 每秒換顏色的地板
local floor = Instance.new("Part")
floor.Size = Vector3.new(10, 1, 10)
floor.Position = Vector3.new(-20, 0.5, 0)
floor.Anchored = true
floor.Parent = workspace

local colors = { Color3.fromRGB(255, 99, 99), Color3.fromRGB(255, 220, 90), Color3.fromRGB(90, 220, 120), Color3.fromRGB(90, 160, 255) }
local i = 1
while true do
	local t = TweenService:Create(floor, TweenInfo.new(0.5), { Color = colors[i] })
	t:Play()
	t.Completed:Wait()
	i = i % #colors + 1
	task.wait(0.5)
end
` }],
},
{
  title: '🖱 點擊方塊 + GUI 計分板',
  desc: 'ClickDetector、ScreenGui、TextLabel、TextButton、RemoteEvent',
  scripts: [
    { name: 'ClickBlocks', type: 'Script', parent: 'ServerScriptService', source: `
-- 伺服器：建幾個可以點的方塊，被點到就通知 GUI
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local scored = Instance.new("RemoteEvent")
scored.Name = "Scored"
scored.Parent = ReplicatedStorage

for i = 1, 5 do
	local block = Instance.new("Part")
	block.Size = Vector3.new(3, 3, 3)
	block.Position = Vector3.new(-12 + i * 4, 3, -10)
	block.Anchored = true
	block.Color = Color3.fromHSV(i / 6, 0.7, 1)
	block.Parent = workspace

	local click = Instance.new("ClickDetector")
	click.Parent = block
	click.MouseClick:Connect(function(player)
		-- 跳到隨機高度
		block.Position = Vector3.new(block.Position.X, math.random(2, 10), -10)
		scored:FireClient(player, i)
	end)
end
print("用滑鼠左鍵點方塊！")
` },
    { name: 'ScoreGui', type: 'LocalScript', parent: 'StarterPlayerScripts', source: `
-- 玩家端：畫計分板，收到伺服器通知就加分
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local player = Players.LocalPlayer

local gui = Instance.new("ScreenGui")
gui.Name = "ScoreGui"
gui.Parent = player:WaitForChild("PlayerGui")

local frame = Instance.new("Frame")
frame.Size = UDim2.new(0, 220, 0, 110)
frame.Position = UDim2.new(0, 16, 0, 16)
frame.BackgroundColor3 = Color3.fromRGB(30, 30, 40)
frame.BackgroundTransparency = 0.2
frame.Parent = gui
Instance.new("UICorner", frame).CornerRadius = UDim.new(0, 12)

local label = Instance.new("TextLabel")
label.Size = UDim2.new(1, 0, 0.55, 0)
label.BackgroundTransparency = 1
label.TextColor3 = Color3.new(1, 1, 1)
label.TextScaled = true
label.Font = Enum.Font.GothamBold
label.Text = "分數：0"
label.Parent = frame

local button = Instance.new("TextButton")
button.Size = UDim2.new(0.8, 0, 0.3, 0)
button.Position = UDim2.new(0.1, 0, 0.62, 0)
button.BackgroundColor3 = Color3.fromRGB(255, 90, 90)
button.TextColor3 = Color3.new(1, 1, 1)
button.Text = "歸零"
button.TextSize = 18
button.Parent = frame
Instance.new("UICorner", button)

local score = 0
local scored = ReplicatedStorage:WaitForChild("Scored")
scored.OnClientEvent:Connect(function(points)
	score += points
	label.Text = "分數：" .. score
end)

button.MouseButton1Click:Connect(function()
	score = 0
	label.Text = "分數：0"
end)
` },
  ],
},
{
  title: '🐞 除錯練習：抓出 3 隻蟲',
  desc: '故意寫錯的程式，用中斷點、單步、監看把錯找出來',
  scripts: [{ name: 'BuggyTower', type: 'Script', parent: 'ServerScriptService', source: `
-- 🐞 這支程式想蓋一座 10 層的塔，每層顏色越來越深，最後印出總重量。
--    但是裡面有 3 隻蟲！試著用除錯工具把它們找出來：
--    1. 先按 F5 執行，看輸出視窗的紅字錯誤，點紅字會跳到出錯的行
--    2. 勾選上方「出錯時暫停」再執行一次，停下來時看「變數」分頁
--    3. 在 buildFloor 裡設中斷點，用 F10 / F11 一步一步看 level 和 size 的值
--    （答案在最下面，先別偷看！）

local FLOORS = 10
local tower = Instance.new("Model")
tower.Name = "Tower"
tower.Parent = workspace

local function buildFloor(level)
	local size = 12 - level
	local part = Instance.new("Part")
	part.Name = "Floor" .. level
	part.Size = Vector3.new(size, 1, size)
	part.Postion = Vector3.new(0, level, 0)          -- 🐞 蟲 #1 在這附近
	part.Anchored = true
	part.Color = Color3.fromRGB(255 - level * 20, 120, 60)
	part.Parent = tower
	return part
end

local floors = {}
for level = 1, FLOORS do
	floors[level] = buildFloor(level)
end

local totalMass = 0
for i = 0, #floors do                              -- 🐞 蟲 #2 在這附近
	totalMass = totalMass + floors[i]:GetMass()
end
print("塔的總重量：" .. totalMass)

local top = tower:FindFirstChild("Floor" .. FLOORS)
print("最上面一層的大小：" .. top.Size)             -- 🐞 蟲 #3 在這附近














-- ===== 答案 =====
-- #1 Postion 拼錯了，應該是 Position（Roblox 分大小寫、拼字要完全對）
-- #2 Luau 的表格從 1 開始，floors[0] 是 nil，所以 i 要從 1 開始
-- #3 Size 是 Vector3，不能直接用 .. 接字串，要用 tostring(top.Size)
` }],
},
{
  title: '🧱 物件導向：ModuleScript 類別',
  desc: 'metatable 寫類別、require 模組、方法與繼承',
  scripts: [
    { name: 'Pet', type: 'ModuleScript', parent: 'ReplicatedStorage', source: `
-- 一個「寵物」類別
local Pet = {}
Pet.__index = Pet

function Pet.new(name: string, kind: string)
	local self = setmetatable({}, Pet)
	self.name = name
	self.kind = kind
	self.hunger = 50
	return self
end

function Pet:feed(amount: number)
	self.hunger = math.max(0, self.hunger - amount)
	print(\`{self.name} 吃飽了一點，飢餓度 {self.hunger}\`)
end

function Pet:speak()
	return "..."
end

function Pet:__tostring()
	return \`<{self.kind} {self.name}>\`
end
Pet.__tostring = Pet.__tostring

return Pet
` },
    { name: 'Dog', type: 'ModuleScript', parent: 'ReplicatedStorage', source: `
-- 繼承 Pet 的「狗」類別
local Pet = require(script.Parent.Pet)

local Dog = setmetatable({}, { __index = Pet })
Dog.__index = Dog
Dog.__tostring = Pet.__tostring

function Dog.new(name)
	local self = Pet.new(name, "狗")
	return setmetatable(self, Dog)
end

function Dog:speak()
	return "汪汪！"
end

function Dog:fetch()
	print(self.name .. " 把球撿回來了 🎾")
end

return Dog
` },
    { name: 'Main', type: 'Script', parent: 'ServerScriptService', source: `
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Pet = require(ReplicatedStorage.Pet)
local Dog = require(ReplicatedStorage.Dog)

local cat = Pet.new("咪咪", "貓")
local dog = Dog.new("旺財")

print(cat, cat:speak())
print(dog, dog:speak())
dog:feed(20)
dog:fetch()

local pets = { cat, dog }
for _, p in ipairs(pets) do
	print(tostring(p), "飢餓度", p.hunger)
end
-- 💡 在 Dog:speak() 那行設中斷點，用 F11「進入」看看程式怎麼跳進模組裡
` },
  ],
},
{
  title: '🎮 鍵盤控制：發射彈珠 + 爆炸',
  desc: 'UserInputService、LocalScript、物理、Explosion',
  scripts: [
    { name: 'Controls', type: 'LocalScript', parent: 'StarterPlayerScripts', source: `
-- 按 E 往前丟一顆彈珠、按 F 在面前引爆、按 R 堆一疊箱子
local UserInputService = game:GetService("UserInputService")
local Players = game:GetService("Players")
local player = Players.LocalPlayer

local function root()
	local character = player.Character
	return character and character:FindFirstChild("HumanoidRootPart")
end

UserInputService.InputBegan:Connect(function(input, gameProcessed)
	if gameProcessed then return end
	local hrp = root()
	if not hrp then return end

	if input.KeyCode == Enum.KeyCode.E then
		local ball = Instance.new("Part")
		ball.Shape = Enum.PartType.Ball
		ball.Size = Vector3.new(1.5, 1.5, 1.5)
		ball.Color = BrickColor.random().Color
		ball.Material = Enum.Material.Neon
		ball.Position = hrp.Position + hrp.CFrame.LookVector * 3 + Vector3.new(0, 1, 0)
		ball.AssemblyLinearVelocity = hrp.CFrame.LookVector * 60 + Vector3.new(0, 30, 0)
		ball.Parent = workspace
		game:GetService("Debris"):AddItem(ball, 8)   -- 8 秒後自動刪掉

	elseif input.KeyCode == Enum.KeyCode.F then
		local boom = Instance.new("Explosion")
		boom.Position = hrp.Position + hrp.CFrame.LookVector * 12
		boom.BlastRadius = 8
		boom.DestroyJointRadiusPercent = 0   -- 0 = 不會炸死自己
		boom.Parent = workspace

	elseif input.KeyCode == Enum.KeyCode.R then
		local base = hrp.Position + hrp.CFrame.LookVector * 10
		for y = 0, 4 do
			for x = -1, 1 do
				local box = Instance.new("Part")
				box.Size = Vector3.new(2, 2, 2)
				box.Color = Color3.fromRGB(200, 150, 90)
				box.Material = Enum.Material.WoodPlanks
				box.Position = Vector3.new(base.X + x * 2.1, 1 + y * 2.05, base.Z)
				box.Parent = workspace
			end
		end
	end
end)
print("點一下 3D 畫面，然後按 E 丟彈珠、R 堆箱子、F 爆炸！")
` },
  ],
},
{
  title: '⏱ 跑酷關卡：計時挑戰',
  desc: '程式產生關卡、檢查點、終點、計時 GUI、BillboardGui',
  scripts: [
    { name: 'Obby', type: 'Script', parent: 'ServerScriptService', source: `
-- 程式自動產生一條跑酷路線
local Players = game:GetService("Players")

local course = Instance.new("Folder")
course.Name = "Course"
course.Parent = workspace

local function block(name, size, pos, color, material)
	local p = Instance.new("Part")
	p.Name = name
	p.Size = size
	p.Position = pos
	p.Anchored = true
	p.Color = color
	p.Material = material or Enum.Material.SmoothPlastic
	p.Parent = course
	return p
end

local z = -10
local y = 1
local checkpoints = {}
math.randomseed(42)
for i = 1, 14 do
	z -= math.random(7, 10)
	y += math.random(-1, 2)
	local x = math.random(-4, 4)
	local isCheckpoint = i % 5 == 0
	local p = block(isCheckpoint and "Checkpoint" or "Jump" .. i, Vector3.new(isCheckpoint and 8 or 5, 1, isCheckpoint and 8 or 5), Vector3.new(x, y, z),
		isCheckpoint and Color3.fromRGB(80, 200, 255) or Color3.fromHSV(i / 14, 0.5, 1))
	if isCheckpoint then table.insert(checkpoints, p) end
end

local finish = block("Finish", Vector3.new(12, 1, 12), Vector3.new(0, y, z - 12), Color3.fromRGB(255, 215, 0), Enum.Material.Neon)

-- 終點上方的看板
local board = Instance.new("BillboardGui")
board.Size = UDim2.new(0, 200, 0, 50)
board.StudsOffset = Vector3.new(0, 5, 0)
board.Parent = finish
local text = Instance.new("TextLabel")
text.Size = UDim2.new(1, 0, 1, 0)
text.BackgroundTransparency = 1
text.Text = "🏁 終點"
text.TextScaled = true
text.TextColor3 = Color3.new(1, 1, 1)
text.Parent = board

-- 記錄每個玩家的重生點和開始時間
local lastCheckpoint = {}
local startTime = {}

local finishedEvent = Instance.new("BindableEvent")
finishedEvent.Name = "Finished"
finishedEvent.Parent = game:GetService("ReplicatedStorage")

for _, cp in ipairs(checkpoints) do
	cp.Touched:Connect(function(hit)
		local player = Players:GetPlayerFromCharacter(hit.Parent)
		if player and lastCheckpoint[player] ~= cp then
			lastCheckpoint[player] = cp
			print("✅ 存檔點！")
		end
	end)
end

finish.Touched:Connect(function(hit)
	local player = Players:GetPlayerFromCharacter(hit.Parent)
	if player and startTime[player] then
		local t = time() - startTime[player]
		startTime[player] = nil
		print(string.format("🏆 %s 完成了！用時 %.2f 秒", player.Name, t))
		finishedEvent:Fire(t)
	end
end)

Players.PlayerAdded:Connect(function(player)
	player.CharacterAdded:Connect(function(character)
		local cp = lastCheckpoint[player]
		if cp then
			task.wait()
			character:PivotTo(cp.CFrame + Vector3.new(0, 4, 0))
		else
			startTime[player] = time()
		end
	end)
end)
` },
    { name: 'Timer', type: 'LocalScript', parent: 'StarterPlayerScripts', source: `
-- 畫面上方的計時器
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local gui = Instance.new("ScreenGui")
gui.ResetOnSpawn = false
gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")

local label = Instance.new("TextLabel")
label.AnchorPoint = Vector2.new(0.5, 0)
label.Position = UDim2.new(0.5, 0, 0, 10)
label.Size = UDim2.new(0, 220, 0, 44)
label.BackgroundColor3 = Color3.fromRGB(20, 20, 30)
label.BackgroundTransparency = 0.3
label.TextColor3 = Color3.new(1, 1, 1)
label.Font = Enum.Font.Code
label.TextSize = 26
label.Parent = gui
Instance.new("UICorner", label)

local start = time()
local done = false
ReplicatedStorage:WaitForChild("Finished").Event:Connect(function(t)
	done = true
	label.Text = string.format("🏆 %.2f 秒", t)
	label.BackgroundColor3 = Color3.fromRGB(200, 150, 0)
end)

RunService.RenderStepped:Connect(function()
	if not done then
		label.Text = string.format("⏱ %.1f", time() - start)
	end
end)
` },
  ],
},
];
