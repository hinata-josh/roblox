-- 直譯器語意測試：check(名稱, 實際, 期望)
-- 閉包：每次迴圈都是新的變數
local fs = {}
for i = 1, 3 do fs[i] = function() return i end end
check("closure per iteration", fs[1]() + fs[2]() * 10 + fs[3]() * 100, 321)

local function counter()
	local n = 0
	return function() n += 1; return n end, function() return n end
end
local inc, get = counter()
inc(); inc()
check("shared upvalue", get(), 2)

-- varargs / select
local function va(...) return select("#", ...), select(2, ...) end
local c, second = va(1, nil, 3)
check("select # with nil", c, 3)
check("select 2", second, nil)
check("select negative", select(-1, "a", "b", "c"), "c")
local function pack(...) return {...} end
check("vararg table", #pack(1, 2, 3), 3)
check("table.pack n", table.pack(1, nil, 3).n, 3)

-- 多重指定
local a, b = 1, 2
a, b = b, a
check("swap", a * 10 + b, 21)
local t = {}
local i = 1
i, t[i] = i + 1, 20
check("assign order", t[1], 20)

-- 數字
check("floor div neg", -7 // 2, -4)
check("mod neg", -7 % 3, 2)
check("mod neg divisor", 7 % -3, -2)
check("float mod", 5.5 % 2, 1.5)
check("pow", 2 ^ 0.5 > 1.41, true)
check("tostring int", tostring(10), "10")
check("tostring float", tostring(2.5), "2.5")
check("tostring 1e300", tostring(1e300), "1e+300")
check("tostring inf", tostring(math.huge), "inf")
check("tostring -inf", tostring(-math.huge), "-inf")
check("tonumber hex", tonumber("0xff"), 255)
check("tonumber space", tonumber("  12  "), 12)
check("tonumber bad", tonumber("12a"), nil)
check("tonumber base2", tonumber("1011", 2), 11)
check("string arith", "10" + 5, 15)
check("concat number", 1 .. 2, "12")
check("int key normalize", ({[1] = "a"})[1.0], "a")
check("math.round half", math.round(-2.5), -3)
check("hex literal", 0xFF + 0b101, 260)
check("underscore number", 1_000_000, 1000000)

-- 字串
check("upper method", ("abc"):upper(), "ABC")
check("sub negative", ("hello"):sub(-3), "llo")
check("sub range", ("hello"):sub(2, 3), "el")
check("len", #"hello", 5)
check("rep sep", ("ab"):rep(3, ","), "ab,ab,ab")
check("byte/char", string.char(("A"):byte() + 1), "B")
check("format d", string.format("%03d|%-4s|%5.1f", 7, "x", 3.14159), "007|x   |  3.1")
check("format x", string.format("%x %X %o", 255, 255, 8), "ff FF 10")
check("format g", string.format("%g %g", 100000, 1e20), "100000 1e+20")
check("format q", string.format("%q", "a\nb"), '"a\\nb"')
check("format %%", string.format("100%%"), "100%")
check("find plain", string.find("a.b", ".", 1, true), 2)
check("find pattern", string.find("abc123", "%d+"), 4)
check("match captures", table.concat({string.match("2024-01-15", "(%d+)-(%d+)-(%d+)")}, "/"), "2024/01/15")
check("match anchor", string.match("  trim  ", "^%s*(.-)%s*$"), "trim")
check("match position capture", string.match("hello", "()ll()"), 3)
check("gsub count", select(2, string.gsub("aaa", "a", "b")), 3)
check("gsub fn", (string.gsub("hello world", "%w+", function(w) return w:upper() end)), "HELLO WORLD")
check("gsub table", (string.gsub("$name is $age", "%$(%w+)", {name = "Tom", age = 9})), "Tom is 9")
check("gsub %1", (string.gsub("abc", "(%w)", "%1%1")), "aabbcc")
check("gsub limit", (string.gsub("aaaa", "a", "b", 2)), "bbaa")
check("gsub empty match", (string.gsub("abc", "", "-")), "-a-b-c-")
local words = {}
for w in string.gmatch("one, two,three", "%a+") do table.insert(words, w) end
check("gmatch", table.concat(words, "|"), "one|two|three")
local kv = {}
for k, v in string.gmatch("a=1, b=2", "(%w+)=(%w+)") do kv[k] = tonumber(v) end
check("gmatch pairs", kv.a + kv.b, 3)
check("split", #string.split("a,b,,c", ","), 4)
check("frontier", (string.gsub("THE (quick) fox", "%f[%a]%a+", "X")), "X (X) X")
check("char class set", string.match("abc-123", "[%a-]+"), "abc-")
check("negated set", string.match("abc123", "[^%a]+"), "123")
check("lazy", string.match("<a><b>", "<(.-)>"), "a")
check("escape unicode", "\u{4E2D}", "中")
check("long string", [[a
b]], "a\nb")
check("long string level", [==[x]]y]==], "x]]y")
local name = "Lua"
check("interp", `Hi {name}! {1 + 1} {("x"):rep(2)}`, "Hi Lua! 2 xx")
check("interp table", `{ ({1, 2})[2] }`, "2")
check("interp escape", `a\{b}`, "a{b}")

-- 控制流程
local s = 0
for k = 1, 10 do
	if k % 2 == 0 then continue end
	if k > 7 then break end
	s += k
end
check("continue/break", s, 16)
local r = 0
repeat local x = r; r += 1 until x >= 3
check("repeat scope", r, 4)
local fl = {}
for v = 1, 2, 0.5 do table.insert(fl, v) end
check("float step", #fl, 3)
local down = 0
for v = 10, 1, -3 do down += 1 end
check("negative step", down, 4)
check("if expr", if 5 > 3 then "yes" elseif false then "no" else "no", "yes")
local n = 0
while true do n += 1; if n == 5 then break end end
check("while break", n, 5)
local nested = 0
for x = 1, 3 do for y = 1, 3 do if y == 2 then break end nested += 1 end end
check("nested break", nested, 3)

-- 表格
local arr = {10, 20, 30}
table.insert(arr, 1, 5)
check("insert pos", table.concat(arr, ","), "5,10,20,30")
check("remove pos", table.remove(arr, 2), 10)
check("remove last", table.remove(arr), 30)
check("after remove", table.concat(arr, ","), "5,20")
local sorted = {3, 1, 2}
table.sort(sorted)
check("sort", table.concat(sorted), "123")
local people = {{n = "b", a = 2}, {n = "a", a = 1}}
table.sort(people, function(x, y) return x.a < y.a end)
check("sort cmp", people[1].n, "a")
check("table.find", table.find({"x", "y", "z"}, "y"), 2)
check("unpack", select("#", table.unpack({1, 2, 3})), 3)
local holes = {1, 2, nil, 4}
check("ipairs stops at nil", (function() local c = 0 for _ in ipairs(holes) do c += 1 end return c end)(), 2)
local cnt = 0
for k, v in pairs({a = 1, b = 2, 3}) do cnt += 1 end
check("pairs count", cnt, 3)
check("next empty", next({}), nil)
local frozen = table.freeze({1})
check("freeze", pcall(function() frozen[1] = 2 end), false)
check("table.clone", table.clone({1, 2})[2], 2)
check("concat range", table.concat({1, 2, 3, 4}, "-", 2, 3), "2-3")
local tt = {x = {y = 1}}
tt.x.y += 5
check("compound field", tt.x.y, 6)
local calls = 0
local function getT() calls += 1; return tt end
getT().x.y *= 2
check("compound evaluates once", calls, 1)

-- metatable
local V = {}
V.__index = V
V.__add = function(p, q) return setmetatable({x = p.x + q.x}, V) end
V.__eq = function(p, q) return p.x == q.x end
V.__lt = function(p, q) return p.x < q.x end
V.__le = function(p, q) return p.x <= q.x end
V.__tostring = function(p) return "V(" .. p.x .. ")" end
V.__concat = function(p, q) return tostring(p) .. tostring(q) end
V.__len = function(p) return p.x end
V.__unm = function(p) return setmetatable({x = -p.x}, V) end
V.__call = function(self, k) return self.x * k end
function V.new(x) return setmetatable({x = x}, V) end
function V:double() return V.new(self.x * 2) end
local v1, v2 = V.new(1), V.new(2)
check("__add", (v1 + v2).x, 3)
check("__eq", V.new(5) == V.new(5), true)
check("__lt", v1 < v2, true)
check("__le", v2 <= v1, false)
check("__tostring", tostring(v1), "V(1)")
check("__concat", v1 .. v2, "V(1)V(2)")
check("__len", #V.new(7), 7)
check("__unm", (-v2).x, -2)
check("__call", v2(10), 20)
check("method", v1:double().x, 2)
local dflt = setmetatable({}, {__index = function(_, k) return k .. "!" end})
check("__index fn", dflt.hi, "hi!")
local log = {}
local proxy = setmetatable({}, {__newindex = function(t, k, v) rawset(t, k, v * 2) end})
proxy.a = 5
check("__newindex", proxy.a, 10)
check("rawget", rawget(dflt, "hi"), nil)
check("getmetatable protected", getmetatable(setmetatable({}, {__metatable = "locked"})), "locked")
local Base = {}
Base.__index = Base
function Base.new() return setmetatable({}, Base) end
function Base:kind() return "base" end
function Base:hello() return "hello " .. self:kind() end
local Derived = setmetatable({}, {__index = Base})
Derived.__index = Derived
function Derived.new() return setmetatable(Base.new(), Derived) end
function Derived:kind() return "derived" end
check("inheritance", Derived.new():hello(), "hello derived")

-- 錯誤處理
local ok, err = pcall(error, {code = 42})
check("error table", err.code, 42)
local ok2, err2 = pcall(function() error("msg", 0) end)
check("error level 0", err2, "msg")
local ok3, err3 = pcall(function() error("boom") end)
check("error has position", string.find(err3, ":%d+: boom") ~= nil, true)
local function thrower() error("deep", 2) end
local ok4, err4 = pcall(function() thrower() end)
check("error level 2 line", string.match(err4, ":(%d+):") ~= nil, true)
check("xpcall handler", select(2, xpcall(function() error("x", 0) end, function(e) return "handled " .. e end)), "handled x")
check("pcall returns values", select(2, pcall(function() return 1, 2 end)), 1)
check("assert message", select(2, pcall(assert, false, "custom")), "custom")
check("nested pcall", (function() local o = pcall(function() pcall(error, "inner"); error("outer") end) return o end)(), false)
check("arith error", select(2, pcall(function() return nil + 1 end)):match("arithmetic") ~= nil, true)
check("compare error", select(2, pcall(function() return {} < {} end)):match("compare") ~= nil, true)

-- coroutine
local gen = coroutine.wrap(function() for k = 1, 3 do coroutine.yield(k) end end)
check("wrap gen", gen() + gen() + gen(), 6)
local co = coroutine.create(function(x, y)
	local z = coroutine.yield(x + y)
	local w = coroutine.yield(z * 2)
	return w + 1
end)
check("resume 1", select(2, coroutine.resume(co, 1, 2)), 3)
check("resume 2", select(2, coroutine.resume(co, 10)), 20)
check("resume 3", select(2, coroutine.resume(co, 99)), 100)
check("dead", coroutine.status(co), "dead")
check("resume dead", coroutine.resume(co), false)
local errco = coroutine.create(function() error("in co", 0) end)
check("co error", select(2, coroutine.resume(errco)), "in co")
check("isyieldable outside", coroutine.isyieldable(), false)

-- 遞迴 / 深度
local function depth(k) if k == 0 then return 0 end return 1 + depth(k - 1) end
check("deep recursion 3000", depth(3000), 3000)
local function fib(k) if k < 2 then return k end return fib(k - 1) + fib(k - 2) end
check("fib", fib(20), 6765)
check("stack overflow caught", pcall(function() local function f() return f() + 1 end return f() end), false)

-- 型別註記會被忽略
type Point = {x: number, y: number}
export type Maybe<T> = T?
local function typed(p: Point, scale: number?): (number, string)
	return p.x * (scale or 1), "ok"
end
check("types ignored", typed({x = 3, y = 0}, 2), 6)
local casted = (5 :: any) :: number
check("cast", casted, 5)
local fn: (number) -> number = function(q) return q + 1 end
check("function type", fn(1), 2)
local generic = function<T>(x: T): T return x end
check("generic", generic("g"), "g")

-- 其他內建
check("type", type(print), "function")
check("typeof", typeof({}), "table")
check("utf8.char", utf8.char(72, 105), "Hi")
check("bit32", bit32.band(12, 10) + bit32.bor(1, 2) + bit32.lshift(1, 4), 27)
check("math.clamp", math.clamp(15, 0, 10), 10)
check("math.max", math.max(3, 9, 2), 9)
check("os.time number", type(os.time()), "number")
check("string.format %s nil", string.format("%s", nil), "nil")
check("tostring bool", tostring(false), "false")
check("select #", select("#"), 0)
check("_G shared", type(_G), "table")
