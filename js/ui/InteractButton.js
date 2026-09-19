// 互動按鈕:按下時把 GameInput.interactJustPressed 設成 true,
// 遊戲迴圈讀取後會立刻重設為 false(單次觸發,不會持續連點)。

class InteractButtonUI {
  constructor(buttonEl) {
    this.button = buttonEl;
    this.button.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        GameInput.interactJustPressed = true;
        this.button.classList.add('pressed');
      },
      { passive: false }
    );
    this.button.addEventListener(
      'touchend',
      (e) => {
        e.preventDefault();
        this.button.classList.remove('pressed');
      },
      { passive: false }
    );
  }
}
