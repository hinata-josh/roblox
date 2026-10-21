print("Hello from", script.Name, script:GetFullName())
local part = Instance.new("Part")
part.Name = "MyPart"
part.Size = Vector3.new(4, 2, 4)
part.Position = Vector3.new(0, 20, 0)
part.BrickColor = BrickColor.new("Bright red")
part.Parent = workspace
print(part.Position, part.BrickColor, part.Color, typeof(part), part:IsA("BasePart"))
local landed = false
part.Touched:Connect(function(hit)
	if not landed then
		landed = true
		print("touched", hit.Name, "at t=", math.floor(time()*10)/10)
	end
end)
local Players = game:GetService("Players")
Players.PlayerAdded:Connect(function(player)
	print("player joined", player.Name)
	local ls = Instance.new("Folder")
	ls.Name = "leaderstats"
	ls.Parent = player
	local coins = Instance.new("IntValue")
	coins.Name = "Coins"
	coins.Value = 5
	coins.Parent = ls
	coins.Changed:Connect(function(v) print("coins now", v) end)
	player.CharacterAdded:Connect(function(char)
		print("character", char.Name, char:WaitForChild("Humanoid").Health)
		task.wait(0.5)
		coins.Value += 10
	end)
end)
local TweenService = game:GetService("TweenService")
local p2 = Instance.new("Part", workspace)
p2.Anchored = true
p2.Position = Vector3.new(10, 5, 0)
local tw = TweenService:Create(p2, TweenInfo.new(1, Enum.EasingStyle.Linear), {Position = Vector3.new(20, 5, 0)})
tw.Completed:Connect(function(state) print("tween done", state, p2.Position) end)
tw:Play()
local t0 = time()
task.wait(1.5)
print("after wait", math.floor((time()-t0)*10)/10, "part y", math.floor(part.Position.Y*10)/10)
local cf = CFrame.new(0, 5, 0) * CFrame.Angles(0, math.rad(90), 0)
print(cf.LookVector, cf.Position)
print(pcall(function() return part.Foo end))
print(pcall(function() part.Size = 5 end))
local hb = 0
local conn
conn = game:GetService("RunService").Heartbeat:Connect(function(dt)
	hb += 1
	if hb == 10 then print("10 heartbeats"); conn:Disconnect() end
end)
task.spawn(function() print("spawned runs immediately") end)
print("after spawn")
local res = workspace:Raycast(Vector3.new(0, 50, 0), Vector3.new(0, -100, 0))
print("ray hit", res and res.Instance.Name, res and res.Position)
local m = Instance.new("Model", workspace)
for i = 1, 3 do local x = Instance.new("Part", m); x.Anchored = true; x.Position = Vector3.new(i*2, 10, 0) end
m:PivotTo(CFrame.new(100, 10, 0))
print("model pivot", m:GetPivot().Position)
error("final error test")
