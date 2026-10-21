/* app.js — Roblox 工作室介面：程式編輯器、檔案總管/屬性、除錯面板、3D 畫面(Three.js)、GUI 疊圖 */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KEY_PROJ = 'luauStudio.project.v1', KEY_DS = 'luauStudio.datastore.v1', KEY_UI = 'luauStudio.ui.v1';
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 無痕或被擋：照常運作，只是不存 */ } },
};
const { Runtime, Instance, Vector3, Color3, CFrame, UDim2, Vector2, EnumItem, ENUMS, BrickColor } = Rbx;
const { LuaTable, LuaFunction, luaType, luauTypeof } = Luau;

// ===================================================================
// 專案
// ===================================================================
let uid = Date.now() % 100000;
const newId = () => 's' + (++uid).toString(36) + Math.random().toString(36).slice(2, 6);
function fromExample(ex) {
  return { name: ex.title, scripts: ex.scripts.map(s => ({ id: newId(), name: s.name, type: s.type, parent: s.parent, source: s.source.replace(/^\n/, ''), bps: [] })) };
}
let project = store.get(KEY_PROJ, null);
if (!project || !Array.isArray(project.scripts) || !project.scripts.length) project = fromExample(EXAMPLES[0]);
const ui = Object.assign({ open: [], active: null, breakErr: false, showTime: false, leftW: 250, rightW: null, bottomH: 230 }, store.get(KEY_UI, {}));
let saveTimer = 0;
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); }
function saveNow() { store.set(KEY_PROJ, project); store.set(KEY_UI, { open: S.open, active: S.active, breakErr: $('#chkBreakErr').checked, showTime: $('#chkTime').checked, leftW: ui.leftW, rightW: ui.rightW, bottomH: ui.bottomH }); }
const scriptById = (id) => project.scripts.find(s => s.id === id);
const PARENTS = ['ServerScriptService', 'Workspace', 'ReplicatedStorage', 'ServerStorage', 'StarterPlayerScripts', 'StarterCharacterScripts', 'StarterGui'];

// ===================================================================
// 狀態
// ===================================================================
const S = {
  mode: 'edit', rt: null, preview: null, paused: null, open: [], active: null, editors: new Map(),
  selected: null, expanded: new Set(['Game', 'Game.Workspace', 'Game.ServerScriptService', 'Game.StarterPlayer', 'Game.StarterPlayer.StarterPlayerScripts', 'Game.ReplicatedStorage', 'Game.StarterGui', 'Game.Players']),
  errCount: 0, selFrame: 0, watches: store.get('luauStudio.watches', []),
};

// ===================================================================
// 輸出
// ===================================================================
const outEl = $('#out');
let lastOut = null;
const HINTS = [
  [/attempt to index nil with '([^']+)'/, (m) => `💡 你想讀「${m[1]}」，但它前面的東西是 nil（不存在）。常見原因：名字打錯、物件還沒建立，或要用 :WaitForChild("名字") 等它出現。`],
  [/is not a valid member of (\w+)/, (m) => `💡 這個 ${m[1]} 沒有這個屬性或子物件。檢查拼字和大小寫（Roblox 分大小寫，Position ≠ position）。`],
  [/attempt to call a nil value/, () => '💡 你呼叫的函式不存在（是 nil）。檢查函式名稱拼字，或確定函式在呼叫之前就已經寫好。'],
  [/attempt to call missing method '(\w+)'/, (m) => `💡 這個物件沒有 ${m[1]} 方法。檢查拼字，或確認冒號 : 前面的東西是你以為的那種物件。`],
  [/attempt to perform arithmetic \(\w+\) on (\w+) and (\w+)/, (m) => `💡 做數學運算時有一邊不是數字（這裡是 ${m[1]} 和 ${m[2]}）。用 tonumber() 轉換，或檢查變數是不是 nil。`],
  [/attempt to compare/, () => '💡 比較大小 (< > <= >=) 的兩邊型別不同，或其中一邊是 nil。'],
  [/attempt to concatenate (\w+) with (\w+)/, (m) => `💡 用 .. 接字串時有一邊是 ${m[1] === 'string' ? m[2] : m[1]}。可以先用 tostring() 轉成文字。`],
  [/Expected 'end'|to close '(function|if|for|while|do)'/, () => '💡 少了 end。每個 function / if / for / while / do 都要有一個對應的 end，可以看縮排找出是哪一個。'],
  [/Expected '\)'|to close '\('/, () => '💡 括號 ( ) 沒有成對，檢查是不是少了右括號。'],
  [/Unable to assign property (\w+)\. (\w+) expected, got (\w+)/, (m) => `💡 屬性 ${m[1]} 要放 ${m[2]} 型別的值，你給的是 ${m[3]}。${m[2] === 'Vector3' ? '例如 Vector3.new(0, 5, 0)' : m[2] === 'Color3' ? '例如 Color3.fromRGB(255, 0, 0)' : m[2] === 'CFrame' ? '例如 CFrame.new(0, 5, 0)' : ''}`],
  [/Infinite yield possible/, () => '💡 WaitForChild 等了 5 秒還沒等到，名字可能打錯，或那個物件根本沒有被建立。'],
  [/stack overflow/, () => '💡 函式一直呼叫自己停不下來（無限遞迴）。檢查遞迴有沒有「停止條件」。'],
  [/Incomplete statement/, () => '💡 這一行看起來不完整：要嘛是指定值（x = 1），要嘛是呼叫函式（print(x)）。'],
  [/is not a valid Service name/, () => '💡 GetService 的服務名稱打錯了，例如 "Players"、"TweenService"、"RunService"。'],
  [/Unable to create an Instance of type/, () => '💡 Instance.new 的類別名稱不對（或這個編輯器還不支援）。常用的有 "Part"、"Model"、"Folder"、"IntValue"。'],
];
function fmtTime() { const d = new Date(); return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0'); }
function out(kind, text, extra) {
  if (kind === 'error') { S.errCount++; $('#errCnt').textContent = S.errCount; $('#errCnt').style.display = 'inline'; }
  if (lastOut && lastOut.kind === kind && lastOut.text === text && kind !== 'stack') {
    lastOut.n++;
    let r = lastOut.el.querySelector('.rep');
    if (!r) { r = document.createElement('span'); r.className = 'rep'; lastOut.el.prepend(r); }
    r.textContent = '×' + lastOut.n;
    return;
  }
  const el = document.createElement('div');
  el.className = 'ol ' + kind;
  if ($('#chkTime').checked) { const ts = document.createElement('span'); ts.className = 'ts'; ts.textContent = fmtTime(); el.appendChild(ts); }
  const body = document.createElement('span');
  body.textContent = text;
  el.appendChild(body);
  if (kind === 'error') {
    for (const [re, f] of HINTS) { const m = re.exec(text); if (m) { const h = document.createElement('span'); h.className = 'hint'; h.textContent = f(m); body.appendChild(h); break; } }
  }
  if (extra && extra.scriptId && extra.line) {
    el.classList.add('link');
    el.title = '點一下跳到這一行';
    el.onclick = () => gotoLine(extra.scriptId, extra.line, kind === 'error');
  }
  if (kind === 'error' && extra && extra.scriptId && extra.line) markError(extra.scriptId, extra.line, text);
  const stick = outEl.scrollTop + outEl.clientHeight >= outEl.scrollHeight - 30;
  outEl.appendChild(el);
  while (outEl.childElementCount > 2000) outEl.firstChild.remove();
  if (stick) outEl.scrollTop = outEl.scrollHeight;
  lastOut = { kind, text, el, n: 1 };
}
function sys(text) { out('sys', text); }
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => t.style.display = 'none', 2200); }

// ===================================================================
// 程式編輯器
// ===================================================================
const KW = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while', 'continue']);
const BUILTIN = new Set(['print', 'warn', 'error', 'assert', 'pcall', 'xpcall', 'type', 'typeof', 'tostring', 'tonumber', 'pairs', 'ipairs', 'next', 'select', 'unpack', 'rawget', 'rawset', 'rawequal', 'rawlen', 'setmetatable', 'getmetatable', 'require', 'wait', 'delay', 'spawn', 'tick', 'time', 'math', 'string', 'table', 'coroutine', 'os', 'task', 'utf8', 'bit32', 'debug', 'game', 'workspace', 'script', 'Enum', 'shared', '_G']);
const RBXTYPES = new Set(['Instance', 'Vector3', 'Vector2', 'CFrame', 'Color3', 'BrickColor', 'UDim', 'UDim2', 'TweenInfo', 'Ray', 'RaycastParams', 'OverlapParams', 'Random', 'NumberRange', 'NumberSequence', 'ColorSequence', 'DateTime', 'PhysicalProperties']);
const TOKEN_RE = /(--\[(=*)\[[\s\S]*?(?:\]\2\]|$))|(--[^\n]*)|(\[(=*)\[[\s\S]*?(?:\]\5\]|$))|("(?:[^"\\\n]|\\[\s\S])*"?|'(?:[^'\\\n]|\\[\s\S])*'?|`(?:[^`\\]|\\[\s\S])*`?)|(0[xX][0-9a-fA-F_]+|0[bB][01_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)|([A-Za-z_]\w*)|(\s+)|([\s\S])/g;
function highlight(src) {
  let html = '', prev = '', prevSig = '';
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(src))) {
    const t = m[0];
    let cls = '';
    if (m[1] || m[3]) cls = 't-com';
    else if (m[4] || m[6]) cls = 't-str';
    else if (m[7]) cls = 't-num';
    else if (m[8]) {
      if (t === 'true' || t === 'false' || t === 'nil') cls = 't-bool';
      else if (KW.has(t)) cls = t === 'continue' && prevSig !== '' && !/[\n;]|then|do|else|end/.test(prevSig) ? '' : 't-kw';
      else if (t === 'self') cls = 't-self';
      else if (prevSig === '.') cls = 't-prop';
      else if (prevSig === ':' || prevSig === 'function') cls = 't-fn';
      else if (RBXTYPES.has(t)) cls = 't-rb';
      else if (BUILTIN.has(t)) cls = 't-bi';
      else if (src[m.index + t.length] === '(') cls = 't-fn';
    } else if (m[10]) cls = 't-op';
    html += cls ? `<span class="${cls}">${esc(t)}</span>` : esc(t);
    if (!m[9] && !m[1] && !m[3]) prevSig = t;
    prev = t;
  }
  return html + '\n';
}

let charW = 8.4, lineH = 20;
function measure() {
  const s = document.createElement('span');
  s.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:var(--fs)/var(--lh) var(--mono)';
  s.textContent = 'x'.repeat(100);
  document.body.appendChild(s);
  charW = s.getBoundingClientRect().width / 100 || 8.4;
  lineH = parseFloat(getComputedStyle(s).lineHeight) || 20;
  s.remove();
}
function visCol(line, idx) { let c = 0; for (let i = 0; i < idx; i++) c = line[i] === '\t' ? (Math.floor(c / 4) + 1) * 4 : c + 1; return c; }
function idxFromVis(line, vc) { let c = 0; for (let i = 0; i < line.length; i++) { const n = line[i] === '\t' ? (Math.floor(c / 4) + 1) * 4 : c + 1; if (vc < (c + n) / 2 + 0.0001 && vc < n) return i; c = n; if (c > vc) return i + 1; } return line.length; }

