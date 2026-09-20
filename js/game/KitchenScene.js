// 廚房場景:場景佈局、玩家移動、站點渲染、與 GameSync 對接。
// 佈局對應參考截圖:左側料理站、中間出餐口、右側外場桌位(顧客主要從右側/門口進來)。

const WORLD_W = 960;
const WORLD_H = 540;
const MOVE_SPEED = 220; // px/sec
const INTERACT_RADIUS = 72; // 點擊判定用:離站點多近算是點到它
const ARRIVE_AT_APPROACH_DIST = 16; // 走位判定用:離「站點面前的走位點」多近算是走到定位、可以觸發互動
const MOVE_ARRIVE_DIST = 4;
const PLAYER_SIZE = 64; // 角色碰撞用的方形邊長,跟顯示大小一致
const MOVE_STUCK_TIMEOUT_MS = 2500; // 如果因為碰撞卡住太久走不到目標,直接放行,避免永久卡死
const EDIT_GRID_SIZE = 8; // 編輯模式拖曳物件時,座標會對齊到這個格線大小,方便排整齊

// 中間走道兩邊都不能穿越,雙方各自鎖在自己的區域,只能靠出餐口交接東西。
const ZONE_MAX_X = { host: 450, joiner: WORLD_W - 30 };
const ZONE_MIN_X = { host: 30, joiner: 510 };

// 佈局參考截圖:廚房設備排成流理台式的 2 列(不是單排一直線),
// 中間走道垂直分隔廚房與外場,外場桌位一上一下錯開擺放。
// 這是「預設樣板」,8 關一開始都先複製這份當起點,之後各關可以用編輯模式各自客製化。
const DEFAULT_STATION_LAYOUT = {
  ingredient_potato: { x: 110, y: 160, type: 'ingredient_source', itemType: 'potato_raw', emoji: '🥔', label: '材料箱' },
  fryer_1: { x: 230, y: 160, type: 'cooking', recipeId: 'fries', emoji: '🍳', label: '油炸鍋' },
  plate_stack: { x: 350, y: 160, type: 'plate_stack', emoji: '🍽️', label: '取盤' },
  trash_bin: { x: 110, y: 400, type: 'trash', emoji: '🗑️', label: '垃圾桶' },
  workbench_1: { x: 230, y: 400, type: 'workbench', emoji: '', label: '工作台' },

  pass_window: { x: 480, y: 300, type: 'pass_window', emoji: '🛎️', label: '出餐口' },

  drink_dispenser: { x: 850, y: 150, type: 'dispenser', recipeId: 'drink', emoji: '🥤', label: '飲料機' },
  table_1: { x: 650, y: 220, type: 'table', customerEmoji: '🐼', label: '桌位1' },
  table_2: { x: 850, y: 420, type: 'table', customerEmoji: '🐧', label: '桌位2' }
};

const LEVEL_COUNT = 8;

// 1-1:漢堡關卡。左側(host/廚房)放 6 個材料箱 + 通用平底鍋 + 鉆板 + 取盤 + 垃圾桶,
// 右側(joiner/外場)放 6 張顧客桌位,中間靠出餐口交接。
const LEVEL_1_LAYOUT = {
  src_beef: { x: 70, y: 90, type: 'ingredient_source', itemType: 'beef_raw', label: '生牛肉', size: 64 },
  src_chicken: { x: 150, y: 90, type: 'ingredient_source', itemType: 'chicken_raw', label: '生雞肉', size: 64 },
  src_tomato: { x: 230, y: 90, type: 'ingredient_source', itemType: 'tomato_raw', label: '番茄', size: 64 },
  src_lettuce: { x: 310, y: 90, type: 'ingredient_source', itemType: 'lettuce', label: '生菜', size: 64 },
  src_cheese: { x: 390, y: 90, type: 'ingredient_source', itemType: 'cheese', label: '起士', size: 64 },
  src_bun: { x: 70, y: 245, type: 'ingredient_source', itemType: 'bun', label: '漢堡', size: 64 },
  pan_1: { x: 185, y: 245, type: 'cooking', img: 'equip_pan', label: '平底鍋', size: 72 },
  cutting_board_1: { x: 300, y: 245, type: 'cutting', img: 'equip_cutting_board', label: '鉆板', size: 72 },
  plate_stack: { x: 410, y: 245, type: 'plate_stack', img: 'equip_plate', label: '取盤', size: 64 },
  trash_bin: { x: 250, y: 365, type: 'trash', emoji: '🗑️', label: '垃圾桶', size: 64 },
  pass_window: { x: 480, y: 300, type: 'pass_window', emoji: '🛎️', label: '出餐口', size: 72 },

  table_1: { x: 610, y: 100, type: 'table', customerEmoji: '🐼', label: '桌位1', size: 72 },
  table_2: { x: 850, y: 100, type: 'table', customerEmoji: '🐧', label: '桌位2', size: 72 },
  table_3: { x: 610, y: 270, type: 'table', customerEmoji: '🐰', label: '桌位3', size: 72 },
  table_4: { x: 850, y: 270, type: 'table', customerEmoji: '🐨', label: '桌位4', size: 72 },
  table_5: { x: 610, y: 440, type: 'table', customerEmoji: '🐷', label: '桌位5', size: 72 },
  table_6: { x: 850, y: 440, type: 'table', customerEmoji: '🦊', label: '桌位6', size: 72 }
};

// 8 關各自一份佈局資料。1-1 用上面設計好的版本,其餘還沒客製化的關卡先複製預設樣板當起點。
const LEVEL_LAYOUTS = { 1: LEVEL_1_LAYOUT };
for (let i = 2; i <= LEVEL_COUNT; i++) {
  LEVEL_LAYOUTS[i] = JSON.parse(JSON.stringify(DEFAULT_STATION_LAYOUT));
}

// 實際場景讀取的佈局物件,內容在載入某一關時才會被填入(見 loadLevelLayout)。
const STATION_LAYOUT = {};

// 編輯模式存的佈局只在「這台裝置/瀏覽器」裡有效(用 localStorage,依關卡分開存),
// 重新整理網頁不會不見,但不會同步給別台裝置——要讓兩支手機都看到同一份佈局,
// 還是要把「複製佈局」的結果貼給開發者,寫進程式碼裡正式部署。
const LAYOUT_STORAGE_PREFIX = 'coopCookingLayout_level_';

function applyLayoutData(layoutData) {
  for (const key in STATION_LAYOUT) delete STATION_LAYOUT[key];
  Object.assign(STATION_LAYOUT, layoutData);
}

function loadLevelLayout(levelNum) {
  const base = LEVEL_LAYOUTS[levelNum] || LEVEL_LAYOUTS[1];
  applyLayoutData(base);

  let saved;
  try {
    saved = localStorage.getItem(LAYOUT_STORAGE_PREFIX + levelNum);
  } catch (e) {
    return; // 部分瀏覽器情境(例如無痕模式)可能無法存取 localStorage
  }
  if (!saved) return;
  try {
    applyLayoutData(JSON.parse(saved));
  } catch (e) {
    // 儲存內容壞掉就當作沒有,繼續用這一關內建的預設佈局
  }
}

