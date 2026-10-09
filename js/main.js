// 畫面狀態機:主選單 -> 配對畫面 -> 遊戲畫面

// 舊版 Safari 不支援 100dvh,退而求其次用捲動觸發網址列自動收合。
window.addEventListener('load', () => {
  setTimeout(() => window.scrollTo(0, 1), 50);
});
window.addEventListener('orientationchange', () => {
  setTimeout(() => window.scrollTo(0, 1), 50);
});

(function () {
  const screens = {
    menu: document.getElementById('screen-menu'),
    levels: document.getElementById('screen-levels'),
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
  const btnJoin = document.getElementById('btn-join-room');
  const inputCode = document.getElementById('input-room-code');
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

  function createRoomForLevel(level) {
    window.NET_ROLE = 'host';
    window.SELECTED_LEVEL = level;
    const code = pc.createRoom();
    roomCodeDisplay.textContent = code;
    hostView.classList.remove('hidden');
    joinView.classList.add('hidden');
    pairingTitle.textContent = '建立房間';
    pairingStatus.textContent = '';
    showScreen('pairing');
    bindConnEvents();
  }

  btnJoin.addEventListener('click', () => {
    const code = inputCode.value.trim().toUpperCase();
    if (code.length < 4) {
      menuError.textContent = '請輸入正確的房號';
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
  });

  function bindConnEvents() {
    pc.onOpen = () => {
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
    };
  }

  btnCancel.addEventListener('click', () => {
    pc.destroy();
    showScreen('menu');
  });

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

  let gameStarted = false;
  function startGame() {
    if (gameStarted) return;
    gameStarted = true;
    showScreen('game');

    // Phaser 3.80 不會自動處理高解析度螢幕,所以把畫布的實際像素尺寸乘上裝置像素密度,
    // 場景那邊再用 camera zoom 把邏輯座標(還是 0-960 x 0-540)放大回來對應,
    // 這樣座標/佈局資料完全不用改,只有畫面變清晰。
    const dpr = window.devicePixelRatio || 1;
    window.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game-canvas-container',
      width: 960 * dpr,
      height: 540 * dpr,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
      },
      backgroundColor: '#5c8f7a',
      scene: [KitchenScene]
    });

    new InteractButtonUI(document.getElementById('btn-interact'));
  }

  showScreen('menu');

  // 編輯模式裡按了「切到另一關」:頁面重新載入後直接進那一關的編輯模式(見 KitchenScene.js 的 switchEditLevel)。
  const pendingEditLevel = readSession('coopEditLevel');
  if (pendingEditLevel) {
    sessionStorage.removeItem('coopEditLevel');
    rememberLevel(clampLevel(pendingEditLevel));
    startEdit(selectedLevel);
  }
})();