class Editor {
  constructor(script) {
    this.s = script;
    const root = this.root = document.createElement('div');
    root.className = 'ed';
    root.innerHTML = `<div class="ed-inner"><div class="ed-gutter"></div><div class="ed-code"><div class="ed-layer"></div><pre class="ed-hl"></pre><textarea class="ed-ta" spellcheck="false" wrap="off" autocapitalize="off" autocomplete="off" autocorrect="off"></textarea></div></div>`;
    $('#edhost').appendChild(root);
    this.gut = $('.ed-gutter', root); this.hl = $('.ed-hl', root); this.ta = $('.ed-ta', root); this.layer = $('.ed-layer', root);
    this.ta.value = script.source;
    this.lines = 0; this.cur = 0; this.errLine = 0; this.errMsg = '';
    this.render();
    this.ta.addEventListener('input', () => this.onInput());
    this.ta.addEventListener('keydown', (e) => this.onKey(e));
    this.ta.addEventListener('keyup', (e) => { if (!['ArrowUp', 'ArrowDown'].includes(e.key) || !AC.open) this.updatePos(); });
    this.ta.addEventListener('click', () => { AC.close(); this.updatePos(); });
    this.ta.addEventListener('scroll', () => { this.ta.scrollTop = 0; this.ta.scrollLeft = 0; });
    this.ta.addEventListener('mousemove', (e) => hoverTip(this, e));
    this.ta.addEventListener('mouseleave', () => hideTip());
    this.ta.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== this.ta) AC.close(); }, 150));
    this.gut.addEventListener('mousedown', (e) => {
      const gl = e.target.closest('.gl');
      if (!gl) return;
      e.preventDefault();
      toggleBp(this.s.id, +gl.dataset.n);
    });
  }
  get value() { return this.ta.value; }
  set value(v) { this.ta.value = v; this.onInput(true); }
  onInput(silent) {
    this.s.source = this.ta.value;
    this.render();
    saveSoon();
    if (!silent) { AC.update(this); markClean(this.s.id); }
    clearTimeout(this.synT);
    this.synT = setTimeout(() => checkSyntax(this), 250);
    this.updatePos();
  }
  render() {
    const v = this.ta.value;
    this.hl.innerHTML = highlight(v);
    const n = v.split('\n').length;
    const lines = v.split('\n');
    let maxc = 0;
    for (const l of lines) maxc = Math.max(maxc, visCol(l, l.length));
    this.ta.style.width = Math.max(maxc * charW + 80, 200) + 'px';
    this.ta.style.height = (n * lineH + 4) + 'px';
    this.hl.style.minWidth = this.ta.style.width;
    if (n !== this.lines) { this.lines = n; this.renderGutter(); }
    this.renderLayer();
  }
  renderGutter() {
    const bps = new Set(this.s.bps || []);
    let h = '';
    for (let i = 1; i <= this.lines; i++) h += `<div class="gl${bps.has(i) ? ' bp' : ''}${i === this.cur ? ' cur' : ''}${i === this.errLine ? ' errl' : ''}" data-n="${i}">${i}</div>`;
    this.gut.innerHTML = h;
  }
  renderLayer() {
    let h = '';
    if (this.errLine) h += `<div class="err" style="top:${(this.errLine - 1) * lineH}px"></div>`;
    if (this.cur) h += `<div class="cur" style="top:${(this.cur - 1) * lineH}px"></div>`;
    this.layer.innerHTML = h;
  }
  setCur(line) { this.cur = line || 0; this.renderGutter(); this.renderLayer(); }
  setErr(line, msg) { this.errLine = line || 0; this.errMsg = msg || ''; this.renderGutter(); this.renderLayer(); }
  lineCol() {
    const v = this.ta.value, p = this.ta.selectionStart;
    const before = v.slice(0, p);
    const line = before.split('\n').length;
    const ls = before.lastIndexOf('\n') + 1;
    return { line, col: p - ls, vcol: visCol(v.slice(ls, p), p - ls), lineStart: ls };
  }
  updatePos() { if (S.active !== this.s.id) return; const lc = this.lineCol(); $('#pos').textContent = `行 ${lc.line}，欄 ${lc.col + 1}`; }
  reveal(line) {
    const top = (line - 1) * lineH;
    const r = this.root;
    if (top < r.scrollTop + 20 || top > r.scrollTop + r.clientHeight - 60) r.scrollTop = Math.max(0, top - r.clientHeight / 3);
  }
  gotoLine(line) {
    const v = this.ta.value;
    let idx = 0;
    for (let i = 1; i < line && idx >= 0; i++) idx = v.indexOf('\n', idx) + 1;
    this.ta.focus({ preventScroll: true });
    this.ta.setSelectionRange(idx, idx);
    this.reveal(line);
    this.updatePos();
  }
  replaceRange(a, b, text, selA, selB) {
    this.ta.focus();
    this.ta.setSelectionRange(a, b);
    if (!document.execCommand('insertText', false, text)) {
      this.ta.setRangeText(text, a, b, 'end');
      this.onInput();
    }
    if (selA !== undefined) this.ta.setSelectionRange(selA, selB === undefined ? selA : selB);
  }
  onKey(e) {
    const ta = this.ta, v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
    if (AC.open && AC.key(e, this)) return;
    if ((e.ctrlKey || e.metaKey) && e.key === ' ') { e.preventDefault(); AC.update(this, true); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); this.toggleComment(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveNow(); toast('已存檔（存在這個瀏覽器）'); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      const ls = v.lastIndexOf('\n', a - 1) + 1;
      if (a === b && !e.shiftKey) { this.replaceRange(a, b, '\t'); return; }
      const le = v.indexOf('\n', b - (b > a && v[b - 1] === '\n' ? 1 : 0));
      const end = le < 0 ? v.length : le;
      const block = v.slice(ls, end);
      const nb = e.shiftKey ? block.replace(/^(\t| {1,4})/gm, '') : block.replace(/^/gm, '\t');
      this.replaceRange(ls, end, nb, ls, ls + nb.length);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const ls = v.lastIndexOf('\n', a - 1) + 1;
      const line = v.slice(ls, a);
      const indent = /^[\t ]*/.exec(line)[0];
      const t = line.replace(/--.*$/, '').trim();
      const opens = /(\bthen|\bdo|\belse|\brepeat|\bfunction\b[^)]*\([^)]*\)[^)]*|[{(\[])$/.test(t) || /^(local\s+)?function\b.*\)$/.test(t) || /=\s*function\s*\(.*\)$/.test(t) || /\bfunction\s*\([^)]*\)$/.test(t);
      let ins = '\n' + indent + (opens ? '\t' : '');
      let caret = a + ins.length;
      if (opens && !/^[\t ]*$/.test(v.slice(a, v.indexOf('\n', a) < 0 ? v.length : v.indexOf('\n', a)))) {
        // 游標後面還有字：只縮排
      } else if (opens && /(then|do|\))$/.test(t) && needsEnd(v.slice(0, a) + '\n' + v.slice(a))) {
        const closer = /\($/.test(t) && !/function/.test(t) ? '' : 'end';
        const tail = /\bfunction\b/.test(t) && /\(\s*function|\w\s*\(.*function/.test(t) && !/^(local\s+)?function/.test(t) ? 'end)' : closer;
        if (tail) ins += '\n' + indent + tail;
      } else if (opens && /[{(\[]$/.test(t)) {
        const cl = { '{': '}', '(': ')', '[': ']' }[t.slice(-1)];
        if (v[a] === cl) ins += '\n' + indent;
      }
      this.replaceRange(a, b, ins, caret);
      return;
    }
    const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" };
    if (pairs[e.key] && !e.ctrlKey && !e.metaKey) {
      const nx = v[b] || '';
      if ((e.key === '"' || e.key === "'") && v[a] === e.key && a === b) { e.preventDefault(); ta.setSelectionRange(a + 1, a + 1); return; }
      if (a !== b) { e.preventDefault(); const sel = v.slice(a, b); this.replaceRange(a, b, e.key + sel + pairs[e.key], a + 1, b + 1); return; }
      if (/[\s)\]},;]|^$/.test(nx) && !((e.key === '"' || e.key === "'") && /\w/.test(v[a - 1] || ''))) { e.preventDefault(); this.replaceRange(a, b, e.key + pairs[e.key], a + 1); return; }
    }
    if ((e.key === ')' || e.key === ']' || e.key === '}') && v[a] === e.key && a === b) { e.preventDefault(); ta.setSelectionRange(a + 1, a + 1); return; }
    if (e.key === 'Backspace' && a === b && a > 0 && pairs[v[a - 1]] === v[a] && v[a] !== undefined) { e.preventDefault(); this.replaceRange(a - 1, a + 1, '', a - 1); return; }
    if (e.key === 'Escape') { AC.close(); }
  }
  toggleComment() {
    const v = this.ta.value, a = this.ta.selectionStart, b = this.ta.selectionEnd;
    const ls = v.lastIndexOf('\n', a - 1) + 1;
    let le = v.indexOf('\n', b - (b > a && v[b - 1] === '\n' ? 1 : 0)); if (le < 0) le = v.length;
    const block = v.slice(ls, le);
    const lines = block.split('\n');
    const all = lines.filter(l => l.trim()).every(l => /^\s*--/.test(l));
    const nb = lines.map(l => all ? l.replace(/^(\s*)-- ?/, '$1') : (l.trim() ? l.replace(/^(\s*)/, '$1-- ') : l)).join('\n');
    this.replaceRange(ls, le, nb, ls, ls + nb.length);
  }
}
function needsEnd(text) {
  // 粗略計算 block 開關數量，判斷要不要自動補 end
  const src = text.replace(/--\[(=*)\[[\s\S]*?\]\1\]|--[^\n]*|\[(=*)\[[\s\S]*?\]\2\]|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, ' ');
  let depth = 0;
  const re = /\b(function|if|do|repeat|end|until)\b/g;
  let m;
  while ((m = re.exec(src))) {
    const w = m[1];
    if (w === 'function' || w === 'if' || w === 'do' || w === 'repeat') depth++;
    else depth--;
  }
  return depth > 0;
}
function checkSyntax(ed) {
  try {
    Luau.parse(ed.ta.value, ed.s.name);
    if (ed.errLine && ed.synErr) ed.setErr(0);
    ed.synErr = null;
  } catch (e) {
    if (e.isSyntax) { ed.synErr = { line: e.luaLine, msg: e.message }; ed.setErr(e.luaLine, e.message); }
  }
  if (S.active === ed.s.id) updateSynStatus(ed);
  renderTabs();
}
function updateSynStatus(ed) {
  const el = $('#syn');
  if (ed.synErr) { el.className = 'syn bad'; el.textContent = `✗ 第 ${ed.synErr.line} 行：${ed.synErr.msg}`; el.onclick = () => ed.gotoLine(ed.synErr.line); }
  else { el.className = 'syn ok'; el.textContent = '✓ 語法正確'; el.onclick = null; }
  $('#kind').textContent = `${ed.s.type} · ${ed.s.parent}`;
}
function markError(scriptId, line, msg) { const ed = S.editors.get(scriptId); if (ed) { ed.setErr(line, msg); ed.runErr = true; renderTabs(); } }
function markClean(scriptId) { const ed = S.editors.get(scriptId); if (ed && ed.runErr) { ed.runErr = false; if (!ed.synErr) ed.setErr(0); renderTabs(); } }