const PLAYER_SPAWN = {
  host: { x: 220, y: 300 },
  joiner: { x: 620, y: 400 }
};

// 角色圖片:依移動方向切換 left/right,靜止時用 idle。
const PLAYER_TEXTURES = {
  host: { left: 'p1_left', right: 'p1_right', idle: 'p1_idle' },
  joiner: { left: 'p2_left', right: 'p2_right', idle: 'p2_idle' }
};
const FACING_CHANGE_THRESHOLD = 0.4; // px/frame,超過這個位移量才判斷是在往左/往右走

// 編輯模式底下「新增物件」的可選類型清單。
// 桌子/檯面是地基,要先放;其他廚具要先點選種類(會標記成選取中),再點一個空桌子把它放上去。
const STATION_TYPE_PALETTE = [
  { type: 'counter', shortLabel: '桌子(先放這個)' },
  { type: 'ingredient_source', itemType: 'potato_raw', emoji: '🥔', shortLabel: '馬鈴薯箱' },
  { type: 'ingredient_source', itemType: 'beef_raw', shortLabel: '生牛肉箱' },
  { type: 'ingredient_source', itemType: 'chicken_raw', shortLabel: '生雞肉箱' },
  { type: 'ingredient_source', itemType: 'tomato_raw', shortLabel: '番茄箱' },
  { type: 'ingredient_source', itemType: 'lettuce', shortLabel: '生菜箱' },
  { type: 'ingredient_source', itemType: 'cheese', shortLabel: '起士箱' },
  { type: 'ingredient_source', itemType: 'bun', shortLabel: '漢堡箱' },
  { type: 'cooking', recipeId: 'fries', emoji: '🍳', shortLabel: '油炸鍋' },
  { type: 'cooking', img: 'equip_pan', shortLabel: '平底鍋' },
  { type: 'cutting', img: 'equip_cutting_board', shortLabel: '鉆板' },
  { type: 'plate_stack', img: 'equip_plate', shortLabel: '取盤' },
  { type: 'trash', emoji: '🗑️', shortLabel: '垃圾桶' },
  { type: 'workbench', emoji: '', shortLabel: '工作台' },
  { type: 'pass_window', emoji: '🛎️', shortLabel: '出餐口' },
  { type: 'dispenser', recipeId: 'drink', emoji: '🥤', shortLabel: '飲料機' },
  { type: 'table', customerEmoji: '🐼', shortLabel: '顧客桌位' }
];

// 編輯模式「調整大小」下拉選單用的種類名稱對照。
const TYPE_LABELS = {
  counter: '桌子/檯面',
  ingredient_source: '材料箱',
  cooking: '鍋具',
  cutting: '鉆板',
  plate_stack: '取盤',
  trash: '垃圾桶',
  workbench: '工作台',
  pass_window: '出餐口',
  dispenser: '飲料機',
  table: '桌子'
};

class KitchenScene extends Phaser.Scene {
  constructor() {
    super('KitchenScene');
  }

  preload() {
    // 圖檔網址加版本號,確保每次上新版時手機瀏覽器會抓最新的圖,不會卡在舊的快取版本。
    const v = '?v=3.2';
    this.load.image('table_wood', 'assets/sprites/table.png' + v);
    this.load.image('table_chair', 'assets/sprites/table_chair.png' + v);
    this.load.image('kitchen_bg', 'assets/sprites/background.png' + v);
    this.load.image('p1_left', 'assets/sprites/p1_left.png' + v);
    this.load.image('p1_right', 'assets/sprites/p1_right.png' + v);
    this.load.image('p1_idle', 'assets/sprites/p1_idle.png' + v);
    this.load.image('p2_left', 'assets/sprites/p2_left.png' + v);
    this.load.image('p2_right', 'assets/sprites/p2_right.png' + v);
    this.load.image('p2_idle', 'assets/sprites/p2_idle.png' + v);

    // 廚具圖示(去背後疊在桌面圖上顯示,見 createEquipmentView)
    this.load.image('equip_pan', 'assets/sprites/pan.png' + v);
    this.load.image('equip_cutting_board', 'assets/sprites/cutting_board.png' + v);
    this.load.image('equip_plate', 'assets/sprites/plate.png' + v);

    // 食材/成品圖(用在材料箱圖示、手上拿著的東西、站點上放的東西)
    this.load.image('item_beef_raw', 'assets/sprites/beef_raw.png' + v);
    this.load.image('item_chicken_raw', 'assets/sprites/level1/chicken_raw.png' + v);
    this.load.image('item_beef_cooked', 'assets/sprites/level1/beef_cooked.png' + v);
    this.load.image('item_chicken_cooked', 'assets/sprites/level1/chicken_cooked.png' + v);
    this.load.image('item_beef_burnt', 'assets/sprites/level1/beef_burnt.png' + v);
    this.load.image('item_chicken_burnt', 'assets/sprites/level1/chicken_burnt.png' + v);
    this.load.image('item_tomato_raw', 'assets/sprites/level1/tomato_raw.png' + v);
    this.load.image('item_tomato_sliced', 'assets/sprites/level1/tomato_sliced.png' + v);
    this.load.image('item_lettuce', 'assets/sprites/level1/lettuce.png' + v);
    this.load.image('item_cheese', 'assets/sprites/level1/cheese.png' + v);
    this.load.image('item_bun', 'assets/sprites/level1/bun.png' + v);
    this.load.image('item_burger_beef_cheese', 'assets/sprites/level1/burger_beef_cheese.png' + v);
    this.load.image('item_burger_beef', 'assets/sprites/level1/burger_beef.png' + v);
    this.load.image('item_burger_beef_tomato', 'assets/sprites/level1/burger_beef_tomato.png' + v);
    this.load.image('item_burger_chicken_cheese', 'assets/sprites/level1/burger_chicken_cheese.png' + v);
    this.load.image('item_burger_chicken', 'assets/sprites/level1/burger_chicken.png' + v);
    this.load.image('item_burger_chicken_tomato', 'assets/sprites/level1/burger_chicken_tomato.png' + v);
  }

