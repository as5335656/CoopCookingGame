// 畫面狀態機:主選單 -> 配對畫面 -> 遊戲畫面

// 舊版 Safari 不支援 100dvh,退而求其次用捲動觸發網址列自動收合。
window.addEventListener('load', () => {
  setTimeout(() => window.scrollTo(0, 1), 50);
});
window.addEventListener('orientationchange', () => {
  setTimeout(() => window.scrollTo(0, 1), 50);
});

// 手機瀏覽器常常會拿舊的暫存頁面出來用,結果推了新版手機卻還是舊版。
// 所以每次打開主選單都去問伺服器現在是第幾版(VERSION 檔,不走暫存);跟這一頁的版本不一樣,
// 就換一個沒被暫存過的網址(加上 ?r=新版號)重新載入,瀏覽器就會去抓新的。
// 只自動重載一次(記在這個分頁裡),避免伺服器跟暫存一直對不起來的時候無限重載。
(function checkForNewVersion() {
  const label = document.getElementById('version-label');
  const mine = label ? label.textContent.trim() : '';
  if (!mine || !window.fetch) return;
  const search = location.search; // 先記下來:掃 QR code 進來的 ?room= 等一下會被拿掉,重載時要帶回去才會照樣加入房間
  fetch('VERSION?t=' + Date.now(), { cache: 'no-store' })
    .then((res) => (res.ok ? res.text() : ''))
    .then((text) => {
      const latest = text.trim();
      if (!/^\d+\.\d+v$/.test(latest) || latest === mine || window.game) return;
      let tried = null;
      try {
        tried = sessionStorage.getItem('coopReloadedFor');
        sessionStorage.setItem('coopReloadedFor', latest);
      } catch (e) {
        return; // 記不了就不自動重載,免得停不下來
      }
      if (tried === latest) return;
      const params = new URLSearchParams(search);
      params.set('r', latest);
      location.replace(location.pathname + '?' + params.toString());
    })
    .catch(() => {});
})();

