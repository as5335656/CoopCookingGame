# 音效來源

`sizzle.wav`、`wash.wav`、`plate_down.wav` 來自 BigSoundBank,`bell.mp3` 來自 Wikimedia Commons,授權為公有領域 / CC0,可以自由使用,不需要標示作者。`beep.wav`(快燒焦的嗶聲)是用 ffmpeg 直接合成的 1320Hz 短音,沒有外部來源。

| 檔案 | 用途 | 原始檔 | 作者 | 授權 |
| --- | --- | --- | --- | --- |
| `sizzle.wav` | 鍋子煮東西時循環播放的滋滋聲 | [Frying pan #2](https://bigsoundbank.com/frying-pan-2-s0144.html)(油熱了之後在平底鍋煎牛排,BigSoundBank #0144) | Joseph Sardin | CC0 |
| `wash.wav` | 洗盤子時循環播放的水聲 + 泡泡聲 | [Faucet / hands](https://bigsoundbank.com/faucet-hands-s0041.html)(水龍頭下洗手,#0041)疊上 [Water bubbles](https://bigsoundbank.com/water-bubbles-s0150.html)(用吸管在杯子裡吹泡泡,#0150) | Joseph Sardin | CC0 |
| `plate_down.wav` | 洗好一個盤子、放到旁邊桌上的那一聲 | [Small plate, set on table](https://bigsoundbank.com/detail-1190-small-plate-set-on-table.html)(小盤子放到木桌上,#1190) | Joseph Sardin | CC0 |
| `coins.wav` | 結帳收到錢的那一聲 | [Coins #2](https://bigsoundbank.com/coins-2-s0194.html)(錢幣掉進陶罐,BigSoundBank #0194),取其中一枚掉進去的那 0.95 秒 | Joseph Sardin | CC0 |
| `bell.mp3` | 煮好時的叮一聲 | [Bell-ring.flac](https://commons.wikimedia.org/wiki/File:Bell-ring.flac) | 見原始檔頁面 | CC0 |

處理方式:`sizzle.wav` 取原始檔第 1.5–10.5 秒,尾端 1 秒交叉淡入開頭做成無接縫循環,並放大音量;`bell.mp3` 從敲擊那一刻起取 1.6 秒並淡出。

`wash.wav`:水聲取原始檔第 4–11 秒做成 6 秒無接縫循環並放大,泡泡聲取原始檔第 15–21 秒壓平音量後疊上去。`plate_down.wav`:取原始檔裡第一次把盤子放到桌上的那 0.6 秒。

## 背景音樂(assets/audio/bgm/)

兩首都是專案作者自己用 Gemini 生成的(生成出來的是影片,這裡只取聲音),不是第三方的作品,不需要標示來源。

| 檔案 | 遊戲裡顯示的名稱 | 原始檔 |
| --- | --- | --- |
| `kitchen_bgm_1.mp3` | 廚房音樂 1 | `gemini_generated_video_2D47833D.mp4` |
| `kitchen_bgm_2.mp3` | 廚房音樂 2 | `gemini_generated_video_8FDBD567.mp4` |
| `menu_bgm.mp3` | 主選單音樂(主選單、選關卡、開房畫面播放) | `A_Pinch_of_Chaos.mp3`(專案作者提供;**來源與授權待作者確認**) |

處理方式:只取聲音、去掉頭尾的靜音(循環播放才不會有空白)、兩首調到一樣的響度,壓成 128kbps 的 mp3。

## 切菜聲

`chop.wav`:來自 Wikimedia Commons 的 [Chopping leeks.ogg](https://commons.wikimedia.org/wiki/File:Chopping_leeks.ogg)(PDSounds,作者 hugh,公有領域)。取原始檔第 17.5–20.65 秒連續切菜的那一段,頭尾交叉淡入做成 3 秒循環並放大。
