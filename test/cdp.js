// test/cdp.js — 極簡 Chrome DevTools Protocol 客戶端（從 yt-downloader 複製，多了 args 參數給 WebGL 用）
//
// 為什麼要它：這頁一開就掛著 SSE（EventSource）連線，
// `--virtual-time-budget` 會因為「還有網路請求沒結束」而永遠不推進，Chrome 就不吐 DOM；
// 不加 budget 的 `--dump-dom` 又太早，畫面上還停在「讀取環境中…」。
// 用 CDP 就沒這問題：真的等頁面跑一陣子，再 Runtime.evaluate 問畫面現在長怎樣、按鈕按下去有沒有反應。
//
// 只實作用得到的部分：HTTP Upgrade 握手 + text frame 收送 + Runtime.evaluate。
const net = require('net');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', d => { b += d; });
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

// ---------------------------------------------------------------- WebSocket
class Ws {
  constructor(socket) {
    this.sock = socket;
    this.buf = Buffer.alloc(0);
    this.onmessage = () => {};
    socket.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this.drain(); });
  }

  drain() {
    // 一個 TCP chunk 可能含多個 frame，也可能只含半個，所以要一直嘗試切
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const opcode = b[0] & 0x0f;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (b.length < off + len) return;
      const payload = b.slice(off, off + len);
      this.buf = b.slice(off + len);
      if (opcode === 0x1) this.onmessage(payload.toString('utf8'));
      else if (opcode === 0x9) this.sendFrame(payload, 0xa); // ping → pong
      else if (opcode === 0x8) { this.sock.end(); return; }
    }
  }

  sendFrame(payload, opcode = 0x1) {
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
    const head = [0x80 | opcode];
    if (data.length < 126) head.push(0x80 | data.length);
    else if (data.length < 65536) head.push(0x80 | 126, data.length >> 8 & 0xff, data.length & 0xff);
    else {
      head.push(0x80 | 127);
      const big = Buffer.alloc(8);
      big.writeBigUInt64BE(BigInt(data.length));
      for (const x of big) head.push(x);
    }
    const mask = crypto.randomBytes(4);
    const masked = Buffer.from(data);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
    this.sock.write(Buffer.concat([Buffer.from(head), mask, masked]));
  }

  static connect(wsUrl) {
    return new Promise((resolve, reject) => {
      const u = new URL(wsUrl);
      const key = crypto.randomBytes(16).toString('base64');
      const sock = net.connect(Number(u.port), u.hostname, () => {
        sock.write(
          `GET ${u.pathname}${u.search} HTTP/1.1\r\n` +
          `Host: ${u.host}\r\n` +
          'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
        );
      });
      sock.once('error', reject);
      const onHead = (chunk) => {
        const s = chunk.toString('latin1');
        const i = s.indexOf('\r\n\r\n');
        if (i < 0) { sock.once('data', onHead); return; }
        if (!/^HTTP\/1\.1 101/.test(s)) return reject(new Error('WebSocket 握手失敗：' + s.split('\r\n')[0]));
        const ws = new Ws(sock);
        const rest = chunk.slice(Buffer.byteLength(s.slice(0, i + 4), 'latin1'));
        if (rest.length) { ws.buf = rest; ws.drain(); }
        resolve(ws);
      };
      sock.once('data', onHead);
    });
  }
}

// ---------------------------------------------------------------- 瀏覽器
async function launch(url, { chrome, port = 9223, timeoutMs = 30000, args = [] } = {}) {
  const exe = chrome || process.env.YTD_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ytd-cdp-'));
  const proc = spawn(exe, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--mute-audio',
    '--disable-features=Translate,BackForwardCache',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...args, url,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let target = null;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const list = await getJson(`http://127.0.0.1:${port}/json`);
      target = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (target) break;
    } catch {}
    await sleep(200);
  }
  if (!target) { proc.kill(); throw new Error('連不上 Chrome 的除錯埠'); }

  const ws = await Ws.connect(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (txt) => {
    const m = JSON.parse(txt);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };

  const send = (method, params) => new Promise((resolve, reject) => {
    const myId = ++id;
    const timer = setTimeout(() => { pending.delete(myId); reject(new Error(method + ' 逾時')); }, 30000);
    pending.set(myId, m => { clearTimeout(timer); resolve(m); });
    ws.sendFrame(JSON.stringify({ id: myId, method, params: params || {} }));
  });

  // 在頁面裡跑一段 JS 並取回結果（回傳值會經過 JSON 序列化）
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression: `(async()=>{ return (${expression}) })()`,
      awaitPromise: true, returnByValue: true,
    });
    const res = r.result || {};
    if (res.exceptionDetails) {
      const e = res.exceptionDetails;
      throw new Error('頁面內錯誤：' + ((e.exception && e.exception.description) || e.text));
    }
    return res.result ? res.result.value : undefined;
  };

  const close = () => {
    try { ws.sock.end(); } catch {}
    try { proc.kill(); } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  };

  return { evaluate, send, close, proc };
}

module.exports = { launch, sleep };
