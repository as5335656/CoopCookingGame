// 手機觸控虛擬搖桿(DOM 疊在 Phaser 畫布上方),寫入全域 GameInput 供遊戲迴圈讀取。

const GameInput = { dx: 0, dy: 0, interactJustPressed: false };

class VirtualJoystick {
  constructor(zoneEl) {
    this.zone = zoneEl;
    this.base = document.createElement('div');
    this.base.className = 'joystick-base';
    this.knob = document.createElement('div');
    this.knob.className = 'joystick-knob';
    this.base.appendChild(this.knob);
    this.zone.appendChild(this.base);

    this.active = false;
    this.touchId = null;
    this.centerX = 0;
    this.centerY = 0;
    this.maxRadius = 45;

    this.zone.addEventListener('touchstart', this.onStart.bind(this), { passive: false });
    this.zone.addEventListener('touchmove', this.onMove.bind(this), { passive: false });
    this.zone.addEventListener('touchend', this.onEnd.bind(this), { passive: false });
    this.zone.addEventListener('touchcancel', this.onEnd.bind(this), { passive: false });
  }

  onStart(e) {
    e.preventDefault();
    if (this.active) return;
    const touch = e.changedTouches[0];
    this.active = true;
    this.touchId = touch.identifier;
    const rect = this.base.getBoundingClientRect();
    this.centerX = rect.left + rect.width / 2;
    this.centerY = rect.top + rect.height / 2;
    this.updateKnob(touch.clientX, touch.clientY);
  }

  onMove(e) {
    if (!this.active) return;
    e.preventDefault();
    for (const touch of e.changedTouches) {
      if (touch.identifier === this.touchId) {
        this.updateKnob(touch.clientX, touch.clientY);
      }
    }
  }

  onEnd(e) {
    for (const touch of e.changedTouches) {
      if (touch.identifier === this.touchId) {
        this.active = false;
        this.touchId = null;
        GameInput.dx = 0;
        GameInput.dy = 0;
        this.knob.style.transform = 'translate(0px, 0px)';
      }
    }
  }

  updateKnob(clientX, clientY) {
    let dx = clientX - this.centerX;
    let dy = clientY - this.centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > this.maxRadius) {
      dx = (dx / dist) * this.maxRadius;
      dy = (dy / dist) * this.maxRadius;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    GameInput.dx = dx / this.maxRadius;
    GameInput.dy = dy / this.maxRadius;
  }
}
