# CoopCookingGame

雙人合作手機遊戲,類似《胡鬧廚房》(Overcooked)玩法,支援區域網路(LAN)雙機連線。

## 技術棧
- Unity 2022.3 LTS (C#)
- 2D 模板
- 連線:Unity Netcode for GameObjects + Unity Transport(LAN)
- 目標平台:Android

## 環境安裝進度
- [x] Git
- [x] Unity Hub
- [ ] Unity Editor 2022.3 LTS + Android Build Support (含 OpenJDK, Android SDK/NDK)
- [ ] Unity 專案建立(2D 模板)
- [ ] Netcode for GameObjects 套件安裝

## 專案結構(Unity 專案建立後)
```
Assets/
  Scripts/
    Player/        # 玩家移動、操作
    Networking/     # 連線、房間配對
    Gameplay/       # 料理/任務相關邏輯
    UI/             # 觸控搖桿、按鈕、選單
  Scenes/
  Prefabs/
  Sprites/          # 美術素材放這裡
  Audio/
ProjectSettings/
Packages/
```

## 開發路線
1. 單機原型(角色移動、互動物件、任務流程)
2. 加入 Netcode 連線層(同步移動/互動)
3. 區網配對流程(Host 開房 / Client 加入)
4. 觸控 UI(虛擬搖桿 + 互動按鈕)
5. 打包 APK,雙機實測

## 參考素材
- 參考影片:下載中,待截圖分析玩法細節
