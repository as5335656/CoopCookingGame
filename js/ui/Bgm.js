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
// 主選單(還沒進遊戲:主選單、選關卡、開房/加入房間的畫面)播的音樂。進遊戲後換成上面的廚房音樂。
const MENU_TRACK = { name: '主選單音樂', file: 'assets/audio/bgm/menu_bgm.mp3' };
const BGM_DEFAULT_VOLUME = 0.35; // 預設音量(滑桿的位置,0~1):要比音效小聲,不能蓋過煎肉/鈴聲。可以在暫停選單裡調
const SFX_DEFAULT_VOLUME = 1; // 音效的預設音量(0~1),跟音樂分開調
const SFX_STORAGE_KEY = 'coopCookingSfx';
const BGM_STORAGE_KEY = 'coopCookingBgm';

const Bgm = {
  audio: null,
  index: 0,
  enabled: true,
  volume: BGM_DEFAULT_VOLUME,
  onChange: null, // 換歌/開關之後呼叫,讓畫面更新顯示
  gainNode: null, // 音樂的音量控制(見 _applyVolume)
  inMenu: false, // 現在播的是主選單音樂還是遊戲裡的廚房音樂

  // 遊戲音效用的音訊系統(Web Audio)。main.js 一載入就建好一個、之後一直共用,所以在主選單(還沒有 Phaser 遊戲)也拿得到。
  _context() {
    if (window.getSharedAudioContext) return window.getSharedAudioContext();
    return (window.game && window.game.sound && window.game.sound.context) || null;
  },

  // 滑桿位置換成實際音量:用平方,滑桿在小聲那一段比較好調(35% 的位置大約是 0.12 的音量)。
  _gain() {
    return this.volume * this.volume;
  },

  // iPhone 的瀏覽器不准網頁改 <audio> 的音量(audio.volume 設了沒有用,永遠是最大聲),
  // 所以把音樂接到遊戲音效用的那個音訊系統(Web Audio)上,用它的音量控制(GainNode)來調。
  // 接不上(瀏覽器不支援)就退回去改 audio.volume,電腦上一樣有效。
  _applyVolume() {
    if (!this.audio) return;
    if (!this.gainNode) {
      try {
        const ctx = this._context();
        if (ctx && ctx.createMediaElementSource) {
          const source = ctx.createMediaElementSource(this.audio);
          this.gainNode = ctx.createGain();
          source.connect(this.gainNode);
          this.gainNode.connect(ctx.destination);
          this.audio.volume = 1;
        }
      } catch (e) {
        this.gainNode = null;
      }
    }
    if (this.gainNode) this.gainNode.gain.value = this._gain();
    else this.audio.volume = this._gain();
  },

  // 接到 Web Audio 之後,音訊系統要是「啟動」的狀態才有聲音(手機要等使用者碰過畫面)。
  _wake() {
    const ctx = this._context();
    if (ctx && ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
  },

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

  // 主選單畫面一出來就呼叫:播主選單音樂(開關跟音量跟遊戲裡共用同一份設定)。
  // 瀏覽器不准網頁一打開就自己出聲,所以實際上是使用者第一次碰畫面的那一刻才開始播。
  startMenu() {
    this._load();
    this.inMenu = true;
    this._play();
    const retry = () => {
      this._wake();
      if (this.inMenu && this.enabled && this.audio && this.audio.paused) this._play();
    };
    document.addEventListener('pointerdown', retry, { once: true });
    document.addEventListener('touchend', retry, { once: true });
  },

  // 進遊戲時呼叫一次。瀏覽器(尤其是手機)可能要等使用者碰過畫面才准播,被擋下來的話等第一次點擊再播。
  start() {
    this._load();
    this.inMenu = false;
    // 每次進遊戲隨機挑一首(開關跟音量照上次的設定);想換可以在暫停選單按「換一首」。
    this.index = Math.floor(Math.random() * BGM_TRACKS.length);
    this._play();
    const retry = () => {
      this._wake();
      if (this.enabled && this.audio && this.audio.paused) this._play();
    };
    document.addEventListener('pointerdown', retry, { once: true });
    document.addEventListener('touchend', retry, { once: true });
  },

  _play() {
    if (!this.enabled) return;
    const track = this.inMenu ? MENU_TRACK : BGM_TRACKS[this.index];
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.loop = true;
    }
    this._applyVolume();
    this._wake();
    if (!this.audio.src.endsWith(track.file)) this.audio.src = track.file;
    const attempt = this.audio.play();
    if (attempt && attempt.catch) attempt.catch(() => {}); // 被瀏覽器擋下來不算錯,start() 會在第一次點擊時再試
  },

  // 停掉音樂(進編輯佈局的時候用:編輯模式不播音樂)。
  stop() {
    this.inMenu = false;
    if (this.audio) this.audio.pause();
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
    this._applyVolume();
    this._save();
  },

  label() {
    return this.enabled ? BGM_TRACKS[this.index].name : '(關閉)';
  }
};

// 音效音量(煎肉、鈴聲、切菜...):跟音樂分開調,也記在這台裝置的瀏覽器裡。
const Sfx = {
  volume: SFX_DEFAULT_VOLUME,

  // 進遊戲時呼叫一次,把存的音量套到遊戲的音效系統上。
  start() {
    try {
      const saved = Number(localStorage.getItem(SFX_STORAGE_KEY));
      if (localStorage.getItem(SFX_STORAGE_KEY) !== null && saved >= 0 && saved <= 1) this.volume = saved;
    } catch (e) {
      // 用預設
    }
    this._apply();
  },

  _apply() {
    if (window.game && window.game.sound) window.game.sound.volume = this.volume;
  },

  setVolume(volume) {
    this.volume = Math.min(1, Math.max(0, volume));
    this._apply();
    try {
      localStorage.setItem(SFX_STORAGE_KEY, String(this.volume));
    } catch (e) {
      // 存不了就算了
    }
  }
};
