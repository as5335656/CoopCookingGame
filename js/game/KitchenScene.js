// 廚房場景:場景佈局、玩家移動、站點渲染、與 GameSync 對接。
// 佈局對應參考截圖:左側料理站、中間出餐口、右側外場桌位(顧客主要從右側/門口進來)。

const WORLD_W = 960;
const WORLD_H = 540;
const MOVE_SPEED = 220; // px/sec
const INTERACT_RADIUS = 72;
const MOVE_ARRIVE_DIST = 4;
const PLAYER_SIZE = 64; // 角色碰撞用的方形邊長,跟顯示大小一致

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

// 1-1 已經用編輯模式設計過:料理站集中在左上、額外加了 5 張桌子(都在左側廚房區,故意這樣設計)。
const LEVEL_1_LAYOUT = {
  ingredient_potato: { x: 124, y: 46, type: 'ingredient_source', itemType: 'potato_raw', emoji: '🥔', label: '材料箱', size: 72 },
  fryer_1: { x: 268, y: 49, type: 'cooking', recipeId: 'fries', emoji: '🍳', label: '油炸鍋', size: 72 },
  plate_stack: { x: 196, y: 47, type: 'plate_stack', emoji: '🍽️', label: '取盤', size: 72 },
  trash_bin: { x: 412, y: 50, type: 'trash', emoji: '🗑️', label: '垃圾桶', size: 72 },
  workbench_1: { x: 340, y: 50, type: 'workbench', emoji: '', label: '工作台', size: 72 },
  pass_window: { x: 480, y: 300, type: 'pass_window', emoji: '🛎️', label: '出餐口', size: 72 },
  drink_dispenser: { x: 850, y: 150, type: 'dispenser', recipeId: 'drink', emoji: '🥤', label: '飲料機', size: 72 },
  table_1: { x: 410, y: 122, type: 'table', customerEmoji: '🐼', label: '桌位1', size: 72 },
  table_2: { x: 850, y: 420, type: 'table', customerEmoji: '🐧', label: '桌位2', size: 72 },
  new_table_1: { x: 265, y: 483, type: 'table', customerEmoji: '🐼', shortLabel: '桌子', size: 72 },
  new_table_2: { x: 337, y: 482, type: 'table', customerEmoji: '🐼', shortLabel: '桌子', size: 72 },
  new_table_3: { x: 410, y: 194, type: 'table', customerEmoji: '🐼', shortLabel: '桌子', size: 72 },
  new_table_4: { x: 409, y: 482, type: 'table', customerEmoji: '🐼', shortLabel: '桌子', size: 72 },
  new_table_5: { x: 193, y: 482, type: 'table', customerEmoji: '🐼', shortLabel: '桌子', size: 72 }
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

// 編輯模式底下「新增物件」的可選類型清單
const STATION_TYPE_PALETTE = [
  { type: 'ingredient_source', itemType: 'potato_raw', emoji: '🥔', shortLabel: '材料箱' },
  { type: 'cooking', recipeId: 'fries', emoji: '🍳', shortLabel: '油炸鍋' },
  { type: 'plate_stack', emoji: '🍽️', shortLabel: '取盤' },
  { type: 'trash', emoji: '🗑️', shortLabel: '垃圾桶' },
  { type: 'workbench', emoji: '', shortLabel: '工作台' },
  { type: 'pass_window', emoji: '🛎️', shortLabel: '出餐口' },
  { type: 'dispenser', recipeId: 'drink', emoji: '🥤', shortLabel: '飲料機' },
  { type: 'table', customerEmoji: '🐼', shortLabel: '桌子' }
];

class KitchenScene extends Phaser.Scene {
  constructor() {
    super('KitchenScene');
  }

  preload() {
    // 圖檔網址加版本號,確保每次上新版時手機瀏覽器會抓最新的圖,不會卡在舊的快取版本。
    const v = '?v=2.0';
    this.load.image('table_wood', 'assets/sprites/table.png' + v);
    this.load.image('kitchen_bg', 'assets/sprites/background.png' + v);
    this.load.image('p1_left', 'assets/sprites/p1_left.png' + v);
    this.load.image('p1_right', 'assets/sprites/p1_right.png' + v);
    this.load.image('p1_idle', 'assets/sprites/p1_idle.png' + v);
    this.load.image('p2_left', 'assets/sprites/p2_left.png' + v);
    this.load.image('p2_right', 'assets/sprites/p2_right.png' + v);
    this.load.image('p2_idle', 'assets/sprites/p2_idle.png' + v);
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
    this.state = this.isHost ? createInitialState() : null;

    this.drawBackground();
    this.createStations();
    this.createPlayers();

    this.localPos = { x: PLAYER_SPAWN[this.role].x, y: PLAYER_SPAWN[this.role].y };
    this.moveTarget = null;
    this.pendingInteractStationId = null;

    if (this.localTestMode) {
      // 本機測試模式:一個人同時操作兩個角色,不走網路,直接在同一份 state 上互動。
      this.testPositions = {
        host: { x: PLAYER_SPAWN.host.x, y: PLAYER_SPAWN.host.y },
        joiner: { x: PLAYER_SPAWN.joiner.x, y: PLAYER_SPAWN.joiner.y }
      };
      this.testMoveTargets = { host: null, joiner: null };
      this.testPendingInteract = { host: null, joiner: null };
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
        this.state = createInitialState();
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
  createEquipmentView(def) {
    const container = this.add.container(def.x, def.y);
    const size = def.size || 64;

    const bg = this.add.rectangle(0, 0, size, size, 0x3a2c20).setStrokeStyle(3, 0xf5ead9);
    const icon = def.emoji ? this.add.text(0, -2, def.emoji, { fontSize: '28px' }).setOrigin(0.5) : null;
    const progressBg = this.add.rectangle(0, 42, 52, 7, 0x1a1410).setOrigin(0.5).setVisible(false);
    const progressBar = this.add.rectangle(-26, 42, 0, 7, 0xe8804a).setOrigin(0, 0.5).setVisible(false);
    const heldItemText = this.add.text(0, -34, '', { fontSize: '22px' }).setOrigin(0.5);

    const parts = [bg, progressBg, progressBar, heldItemText];
    if (icon) parts.push(icon);
    container.add(parts);

    return { container, bg, progressBg, progressBar, heldItemText, def };
  }

  // 桌子用實際的木紋桌面圖片,食物/飲料會實際「擺在桌面上」而不是用文字泡泡飄在空中。
  createTableView(def) {
    const container = this.add.container(def.x, def.y);

    const tableTop = this.add.image(0, 0, 'table_wood').setDisplaySize(def.size || 68, def.size || 68);
    const customerText = this.add.text(0, -46, '', { fontSize: '26px' }).setOrigin(0.5);
    const plate = this.add.rectangle(0, 6, 36, 36, 0xf5ead9).setStrokeStyle(2, 0xcbbfa8).setVisible(false);
    const foodText = this.add.text(0, 6, '', { fontSize: '22px' }).setOrigin(0.5);
    const progressBg = this.add.rectangle(0, 46, 52, 7, 0x1a1410).setOrigin(0.5).setVisible(false);
    const progressBar = this.add.rectangle(-26, 46, 0, 7, 0xe8804a).setOrigin(0, 0.5).setVisible(false);

    container.add([tableTop, plate, foodText, progressBg, progressBar, customerText]);

    return { container, bg: tableTop, progressBg, progressBar, customerText, plate, foodText, def, isTable: true };
  }

  createPlayers() {
    this.playerSprites = {};
    for (const role of ['host', 'joiner']) {
      const spawn = PLAYER_SPAWN[role];
      const container = this.add.container(spawn.x, spawn.y);
      const image = this.add.image(0, 0, PLAYER_TEXTURES[role].idle).setDisplaySize(64, 64);
      const carryText = this.add.text(0, -40, '', { fontSize: '20px' }).setOrigin(0.5);
      const roleLabel = this.add.text(0, 34, role === 'host' ? 'P1' : 'P2', {
        fontSize: '11px',
        color: '#ffffff',
        fontStyle: 'bold',
        backgroundColor: '#00000080'
      }).setOrigin(0.5);
      container.add([image, roleLabel, carryText]);

      this.playerSprites[role] = {
        container,
        image,
        carryText,
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
  setupTapToMove() {
    this.input.on('pointerdown', (pointer) => {
      if (this.localTestMode) {
        const midX = (ZONE_MAX_X.host + ZONE_MIN_X.joiner) / 2;
        const role = pointer.worldX < midX ? 'host' : 'joiner';
        this.handleLocalTestTap(role, pointer.worldX, pointer.worldY);
      } else {
        const stationId = this.findNearestStation(pointer.worldX, pointer.worldY);
        if (!stationId) return; // 點到空地不移動

        const def = STATION_LAYOUT[stationId];
        const targetX = Phaser.Math.Clamp(def.x, ZONE_MIN_X[this.role], ZONE_MAX_X[this.role]);
        const targetY = Phaser.Math.Clamp(def.y, 110, WORLD_H - 30);
        this.moveTarget = { x: targetX, y: targetY };
        this.pendingInteractStationId = stationId;
        this.showTapMarker(targetX, targetY);
      }
    });
  }

  handleLocalTestTap(role, x, y) {
    const stationId = this.findNearestStation(x, y);
    if (!stationId) return; // 點到空地不移動

    const def = STATION_LAYOUT[stationId];
    const targetX = Phaser.Math.Clamp(def.x, ZONE_MIN_X[role], ZONE_MAX_X[role]);
    const targetY = Phaser.Math.Clamp(def.y, 110, WORLD_H - 30);
    this.testMoveTargets[role] = { x: targetX, y: targetY };
    this.testPendingInteract[role] = stationId;
    this.showTapMarker(targetX, targetY);
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
      pos.y = Phaser.Math.Clamp(pos.y, 110, WORLD_H - 30);

      // 因為有碰撞,角色走不到物件正中心,所以改成「靠近到可互動距離」就算抵達。
      if (target) {
        const distToTarget = Phaser.Math.Distance.Between(pos.x, pos.y, target.x, target.y);
        if (distToTarget <= INTERACT_RADIUS) {
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
    this.dynamicDefs = {}; // { [id]: def },記錄編輯模式下新增的物件完整定義
    this.nextEditId = {};
    const anyDef = STATION_LAYOUT[Object.keys(STATION_LAYOUT)[0]];
    this.globalSize = (anyDef && anyDef.size) || 64; // 所有物件目前統一的大小,若有先前存過的佈局就沿用

    for (const id in this.stationSprites) {
      this.makeDraggable(id, this.stationSprites[id].container);
    }

    this.input.on('drag', (pointer, gameObject, dragX, dragY) => {
      const resolved = this.resolveCollision(gameObject.stationId, dragX, dragY, this.globalSize);
      gameObject.x = resolved.x;
      gameObject.y = resolved.y;
    });

    this.input.on('dragend', (pointer, gameObject) => {
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
      btn.onclick = () => this.addStation(tpl);
      palette.appendChild(btn);
    });

    document.getElementById('size-display').textContent = this.globalSize;
    document.getElementById('btn-size-minus').onclick = () => this.adjustGlobalSize(-8);
    document.getElementById('btn-size-plus').onclick = () => this.adjustGlobalSize(8);

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
    const size = this.globalSize || 64;
    container.setSize(size, size);
    container.setInteractive();
    this.input.setDraggable(container);
  }

  applyStationSize(id, size) {
    const view = this.stationSprites[id];
    if (view.isTable) {
      view.bg.setDisplaySize(size, size);
    } else {
      view.bg.setSize(size, size);
    }
    view.container.setSize(size, size);
  }

  // 一次調整「所有物件」的大小,不用先選取單一物件。
  adjustGlobalSize(delta) {
    this.globalSize = Phaser.Math.Clamp(this.globalSize + delta, 32, 140);
    for (const id in this.stationSprites) {
      this.applyStationSize(id, this.globalSize);
    }
    document.getElementById('size-display').textContent = this.globalSize;
    this.updateEditOutput();
  }

  // 編輯模式拖拉用:跟其他站點碰撞(排除自己),沿用共用的碰撞解算邏輯。
  resolveCollision(movingId, x, y, size) {
    const obstacles = [];
    for (const otherId in this.stationSprites) {
      if (otherId === movingId) continue;
      const other = this.stationSprites[otherId].container;
      obstacles.push({ x: other.x, y: other.y, size: this.globalSize });
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
    this.makeDraggable(id, view.container);
    this.applyStationSize(id, this.globalSize);

    const stationState = createStationState(def);
    if (stationState) this.state.stations[id] = stationState;

    this.updateEditOutput();
  }

  updateEditOutput() {
    const merged = {};
    for (const id in this.stationSprites) {
      const base = STATION_LAYOUT[id] || this.dynamicDefs[id];
      const posOverride = this.editedLayout[id];
      merged[id] = Object.assign({}, base, { size: this.globalSize });
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
    this.localPos.y = Phaser.Math.Clamp(this.localPos.y, 110, WORLD_H - 30);

    // 因為有碰撞,角色走不到物件正中心,所以改成「靠近到可互動距離」就算抵達。
    if (this.moveTarget) {
      const distToTarget = Phaser.Math.Distance.Between(this.localPos.x, this.localPos.y, this.moveTarget.x, this.moveTarget.y);
      if (distToTarget <= INTERACT_RADIUS) {
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

  renderState() {
    const state = this.state;

    for (const role of ['host', 'joiner']) {
      const carrying = state.players[role].carrying;
      this.playerSprites[role].carryText.setText(carrying ? itemEmoji(carrying) : '');
    }

    for (const id in this.stationSprites) {
      const st = state.stations[id];
      const view = this.stationSprites[id];
      if (!st) continue;

      if (st.type === 'cooking') {
        const recipe = getRecipe(st.recipeId);
        if (st.status === 'cooking') {
          view.progressBg.setVisible(true);
          view.progressBar.setVisible(true);
          view.progressBar.width = 52 * Phaser.Math.Clamp(st.progress / recipe.cookTimeMs, 0, 1);
          view.progressBar.fillColor = 0xffcf8f;
          view.heldItemText.setText('');
          view.bg.setStrokeStyle(3, 0xffcf8f);
        } else if (st.status === 'done') {
          view.progressBg.setVisible(false);
          view.progressBar.setVisible(false);
          view.heldItemText.setText(itemEmoji(st.itemHeld));
          view.bg.setStrokeStyle(3, 0x6fe86f);
        } else if (st.status === 'burnt') {
          view.progressBg.setVisible(false);
          view.progressBar.setVisible(false);
          view.heldItemText.setText('💨');
          view.bg.setStrokeStyle(3, 0xff6b6b);
        } else {
          view.progressBg.setVisible(false);
          view.progressBar.setVisible(false);
          view.heldItemText.setText('');
          view.bg.setStrokeStyle(3, 0xf5ead9);
        }
      } else if (st.type === 'pass_window' || st.type === 'workbench') {
        view.heldItemText.setText(st.itemHeld ? itemEmoji(st.itemHeld) : '');
      } else if (st.type === 'table') {
        // 編輯模式下不管實際 state 內容為何,一律當成空桌顯示,絕對不會出現顧客。
        if (st.occupied && !this.editMode) {
          const recipe = getRecipe(st.recipeId);
          view.customerText.setText(view.def.customerEmoji || '🐼');
          view.plate.setVisible(true);
          view.foodText.setText(itemEmoji(recipe.platedItem));
          const ratio = Phaser.Math.Clamp(st.patience / st.maxPatience, 0, 1);
          view.progressBg.setVisible(true);
          view.progressBar.setVisible(true);
          view.progressBar.width = 52 * ratio;
          view.progressBar.fillColor = ratio < 0.3 ? 0xff6b6b : 0x6fe86f;
        } else {
          view.customerText.setText('');
          view.plate.setVisible(false);
          view.foodText.setText('');
          view.progressBg.setVisible(false);
          view.progressBar.setVisible(false);
        }
      }
    }

    HUD.update(state);
  }
}
