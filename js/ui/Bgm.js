// 背景音樂。用一般的 <audio> 邊下載邊播(不放進 Phaser 的預載),音樂檔比較大,這樣進遊戲不用多等。
// 每次進遊戲隨機播一首;可以在暫停選單裡換歌、開關、調音量,開關跟音量會記在這台裝置的瀏覽器裡。
//
// 曲目是專案作者自己用 Gemini 生成的音樂(原始檔是生成出來的影片,只取聲音),沒有第三方授權的問題。
// 要加歌:把 mp3 放到 assets/audio/bgm/,在下面加一筆,並在 assets/audio/CREDITS.md 記下來源。
// 如果加的是別人的作品,要先確認授權;需要標示作者的話,標示要放在遊戲裡看得到的地方。
const BGM_TRACKS = [
  { name: '廚房音樂 1', file: 'assets/audio/bgm/kitchen_bgm_1.mp3' },
  { name: '廚房音樂 2', file: 'assets/audio/bgm/kitchen_bgm_2.mp3' }
];
const BGM_DEFAULT_VOLUME = 0.22; // 預設音量(0~1):要比音效小聲,不能蓋過煎肉/鈴聲。可以在暫停選單裡調
const BGM_STORAGE_KEY = 'coopCookingBgm';

const Bgm = {
  audio: null,
  index: 0,
  enabled: true,
  volume: BGM_DEFAULT_VOLUME,
  onChange: null, // 換歌/開關之後呼叫,讓畫面更新顯示

  _load() {
    try {
      const saved = JSON.parse(localStorage.getItem(BGM_STORAGE_KEY));
      if (saved) {
        this.index = Math.min(BGM_TRACKS.length - 1, Math.max(0, Number(saved.index) || 0));
        this.enabled = saved.enabled !== false;
        if (typeof saved.volume === 'number') this.volume = Math.min(1, Math.max(0, saved.volume));
      }
    } catch (e) {
      // 沒存過或瀏覽器不給存:用預設(第一首、開著)
    }
  },

  _save() {
    try {
      localStorage.setItem(BGM_STORAGE_KEY, JSON.stringify({ index: this.index, enabled: this.enabled, volume: this.volume }));
    } catch (e) {
      // 存不了就算了
    }
  },

  // 進遊戲時呼叫一次。瀏覽器(尤其是手機)可能要等使用者碰過畫面才准播,被擋下來的話等第一次點擊再播。
  start() {
    this._load();
    // 每次進遊戲隨機挑一首(開關跟音量照上次的設定);想換可以在暫停選單按「換一首」。
    this.index = Math.floor(Math.random() * BGM_TRACKS.length);
    this._play();
    const retry = () => {
      if (this.enabled && this.audio && this.audio.paused) this._play();
    };
    document.addEventListener('pointerdown', retry, { once: true });
  },

  _play() {
    if (!this.enabled) return;
    const track = BGM_TRACKS[this.index];
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.loop = true;
    }
    this.audio.volume = this.volume;
    if (!this.audio.src.endsWith(track.file)) this.audio.src = track.file;
    const attempt = this.audio.play();
    if (attempt && attempt.catch) attempt.catch(() => {}); // 被瀏覽器擋下來不算錯,start() 會在第一次點擊時再試
  },

  next() {
    this.index = (this.index + 1) % BGM_TRACKS.length;
    this.enabled = true;
    this._save();
    this._play();
    if (this.onChange) this.onChange();
  },

  toggle() {
    this.enabled = !this.enabled;
    this._save();
    if (this.enabled) this._play();
    else if (this.audio) this.audio.pause();
    if (this.onChange) this.onChange();
  },

  // 音量 0~1。調到 0 就是靜音(跟「關」不一樣:音樂還在播,只是聽不到)。
  setVolume(volume) {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.audio) this.audio.volume = this.volume;
    this._save();
  },

  label() {
    return this.enabled ? BGM_TRACKS[this.index].name : '(關閉)';
  }
};
