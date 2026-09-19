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

class KitchenScene extends Phaser.Scene {
  constructor() {
    super('KitchenScene');
  }

  preload() {
    this.load.image('kitchen_bg', 'assets/sprites/kitchen_bg.png');
  }

  create() {
    this.role = window.NET_ROLE;
    this.isHost = this.role === 'host';
    this.remoteRole = this.isHost ? 'joiner' : 'host';
    this.localTestMode = !!window.LOCAL_TEST_MODE;

    this.state = this.isHost ? createInitialState() : null;

    this.drawBackground();
    this.createStations();
    this.createPlayers();

    this.localPos = { x: PLAYER_SPAWN[this.role].x, y: PLAYER_SPAWN[this.role].y };
    this.moveTarget = null;

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

    this.setupTapToMove();

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

  // 背景暫時直接用參考截圖裁出來的畫面(使用者自己的圖),之後會換成正式美術。
  // 因為背景圖裡本來就畫了它自己的物件跟角色,位置不會跟我們自己畫的站點/玩家完全對齊,
  // 純粹先求「看起來像」,等真的 PNG 素材來了就會整個換掉。
  drawBackground() {
    this.add.image(WORLD_W / 2, WORLD_H / 2, 'kitchen_bg').setDisplaySize(WORLD_W, WORLD_H).setDepth(-2);
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

  createEquipmentView(def) {
    const container = this.add.container(def.x, def.y);

    // 工作台目前還沒有 PNG,先用方形邊框佔位(之後直接換圖不影響邏輯)
    const bg =
      def.type === 'workbench'
        ? this.add.rectangle(0, 0, 64, 64, 0x8a7256).setStrokeStyle(3, 0xf5ead9)
        : this.add.circle(0, 0, 34, 0x3a2c20).setStrokeStyle(3, 0xf5ead9);
    const icon = def.emoji ? this.add.text(0, -2, def.emoji, { fontSize: '28px' }).setOrigin(0.5) : null;
    const label = this.add.text(0, 40, def.label, { fontSize: '11px', color: '#3a2c20', fontStyle: 'bold' }).setOrigin(0.5);
    const progressBg = this.add.rectangle(0, 52, 52, 7, 0x1a1410).setOrigin(0.5).setVisible(false);
    const progressBar = this.add.rectangle(-26, 52, 0, 7, 0xe8804a).setOrigin(0, 0.5).setVisible(false);
    const heldItemText = this.add.text(0, -34, '', { fontSize: '22px' }).setOrigin(0.5);

    const parts = [bg, label, progressBg, progressBar, heldItemText];
    if (icon) parts.push(icon);
    container.add(parts);

    return { container, bg, progressBg, progressBar, heldItemText, def };
  }

  // 桌子做成方形(跟廚具機台的圓形區分開來),食物/飲料會實際「擺在桌面上」而不是用文字泡泡飄在空中。
  createTableView(def) {
    const container = this.add.container(def.x, def.y);

    const tableTop = this.add.rectangle(0, 0, 68, 68, 0xb5824a).setStrokeStyle(3, 0x6e4f2e);
    const customerText = this.add.text(0, -46, '', { fontSize: '26px' }).setOrigin(0.5);
    const plate = this.add.circle(0, 6, 20, 0xf5ead9).setStrokeStyle(2, 0xcbbfa8).setVisible(false);
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
      const body = this.add.circle(0, 0, 22, PLAYER_COLOR[role]);
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

  // 點擊場景地板移動,取代搖桿。點到的位置會先被鎖在自己那一側的可移動範圍內
  // (中間走道兩邊都不能穿越),再設成移動目標。
  // 本機測試模式下,點左半邊操控 P1、點右半邊操控 P2,且點到站點範圍內會走過去後自動互動。
  setupTapToMove() {
    this.input.on('pointerdown', (pointer) => {
      if (this.localTestMode) {
        const midX = (ZONE_MAX_X.host + ZONE_MIN_X.joiner) / 2;
        const role = pointer.worldX < midX ? 'host' : 'joiner';
        this.handleLocalTestTap(role, pointer.worldX, pointer.worldY);
      } else {
        const targetX = Phaser.Math.Clamp(pointer.worldX, ZONE_MIN_X[this.role], ZONE_MAX_X[this.role]);
        const targetY = Phaser.Math.Clamp(pointer.worldY, 110, WORLD_H - 30);
        this.moveTarget = { x: targetX, y: targetY };
        this.showTapMarker(targetX, targetY);
      }
    });
  }

  handleLocalTestTap(role, x, y) {
    const targetX = Phaser.Math.Clamp(x, ZONE_MIN_X[role], ZONE_MAX_X[role]);
    const targetY = Phaser.Math.Clamp(y, 110, WORLD_H - 30);
    this.testMoveTargets[role] = { x: targetX, y: targetY };
    this.testPendingInteract[role] = this.findNearestStation(targetX, targetY);
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