// ---- 自動完成 ----
const MEMBERS = {
  common: ['Name', 'Parent', 'ClassName', 'Destroy', 'Clone', 'FindFirstChild', 'WaitForChild', 'GetChildren', 'GetDescendants', 'IsA', 'FindFirstChildOfClass', 'FindFirstAncestor', 'GetAttribute', 'SetAttribute', 'GetPropertyChangedSignal', 'ClearAllChildren', 'GetFullName', 'Changed', 'ChildAdded', 'ChildRemoved', 'Destroying'],
  part: ['Position', 'Size', 'CFrame', 'Color', 'BrickColor', 'Anchored', 'CanCollide', 'CanTouch', 'Transparency', 'Material', 'Shape', 'Orientation', 'Reflectance', 'Touched', 'TouchEnded', 'AssemblyLinearVelocity', 'ApplyImpulse', 'GetTouchingParts', 'GetMass', 'PivotTo', 'GetPivot'],
  humanoid: ['Health', 'MaxHealth', 'WalkSpeed', 'JumpPower', 'JumpHeight', 'TakeDamage', 'MoveTo', 'Move', 'Died', 'HealthChanged', 'Jump', 'MoveDirection', 'Running', 'Jumping'],
  player: ['Character', 'CharacterAdded', 'UserId', 'DisplayName', 'LoadCharacter', 'GetMouse', 'Backpack', 'PlayerGui', 'Kick'],
  service: ['GetService', 'LocalPlayer', 'PlayerAdded', 'GetPlayers', 'Heartbeat', 'RenderStepped', 'Stepped', 'Create', 'InputBegan', 'InputEnded', 'IsKeyDown', 'AddItem', 'Raycast', 'Gravity', 'CurrentCamera', 'ClockTime'],
  gui: ['Text', 'TextColor3', 'TextSize', 'TextScaled', 'BackgroundColor3', 'BackgroundTransparency', 'Visible', 'MouseButton1Click', 'Activated', 'Enabled', 'ZIndex', 'Font', 'TextXAlignment'],
  signal: ['Connect', 'Once', 'Wait'],
  vec: ['X', 'Y', 'Z', 'Magnitude', 'Unit', 'Lerp', 'Dot', 'Cross', 'LookVector', 'RightVector', 'UpVector', 'Position', 'Inverse', 'R', 'G', 'B'],
};
const ALL_MEMBERS = [...new Set(Object.values(MEMBERS).flat())].sort();
const SERVICES = ['Players', 'Workspace', 'RunService', 'TweenService', 'UserInputService', 'ReplicatedStorage', 'ServerScriptService', 'ServerStorage', 'Lighting', 'Debris', 'StarterGui', 'ContextActionService', 'CollectionService', 'HttpService', 'DataStoreService', 'SoundService', 'Teams'];
const SNIPPETS = {
  'for': 'for i = 1, 10 do\n\t\nend', 'fori': 'for i, v in ipairs() do\n\t\nend', 'forp': 'for k, v in pairs() do\n\t\nend',
  'function': 'function name()\n\t\nend', 'if': 'if  then\n\t\nend', 'while': 'while true do\n\ttask.wait()\nend',
};
const AC = {
  el: $('#ac'), open: false, items: [], idx: 0, ed: null, start: 0,
  update(ed, force) {
    const v = ed.ta.value, p = ed.ta.selectionStart;
    if (p !== ed.ta.selectionEnd) return this.close();
    const before = v.slice(0, p);
    const m = /([A-Za-z_][\w]*)?$/.exec(before);
    const word = m[1] || '';
    const pre = before.slice(0, before.length - word.length);
    const ch = pre.slice(-1);
    const inStr = /(["'])(?:(?!\1)[^\\\n]|\\.)*$/.exec(pre.slice(pre.lastIndexOf('\n') + 1));
    if (inStr && !/GetService\(\s*["']$/.test(pre)) return this.close();
    if (/--[^\n]*$/.test(pre.slice(pre.lastIndexOf('\n') + 1))) return this.close();
    let cands = [];
    if (/GetService\(\s*["']$/.test(pre)) cands = SERVICES.map(n => [n, '服務']);
    else if (ch === '.' || ch === ':') {
      const objM = /([A-Za-z_][\w.]*)[.:]$/.exec(pre);
      const obj = objM ? objM[1] : '';
      cands = memberCands(obj, ch);
      if (!word && !force && !cands.length) return this.close();
    } else {
      if (!force && word.length < 2) return this.close();
      const words = new Set();
      for (const w of v.match(/[A-Za-z_]\w{2,}/g) || []) if (w !== word) words.add(w);
      cands = [...[...KW].map(k => [k, '關鍵字']), ...[...BUILTIN].map(k => [k, '內建']), ...[...RBXTYPES].map(k => [k, 'Roblox']), ...[...words].filter(w => !KW.has(w) && !BUILTIN.has(w) && !RBXTYPES.has(w)).map(w => [w, '']), ...Object.keys(SNIPPETS).map(k => [k + '…', '範本'])];
    }
    const lw = word.toLowerCase();
    let list = cands.filter(([n]) => n.toLowerCase().startsWith(lw) && n !== word);
    if (lw.length >= 2) list = list.concat(cands.filter(([n]) => !n.toLowerCase().startsWith(lw) && n.toLowerCase().includes(lw)));
    const seen = new Set();
    list = list.filter(([n]) => !seen.has(n) && seen.add(n)).slice(0, 10);
    if (!list.length) return this.close();
    this.items = list; this.idx = 0; this.ed = ed; this.start = p - word.length; this.open = true;
    this.render();
    const lc = ed.lineCol();
    const host = $('#edhost').getBoundingClientRect(), gr = ed.gut.getBoundingClientRect();
    const x = gr.right - host.left + 10 + lc.vcol * charW - ed.root.scrollLeft + (ed.root.scrollLeft ? gr.width * 0 : 0);
    const y = 6 + lc.line * lineH - ed.root.scrollTop + 2;
    this.el.style.left = Math.min(Math.max(0, x - word.length * charW), host.width - 240) + 'px';
    this.el.style.top = (y + 220 > host.height ? Math.max(0, y - lineH - 4 - list.length * 25) : y) + 'px';
  },
  render() {
    this.el.innerHTML = this.items.map(([n, k], i) => `<div class="${i === this.idx ? 'on' : ''}" data-i="${i}"><span>${esc(n)}</span><small>${esc(k)}</small></div>`).join('');
    this.el.style.display = 'block';
    $$('div', this.el).forEach(d => d.onmousedown = (e) => { e.preventDefault(); this.idx = +d.dataset.i; this.accept(); });
  },
  key(e, ed) {
    if (e.key === 'ArrowDown') { e.preventDefault(); this.idx = (this.idx + 1) % this.items.length; this.render(); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); this.idx = (this.idx - 1 + this.items.length) % this.items.length; this.render(); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); this.accept(); return true; }
    if (e.key === 'Escape') { e.preventDefault(); this.close(); return true; }
    return false;
  },
  accept() {
    const ed = this.ed, [n] = this.items[this.idx];
    const p = ed.ta.selectionStart;
    this.close();
    if (n.endsWith('…')) {
      const snip = SNIPPETS[n.slice(0, -1)];
      const ls = ed.ta.value.lastIndexOf('\n', this.start - 1) + 1;
      const indent = /^[\t ]*/.exec(ed.ta.value.slice(ls))[0];
      const text = snip.replace(/\n/g, '\n' + indent);
      const firstGap = text.indexOf('\n\t') >= 0 && /if|while/.test(n) ? text.indexOf('  ') + 1 : text.indexOf('\n' + indent + '\t') + indent.length + 2;
      ed.replaceRange(this.start, p, text, this.start + (n.startsWith('if') ? 3 : n.startsWith('fori') ? text.indexOf('()') + 1 : n.startsWith('forp') ? text.indexOf('()') + 1 : firstGap));
      return;
    }
    ed.replaceRange(this.start, p, n);
  },
  close() { this.open = false; this.el.style.display = 'none'; },
};
function memberCands(obj, sep) {
  const base = obj.split('.')[0], last = obj.split('.').pop();
  const G = (S.rt || S.preview).I.G;
  if (base === 'Enum') {
    const parts = obj.split('.');
    if (parts.length === 1) return Object.keys(ENUMS).map(n => [n, 'Enum']);
    if (parts.length === 2 && ENUMS[parts[1]]) return ENUMS[parts[1]].list.map(it => [it.Name, parts[1]]);
    return [];
  }
  const libv = obj.indexOf('.') < 0 ? G.get(obj) : null;
  if (libv instanceof LuaTable && sep === '.') return libv.keyList().filter(k => typeof k === 'string').sort().map(k => [k, obj]);
  if (sep === ':' && /(Added|Removed|Removing|Changed|Touched|Ended|Began|Died|Heartbeat|Stepped|Click|Activated|Event|Completed|Triggered|Signal\(.*\))$/.test(last)) return MEMBERS.signal.map(n => [n, '事件']);
  const cls = inferClass(obj);
  if (cls === 'Vector3' || cls === 'CFrame' || cls === 'Color3') return MEMBERS.vec.map(n => [n, cls]);
  const cm = cls && Rbx.classMembers(cls);
  if (cm) {
    if (sep === ':') return cm.methods.sort().map(n => [n, cls]);
    // 編輯模式下的實際子物件(例如 game.Workspace.Baseplate)
    let kids = [];
    try { const inst = resolveInst(obj); if (inst) kids = inst.children.map(c => [c.p.Name, c.ClassName]); } catch (e) { /* 推不出來就算了 */ }
    return [...cm.props.sort().map(n => [n, cls]), ...cm.events.sort().map(n => [n, '事件']), ...kids];
  }
  if (/Humanoid$/i.test(last)) return [...MEMBERS.humanoid, ...MEMBERS.common].map(n => [n, 'Humanoid']);
  if (/player$/i.test(last) || last === 'LocalPlayer') return [...MEMBERS.player, ...MEMBERS.common].map(n => [n, 'Player']);
  if (/(part|brick|block|lava|coin|platform|ball|door|button|base|plate)\w*$/i.test(last)) return [...MEMBERS.part, ...MEMBERS.common].map(n => [n, 'Part']);
  if (/(label|button|frame|gui|text)\w*$/i.test(last)) return [...MEMBERS.gui, ...MEMBERS.common].map(n => [n, 'GUI']);
  if (/(pos|position|vec|cf|cframe|dir|offset|color|size)\w*$/i.test(last)) return MEMBERS.vec.map(n => [n, '']);
  if (base === 'game' || base === 'workspace') return [...MEMBERS.service, ...MEMBERS.common].map(n => [n, '']);
  return ALL_MEMBERS.map(n => [n, '']);
}

// 從程式碼猜某個變數/運算式是哪個 Roblox 類別(給自動完成用)
const NAME_CLASS = [
  [/^(player|plr|localplayer|LocalPlayer)$/i, 'Player'], [/^(char|character)$/i, 'Model'], [/^(hum|humanoid)$/i, 'Humanoid'],
  [/^(hrp|root|rootpart|HumanoidRootPart|Head|Torso)$/i, 'Part'], [/^(input|inputobject)$/i, 'InputObject'], [/^(gui|screengui)$/i, 'ScreenGui'],
  [/label$/i, 'TextLabel'], [/button$/i, 'TextButton'], [/frame$/i, 'Frame'], [/tween$/i, 'Tween'], [/^(mouse)$/i, 'Mouse'], [/^(cam|camera|CurrentCamera)$/i, 'Camera'],
  [/(part|brick|block|lava|coin|platform|ball|door|floor|step|wall|spawn)\w*$/i, 'Part'], [/^(model|tower|car)$/i, 'Model'], [/^(folder|leaderstats)$/i, 'Folder'],
  [/^(Position|Size|Velocity|LookVector|RightVector|UpVector|AssemblyLinearVelocity|Orientation|Unit|pos|dir|offset)$/i, 'Vector3'], [/^(CFrame|cf)$/i, 'CFrame'], [/^(Color|Color3|BackgroundColor3|TextColor3)$/, 'Color3'],
  [/^(Character)$/, 'Model'], [/^(PlayerGui)$/, 'PlayerGui'], [/^(Backpack)$/, 'Backpack'], [/^(Parent)$/, 'Instance'], [/^(PrimaryPart)$/, 'Part'],
];
function guessByName(n) { for (const [re, c] of NAME_CLASS) if (re.test(n)) return c; return null; }
function inferClass(expr) {
  const ed = S.editors.get(S.active);
  const doc = ed ? ed.ta.value : '';
  const segs = expr.split('.');
  let cls = null;
  const first = segs[0];
  if (first === 'game' || first === 'Game') cls = 'DataModel';
  else if (first === 'workspace' || first === 'Workspace') cls = 'Workspace';
  else if (first === 'script') cls = 'Script';
  else {
    const re = new RegExp(`(?:local\\s+)?\\b${first.replace(/[^\w]/g, '')}\\b\\s*(?::\\s*[\\w.]+)?\\s*=\\s*([^\\n]+)`, 'g');
    let m, rhs = null;
    while ((m = re.exec(doc))) rhs = m[1];
    if (rhs) {
      let mm;
      if ((mm = /GetService\(\s*["'](\w+)["']\s*\)\s*$/.exec(rhs.trim()))) cls = mm[1];
      else if ((mm = /Instance\.new\(\s*["'](\w+)["']/.exec(rhs))) cls = mm[1];
      else if ((mm = /(?:WaitForChild|FindFirstChild)\(\s*["'](\w+)["']/.exec(rhs))) cls = Rbx.CLASSES[mm[1]] ? mm[1] : guessByName(mm[1]);
      else if (/LocalPlayer\s*$/.test(rhs)) cls = 'Player';
      else if (/\.Character\b|CharacterAdded:Wait\(\)/.test(rhs)) cls = 'Model';
      else if (/:GetMouse\(\)/.test(rhs)) cls = 'Mouse';
      else if (/TweenService:Create\(|:Create\(/.test(rhs)) cls = 'Tween';
      else if ((mm = /^game\.(\w+)\s*$/.exec(rhs.trim())) && Rbx.CLASSES[mm[1]]) cls = mm[1];
      else if (/^workspace\s*$/i.test(rhs.trim())) cls = 'Workspace';
      else if (/Vector3\.new|\.Position\b|LookVector/.test(rhs)) cls = 'Vector3';
      else if (/CFrame\.new|CFrame\.Angles|\.CFrame\b/.test(rhs)) cls = 'CFrame';
      else if (/Color3\./.test(rhs)) cls = 'Color3';
    }
    if (!cls) cls = guessByName(first);
  }
  for (const seg of segs.slice(1)) {
    const c = Rbx.CLASSES[seg];
    if (c && c.service) { cls = seg; continue; }
    if (seg === 'LocalPlayer') { cls = 'Player'; continue; }
    if (seg === 'Humanoid') { cls = 'Humanoid'; continue; }
    cls = guessByName(seg) || 'Instance';
  }
  return cls;
}
function resolveInst(expr) {
  const rt = worldRt();
  const segs = expr.split('.');
  let cur = segs[0] === 'game' ? rt.game : /^workspace$/i.test(segs[0]) ? rt.workspace : null;
  if (!cur) return null;
  for (const s of segs.slice(1)) { cur = cur.findChild(s); if (!cur) return null; }
  return cur;
}

// ---- 暫停時：滑鼠移到變數上顯示值 ----
const tipEl = $('#tip');
function hideTip() { tipEl.style.display = 'none'; }
function hoverTip(ed, e) {
  if (!S.paused) return hideTip();
  const r = ed.ta.getBoundingClientRect();
  const line = Math.floor((e.clientY - r.top) / lineH);
  const lines = ed.ta.value.split('\n');
  if (line < 0 || line >= lines.length) return hideTip();
  const L = lines[line];
  const i = idxFromVis(L, (e.clientX - r.left) / charW);
  if (!/[\w]/.test(L[i] || '')) return hideTip();
  let a = i, b = i;
  while (a > 0 && /[\w.]/.test(L[a - 1])) a--;
  while (b < L.length && /\w/.test(L[b])) b++;
  const expr = L.slice(a, b).replace(/^\.+/, '');
  if (!expr || KW.has(expr) || /^\d/.test(expr)) return hideTip();
  const res = evalWatch(expr, true);
  if (res === null) return hideTip();
  tipEl.textContent = `${expr} = ${res}`;
  tipEl.style.display = 'block';
  tipEl.style.left = Math.min(e.clientX + 12, innerWidth - 300) + 'px';
  tipEl.style.top = (e.clientY + 16) + 'px';
}

// ===================================================================
// 分頁
// ===================================================================
function openScript(id, focus = true) {
  const s = scriptById(id);
  if (!s) return;
  if (!S.open.includes(id)) S.open.push(id);
  if (!S.editors.has(id)) S.editors.set(id, new Editor(s));
  S.active = id;
  for (const [k, ed] of S.editors) ed.root.classList.toggle('on', k === id);
  const ed = S.editors.get(id);
  renderTabs();
  checkSyntax(ed);
  ed.updatePos();
  if (focus) ed.ta.focus({ preventScroll: true });
  saveSoon();
}
function closeTab(id) {
  const i = S.open.indexOf(id);
  if (i < 0) return;
  S.open.splice(i, 1);
  const ed = S.editors.get(id);
  if (ed) { ed.root.remove(); S.editors.delete(id); }
  if (S.active === id) { S.active = null; const nx = S.open[Math.min(i, S.open.length - 1)]; if (nx) openScript(nx, false); }
  renderTabs();
  saveSoon();
}
const ICON = { Script: '📜', LocalScript: '📄', ModuleScript: '📦' };
function renderTabs() {
  const t = $('#tabs');
  t.innerHTML = S.open.map(id => {
    const s = scriptById(id);
    if (!s) return '';
    const ed = S.editors.get(id);
    const bad = ed && (ed.synErr || ed.runErr);
    return `<div class="tab${id === S.active ? ' on' : ''}${bad ? ' haserr' : ''}" data-id="${id}" title="${esc(s.parent + '.' + s.name)}"><span class="dot"></span>${ICON[s.type] || '📜'} ${esc(s.name)}<button class="x" data-x="${id}" title="關閉">✕</button></div>`;
  }).join('') || '<div class="empty" style="padding:8px 12px">在左邊檔案總管點兩下腳本來開啟，或按「＋ 新增腳本」</div>';
  $$('.tab', t).forEach(el => {
    el.onclick = (e) => { if (e.target.dataset.x) closeTab(e.target.dataset.x); else openScript(el.dataset.id); };
    el.ondblclick = () => renameScript(el.dataset.id);
    el.onauxclick = (e) => { if (e.button === 1) closeTab(el.dataset.id); };
  });
}
function uniqueName(base) {
  let n = base, i = 1;
  while (project.scripts.some(s => s.name === n)) n = base + (++i);
  return n;
}
function addScript(type, parent, name, source) {
  const s = { id: newId(), name: uniqueName(name || type), type, parent, source: source !== undefined ? source : (type === 'ModuleScript' ? 'local module = {}\n\nreturn module\n' : 'print("Hello world!")\n'), bps: [] };
  project.scripts.push(s);
  saveSoon();
  refreshPreview();
  openScript(s.id);
  return s;
}
function renameScript(id) {
  const s = scriptById(id);
  if (!s) return;
  const n = prompt('腳本新名字：', s.name);
  if (!n || !n.trim() || n === s.name) return;
  const nn = n.trim().replace(/[.\s]+/g, '_');
  if (project.scripts.some(x => x.name === nn && x.id !== id)) { toast('已經有同名的腳本了'); return; }
  s.name = nn;
  saveSoon(); renderTabs(); refreshPreview();
}
function deleteScript(id) {
  const s = scriptById(id);
  if (!s || !confirm(`確定刪除腳本「${s.name}」？（刪除後無法復原，建議先「檔案 → 匯出專案」備份）`)) return;
  closeTab(id);
  project.scripts = project.scripts.filter(x => x.id !== id);
  saveSoon(); refreshPreview();
}

// ===================================================================
// 中斷點
// ===================================================================
function toggleBp(id, line) {
  const s = scriptById(id);
  if (!s) return;
  s.bps = s.bps || [];
  const i = s.bps.indexOf(line);
  if (i >= 0) s.bps.splice(i, 1); else s.bps.push(line);
  s.bps.sort((a, b) => a - b);
  const ed = S.editors.get(id);
  if (ed) ed.renderGutter();
  if (S.rt) S.rt.setBreakpoints(id, s.bps);
  renderBps();
  saveSoon();
}
function renderBps() {
  const list = [];
  for (const s of project.scripts) for (const l of s.bps || []) list.push([s, l]);
  const el = $('#bps');
  if (!list.length) { el.innerHTML = '<div class="empty">還沒有中斷點。在程式碼行號左邊點一下就會出現紅點 🔴</div>'; return; }
  el.innerHTML = list.map(([s, l]) => {
    const line = (s.source.split('\n')[l - 1] || '').trim();
    return `<div class="frame" data-id="${s.id}" data-l="${l}"><span style="color:#e5484d">●</span><b>${esc(s.name)}</b>:${l}<small>${esc(line.slice(0, 60))}</small><span style="flex:1"></span><button class="ibtn" data-del>✕</button></div>`;
  }).join('') + '<div class="watchadd"><button class="tb" id="bpClear">清除全部中斷點</button></div>';
  $$('.frame', el).forEach(f => f.onclick = (e) => { if (e.target.dataset.del !== undefined) toggleBp(f.dataset.id, +f.dataset.l); else gotoLine(f.dataset.id, +f.dataset.l); });
  $('#bpClear').onclick = () => { for (const s of project.scripts) { s.bps = []; if (S.rt) S.rt.setBreakpoints(s.id, []); const ed = S.editors.get(s.id); if (ed) ed.renderGutter(); } renderBps(); saveSoon(); };
}
function gotoLine(id, line, isErr) {
  if (!scriptById(id)) return;
  openScript(id);
  const ed = S.editors.get(id);
  ed.gotoLine(line);
}

// ===================================================================
// 執行 / 除錯
// ===================================================================
function setMode(mode) {
  S.mode = mode;
  const run = mode !== 'edit', paused = mode === 'paused';
  $('#btnRun').hidden = run;
  $('#btnStop').hidden = !run;
  $('#btnPause').disabled = mode !== 'running';
  for (const b of ['#btnCont', '#btnOver', '#btnInto', '#btnOut']) $(b).disabled = !paused;
  const st = $('#state');
  st.className = 'state ' + (mode === 'running' ? 'running' : paused ? 'paused' : '');
  st.textContent = mode === 'running' ? '執行中' : paused ? '已暫停' : '編輯中';
  $('#pauseBanner').style.display = paused ? 'block' : 'none';
  $('#vhint').style.opacity = 1;
  $('#vhint').textContent = mode === 'edit' ? '按 ▶ 執行開始遊戲 · 右鍵拖曳轉視角 · 滾輪縮放' : '點一下畫面後：WASD 移動 · 空白鍵跳 · 右鍵拖曳轉視角';
  if (run) clearTimeout(setMode.t), setMode.t = setTimeout(() => $('#vhint').style.opacity = 0, 5000);
}
function runtimeOpts() {
  return {
    output: (k, t, extra) => out(k, t, extra),
    dataStore: store.get(KEY_DS, {}),
    onDataStore: (d) => store.set(KEY_DS, d),
    onPause: (sig) => onPause(sig),
    screenRay: (x, y) => V.screenRay(x, y),
    worldToScreen: (v) => V.worldToScreen(v),
    guiAbs: (g) => GUI.abs(g),
  };
}
function startRun() {
  if (S.rt) stopRun();
  for (const ed of S.editors.values()) { ed.runErr = false; if (!ed.synErr) ed.setErr(0); ed.setCur(0); }
  S.errCount = 0; $('#errCnt').style.display = 'none';
  const rt = new Runtime(runtimeOpts());
  S.rt = rt;
  rt.I.dbg.breakOnError = $('#chkBreakErr').checked;
  rt.load(project.scripts.map(s => ({ id: s.id, name: s.name, type: s.type, parent: s.parent, source: s.source })));
  for (const s of project.scripts) rt.setBreakpoints(s.id, s.bps || []);
  sys(`▶ 開始執行（${new Date().toLocaleTimeString()}）`);
  setMode('running');
  S.selected = null;
  V.resetScene(rt);
  rt.viewport = { w: V.w, h: V.h };
  rt.start();
  if (!rt.paused) setMode('running');
  $('#view').focus({ preventScroll: true });
  renderExplorer(true);
  renderProps();
}
function stopRun() {
  if (!S.rt) return;
  S.rt.stop();
  S.rt = null; S.paused = null;
  for (const ed of S.editors.values()) ed.setCur(0);
  sys('■ 已停止');
  setMode('edit');
  clearDebug();
  refreshPreview();
  S.selected = null;
  renderProps();
}
function onPause(sig) {
  S.paused = sig;
  setMode('paused');
  S.selFrame = 0;
  const scriptId = S.rt.chunkToScript.get(sig.chunk);
  const why = { breakpoint: '🔴 停在中斷點', step: '👣 單步執行', pause: '⏸ 已暫停', error: '💥 發生錯誤，停在出錯的那一行' }[sig.why] || '⏸';
  sys(`${why}：${sig.chunk} 第 ${sig.line} 行`);
  if (sig.why === 'error' && sig.error) out('error', typeof sig.error.value === 'string' ? sig.error.value : String(sig.error.value), { scriptId, line: sig.line });
  if (scriptId) {
    openScript(scriptId, false);
    const ed = S.editors.get(scriptId);
    for (const e2 of S.editors.values()) if (e2 !== ed) e2.setCur(0);
    ed.setCur(sig.line);
    ed.reveal(sig.line);
  }
  renderDebug();
  showPane('paneVars');
}
function resume(mode) {
  if (!S.rt || !S.paused) return;
  S.paused = null;
  for (const ed of S.editors.values()) ed.setCur(0);
  hideTip();
  setMode('running');
  S.rt.resume(mode);
  clearDebug(true);
}
function clearDebug(keepWatch) {
  $('#vars').innerHTML = '<div class="empty">程式暫停時，這裡會列出當下的變數。<br>在行號左邊點一下設定中斷點 🔴，再按 ▶ 執行。</div>';
  $('#stack').innerHTML = '<div class="empty">暫停時顯示呼叫堆疊（誰呼叫了誰）</div>';
  renderWatches();
}
function pausedFrames() {
  if (!S.paused) return [];
  return [...S.paused.stack].reverse();
}
function renderDebug() {
  const frames = pausedFrames();
  const st = $('#stack');
  st.innerHTML = frames.map((f, i) => `<div class="frame${i === S.selFrame ? ' on' : ''}" data-i="${i}">${i === 0 ? '➜ ' : ''}<b>${esc(f.name === 'main chunk' ? '(主程式)' : f.name)}</b> <small>${esc(f.chunk)} : 第 ${f.line} 行</small></div>`).join('') || '<div class="empty">（沒有堆疊）</div>';
  $$('.frame', st).forEach(el => el.onclick = () => {
    S.selFrame = +el.dataset.i;
    const f = frames[S.selFrame];
    const id = S.rt.chunkToScript.get(f.chunk);
    if (id) { openScript(id, false); const ed = S.editors.get(id); ed.reveal(f.line); }
    renderDebug();
  });
  const f = frames[S.selFrame];
  const vars = $('#vars');
  if (!f) { vars.innerHTML = '<div class="empty">（沒有變數）</div>'; return; }
  const I = S.rt.I;
  const { locals, upvals, env } = I.frameVars(f);
  let h = `<div class="vrow sec">區域變數 Locals（${esc(f.name === 'main chunk' ? '主程式' : f.name)}）</div>`;
  h += locals.length ? locals.map(([k, v]) => varRow(k, v, 0, 'l:' + k)).join('') : '<div class="vrow"><span class="vty">（沒有）</span></div>';
  const ups = upvals.filter(([k]) => k !== 'script' || true);
  if (ups.length) h += `<div class="vrow sec">外層變數 Upvalues</div>` + ups.map(([k, v]) => varRow(k, v, 0, 'u:' + k)).join('');
  const gl = env ? env.keyList().filter(k => typeof k === 'string') : [];
  if (gl.length) h += `<div class="vrow sec">全域變數 Globals（這支腳本）</div>` + gl.map(k => varRow(k, env.get(k), 0, 'g:' + k)).join('');
  vars.innerHTML = h;
  bindVarRows(vars);
  renderWatches();
}
const expandedVars = new Set();
const varRefs = new Map();
let varRefN = 0;
function typeTag(v) { const t = luauTypeof(v); return t === 'Instance' ? v.ClassName : t; }
function varRow(name, v, depth, path) {
  const I = S.rt.I;
  const t = luaType(v);
  const expandable = (t === 'table' && v.keyList().length) || (v instanceof Instance && (v.children.length || true));
  const open = expandable && expandedVars.has(path);
  const id = ++varRefN;
  varRefs.set(id, { v, path });
  let val;
  if (v instanceof Instance) val = `${v.ClassName} "${v.fullName() || v.p.Name}"`;
  else val = I.peekValue(v, 1);
  let h = `<div class="vrow" style="padding-left:${8 + depth * 16}px"><span class="vt" data-ref="${id}">${expandable ? (open ? '▾' : '▸') : ''}</span><span class="vn">${esc(name)}</span><span class="vv">${esc(val)}</span><span class="vty">${esc(typeTag(v))}</span></div>`;
  if (open && depth < 8) {
    if (t === 'table') {
      for (const k of v.keyList().slice(0, 200)) h += varRow(typeof k === 'string' ? k : `[${I.peekValue(k, 0)}]`, v.get(k), depth + 1, path + '/' + String(k));
      if (v.mt) h += varRow('(metatable)', v.mt, depth + 1, path + '/mt');
    } else if (v instanceof Instance) {
      const all = v.cls.all;
      const keys = ['Name', 'ClassName', 'Parent', ...Object.keys(all.virt).filter(k => !['AbsoluteSize', 'AbsolutePosition'].includes(k)), ...Object.keys(all.props)].filter((k, i, a) => a.indexOf(k) === i);
      for (const k of keys) { let pv; try { pv = v.luaIndex(k, I); } catch (e) { continue; } h += varRow(k, pv, depth + 1, path + '/' + k); }
      for (const c of v.children.slice(0, 100)) h += varRow(c.p.Name, c, depth + 1, path + '/c:' + c.p.Name);
    }
  }
  return h;
}
function bindVarRows(root) {
  $$('.vt[data-ref]', root).forEach(el => el.onclick = () => {
    const r = varRefs.get(+el.dataset.ref);
    if (!r) return;
    if (expandedVars.has(r.path)) expandedVars.delete(r.path); else expandedVars.add(r.path);
    renderDebug();
  });
}
function frameForEval() {
  const frames = pausedFrames();
  return frames[S.selFrame] || frames[0];
}
function evalWatch(src, short) {
  const rt = S.rt;
  if (!rt) return short ? null : '（執行時才能計算）';
  const I = rt.I;
  let node;
  try { node = Luau.parseExpr(src); } catch (e) { return short ? null : '語法錯誤：' + e.message; }
  const f = S.paused ? frameForEval() : null;
  const scope = f ? f.scope : (() => { const sc = new Luau.Scope(null, true, I.newEnv()); return sc; })();
  if (!scope) return short ? null : '（無法計算）';
  const prevStack = I.stack;
  if (S.paused) I.stack = S.paused.stack;
  I.noYield++;
  try {
    const g = I.drive((function* () { return node.hc ? yield* I.ev(node, scope) : I.evS(node, scope); })());
    let r = g.next(), n = 0;
    while (!r.done && n++ < 1000) r = g.next();
    if (!r.done) return short ? null : '（太久了）';
    const v = r.value;
    if (short && v === undefined && node.k === 'Name' && !I.lookup(scope, node.name) && I.getGlobal(scope, node.name) === undefined) return null;
    return v instanceof Instance ? `${v.ClassName} "${v.fullName()}"` : I.peekValue(v, 2);
  } catch (e) {
    return short ? null : '錯誤：' + (e.value !== undefined ? I.tostr(e.value) : e.message);
  } finally { I.noYield--; I.stack = prevStack; }
}
function renderWatches() {
  const el = $('#watches');
  el.innerHTML = S.watches.map((w, i) => `<div class="vrow"><span class="vn">${esc(w)}</span><span class="vv">= ${esc(S.rt ? evalWatch(w) : '（執行時顯示）')}</span><button class="vx" data-i="${i}" title="移除">✕</button></div>`).join('') || '<div class="empty">在上面輸入要盯著看的運算式（例如 coins.Value），暫停時會自動計算</div>';
  $$('.vx', el).forEach(b => b.onclick = () => { S.watches.splice(+b.dataset.i, 1); store.set('luauStudio.watches', S.watches); renderWatches(); });
}
function runCommand(src) {
  if (!src.trim()) return;
  out('cmd', '> ' + src);
  cmdHist.unshift(src); cmdHist.length = Math.min(cmdHist.length, 50); cmdPos = -1;
  const rt = S.rt;
  if (!rt) {
    // 沒在執行：用一個臨時環境算算看(不建世界)
    const tmp = new Runtime({ output: (k, t, x) => out(k, t, x) });
    try {
      const fn = compileCmd(tmp.I, src, null);
      const th = tmp.newThread(fn, [], 'CommandBar');
      tmp.queue.push(th); tmp.runQueue(true);
    } catch (e) { out('error', e.message); }
    return;
  }
  const I = rt.I;
  try {
    if (S.paused) {
      const f = frameForEval();
      const fn = compileCmd(I, src, f.scope);
      const prev = I.stack;
      I.stack = S.paused.stack;
      try { const r = I.callSync(fn, []); if (r.length) out('print', r.map(v => I.tostr(v)).join(' ')); }
      catch (e) { out('error', e.value !== undefined ? I.tostr(e.value) : e.message); }
      finally { I.stack = prev; }
      renderDebug();
    } else {
      const fn = compileCmd(I, src, null);
      rt.queue.push(rt.newThread(fn, [], 'CommandBar'));
    }
  } catch (e) { out('error', 'CommandBar:' + (e.luaLine || 1) + ': ' + e.message); }
}
function compileCmd(I, src, scope) {
  let node;
  try { node = Luau.parse('return ' + src, 'CommandBar'); } catch (e) { node = Luau.parse(src, 'CommandBar'); }
  if (scope) return new LuaFunction(node, scope, 'CommandBar');
  const root = new Luau.Scope(null, true, I.newEnv());
  return new LuaFunction(node, root, 'CommandBar');
}
const cmdHist = []; let cmdPos = -1;

// ===================================================================
// 檔案總管 / 屬性
// ===================================================================
const CLS_ICON = {
  Workspace: '🌐', Players: '👥', Player: '👤', Lighting: '💡', ReplicatedStorage: '📦', ReplicatedFirst: '📦', ServerScriptService: '🗄', ServerStorage: '🗃',
  StarterGui: '🖼', StarterPack: '🎒', StarterPlayer: '🧑', StarterPlayerScripts: '📁', StarterCharacterScripts: '📁', Teams: '🚩', SoundService: '🔊', Chat: '💬',
  Part: '🟫', SpawnLocation: '🟩', WedgePart: '📐', MeshPart: '🔷', Model: '🧩', Folder: '📁', Script: '📜', LocalScript: '📄', ModuleScript: '📦', Camera: '🎥',
  Humanoid: '🧍', IntValue: '🔢', NumberValue: '🔢', StringValue: '🔤', BoolValue: '☑', ObjectValue: '🔗', Vector3Value: '🔢', Color3Value: '🎨', CFrameValue: '🔢',
  ScreenGui: '🖥', BillboardGui: '🪧', Frame: '▭', TextLabel: '🏷', TextButton: '🔘', TextBox: '⌨', ImageLabel: '🖼', UICorner: '◜', UIListLayout: '☰',
  Sound: '🔊', PointLight: '💡', SpotLight: '🔦', Decal: '🙂', ClickDetector: '🖱', ProximityPrompt: '💬', RemoteEvent: '📡', RemoteFunction: '📡', BindableEvent: '🔔',
  Explosion: '💥', Fire: '🔥', Tool: '🔧', Backpack: '🎒', PlayerGui: '🖥', PlayerScripts: '📁', Attachment: '📍', WeldConstraint: '🔩', Weld: '🔩', Tween: '〰',
};
function worldRt() { return S.rt || S.preview; }
function refreshPreview() {
  S.preview = new Runtime({ output: () => {} });
  S.preview.load(project.scripts.map(s => ({ id: s.id, name: s.name, type: s.type, parent: s.parent, source: s.source })));
  if (!S.rt) V.resetScene(S.preview);
  renderExplorer(true);
}
function instPath(inst) { const p = []; for (let x = inst; x; x = x.parent) p.unshift(x.p.Name); return p.join('.'); }
let treeSig = '';
function renderExplorer(force) {
  const rt = worldRt();
  if (!rt) return;
  const tree = $('#tree');
  const rows = [];
  const HIDE = new Set(['Camera']);
  const walk = (inst, depth) => {
    const path = instPath(inst);
    const kids = inst.children.filter(c => !(depth === 0 && ['Chat', 'SoundService', 'Teams', 'ReplicatedFirst', 'StarterPack'].includes(c.ClassName) && !c.children.length));
    const open = S.expanded.has(path);
    rows.push({ inst, depth, path, open, hasKids: kids.length > 0 });
    if (open) for (const c of kids) walk(c, depth + 1);
  };
  for (const c of rt.game.children) walk(c, 0);
  const sig = rows.map(r => r.path + (r.open ? '+' : '') + (r.hasKids ? '*' : '') + r.inst.id).join('|') + '#' + (S.selected && S.selected.id);
  if (!force && sig === treeSig) return;
  treeSig = sig;
  const st = tree.scrollTop;
  tree.innerHTML = rows.map((r, i) => {
    const c = r.inst;
    const isScript = c.scriptId !== undefined;
    const icon = CLS_ICON[c.ClassName] || (c.isA('BasePart') ? '🟫' : c.isA('GuiObject') ? '▭' : '◽');
    let acts = '';
    if (S.mode === 'edit') {
      if (isScript && scriptById(c.scriptId)) acts = `<span class="acts"><button data-act="ren" title="重新命名">✎</button><button data-act="del" title="刪除">🗑</button></span>`;
      else if (['ServerScriptService', 'Workspace', 'ReplicatedStorage', 'ServerStorage', 'StarterPlayerScripts', 'StarterCharacterScripts', 'StarterGui'].includes(c.ClassName)) acts = `<span class="acts"><button data-act="add" title="在這裡新增腳本">＋</button></span>`;
    }
    return `<div class="node${isScript ? ' script' : ''}${S.selected === c ? ' sel' : ''}" data-i="${i}" style="padding-left:${4 + r.depth * 14}px"><span class="tw">${r.hasKids ? (r.open ? '▼' : '▶') : ''}</span><span class="ic">${icon}</span><span class="nm">${esc(c.p.Name)}</span>${c.p.Name !== c.ClassName ? `<span class="cls">${esc(c.ClassName)}</span>` : ''}${acts}</div>`;
  }).join('');
  tree.scrollTop = st;
  $$('.node', tree).forEach(el => {
    const r = rows[+el.dataset.i];
    el.onclick = (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      if (act === 'ren') return renameScript(r.inst.scriptId);
      if (act === 'del') return deleteScript(r.inst.scriptId);
      if (act === 'add') { const cls = r.inst.ClassName; const type = ['StarterPlayerScripts', 'StarterCharacterScripts', 'StarterGui'].includes(cls) ? 'LocalScript' : cls === 'ReplicatedStorage' || cls === 'ServerStorage' ? 'ModuleScript' : 'Script'; return addScript(type, cls); }
      if (e.target.classList.contains('tw')) { toggleExpand(r.path); return; }
      S.selected = r.inst;
      if (r.inst.scriptId !== undefined && scriptById(r.inst.scriptId)) openScript(r.inst.scriptId);
      renderExplorer(true);
      renderProps();
    };
    el.ondblclick = () => { if (r.hasKids) toggleExpand(r.path); };
  });
}
function toggleExpand(path) { if (S.expanded.has(path)) S.expanded.delete(path); else S.expanded.add(path); renderExplorer(true); }
function fmtVal(v) {
  if (v === undefined || v === null) return '';
  if (v instanceof Instance) return v.p.Name;
  if (typeof v === 'number') return Luau.numToStr(Math.round(v * 1000) / 1000);
  if (v instanceof Vector3) return [v.X, v.Y, v.Z].map(x => Luau.numToStr(Math.round(x * 1000) / 1000)).join(', ');
  if (v instanceof CFrame) return [v.x, v.y, v.z].map(x => Luau.numToStr(Math.round(x * 1000) / 1000)).join(', ');
  if (v instanceof Color3) return `[${Math.round(v.R * 255)}, ${Math.round(v.G * 255)}, ${Math.round(v.B * 255)}]`;
  if (v instanceof EnumItem) return v.Name;
  if (v && v.luaToString) return v.luaToString();
  return String(v);
}
let propSig = '';
function renderProps(force = true) {
  const el = $('#props');
  const inst = S.selected;
  if (!inst || inst.destroyed) { if (force) { el.innerHTML = '<div class="empty">在上面點選一個物件</div>'; $('#propCls').textContent = ''; } return; }
  $('#propCls').textContent = inst.ClassName;
  const rt = worldRt();
  const editable = S.mode !== 'edit' || inst.scriptId === undefined;
  const all = inst.cls.all;
  const rows = [];
  if (inst.scriptId !== undefined && scriptById(inst.scriptId)) {
    const s = scriptById(inst.scriptId);
    rows.push(['Name', s.name, 'sname']);
    rows.push(['Type', s.type, 'stype']);
    rows.push(['Parent', s.parent, 'sparent']);
    rows.push(['Lines', s.source.split('\n').length]);
  } else {
    rows.push(['Name', inst.p.Name, 'Name']);
    rows.push(['ClassName', inst.ClassName]);
    rows.push(['Parent', inst.parent ? inst.parent.p.Name : 'nil']);
    const vkeys = Object.keys(all.virt).filter(k => !['AbsoluteSize', 'AbsolutePosition', 'Source', 'Mass', 'AssemblyMass', 'ExtentsSize', 'Velocity', 'Rotation'].includes(k));
    for (const k of vkeys) { try { rows.push([k, all.virt[k].get(inst, rt.I), all.virt[k].set ? k : null]); } catch (e) { /* 有些 virt 需要畫面資訊 */ } }
    for (const k of Object.keys(all.props).sort()) { if (k === 'Name') continue; rows.push([k, inst.p[k], all.readonly.has(k) ? null : k]); }
    if (inst.attrs && inst.attrs.size) { rows.push(['—屬性 Attributes—']); for (const [k, v] of inst.attrs) rows.push([k, v]); }
  }
  const sig = rows.map(r => r[0] + '=' + fmtVal(r[1])).join('|') + inst.id;
  if (!force && sig === propSig) return;
  if (!force && el.contains(document.activeElement) && document.activeElement.tagName !== 'BODY') return;
  propSig = sig;
  el.innerHTML = rows.map((r, i) => {
    if (r.length === 1) return `<div class="prop-sec">${esc(r[0])}</div>`;
    const [k, v, key] = r;
    let cell;
    if (key === 'sname') cell = `<input data-s="name" value="${esc(v)}">`;
    else if (key === 'stype') cell = `<select data-s="type">${['Script', 'LocalScript', 'ModuleScript'].map(t => `<option${t === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
    else if (key === 'sparent') cell = `<select data-s="parent">${PARENTS.map(t => `<option${t === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
    else if (key && editable && S.mode !== 'edit') {
      if (typeof v === 'boolean') cell = `<input type="checkbox" data-k="${esc(key)}"${v ? ' checked' : ''}>`;
      else if (v instanceof Color3) cell = `<input type="color" data-k="${esc(key)}" value="#${v.hex()}">`;
      else if (v instanceof EnumItem) cell = `<select data-k="${esc(key)}">${v.EnumType.list.map(it => `<option${it === v ? ' selected' : ''}>${it.Name}</option>`).join('')}</select>`;
      else if (typeof v === 'number' || typeof v === 'string' || v instanceof Vector3) cell = `<input data-k="${esc(key)}" value="${esc(fmtVal(v))}">`;
      else cell = `<div>${esc(fmtVal(v))}</div>`;
    } else {
      const sw = v instanceof Color3 ? `<span class="sw" style="background:#${v.hex()}"></span>` : '';
      cell = `<div title="${esc(fmtVal(v))}">${sw}${esc(fmtVal(v))}</div>`;
    }
    return `<div class="prop"><span title="${esc(k)}">${esc(k)}</span>${cell}</div>`;
  }).join('');
  $$('[data-s]', el).forEach(inp => inp.onchange = () => {
    const s = scriptById(inst.scriptId);
    const f = inp.dataset.s;
    if (f === 'name') { const nn = inp.value.trim().replace(/[.\s]+/g, '_'); if (!nn || project.scripts.some(x => x.name === nn && x.id !== s.id)) { toast('名字不能空白或重複'); inp.value = s.name; return; } s.name = nn; }
    else s[f] = inp.value;
    if (f === 'type' && s.type === 'LocalScript' && ['ServerScriptService', 'ServerStorage'].includes(s.parent)) { s.parent = 'StarterPlayerScripts'; toast('LocalScript 已移到 StarterPlayerScripts（放在 ServerScriptService 不會執行）'); }
    saveSoon(); renderTabs(); refreshPreview();
    const ni = [...S.preview.scriptMap.values()].find(x => x.scriptId === s.id);
    S.selected = ni || null;
    renderExplorer(true); renderProps();
  });
  $$('[data-k]', el).forEach(inp => inp.onchange = () => {
    const k = inp.dataset.k, cur = inst.luaIndex(k, rt.I);
    let v;
    if (inp.type === 'checkbox') v = inp.checked;
    else if (inp.type === 'color') { const h = inp.value; v = Color3.rgb(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)); }
    else if (cur instanceof EnumItem) v = cur.EnumType.items[inp.value];
    else if (typeof cur === 'number') v = parseFloat(inp.value);
    else if (cur instanceof Vector3) { const n = inp.value.split(/[,\s]+/).map(Number); v = new Vector3(n[0] || 0, n[1] || 0, n[2] || 0); }
    else v = inp.value;
    try { inst.luaNewIndex(k, v, rt.I); } catch (e) { toast(e.message.replace(/^[^:]*:\d+: /, '')); }
    renderProps();
  });
}

// ===================================================================
// 3D 畫面
// ===================================================================
const V = (() => {
  const host = $('#view');
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 5000);
  const hemi = new THREE.HemisphereLight(0xdfefff, 0x50463c, 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 0.95);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 1; sc.far = 600;
  sun.shadow.bias = -0.0006;
  scene.add(sun); scene.add(sun.target);
  scene.fog = new THREE.Fog(0xbfd8ef, 400, 1600);
  const meshes = new Map();
  const geos = {};
  const box = new THREE.BoxGeometry(1, 1, 1);
  const ball = new THREE.SphereGeometry(0.5, 28, 18);
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 28); cyl.rotateZ(Math.PI / 2);
  const wedge = (() => {
    const g = new THREE.BufferGeometry();
    const p = [-.5, -.5, -.5, .5, -.5, -.5, .5, -.5, .5, -.5, -.5, .5, -.5, .5, .5, .5, .5, .5];
    const idx = [0, 2, 1, 0, 3, 2, 3, 4, 5, 3, 5, 2, 0, 1, 5, 0, 5, 4, 0, 4, 3, 1, 2, 5];
    const pos = [];
    for (const i of idx) pos.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  })();
  const gridTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 128, 128);
    x.strokeStyle = 'rgba(0,0,0,.18)'; x.lineWidth = 3; x.strokeRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    return t;
  })();
  const faceTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#111';
    x.beginPath(); x.ellipse(44, 52, 8, 13, 0, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.ellipse(84, 52, 8, 13, 0, 0, Math.PI * 2); x.fill();
    x.lineWidth = 7; x.lineCap = 'round'; x.beginPath(); x.arc(64, 70, 26, 0.25 * Math.PI, 0.75 * Math.PI); x.stroke();
    return new THREE.CanvasTexture(c);
  })();
  const selBox = new THREE.Box3Helper(new THREE.Box3(), 0x2fa8ff);
  selBox.visible = false; scene.add(selBox);
  const effects = [];
  const lights = new Map();
  let w = 1, h = 1, rt = null;
  const cam = { yaw: 0.6, pitch: 0.42, dist: 46, target: new THREE.Vector3(0, 4, 0), fpYaw: 0 };
  function resize() {
    const r = host.getBoundingClientRect();
    w = Math.max(1, r.width); h = Math.max(1, r.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (S.rt) S.rt.viewport = { w, h };
  }
  new ResizeObserver(resize).observe(host);
  function resetScene(newRt) {
    for (const m of meshes.values()) { scene.remove(m); m.material.dispose(); }
    meshes.clear();
    for (const l of lights.values()) scene.remove(l);
    lights.clear();
    rt = newRt;
    if (S.mode === 'edit') { cam.dist = 46; cam.pitch = 0.42; cam.target.set(0, 4, 0); }
    else { cam.dist = 16; cam.pitch = 0.32; }
  }
  const MAT_ROUGH = { Plastic: 0.65, SmoothPlastic: 0.4, Neon: 1, Metal: 0.35, DiamondPlate: 0.35, Foil: 0.25, Glass: 0.08, Ice: 0.15, Marble: 0.3, Granite: 0.75, Wood: 0.8, WoodPlanks: 0.8, Grass: 0.95, Sand: 0.95, Fabric: 1, Brick: 0.9, Concrete: 0.9, Slate: 0.85, Cobblestone: 0.9, ForceField: 0.2 };
  function syncPart(p) {
    let m = meshes.get(p.id);
    const shape = p.p.Shape ? p.p.Shape.Name : p.ClassName === 'WedgePart' ? 'Wedge' : 'Block';
    const geo = shape === 'Ball' ? ball : shape === 'Cylinder' ? cyl : shape === 'Wedge' || p.ClassName === 'WedgePart' ? wedge : box;
    if (!m || m.geometry !== geo) {
      if (m) { scene.remove(m); m.material.dispose(); }
      m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0 }));
      m.matrixAutoUpdate = false;
      m.castShadow = true; m.receiveShadow = true;
      m.userData.inst = p;
      if (p.p.Name === 'Baseplate' && p.p.Locked) { m.material.map = gridTex; m.castShadow = false; }
      scene.add(m);
      meshes.set(p.id, m);
    }
    const c = p.p.Color, mat = m.material, mn = p.p.Material ? p.p.Material.Name : 'Plastic';
    const key = c.R + ',' + c.G + ',' + c.B + mn + p.p.Transparency + p.p.Reflectance;
    if (m.userData.key !== key) {
      m.userData.key = key;
      mat.color.setRGB(c.R, c.G, c.B).convertSRGBToLinear();
      const tr = mn === 'Glass' ? Math.max(p.p.Transparency, 0.45) : mn === 'ForceField' ? Math.max(p.p.Transparency, 0.6) : p.p.Transparency;
      mat.transparent = tr > 0;
      mat.opacity = 1 - tr;
      mat.depthWrite = tr < 0.5;
      mat.roughness = MAT_ROUGH[mn] !== undefined ? MAT_ROUGH[mn] : 0.7;
      mat.metalness = mn === 'Metal' || mn === 'DiamondPlate' || mn === 'Foil' || mn === 'CorrodedMetal' ? 0.6 : p.p.Reflectance * 0.8;
      mat.emissive.setRGB(0, 0, 0);
      if (mn === 'Neon') { mat.emissive.copy(mat.color); mat.emissiveIntensity = 1.1; }
      mat.wireframe = mn === 'ForceField';
      mat.needsUpdate = true;
      m.castShadow = tr < 0.6 && p.p.CastShadow !== false && !(p.p.Name === 'Baseplate' && p.p.Locked);
    }
    const cf = p.p.CFrame, s = p.p.Size, q = cf.m;
    if (shape === 'Ball') { const d = Math.min(s.X, s.Y, s.Z); m.matrix.set(q[0] * d, q[1] * d, q[2] * d, cf.x, q[3] * d, q[4] * d, q[5] * d, cf.y, q[6] * d, q[7] * d, q[8] * d, cf.z, 0, 0, 0, 1); }
    else if (shape === 'Cylinder') { const d = Math.min(s.Y, s.Z); m.matrix.set(q[0] * s.X, q[1] * d, q[2] * d, cf.x, q[3] * s.X, q[4] * d, q[5] * d, cf.y, q[6] * s.X, q[7] * d, q[8] * d, cf.z, 0, 0, 0, 1); }
    else m.matrix.set(q[0] * s.X, q[1] * s.Y, q[2] * s.Z, cf.x, q[3] * s.X, q[4] * s.Y, q[5] * s.Z, cf.y, q[6] * s.X, q[7] * s.Y, q[8] * s.Z, cf.z, 0, 0, 0, 1);
    m.matrixWorldNeedsUpdate = true;
    if (m.material.map === gridTex) gridTex.repeat.set(s.X / 4, s.Z / 4);
    m.visible = p.p.Transparency < 1;
    // 臉
    if (p.p.Name === 'Head' && p.children.some(c2 => c2.ClassName === 'Decal')) {
      if (!m.userData.face) {
        const f = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, depthWrite: false }));
        f.position.set(0, 0, -0.501); f.rotation.y = Math.PI;
        m.add(f); m.userData.face = f;
      }
    }
    return m;
  }
  function syncLights(parts) {
    const seen = new Set();
    for (const p of parts) {
      for (const c of p.children) {
        if ((c.ClassName === 'PointLight' || c.ClassName === 'SpotLight' || c.ClassName === 'SurfaceLight') && c.p.Enabled) {
          seen.add(c.id);
          let l = lights.get(c.id);
          if (!l) { if (lights.size >= 8) continue; l = new THREE.PointLight(0xffffff, 1, 8, 2); scene.add(l); lights.set(c.id, l); }
          l.color.setRGB(c.p.Color.R, c.p.Color.G, c.p.Color.B);
          l.intensity = c.p.Brightness * 1.5; l.distance = c.p.Range * 1.5;
          l.position.set(p.p.CFrame.x, p.p.CFrame.y, p.p.CFrame.z);
        }
      }
    }
    for (const [id, l] of lights) if (!seen.has(id)) { scene.remove(l); lights.delete(id); }
  }
  function skyFor(t) {
    // ClockTime → 天空顏色、太陽高度
    const day = Math.max(0, Math.min(1, (Math.sin((t - 6) / 12 * Math.PI) + 0.25) / 0.6));
    const top = new THREE.Color().setRGB(0.05 + 0.38 * day, 0.07 + 0.55 * day, 0.18 + 0.72 * day);
    return { day, color: top };
  }
  function updateCamera(dt) {
    const rt2 = rt;
    const camInst = rt2 && rt2.camera;
    if (S.rt && camInst && camInst.p.CameraType && camInst.p.CameraType.Name === 'Scriptable') {
      const cf = camInst.p.CFrame, q = cf.m;
      camera.matrixAutoUpdate = false;
      camera.matrix.set(q[0], q[1], q[2], cf.x, q[3], q[4], q[5], cf.y, q[6], q[7], q[8], cf.z, 0, 0, 0, 1);
      camera.matrixWorldNeedsUpdate = true;
      camera.updateMatrixWorld(true);
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      camera.fov = camInst.p.FieldOfView; camera.updateProjectionMatrix();
      return;
    }
    camera.matrixAutoUpdate = true;
    if (S.rt && S.rt.char && !S.rt.char.destroyed) {
      const root = S.rt.char.findChild('HumanoidRootPart') || S.rt.char.findChild('Head');
      if (root) { const c = root.p.CFrame; cam.target.lerp(new THREE.Vector3(c.x, c.y + 1.5, c.z), Math.min(1, dt * 18)); }
    } else if (S.rt && camInst && camInst.p.CameraSubject && camInst.p.CameraSubject.p && camInst.p.CameraSubject.p.CFrame) {
      const c = camInst.p.CameraSubject.p.CFrame; cam.target.lerp(new THREE.Vector3(c.x, c.y, c.z), Math.min(1, dt * 10));
    }
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    camera.position.set(cam.target.x + Math.sin(cam.yaw) * cp * cam.dist, cam.target.y + sp * cam.dist, cam.target.z + Math.cos(cam.yaw) * cp * cam.dist);
    camera.lookAt(cam.target);
    if (camInst) {
      camera.updateMatrixWorld();
      const e = camera.matrixWorld.elements;
      camInst.p.CFrame = new CFrame(camera.position.x, camera.position.y, camera.position.z, [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]]);
      camInst.p.ViewportSize = new Vector2(w, h);
      camera.fov = camInst.p.FieldOfView; camera.updateProjectionMatrix();
    }
    if (S.rt) S.rt.cam.yaw = cam.yaw;
  }
  function frame(dt) {
    if (!rt) return;
    const parts = rt.workspaceParts();
    const seen = new Set();
    for (const p of parts) { if (p.destroyed) continue; seen.add(p.id); syncPart(p); }
    for (const [id, m] of meshes) if (!seen.has(id)) { scene.remove(m); m.material.dispose(); meshes.delete(id); }
    syncLights(parts);
    const L = rt.game.findChild('Lighting');
    const sky = skyFor(L ? L.p.ClockTime : 14);
    scene.background = sky.color;
    if (L) {
      const fc = L.p.FogColor;
      scene.fog.color.setRGB(fc.R, fc.G, fc.B).convertSRGBToLinear().lerp(sky.color, L.p.FogEnd > 5000 ? 0.7 : 0);
      scene.fog.near = Math.min(L.p.FogStart, 4000); scene.fog.far = Math.min(Math.max(L.p.FogEnd, scene.fog.near + 1), 5000);
      const amb = L.p.Ambient;
      hemi.intensity = 0.25 + 0.55 * sky.day + (amb.R + amb.G + amb.B) / 3 * 0.4;
      sun.intensity = (0.15 + 0.95 * sky.day) * Math.min(L.p.Brightness, 5) / 2;
      const sd = rt.sunDir();
      sun.position.set(cam.target.x + sd.X * 200, Math.max(20, sd.Y * 200), cam.target.z + sd.Z * 200);
      sun.target.position.copy(cam.target);
    }
    updateCamera(dt);
    // 選取框
    const sel = S.selected;
    if (sel && !sel.destroyed && (sel.isA('BasePart') || sel.isA('Model'))) {
      const b = sel.isA('BasePart') ? Rbx.aabb(sel) : (() => { const [cf, s] = rt.modelBounds(sel); return [cf.x - s.X / 2, cf.y - s.Y / 2, cf.z - s.Z / 2, cf.x + s.X / 2, cf.y + s.Y / 2, cf.z + s.Z / 2]; })();
      selBox.box.min.set(b[0], b[1], b[2]); selBox.box.max.set(b[3], b[4], b[5]);
      selBox.visible = true;
    } else selBox.visible = false;
    // 特效
    for (const e of rt.effects.splice(0)) {
      if (e.k === 'explosion') {
        const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffa020, transparent: true, opacity: 0.85 }));
        m.position.set(e.pos.X, e.pos.Y, e.pos.Z);
        scene.add(m);
        effects.push({ m, t: 0, r: Math.max(2, e.radius) });
      }
    }
    for (let i = effects.length - 1; i >= 0; i--) {
      const f = effects[i];
      f.t += dt;
      const k = f.t / 0.6;
      f.m.scale.setScalar(f.r * (0.3 + k));
      f.m.material.opacity = Math.max(0, 0.85 * (1 - k));
      if (k >= 1) { scene.remove(f.m); f.m.geometry.dispose(); f.m.material.dispose(); effects.splice(i, 1); }
    }
    renderer.render(scene, camera);
  }
  function rayFromScreen(x, y) {
    const v = new THREE.Vector3((x / w) * 2 - 1, -(y / h) * 2 + 1, 0.5).unproject(camera);
    const o = camera.position.clone();
    const d = v.sub(o).normalize();
    return { o: new Vector3(o.x, o.y, o.z), d: new Vector3(d.x, d.y, d.z) };
  }
  function screenRay(x, y) { return rayFromScreen(x, y); }
  function worldToScreen(v) {
    const p = new THREE.Vector3(v.X, v.Y, v.Z);
    const camSpace = p.clone().applyMatrix4(camera.matrixWorldInverse);
    p.project(camera);
    return { x: (p.x + 1) / 2 * w, y: (1 - p.y) / 2 * h, z: -camSpace.z, on: camSpace.z < 0 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 };
  }
  function pick(x, y) {
    const r = rayFromScreen(x, y);
    const target = worldRt();
    const hit = target.raycast(r.o, r.d.mul(2000), (p) => p.p.Transparency < 1);
    return hit ? hit.part : null;
  }
  return {
    get w() { return w; }, get h() { return h; }, cam, camera, frame, resetScene, screenRay, worldToScreen, pick, rayFromScreen, resize,
  };
})();

// ---- 視角操作 ----
(() => {
  const view = $('#view');
  let drag = null;
  view.addEventListener('contextmenu', (e) => e.preventDefault());
  view.addEventListener('mousedown', (e) => {
    view.focus({ preventScroll: true });
    if (e.button === 2 || e.button === 1 || (S.mode === 'edit' && e.button === 0)) drag = { x: e.clientX, y: e.clientY, b: e.button, moved: false, shift: e.shiftKey };
    if (S.rt && e.button === 0) S.rt.mouseInput(0, true);
    if (S.rt && e.button === 2) S.rt.mouseInput(2, true);
  });
  addEventListener('mouseup', (e) => {
    if (drag && !drag.moved && drag.b === 0 && S.mode === 'edit') {
      const r = view.getBoundingClientRect();
      const p = V.pick(e.clientX - r.left, e.clientY - r.top);
      if (p) { S.selected = p; let x = p.parent; while (x) { S.expanded.add(instPath(x)); x = x.parent; } renderExplorer(true); renderProps(); }
    }
    drag = null;
    if (S.rt && e.button === 0) S.rt.mouseInput(0, false);
    if (S.rt && e.button === 2) S.rt.mouseInput(2, false);
  });
  addEventListener('mousemove', (e) => {
    const r = view.getBoundingClientRect();
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.b === 1 || drag.shift) {
        const s = V.cam.dist * 0.0022;
        const right = new THREE.Vector3(Math.cos(V.cam.yaw), 0, -Math.sin(V.cam.yaw));
        V.cam.target.addScaledVector(right, -dx * s);
        V.cam.target.y += dy * s;
      } else {
        V.cam.yaw -= dx * 0.008;
        V.cam.pitch = Math.max(-1.35, Math.min(1.45, V.cam.pitch + dy * 0.006));
      }
    }
    if (S.rt && e.target.closest && (e.target.closest('#view') || e.target.closest('#gui'))) {
      const x = e.clientX - r.left, y = e.clientY - r.top;
      S.rt.mouseMove(x, y, V.rayFromScreen(x, y));
    }
  });
  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    V.cam.dist = Math.max(0.6, Math.min(400, V.cam.dist * (e.deltaY > 0 ? 1.12 : 0.89)));
  }, { passive: false });
  // 鍵盤 → 遊戲
  const CODE = { Space: 'Space', Enter: 'Return', NumpadEnter: 'Return', Tab: 'Tab', Backspace: 'Backspace', Escape: 'Escape', ShiftLeft: 'LeftShift', ShiftRight: 'RightShift', ControlLeft: 'LeftControl', ControlRight: 'RightControl', AltLeft: 'LeftAlt', AltRight: 'RightAlt', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Minus: 'Minus', Equal: 'Equals', Comma: 'Comma', Period: 'Period', Slash: 'Slash', Semicolon: 'Semicolon', Quote: 'Quote', BracketLeft: 'LeftBracket', BracketRight: 'RightBracket', Backslash: 'BackSlash', Backquote: 'Backquote', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', CapsLock: 'CapsLock' };
  const DIG = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const keyName = (e) => { if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3); if (/^Digit\d$/.test(e.code)) return DIG[+e.code[5]]; if (/^F\d+$/.test(e.code)) return e.code; return CODE[e.code] || null; };
  const camKeys = new Set();
  view.addEventListener('keydown', (e) => {
    if (e.key === 'F5' || e.key === 'F6' || e.key === 'F10' || e.key === 'F11') return;
    const n = keyName(e);
    if (!n) return;
    if (['Space', 'Up', 'Down', 'Left', 'Right', 'Tab'].includes(n)) e.preventDefault();
    if (S.rt && S.mode !== 'edit') S.rt.keyInput(n, true);
    else camKeys.add(n);
    if (n === 'E' || (S.prompt && S.prompt.p.KeyboardKeyCode && S.prompt.p.KeyboardKeyCode.Name === n)) promptKey(true);
  });
  view.addEventListener('keyup', (e) => { const n = keyName(e); if (!n) return; if (S.rt) S.rt.keyInput(n, false); camKeys.delete(n); if (n === 'E' || (S.prompt && S.prompt.p.KeyboardKeyCode && S.prompt.p.KeyboardKeyCode.Name === n)) promptKey(false); });
  view.addEventListener('blur', () => { if (S.rt) for (const k of [...S.rt.keysDown]) S.rt.keyInput(k, false); camKeys.clear(); });
  V.camKeys = camKeys;
  // 觸控：虛擬搖桿 + 跳 + 單指轉視角
  const joy = $('#joy'), knob = $('#joy i'), jb = $('#jumpBtn');
  const touchy = matchMedia('(pointer: coarse)').matches;
  V.touchy = touchy;
  let jid = null;
  joy.addEventListener('pointerdown', (e) => { jid = e.pointerId; joy.setPointerCapture(e.pointerId); moveJoy(e); });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === jid) moveJoy(e); });
  const endJoy = () => { jid = null; knob.style.transform = ''; if (S.rt) S.rt.analog = null; };
  joy.addEventListener('pointerup', endJoy); joy.addEventListener('pointercancel', endJoy);
  function moveJoy(e) {
    const r = joy.getBoundingClientRect();
    let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    knob.style.transform = `translate(${x * 35}px, ${y * 35}px)`;
    if (S.rt) S.rt.analog = m > 0.15 ? { x, y } : null;
  }
  jb.addEventListener('pointerdown', (e) => { e.preventDefault(); if (S.rt) S.rt.keyInput('Space', true); });
  jb.addEventListener('pointerup', () => { if (S.rt) S.rt.keyInput('Space', false); });
  let tp = null, pinch = null;
  view.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) tp = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    if (e.touches.length === 2) pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  }, { passive: true });
  view.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && tp) {
      const t = e.touches[0];
      V.cam.yaw -= (t.clientX - tp.x) * 0.01;
      V.cam.pitch = Math.max(-1.35, Math.min(1.45, V.cam.pitch + (t.clientY - tp.y) * 0.008));
      tp.x = t.clientX; tp.y = t.clientY;
    } else if (e.touches.length === 2 && pinch) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      V.cam.dist = Math.max(0.6, Math.min(400, V.cam.dist * pinch / d)); pinch = d;
    }
  }, { passive: false });
  view.addEventListener('touchend', (e) => {
    if (tp && Date.now() - tp.t < 250 && e.changedTouches.length === 1 && S.rt) {
      const r = view.getBoundingClientRect(), t = e.changedTouches[0];
      const x = t.clientX - r.left, y = t.clientY - r.top;
      S.rt.mouseMove(x, y, V.rayFromScreen(x, y)); S.rt.mouseInput(0, true); S.rt.mouseInput(0, false);
    }
    tp = null; pinch = null;
  });
})();

