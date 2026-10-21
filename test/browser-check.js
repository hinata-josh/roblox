// 用法：node test/browser-check.js [輸出截圖資料夾]
// 用無頭 Chrome 真的打開 index.html：載入每個範例並執行、測中斷點/單步/監看/指令列、截圖。
const path = require('path');
const fs = require('fs');
const { launch, sleep } = require('./cdp');

const shotDir = process.argv[2] || path.join(__dirname, 'shots');
fs.mkdirSync(shotDir, { recursive: true });
const url = 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); } };

(async () => {
  const b = await launch('about:blank', { port: 9231, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1400,900'] });
  const { evaluate, send } = b;
  try {
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs=[];addEventListener('error',e=>__errs.push(String(e.message)+' @'+(e.filename||'').split('/').pop()+':'+e.lineno));addEventListener('unhandledrejection',e=>__errs.push('reject:'+e.reason));window.confirm=()=>true;window.prompt=()=>null;` });
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    await sleep(2500);
    const shot = async (name) => {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      if (r.result && r.result.data) fs.writeFileSync(path.join(shotDir, name + '.png'), Buffer.from(r.result.data, 'base64'));
    };

    console.log('▶ 載入頁面');
    ok(await evaluate('!!window.__studio'), '__studio 存在');
    ok(await evaluate('window.__errs.length === 0'), '載入無 JS 錯誤', await evaluate('JSON.stringify(window.__errs)'));
    ok(await evaluate('!!document.querySelector("#view canvas")'), 'WebGL canvas 建立');
    ok(await evaluate('document.querySelectorAll(".tab").length >= 1'), '有開啟的程式分頁');
    await shot('01-edit');

    const n = await evaluate('EXAMPLES.length');
    for (let i = 0; i < n; i++) {
      const title = await evaluate(`EXAMPLES[${i}].title`);
      console.log('▶ 範例：' + title);
      await evaluate(`(()=>{const st=__studio; st.loadProject(st.fromExample(EXAMPLES[${i}]), false); document.querySelector('#out').innerHTML=''; st.startRun(); return 1})()`);
      await sleep(2500);
      if (/鍵盤/.test(title)) {
        await evaluate(`(()=>{const v=document.querySelector('#view'); v.focus(); for (const c of ['KeyE','KeyR']) { v.dispatchEvent(new KeyboardEvent('keydown',{code:c,key:c.slice(3).toLowerCase(),bubbles:true})); v.dispatchEvent(new KeyboardEvent('keyup',{code:c,key:c.slice(3).toLowerCase(),bubbles:true})); } return 1})()`);
        await sleep(1200);
      }
      if (/點擊方塊/.test(title)) {
        // 點一個方塊：直接用 runtime 射線打方塊位置
        await evaluate(`(()=>{const rt=__studio.S.rt; const p=rt.workspaceParts().find(x=>x.children.some(c=>c.ClassName==='ClickDetector')); const cam=__studio.V.camera; const sp=__studio.V.worldToScreen(p.p.CFrame.pos); rt.mouseMove(sp.x, sp.y, __studio.V.rayFromScreen(sp.x, sp.y)); rt.mouseInput(0,true); rt.mouseInput(0,false); return 1})()`);
        await sleep(600);
        const label = await evaluate(`[...document.querySelectorAll('#gui .tx')].map(e=>e.textContent).join('|')`);
        ok(/分數：[1-9]/.test(label), 'ClickDetector → RemoteEvent → GUI 分數更新', label);
      }
      const errs = await evaluate(`[...document.querySelectorAll('#out .ol.error')].map(e=>e.textContent).join('\\n')`);
      const expectErr = /除錯練習/.test(title);
      ok(expectErr ? errs.length > 0 : !errs, expectErr ? '有預期中的錯誤' : '執行無錯誤', errs.slice(0, 300));
      ok(await evaluate('window.__errs.length === 0'), '無 JS 例外', await evaluate('JSON.stringify(window.__errs)'));
      const meshes = await evaluate('__studio.S.rt.workspaceParts().length');
      ok(meshes > 2, `場景有零件 (${meshes})`);
      await shot(String(i + 2).padStart(2, '0') + '-' + title.replace(/[^\w一-鿿]+/g, '_').slice(0, 20));
      await evaluate('__studio.stopRun()');
    }

    console.log('▶ 角色操作');
    await evaluate(`(()=>{const st=__studio; st.loadProject(st.fromExample(EXAMPLES.find(e=>/彩虹/.test(e.title))), false); st.startRun(); return 1})()`);
    await sleep(1200);
    const p0 = await evaluate(`(()=>{const r=__studio.S.rt.char.findChild('HumanoidRootPart').p.CFrame; return [r.x,r.y,r.z]})()`);
    await evaluate(`(()=>{const v=document.querySelector('#view'); v.focus(); v.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',key:'w',bubbles:true})); return 1})()`);
    await sleep(800);
    await evaluate(`(()=>{const v=document.querySelector('#view'); v.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW',key:'w',bubbles:true})); v.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true})); return 1})()`);
    await sleep(150);
    const p1 = await evaluate(`(()=>{const r=__studio.S.rt.char.findChild('HumanoidRootPart').p.CFrame; return [r.x,r.y,r.z]})()`);
    await evaluate(`(()=>{const v=document.querySelector('#view'); v.dispatchEvent(new KeyboardEvent('keyup',{code:'Space',key:' ',bubbles:true})); return 1})()`);
    const moved = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
    ok(moved > 5, `按 W 角色往前走 (${moved.toFixed(1)} studs)`);
    ok(p1[1] > p0[1] + 1, `按空白鍵會跳 (y ${p0[1].toFixed(1)} → ${p1[1].toFixed(1)})`);
    await evaluate(`(()=>{const st=__studio; const ws=st.S.rt.workspace; st.S.selected = ws.findChild('Stairs').children[0]; return 1})()`);
    await sleep(500);
    ok(await evaluate(`/Step1/.test(document.querySelector('#props').innerHTML) && /Anchored/.test(document.querySelector('#props').textContent)`), '屬性面板顯示選取的零件');
    // 執行中直接在屬性面板改值
    await evaluate(`(()=>{const i=document.querySelector('#props input[data-k="Transparency"]'); i.value='0.5'; i.dispatchEvent(new Event('change')); return 1})()`);
    ok(await evaluate(`__studio.S.selected.p.Transparency === 0.5`), '屬性面板可以即時改值');
    await evaluate('__studio.stopRun()');

    console.log('▶ 除錯器：中斷點 / 單步 / 監看 / 指令列');
    await evaluate(`(()=>{const st=__studio; st.loadProject(st.fromExample(EXAMPLES.find(e=>/Hello/.test(e.title))), false); return 1})()`);
    const line = await evaluate(`__studio.project().scripts[0].source.split('\\n').findIndex(l=>l.includes('local result = n * n'))+1`);
    ok(line > 0, '找到要設中斷點的行 ' + line);
    await evaluate(`(()=>{const s=__studio.project().scripts[0]; __studio.toggleBp(s.id, ${line}); return 1})()`);
    ok(await evaluate(`document.querySelectorAll('.ed.on .gl.bp').length === 1`), '行號旁出現紅點');
    await evaluate('__studio.startRun()');
    await sleep(800);
    ok(await evaluate(`__studio.S.mode === 'paused'`), '執行後停在中斷點', await evaluate('__studio.S.mode'));
    ok(await evaluate(`__studio.S.paused && __studio.S.paused.line === ${line}`), '停在正確行號', await evaluate('__studio.S.paused && __studio.S.paused.line'));
    ok(await evaluate(`document.querySelector('.ed.on .gl.cur') && +document.querySelector('.ed.on .gl.cur').dataset.n === ${line}`), '編輯器標出目前行');
    ok(await evaluate(`__studio.evalWatch('n') === '1'`), '監看 n = 1', await evaluate(`__studio.evalWatch('n')`));
    ok(await evaluate(`[...document.querySelectorAll('#vars .vn')].some(e => e.textContent === 'n')`), '變數面板列出 n');
    ok(await evaluate(`document.querySelectorAll('#stack .frame').length >= 2`), '呼叫堆疊有 2 層以上');
    await shot('20-paused');
    await evaluate(`__studio.resume('over')`);
    await sleep(400);
    ok(await evaluate(`__studio.S.paused && __studio.S.paused.line === ${line + 1}`), 'F10 走到下一行', await evaluate('__studio.S.paused && __studio.S.paused.line'));
    ok(await evaluate(`__studio.evalWatch('result') === '1'`), 'result 算出來是 1', await evaluate(`__studio.evalWatch('result')`));
    await evaluate(`__studio.resume('run')`);
    await sleep(400);
    ok(await evaluate(`__studio.S.paused && __studio.evalWatch('n') === '2'`), 'F5 繼續 → 下一次呼叫 n = 2', await evaluate(`__studio.evalWatch('n')`));
    await evaluate(`__studio.runCommand('n = 10')`);
    await evaluate(`__studio.resume('over')`);
    await sleep(300);
    ok(await evaluate(`__studio.evalWatch('result') === '100'`), '指令列改 n = 10 後 result = 100', await evaluate(`__studio.evalWatch('result')`));
    await evaluate(`(()=>{const s=__studio.project().scripts[0]; __studio.toggleBp(s.id, ${line}); return 1})()`);
    await evaluate(`__studio.resume('run')`);
    await sleep(600);
    ok(await evaluate(`__studio.S.mode === 'running'`), '移除中斷點後跑完');
    ok(await evaluate(`/1² \\+ 2² \\+ 3² \\+ 4² = 1[0-9]{2}/.test(document.querySelector('#out').textContent)`), '總和反映了改過的值', await evaluate(`[...document.querySelectorAll('#out .ol')].map(e=>e.textContent).filter(t=>t.includes('²')).join()`));
    await evaluate('__studio.stopRun()');

    console.log('▶ 出錯時暫停');
    await evaluate(`(()=>{const st=__studio; st.loadProject(st.fromExample(EXAMPLES.find(e=>/除錯練習/.test(e.title))), false); document.querySelector('#chkBreakErr').checked=true; st.startRun(); return 1})()`);
    await sleep(800);
    ok(await evaluate(`__studio.S.mode === 'paused' && __studio.S.paused.why === 'error'`), '錯誤時自動暫停', await evaluate('__studio.S.mode'));
    ok(await evaluate(`__studio.evalWatch('level') === '1'`), '可以看出錯當下的 level', await evaluate(`__studio.evalWatch('level')`));
    ok(await evaluate(`/💡/.test(document.querySelector('#out').textContent)`), '錯誤有中文提示');
    await shot('21-error-pause');
    await evaluate(`(()=>{document.querySelector('#chkBreakErr').checked=false; __studio.stopRun(); return 1})()`);

    console.log('▶ 編輯器');
    await evaluate(`(()=>{const st=__studio; st.loadProject({name:'t', scripts:[{id:'e1',name:'Script',type:'Script',parent:'ServerScriptService',source:'',bps:[]}]}, false); return 1})()`);
    await evaluate(`(()=>{const ta=document.querySelector('.ed.on textarea'); ta.focus(); ta.value='local x = 1\\nif x > 0 then'; ta.setSelectionRange(ta.value.length, ta.value.length); ta.dispatchEvent(new Event('input')); ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})); return 1})()`);
    const v = await evaluate(`document.querySelector('.ed.on textarea').value`);
    ok(/then\n\t\nend$/.test(v), 'Enter 自動縮排並補 end', JSON.stringify(v));
    await evaluate(`(()=>{const ta=document.querySelector('.ed.on textarea'); ta.value='print("a"'; ta.dispatchEvent(new Event('input')); return 1})()`);
    await sleep(500);
    ok(await evaluate(`/✗/.test(document.querySelector('#syn').textContent)`), '語法錯誤即時顯示', await evaluate(`document.querySelector('#syn').textContent`));
    await evaluate(`(()=>{const ta=document.querySelector('.ed.on textarea'); ta.value='local Players = game:GetService("Players")\\nPlayers.'; ta.setSelectionRange(ta.value.length, ta.value.length); ta.dispatchEvent(new Event('input')); return 1})()`);
    ok(await evaluate(`document.querySelector('#ac').style.display === 'block' && /LocalPlayer/.test(document.querySelector('#ac').textContent) && !/BackgroundColor3/.test(document.querySelector('#ac').textContent)`), '打 Players. 之後跳出 Players 服務的成員', await evaluate(`document.querySelector('#ac').textContent.slice(0,120)`));

    console.log('▶ 手機尺寸');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(700);
    ok(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth + 1`), '手機寬度沒有橫向捲動', await evaluate(`document.documentElement.scrollWidth + ' > ' + innerWidth`));
    ok(await evaluate(`document.querySelector('#view').getBoundingClientRect().height > 200`), '3D 畫面在手機上看得到');
    await shot('30-mobile');
    ok(await evaluate('window.__errs.length === 0'), '整段測試沒有 JS 例外', await evaluate('JSON.stringify(window.__errs)'));
  } catch (e) {
    fail++;
    console.log('✗ 例外：' + e.message);
  } finally {
    b.close();
  }
  console.log(`\n通過 ${pass}，失敗 ${fail}；截圖在 ${shotDir}`);
  process.exit(fail ? 1 : 0);
})();
