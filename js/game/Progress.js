// 過關進度:每一關的最佳星數,存在這台裝置的瀏覽器裡(localStorage)。
// 前一關至少拿到 1 星,下一關才會開放。

// 每一關拿 1 / 2 / 3 星需要的收入(時間到的時候結算)。
//
// 門檻是用「兩個自動玩家照真實規則、真實走路距離玩完整 3 分鐘」模擬出來的(tools/star-sim,每關各 40 局,內建佈局;
// 後台煎肉/組合/洗盤子,前台做飲料/上菜/結帳;含各關的平底鍋數、桌數、每組客人最多點幾樣、1-5 之後要洗髒盤、
// 傳送口入口跟出口各只放一樣、客人坐下要先有人過去點餐、耐心用完不會走但那一桌只付一半):
//   反應快的自動玩家(每個動作多 0.15 秒)平均收入:1-1 $141、1-2 $212、1-3 $309、1-4 $335、1-5 $365、1-6 $385、1-7 $437、1-8 $427
//   反應慢的自動玩家(每個動作多 0.9 秒)中位數收入:1-1 $110、1-2 $170、1-3 $220、1-4 $230、1-5 $235、1-6 $245、1-7 $255、1-8 $251
// 訂法:1 星 ≈ 慢玩家中位數的一半(過關門檻,不難);2 星 ≈ 慢玩家中位數的 85%;3 星 ≈ 快玩家平均的 85%(要配合得很順)。
// 菜價、烹煮/洗盤子時間、客人數量跟耐心、佈局、鍋子數有改的話,這些數字要重新量。
const LEVEL_STAR_SCORES = {
  1: [55, 95, 120],
  2: [85, 145, 180],
  3: [110, 185, 265],
  4: [115, 195, 285],
  5: [120, 200, 310],
  6: [125, 210, 325],
  7: [130, 215, 370],
  8: [125, 215, 365]
};

function starThresholds(level) {
  return LEVEL_STAR_SCORES[level] || LEVEL_STAR_SCORES[1];
}

function starsForScore(level, score) {
  return starThresholds(level).filter((need) => score >= need).length;
}

// 把星星畫到某個網頁元素裡:一律畫三顆,拿到的是亮的(金色),還沒拿到的是暗的(灰色)。
// 遊戲裡右上角、結算畫面、選關畫面都用這一個,拿到跟沒拿到的樣子到處都一樣(樣式在 style.css 的 .star)。
function renderStars(el, earned) {
  el.textContent = '';
  for (let i = 1; i <= 3; i++) {
    const star = document.createElement('span');
    star.className = 'star' + (i <= earned ? ' on' : '');
    star.textContent = '★';
    el.appendChild(star);
  }
}

const PROGRESS_STORAGE_KEY = 'coopCookingProgress';

const Progress = {
  _read() {
    try {
      const data = JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY));
      return data && data.stars ? data : { stars: {} };
    } catch (e) {
      return { stars: {} }; // 沒存過、存壞了、或瀏覽器不給存(無痕模式),都當成還沒玩過
    }
  },

  getStars(level) {
    return this._read().stars[level] || 0;
  },

  // 1-1 一開始就開放;其他關卡要「前面每一關」都至少 1 星(要一關一關照順序過,
  // 不會因為在本機測試先玩了後面的關卡,就跳過中間還沒過的關卡)。
  isUnlocked(level) {
    const stars = this._read().stars;
    for (let prev = 1; prev < level; prev++) {
      if (!(stars[prev] >= 1)) return false;
    }
    return true;
  },

  // 一局結束時呼叫:只有比之前的最佳紀錄好才會更新。回傳這一局拿到幾星。
  recordResult(level, score) {
    const stars = starsForScore(level, score);
    const data = this._read();
    if (stars > (data.stars[level] || 0)) {
      data.stars[level] = stars;
      try {
        localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(data));
      } catch (e) {
        // 存不了就算了,這一局的星數照樣顯示,只是不會記下來
      }
    }
    return stars;
  }
};