  create() {
    // 配合 main.js 把畫布放大 dpr 倍,這裡用 camera zoom 縮放回邏輯座標,
    // 場景裡其他程式碼完全不用管這件事,座標還是 0-960 x 0-540。
    // 相機預設會置中在「放大後畫布」的中心,不是我們邏輯世界(0-960,0-540)的中心,
    // 所以縮放之後還要額外用 centerOn 把視角拉回邏輯世界的正中央。
    const applyZoom = () => {
      this.cameras.main.setZoom(window.devicePixelRatio || 1);
      this.cameras.main.centerOn(WORLD_W / 2, WORLD_H / 2);
    };
    applyZoom();
    this.scale.on('resize', applyZoom);

    this.role = window.NET_ROLE;
    this.isHost = this.role === 'host';
    this.remoteRole = this.isHost ? 'joiner' : 'host';
    this.localTestMode = !!window.LOCAL_TEST_MODE;
    this.editMode = !!window.EDIT_MODE;
    this.level = Phaser.Math.Clamp(window.SELECTED_LEVEL || 1, 1, LEVEL_COUNT);

    loadLevelLayout(this.level);
    this.state = this.isHost ? createInitialState(this.level) : null;

    this.drawBackground();
    this.createStations();
    this.createPlayers();

    this.localPos = { x: PLAYER_SPAWN[this.role].x, y: PLAYER_SPAWN[this.role].y };
    this.moveTarget = null;
    this.pendingInteractStationId = null;
    this.moveStartTime = 0;

    if (this.localTestMode) {
      // 本機測試模式:一個人同時操作兩個角色,不走網路,直接在同一份 state 上互動。
      this.testPositions = {
        host: { x: PLAYER_SPAWN.host.x, y: PLAYER_SPAWN.host.y },
        joiner: { x: PLAYER_SPAWN.joiner.x, y: PLAYER_SPAWN.joiner.y }
      };
      this.testMoveTargets = { host: null, joiner: null };
      this.testPendingInteract = { host: null, joiner: null };
      this.testMoveStartTime = { host: 0, joiner: 0 };
      document.getElementById('btn-interact').style.display = 'none';
    }

    if (this.editMode) {
      this.enableEditMode();
    } else {
      this.setupTapToMove();
    }

    if (!this.localTestMode) {
      GameSync.onRemoteMove = (x, y) => {
        const s = this.playerSprites[this.remoteRole];
        s.targetX = x;
        s.targetY = y;
      };

      if (this.isHost) {
        GameSync.onInteractRequest = (stationId) => {
          interactStation(this.state, stationId, 'joiner');
        };
      } else {
        GameSync.onStateUpdate = (state) => {
          this.state = state;
        };
      }
    }

    this.lastMoveSent = 0;
    this.lastStateSent = 0;

    HUD.init();

    const playAgainBtn = document.getElementById('btn-play-again');
    if (this.isHost) {
      playAgainBtn.textContent = '再玩一次';
      playAgainBtn.onclick = () => {
        this.state = createInitialState(this.level);
      };
    } else {
      // 只有 Host 能重開一局(它是遊戲狀態的權威端),Joiner 端顯示等待訊息即可,
      // 等 Host 重開後,下一次狀態同步就會自動讓 Joiner 的結算畫面消失。
      playAgainBtn.textContent = '等待主機重新開始...';
      playAgainBtn.disabled = true;
    }
  }

  drawBackground() {
    this.add.image(WORLD_W / 2, WORLD_H / 2, 'kitchen_bg').setDisplaySize(WORLD_W, WORLD_H).setDepth(-2);
    // 中間走道分隔線(半透明深色條),提示這裡兩邊都不能穿越
    this.add.rectangle(480, WORLD_H / 2, 36, WORLD_H, 0x2b2018, 0.35).setDepth(-1);
  }

  createStations() {
    this.stationSprites = {};
    for (const id in STATION_LAYOUT) {
      const def = STATION_LAYOUT[id];
      if (def.type === 'table') {
        this.stationSprites[id] = this.createTableView(def);
      } else {
        this.stationSprites[id] = this.createEquipmentView(def);
      }
    }
  }

  // 所有站點都用方形(不再用圓形),不顯示名稱文字。
  // 不管是材料箱、垃圾桶、出餐口、空桌子,還是有自己專屬圖片的廚具(平底鍋/鉆板/取盤),
  // 一律先鋪一層桌面圖(table_wood)當底,圖示(廚具圖/食材圖/emoji)疊在上面——
  // 廚具圖本身去背後只是單純的物件形狀,並沒有內建檯面,所以也要跟材料箱一樣「放在桌上」。
  createEquipmentView(def) {
    const container = this.add.container(def.x, def.y);
    const size = def.size || 64;

    const ownArtKey = def.img || null;
    const iconImgKey = !ownArtKey && def.itemType ? itemImageKey(def.itemType) : null;
    const bg = this.add.image(0, 0, 'table_wood').setDisplaySize(size, size);
    const outline = this.add.rectangle(0, 0, size, size, 0x000000, 0).setStrokeStyle(3, 0xf5ead9);

    // 廚具本身的東西(拿著/煮著/切著的食材)要疊在「鍋面/檯面」中心,不是飄在廚具圖上方——
    // 平底鍋圖右側有一截握把,實際鍋面中心比整張圖的正中央略偏左,所以額外往左修正一點。
    let icon = null;
    let itemAnchorX = 0;
    let itemAnchorY = -2;
    if (ownArtKey) {
      const src = this.textures.get(ownArtKey).getSourceImage();
      const displayW = size * 0.8;
      const displayH = displayW * (src.height / src.width);
      icon = this.add.image(0, -2, ownArtKey).setDisplaySize(displayW, displayH);
      itemAnchorX = ownArtKey === 'equip_pan' ? -displayW * 0.14 : 0;
      itemAnchorY = -2;
    } else if (iconImgKey) {
      icon = this.add.image(0, -2, iconImgKey).setDisplaySize(size * 0.6, size * 0.6);
    } else if (def.emoji) {
      icon = this.add.text(0, -2, def.emoji, { fontSize: '28px' }).setOrigin(0.5);
    }

    const progressBg = this.add.rectangle(0, 42, 52, 7, 0x1a1410).setOrigin(0.5).setVisible(false);
    const progressBar = this.add.rectangle(-26, 42, 0, 7, 0xe8804a).setOrigin(0, 0.5).setVisible(false);
    const heldItemText = this.add.text(itemAnchorX, itemAnchorY, '', { fontSize: '22px' }).setOrigin(0.5);
    const heldItemImage = this.add.image(itemAnchorX, itemAnchorY, iconImgKey || 'equip_plate')
      .setDisplaySize(ownArtKey ? size * 0.42 : 30, ownArtKey ? size * 0.42 : 30)
      .setVisible(false);

    // 盤子疊放用:最多視覺上疊 4 層(每層往上偏移一點),超過 4 個就在最上面顯示總數字。
    const plateStackImages = [];
    for (let i = 0; i < 4; i++) {
      plateStackImages.push(this.add.image(0, -16 - i * 13, 'equip_plate').setDisplaySize(36, 36).setVisible(false));
    }
    const plateStackCountText = this.add.text(18, -55, '', { fontSize: '13px', color: '#ffffff', fontStyle: 'bold', backgroundColor: '#00000080' }).setOrigin(0.5).setVisible(false);

    // icon(廚具/材料箱圖示)要先疊上去,heldItemImage(鍋子裡煮的東西)才會蓋在它上面看得到,
    // 不然像平底鍋這種食材要疊在圖示中央的情況,廚具圖示會蓋住食材。
    const parts = [bg, outline];
    if (icon) parts.push(icon);
    parts.push(progressBg, progressBar, heldItemText, heldItemImage, ...plateStackImages, plateStackCountText);
    container.add(parts);

    return { container, bg, outline, hasOwnArt: !!ownArtKey, progressBg, progressBar, heldItemText, heldItemImage, plateStackImages, plateStackCountText, def };
  }

