// 量各關的三星門檻:開一個看不到畫面的瀏覽器,讓兩個自動玩家(sim-bot.js)把每一關各玩很多局,
// 印出收入統計跟照規則算出來的建議門檻。規則寫在 docs/LEVEL_DESIGN_RULES.md 的「星數門檻」。
//
// 用法(先在另一個視窗跑 `node dev-server.js`):
//   node tools/star-sim/run-sim.js            # 每關 40 局
//   node tools/star-sim/run-sim.js 100        # 每關 100 局
//
// 這個瀏覽器用的是系統暫存資料夾裡的獨立設定檔,所以量的一定是「內建佈局」,
// 不會讀到、也不會動到你平常用的瀏覽器裡存的佈局跟過關進度。
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RUNS = Number(process.argv[2]) || 40;
const GAME_URL = 'http://localhost:3000/';
const PORT = 9355;
const FAST_REACTION_MS = 150; // 反應快的玩家:每個動作多花的時間
const SLOW_REACTION_MS = 900; // 反應慢的玩家
const browser = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const roundTo5 = (n) => Math.round(n / 5) * 5;

(async () => {
  if (!browser) throw new Error('找不到 Chrome 或 Edge');
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coop-star-sim-'));
  const proc = spawn(browser, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`, '--window-size=960,540', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  try {
    let target;
    for (let i = 0; i < 40 && !target; i++) {
      await sleep(250);
      try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page'); } catch (e) { /* 瀏覽器還沒開好 */ }
    }
    if (!target) throw new Error('瀏覽器沒有成功啟動');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    let nextId = 1;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    });
    const send = (method, params = {}) => new Promise((res) => { const id = nextId++; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true });
      if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
      return r.result.result.value;
    };

    await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
    const sim = fs.readFileSync(path.join(__dirname, 'sim-bot.js'), 'utf8');
    // 等某個條件成立(頁面載入、畫面切換都要時間;瀏覽器剛啟動的第一次特別慢,不能用固定的等待時間)。
    const waitFor = async (expression, what) => {
      for (let i = 0; i < 120; i++) {
        try { if (await evaluate(expression)) return; } catch (e) { /* 頁面還沒準備好 */ }
        await sleep(250);
      }
      throw new Error('等不到:' + what);
    };
    await send('Page.navigate', { url: GAME_URL });
    await waitFor(`document.readyState === 'complete' && typeof LEVEL_COUNT !== 'undefined' && typeof Progress !== 'undefined'`, '遊戲頁面載入');
    const levelCount = await evaluate('LEVEL_COUNT');

    const stat = (a) => {
      const sorted = [...a].sort((x, y) => x - y);
      return { mean: Math.round(a.reduce((x, y) => x + y, 0) / a.length), min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted[sorted.length - 1] };
    };
    console.log(`每關 ${RUNS} 局。門檻訂法:1 星 = 慢玩家中位數 x 0.5,2 星 = 慢玩家中位數 x 0.85,3 星 = 快玩家平均 x 0.85(都取到 5 的倍數)\n`);
    const suggested = {};
    for (let level = 1; level <= levelCount; level++) {
      await send('Page.navigate', { url: `${GAME_URL}?level=${level}&t=${Date.now()}` });
      await waitFor(`document.readyState === 'complete' && typeof Progress !== 'undefined' && !window.game`, '遊戲頁面載入');
      await evaluate(`document.getElementById('btn-local-test').click(); 1`);
      await waitFor(`document.querySelectorAll('.level-btn').length >= ${level}`, '選關畫面');
      await evaluate(`[...document.querySelectorAll('.level-btn')][${level - 1}].click(); 1`);
      await waitFor(`!!(window.game && window.game.scene.scenes[0] && window.game.scene.scenes[0].stationSprites && window.game.scene.scenes[0].walkGrid)`, '場景建立');
      let data;
      try {
        data = JSON.parse(await evaluate(`${sim}; JSON.stringify({ fast: window.simulateLevel(${RUNS}, ${FAST_REACTION_MS}), slow: window.simulateLevel(${RUNS}, ${SLOW_REACTION_MS}) })`));
      } catch (e) {
        console.log(`1-${level} 模擬失敗:${e.message.split('\n')[0]}`);
        continue;
      }
      const fast = stat(data.fast);
      const slow = stat(data.slow);
      suggested[level] = [roundTo5(slow.median * 0.5), roundTo5(slow.median * 0.85), roundTo5(fast.mean * 0.85)];
      console.log(`1-${level}  快玩家 平均 $${fast.mean}(${fast.min}~${fast.max})  慢玩家 中位數 $${slow.median}(${slow.min}~${slow.max})  建議門檻 ${JSON.stringify(suggested[level])}`);
    }
    console.log('\n貼到 js/game/Progress.js 的 LEVEL_STAR_SCORES(每次結果會有幾塊錢的浮動,差不多就不用改):');
    console.log(JSON.stringify(suggested).replace(/"(\d+)":/g, '\n  $1: ').replace('}', '\n}'));
    ws.close();
  } finally {
    proc.kill();
    await sleep(500);
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3 });
  }
})().catch((e) => { console.error('失敗:', e.message); process.exit(1); });
