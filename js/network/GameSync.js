// 把 PeerConnection 收到的原始訊息轉成遊戲事件。
// Host 權威模型:
//   - 雙方各自直接互傳自己的移動位置(不經驗證,追求跟手)
//   - Joiner 的互動請求送給 Host 驗證處理,Host 再把完整狀態快照廣播出去
//   - Host 自己的互動直接在本地處理,不需要送給自己

const GameSync = {
  pc: null,
  role: null,
  onRemoteMove: null,
  onInteractRequest: null,
  onStateUpdate: null,

  init(peerConnection, role) {
    this.pc = peerConnection;
    this.role = role;
    this.pc.onData = (msg) => this._handle(msg);
  },

  _handle(msg) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'move':
        if (this.onRemoteMove) this.onRemoteMove(msg.x, msg.y);
        break;
      case 'interact':
        if (this.onInteractRequest) this.onInteractRequest(msg.stationId);
        break;
      case 'state':
        if (this.onStateUpdate) this.onStateUpdate(msg.state);
        break;
    }
  },

  sendMove(x, y) {
    this.pc.send({ type: 'move', x, y });
  },

  sendInteract(stationId) {
    this.pc.send({ type: 'interact', stationId });
  },

  sendState(state) {
    this.pc.send({ type: 'state', state });
  }
};