  // 桌子用實際的木紋桌面圖片,食物/飲料會實際「擺在桌面上」而不是用文字泡泡飄在空中。
  createTableView(def) {
    const container = this.add.container(def.x, def.y);

    const tableTop = this.add.image(0, 0, 'table_chair').setDisplaySize(def.size || 68, def.size || 68);
    const customerText = this.add.text(0, -46, '', { fontSize: '26px' }).setOrigin(0.5);
    const plate = this.add.rectangle(0, 6, 36, 36, 0xf5ead9).setStrokeStyle(2, 0xcbbfa8).setVisible(false);
    const foodText = this.add.text(0, 6, '', { fontSize: '22px' }).setOrigin(0.5);
    const foodImage = this.add.image(0, 6, 'equip_plate').setDisplaySize(34, 34).setVisible(false);
    const progressBg = this.add.rectangle(0, 46, 52, 7, 0x1a1410).setOrigin(0.5).setVisible(false);
    const progressBar = this.add.rectangle(-26, 46, 0, 7, 0xe8804a).setOrigin(0, 0.5).setVisible(false);

    container.add([tableTop, plate, foodText, foodImage, progressBg, progressBar, customerText]);

    return { container, bg: tableTop, progressBg, progressBar, customerText, plate, foodText, foodImage, def, isTable: true, hasOwnArt: true };
  }

  createPlayers() {
    this.playerSprites = {};
    for (const role of ['host', 'joiner']) {
      const spawn = PLAYER_SPAWN[role];
      const container = this.add.container(spawn.x, spawn.y);
      const image = this.add.image(0, 0, PLAYER_TEXTURES[role].idle).setDisplaySize(64, 64);
      const carryText = this.add.text(0, -40, '', { fontSize: '20px' }).setOrigin(0.5);
      const carryImage = this.add.image(0, -40, 'equip_plate').setDisplaySize(30, 30).setVisible(false);
      const roleLabel = this.add.text(0, 34, role === 'host' ? 'P1' : 'P2', {
        fontSize: '11px',
        color: '#ffffff',
        fontStyle: 'bold',
        backgroundColor: '#00000080'
      }).setOrigin(0.5);
      container.add([image, roleLabel, carryText, carryImage]);

      this.playerSprites[role] = {
        container,
        image,
        carryText,
        carryImage,
        facing: 'idle',
        lastX: spawn.x,
        x: spawn.x,
        y: spawn.y,
        targetX: spawn.x,
        targetY: spawn.y
      };
    }
  }

  update(time, delta) {
    if (this.localTestMode) {
      this.updateLocalTestMode(delta);
    } else {
      this.updateLocalMovement(delta);
      this.updateRemoteMovement();
      this.handleInteractInput();
    }

    if (this.isHost && this.state && !this.state.ended && !this.editMode) {
      tick(this.state, delta);
      if (!this.localTestMode && time - this.lastStateSent > 150) {
        this.lastStateSent = time;
        GameSync.sendState(this.state);
      }
    }

    if (this.state) {
      this.renderState();
    }
  }

  // 點擊物件才會移動(點空地沒有反應),走過去後自動互動。
  // 本機測試模式下,點左半邊操控 P1、點右半邊操控 P2。
  // 算出站點「面前」的走位目標:從玩家目前所在位置朝站點方向,停在站點邊緣外面,
  // 而不是直接瞄準站點正中心——瞄準正中心的話,碰撞卡住時最後停下的位置會因為撞到
  // 的角度亂跑(可能停在站點旁邊任何角度,不是正對著它),放行時甚至會直接疊到站點上面。
  computeApproachPoint(def, fromX, fromY) {
    const dx = fromX - def.x;
    const dy = fromY - def.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const standoff = (def.size || 64) / 2 + PLAYER_SIZE / 2;

    const natural = { x: def.x + (dx / dist) * standoff, y: def.y + (dy / dist) * standoff };
    if (!this.pointConflictsWithOtherStation(natural, def)) return natural;

    // 自然算出來的面前點卡到別的站點時(常見於站點排得比較密的自訂佈局,例如排成一整排/一整列),
    // 依序試上下左右四個方向,選第一個不會撞到別人的——直排的話上下常常也有鄰居,
    // 這時候換成試左右通常就空了,反之亦然,所以四個方向都要試,不能只試單一軸。
    const upDown = { x: def.x, y: def.y + (dy >= 0 ? standoff : -standoff) };
    const downUp = { x: def.x, y: def.y + (dy >= 0 ? -standoff : standoff) };
    const sideNear = { x: def.x + (dx >= 0 ? standoff : -standoff), y: def.y };
    const sideFar = { x: def.x + (dx >= 0 ? -standoff : standoff), y: def.y };
    const candidates = Math.abs(dy) >= Math.abs(dx)
      ? [upDown, downUp, sideNear, sideFar]
      : [sideNear, sideFar, upDown, downUp];

    for (const c of candidates) {
      if (!this.pointConflictsWithOtherStation(c, def)) return c;
    }
    return natural; // 四個方向都卡住(極端密集擺放),還是回傳原本算的點,靠卡住放行機制保底
  }

  pointConflictsWithOtherStation(point, excludeDef) {
    for (const id in STATION_LAYOUT) {
      const other = STATION_LAYOUT[id];
      if (other === excludeDef) continue;
      const half = PLAYER_SIZE / 2 + (other.size || 64) / 2;
      if (Math.abs(point.x - other.x) < half && Math.abs(point.y - other.y) < half) return true;
    }
    return false;
  }

  setupTapToMove() {
    this.input.on('pointerdown', (pointer) => {
      if (this.localTestMode) {
        const midX = (ZONE_MAX_X.host + ZONE_MIN_X.joiner) / 2;
        const role = pointer.worldX < midX ? 'host' : 'joiner';
        this.handleLocalTestTap(role, pointer.worldX, pointer.worldY);
      } else {
        const stationId = this.findTappedStation(pointer.worldX, pointer.worldY);
        if (!stationId) return; // 點到空地不移動

        const def = STATION_LAYOUT[stationId];
        const approach = this.computeApproachPoint(def, this.localPos.x, this.localPos.y);
        const targetX = Phaser.Math.Clamp(approach.x, ZONE_MIN_X[this.role], ZONE_MAX_X[this.role]);
        const targetY = Phaser.Math.Clamp(approach.y, 30, WORLD_H - 30);
        this.moveTarget = { x: targetX, y: targetY };
        this.pendingInteractStationId = stationId;
        this.moveStartTime = performance.now();
        // 點擊動畫要顯示在「點到的那個物件」本身位置,不是走位目標點(那兩個點常常不一樣,
        // 尤其走位目標為了閃開旁邊的站點被移到上方/下方時,動畫顯示在那裡會讓人以為點錯地方)。
        this.showTapMarker(def.x, def.y);
      }
    });
  }

