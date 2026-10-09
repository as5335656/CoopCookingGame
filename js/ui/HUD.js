// 倒數計時 / 分數 / 結算畫面顯示

const HUD = {
  timeEl: null,
  scoreEl: null,
  resultOverlay: null,
  resultScoreEl: null,
  pauseOverlay: null,
  level: 1, // 這一局是第幾關(KitchenScene 建立場景時填),算星數用
  wasEnded: false,

  init() {
    this.resultStarsEl = document.getElementById('result-stars');
    this.starsEl = document.getElementById('hud-stars');
    this.shownStars = -1;
    this.resultGoalEl = document.getElementById('result-goal');
    this.wasEnded = false;
    this.pauseOverlay = document.getElementById('pause-overlay');
    this.timeEl = document.getElementById('hud-timer');
    this.scoreEl = document.getElementById('hud-score');
    this.resultOverlay = document.getElementById('result-overlay');
    this.resultScoreEl = document.getElementById('result-score');
  },

  // 完全依 state.ended 決定結算畫面顯示與否,不用額外的「已顯示過」旗標。
  // 這樣不管是 Host 還是 Joiner,只要收到最新狀態,畫面就會自動同步,
  // Host 按「再玩一次」重置後,Joiner 端的結算畫面也會在下一次狀態同步時自動消失。
  update(state) {
    const seconds = Math.ceil(state.timeRemaining / 1000);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    this.timeEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    this.scoreEl.textContent = `$${state.score}`;

    // 右上角:1 星、2 星、3 星各要多少收入,三個目標都列出來;已經達到的是亮的(金色),還沒達到的是暗的。
    const starsNow = starsForScore(this.level, state.score);
    if (starsNow !== this.shownStars) {
      this.shownStars = starsNow;
      this.starsEl.textContent = '';
      starThresholds(this.level).forEach((need, i) => {
        const goal = document.createElement('span');
        goal.className = 'star-goal' + (i < starsNow ? ' on' : '');
        const icons = document.createElement('span');
        icons.className = 'star' + (i < starsNow ? ' on' : '');
        icons.textContent = '★'.repeat(i + 1);
        goal.append(icons, ` $${need}`);
        this.starsEl.appendChild(goal);
      });
    }

    // 暫停也是完全照 state.paused 顯示,兩台裝置只要有一邊按暫停,兩邊都會跳出選單。
    this.pauseOverlay.classList.toggle('hidden', !state.paused);

    // 時間到的那一刻結算星數並記進過關進度(每一局只記一次;Host 按「再玩一次」後 ended 會變回 false,下一局再記)。
    if (state.ended && !this.wasEnded) {
      const stars = Progress.recordResult(this.level, state.score);
      renderStars(this.resultStarsEl, stars);
      const goals = starThresholds(this.level).map((need, i) => `${i + 1}★ $${need}`).join(' / ');
      this.resultGoalEl.textContent = (stars >= 1 ? '過關!' : '還沒過關(至少要 1 星才會開放下一關)') + ' ' + goals;
    }
    this.wasEnded = !!state.ended;

    if (state.ended) {
      this.resultOverlay.classList.remove('hidden');
      this.resultScoreEl.textContent = `本局收入:$${state.score}`;
    } else {
      this.resultOverlay.classList.add('hidden');
    }
  }
};
