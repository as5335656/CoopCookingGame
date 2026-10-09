// 「區域網路」找房間:開房的人不用給房號,同一個 Wi-Fi 底下的另一台裝置按「區域網路」就會列出正在開的房間。
//
// 瀏覽器不能真的去掃區域網路,所以用繞路的做法:
//   1. 連同一個 Wi-Fi 的裝置,對外的網路位址(公開 IP)是同一個。兩邊各自去問一個外部服務「我的對外位址是多少」。
//   2. 把那個位址打亂成一串代號(不會把位址本身傳出去),當成這個網路的「暗號」。
//   3. 開房的人用「暗號 + 第幾格」當名字,在配對伺服器(PeerJS)上多掛一個「招牌」。每個網路有 LAN_SLOTS 格,所以同時最多列出這麼多間房。
//   4. 找房間的人照同一個暗號,把每一格都問一遍;有招牌的那幾格會回覆房號、開房者名稱、關卡。
//
// 限制:兩台要在同一個 Wi-Fi(對外位址一樣)才找得到;用行動網路、或查位址的服務連不上的時候找不到,這時改用房號或 QR code。
const LAN_SLOTS = 4;
const LAN_SCAN_MS = 6000; // 找房間最多等多久
const LAN_IP_TIMEOUT_MS = 5000;
// 查對外位址的服務(只走 IPv4:同一個 Wi-Fi 的裝置 IPv6 位址各不相同,IPv4 才會一樣)。第一個連不上就試下一個。
const LAN_IP_SERVICES = ['https://api.ipify.org?format=json', 'https://ipv4.icanhazip.com'];

const LanLobby = {
  _prefix: null, // 這個網路的暗號(查過一次就記著)
  _beacon: null, // 開房的人掛的招牌
  _scanner: null,

  async _publicIp() {
    for (const url of LAN_IP_SERVICES) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), LAN_IP_TIMEOUT_MS);
        const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
        clearTimeout(timer);
        const text = (await res.text()).trim();
        const ip = text.startsWith('{') ? JSON.parse(text).ip : text;
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
      } catch (e) {
        // 這個服務連不上,試下一個
      }
    }
    return null;
  },

  // 這個網路的暗號;查不到對外位址就回傳 null(區域網路功能這次不能用)。
  async _networkPrefix() {
    if (this._prefix) return this._prefix;
    const ip = await this._publicIp();
    if (!ip) return null;
    // 把位址打亂成代號(FNV-1a):配對伺服器上看到的名字不會直接露出位址。
    let hash = 2166136261;
    for (const ch of 'coopcook-lan:' + ip) {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    this._prefix = 'coopcook-lan-' + (hash >>> 0).toString(36) + '-';
    return this._prefix;
  },

  // 開房的人呼叫:掛上招牌。getInfo() 要回傳 { code, name, level }(每次有人來問都重新拿,房號換了也會是新的)。
  // 掛不上(查不到位址、格子滿了)就安靜地放棄,對方還是可以用房號或 QR code 加入。
  async advertise(getInfo) {
    this.stopAdvertising();
    const token = (this._advertiseToken = {});
    const prefix = await this._networkPrefix();
    if (!prefix || this._advertiseToken !== token) return;
    const trySlot = (slot) => {
      if (slot > LAN_SLOTS || this._advertiseToken !== token) return;
      const peer = new Peer(prefix + slot);
      this._beacon = peer;
      peer.on('connection', (conn) => {
        conn.on('open', () => conn.send(Object.assign({ type: 'lan-room' }, getInfo())));
      });
      // 手機螢幕關掉再打開,跟配對伺服器的連線會斷:重新連回去,招牌才不會消失。
      peer.on('disconnected', () => {
        if (this._beacon === peer && !peer.destroyed) peer.reconnect();
      });
      peer.on('error', (err) => {
        if (err && err.type === 'unavailable-id' && this._beacon === peer) {
          peer.destroy();
          trySlot(slot + 1); // 這一格有別的房間掛著,換下一格
        }
      });
    };
    trySlot(1);
  },

  stopAdvertising() {
    this._advertiseToken = null;
    if (this._beacon) {
      this._beacon.destroy();
      this._beacon = null;
    }
  },

  // 找房間的人呼叫。找到一間就呼叫一次 onFound({ code, name, level });
  // 全部問完(或等太久)呼叫 onDone(reason):reason 是 null(正常結束)、'no-network'(查不到對外位址)或 'error'(配對伺服器連不上)。
  async scan(onFound, onDone) {
    this.stopScanning();
    const token = (this._scanToken = {});
    const prefix = await this._networkPrefix();
    if (this._scanToken !== token) return;
    if (!prefix) {
      onDone('no-network');
      return;
    }
    const peer = new Peer();
    this._scanner = peer;
    const seen = new Set();
    let pending = LAN_SLOTS;
    let finished = false;
    const finish = (reason) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (this._scanner === peer) this._scanner = null;
      peer.destroy();
      if (this._scanToken === token) onDone(reason);
    };
    const settle = () => {
      pending -= 1;
      if (pending <= 0) finish(null);
    };
    const timer = setTimeout(() => finish(null), LAN_SCAN_MS);
    peer.on('open', () => {
      for (let slot = 1; slot <= LAN_SLOTS; slot++) {
        const conn = peer.connect(prefix + slot, { reliable: true });
        conn.on('data', (msg) => {
          if (msg && msg.type === 'lan-room' && msg.code && !seen.has(msg.code) && this._scanToken === token) {
            seen.add(msg.code);
            onFound({ code: String(msg.code), name: String(msg.name || '玩家').slice(0, 12), level: Number(msg.level) || 1 });
          }
          conn.close();
          settle();
        });
      }
    });
    peer.on('error', (err) => {
      if (err && err.type === 'peer-unavailable') settle(); // 這一格沒有人掛招牌
      else finish('error');
    });
  },

  stopScanning() {
    this._scanToken = null;
    if (this._scanner) {
      this._scanner.destroy();
      this._scanner = null;
    }
  }
};
