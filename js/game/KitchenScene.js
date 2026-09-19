// 廚房場景:場景佈局、玩家移動、站點渲染、與 GameSync 對接。
// 佈局對應參考截圖:左側料理站、中間出餐口、右側外場桌位(顧客主要從右側/門口進來)。

const WORLD_W = 960;
const WORLD_H = 540;
const MOVE_SPEED = 220; // px/sec
const INTERACT_RADIUS = 72;
const MOVE_ARRIVE_DIST = 4;

// 中間走道兩邊都不能穿越,雙方各自鎖在自己的區域,只能靠出餐口交接東西。
const ZONE_MAX_X = { host: 450, joiner: WORLD_W - 30 };
const ZONE_MIN_X = { host: 30, joiner: 510 };

// 佈局參考截圖:廚房設備排成流理台式的 2 列(不是單排一直線),
// 中間走道垂直分隔廚房與外場,外場桌位一上一下錯開擺放。
const STATION_LAYOUT = {
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

const PLAYER_SPAWN = {
  host: { x: 220, y: 300 },
  joiner: { x: 620, y: 400 }
};

const PLAYER_EMOJI = { host: '🐱', joiner: '🦊' };
const PLAYER_COLOR = { host: 0x4a90d9, joiner: 0xd97a4a };

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
    this.load.image('table_wood', 'assets/sprites/table.png');
  }

  create() {
    this.role = window.NET_ROLE;
    this.isHost = this.role === 'host';
    this.remoteRole = this.isHost ? 'joiner' : 'host';
    this.localTestMode = !!window.LOCAL_TEST_MODE;
    this.editMode = !!window.EDIT_MODE;

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
    this.add.rectangle(WORLD_W / 2, WORLD_H / 2, WORLD_W, WORLD_H, 0x5c8f7a).setDepth(-2);
    this.add.rectangle(240, WORLD_H / 2 + 20, 480, WORLD_H - 40, 0xd9b98a).setDepth(-1); // 左:廚房地板
    this.add.rectangle(720, WORLD_H / 2 + 20, 480, WORLD_H - 40, 0xf0c98f).setDepth(-1); // 右:外場地板
    this.add.rectangle(480, WORLD_H / 2 + 20, 40, WORLD_H - 40, 0x8a6d4a).setDepth(-1); // 中間走道分隔
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

    const bg = this.add.rectangle(0, 0, 64, 64, 0x3a2c20).setStrokeStyle(3, 0xf5ead9);
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

    const tableTop = this.add.image(0, 0, 'table_wood').setDisplaySize(68, 68);
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
      const body = this.add.rectangle(0, 0, 44, 44, PLAYER_COLOR[role]).setStrokeStyle(3, 0xffffff);
      const face = this.add.text(0, 0, PLAYER_EMOJI[role], { fontSize: '24px' }).setOrigin(0.5);
      const carryText = this.add.text(0, -36, '', { fontSize: '20px' }).setOrigin(0.5);
      const roleLabel = this.add.text(0, 30, role === 'host' ? 'P1' : 'P2', {
        fontSize: '11px',
        color: '#ffffff',
        fontStyle: 'bold'
      }).setOrigin(0.5);
      container.add([body, face, roleLabel, carryText]);

      this.playerSprites[role] = {
        container,
        carryText,
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

    if (this.isHost && this.state && !this.state.ended) {
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

        if (dist <= MOVE_ARRIVE_DIST || step >= dist) {
          pos.x = target.x;
          pos.y = target.y;
          this.testMoveTargets[role] = null;

          const stationId = this.testPendingInteract[role];
          if (stationId) {
            interactStation(this.state, stationId, role);
            this.testPendingInteract[role] = null;
          }
        } else {
          pos.x += (dx / dist) * step;
          pos.y += (dy / dist) * step;
        }
      }

      pos.x = Phaser.Math.Clamp(pos.x, ZONE_MIN_X[role], ZONE_MAX_X[role]);
      pos.y = Phaser.Math.Clamp(pos.y, 110, WORLD_H - 30);

      const sprite = this.playerSprites[role];
      sprite.container.setPosition(pos.x, pos.y);
      sprite.x = pos.x;
      sprite.y = pos.y;
    }
  }

  // 編輯模式:拖拉既有物件調整位置、也可以新增物件,結果即時整理成可複製的佈局文字。
  enableEditMode() {
    document.getElementById('btn-interact').style.display = 'none';

    this.editedLayout = {}; // { [id]: {x, y} },記錄被拖過的最終位置
    this.dynamicDefs = {}; // { [id]: def },記錄編輯模式下新增的物件完整定義
    this.nextEditId = {};

    for (const id in this.stationSprites) {
      this.makeDraggable(id, this.stationSprites[id].container);
    }

    this.input.on('drag', (pointer, gameObject, dragX, dragY) => {
      gameObject.x = dragX;
      gameObject.y = dragY;
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

    document.getElementById('edit-panel').classList.remove('hidden');
    this.updateEditOutput();
  }

  makeDraggable(id, container) {
    container.stationId = id;
    container.setSize(70, 70);
    container.setInteractive();
    this.input.setDraggable(container);
  }

  addStation(tpl) {
    this.nextEditId[tpl.type] = (this.nextEditId[tpl.type] || 0) + 1;
    const id = 'new_' + tpl.type + '_' + this.nextEditId[tpl.type];
    const def = Object.assign({ x: WORLD_W / 2, y: WORLD_H / 2 }, tpl);
    this.dynamicDefs[id] = def;

    const view = def.type === 'table' ? this.createTableView(def) : this.createEquipmentView(def);
    this.stationSprites[id] = view;
    this.makeDraggable(id, view.container);

    const stationState = createStationState(def);
    if (stationState) this.state.stations[id] = stationState;

    this.updateEditOutput();
  }

  updateEditOutput() {
    const merged = {};
    for (const id in this.stationSprites) {
      const base = STATION_LAYOUT[id] || this.dynamicDefs[id];
      const override = this.editedLayout[id];
      merged[id] = override ? Object.assign({}, base, { x: override.x, y: override.y }) : base;
    }
    document.getElementById('edit-output').value = JSON.stringify(merged, null, 2);
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

      if (dist <= MOVE_ARRIVE_DIST || step >= dist) {
        this.localPos.x = this.moveTarget.x;
        this.localPos.y = this.moveTarget.y;
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
      } else {
        this.localPos.x += (dx / dist) * step;
        this.localPos.y += (dy / dist) * step;
      }
    }

    this.localPos.x = Phaser.Math.Clamp(this.localPos.x, ZONE_MIN_X[this.role], ZONE_MAX_X[this.role]);
    this.localPos.y = Phaser.Math.Clamp(this.localPos.y, 110, WORLD_H - 30);

    const mySprite = this.playerSprites[this.role];
    mySprite.container.setPosition(this.localPos.x, this.localPos.y);
    mySprite.x = this.localPos.x;
    mySprite.y = this.localPos.y;
  }

  updateRemoteMovement() {
    const remote = this.playerSprites[this.remoteRole];
    remote.container.setPosition(remote.targetX, remote.targetY);
    remote.x = remote.targetX;
    remote.y = remote.targetY;

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
        if (st.occupied) {
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
