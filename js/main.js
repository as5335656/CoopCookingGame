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
    pairing: document.getElementById('screen-pairing'),
    game: document.getElementById('screen-game')
  };

  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  const pc = new PeerConnection();
  window.NET = pc;

  // 關卡選擇(1-1 ~ 1-8),四個進遊戲的按鈕都會用目前選到的關卡。
  const LEVEL_COUNT_MENU = 8;
  let selectedLevel = 1;
  const levelDisplay = document.getElementById('level-display');
  function renderLevelDisplay() {
    levelDisplay.textContent = '1-' + selectedLevel;
  }
  document.getElementById('btn-level-minus').addEventListener('click', () => {
    selectedLevel = Math.max(1, selectedLevel - 1);
    renderLevelDisplay();
  });
  document.getElementById('btn-level-plus').addEventListener('click', () => {
    selectedLevel = Math.min(LEVEL_COUNT_MENU, selectedLevel + 1);
    renderLevelDisplay();
  });

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
    window.NET_ROLE = 'host';
    window.SELECTED_LEVEL = selectedLevel;
    const code = pc.createRoom();
    roomCodeDisplay.textContent = code;
    hostView.classList.remove('hidden');
    joinView.classList.add('hidden');
    pairingTitle.textContent = '建立房間';
    pairingStatus.textContent = '';
    showScreen('pairing');
    bindConnEvents();
  });

  btnJoin.addEventListener('click', () => {
    const code = inputCode.value.trim().toUpperCase();
    if (code.length < 4) {
      menuError.textContent = '請輸入正確的房號';
      return;
    }
    menuError.textContent = '';
    window.NET_ROLE = 'joiner';
    window.SELECTED_LEVEL = selectedLevel;
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
      GameSync.init(pc, window.NET_ROLE);
      startGame();
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

  document.getElementById('btn-local-test').addEventListener('click', () => {
    menuError.textContent = '';
    window.NET_ROLE = 'host';
    window.LOCAL_TEST_MODE = true;
    window.SELECTED_LEVEL = selectedLevel;
    startGame();
  });

  document.getElementById('btn-edit-layout').addEventListener('click', () => {
    menuError.textContent = '';
    window.NET_ROLE = 'host';
    window.LOCAL_TEST_MODE = true;
    window.EDIT_MODE = true;
    window.SELECTED_LEVEL = selectedLevel;
    startGame();
  });

  document.getElementById('btn-exit-edit').addEventListener('click', () => {
    location.reload();
  });

  let gameStarted = false;
  function startGame() {
    if (gameStarted) return;
    gameStarted = true;
    showScreen('game');

    window.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game-canvas-container',
      width: 960,
      height: 540,
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
})();
