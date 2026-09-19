// 封裝 PeerJS:建房產生房號、加入房間、DataChannel 收發
// 配對完成後,遊戲資料透過 RTCDataChannel 直接 P2P 傳輸,不經任何中繼。

const ROOM_PREFIX = 'coopcook-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 排除容易混淆的 0/O, 1/I

function generateRoomCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

class PeerConnection {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.roomCode = null;
    this.role = null; // 'host' | 'joiner'
    this.onOpen = null;      // () => void  連線建立完成
    this.onData = null;      // (data) => void
    this.onClose = null;     // () => void
    this.onError = null;     // (message) => void
  }

  createRoom() {
    this.role = 'host';
    this.roomCode = generateRoomCode();
    this.peer = new Peer(ROOM_PREFIX + this.roomCode);

    this.peer.on('open', () => {
      // Peer 已在 PeerJS 伺服器註冊完成,等待對方連進來
    });

    this.peer.on('connection', (conn) => {
      this.conn = conn;
      this._bindConnEvents();
    });

    this.peer.on('error', (err) => {
      this._handleError(err);
    });

    return this.roomCode;
  }

  joinRoom(code) {
    this.role = 'joiner';
    this.roomCode = code;
    this.peer = new Peer();

    this.peer.on('open', () => {
      this.conn = this.peer.connect(ROOM_PREFIX + code, { reliable: true });
      this._bindConnEvents();
    });

    this.peer.on('error', (err) => {
      this._handleError(err);
    });
  }

  _bindConnEvents() {
    this.conn.on('open', () => {
      if (this.onOpen) this.onOpen();
    });
    this.conn.on('data', (data) => {
      if (this.onData) this.onData(data);
    });
    this.conn.on('close', () => {
      if (this.onClose) this.onClose();
    });
    this.conn.on('error', (err) => {
      this._handleError(err);
    });
  }

  _handleError(err) {
    let message = '連線發生錯誤';
    if (err && err.type === 'peer-unavailable') {
      message = '找不到這個房號,請確認房號是否正確,或對方是否已建立房間';
    } else if (err && err.type === 'network') {
      message = '網路連線失敗,請確認手機已連上網路';
    } else if (err && err.type) {
      message = '連線錯誤:' + err.type;
    }
    if (this.onError) this.onError(message);
  }

  send(data) {
    if (this.conn && this.conn.open) {
      this.conn.send(data);
    }
  }

  destroy() {
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }
}