  handleLocalTestTap(role, x, y) {
    const stationId = this.findTappedStation(x, y);
    if (!stationId) return; // 點到空地不移動

    const def = STATION_LAYOUT[stationId];
    const fromPos = this.testPositions[role];
    const approach = this.computeApproachPoint(def, fromPos.x, fromPos.y);
    const targetX = Phaser.Math.Clamp(approach.x, ZONE_MIN_X[role], ZONE_MAX_X[role]);
    const targetY = Phaser.Math.Clamp(approach.y, 30, WORLD_H - 30);
    this.testMoveTargets[role] = { x: targetX, y: targetY };
    this.testPendingInteract[role] = stationId;
    this.testMoveStartTime[role] = performance.now();
    // 同上,動畫顯示在點到的物件本身位置,不是走位目標點。
    this.showTapMarker(def.x, def.y);
  }

  updateLocalTestMode(delta) {
    const step = MOVE_SPEED * (delta / 1000);

    for (const role of ['host', 'joiner']) {
      const pos = this.testPositions[role];
      const target = this.testMoveTargets[role];

      if (target) {
        const dx = target.x - pos.x;
        const dy = target.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > MOVE_ARRIVE_DIST) {
          const moveStep = Math.min(step, dist);
          pos.x += (dx / dist) * moveStep;
          pos.y += (dy / dist) * moveStep;
        }
      }

      // 跟站點、跟另一位玩家都不能重疊,撞到會卡在邊緣。
      const resolved = this.resolveCollisionAgainstList(pos.x, pos.y, PLAYER_SIZE, this.buildCollisionObstacles(role));
      pos.x = resolved.x;
      pos.y = resolved.y;

      pos.x = Phaser.Math.Clamp(pos.x, ZONE_MIN_X[role], ZONE_MAX_X[role]);
      pos.y = Phaser.Math.Clamp(pos.y, 30, WORLD_H - 30);

      // target 是「站點面前的走位點」(見 computeApproachPoint),不是站點正中心,
      // 正常情況下碰撞會讓角色剛好停在那個點附近,所以用比較嚴格的距離判斷有沒有走到位。
      // 如果被卡住太久(例如兩個站點中間的縫太窄擠不過去),直接放行,不要讓角色卡死走不到。
      if (target) {
        const distToTarget = Phaser.Math.Distance.Between(pos.x, pos.y, target.x, target.y);
        const stuck = performance.now() - this.testMoveStartTime[role] > MOVE_STUCK_TIMEOUT_MS;
        if (distToTarget <= ARRIVE_AT_APPROACH_DIST || stuck) {
          if (stuck) {
            pos.x = target.x;
            pos.y = target.y;
          }
          this.testMoveTargets[role] = null;
          const stationId = this.testPendingInteract[role];
          if (stationId) {
            interactStation(this.state, stationId, role);
            this.testPendingInteract[role] = null;
          }
        }
      }

      const sprite = this.playerSprites[role];
      sprite.container.setPosition(pos.x, pos.y);
      sprite.x = pos.x;
      sprite.y = pos.y;
      this.updateFacing(role, pos.x);
    }
  }

  // 收集「這個角色」目前應該要避免重疊的東西:所有站點 + 另一位玩家。
  buildCollisionObstacles(selfRole) {
    const obstacles = [];
    for (const id in this.stationSprites) {
      const view = this.stationSprites[id];
      const size = (view.def && view.def.size) || (view.isTable ? 68 : 64);
      obstacles.push({ x: view.container.x, y: view.container.y, size });
    }
    const otherRole = selfRole === 'host' ? 'joiner' : 'host';
    const other = this.playerSprites[otherRole];
    obstacles.push({ x: other.x, y: other.y, size: PLAYER_SIZE });
    return obstacles;
  }

  // 通用的方形碰撞解算:如果 (x,y) 跟清單裡任何一個障礙物重疊,
  // 往重疊量較小的那個軸推開,讓它卡在對方邊緣,而不是直接疊上去。
  resolveCollisionAgainstList(x, y, size, obstacles) {
    const halfA = size / 2;
    for (const obs of obstacles) {
      const halfB = obs.size / 2;
      const dx = x - obs.x;
      const dy = y - obs.y;
      const overlapX = halfA + halfB - Math.abs(dx);
      const overlapY = halfA + halfB - Math.abs(dy);

      if (overlapX > 0 && overlapY > 0) {
        if (overlapX < overlapY) {
          x += dx >= 0 ? overlapX : -overlapX;
        } else {
          y += dy >= 0 ? overlapY : -overlapY;
        }
      }
    }
    return { x, y };
  }

  // 依角色這一幀實際移動的方向切換 left/right/idle 圖片。
  updateFacing(role, newX) {
    const sprite = this.playerSprites[role];
    const dx = newX - sprite.lastX;
    let facing;
    if (dx > FACING_CHANGE_THRESHOLD) facing = 'right';
    else if (dx < -FACING_CHANGE_THRESHOLD) facing = 'left';
    else facing = 'idle';

    sprite.lastX = newX;
    if (facing !== sprite.facing) {
      sprite.facing = facing;
      sprite.image.setTexture(PLAYER_TEXTURES[role][facing]);
    }
  }

  // 編輯模式:拖拉既有物件調整位置(不能互相重疊,撞到會卡在邊緣)、
  // 用單一控制項一次調整「所有物件」的大小、新增物件,結果即時整理成可複製的佈局文字。
  // 進編輯模式時遊戲模擬(訂單/顧客/計時)是暫停的,場景裡不會有顧客。
  enableEditMode() {
    document.getElementById('btn-interact').style.display = 'none';

    this.editedLayout = {}; // { [id]: {x, y} },記錄被拖過的最終位置
    this.dynamicDefs = {}; // { [id]: def },記錄編輯模式下新增/被改種類的物件完整定義(優先於 STATION_LAYOUT)
    this.nextEditId = {};
    this.sizeFilter = 'all'; // 目前大小調整要套用在哪個種類,'all' = 全部物件
    this.pendingGadgetType = null; // 目前選好、等著點一個空桌子放上去的廚具範本
    this.armedBtnEl = null;
    this.deleteMode = false;

    this.sizes = {}; // { [id]: size },每個物件各自的大小
    for (const id in this.stationSprites) {
      const base = this.dynamicDefs[id] || STATION_LAYOUT[id];
      const isTable = this.stationSprites[id].isTable;
      this.sizes[id] = (base && base.size) || (isTable ? 68 : 64);
    }

    for (const id in this.stationSprites) {
      this.makeDraggable(id, this.stationSprites[id].container);
    }

    this.input.on('drag', (pointer, gameObject, dragX, dragY) => {
      if (this.deleteMode || this.pendingGadgetType) return; // 刪除/放置模式下不要順便被拖走
      // 拖曳座標先對齊到格線,排整齊比較好對位置,不受不規則像素位置影響。
      const snappedX = Math.round(dragX / EDIT_GRID_SIZE) * EDIT_GRID_SIZE;
      const snappedY = Math.round(dragY / EDIT_GRID_SIZE) * EDIT_GRID_SIZE;
      const resolved = this.resolveCollision(gameObject.stationId, snappedX, snappedY, this.sizes[gameObject.stationId]);
      gameObject.x = resolved.x;
      gameObject.y = resolved.y;
    });

    this.input.on('dragend', (pointer, gameObject) => {
      if (this.deleteMode || this.pendingGadgetType) return;
      this.editedLayout[gameObject.stationId] = {
        x: Math.round(gameObject.x),
        y: Math.round(gameObject.y)
      };
      this.updateEditOutput();
    });

    const palette = document.getElementById('edit-palette');
    STATION_TYPE_PALETTE.forEach((tpl) => {
      const btn = document.createElement('button');
      btn.className = 'palette-btn';
      btn.textContent = '+ ' + tpl.shortLabel;
      if (tpl.type === 'counter') {
        // 桌子/檯面本身是地基,直接建立,不用兩段式放置。
        btn.onclick = () => this.addStation(tpl);
      } else {
        btn.onclick = () => this.toggleArmGadget(tpl, btn);
      }
      palette.appendChild(btn);
    });

    document.getElementById('btn-delete-mode').onclick = (e) => {
      this.deleteMode = !this.deleteMode;
      if (this.deleteMode) this.cancelArmedGadget();
      e.target.textContent = '刪除模式:' + (this.deleteMode ? '開啟(點物件刪除)' : '關閉');
      e.target.classList.toggle('active', this.deleteMode);
    };

    this.updateSizeDisplay();
    document.getElementById('btn-size-minus').onclick = () => this.adjustFilteredSize(-8);
    document.getElementById('btn-size-plus').onclick = () => this.adjustFilteredSize(8);

    document.getElementById('btn-copy-layout').onclick = () => {
      const textarea = document.getElementById('edit-output');
      textarea.select();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(textarea.value).catch(() => {});
      }
      try {
        document.execCommand('copy');
      } catch (e) {
        // 部分瀏覽器不支援,使用者仍可從 textarea 手動選取複製
      }
    };

    document.getElementById('btn-reset-layout').onclick = () => {
      try {
        localStorage.removeItem(LAYOUT_STORAGE_PREFIX + this.level);
      } catch (e) {
        // 忽略
      }
      location.reload();
    };

    document.getElementById('edit-level-label').textContent = '正在編輯:1-' + this.level;
    document.getElementById('edit-panel').classList.remove('hidden');
    this.updateEditOutput();
  }

  makeDraggable(id, container) {
    container.stationId = id;
    const size = this.sizes[id] || 64;
    container.setSize(size, size);
    container.setInteractive();
    this.input.setDraggable(container);
    container.on('pointerdown', () => this.handleEditObjectTap(id));
  }

  // 點場景裡的物件:刪除模式下直接刪掉;放置模式下如果點到空桌子就把選好的廚具放上去;
  // 平常點一下則是「指定這個物件的種類」給下面的大小調整用(不用下拉選單)。
  handleEditObjectTap(id) {
    if (this.deleteMode) {
      this.deleteStation(id);
      return;
    }
    if (this.pendingGadgetType) {
      this.attachGadgetToCounter(id, this.pendingGadgetType);
      return;
    }
    const base = this.dynamicDefs[id] || STATION_LAYOUT[id];
    if (base) {
      this.sizeFilter = base.type;
      this.updateSizeDisplay();
    }
  }

  toggleArmGadget(tpl, btnEl) {
    if (this.deleteMode) {
      this.deleteMode = false;
      const delBtn = document.getElementById('btn-delete-mode');
      delBtn.textContent = '刪除模式:關閉';
      delBtn.classList.remove('active');
    }
    if (this.pendingGadgetType === tpl) {
      this.cancelArmedGadget();
      return;
    }
    this.cancelArmedGadget();
    this.pendingGadgetType = tpl;
    this.armedBtnEl = btnEl;
    btnEl.classList.add('armed');
    document.getElementById('edit-place-hint').classList.remove('hidden');
  }

  cancelArmedGadget() {
    this.pendingGadgetType = null;
    if (this.armedBtnEl) this.armedBtnEl.classList.remove('armed');
    this.armedBtnEl = null;
    document.getElementById('edit-place-hint').classList.add('hidden');
  }

  // 把選好的廚具範本「貼」到一個現有的空桌子上(保留桌子原本的位置/大小),
  // 桌子本身的站點資料被整個換成新廚具的定義,不會兩個疊在一起。
  attachGadgetToCounter(id, tpl) {
    const view = this.stationSprites[id];
    const base = this.dynamicDefs[id] || STATION_LAYOUT[id];
    if (!view || !base || base.type !== 'counter') return; // 只能點還沒放廚具的空桌子

    const pos = this.editedLayout[id] || { x: view.container.x, y: view.container.y };
    const size = this.sizes[id] || 64;
    const newDef = Object.assign({}, tpl, { x: pos.x, y: pos.y, size });
    this.dynamicDefs[id] = newDef;

    view.container.destroy();
    const newView = newDef.type === 'table' ? this.createTableView(newDef) : this.createEquipmentView(newDef);
    this.stationSprites[id] = newView;
    this.makeDraggable(id, newView.container);
    this.applyStationSize(id, size);

    const stationState = createStationState(newDef);
    if (stationState) this.state.stations[id] = stationState;

    this.cancelArmedGadget();
    this.updateEditOutput();
  }

  deleteStation(id) {
    const view = this.stationSprites[id];
    if (!view) return;
    view.container.destroy();
    delete this.stationSprites[id];
    delete this.editedLayout[id];
    delete this.dynamicDefs[id];
    delete this.sizes[id];
    delete this.state.stations[id];
    this.updateEditOutput();
  }

  applyStationSize(id, size) {
    const view = this.stationSprites[id];
    view.bg.setDisplaySize(size, size);
    if (view.outline) view.outline.setSize(size, size);
    view.container.setSize(size, size);
  }

  // 目前選到的種類('all' = 全部)底下有哪些站點 id。
  getFilteredIds() {
    const ids = [];
    for (const id in this.stationSprites) {
      const base = this.dynamicDefs[id] || STATION_LAYOUT[id];
      if (this.sizeFilter === 'all' || (base && base.type === this.sizeFilter)) {
        ids.push(id);
      }
    }
    return ids;
  }

  updateSizeDisplay() {
    const ids = this.getFilteredIds();
    const size = ids.length > 0 ? this.sizes[ids[0]] : 64;
    document.getElementById('size-display').textContent = size;
    const label = this.sizeFilter === 'all' ? '全部物件' : (TYPE_LABELS[this.sizeFilter] || this.sizeFilter);
    document.getElementById('size-type-label').textContent = label;
  }

  // 只調整目前選到的種類(或全部)的物件大小。
  adjustFilteredSize(delta) {
    const ids = this.getFilteredIds();
    ids.forEach((id) => {
      const next = Phaser.Math.Clamp((this.sizes[id] || 64) + delta, 32, 140);
      this.sizes[id] = next;
      this.applyStationSize(id, next);
    });
    this.updateSizeDisplay();
    this.updateEditOutput();
  }

  // 編輯模式拖拉用:跟其他站點碰撞(排除自己),沿用共用的碰撞解算邏輯。
  resolveCollision(movingId, x, y, size) {
    const obstacles = [];
    for (const otherId in this.stationSprites) {
      if (otherId === movingId) continue;
      const other = this.stationSprites[otherId].container;
      obstacles.push({ x: other.x, y: other.y, size: this.sizes[otherId] || 64 });
    }
    return this.resolveCollisionAgainstList(x, y, size, obstacles);
  }

  addStation(tpl) {
    this.nextEditId[tpl.type] = (this.nextEditId[tpl.type] || 0) + 1;
    const id = 'new_' + tpl.type + '_' + this.nextEditId[tpl.type];
    const def = Object.assign({ x: WORLD_W / 2, y: WORLD_H / 2 }, tpl);
    this.dynamicDefs[id] = def;

    const view = def.type === 'table' ? this.createTableView(def) : this.createEquipmentView(def);
    this.stationSprites[id] = view;

    // 新物件預設大小:如果目前選的種類正好符合,就沿用那個大小,不然用預設值。
    const defaultSize = tpl.type === 'table' ? 68 : 64;
    this.sizes[id] = this.sizeFilter === tpl.type ? this.sizes[this.getFilteredIds()[0]] || defaultSize : defaultSize;

    this.makeDraggable(id, view.container);
    this.applyStationSize(id, this.sizes[id]);

    const stationState = createStationState(def);
    if (stationState) this.state.stations[id] = stationState;

    this.updateEditOutput();
  }

  updateEditOutput() {
    const merged = {};
    for (const id in this.stationSprites) {
      const base = this.dynamicDefs[id] || STATION_LAYOUT[id];
      const posOverride = this.editedLayout[id];
      merged[id] = Object.assign({}, base, { size: this.sizes[id] || 64 });
      if (posOverride) {
        merged[id].x = posOverride.x;
        merged[id].y = posOverride.y;
      }
    }
    const json = JSON.stringify(merged, null, 2);
    document.getElementById('edit-output').value = json;

    // 自動存到這台裝置的瀏覽器裡,重新整理/下次進遊戲都會沿用這份佈局。
    try {
      localStorage.setItem(LAYOUT_STORAGE_PREFIX + this.level, json);
    } catch (e) {
      // localStorage 可能被封鎖,不影響複製佈局功能
    }
  }

  showTapMarker(x, y) {
    const marker = this.add.circle(x, y, 10, 0xffffff, 0.6);
    this.tweens.add({
      targets: marker,
      scale: 2,
      alpha: 0,
      duration: 350,
      onComplete: () => marker.destroy()
    });
  }

  updateLocalMovement(delta) {
    if (this.moveTarget) {
      const dx = this.moveTarget.x - this.localPos.x;
      const dy = this.moveTarget.y - this.localPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const step = MOVE_SPEED * (delta / 1000);
      if (dist > MOVE_ARRIVE_DIST) {
        const moveStep = Math.min(step, dist);
        this.localPos.x += (dx / dist) * moveStep;
        this.localPos.y += (dy / dist) * moveStep;
      }
    }

    // 跟站點、跟另一位玩家都不能重疊,撞到會卡在邊緣。
    const resolved = this.resolveCollisionAgainstList(
      this.localPos.x,
      this.localPos.y,
      PLAYER_SIZE,
      this.buildCollisionObstacles(this.role)
    );
    this.localPos.x = resolved.x;
    this.localPos.y = resolved.y;

    this.localPos.x = Phaser.Math.Clamp(this.localPos.x, ZONE_MIN_X[this.role], ZONE_MAX_X[this.role]);
    this.localPos.y = Phaser.Math.Clamp(this.localPos.y, 30, WORLD_H - 30);

    // target 是「站點面前的走位點」(見 computeApproachPoint),不是站點正中心,
    // 正常情況下碰撞會讓角色剛好停在那個點附近,所以用比較嚴格的距離判斷有沒有走到位。
    // 如果被卡住太久(例如兩個站點中間的縫太窄擠不過去),直接放行,不要讓角色卡死走不到。
    if (this.moveTarget) {
      const distToTarget = Phaser.Math.Distance.Between(this.localPos.x, this.localPos.y, this.moveTarget.x, this.moveTarget.y);
      const stuck = performance.now() - this.moveStartTime > MOVE_STUCK_TIMEOUT_MS;
      if (distToTarget <= ARRIVE_AT_APPROACH_DIST || stuck) {
        if (stuck) {
          this.localPos.x = this.moveTarget.x;
          this.localPos.y = this.moveTarget.y;
        }
        this.moveTarget = null;
        if (this.pendingInteractStationId) {
          const stationId = this.pendingInteractStationId;
          this.pendingInteractStationId = null;
          if (this.isHost) {
            interactStation(this.state, stationId, 'host');
          } else {
            GameSync.sendInteract(stationId);
          }
        }
      }
    }

    const mySprite = this.playerSprites[this.role];
    mySprite.container.setPosition(this.localPos.x, this.localPos.y);
    mySprite.x = this.localPos.x;
    mySprite.y = this.localPos.y;
    this.updateFacing(this.role, this.localPos.x);
  }

  updateRemoteMovement() {
    const remote = this.playerSprites[this.remoteRole];
    remote.container.setPosition(remote.targetX, remote.targetY);
    remote.x = remote.targetX;
    remote.y = remote.targetY;
    this.updateFacing(this.remoteRole, remote.targetX);

    const now = performance.now();
    if (now - this.lastMoveSent > 80) {
      this.lastMoveSent = now;
      GameSync.sendMove(this.localPos.x, this.localPos.y);
    }
  }

  handleInteractInput() {
    if (!GameInput.interactJustPressed) return;
    GameInput.interactJustPressed = false;

    const nearestId = this.findNearestStation(this.localPos.x, this.localPos.y);
    if (!nearestId) return;

    if (this.isHost) {
      interactStation(this.state, nearestId, 'host');
    } else {
      GameSync.sendInteract(nearestId);
    }
  }

  findNearestStation(x, y) {
    let best = null;
    let bestDist = INTERACT_RADIUS;
    for (const id in STATION_LAYOUT) {
      const def = STATION_LAYOUT[id];
      const d = Phaser.Math.Distance.Between(x, y, def.x, def.y);
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    }
    return best;
  }

  // 點擊/點選專用:限定要真的點在該物件自己的方塊範圍內(留一點點容錯)才算點到它,
  // 不是「離哪個站點最近」——站點排得比較密的時候,兩個站點的 72px 判定半徑會重疊,
  // 這時候用「最近」來判斷,點在 A 物件上卻可能被判定成點到隔壁的 B(尤其手指觸控不夠精準)。
  // 用嚴格的方塊範圍判斷,只要沒點進物件自己的方塊裡,就不會被算成點到它。
  findTappedStation(x, y) {
    let best = null;
    let bestDist = Infinity;
    for (const id in STATION_LAYOUT) {
      const def = STATION_LAYOUT[id];
      const half = (def.size || 64) / 2 + 6;
      if (Math.abs(x - def.x) > half || Math.abs(y - def.y) > half) continue;
      const d = Phaser.Math.Distance.Between(x, y, def.x, def.y);
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    }
    return best;
  }

  // 手上/站點上「拿著的東西」統一渲染規則:
  // 空的 -> 都藏起來;拿著組合中的盤子(物件,還沒湊滿食譜)-> 顯示盤子圖 + 目前湊了幾樣的數字;
  // 拿著單一物品(字串)-> 有對應圖片就顯示圖片,沒有就退回 emoji 文字。
  setItemVisual(imageObj, textObj, value) {
    if (!value) {
      imageObj.setVisible(false);
      textObj.setText('');
      return;
    }
    if (typeof value === 'object' && value.isPlate) {
      imageObj.setTexture('equip_plate').setVisible(true);
      textObj.setText(value.items.length > 0 ? String(value.items.length) : '');
      return;
    }
    const key = itemImageKey(value);
    if (key) {
      imageObj.setTexture(key).setVisible(true);
      textObj.setText('');
    } else {
      imageObj.setVisible(false);
      textObj.setText(itemEmoji(value));
    }
  }

  // 盤子疊放視覺:最多疊 4 層(每層往上偏移一點點,看起來像疊高),超過 4 個在最上面補一個數字角標。
  setPlateStackVisual(view, plateStack) {
    const count = plateStack ? plateStack.length : 0;
    const visibleLayers = Math.min(count, view.plateStackImages.length);
    for (let i = 0; i < view.plateStackImages.length; i++) {
      view.plateStackImages[i].setVisible(i < visibleLayers);
    }
    if (count > view.plateStackImages.length) {
      view.plateStackCountText.setText('×' + count).setVisible(true);
    } else {
      view.plateStackCountText.setVisible(false);
    }
  }

  setStationBorder(view, color) {
    if (view.outline && typeof view.outline.setStrokeStyle === 'function') {
      view.outline.setStrokeStyle(3, color);
    }
  }

  renderState() {
    const state = this.state;

    for (const role of ['host', 'joiner']) {
      const carrying = state.players[role].carrying;
      const sprite = this.playerSprites[role];
      this.setItemVisual(sprite.carryImage, sprite.carryText, carrying);
    }

    for (const id in this.stationSprites) {
      const st = state.stations[id];
      const view = this.stationSprites[id];
      if (!st) continue;

      if (st.type === 'cooking') {
        const cookDef = st.recipeId ? getRecipe(st.recipeId) : COOK_RECIPES[st.cookingItem];
        if (st.status === 'cooking') {
          view.progressBg.setVisible(true);
          view.progressBar.setVisible(true);
          view.progressBar.width = 52 * Phaser.Math.Clamp(st.progress / (cookDef ? cookDef.cookTimeMs : 1), 0, 1);
          view.progressBar.fillColor = 0xffcf8f;
          // 剛放上去還在煮的時候,先顯示生的食材原型,煮好才會換成熟的圖。
          const rawItem = st.cookingItem || (st.recipeId ? getRecipe(st.recipeId).rawItem : null);
          this.setItemVisual(view.heldItemImage, view.heldItemText, rawItem);
          this.setStationBorder(view, 0xffcf8f);
        } else if (st.status === 'done') {
          view.progressBg.setVisible(false);
          view.progressBar.setVisible(false);
          this.setItemVisual(view.heldItemImage, view.heldItemText, st.itemHeld);
          this.setStationBorder(view, 0x6fe86f);
        } else if (st.status === 'burnt') {
          view.progressBg.setVisible(false);
          view.progressBar.setVisible(false);
          this.setItemVisual(view.heldItemImage, view.heldItemText, st.itemHeld || 'trash');
          this.setStationBorder(view, 0xff6b6b);
        } else {
          view.progressBg.setVisible(false);
          view.progressBar.setVisible(false);
          this.setItemVisual(view.heldItemImage, view.heldItemText, null);
          this.setStationBorder(view, 0xf5ead9);
        }
      } else if (st.type === 'cutting') {
        const cutDef = CUT_RECIPES[st.cuttingItem];
        if (st.status === 'cutting') {
          view.progressBg.setVisible(true);
          view.progressBar.setVisible(true);
          view.progressBar.width = 52 * Phaser.Math.Clamp(st.progress / (cutDef ? cutDef.cutTimeMs : 1), 0, 1);
          view.progressBar.fillColor = 0x8fd1ff;
          this.setItemVisual(view.heldItemImage, view.heldItemText, st.cuttingItem);
        } else {
          view.progressBg.setVisible(false);
          view.progressBar.setVisible(false);
          this.setItemVisual(view.heldItemImage, view.heldItemText, st.itemHeld);
        }
      } else if (st.type === 'pass_window' || st.type === 'workbench' || st.type === 'counter') {
        this.setPlateStackVisual(view, st.plateStack);
        if (st.plateStack.length === 0) {
          this.setItemVisual(view.heldItemImage, view.heldItemText, st.itemHeld);
        } else {
          view.heldItemImage.setVisible(false);
          view.heldItemText.setText('');
        }
      } else if (st.type === 'table') {
        // 編輯模式下不管實際 state 內容為何,一律當成空桌顯示,絕對不會出現顧客。
        if (st.occupied && !this.editMode) {
          const recipe = getRecipe(st.recipeId);
          view.customerText.setText(view.def.customerEmoji || '🐼');
          view.plate.setVisible(true);
          this.setItemVisual(view.foodImage, view.foodText, recipe.platedItem);
          const ratio = Phaser.Math.Clamp(st.patience / st.maxPatience, 0, 1);
          view.progressBg.setVisible(true);
          view.progressBar.setVisible(true);
          view.progressBar.width = 52 * ratio;
          view.progressBar.fillColor = ratio < 0.3 ? 0xff6b6b : 0x6fe86f;
        } else {
          view.customerText.setText('');
          view.plate.setVisible(false);
          this.setItemVisual(view.foodImage, view.foodText, null);
          view.progressBg.setVisible(false);
          view.progressBar.setVisible(false);
        }
      }
    }

    HUD.update(state);
  }
}