// ---- ProximityPrompt ----
let promptHold = null;
function promptKey(down) {
  const pp = S.prompt;
  if (!pp || !S.rt) return;
  if (down) { if (!promptHold) promptHold = { pp, t0: performance.now() }; if (pp.p.HoldDuration <= 0) { S.rt.promptTrigger(pp); promptHold = { pp, t0: performance.now(), done: true }; } }
  else promptHold = null;
}
function updatePrompt() {
  const el = $('#prompt');
  const rt = S.rt;
  S.prompt = null;
  if (!rt || !rt.char || rt.char.destroyed) { el.style.display = 'none'; return; }
  const root = rt.char.findChild('HumanoidRootPart');
  if (!root) { el.style.display = 'none'; return; }
  let best = null, bd = Infinity;
  for (const p of rt.workspaceParts()) {
    for (const c of p.children) {
      if (c.ClassName !== 'ProximityPrompt' || !c.p.Enabled) continue;
      const d = p.p.CFrame.pos.sub(root.p.CFrame.pos).mag;
      if (d <= c.p.MaxActivationDistance && d < bd) { bd = d; best = [c, p]; }
    }
  }
  if (!best) { el.style.display = 'none'; promptHold = null; return; }
  const [pp, part] = best;
  S.prompt = pp;
  const sp = V.worldToScreen(part.p.CFrame.pos.add(new Vector3(0, part.p.Size.Y / 2 + 1, 0)));
  if (!sp.on) { el.style.display = 'none'; return; }
  const key = pp.p.KeyboardKeyCode ? pp.p.KeyboardKeyCode.Name : 'E';
  let frac = 0;
  if (promptHold && promptHold.pp === pp && !promptHold.done) {
    frac = Math.min(1, (performance.now() - promptHold.t0) / 1000 / Math.max(pp.p.HoldDuration, 0.01));
    if (frac >= 1) { rt.promptTrigger(pp); promptHold.done = true; }
  }
  el.innerHTML = `${pp.p.ObjectText ? `<div style="font-size:11px;color:#bbb">${esc(pp.p.ObjectText)}</div>` : ''}<b>${esc(key)}</b>${esc(pp.p.ActionText)}<div class="bar2" style="width:${frac * 100}%"></div>`;
  el.style.display = 'block';
  el.style.left = sp.x + 'px'; el.style.top = sp.y + 'px';
  el.style.pointerEvents = V.touchy ? 'auto' : 'none';
  el.onclick = () => rt.promptTrigger(pp);
}