(function () {
  const screens = {
    menu: document.getElementById('screen-menu'),
    levels: document.getElementById('screen-levels'),
    lan: document.getElementById('screen-lan'),
    pairing: document.getElementById('screen-pairing'),
    game: document.getElementById('screen-game')
  };

  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  const pc = new PeerConnection();
  window.NET = pc;

  // 關卡(1-1 ~ 1-8):按「建立房間 / 本機測試 / 編輯佈局」之後會先跳出關卡選擇畫面。
  const LEVEL_COUNT_MENU = 8;
  // 上次選的關卡記在這個分頁裡(離開編輯/離開遊戲會重新載入頁面),下次進關卡選擇畫面會框起來。
  const readSession = (key) => {
    try {
      return sessionStorage.getItem(key);
    } catch (e) {
      return null;
    }
  };
  const clampLevel = (n) => Math.min(LEVEL_COUNT_MENU, Math.max(1, Number(n) || 1));
  let selectedLevel = clampLevel(readSession('coopSelectedLevel'));
  function rememberLevel(level) {
    selectedLevel = level;
    try {
      sessionStorage.setItem('coopSelectedLevel', String(level));
    } catch (e) {
      // 存不了就算了,只是下次不會框起來
    }
  }

  // 顯示關卡選擇畫面,選好之後呼叫 onPick(level)。
  // lockByStars:要不要照過關進度上鎖(前一關至少 1 星才開放下一關)。
  const levelGrid = document.getElementById('level-grid');
  function chooseLevel(title, hint, lockByStars, onPick) {
    document.getElementById('levels-title').textContent = title;
    document.getElementById('levels-hint').textContent = hint;
    levelGrid.innerHTML = '';
    for (let level = 1; level <= LEVEL_COUNT_MENU; level++) {
      const stars = Progress.getStars(level);
      const locked = lockByStars && !Progress.isUnlocked(level);
      const btn = document.createElement('button');
      btn.className = 'level-btn' + (level === selectedLevel ? ' current' : '');
      btn.disabled = locked;
      const name = document.createElement('span');
      name.className = 'level-name';
      name.textContent = '1-' + level;
      const starEl = document.createElement('span');
      starEl.className = 'level-stars';
      if (locked) starEl.textContent = '🔒';
      else renderStars(starEl, stars);
      btn.append(name, starEl);
      btn.addEventListener('click', () => {
        rememberLevel(level);
        onPick(level);
      });
      levelGrid.appendChild(btn);
    }
    showScreen('levels');
  }
  document.getElementById('btn-levels-back').addEventListener('click', () => showScreen('menu'));

  const btnCreate = document.getElementById('btn-create-room');
  const menuError = document.getElementById('menu-error');

  const pairingTitle = document.getElementById('pairing-title');
  const hostView = document.getElementById('pairing-host-view');
  const joinView = document.getElementById('pairing-join-view');
  const roomCodeDisplay = document.getElementById('room-code-display');
  const joiningCodeLabel = document.getElementById('joining-code-label');
  const pairingStatus = document.getElementById('pairing-status');
  const btnCancel = document.getElementById('btn-pairing-cancel');

  btnCreate.addEventListener('click', () => {
    menuError.textContent = '';
    chooseLevel('建立房間:選擇關卡', '前一關至少拿到 1 星,下一關才會開放', true, createRoomForLevel);
  });

  // 開房畫面上的房號跟 QR code。QR code 的內容是「這個遊戲的網址 + ?room=房號」,
  // 對方用手機相機一掃就會打開遊戲並直接加入(見最下面的 autoJoinFromLink),不用打字。
  function showRoomCode(code) {
    roomCodeDisplay.textContent = code;
    const img = document.getElementById('room-qr');
    try {
      const qr = qrcode(0, 'M');
      qr.addData(location.origin + location.pathname + '?room=' + code);
      qr.make();
      img.src = qr.createDataURL(6, 2);
      img.style.display = '';
    } catch (e) {
      img.style.display = 'none'; // 產生不出來就只顯示房號
    }
  }

  function createRoomForLevel(level) {
    window.NET_ROLE = 'host';
    window.SELECTED_LEVEL = level;
    showRoomCode(pc.createRoom());
    // 掛上「區域網路」的招牌:同一個 Wi-Fi 的人按「區域網路」就看得到這間房(掛不上也沒關係,還有房號跟 QR code)。
    LanLobby.advertise(() => ({ code: pc.roomCode, name: playerName(), level: window.SELECTED_LEVEL }));
    hostView.classList.remove('hidden');
    joinView.classList.add('hidden');
    pairingTitle.textContent = '建立房間';
    pairingStatus.textContent = '';
    showScreen('pairing');
    bindConnEvents();
  }

  // 打字時鍵盤會蓋住畫面(手機橫放時只剩上面一小條):把主選單縮成只剩輸入框那一排,
  // 並對齊到鍵盤上方實際看得到的區域(visualViewport),輸入框跟「加入房間」才點得到。
  const vv = window.visualViewport;
  function fitMenuToKeyboard() {
    if (!screens.menu.classList.contains('typing')) return;
    screens.menu.style.top = (vv ? vv.offsetTop : 0) + 'px';
    screens.menu.style.height = (vv ? vv.height : window.innerHeight) + 'px';
    window.scrollTo(0, 0);
  }
  let typingOffTimer = null;
  const inputName = document.getElementById('input-player-name');
  const typingInputs = [inputName];
  for (const input of typingInputs) {
    input.addEventListener('focus', () => {
      clearTimeout(typingOffTimer);
      for (const other of typingInputs) other.closest('.panel').classList.toggle('typing-now', other === input);
      screens.menu.classList.add('typing');
      fitMenuToKeyboard();
    });
  }
  const endTyping = () => {
    // 晚一點再還原:馬上還原的話畫面會跳一下,剛好點在按鈕上的那一下會點空。
    typingOffTimer = setTimeout(() => {
      for (const other of typingInputs) other.closest('.panel').classList.remove('typing-now');
      screens.menu.classList.remove('typing');
      screens.menu.style.top = '';
      screens.menu.style.height = '';
    }, 300);
  };
  if (vv) {
    vv.addEventListener('resize', fitMenuToKeyboard);
    vv.addEventListener('scroll', fitMenuToKeyboard);
  }
  for (const input of typingInputs) input.addEventListener('blur', endTyping);

  // 玩家名稱:開房時顯示在對方的「區域網路」清單上。記在這台裝置的瀏覽器裡,沒填就叫「玩家」。
  const NAME_KEY = 'coopCookingName';
  try {
    inputName.value = localStorage.getItem(NAME_KEY) || '';
  } catch (e) {
    // 讀不到就空著
  }
  const playerName = () => inputName.value.trim().slice(0, 12) || '玩家';
  inputName.addEventListener('change', () => {
    try {
      localStorage.setItem(NAME_KEY, inputName.value.trim().slice(0, 12));
    } catch (e) {
      // 存不了就算了
    }
  });
  inputName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') inputName.blur();
  });

  // 區域網路:列出同一個 Wi-Fi 底下正在開的房間,點一下就加入(做法見 LanLobby.js)。
  const lanStatus = document.getElementById('lan-status');
  const lanList = document.getElementById('lan-list');
  function scanLan() {
    lanList.textContent = '';
    lanStatus.textContent = '正在找房間...';
    let found = 0;
    LanLobby.scan(
      (room) => {
        found += 1;
        const btn = document.createElement('button');
        btn.className = 'lan-room';
        const who = document.createElement('span');
        who.textContent = room.name + ' 的房間';
        const detail = document.createElement('span');
        detail.className = 'lan-room-detail';
        detail.textContent = '關卡 1-' + room.level + ' · 房號 ' + room.code;
        btn.append(who, detail);
        btn.addEventListener('click', () => {
          LanLobby.stopScanning();
          joinRoomCode(room.code);
        });
        lanList.appendChild(btn);
        lanStatus.textContent = '點一個房間加入';
      },
      (reason) => {
        if (reason === 'no-network') lanStatus.textContent = '查不到這台裝置的網路資訊,區域網路這次不能用。請對方開房後讓你掃 QR code。';
        else if (reason === 'error') lanStatus.textContent = '連不上配對伺服器,請確認網路後按「重新整理」。';
        else if (found === 0) lanStatus.textContent = '沒有找到房間。請確認對方已經開房,而且兩台連的是同一個 Wi-Fi。';
      }
    );
  }
  document.getElementById('btn-lan').addEventListener('click', () => {
    menuError.textContent = '';
    showScreen('lan');
    scanLan();
  });
  document.getElementById('btn-lan-refresh').addEventListener('click', scanLan);
  document.getElementById('btn-lan-back').addEventListener('click', () => {
    LanLobby.stopScanning();
    showScreen('menu');
  });

  // 加入房間:主選單沒有輸入房號的地方了,房號是從「區域網路」清單或 QR code 的連結(?room=)帶進來的。
  function joinRoomCode(rawCode) {
    const code = String(rawCode || '').trim().toUpperCase();
    if (code.length < 4) {
      menuError.textContent = '房號不正確';
      return;
    }
    menuError.textContent = '';
    // 加入的人不用選關卡:連上之後由開房的人告訴我們玩哪一關(見 bindConnEvents)。
    window.NET_ROLE = 'joiner';
    pc.joinRoom(code);
    joiningCodeLabel.textContent = code;
    hostView.classList.add('hidden');
    joinView.classList.remove('hidden');
    pairingTitle.textContent = '加入房間';
    pairingStatus.textContent = '正在連線...';
    showScreen('pairing');
    bindConnEvents();
  }

  function bindConnEvents() {
    pc.onOpen = () => {
      LanLobby.stopAdvertising(); // 人到齊了,房間不用再出現在清單上
      if (window.NET_ROLE === 'host') {
        // 開房的人選的關卡要先告訴對方,兩邊才會進同一關。佈局也一起傳過去:
        // 自訂佈局只存在各自的瀏覽器裡,不傳的話對方會用它自己那一份(或內建的),兩邊站點位置對不起來。
        loadLevelLayout(window.SELECTED_LEVEL);
        pc.send({ type: 'hello', level: window.SELECTED_LEVEL, layout: JSON.parse(JSON.stringify(STATION_LAYOUT)) });
        GameSync.init(pc, 'host');
        startGame();
        return;
      }
      // 加入的人:等開房的人說玩哪一關再開始。等不到(對方是舊版)就照舊從 1-1 開始。
      const begin = (level, layout) => {
        if (gameStarted) return;
        window.SELECTED_LEVEL = clampLevel(level);
        window.HOST_LAYOUT = layout || null;
        GameSync.init(pc, 'joiner');
        startGame();
      };
      pc.onData = (msg) => {
        if (msg && msg.type === 'hello') begin(msg.level, msg.layout);
      };
      pairingStatus.textContent = '已連線,等待對方的關卡資訊...';
      setTimeout(() => begin(1), 3000);
    };
    pc.onError = (message) => {
      pairingStatus.textContent = message;
    };
    pc.onClose = () => {
      pairingStatus.textContent = '連線已中斷';
      peerLeft();
    };
  }

  btnCancel.addEventListener('click', () => {
    LanLobby.stopAdvertising();
    pc.destroy();
    showScreen('menu');
  });

  // 編輯佈局是開發用的:只在電腦上顯示,手機(跟平板)打開看不到。本機測試目前在手機上也開著(方便一支手機自己測)。
  // 判斷方式:瀏覽器自己報的裝置類型是手機/平板(iPad 會自稱 Mac,所以另外用「Mac + 多點觸控」認)。
  // 要在手機上用編輯佈局,網址後面加 ?dev=1 就會顯示。
  const ua = navigator.userAgent || '';
  const isPhoneOrTablet = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  const PHONE_HIDDEN_BUTTONS = ['btn-edit-layout']; // 要把本機測試也藏起來,就把 'btn-local-test' 加回這裡
  const showDevTools = !isPhoneOrTablet || /[?&]dev=1(&|$)/.test(location.search);
  if (!showDevTools) {
    for (const id of PHONE_HIDDEN_BUTTONS) {
      const panel = document.getElementById(id).closest('.panel');
      if (panel) panel.style.display = 'none';
    }
  }

  // 本機測試跟編輯佈局是開發用的,所有關卡都可以直接選,不受過關進度限制。
  document.getElementById('btn-local-test').addEventListener('click', () => {
    menuError.textContent = '';
    chooseLevel('本機測試:選擇關卡', '測試用,所有關卡都可以直接玩', false, (level) => {
      window.NET_ROLE = 'host';
      window.LOCAL_TEST_MODE = true;
      window.SELECTED_LEVEL = level;
      startGame();
    });
  });

  function startEdit(level) {
    window.NET_ROLE = 'host';
    window.LOCAL_TEST_MODE = true;
    window.EDIT_MODE = true;
    window.SELECTED_LEVEL = level;
    startGame();
  }

  document.getElementById('btn-edit-layout').addEventListener('click', () => {
    menuError.textContent = '';
    chooseLevel('編輯佈局:選擇關卡', '進去之後也可以用面板上的 ◀ ▶ 切換關卡', false, startEdit);
  });

  document.getElementById('btn-exit-edit').addEventListener('click', () => {
    location.reload();
  });

  const MAX_RENDER_SCALE = 2;
  // 遊戲畫面的寬高(世界座標):場地是 x = WORLD_MIN_X ~ WORLD_MAX_X(見 KitchenScene.js),所有裝置都一樣,比 16:9 寬一點。
  const GAME_VIEW_W = WORLD_MAX_X - WORLD_MIN_X;
  const GAME_VIEW_H = 540;

  // 排查「玩到一半跳回主選單」用:遊戲開始時留一個記號,正常離開頁面(pagehide)時清掉。
  // 如果回到主選單時記號還在,代表上一局是被瀏覽器強制重新載入的(通常是記憶體不足),在主選單上講清楚。
  const RUNNING_KEY = 'coopGameRunning';
  function markGameRunning() {
    try {
      localStorage.setItem(RUNNING_KEY, window.NET_ROLE || '?');
    } catch (e) {
      // 存不了就沒有這個提示而已
    }
  }
  window.addEventListener('pagehide', () => {
    // 直接關掉分頁或重新整理也算離開:盡量跟對方道別(送不出去的話,對方要等連線自己斷才會知道)。
    if (gameStarted && !leaving && !window.LOCAL_TEST_MODE) GameSync.sendBye();
    try {
      localStorage.removeItem(RUNNING_KEY);
    } catch (e) {
      // 忽略
    }
  });
  try {
    if (localStorage.getItem(RUNNING_KEY)) {
      localStorage.removeItem(RUNNING_KEY);
      menuError.textContent = '上一局不正常結束:瀏覽器把頁面重新載入了(通常是手機記憶體不足)。請關掉其他分頁跟 App 再試一次。';
    }
  } catch (e) {
    // 忽略
  }

  // 程式出錯時把錯誤訊息直接顯示在畫面上(手機上看不到主控台),方便回報。
  function showScriptError(text) {
    let box = document.getElementById('script-error');
    if (!box) {
      box = document.createElement('div');
      box.id = 'script-error';
      box.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:9999;max-width:70%;padding:4px 6px;font-size:11px;color:#fff;background:rgba(160,0,0,0.85);border-radius:4px;pointer-events:none;';
      document.body.appendChild(box);
    }
    box.textContent = '錯誤:' + text;
  }
  window.addEventListener('error', (e) => {
    if (!e.message) return; // 圖片/音效載入失敗也會觸發 error,那種沒有 message
    showScriptError(e.message + ' (' + String(e.filename || '').split('/').pop().split('?')[0] + ':' + e.lineno + ')');
  });
  window.addEventListener('unhandledrejection', (e) => {
    showScriptError(String((e.reason && e.reason.message) || e.reason));
  });

  // 把放畫布的外框直接設成「現在真的看得到的區域」(visualViewport)的位置跟大小,用像素寫死。
  // 不靠 CSS 的 100% / 100dvh:iPhone Safari 上那個高度會比實際看得到的還高,Phaser 照外框縮放,畫布就超出螢幕被切掉。
  const canvasBox = document.getElementById('game-canvas-container');
  const screenDiag = document.getElementById('screen-diag');
  let lastBox = '';
  function fitGameToScreen() {
    const view = window.visualViewport;
    const fullW = Math.floor(view ? view.width : window.innerWidth);
    const h = Math.floor(view ? view.height : window.innerHeight);
    const viewLeft = Math.round(view ? view.offsetLeft : 0);
    const top = Math.round(view ? view.offsetTop : 0);
    // 螢幕比遊戲畫面寬的時候(手機橫放、超寬螢幕),多出來的寬度左右各一半當黑邊,遊戲畫面置中。
    // (iPhone 橫放時每邊的黑邊比鏡頭那一段還寬,所以鏡頭不會擋到遊戲。)
    const w = Math.min(fullW, Math.floor((h * GAME_VIEW_W) / GAME_VIEW_H));
    const bar = fullW - w;
    const barLeft = Math.floor(bar / 2);
    const left = viewLeft + barLeft;
    // 上方的時間/金額列跟著遊戲畫面對齊,不要壓在黑邊上。
    const hud = document.getElementById('hud-overlay');
    if (hud) Object.assign(hud.style, { left: barLeft + 'px', right: bar - barLeft + 'px', paddingLeft: '16px', paddingRight: '16px' });
    const key = [w, h, left, top].join(',');
    if (key !== lastBox && w > 0 && h > 0) {
      lastBox = key;
      Object.assign(canvasBox.style, { position: 'fixed', left: left + 'px', top: top + 'px', right: 'auto', bottom: 'auto', width: w + 'px', height: h + 'px' });
    }
    // 暫停選單最下面那行小字:畫面尺寸的診斷資訊,畫面跑掉的時候截圖回報用。
    if (screenDiag) {
      const canvas = canvasBox.querySelector('canvas');
      const r = canvas ? canvas.getBoundingClientRect() : null;
      const g = screens.game.getBoundingClientRect();
      screenDiag.textContent =
        'win ' + window.innerWidth + 'x' + window.innerHeight +
        ' | view ' + (view ? Math.round(view.width) + 'x' + Math.round(view.height) + '+' + left + '+' + top + ' x' + view.scale.toFixed(2) : '-') +
        ' | page ' + Math.round(g.width) + 'x' + Math.round(g.height) + ' scroll ' + Math.round(window.scrollX) + ',' + Math.round(window.scrollY) +
        ' | canvas ' + (r ? Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) : '-') +
        ' | dpr ' + window.devicePixelRatio + ' scr ' + screen.width + 'x' + screen.height;
    }
  }

  // 遊戲的音訊系統自己建一個、每次建遊戲都傳同一個進去:換關卡要把整個 Phaser 遊戲拆掉重建,
  // 讓 Phaser 自己建的話會跟著被關掉,手機上新的要等使用者再碰一次畫面才有聲音,背景音樂的音量控制也會斷線。
  let sharedAudioContext = null;
  function getAudioContext() {
    if (!sharedAudioContext) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (Ctor) {
        try {
          sharedAudioContext = new Ctor();
        } catch (e) {
          sharedAudioContext = null;
        }
      }
    }
    return sharedAudioContext;
  }

  // 遊戲中有一方離開,另一方也直接結束、回主選單(一個人留在場上也玩不了)。
  // 回主選單一律用重新載入頁面;要顯示在主選單上的那句話先存起來,載入後再拿出來顯示。
  const NOTICE_KEY = 'coopMenuNotice';
  let leaving = false;
  function reloadToMenu(notice) {
    if (leaving) return;
    leaving = true;
    try {
      if (notice) sessionStorage.setItem(NOTICE_KEY, notice);
    } catch (e) {
      // 存不了就只是沒有那句話
    }
    location.reload();
  }
  // 對方離開了(收到對方的道別,或連線斷了)。還沒進遊戲的話不處理,配對畫面上已經有顯示連線狀態。
  function peerLeft() {
    if (!gameStarted || window.LOCAL_TEST_MODE) return;
    reloadToMenu('對方已離開遊戲,連線已中斷。');
  }
  GameSync.onPeerLeft = peerLeft;
  // 自己離開(暫停選單的「離開遊戲」、結算畫面的「回主畫面」):先跟對方道別再回主選單。
  window.leaveToMenu = () => {
    if (leaving) return;
    if (gameStarted && !window.LOCAL_TEST_MODE) {
      GameSync.sendBye();
      leaving = true;
      setTimeout(() => location.reload(), 200); // 等道別送出去
      return;
    }
    reloadToMenu(null);
  };
  try {
    const notice = sessionStorage.getItem(NOTICE_KEY);
    if (notice) {
      sessionStorage.removeItem(NOTICE_KEY);
      menuError.textContent = notice;
    }
  } catch (e) {
    // 忽略
  }

  window.getSharedAudioContext = getAudioContext; // 背景音樂(Bgm.js)也用同一個,主選單就能調音量

  let gameStarted = false;
  let screenListenersBound = false;
  function startGame() {
    if (gameStarted) return;
    gameStarted = true;
    showScreen('game');
    buildGame();

    if (!screenListenersBound) {
      screenListenersBound = true;
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', fitGameToScreen);
        window.visualViewport.addEventListener('scroll', fitGameToScreen);
      }
      window.addEventListener('resize', fitGameToScreen);
      window.addEventListener('orientationchange', fitGameToScreen);
      setInterval(fitGameToScreen, 500); // 手機轉向時瀏覽器回報的尺寸有時會慢半拍,定時再對一次
    }
  }

  // 換到另一關(結算畫面的「下一關」):把現在的 Phaser 遊戲整個拆掉,照新的關卡重建一個。連線留著不動。
  // 開房的人(或本機測試)呼叫 window.goToLevel(level);連線時它會先把關卡跟佈局傳給對方,對方收到後也走這裡重建。
  let rebuilding = false;
  function rebuildGame(level, layout) {
    if (!gameStarted || rebuilding) return;
    rebuilding = true;
    window.SELECTED_LEVEL = clampLevel(level);
    window.HOST_LAYOUT = layout || null;
    rememberLevel(window.SELECTED_LEVEL);
    document.getElementById('result-overlay').classList.add('hidden');
    document.getElementById('pause-overlay').classList.add('hidden');
    const old = window.game;
    const next = () => {
      rebuilding = false;
      lastBox = ''; // 外框的大小要重新套一次,Phaser 才會照它縮放新的畫布
      buildGame();
    };
    if (!old) {
      next();
      return;
    }
    old.sound.stopAll();
    old.events.once(Phaser.Core.Events.DESTROY, () => setTimeout(next, 0));
    old.destroy(true);
  }
  window.goToLevel = (level) => {
    const target = clampLevel(level);
    if (window.NET_ROLE === 'host' && !window.LOCAL_TEST_MODE) {
      loadLevelLayout(target);
      GameSync.sendLevel(target, JSON.parse(JSON.stringify(STATION_LAYOUT)));
    }
    rebuildGame(target, null);
  };
  GameSync.onLevelChange = (level, layout) => rebuildGame(level, layout);

  function buildGame() {

    // Phaser 3.80 不會自動處理高解析度螢幕,所以把畫布的實際像素尺寸乘上裝置像素密度,
    // 場景那邊再用 camera zoom 把邏輯座標(還是 0-960 x 0-540)放大回來對應,
    // 這樣座標/佈局資料完全不用改,只有畫面變清晰。
    // 上限 2 倍:iPhone 是 3 倍,照 3 倍畫布會是 2880x1620,加上貼圖很吃記憶體,
    // Safari 記憶體不夠時會直接把頁面重新載入(看起來就是「閃退回主選單」)。2 倍(1920x1080)肉眼幾乎看不出差別。
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_RENDER_SCALE);
    window.RENDER_SCALE = dpr;
    markGameRunning();
    const audioContext = getAudioContext();
    window.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game-canvas-container',
      width: GAME_VIEW_W * dpr,
      height: 540 * dpr,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
      },
      backgroundColor: '#5c8f7a',
      audio: audioContext ? { context: audioContext } : {},
      scene: [KitchenScene]
    });

    fitGameToScreen();
  }

  showScreen('menu');
  Bgm.startMenu(); // 主選單音樂(進遊戲後 KitchenScene 會換成廚房音樂)

  // 掃 QR code 或點分享的連結進來的(網址有 ?room=房號):直接加入那個房間。
  // 加入前先把網址上的 ?room= 拿掉,之後離開遊戲(重新載入頁面)才不會又自動連進去。
  (function autoJoinFromLink() {
    const m = /[?&]room=([A-Za-z0-9]{4,6})(&|$)/.exec(location.search);
    if (!m) return;
    try {
      history.replaceState(null, '', location.pathname);
    } catch (e) {
      // 改不了網址就算了
    }
    joinRoomCode(m[1]);
  })();

  // 編輯模式裡按了「切到另一關」:頁面重新載入後直接進那一關的編輯模式(見 KitchenScene.js 的 switchEditLevel)。
  const pendingEditLevel = readSession('coopEditLevel');
  if (pendingEditLevel) {
    sessionStorage.removeItem('coopEditLevel');
    rememberLevel(clampLevel(pendingEditLevel));
    startEdit(selectedLevel);
  }
})();
