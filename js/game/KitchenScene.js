// 廚房場景:場景佈局、玩家移動、站點渲染、與 GameSync 對接。
// 佈局對應參考截圖:左側料理站、中間出餐口、右側外場桌位(顧客主要從右側/門口進來)。

const WORLD_W = 960;
const WORLD_H = 540;
const MOVE_SPEED = 220; // px/sec
const INTERACT_RADIUS = 72;

const STATION_LAYOUT = {
  ingredient_potato: { x: 90, y: 150, type: 'ingredient_source', itemType: 'potato_raw', emoji: '🥔', label: '生馬鈴薯' },
  fryer_1: { x: 90, y: 260, type: 'cooking', recipeId: 'fries', emoji: '🍳', label: '油炸鍋' },
  plate_stack: { x: 90, y: 370, type: 'plate_stack', emoji: '🍽️', label: '取盤' },
  trash_bin: { x: 90, y: 470, type: 'trash', emoji: '🗑️', label: '垃圾桶' },

  pass_window: { x: 480, y: 300, type: 'pass_window', emoji: '🛎️', label: '出餐口' },

  drink_dispenser: { x: 860, y: 150, type: 'dispenser', recipeId: 'drink', emoji: '🥤', label: '飲料機' },
  table_1: { x: 700, y: 260, type: 'table', emoji: '', label: '桌位1' },
  table_2: { x: 860, y: 460, type: 'table', emoji: '', label: '桌位2' }
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

  create() {
    this.role = window.NET_ROLE;
    this.isHost = this.role === 'host';
    this.remoteRole = this.isHost ? 'joiner' : 'host';

    this.state = this.isHost ? createInitialState() : null;

    this.drawBackground();
    this.createStations();
    this.createPlayers();

    this.localPos = { x: PLAYER_SPAWN[this.role].x, y: PLAYER_SPAWN[this.role].y };

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
      const container = this.add.container(def.x, def.y);

      const bg = this.add.circle(0, 0, 34, 0x3a2c20).setStrokeStyle(3, 0xf5ead9);
      const icon = def.emoji ? this.add.text(0, -2, def.emoji, { fontSize: '28px' }).setOrigin(0.5) : null;
      const label = this.add.text(0, 40, def.label, { fontSize: '11px', color: '#3a2c20', fontStyle: 'bold' }).setOrigin(0.5);
      const progressBg = this.add.rectangle(0, 52, 52, 7, 0x1a1410).setOrigin(0.5).setVisible(false);
      const progressBar = this.add.rectangle(-26, 52, 0, 7, 0xe8804a).setOrigin(0, 0.5).setVisible(false);
      const heldItemText = this.add.text(0, -34, '', { fontSize: '22px' }).setOrigin(0.5);

      const parts = [bg, label, progressBg, progressBar, heldItemText];
      if (icon) parts.push(icon);
      container.add(parts);

      this.stationSprites[id] = { container, bg, progressBg, progressBar, heldItemText, def };
    }
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
    this.updateLocalMovement(delta);
    this.updateRemoteMovement();
    this.handleInteractInput(time);

    if (this.isHost && this.state && !this.state.ended) {
      tick(this.state, delta);
      if (time - this.lastStateSent > 150) {
        this.lastStateSent = time;
        GameSync.sendState(this.state);
      }
    }

    if (this.state) {
      this.renderState();
    }
  }

  updateLocalMovement(delta) {
    const dx = GameInput.dx;
    const dy = GameInput.dy;
    const mag = Math.sqrt(dx * dx + dy * dy);
    if (mag > 0.15) {
      const nx = dx / mag;
      const ny = dy / mag;
      this.localPos.x += nx * MOVE_SPEED * (delta / 1000);
      this.localPos.y += ny * MOVE_SPEED * (delta / 1000);
      this.localPos.x = Phaser.Math.Clamp(this.localPos.x, 30, WORLD_W - 30);
      this.localPos.y = Phaser.Math.Clamp(this.localPos.y, 110, WORLD_H - 30);
    }

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
      } else if (st.type === 'pass_window') {
        view.heldItemText.setText(st.itemHeld ? itemEmoji(st.itemHeld) : '');
      } else if (st.type === 'table') {
        if (st.occupied) {
          const recipe = getRecipe(st.recipeId);
          view.heldItemText.setText('🐼 ' + itemEmoji(recipe.platedItem));
          const ratio = Phaser.Math.Clamp(st.patience / st.maxPatience, 0, 1);
          view.progressBg.setVisible(true);
          view.progressBar.setVisible(true);
          view.progressBar.width = 52 * ratio;
          view.progressBar.fillColor = ratio < 0.3 ? 0xff6b6b : 0x6fe86f;
        } else {
          view.heldItemText.setText('');
          view.progressBg.setVisible(false);
          view.progressBar.setVisible(false);
        }
      }
    }

    HUD.update(state);
  }
}