// ===================================================================
// GUI 疊圖(ScreenGui / BillboardGui)
// ===================================================================
const GUI = (() => {
  const root = $('#gui');
  const els = new Map();
  const absCache = new Map();
  const FONT = (f) => {
    const n = f && f.Name || 'SourceSans';
    if (/Code|RobotoMono/.test(n)) return `600 1em var(--mono)`;
    if (/Cartoon|Fredoka|Luckiest|Bangers|Comic|Indie|Permanent/.test(n)) return `700 1em "Comic Sans MS","Chalkboard SE",var(--ui)`;
    if (/Bold|Black|Heavy|Arcade|SciFi/.test(n)) return `700 1em var(--ui)`;
    return `400 1em var(--ui)`;
  };
  const rgba = (c, t) => `rgba(${Math.round(c.R * 255)},${Math.round(c.G * 255)},${Math.round(c.B * 255)},${1 - (t || 0)})`;
  function abs(g) { const a = absCache.get(g.id); return a ? { size: new Vector2(a.w, a.h), pos: new Vector2(a.x, a.y) } : { size: new Vector2(0, 0), pos: new Vector2(0, 0) }; }
  function layoutKids(inst, W, H, ox, oy, parentEl, seen, z, pxScale) {
    const kids = inst.children.filter(c => c.isA('GuiObject'));
    const list = inst.children.find(c => c.ClassName === 'UIListLayout');
    const grid = inst.children.find(c => c.ClassName === 'UIGridLayout');
    const pad = inst.children.find(c => c.ClassName === 'UIPadding');
    let px0 = 0, py0 = 0, pw = W, ph = H;
    if (pad) {
      const pl = pad.p.PaddingLeft.Scale * W + pad.p.PaddingLeft.Offset, pr = pad.p.PaddingRight.Scale * W + pad.p.PaddingRight.Offset;
      const pt = pad.p.PaddingTop.Scale * H + pad.p.PaddingTop.Offset, pb = pad.p.PaddingBottom.Scale * H + pad.p.PaddingBottom.Offset;
      px0 = pl; py0 = pt; pw = W - pl - pr; ph = H - pt - pb;
    }
    let order = kids;
    if (list || grid) {
      const so = (list || grid).p.SortOrder.Name;
      order = kids.slice().sort((a, b) => so === 'Name' ? a.p.Name.localeCompare(b.p.Name) : a.p.LayoutOrder - b.p.LayoutOrder);
    }
    let cursor = 0, gx = 0, gy = 0;
    for (const c of order) {
      const sz = c.p.Size;
      let w2 = sz.X.Scale * pw + sz.X.Offset * pxScale, h2 = sz.Y.Scale * ph + sz.Y.Offset * pxScale;
      let x, y;
      if (list) {
        const vert = list.p.FillDirection.Name === 'Vertical';
        const gap = list.p.Padding.Scale * (vert ? ph : pw) + list.p.Padding.Offset;
        if (vert) { y = py0 + cursor; const ha = list.p.HorizontalAlignment.Name; x = px0 + (ha === 'Center' ? (pw - w2) / 2 : ha === 'Right' ? pw - w2 : 0); cursor += h2 + gap; }
        else { x = px0 + cursor; const va = list.p.VerticalAlignment.Name; y = py0 + (va === 'Center' ? (ph - h2) / 2 : va === 'Bottom' ? ph - h2 : 0); cursor += w2 + gap; }
      } else if (grid) {
        const cs = grid.p.CellSize, cp = grid.p.CellPadding;
        w2 = cs.X.Scale * pw + cs.X.Offset; h2 = cs.Y.Scale * ph + cs.Y.Offset;
        const gpx = cp.X.Scale * pw + cp.X.Offset, gpy = cp.Y.Scale * ph + cp.Y.Offset;
        if (gx > 0 && gx + w2 > pw + 0.5) { gx = 0; gy += h2 + gpy; }
        x = px0 + gx; y = py0 + gy; gx += w2 + gpx;
      } else {
        const p = c.p.Position, ap = c.p.AnchorPoint;
        x = px0 + p.X.Scale * pw + p.X.Offset * pxScale - ap.X * w2;
        y = py0 + p.Y.Scale * ph + p.Y.Offset * pxScale - ap.Y * h2;
      }
      drawObj(c, x, y, w2, h2, ox, oy, parentEl, seen, z, pxScale);
    }
  }
  function drawObj(c, x, y, w2, h2, ox, oy, parentEl, seen, z, pxScale) {
    seen.add(c.id);
    let el = els.get(c.id);
    const isBtn = c.ClassName === 'TextButton' || c.ClassName === 'ImageButton';
    const isBox = c.ClassName === 'TextBox';
    if (!el || el.parentNode !== parentEl) {
      if (el) el.remove();
      el = document.createElement('div');
      el.className = 'g' + (isBtn ? ' btn' : '');
      if (isBox) {
        const inp = document.createElement('input');
        inp.addEventListener('focus', () => { if (c.p.ClearTextOnFocus) { inp.value = ''; } S.rt && S.rt.guiEvent(c, 'Focused'); });
        inp.addEventListener('input', () => { if (S.rt) S.rt.setProp(c, 'Text', inp.value); });
        inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { inp.dataset.enter = '1'; inp.blur(); } });
        inp.addEventListener('blur', () => { if (S.rt) { S.rt.setProp(c, 'Text', inp.value); S.rt.guiEvent(c, 'FocusLost', [inp.dataset.enter === '1', undefined]); } inp.dataset.enter = ''; });
        el.appendChild(inp);
        el.style.pointerEvents = 'auto';
      } else {
        const tx = document.createElement('div'); tx.className = 'tx'; el.appendChild(tx);
      }
      if (isBtn) {
        el.addEventListener('click', () => { if (S.rt) { S.rt.guiEvent(c, 'MouseButton1Click'); S.rt.guiEvent(c, 'Activated', [undefined, 1]); } });
        el.addEventListener('mousedown', (e) => { e.stopPropagation(); if (S.rt) S.rt.guiEvent(c, 'MouseButton1Down', [e.offsetX, e.offsetY]); });
        el.addEventListener('mouseup', () => { if (S.rt) S.rt.guiEvent(c, 'MouseButton1Up'); });
      }
      el.addEventListener('mouseenter', (e) => { if (S.rt) S.rt.guiEvent(c, 'MouseEnter', [e.clientX, e.clientY]); });
      el.addEventListener('mouseleave', (e) => { if (S.rt) S.rt.guiEvent(c, 'MouseLeave', [e.clientX, e.clientY]); });
      if (c.sig && (c.sig.MouseEnter || c.sig.MouseLeave)) el.style.pointerEvents = 'auto';
      parentEl.appendChild(el);
      els.set(c.id, el);
    }
    absCache.set(c.id, { x: ox + x, y: oy + y, w: w2, h: h2 });
    const p = c.p;
    const corner = c.children.find(k => k.ClassName === 'UICorner');
    const stroke = c.children.find(k => k.ClassName === 'UIStroke' && k.p.Enabled);
    let st = `left:${x}px;top:${y}px;width:${w2}px;height:${h2}px;z-index:${z * 10 + p.ZIndex};`;
    st += `display:${p.Visible ? 'flex' : 'none'};`;
    if (c.ClassName !== 'Frame' || true) st += `background:${p.BackgroundTransparency >= 1 ? 'transparent' : rgba(p.BackgroundColor3, p.BackgroundTransparency)};`;
    if (p.BorderSizePixel > 0 && p.BackgroundTransparency < 1 && !stroke) st += `box-shadow:0 0 0 ${p.BorderSizePixel}px ${rgba(p.BorderColor3, p.BackgroundTransparency)};`;
    if (stroke) st += `outline:${stroke.p.Thickness}px solid ${rgba(stroke.p.Color, stroke.p.Transparency)};outline-offset:-${stroke.p.ApplyStrokeMode.Name === 'Border' ? stroke.p.Thickness : 0}px;`;
    if (corner) st += `border-radius:${corner.p.CornerRadius.Scale * Math.min(w2, h2) + corner.p.CornerRadius.Offset}px;`;
    if (p.Rotation) st += `transform:rotate(${p.Rotation}deg);`;
    if (p.ClipsDescendants) st += 'overflow:hidden;';
    if (c.ClassName === 'ImageLabel' || c.ClassName === 'ImageButton') st += `background-image:repeating-linear-gradient(45deg,rgba(255,255,255,.06) 0 6px,transparent 6px 12px);`;
    if ('Text' in p) {
      const fs = p.TextScaled ? Math.max(6, Math.min(h2 * 0.78, (w2 - 6) / Math.max(1, longestLine(p.Text)) / 0.55)) : p.TextSize * pxScale;
      st += `font:${FONT(p.Font)};font-size:${fs}px;color:${rgba(p.TextColor3, p.TextTransparency)};`;
      const xa = p.TextXAlignment.Name, ya = p.TextYAlignment.Name;
      st += `justify-content:${xa === 'Left' ? 'flex-start' : xa === 'Right' ? 'flex-end' : 'center'};align-items:${ya === 'Top' ? 'flex-start' : ya === 'Bottom' ? 'flex-end' : 'center'};text-align:${xa.toLowerCase()};`;
      if (p.TextStrokeTransparency < 1) st += `text-shadow:0 0 2px ${rgba(p.TextStrokeColor3, p.TextStrokeTransparency)},0 0 1px ${rgba(p.TextStrokeColor3, p.TextStrokeTransparency)};`;
    }
    if (el.dataset.st !== st) { el.style.cssText = st; el.dataset.st = st; }
    if ('Text' in p) {
      if (isBox) {
        const inp = el.firstChild;
        if (document.activeElement !== inp && inp.value !== p.Text) inp.value = p.Text;
        inp.placeholder = p.PlaceholderText || '';
      } else {
        const tx = el.firstChild;
        const wrap = p.TextWrapped || p.TextScaled;
        const key = p.Text + '|' + wrap + '|' + p.RichText;
        if (tx.dataset.k !== key) {
          tx.dataset.k = key;
          tx.style.whiteSpace = wrap ? 'pre-wrap' : 'pre';
          if (p.RichText) tx.innerHTML = richText(p.Text); else tx.textContent = p.Text;
          tx.style.justifyContent = 'inherit'; tx.style.alignItems = 'inherit';
        }
      }
    }
    layoutKids(c, w2, h2, ox + x, oy + y, el, seen, z, pxScale);
  }
  function longestLine(t) { return Math.max(1, ...String(t).split('\n').map(l => l.length + (l.match(/[^\x00-\xff]/g) || []).length * 0.8)); }
  function richText(t) { return esc(t).replace(/&lt;(\/?)(b|i|u|s)&gt;/g, '<$1$2>').replace(/&lt;font color=&quot;(#[0-9a-fA-F]{6}|rgb\(\d+,\s*\d+,\s*\d+\))&quot;&gt;/g, '<span style="color:$1">').replace(/&lt;\/font&gt;/g, '</span>').replace(/&lt;br\s*\/?&gt;/g, '<br>'); }
  function frame() {
    const rt = S.rt;
    const seen = new Set();
    const W = root.clientWidth, H = root.clientHeight;
    if (rt && rt.localPlayer) {
      const pg = rt.localPlayer.findChild('PlayerGui');
      const guis = pg ? pg.children.filter(g => g.ClassName === 'ScreenGui' && g.p.Enabled).sort((a, b) => a.p.DisplayOrder - b.p.DisplayOrder) : [];
      guis.forEach((g, i) => { seen.add(g.id); const host = hostFor(g, root); host.style.zIndex = 10 + i; layoutKids(g, W, H, 0, 0, host, seen, i, 1); });
      // BillboardGui：在零件上方
      const bbs = [];
      for (const d of rt.workspace.descendants()) if (d.ClassName === 'BillboardGui' && d.p.Enabled) bbs.push(d);
      if (pg) for (const d of pg.descendants()) if (d.ClassName === 'BillboardGui' && d.p.Enabled && d.p.Adornee) bbs.push(d);
      for (const b of bbs) {
        const ad = b.p.Adornee || b.parent;
        if (!ad || !ad.p.CFrame || !(ad.p.CFrame instanceof CFrame)) continue;
        const pos = ad.p.CFrame.pos.add(b.p.StudsOffset).add(new Vector3(0, ad.p.Size ? b.p.ExtentsOffset.Y * ad.p.Size.Y / 2 : 0, 0));
        const sp = V.worldToScreen(pos);
        seen.add(b.id);
        const host = hostFor(b, root);
        if (!sp.on || sp.z > b.p.MaxDistance) { host.style.display = 'none'; continue; }
        const pps = H / (2 * sp.z * Math.tan(V.camera.fov * Math.PI / 360));
        const bw = b.p.Size.X.Scale * pps + b.p.Size.X.Offset, bh = b.p.Size.Y.Scale * pps + b.p.Size.Y.Offset;
        host.style.cssText = `position:absolute;left:${sp.x - bw / 2}px;top:${sp.y - bh / 2}px;width:${bw}px;height:${bh}px;z-index:${b.p.AlwaysOnTop ? 5 : 1};`;
        layoutKids(b, bw, bh, sp.x - bw / 2, sp.y - bh / 2, host, seen, 0, 1);
      }
    }
    for (const [id, el] of els) if (!seen.has(id)) { el.remove(); els.delete(id); absCache.delete(id); }
  }
  function hostFor(g, parent) {
    let el = els.get(g.id);
    if (!el) { el = document.createElement('div'); el.style.cssText = 'position:absolute;inset:0;'; parent.appendChild(el); els.set(g.id, el); }
    if (g.ClassName === 'ScreenGui' && el.style.display === 'none') el.style.display = '';
    return el;
  }
  function clear() { for (const el of els.values()) el.remove(); els.clear(); absCache.clear(); }
  return { frame, abs, clear };
})();

function updateHud() {
  const rt = S.rt;
  const board = $('#board'), hp = $('#hp'), dead = $('#dead');
  if (!rt) { board.style.display = 'none'; hp.style.display = 'none'; dead.style.display = 'none'; return; }
  const pl = rt.localPlayer;
  const ls = pl && pl.findChild('leaderstats');
  if (ls && ls.children.length) {
    const stats = ls.children.filter(c => c.isA('ValueBase')).slice(0, 4);
    const h = `<table><tr><th>玩家</th>${stats.map(s => `<th>${esc(s.p.Name)}</th>`).join('')}</tr><tr><td>${esc(pl.p.DisplayName)}</td>${stats.map(s => `<td>${esc(fmtVal(s.p.Value))}</td>`).join('')}</tr></table>`;
    if (board.dataset.h !== h) { board.innerHTML = h; board.dataset.h = h; }
    board.style.display = 'block';
  } else board.style.display = 'none';
  const ch = rt.char, hum = ch && !ch.destroyed && ch.humanoid;
  if (hum && hum.p.Health < hum.p.MaxHealth && hum.p.Health > 0) { hp.style.display = 'block'; const f = hum.p.Health / hum.p.MaxHealth; hp.firstChild.style.width = f * 100 + '%'; hp.firstChild.style.background = f > 0.5 ? '#3fb950' : f > 0.25 ? '#f0a33a' : '#ff5c5c'; }
  else hp.style.display = 'none';
  dead.style.display = hum && hum.ctl.dead ? 'grid' : 'none';
  $('#joy').style.display = $('#jumpBtn').style.display = V.touchy && S.mode !== 'edit' ? 'block' : 'none';
}

// ===================================================================
// 主迴圈
// ===================================================================
let lastT = performance.now(), slowT = 0;
function loop(t) {
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  try {
    if (S.rt && !S.rt.stopped) S.rt.step(dt);
    if (S.mode === 'edit' && V.camKeys && V.camKeys.size) {
      const k = V.camKeys, sp = (k.has('LeftShift') ? 60 : 24) * dt;
      const fw = new THREE.Vector3(-Math.sin(V.cam.yaw), 0, -Math.cos(V.cam.yaw)), rg = new THREE.Vector3(Math.cos(V.cam.yaw), 0, -Math.sin(V.cam.yaw));
      if (k.has('W')) V.cam.target.addScaledVector(fw, sp);
      if (k.has('S')) V.cam.target.addScaledVector(fw, -sp);
      if (k.has('D')) V.cam.target.addScaledVector(rg, sp);
      if (k.has('A')) V.cam.target.addScaledVector(rg, -sp);
      if (k.has('E')) V.cam.target.y += sp;
      if (k.has('Q')) V.cam.target.y -= sp;
    }
    V.frame(dt);
    GUI.frame();
    updatePrompt();
    updateHud();
    slowT += dt;
    if (slowT > 0.3) {
      slowT = 0;
      if (S.rt) { renderExplorer(false); renderProps(false); if (S.paused) renderWatches(); }
    }
  } catch (e) {
    console.error(e);
    if (!loop.errShown) { loop.errShown = true; out('error', '編輯器內部錯誤：' + e.message); }
  }
  requestAnimationFrame(loop);
}

// ===================================================================
// 底部分頁 / 工具列 / 檔案
// ===================================================================
function showPane(id) {
  $$('.btab').forEach(b => b.classList.toggle('on', b.dataset.pane === id));
  $$('.bpane').forEach(p => p.classList.toggle('on', p.id === id));
  if (id === 'paneBps') renderBps();
  if (id === 'paneVars') renderWatches();
}
$$('.btab').forEach(b => b.onclick = () => showPane(b.dataset.pane));
$('#btnClear').onclick = () => { outEl.innerHTML = ''; lastOut = null; S.errCount = 0; $('#errCnt').style.display = 'none'; };
$('#btnRun').onclick = () => startRun();
$('#btnStop').onclick = () => stopRun();
$('#btnPause').onclick = () => { if (S.rt && S.mode === 'running') { S.rt.requestPause(); sys('⏸ 等程式跑到下一行就會停下來…（如果所有腳本都在 wait，會在它們醒來時停）'); } };
$('#btnCont').onclick = () => resume('run');
$('#btnOver').onclick = () => resume('over');
$('#btnInto').onclick = () => resume('into');
$('#btnOut').onclick = () => resume('out');
$('#chkBreakErr').onchange = (e) => { if (S.rt) S.rt.I.dbg.breakOnError = e.target.checked; saveSoon(); };
$('#chkTime').onchange = () => saveSoon();
$('#btnHelp').onclick = () => $('#help').classList.add('on');
$$('[data-close]').forEach(b => b.onclick = () => b.closest('.modal').classList.remove('on'));
$('#help').onclick = (e) => { if (e.target.id === 'help') e.target.classList.remove('on'); };
$('#btnExplorer').onclick = () => $('#left').classList.toggle('mopen');
$('#btnCollapse').onclick = () => { S.expanded = new Set(['Game']); renderExplorer(true); };
$('#watchIn').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.value.trim()) { S.watches.push(e.target.value.trim()); store.set('luauStudio.watches', S.watches); e.target.value = ''; renderWatches(); } });
$('#cmd').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { runCommand(e.target.value); e.target.value = ''; }
  else if (e.key === 'ArrowUp') { if (cmdPos < cmdHist.length - 1) { cmdPos++; e.target.value = cmdHist[cmdPos]; } e.preventDefault(); }
  else if (e.key === 'ArrowDown') { if (cmdPos > 0) { cmdPos--; e.target.value = cmdHist[cmdPos]; } else { cmdPos = -1; e.target.value = ''; } e.preventDefault(); }
});
// 選單
$$('.menu > .tb').forEach(b => b.onclick = (e) => { e.stopPropagation(); const m = b.parentElement; const was = m.classList.contains('open'); $$('.menu').forEach(x => x.classList.remove('open')); if (!was) m.classList.add('open'); });
addEventListener('click', () => $$('.menu').forEach(x => x.classList.remove('open')));
$$('[data-new]').forEach(b => b.onclick = () => { const [t, p] = b.dataset.new.split('|'); addScript(t, p); });
$('#exList').innerHTML = EXAMPLES.map((ex, i) => `<button data-ex="${i}">${esc(ex.title)}<small>${esc(ex.desc)}</small></button>`).join('');
$$('[data-ex]').forEach(b => b.onclick = () => loadProject(fromExample(EXAMPLES[+b.dataset.ex]), true));
function loadProject(p, ask) {
  if (ask && !confirm(`載入「${p.name}」會取代目前的所有腳本。\n（目前的腳本若要保留，請先按「檔案 → 匯出專案」）\n\n確定要載入嗎？`)) return;
  if (S.rt) stopRun();
  for (const ed of S.editors.values()) ed.root.remove();
  S.editors.clear(); S.open = []; S.active = null; S.selected = null;
  project = p;
  saveNow();
  refreshPreview();
  const first = project.scripts.find(s => s.type !== 'ModuleScript') || project.scripts[0];
  for (const s of project.scripts) openScript(s.id, false);
  if (first) openScript(first.id, false);
  renderBps();
  outEl.innerHTML = ''; lastOut = null;
  sys(`📂 已載入「${project.name}」。按 ▶ 執行（F5）試試看！`);
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$('#fExportProj').onclick = () => download((project.name || 'luau-project').replace(/[\\/:*?"<>|]/g, '_') + '.json', JSON.stringify({ format: 'luau-studio', version: 1, ...project }, null, 2), 'application/json');
$('#fExportLua').onclick = () => { const s = scriptById(S.active); if (!s) return toast('先開一個腳本'); download(s.name + '.lua', s.source); };
$('#fCopy').onclick = async () => { const s = scriptById(S.active); if (!s) return toast('先開一個腳本'); try { await navigator.clipboard.writeText(s.source); toast('已複製，可以貼到 Roblox Studio'); } catch (e) { toast('無法使用剪貼簿，請用「下載 .lua」'); } };
$('#fNewProj').onclick = () => loadProject({ name: '新專案', scripts: [{ id: newId(), name: 'Script', type: 'Script', parent: 'ServerScriptService', source: '-- 在這裡寫程式，按 F5 執行\nprint("Hello world!")\n', bps: [] }] }, true);
$('#fClearDS').onclick = () => { if (confirm('清除所有 DataStore 存檔（排行榜、存檔資料）？')) { store.set(KEY_DS, {}); toast('已清除'); } };
let fileMode = '';
$('#fImportProj').onclick = () => { fileMode = 'proj'; $('#fileIn').accept = '.json,application/json'; $('#fileIn').click(); };
$('#fImportLua').onclick = () => { fileMode = 'lua'; $('#fileIn').accept = '.lua,.luau,.txt'; $('#fileIn').click(); };
$('#fileIn').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const text = await f.text();
  if (fileMode === 'lua') { addScript('Script', 'ServerScriptService', f.name.replace(/\.(lua|luau|txt)$/i, '').replace(/[.\s]+/g, '_') || 'Script', text); return; }
  try {
    const j = JSON.parse(text);
    if (!Array.isArray(j.scripts)) throw new Error('不是 Roblox 工作室的專案檔');
    loadProject({ name: j.name || f.name, scripts: j.scripts.map(s => ({ id: newId(), name: String(s.name || 'Script'), type: ['Script', 'LocalScript', 'ModuleScript'].includes(s.type) ? s.type : 'Script', parent: PARENTS.includes(s.parent) ? s.parent : 'ServerScriptService', source: String(s.source || ''), bps: Array.isArray(s.bps) ? s.bps : [] })) }, true);
  } catch (err) { toast('匯入失敗：' + err.message); }
};
// 全域快捷鍵
addEventListener('keydown', (e) => {
  if (e.key === 'F5') { e.preventDefault(); if (e.shiftKey) stopRun(); else if (S.mode === 'paused') resume('run'); else if (S.mode === 'edit') startRun(); }
  else if (e.key === 'F6') { e.preventDefault(); $('#btnPause').click(); }
  else if (e.key === 'F10') { e.preventDefault(); resume('over'); }
  else if (e.key === 'F11') { e.preventDefault(); resume(e.shiftKey ? 'out' : 'into'); }
  else if (e.key === 'F9') { e.preventDefault(); const ed = S.editors.get(S.active); if (ed) toggleBp(ed.s.id, ed.lineCol().line); }
  else if (e.key === 'Escape') $$('.modal').forEach(m => m.classList.remove('on'));
});
// 拖曳調整版面
function splitter(el, onMove) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const mv = (ev) => onMove(ev);
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); saveSoon(); V.resize(); };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
  });
}
const main = $('#main');
function applyLayout() {
  main.style.setProperty('--left-w', ui.leftW + 'px');
  if (ui.rightW) main.style.setProperty('--right-w', ui.rightW + 'px');
  main.style.setProperty('--bottom-h', ui.bottomH + 'px');
}
splitter($('#splitL'), (e) => { ui.leftW = Math.max(160, Math.min(500, e.clientX)); applyLayout(); });
splitter($('#splitR'), (e) => { ui.rightW = Math.max(220, Math.min(innerWidth - ui.leftW - 260, innerWidth - e.clientX)); applyLayout(); });
splitter($('#splitB'), (e) => { ui.bottomH = Math.max(90, Math.min(innerHeight - 200, innerHeight - e.clientY)); applyLayout(); });
addEventListener('beforeunload', saveNow);

// ===================================================================
// 啟動
// ===================================================================
measure();
applyLayout();
$('#chkBreakErr').checked = !!ui.breakErr;
$('#chkTime').checked = !!ui.showTime;
refreshPreview();
const openIds = (ui.open || []).filter(id => scriptById(id));
if (!openIds.length) openIds.push(...project.scripts.map(s => s.id));
for (const id of openIds) openScript(id, false);
if (ui.active && scriptById(ui.active)) openScript(ui.active, false);
renderTabs(); renderBps(); renderWatches();
setMode('edit');
sys('歡迎使用 Roblox 工作室！按 ▶ 執行（F5）跑程式；在行號左邊點一下可以設中斷點。左上「📚 範例」有很多可以玩的範例。');
requestAnimationFrame(loop);
window.__studio = { S, project: () => project, startRun, stopRun, resume, out, V, GUI, openScript, toggleBp, loadProject, fromExample, runCommand, evalWatch };
})();
