local function fib(n: number): number
  if n < 2 then return n end
  return fib(n-1) + fib(n-2)
end
print("fib", fib(20))
local t = {1,2,3, x = 5}
t.y = "hi"
for i, v in ipairs(t) do print(i, v) end
for k, v in t do if type(k)=="string" then print(k, v) end end
local s = 0
for i = 1, 10 do if i % 2 == 0 then continue end s += i end
print("odd sum", s, `interp {s * 2} ok`)
print(string.format("%5.2f|%d|%s|%x", math.pi, 42, "a", 255))
print(("hello world"):gsub("o", "0"))
for w in string.gmatch("one two three", "%a+") do print(w) end
print(string.find("hello", "l+"))
print(string.match("key=val", "(%w+)=(%w+)"))
local Animal = {}
Animal.__index = Animal
function Animal.new(name) return setmetatable({name=name}, Animal) end
function Animal:speak() return self.name .. " says hi" end
print(Animal.new("Cat"):speak())
local co = coroutine.create(function(a) local b = coroutine.yield(a+1) return b*2 end)
print(coroutine.resume(co, 1))
print(coroutine.resume(co, 10))
print(coroutine.status(co))
print(pcall(function() error("boom") end))
print(pcall(function() local x = nil; return x.y end))
local v = if s > 10 then "big" else "small"
print(v, #t, select("#", 1, 2, 3), tostring(nil), 10/4, 7//2, 2^10, -7 % 3)
print({a=1, b={1,2}})
type Foo = {x: number}
local q: Foo = {x = 1}
print(q.x :: number)
print(table.concat({1,2,3}, ","), math.clamp(5, 1, 3), math.round(2.5), tonumber("0x1f"), tonumber("z", 36))
local arr = {5,3,8,1}
table.sort(arr, function(a, b) return a > b end)
print(table.concat(arr, " "))
print(string.format("%q", 'a"b\n'), ("abc"):upper(), #"abc", ("x"):rep(3, "-"))
local function deep(n) return deep(n + 1) end
print(pcall(deep, 1))
print(0.1 + 0.2, 1e300 * 1e10, 100 / 3, 2^53)
