// 倒數計時 / 分數 / 結算畫面顯示

const HUD = {
  timeEl: null,
  scoreEl: null,
  resultOverlay: null,
  resultScoreEl: null,

  init() {
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

    if (state.ended) {
      this.resultOverlay.classList.remove('hidden');
      this.resultScoreEl.textContent = `本局收入:$${state.score}`;
    } else {
      this.resultOverlay.classList.add('hidden');
    }
  }
};
