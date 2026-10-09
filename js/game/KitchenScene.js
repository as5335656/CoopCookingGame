// 廚房場景:場景佈局、玩家移動、站點渲染、與 GameSync 對接。
// 佈局對應參考截圖:左側料理站、中間出餐口、右側外場桌位(顧客主要從右側/門口進來)。

const WORLD_W = 960;
const WORLD_H = 540;
const MOVE_SPEED = 220;
const MOVE_SEND_INTERVAL_MS = 50; // 每隔多久把自己的位置傳給對方
const REMOTE_CATCH_UP_S = 0.1; // 對方角色落後時,大約花多久追上最新位置
const REMOTE_SNAP_DIST = 200; // 落後超過這個距離就不慢慢走了,直接跳過去 // px/sec
// 互動距離:玩家的方塊跟站點的方塊之間最多可以隔多遠還算「碰得到」。
// 用方形(不是圓形半徑)判定,這樣站在站點斜對角也算碰得到——L 型流理台轉角那一格
// 只能從斜對角靠近,用圓形半徑量會永遠差一點點,變成怎麼點都走不過去。
const INTERACT_REACH = 10;
const PLAYER_SIZE = 64; // 角色顯示大小,兩個角色之間互相推開也用這個距離
// 角色跟站點之間的碰撞用比顯示圖小的「身體」方塊:用整張 64px 的圖去算的話,兩排站點之間要留超過
// 64px 才走得過去,站點稍微排密一點整區就被封死(內建的 1-1 佈局就是這樣,廚房這邊走不到垃圾桶跟出餐口)。
const PLAYER_BODY = 36;
const CUTTER_AWAY_GRACE_MS = 300; // 切菜的人離開鉆板多久算「走開了」(見 releaseAbsentCutters)
// 快燒焦的警告:煮好後過了「會燒焦的時間」的這個比例才開始閃,閃爍間隔從 SLOW 一路縮短到 FAST。
const BURN_WARN_START_RATIO = 0.5; // 煎好後過了一半的時間(5 秒)才開始閃紅框倒數
const BURN_WARN_SLOW_MS = 650;
const BURN_WARN_FAST_MS = 130;
const CUSTOMER_DEPTH = 5; // 客人:會從門口走到座位,畫在站點跟角色上面、泡泡下面
// 盤子圖的顯示大小(長邊),手上拿的跟檯面上放的共用。跟「取盤」站點上那個盤子圖一樣大
// (站點預設邊長 64 的 0.8 倍),這樣從取盤站拿起來、放到檯面上、再拿起來,大小都不會變。
const PLATE_DISPLAY_SIZE = 52;
const CUP_TO_PLATE_RATIO = (64 * 0.6) / 52; // 杯子的大小相對於盤子:換算出來剛好等於杯架上圖示的大小(64 的檯面 x 0.6)
const ITEM_ON_TABLE_RATIO = 0.6; // 食材放在檯面上(包含材料箱上的圖示)的大小,相對於檯面邊長
const DIRTY_PLATE_TINT = 0xa58f6f; // 髒盤:盤子圖染成這個顏色
// 客人、客人頭上「要什麼」的泡泡:放大一點才看得清楚(手機螢幕小,太小的圖會糊成一團)。
const CUSTOMER_SIZE = 36; // 客人圖的顯示高度(寬度照原圖比例)
const PLAYER_DISPLAY_HEIGHT = 76; // 員工圖的顯示高度(寬度照原圖比例,不硬壓成正方形)
const ORDER_ICON_SIZE = 24; // 客人頭上泡泡裡每一樣東西的圖示大小
const ORDER_ICON_SIZE_SMALL = 17; // 最上排的桌子坐了兩位客人時,排在桌面上的泡泡用的小圖示
const ORDER_BUBBLE_H = ORDER_ICON_SIZE + 10;
const HUD_CHIPS_BOTTOM = 66; // 右上角那排資訊(星星目標/收入/齒輪)的下緣(世界座標 y,抓寬一點)
const ORDER_BAR_BOTTOM = 134; // 畫面上方訂單列的下緣(世界座標 y);客人頭上的泡泡要在這條線以下才看得到
const OVERLAY_DEPTH = 20; // 進度條、客人的對話泡泡:畫在所有站點跟角色的上面
const EDIT_GRID_SIZE = 8; // 編輯模式拖曳物件時,座標會對齊到這個格線大小,方便排整齊
const EDIT_SNAP_DIST = 7; // 編輯模式拖曳:離附近物件的對齊線這麼近就吸過去
const EDIT_SNAP_RANGE = 80; // 只跟這個距離內的物件對齊

// 走路用的路徑規劃網格:960/6=160 欄,540/6=90 列(格子要夠細,不然站點旁邊可以站的
// 「安全環帶」常常只有幾像素寬,粗一點的格子容易整圈都跨不進那條窄環帶裡)。
// 角色移動不再是「直線走、撞到再閃」,
// 而是先在這個網格上用 A* 算出一條真正繞開所有站點的路徑,再照著路徑走過去——
// 不管站點怎麼排、多密集,只要實體上走得過去,就一定找得到路,不會再卡住。
const GRID_CELL = 6;
const NEIGHBOR_OFFSETS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1]
];

// 中間走道兩邊都不能穿越,雙方各自鎖在自己的區域,只能靠出餐口交接東西。
const ZONE_MAX_X = { host: 450, joiner: WORLD_W - 30 };
const ZONE_MIN_X = { host: 30, joiner: 510 };

const LEVEL_COUNT = 8;

// 顧客桌的圖是橫的(桌子 + 左右兩張椅子),照原圖比例顯示:size 是寬度,高度 = 寬度 x TABLE_ASPECT。
const TABLE_ASPECT = 369 / 681;
const TABLE_SIZE = 124; // 顧客桌的寬度

const SINK_FROM_LEVEL = 5; // 內建佈局從第幾關開始有水槽(髒盤要洗)

// 檯面可以擺的位置,全部照使用者自己排的 1-1:
// 後台是「ㄈ」字形——左邊一直排(L)、上面一橫排(T)、下面一橫排(B);
// 前台是下面一排(F3~F6),跟靠傳送口那一直排(由下往上 F2、F1、F7,傳送出口上面還有一格 F8)。
// 其他關卡只能用這些位置,不能擺在 1-1 沒有的地方,也不會比 1-1 多。
const SPARE_SLOTS = {
  L1: { x: 40, y: 308 }, L2: { x: 40, y: 436 },
  T1: { x: 104, y: 180 }, T2: { x: 168, y: 180 }, T3: { x: 232, y: 180 }, T4: { x: 296, y: 180 }, T5: { x: 360, y: 180 },
  B1: { x: 168, y: 500 }, B2: { x: 232, y: 500 }, B3: { x: 296, y: 500 }, B4: { x: 360, y: 500 }, B5: { x: 424, y: 500 },
  F1: { x: 544, y: 432 }, F2: { x: 544, y: 496 }, F3: { x: 672, y: 496 }, F4: { x: 736, y: 496 }, F5: { x: 800, y: 496 }, F6: { x: 864, y: 496 },
  F7: { x: 544, y: 368 }, F8: { x: 544, y: 176 } // 傳送出口正下方、正上方那兩格
};

// 顧客桌可以擺的位置:照使用者排的 1-1(兩直排、三橫排,共六個位置)。
// 每一關的桌數可以不一樣(照菜單),但桌子只能擺在這些位置上,從第一個開始依序用。
const TABLE_SLOTS = [
  { x: 712, y: 170 }, { x: 872, y: 170 },
  { x: 712, y: 274 }, { x: 872, y: 274 },
  { x: 712, y: 376 }, { x: 872, y: 376 }
];

// 每一關的檯面排多長。檯面一定是連在一起的,中間不留空格:
//   top / bottom:後台上排、下排從左邊數過來一共排幾格(0~5)。格子裡該放材料箱/水槽的就放,其餘是空桌。
//     上排固定位置:T1 麵包、T2 生菜、T3 起士、T4 番茄(三個鍋子的關卡 T5 是鉆板);下排固定位置:B1 水槽、B2 洗好盤子放的桌子。
//     排的長度不夠放這一關需要的東西時會自動加長。
//   左排是雞肉、牛肉、鍋子那一區:平底鍋一定連在一起(1 個在中間那格,2 個往下多一格,3 個上下各多一格),
//     鍋子沒用到的格子(L1、L2)放鉆板(兩個鍋子以下的關卡,鉆板在 L1)或空桌,整排不留空格。
//   前台下排垃圾桶右邊的四格(F3~F6),有飲料的關卡固定放杯架、熱水壺、紅茶包、綠茶包;牛奶在垃圾桶左邊(F2)。
//   frontRight:垃圾桶右邊沒被飲料用掉的格子裡,從左邊開始連續排幾張空桌(0~4);
//   frontLeft:垃圾桶左邊那一直排由下往上(F2、F1、F7,最後是傳送出口上面的 F8),沒被用掉的格子裡連續排幾張(0~4)。
// 這樣排出來,每一關的空桌數量都不一樣(見 docs/LEVEL_DESIGN_RULES.md 的表),越後面越少;
// 第 6 關是最難的一關,一張空桌都沒有。
const LEVEL_COUNTER_RUNS = {
  1: { top: 5, bottom: 5, frontRight: 4, frontLeft: 4 },
  2: { top: 5, bottom: 3, frontRight: 3, frontLeft: 0 },
  3: { top: 5, bottom: 2, frontRight: 0, frontLeft: 3 },
  4: { top: 5, bottom: 2, frontRight: 0, frontLeft: 3 },
  5: { top: 4, bottom: 4, frontRight: 0, frontLeft: 2 },
  6: { top: 4, bottom: 2, frontRight: 0, frontLeft: 0 },
  7: { top: 5, bottom: 5, frontRight: 0, frontLeft: 2 },
  8: { top: 5, bottom: 4, frontRight: 0, frontLeft: 1 }
};

// 前台做飲料的設備固定擺在哪一格(這一關菜單有用到的才放)。
const DRINK_STATION_SLOTS = [
  ['F3', 'src_cup', 'cup_empty', '杯架'],
  ['F4', 'src_hot_water', 'hot_water', '熱水壺'],
  ['F5', 'src_black_tea_bag', 'black_tea_bag', '紅茶包'],
  ['F6', 'src_green_tea_bag', 'green_tea_bag', '綠茶包'],
  ['F2', 'src_milk', 'milk', '牛奶']
];

// 內建關卡佈局:以使用者自己在編輯模式排好的 1-1 為樣板(位置、大小都照那一份),再照每一關的菜單調整:
//   後台:左邊一直排 + 上面一橫排 + 下面一橫排的「ㄈ」字形,檯面都連在一起;用傳送口把餐點送到前台。
//   前台:顧客桌擺在 1-1 的那幾個位置上(TABLE_SLOTS),張數照菜單;下面一排是垃圾桶跟空桌,也是連在一起的。
function buildLevelLayout(level) {
  const needs = getLevelNeeds(level);
  const tableCount = LEVEL_TABLE_COUNT[level] || 3;
  const runs = LEVEL_COUNTER_RUNS[level] || LEVEL_COUNTER_RUNS[1];
  const hasSink = level >= SINK_FROM_LEVEL;
  const layout = {};
  const put = (id, def) => { layout[id] = Object.assign({ size: 64 }, def); };
  const counter = (slot, id) => put(id || 'counter_' + slot, { x: SPARE_SLOTS[slot].x, y: SPARE_SLOTS[slot].y, type: 'counter', label: '桌子' });
  // 這個位置這一關要放材料箱就放,不然放空桌(回傳有沒有放材料箱)。
  const sourceOrCounter = (slot, id, itemType, label) => {
    if (!needs.sources.includes(itemType)) { counter(slot); return false; }
    put(id, { x: SPARE_SLOTS[slot].x, y: SPARE_SLOTS[slot].y, type: 'ingredient_source', itemType, label });
    return true;
  };

  // 左邊一直排(由上到下):雞肉、牛肉,接著三格是平底鍋那一區,最下面是取盤。整排都有東西,沒有空格。
  put('src_chicken', { x: 40, y: 180, type: 'ingredient_source', itemType: 'chicken_raw', label: '生雞肉' });
  put('src_beef', { x: 40, y: 244, type: 'ingredient_source', itemType: 'beef_raw', label: '生牛肉' });
  // 平底鍋的數量照菜單,而且一定連在一起:1 個在中間那格(跟 1-1 一樣),2 個往下多一格,3 個上下各多一格。
  const panCount = LEVEL_PAN_COUNT[level] || 1;
  const panYs = panCount >= 3 ? [308, 372, 436] : panCount === 2 ? [372, 436] : [372];
  panYs.forEach((y, i) => put('pan_' + (i + 1), { x: 40, y, type: 'cooking', img: 'equip_pan', label: '平底鍋' }));
  // 鉆板:鍋子沒佔到 L1 那一格的話放在 L1(就在鍋子上面);三個鍋子的關卡沒位置了,改放上排最右邊(T5,番茄旁邊)。
  const cuttingBoard = (slot) => put('cutting_board_1', { x: SPARE_SLOTS[slot].x, y: SPARE_SLOTS[slot].y, type: 'cutting', img: 'equip_cutting_board', label: '鉆板' });
  const boardOnLeft = needs.cutting && !panYs.includes(SPARE_SLOTS.L1.y);
  const boardOnTop = needs.cutting && !boardOnLeft;
  if (boardOnLeft) cuttingBoard('L1');
  else if (!panYs.includes(SPARE_SLOTS.L1.y)) counter('L1');
  if (!panYs.includes(SPARE_SLOTS.L2.y)) counter('L2');
  put('plate_stack', { x: 40, y: 500, type: 'plate_stack', img: 'equip_plate', label: '取盤', plates: tableCount + 2 });
  put('trash_bin', { x: 104, y: 500, type: 'trash', label: '垃圾桶' });

  // 上面一橫排(由左到右):麵包、生菜、起士、番茄各有固定位置,從左邊連續排到 top 格為止。
  const topSources = [['T1', 'src_bun', 'bun', '麵包'], ['T2', 'src_lettuce', 'lettuce', '生菜'], ['T3', 'src_cheese', 'cheese', '起士'], ['T4', 'src_tomato', 'tomato_raw', '番茄']];
  const lastTopSource = topSources.reduce((last, s, i) => (needs.sources.includes(s[2]) ? i + 1 : last), 0);
  const topLength = Math.max(runs.top, lastTopSource, boardOnTop ? 5 : 0);
  for (let i = 1; i <= topLength; i++) {
    const fixed = topSources[i - 1];
    if (i === 5 && boardOnTop) cuttingBoard('T5');
    else if (fixed) sourceOrCounter(...fixed);
    else counter('T' + i);
  }

  // 下面一橫排(垃圾桶右邊開始連續排):1-5 之後前兩格是水槽跟「洗好的盤子自動放這裡」的桌子(cleanTo)。
  // 客人走了之後盤子是髒的,會疊到水槽裡,要有人站在水槽前面洗(見 Station.js)。
  const bottomLength = Math.max(runs.bottom, hasSink ? 2 : 0);
  for (let i = 1; i <= bottomLength; i++) {
    if (hasSink && i === 1) put('sink', { x: SPARE_SLOTS.B1.x, y: SPARE_SLOTS.B1.y, type: 'sink', img: 'equip_sink', fullArt: true, label: '水槽', cleanTo: 'counter_clean' });
    else if (hasSink && i === 2) counter('B2', 'counter_clean');
    else counter('B' + i);
  }

  // 傳送口(64 寬 x 128 高)
  put('teleport_in', { x: 448, y: 272, type: 'teleport_in', img: 'teleport_in', fullArt: true, aspect: 2, label: '傳送入' });
  put('teleport_out', { x: 512, y: 272, type: 'teleport_out', img: 'teleport_out', fullArt: true, aspect: 2, label: '傳送出' });

  // 前台:顧客桌只能擺在 1-1 那六個位置上(兩直排、三橫排),由上往下、由左到右依序擺,張數照菜單。
  TABLE_SLOTS.slice(0, tableCount).forEach((spot, i) => put('table_' + (i + 1), { x: spot.x, y: spot.y, type: 'table', label: '桌位' + (i + 1), size: TABLE_SIZE, aspect: TABLE_ASPECT }));

  // 前台下面一排:垃圾桶(送錯的菜可以倒掉,盤子會留在手上),右邊連續排空桌,左邊視關卡再排一兩張。
  put('trash_front', { x: 608, y: 496, type: 'trash', label: '垃圾桶' });
  // 做飲料的設備先放,剩下的格子才排空桌。
  const usedFront = new Set();
  for (const [slot, id, itemType, label] of DRINK_STATION_SLOTS) {
    if (!needs.sources.includes(itemType)) continue;
    put(id, { x: SPARE_SLOTS[slot].x, y: SPARE_SLOTS[slot].y, type: 'ingredient_source', itemType, label });
    usedFront.add(slot);
  }
  const frontCounter = (slot) => counter(slot, 'counter_front_' + slot.slice(1));
  ['F3', 'F4', 'F5', 'F6'].filter((slot) => !usedFront.has(slot)).slice(0, runs.frontRight).forEach(frontCounter);
  ['F2', 'F1', 'F7', 'F8'].filter((slot) => !usedFront.has(slot)).slice(0, runs.frontLeft).forEach(frontCounter);

  return layout;
}

const LEVEL_LAYOUTS = {};
for (let i = 1; i <= LEVEL_COUNT; i++) {
  LEVEL_LAYOUTS[i] = buildLevelLayout(i);
}

// 實際場景讀取的佈局物件,內容在載入某一關時才會被填入(見 loadLevelLayout)。
const STATION_LAYOUT = {};

// 站點佔地的半寬/半高。大部分站點是正方形(邊長 size);有 aspect 的是長方形(寬 size、高 size * aspect),
// 例如傳送口是 64 寬、128 高。走位網格、互動距離、點擊判定、編輯模式的碰撞都用這個算,不要直接拿 size 當邊長。
function stationHalf(def, sizeOverride) {
  const size = sizeOverride || def.size || 64;
  return { hw: size / 2, hh: (size * (def.aspect || 1)) / 2 };
}

// 舊的佈局存檔裡的顧客桌是正方形的(沒有 aspect),載入時一律換成現在的大小跟比例(TABLE_SIZE / TABLE_ASPECT),位置不動。
function normalizeLayout(layoutData) {
  for (const id in layoutData) {
    const def = layoutData[id];
    if (def && def.type === 'table' && !def.aspect) {
      def.aspect = TABLE_ASPECT;
      def.size = TABLE_SIZE;
    }
  }
  return layoutData;
}

// 編輯模式存的佈局只在「這台裝置/瀏覽器」裡有效(用 localStorage,依關卡分開存),
// 重新整理網頁不會不見,但不會同步給別台裝置——要讓兩支手機都看到同一份佈局,
// 還是要把「複製佈局」的結果貼給開發者,寫進程式碼裡正式部署。
// v2:存檔位置換過一次。舊的位置(LEGACY)裡,除了使用者自己排的 1-1 以外,其他關卡存的都是「以前只是進去
// 編輯模式看一眼就被自動存下來的舊版內建佈局」,會一直蓋掉新的內建佈局,所以只把 1-1 搬過來,其他的不再讀。
const LAYOUT_STORAGE_PREFIX = 'coopCookingLayout_v2_level_';
const LEGACY_LAYOUT_STORAGE_PREFIX = 'coopCookingLayout_level_';

function applyLayoutData(layoutData) {
  for (const key in STATION_LAYOUT) delete STATION_LAYOUT[key];
  Object.assign(STATION_LAYOUT, normalizeLayout(layoutData));
}

function loadLevelLayout(levelNum) {
  const needs = getLevelNeeds(levelNum);
  applyLayoutData(LEVEL_LAYOUTS[levelNum] || LEVEL_LAYOUTS[1]);

  let saved;
  try {
    saved = localStorage.getItem(LAYOUT_STORAGE_PREFIX + levelNum);
    if (!saved && levelNum === 1) {
      saved = localStorage.getItem(LEGACY_LAYOUT_STORAGE_PREFIX + 1);
      if (saved) localStorage.setItem(LAYOUT_STORAGE_PREFIX + 1, saved);
    }
  } catch (e) {
    return; // 部分瀏覽器情境(例如無痕模式)可能無法存取 localStorage
  }
  if (!saved) return;
  try {
    // 這一關菜單用不到的材料箱/鉆板/鍋具不要出現(存檔是舊菜單時排的也一樣):把上面的東西拿掉,
    // 只留下底下那張空桌子,排好的形狀才不會缺一塊;
    // 反過來,菜單需要的東西如果存檔裡沒擺齊(例如舊版的薯條關卡佈局),這份存檔就不能玩,改用內建佈局。
    const parsed = JSON.parse(saved);
    const usable = {};
    for (const id in parsed) {
      const def = parsed[id];
      usable[id] = isStationUsedInLevel(def, needs) ? def : { x: def.x, y: def.y, size: def.size || 64, type: 'counter', label: '桌子' };
    }
    if (layoutCoversLevel(usable, needs)) applyLayoutData(usable);
  } catch (e) {
    // 儲存內容壞掉就當作沒有,繼續用這一關內建的預設佈局
  }
}

// 出生點要避開所有站點的碰撞範圍(不能一出生就跟站點重疊),兩邊都選在站點之間的空地上。
// 預設出生點:後台、前台各自中間偏空曠的位置。實際出生點在場景建立時才決定(見 create()),
// 如果這一關的檯面剛好佔住這個位置,會自動挪到最近的空地。
const PLAYER_SPAWN_PREFERRED = {
  host: { x: 250, y: 320 },
  joiner: { x: 730, y: 260 }
};
const PLAYER_SPAWN = {
  host: { x: 250, y: 320 },
  joiner: { x: 730, y: 260 }
};

// 角色圖片:依移動方向切換 left/right,靜止時用 idle。
const PLAYER_TEXTURES = {
  host: { left: 'p1_left', right: 'p1_right', idle: 'p1_idle' },
  joiner: { left: 'p2_left', right: 'p2_right', idle: 'p2_idle' }
};
const FACING_CHANGE_THRESHOLD = 0.4; // px/frame,超過這個位移量才判斷是在往左/往右走

// 編輯模式底下「新增物件」的可選類型清單。
// 桌子/檯面是地基,要先放;其他廚具要先點選種類(會標記成選取中),再點一個空桌子把它放上去。
const STATION_TYPE_PALETTE = [
  { type: 'counter', shortLabel: '桌子(先放這個)' },
  { type: 'ingredient_source', itemType: 'potato_raw', emoji: '🥔', shortLabel: '馬鈴薯箱' },
  { type: 'ingredient_source', itemType: 'beef_raw', shortLabel: '生牛肉箱' },
  { type: 'ingredient_source', itemType: 'chicken_raw', shortLabel: '生雞肉箱' },
  { type: 'ingredient_source', itemType: 'tomato_raw', shortLabel: '番茄箱' },
  { type: 'ingredient_source', itemType: 'lettuce', shortLabel: '生菜箱' },
  { type: 'ingredient_source', itemType: 'cheese', shortLabel: '起士箱' },
  { type: 'ingredient_source', itemType: 'bun', shortLabel: '漢堡箱' },
  { type: 'ingredient_source', itemType: 'cup_empty', shortLabel: '杯架(空杯)' },
  { type: 'ingredient_source', itemType: 'hot_water', shortLabel: '熱水壺' },
  { type: 'ingredient_source', itemType: 'black_tea_bag', shortLabel: '紅茶包箱' },
  { type: 'ingredient_source', itemType: 'green_tea_bag', shortLabel: '綠茶包箱' },
  { type: 'ingredient_source', itemType: 'milk', shortLabel: '牛奶箱' },
  { type: 'cooking', recipeId: 'fries', emoji: '🍳', shortLabel: '油炸鍋' },
  { type: 'cooking', img: 'equip_pan', shortLabel: '平底鍋' },
  { type: 'cutting', img: 'equip_cutting_board', shortLabel: '鉆板' },
  { type: 'plate_stack', img: 'equip_plate', shortLabel: '取盤' },
  { type: 'trash', emoji: '🗑️', shortLabel: '垃圾桶' },
  { type: 'sink', img: 'equip_sink', fullArt: true, shortLabel: '水槽(洗髒盤)' },
  { type: 'workbench', emoji: '', shortLabel: '工作台' },
  { type: 'pass_window', emoji: '🛎️', shortLabel: '出餐口' },
  // 傳送口是 64 寬、128 高的長方形(aspect 2),圖片本身鋪滿整個物件。
  { type: 'teleport_in', img: 'teleport_in', fullArt: true, aspect: 2, shortLabel: '傳送入(後台放)' },
  { type: 'teleport_out', img: 'teleport_out', fullArt: true, aspect: 2, shortLabel: '傳送出(前台拿)' },
  { type: 'dispenser', recipeId: 'drink', emoji: '🥤', shortLabel: '飲料機' },
  { type: 'table', aspect: TABLE_ASPECT, size: TABLE_SIZE, shortLabel: '顧客桌位' }
];

// 編輯模式「調整大小」下拉選單用的種類名稱對照。
const TYPE_LABELS = {
  counter: '桌子/檯面',
  ingredient_source: '材料箱',
  cooking: '鍋具',
  cutting: '鉆板',
  plate_stack: '取盤',
  trash: '垃圾桶',
  sink: '水槽',
  workbench: '工作台',
  pass_window: '出餐口',
  teleport_in: '傳送入',
  teleport_out: '傳送出',
  dispenser: '飲料機',
  table: '桌子'
};

class KitchenScene extends Phaser.Scene {
  constructor() {
    super('KitchenScene');
  }

  preload() {
    // 圖檔網址加版本號,確保每次上新版時手機瀏覽器會抓最新的圖,不會卡在舊的快取版本。
    const v = '?v=1.68';
    this.load.image('table_wood', 'assets/sprites/table.png' + v);
    this.load.image('table_chair', 'assets/sprites/table_chair.png' + v);
    this.load.image('kitchen_bg', 'assets/sprites/background.png' + v);
    this.load.image('p1_left', 'assets/sprites/p1_left.png' + v);
    this.load.image('p1_right', 'assets/sprites/p1_right.png' + v);
    this.load.image('p1_idle', 'assets/sprites/p1_idle.png' + v);
    this.load.image('p2_left', 'assets/sprites/p2_left.png' + v);
    this.load.image('p2_right', 'assets/sprites/p2_right.png' + v);
    this.load.image('p2_idle', 'assets/sprites/p2_idle.png' + v);

    // 廚具圖示(去背後疊在桌面圖上顯示,見 createEquipmentView)
    this.load.image('equip_pan', 'assets/sprites/pan.png' + v);
    this.load.image('equip_pan_heating', 'assets/sprites/pan_heating.png' + v);
    for (const look of CUSTOMER_LOOKS) {
      this.load.image('customer_' + look + '_left', 'assets/sprites/customer_' + look + '_left.png' + v);
      this.load.image('customer_' + look + '_right', 'assets/sprites/customer_' + look + '_right.png' + v);
    }
    for (const name of ['cup_empty', 'hot_water', 'black_tea_bag', 'green_tea_bag', 'milk', 'black_tea', 'green_tea', 'milk_tea', 'milk_green_tea']) {
      this.load.image('item_' + name, 'assets/sprites/level1/' + name + '.png' + v);
    }
    this.load.image('equip_trash', 'assets/sprites/trash.png' + v);
    this.load.image('equip_sink', 'assets/sprites/sink.png' + v);
    this.load.image('equip_sink_active', 'assets/sprites/sink_active.png' + v);
    this.load.image('teleport_in', 'assets/sprites/teleport_in.png' + v);
    this.load.image('teleport_out', 'assets/sprites/teleport_out.png' + v);
    this.load.image('equip_cutting_board', 'assets/sprites/cutting_board.png' + v);
    this.load.image('equip_plate', 'assets/sprites/plate.png' + v);

    // 食材/成品圖(用在材料箱圖示、手上拿著的東西、站點上放的東西)
    this.load.image('item_beef_raw', 'assets/sprites/beef_raw.png' + v);
    this.load.image('item_chicken_raw', 'assets/sprites/level1/chicken_raw.png' + v);
    this.load.image('item_beef_cooked', 'assets/sprites/level1/beef_cooked.png' + v);
    this.load.image('item_chicken_cooked', 'assets/sprites/level1/chicken_cooked.png' + v);
    // 音效:煎東西的滋滋聲(循環播放)、煮好的叮一聲。都是公有領域素材,來源見 assets/audio/CREDITS.md。
    this.load.audio('sfx_sizzle', 'assets/audio/sizzle.wav' + v);
    this.load.audio('sfx_bell', 'assets/audio/bell.mp3' + v);
    this.load.audio('sfx_beep', 'assets/audio/beep.wav' + v);
    this.load.audio('sfx_wash', 'assets/audio/wash.wav' + v);
    this.load.audio('sfx_chop', 'assets/audio/chop.wav' + v);
    this.load.audio('sfx_coins', 'assets/audio/coins.wav' + v);
    this.load.audio('sfx_plate_down', 'assets/audio/plate_down.wav' + v);
    this.load.image('item_beef_burnt', 'assets/sprites/level1/beef_burnt.png' + v);
    this.load.image('item_chicken_burnt', 'assets/sprites/level1/chicken_burnt.png' + v);
    this.load.image('item_tomato_raw', 'assets/sprites/level1/tomato_raw.png' + v);
    this.load.image('item_tomato_sliced', 'assets/sprites/level1/tomato_sliced.png' + v);
    this.load.image('item_lettuce', 'assets/sprites/level1/lettuce.png' + v);
    this.load.image('item_cheese', 'assets/sprites/level1/cheese.png' + v);
    this.load.image('item_bun', 'assets/sprites/level1/bun.png' + v);
    this.load.image('item_burger_beef_cheese', 'assets/sprites/level1/burger_beef_cheese.png' + v);
    this.load.image('item_burger_beef', 'assets/sprites/level1/burger_beef.png' + v);
    this.load.image('item_burger_beef_tomato', 'assets/sprites/level1/burger_beef_tomato.png' + v);
    this.load.image('item_burger_chicken_cheese', 'assets/sprites/level1/burger_chicken_cheese.png' + v);
    this.load.image('item_burger_chicken', 'assets/sprites/level1/burger_chicken.png' + v);
    this.load.image('item_burger_chicken_tomato', 'assets/sprites/level1/burger_chicken_tomato.png' + v);
  }

  create() {
    // 配合 main.js 把畫布放大 dpr 倍,這裡用 camera zoom 縮放回邏輯座標,
    // 場景裡其他程式碼完全不用管這件事,座標還是 0-960 x 0-540。
    // 相機預設會置中在「放大後畫布」的中心,不是我們邏輯世界(0-960,0-540)的中心,
    // 所以縮放之後還要額外用 centerOn 把視角拉回邏輯世界的正中央。
    const applyZoom = () => {
      this.cameras.main.setZoom(window.RENDER_SCALE || 1);
      this.cameras.main.centerOn(WORLD_W / 2, WORLD_H / 2);
      // 畫面上方的訂單列是網頁元素,不會跟著畫布縮放;把畫布實際顯示的比例告訴它,讓卡片大小跟遊戲畫面等比例。
      const shownHeight = this.game.canvas.getBoundingClientRect().height || WORLD_H;
      document.documentElement.style.setProperty('--hud-scale', (shownHeight / WORLD_H).toFixed(3));
    };
    applyZoom();
    this.scale.on('resize', applyZoom);

    this.role = window.NET_ROLE;
    this.isHost = this.role === 'host';
    this.remoteRole = this.isHost ? 'joiner' : 'host';
    this.localTestMode = !!window.LOCAL_TEST_MODE;
    this.editMode = !!window.EDIT_MODE;
    this.level = Phaser.Math.Clamp(window.SELECTED_LEVEL || 1, 1, LEVEL_COUNT);

    loadLevelLayout(this.level);
    // 連線時加入的一方一律用開房那一方傳來的佈局(見 main.js 的 hello 訊息),不用自己瀏覽器裡存的。
    if (!this.isHost && window.HOST_LAYOUT) applyLayoutData(window.HOST_LAYOUT);
    this.state = this.isHost ? createInitialState(this.level) : null;
    this.buildWalkGrid();

    // 出生點可能剛好被這一關的檯面佔住(佈局是可以自己排的),挪到離預設出生點最近的空地。
    for (const role of ['host', 'joiner']) {
      const minCol = Math.ceil(ZONE_MIN_X[role] / GRID_CELL);
      const maxCol = Math.floor(ZONE_MAX_X[role] / GRID_CELL) - 1;
      const col = Phaser.Math.Clamp(Math.floor(PLAYER_SPAWN_PREFERRED[role].x / GRID_CELL), minCol, maxCol);
      const open = this.findNearestOpenCell(col, Math.floor(PLAYER_SPAWN_PREFERRED[role].y / GRID_CELL), minCol, maxCol);
      Object.assign(PLAYER_SPAWN[role], open ? this.gridToWorld(open.col, open.row) : PLAYER_SPAWN_PREFERRED[role]);
    }

    this.drawBackground();
    this.createStations();
    this.createPlayers();

    this.localPos = { x: PLAYER_SPAWN[this.role].x, y: PLAYER_SPAWN[this.role].y };
    this.movePath = null;
    this.movePathIndex = 0;
    this.pendingInteractStationId = null;

    if (this.localTestMode) {
      // 本機測試模式:一個人同時操作兩個角色,不走網路,直接在同一份 state 上互動。
      this.testPositions = {
        host: { x: PLAYER_SPAWN.host.x, y: PLAYER_SPAWN.host.y },
        joiner: { x: PLAYER_SPAWN.joiner.x, y: PLAYER_SPAWN.joiner.y }
      };
      this.testMovePaths = { host: null, joiner: null };
      this.testMovePathIndex = { host: 0, joiner: 0 };
      this.testPendingInteract = { host: null, joiner: null };
      document.getElementById('btn-interact').style.display = 'none';
    }

    if (this.editMode) {
      this.enableEditMode();
    } else {
      this.setupTapToMove();
    }

    if (!this.localTestMode) {
      GameSync.onRemoteMove = (x, y) => {
        const s = this.playerSprites[this.remoteRole];
        s.targetX = x;
        s.targetY = y;
      };

      if (this.isHost) {
        GameSync.onInteractRequest = (stationId) => {
          interactStation(this.state, stationId, 'joiner');
        };
      } else {
        GameSync.onStateUpdate = (state) => {
          this.state = state;
        };
      }
    }

    this.lastMoveSent = 0;
    this.lastStateSent = 0;

    HUD.init();
    HUD.level = this.level;
    this.orderCards = {}; // 訂單列上目前有哪些卡片:{ [客人 id]: { card, bar } }
    this.orderIconCache = {};
    document.getElementById('hud-orders').innerHTML = '';
    this.setupPauseMenu();

    const playAgainBtn = document.getElementById('btn-play-again');
    if (this.isHost) {
      playAgainBtn.textContent = '再玩一次';
      playAgainBtn.onclick = () => {
        this.state = createInitialState(this.level);
      };
    } else {
      // 只有 Host 能重開一局(它是遊戲狀態的權威端),Joiner 端顯示等待訊息即可,
      // 等 Host 重開後,下一次狀態同步就會自動讓 Joiner 的結算畫面消失。
      playAgainBtn.textContent = '等待主機重新開始...';
      playAgainBtn.disabled = true;
    }
  }

  // 畫面上方的訂單列:每一位「已經坐下點餐、還沒拿到餐」的客人一張小卡片——上面是成品的大圖示,
  // 下面一排小圈圈是食材,最下面一條是那一桌剩下的耐心。由左到右照點餐的先後排(orderSeq),
  // 上菜了(或客人走了)就把那張卡片拿掉,後面的自動往前遞補。
  // 用網頁元素畫(不是畫在遊戲畫布裡);圖是從遊戲已經載入的圖轉出來的,沒有圖的東西用 emoji 代替。
  updateOrderBar(state) {
    const bar = document.getElementById('hud-orders');
    const orders = [];
    if (!this.editMode) {
      for (const id in state.stations) {
        const st = state.stations[id];
        if (st.type !== 'table' || !st.occupied || !st.seats) continue;
        for (const customer of st.seats) {
          if (!customer || !customer.orderSeq) continue;
          // 一位客人點了幾樣就有幾張卡片(還沒拿到的才列),同一位客人的排在一起。
          customer.orders.forEach((order, index) => {
            if (!order.served) orders.push({ key: customer.id + ':' + index, seq: customer.orderSeq * 10 + index, recipeId: order.recipeId, table: st });
          });
        }
      }
    }
    orders.sort((a, b) => a.seq - b.seq);

    const alive = new Set(orders.map((o) => o.key));
    for (const id in this.orderCards) {
      if (alive.has(id)) continue;
      this.orderCards[id].card.remove();
      delete this.orderCards[id];
    }
    orders.forEach((order, index) => {
      const id = order.key;
      let entry = this.orderCards[id];
      if (!entry) entry = this.orderCards[id] = this.createOrderCard(order.recipeId);
      // 位置不對才搬(新卡片、或狀態同步後順序有變),免得每一幀都在動網頁。
      if (bar.children[index] !== entry.card) bar.insertBefore(entry.card, bar.children[index] || null);
      const ratio = order.table.maxPatience > 0 ? Phaser.Math.Clamp(order.table.patience / order.table.maxPatience, 0, 1) : 1;
      entry.bar.style.width = Math.round(ratio * 100) + '%';
      entry.bar.parentNode.classList.toggle('low', ratio < 0.3);
      entry.card.classList.toggle('angry', !!order.table.angry);
    });
  }

  createOrderCard(recipeId) {
    const recipe = getRecipe(recipeId);
    const iconFor = (item, className) => {
      const key = itemImageKey(item);
      if (key && this.textures.exists(key)) {
        if (!this.orderIconCache[key]) this.orderIconCache[key] = this.textures.getBase64(key);
        const img = document.createElement('img');
        img.src = this.orderIconCache[key];
        img.className = className;
        return img;
      }
      const span = document.createElement('span');
      span.textContent = itemEmoji(item);
      span.className = className;
      return span;
    };
    const card = document.createElement('div');
    card.className = 'order-card';
    card.title = recipe.name;
    card.appendChild(iconFor(recipe.platedItem, 'order-dish'));
    const row = document.createElement('div');
    row.className = 'order-ingredients';
    for (const item of recipe.ingredients || []) {
      const circle = document.createElement('span');
      circle.className = 'order-ingredient';
      circle.appendChild(iconFor(item, ''));
      row.appendChild(circle);
    }
    card.appendChild(row);
    const patience = document.createElement('div');
    patience.className = 'order-patience';
    const fill = document.createElement('span');
    patience.appendChild(fill);
    card.appendChild(patience);
    return { card, bar: fill };
  }

  // 右上角齒輪 -> 暫停並跳出選單(繼續遊戲 / 離開遊戲)。編輯模式有自己的離開按鈕,不顯示齒輪。
  setupPauseMenu() {
    const pauseBtn = document.getElementById('btn-pause');
    pauseBtn.style.display = this.editMode ? 'none' : '';
    document.getElementById('hud-stars').style.display = this.editMode ? 'none' : ''; // 編輯模式沒有分數,不顯示星星
    pauseBtn.onclick = () => this.setPaused(true);
    document.getElementById('btn-resume').onclick = () => this.setPaused(false);
    // 離開遊戲 = 回到主選單(重新載入頁面,連線也會一起斷開)。
    document.getElementById('btn-quit').onclick = () => location.reload();

    // 背景音樂:進遊戲就開始播(編輯模式不播),可以在這個選單裡換歌或關掉。
    const volumeSlider = document.getElementById('bgm-volume');
    const showBgm = () => {
      document.getElementById('bgm-name').textContent = Bgm.label();
      volumeSlider.value = Math.round(Bgm.volume * 100);
      document.getElementById('bgm-volume-label').textContent = Math.round(Bgm.volume * 100) + '%';
    };
    volumeSlider.oninput = () => {
      Bgm.setVolume(Number(volumeSlider.value) / 100);
      showBgm();
    };
    Bgm.onChange = showBgm;
    document.getElementById('btn-bgm-next').onclick = () => Bgm.next();
    document.getElementById('btn-bgm-toggle').onclick = () => Bgm.toggle();
    if (!this.editMode) Bgm.start();
    showBgm();
    if (this.isHost && !this.localTestMode) {
      GameSync.onPauseRequest = (paused) => {
        if (this.state) this.state.paused = paused;
      };
    }
  }

  // 暫停狀態記在 state 裡(Host 權威):Host 直接改,Joiner 送請求給 Host,兩邊都可以暫停/繼續。
  setPaused(paused) {
    if (this.isHost) {
      if (this.state) this.state.paused = paused;
    } else {
      GameSync.sendPause(paused);
    }
  }

  drawBackground() {
    // 客人進來的門口(前台上方固定位置,見 OrderManager.js 的 CUSTOMER_ENTRANCE)。
    this.addText(CUSTOMER_ENTRANCE.x, 16, '🚪', { fontSize: '28px' }).setOrigin(0.5).setDepth(-1);
    this.add.image(WORLD_W / 2, WORLD_H / 2, 'kitchen_bg').setDisplaySize(WORLD_W, WORLD_H).setDepth(-2);
    // 中間走道分隔線(半透明深色條),提示這裡兩邊都不能穿越
    this.add.rectangle(480, WORLD_H / 2, 36, WORLD_H, 0x2b2018, 0.35).setDepth(-1);
  }

  createStations() {
    this.stationSprites = {};
    for (const id in STATION_LAYOUT) {
      const def = STATION_LAYOUT[id];
      if (def.type === 'table') {
        this.stationSprites[id] = this.createTableView(def);
      } else {
        this.stationSprites[id] = this.createEquipmentView(def);
      }
    }
  }

  // 建立文字物件(emoji 圖示、數字角標...)一律走這裡:照螢幕的像素密度提高文字的解析度。
  // 畫布本身有乘上 RENDER_SCALE(螢幕像素密度,上限 2 倍)(見 main.js),文字不跟著提高的話,在高解析度螢幕上會被放大而變糊。
  addText(x, y, text, style) {
    const resolution = Math.max(1, window.RENDER_SCALE || 1);
    return this.add.text(x, y, text, Object.assign({ resolution }, style));
  }

  // 依圖片原本的長寬比,算出「長邊等於 maxSize」時應該用的顯示寬高,避免圖片被硬拉伸成正方形
  // 變形(例如盤子圖其實是扁寬的長方形,硬塞成正方形疊起來會明顯走樣)。
  fitDisplaySize(textureKey, maxSize) {
    const src = this.textures.get(textureKey).getSourceImage();
    const ratio = src.width / src.height;
    if (ratio >= 1) return { w: maxSize, h: maxSize / ratio };
    return { w: maxSize * ratio, h: maxSize };
  }

  // 所有站點都用方形(不再用圓形),不顯示名稱文字。
  // 不管是材料箱、垃圾桶、出餐口、空桌子,還是有自己專屬圖片的廚具(平底鍋/鉆板/取盤),
  // 一律先鋪一層桌面圖(table_wood)當底,圖示(廚具圖/食材圖/emoji)疊在上面——
  // 廚具圖本身去背後只是單純的物件形狀,並沒有內建檯面,所以也要跟材料箱一樣「放在桌上」。
  createEquipmentView(def) {
    const container = this.add.container(def.x, def.y);
    const size = def.size || 64;
    const height = size * (def.aspect || 1);

    // fullArt:圖片本身就是整個物件(例如傳送口),直接鋪滿整個範圍,底下不墊桌面圖。
    // 垃圾桶一律用回收桶的圖(不管佈局資料裡寫的是不是舊的 emoji),跟傳送口/水槽一樣整張鋪滿。
    const fullArtKey = def.type === 'trash' ? 'equip_trash' : (def.fullArt ? def.img : null);
    const ownArtKey = def.img && !fullArtKey ? def.img : null;
    const iconImgKey = !ownArtKey && def.itemType ? itemImageKey(def.itemType) : null;
    const bg = this.add.image(0, 0, fullArtKey || 'table_wood').setDisplaySize(size, height);
    const outline = this.add.rectangle(0, 0, size, height, 0x000000, 0).setStrokeStyle(3, 0xf5ead9);

    // 廚具本身的東西(拿著/煮著/切著的食材)要疊在「鍋面/檯面」中心,不是飄在廚具圖上方——
    // 平底鍋圖右側有一截握把,實際鍋面中心比整張圖的正中央略偏左,所以額外往左修正一點。
    let icon = null;
    let itemAnchorX = 0;
    let itemAnchorY = -2;
    if (ownArtKey) {
      const src = this.textures.get(ownArtKey).getSourceImage();
      const displayW = size * 0.8;
      const displayH = displayW * (src.height / src.width);
      icon = this.add.image(0, -2, ownArtKey).setDisplaySize(displayW, displayH);
      itemAnchorX = ownArtKey === 'equip_pan' ? -displayW * 0.14 : 0;
      itemAnchorY = -2;
    } else if (iconImgKey) {
      const fit = this.fitDisplaySize(iconImgKey, size * ITEM_ON_TABLE_RATIO);
      icon = this.add.image(0, -2, iconImgKey).setDisplaySize(fit.w, fit.h);
    } else if (def.emoji && !fullArtKey) {
      icon = this.addText(0, -2, def.emoji, { fontSize: '28px' }).setOrigin(0.5);
    }

    // 進度條畫在站點自己的方塊範圍內(貼著上緣),不是掛在方塊外面——站點排得很密(零間隙)的時候,
    // 掛在外面的進度條會剛好落在隔壁站點的範圍裡被蓋住,看起來就像完全沒有進度條。
    // 而且不放進 container,直接畫在最上層(OVERLAY_DEPTH),角色站在旁邊也不會擋到。
    // 取盤站:實際還剩幾個盤子用疊起來的盤子圖顯示。站點本身的盤子圖只在盤子被拿光的時候才出現,
    // 而且是淡淡的(標示「盤子放這裡」);還有盤子的時候不顯示,不然看起來像多了一個半透明的盤子。
    if (def.type === 'plate_stack' && icon) icon.setAlpha(0.3);

    const progressW = size - 12;
    const progressY = def.y - height / 2 + 9;
    const progressBg = this.add.rectangle(def.x, progressY, progressW + 4, 12, 0x1a1410).setOrigin(0.5).setStrokeStyle(2, 0xf5ead9).setDepth(OVERLAY_DEPTH).setVisible(false);
    const progressBar = this.add.rectangle(def.x - progressW / 2, progressY, 0, 8, 0xe8804a).setOrigin(0, 0.5).setDepth(OVERLAY_DEPTH).setVisible(false);
    const heldItemText = this.addText(itemAnchorX, itemAnchorY, '', { fontSize: '22px' }).setOrigin(0.5);
    // 放在檯面上的食材用「原本的大小」——跟材料箱上那個圖示一樣大(邊長的 0.6 倍);拿在手上才會縮小。
    // 鍋子/鉆板這種有自己圖的廚具,上面的食材要配合鍋面的大小,維持小一點。
    const heldItemMaxSize = ownArtKey ? size * 0.42 : size * ITEM_ON_TABLE_RATIO;
    const heldItemInitialKey = iconImgKey || 'equip_plate';
    const heldItemInitialFit = this.fitDisplaySize(heldItemInitialKey, heldItemMaxSize);
    const heldItemImage = this.add.image(itemAnchorX, itemAnchorY, heldItemInitialKey)
      .setDisplaySize(heldItemInitialFit.w, heldItemInitialFit.h)
      .setVisible(false);
    heldItemImage.maxSize = heldItemMaxSize; // setItemVisual 換圖時要用同一個上限重新算長寬比

    // 盤子疊放用:最多視覺上疊 4 層(每層往上偏移一點),超過 4 個就在最上面顯示總數字。
    // 疊起來的高度要大致留在自己這一格裡:檯面是一格貼一格排的,疊太高會把上面那一格的廚具(例如鉆板)整個蓋住。
    const plateStackFit = this.fitDisplaySize('equip_plate', PLATE_DISPLAY_SIZE);
    const plateStackImages = [];
    for (let i = 0; i < 4; i++) {
      plateStackImages.push(this.add.image(0, -6 - i * 8, 'equip_plate').setDisplaySize(plateStackFit.w, plateStackFit.h).setVisible(false));
    }
    const plateStackCountText = this.addText(22, -42, '', { fontSize: '13px', color: '#ffffff', fontStyle: 'bold', backgroundColor: '#00000080' }).setOrigin(0.5).setVisible(false);

    // icon(廚具/材料箱圖示)要先疊上去,heldItemImage(鍋子裡煮的東西)才會蓋在它上面看得到,
    // 不然像平底鍋這種食材要疊在圖示中央的情況,廚具圖示會蓋住食材。
    const parts = [bg, outline];
    if (icon) parts.push(icon);
    parts.push(heldItemText, heldItemImage, ...plateStackImages, plateStackCountText);
    container.add(parts);

    return { container, bg, outline, icon, hasOwnArt: !!ownArtKey, progressBg, progressBar, progressW, overlays: [progressBg, progressBar], heldItemText, heldItemImage, plateStackImages, plateStackCountText, def };
  }

  // 平底鍋放了東西進去(不管是正在煮、煮好還是燒焦)要換成「加熱中」的鍋子圖,空鍋時換回原本的圖。
  setPanIcon(view, heating) {
    const key = heating ? 'equip_pan_heating' : 'equip_pan';
    if (!view.icon || view.icon.texture.key === key) return;
    const src = this.textures.get(key).getSourceImage();
    const displayW = (view.def.size || 64) * 0.8;
    const displayH = displayW * (src.height / src.width);
    view.icon.setTexture(key).setDisplaySize(displayW, displayH);
  }

  // 桌子用實際的木紋桌面圖片(圖裡左右各有一張椅子)。一桌最多兩位客人,分別坐在左、右兩邊的椅子上
  // (seats[0] = 左,seats[1] = 右),每位客人要的餐點顯示在自己頭上的對話泡泡裡。
  createTableView(def) {
    const container = this.add.container(def.x, def.y);
    const half = stationHalf(def);
    const w = half.hw * 2;
    const h = half.hh * 2;

    const tableTop = this.add.image(0, 0, 'table_chair').setDisplaySize(w, h);
    const progressW = Math.round(w * 0.6);
    const progressY = h / 2 + 8;
    const progressBg = this.add.rectangle(0, progressY, progressW, 8, 0x1a1410).setOrigin(0.5).setVisible(false);
    const progressBar = this.add.rectangle(-progressW / 2, progressY, 0, 8, 0xe8804a).setOrigin(0, 0.5).setVisible(false);
    // 等到耐心用完的那一桌:桌子中間冒出生氣的符號(客人還在,只是結帳會只付一半)。
    const angryText = this.addText(0, -h / 2 - 2, '💢', { fontSize: '26px' }).setOrigin(0.5).setVisible(false);
    container.add([tableTop, progressBg, progressBar, angryText]);

    const seats = [];
    const overlays = [];
    for (const side of [-1, 1]) {
      // 椅子在桌子圖的左右兩端(大約是圖寬的 39% 處)。
      const seatX = side * w * 0.39;
      // 客人不放進 container:他會從門口一路走到這張椅子,位置是世界座標(見 updateCustomerView)。
      const customerSprite = this.add.image(def.x + seatX, def.y - 6, 'customer_' + CUSTOMER_LOOKS[0] + '_left').setDepth(CUSTOMER_DEPTH).setVisible(false);

      // 客人頭上「還沒拿到的東西」的泡泡:最多三樣。泡泡不放進 container,直接畫在最上層(OVERLAY_DEPTH),
      // 不會被站在旁邊的角色或隔壁站點擋到。位置跟大小每一幀照還剩幾樣重新排(見 layoutOrderBubble)。
      // 桌子太靠近畫面上方的訂單列時,頭上放不下泡泡(硬放會蓋住客人的臉):改成在桌面上、客人面前直的排。
      const headTop = Math.max(h / 2, CUSTOMER_SIZE / 2 + 6);
      const aboveY = def.y - headTop - ORDER_BUBBLE_H / 2 - 8;
      const onTable = aboveY - ORDER_BUBBLE_H / 2 < ORDER_BAR_BOTTOM;
      const bubbleTail = this.add.rectangle(def.x + seatX, aboveY + ORDER_BUBBLE_H / 2 - 1, 11, 11, 0xffffff).setStrokeStyle(2, 0xcbbfa8).setAngle(45).setDepth(OVERLAY_DEPTH).setVisible(false);
      const bubble = this.add.rectangle(def.x + seatX, aboveY, ORDER_BUBBLE_H, ORDER_BUBBLE_H, 0xffffff).setStrokeStyle(2, 0xcbbfa8).setDepth(OVERLAY_DEPTH).setVisible(false);
      const orderIcons = [];
      for (let i = 0; i < 3; i++) {
        const text = this.addText(def.x + seatX, aboveY, '', { fontSize: '18px' }).setOrigin(0.5).setDepth(OVERLAY_DEPTH);
        const image = this.add.image(def.x + seatX, aboveY, 'equip_plate').setDepth(OVERLAY_DEPTH).setVisible(false);
        image.maxSize = ORDER_ICON_SIZE;
        orderIcons.push({ image, text });
      }

      // 已經送到的餐點(連盤子/杯子)擺在桌上他面前,由上往下最多三份,比手上的小,兩個人的才擺得下。
      const mealX = side * 16;
      const meals = [];
      for (let i = 0; i < 3; i++) {
        const text = this.addText(mealX, (i - 1) * 21, '', { fontSize: '12px' }).setOrigin(0.5);
        const image = this.add.image(mealX, (i - 1) * 21, 'equip_plate').setVisible(false);
        image.maxSize = 20;
        image.plateSize = 24;
        container.add([text, image]);
        meals.push({ image, text });
      }

      seats.push({ side, seatX, customerSprite, bubble, bubbleTail, orderIcons, meals, aboveY, onTable });
      overlays.push(customerSprite, bubbleTail, bubble, ...orderIcons.flatMap((icon) => [icon.text, icon.image]));
    }

    return { container, bg: tableTop, progressBg, progressBar, progressW, angryText, seats, overlays, def, isTable: true, hasOwnArt: true };
  }

  // 畫面上方的訂單卡片最右邊排到哪裡(世界座標 x):就是右上角那排資訊(星星目標/收入/齒輪)的左緣。
  // 那排是網頁元素、大小不跟著遊戲畫面縮放,所以要實際量;量的結果快取半秒,不用每一幀都去量。
  getOrderBarRightX() {
    const now = this.time.now;
    if (this.orderBarRightAt === undefined || now - this.orderBarRightAt > 500) {
      this.orderBarRightAt = now;
      const info = document.getElementById('hud-right').getBoundingClientRect();
      const canvas = this.game.canvas.getBoundingClientRect();
      this.orderBarRightX = canvas.width > 0 ? ((info.left - canvas.left) / canvas.width) * WORLD_W : WORLD_W;
    }
    return this.orderBarRightX;
  }

  // 排一位客人的訂單泡泡:items 是要顯示的東西(成品的 item 代號,最多三樣;'call' 代表等點餐的 📋、
  // 'pay' 代表等結帳的 💰),空的就整個收掉。
  //   一般:在頭上橫著排,泡泡寬度跟著樣數變;同桌兩位的泡泡各自往外靠,不會疊在一起。
  //   頭上會被訂單卡片蓋住的那幾位(seatView.onTable,每次重新判斷):在桌面上、客人面前直著排。
  layoutOrderBubble(view, seatView, items, shared) {
    const count = items.length;
    const tableX = view.container.x;
    const tableY = view.container.y;
    const seatWorldX = tableX + seatView.seatX;
    // 泡泡正常都在客人頭上。只有一種情況例外:頭上那個位置會被畫面上方的訂單卡片蓋住(桌子很靠上面、
    // 而且剛好在訂單卡片排得到的範圍裡),那一位才改成排在桌面上。訂單卡片只排到右上角那排資訊(星星/收入/齒輪)
    // 的左邊為止,所以靠右邊的桌子就算在最上排,頭上還是看得到。
    if (count > 0) {
      const normalAlong = count * (ORDER_ICON_SIZE + 3) + 7;
      const normalX = seatView.side < 0 ? Math.min(seatWorldX, tableX - normalAlong / 2 - 1) : Math.max(seatWorldX, tableX + normalAlong / 2 + 1);
      const normalTop = tableY + (seatView.aboveY - view.def.y) - (ORDER_ICON_SIZE + 8) / 2;
      const underCards = normalTop < ORDER_BAR_BOTTOM && normalX - normalAlong / 2 < this.getOrderBarRightX() - 12;
      seatView.onTable = underCards || normalTop < HUD_CHIPS_BOTTOM;
    }
    seatView.bubble.setVisible(count > 0);
    seatView.bubbleTail.setVisible(count > 0 && !seatView.onTable);
    // 排在桌面上、而且同桌有兩位客人的時候,兩個人的泡泡要並排塞在兩位客人中間,圖示縮小一點才不會蓋到客人的臉。
    const iconSize = seatView.onTable && shared ? ORDER_ICON_SIZE_SMALL : ORDER_ICON_SIZE;
    const step = iconSize + 3;
    const along = count * step + 7; // 沿著排的方向的長度
    const across = iconSize + 8;
    let cx;
    let cy;
    if (seatView.onTable) {
      // 只有一位客人:泡泡放在桌子正中間;兩位:各自靠自己那一邊,兩個泡泡剛好貼在桌子中線兩側。
      cx = shared ? tableX + seatView.side * (across / 2 + 1) : tableX;
      cy = tableY;
      if (count > 0) seatView.bubble.setSize(across, along).setPosition(cx, cy);
    } else {
      // 泡泡的中心對著客人,但靠桌子中線那一邊不能超過中線(留給同桌另一位)。
      cx = seatView.side < 0 ? Math.min(seatWorldX, tableX - along / 2 - 1) : Math.max(seatWorldX, tableX + along / 2 + 1);
      cy = tableY + (seatView.aboveY - view.def.y);
      if (count > 0) seatView.bubble.setSize(along, across).setPosition(cx, cy);
      seatView.bubbleTail.setPosition(Phaser.Math.Clamp(seatWorldX, cx - along / 2 + 8, cx + along / 2 - 8), cy + across / 2 - 1);
    }
    seatView.orderIcons.forEach((icon, i) => {
      const item = i < count ? items[i] : null;
      const offset = (i - (count - 1) / 2) * step;
      const x = seatView.onTable ? cx : cx + offset;
      const y = seatView.onTable ? cy + offset : cy;
      icon.image.setPosition(x, y);
      icon.text.setPosition(x, y);
      icon.image.maxSize = iconSize;
      if (item === 'pay' || item === 'call') {
        icon.image.setVisible(false);
        this.setPlateFood(icon.image, null);
        icon.text.setText(item === 'pay' ? '💰' : '📋'); // 📋 = 等員工拿點餐本過來點餐
      } else {
        this.setItemVisual(icon.image, icon.text, item);
      }
    });
  }

  // 換員工的圖(站著/朝左/朝右):每張圖的長寬比略有不同,一律固定高度、寬度照原圖比例,不會被壓扁。
  setPlayerTexture(image, key) {
    const src = this.textures.get(key).getSourceImage();
    image.setTexture(key).setDisplaySize(PLAYER_DISPLAY_HEIGHT * (src.width / src.height), PLAYER_DISPLAY_HEIGHT);
  }

  createPlayers() {
    this.playerSprites = {};
    for (const role of ['host', 'joiner']) {
      const spawn = PLAYER_SPAWN[role];
      const container = this.add.container(spawn.x, spawn.y);
      const image = this.add.image(0, 0, PLAYER_TEXTURES[role].idle);
      this.setPlayerTexture(image, PLAYER_TEXTURES[role].idle);
      const carryY = -PLAYER_DISPLAY_HEIGHT / 2 - 10;
      const carryText = this.addText(0, carryY, '', { fontSize: '20px' }).setOrigin(0.5);
      const carryImageFit = this.fitDisplaySize('equip_plate', 30);
      const carryImage = this.add.image(0, carryY, 'equip_plate').setDisplaySize(carryImageFit.w, carryImageFit.h).setVisible(false);
      carryImage.maxSize = 30;
      const roleLabel = this.addText(0, PLAYER_DISPLAY_HEIGHT / 2 + 4, role === 'host' ? 'P1' : 'P2', {
        fontSize: '11px',
        color: '#ffffff',
        fontStyle: 'bold',
        backgroundColor: '#00000080'
      }).setOrigin(0.5);
      container.add([image, roleLabel, carryText, carryImage]);

      this.playerSprites[role] = {
        container,
        image,
        carryText,
        carryImage,
        facing: 'idle',
        lastX: spawn.x,
        x: spawn.x,
        y: spawn.y,
        targetX: spawn.x,
        targetY: spawn.y
      };
    }
  }

  update(time, delta) {
    // 暫停中:時間、訂單、烹煮都停住(Host 不跑 tick),雙方角色也都不能動。
    const paused = !!(this.state && this.state.paused);
    if (this.localTestMode) {
      if (!paused) this.updateLocalTestMode(delta);
    } else {
      if (!paused) {
        this.updateLocalMovement(delta);
        this.handleInteractInput();
      }
      this.updateRemoteMovement(delta);
    }

    if (this.isHost && this.state && !this.editMode) {
      if (!this.state.ended && !paused) {
        this.releaseAbsentCutters(delta);
        tick(this.state, delta);
      }
      // 暫停中、結束後也要繼續送狀態:Joiner 要靠它知道「暫停了/繼續了/時間到了」。
      if (!this.localTestMode && time - this.lastStateSent > 150) {
        this.lastStateSent = time;
        GameSync.sendState(this.state);
      }
    }

    if (this.state) {
      this.renderState();
    }
  }

  // Host 端眼中某個角色目前的位置(本機測試兩個角色都在本機;連線模式對方的位置是同步過來的)。
  getRolePosition(role) {
    if (this.localTestMode) return this.testPositions[role];
    return role === this.role ? this.localPos : this.playerSprites[role];
  }

  // 洗盤子(水槽)也是同一套規則。
  // 切菜要人一直站在鉆板前面:切菜的人離開鉆板碰得到的範圍,就把 worker 清掉(Station.js 那邊就會停止跑進度)。
  // 連線模式對方的位置會晚一點點才同步到,所以要「連續離開超過一小段時間」才算走開,
  // 不然對方剛走到鉆板前開始切的那一瞬間,可能因為位置還沒更新就被誤判成人不在。
  releaseAbsentCutters(delta) {
    if (!this.cutterAwayMs) this.cutterAwayMs = {};
    if (!this.cutterAnchor) this.cutterAnchor = {};
    for (const id in this.state.stations) {
      const st = this.state.stations[id];
      if ((st.type !== 'cutting' && st.type !== 'sink') || !STATION_LAYOUT[id]) continue;
      if (!st.worker) {
        delete this.cutterAnchor[id];
        continue;
      }
      const pos = this.getRolePosition(st.worker);
      // 記住開始切的時候人站在哪裡:只要離開那個位置一小段就算走開。不能只看「還在鉆板碰得到的範圍內」,
      // 因為沿著鉆板的邊橫著走開的時候,會有一大段路都還算在範圍內,進度會多跑將近一秒。
      let anchor = this.cutterAnchor[id];
      if (!anchor || anchor.role !== st.worker) {
        anchor = this.cutterAnchor[id] = { role: st.worker, x: pos.x, y: pos.y };
        this.cutterAwayMs[id] = 0;
      }
      // 位置是本機直接知道的角色(自己,或本機測試的兩個角色)沒有延遲問題,一離開就馬上停;
      // 對方的位置是同步過來的,容許範圍跟時間都放寬一點。
      const isRemote = !this.localTestMode && st.worker !== this.role;
      const moved = Phaser.Math.Distance.Between(pos.x, pos.y, anchor.x, anchor.y);
      const present = this.reachGap(STATION_LAYOUT[id], pos.x, pos.y) <= 0 && moved <= (isRemote ? 40 : 12);
      if (present) {
        this.cutterAwayMs[id] = 0;
        continue;
      }
      this.cutterAwayMs[id] = (this.cutterAwayMs[id] || 0) + delta;
      if (!isRemote || this.cutterAwayMs[id] >= CUTTER_AWAY_GRACE_MS) {
        st.worker = null;
        delete this.cutterAnchor[id];
      }
    }
  }
  // 點擊物件才會移動(點空地沒有反應),走過去後自動互動。
  // 本機測試模式下,點左半邊操控 P1、點右半邊操控 P2。

  // 建立走路用的網格地圖:每一格如果「玩家站在這一格中心」會跟任何站點重疊,就標記成不可走。
  // 只在關卡載入時算一次(站點在遊戲中不會移動),之後每次點擊移動都重複使用同一份網格。
  buildWalkGrid() {
    // 員工(玩家)不會被顧客桌椅卡住:桌椅不算障礙,可以直接穿過去(客人本來就不擋路)。
    // 客人自己走去座位的時候還是會繞過所有桌子,所以另外留一份「全部站點都算障礙」的網格給客人用。
    // 客人繞桌子的時候可以貼著桌邊走(桌子跟桌子之間只留一條窄縫也過得去),一排擺三張桌子才不會把後面的桌子整個擋死。
    this.walkGrid = this.buildGrid((def) => (def.type === 'table' ? null : PLAYER_BODY / 2));
    this.customerGrid = this.buildGrid((def) => (def.type === 'table' ? 2 : PLAYER_BODY / 2));
  }

  // marginFor(def):這個站點周圍要留多寬不能走(站點的邊再往外幾 px);回傳 null 代表這個站點不算障礙。
  buildGrid(marginFor) {
    const cols = Math.floor(WORLD_W / GRID_CELL);
    const rows = Math.floor(WORLD_H / GRID_CELL);
    // 後台的範圍只到最上面那一排檯面為止:那一排的上緣以上不能走(不能繞到檯面後面去)。
    // 最上面那一排的東西只能從下面(或斜對角)拿。
    const kitchenMaxX = (ZONE_MAX_X.host + ZONE_MIN_X.joiner) / 2;
    let kitchenTop = 0;
    const kitchenDefs = Object.values(STATION_LAYOUT).filter((def) => def.x < kitchenMaxX);
    if (kitchenDefs.length > 0) kitchenTop = Math.min(...kitchenDefs.map((def) => def.y - stationHalf(def).hh)) + PLAYER_BODY / 2;
    const grid = [];
    for (let r = 0; r < rows; r++) {
      const rowArr = new Uint8Array(cols);
      for (let c = 0; c < cols; c++) {
        const wx = c * GRID_CELL + GRID_CELL / 2;
        const wy = r * GRID_CELL + GRID_CELL / 2;
        // 畫面最上/最下緣留白也算不可走——不然像「整排站點剛好把區域封死」這種情況,
        // A* 可能會找到一小塊卡在畫面邊緣、跟主要走道完全不連通的空地當成合法目標。
        if (wy < 30 || wy > WORLD_H - 30 || (wx < kitchenMaxX && wy < kitchenTop)) {
          rowArr[c] = 1;
          continue;
        }
        for (const id in STATION_LAYOUT) {
          const def = STATION_LAYOUT[id];
          const margin = marginFor(def);
          if (margin === null) continue;
          const { hw, hh } = stationHalf(def);
          if (Math.abs(wx - def.x) < hw + margin && Math.abs(wy - def.y) < hh + margin) {
            rowArr[c] = 1;
            break;
          }
        }
      }
      grid.push(rowArr);
    }
    this.gridCols = cols;
    this.gridRows = rows;
    return grid;
  }

  gridToWorld(col, row) {
    return { x: col * GRID_CELL + GRID_CELL / 2, y: row * GRID_CELL + GRID_CELL / 2 };
  }

  isCellBlocked(col, row, minCol, maxCol) {
    if (col < minCol || col > maxCol || row < 0 || row >= this.gridRows) return true;
    return this.walkGrid[row][col] === 1;
  }

  // 從某一格開始,一圈一圈往外找最近的一個可走格子(用在起點/終點本身剛好是障礙格的情況)。
  findNearestOpenCell(col, row, minCol, maxCol) {
    if (!this.isCellBlocked(col, row, minCol, maxCol)) return { col, row };
    for (let radius = 1; radius <= 60; radius++) {
      for (let dc = -radius; dc <= radius; dc++) {
        for (let dr = -radius; dr <= radius; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
          const c = col + dc, r = row + dr;
          if (!this.isCellBlocked(c, r, minCol, maxCol)) return { col: c, row: r };
        }
      }
    }
    return null;
  }

  // Dijkstra:從玩家目前位置開始直接往外搜尋,找到第一個「碰得到站點」的格子就當終點(優先選正對著站點的位置,見下面 isFacingStation),
  // 回傳從起點到那個格子的完整路徑(世界座標)。
  //
  // 這裡刻意不是「先在站點旁邊找一個看起來最近的空格,再算路徑過去」——那樣找到的空格可能剛好
  // 在地圖上一塊跟玩家完全不連通的死角裡(例如被其他站點包住),導致路徑怎麼算都算不出來。
  // 用 Dijkstra 從玩家「實際位置」開始展開搜尋,保證只要能找到符合條件的格子,那個格子一定是
  // 走得到的,因為就是沿著這條搜尋展開的路徑走過去的。
  planPathToStation(def, fromX, fromY, role) {
    const minCol = Math.ceil(ZONE_MIN_X[role] / GRID_CELL);
    const maxCol = Math.floor(ZONE_MAX_X[role] / GRID_CELL) - 1;

    let startCol = Phaser.Math.Clamp(Math.floor(fromX / GRID_CELL), minCol, maxCol);
    let startRow = Phaser.Math.Clamp(Math.floor(fromY / GRID_CELL), 0, this.gridRows - 1);
    if (this.isCellBlocked(startCol, startRow, minCol, maxCol)) {
      const open = this.findNearestOpenCell(startCol, startRow, minCol, maxCol);
      if (!open) return null;
      startCol = open.col;
      startRow = open.row;
    }

    // 離「碰得到這個站點」還差多遠(0 = 已經碰得到),見 reachGap。
    const distToStation = (c, r) => {
      const wp = this.gridToWorld(c, r);
      return this.reachGap(def, wp.x, wp.y);
    };

    // 終點優先選「站點四個邊的正中間」(角色正對著站點站好),看起來才是真的走到物件前面才拿到東西,
    // 不是隔著一段距離、站在斜對角就拿到。只有四個邊的中間點都走不到的時候(例如 L 型流理台的轉角,
    // 兩個邊被隔壁站點擋住、另外兩個邊貼著牆),才退而求其次,走到任何一格碰得到的位置。
    // 而且要貼到最靠近站點的那一格(再往前一格就撞到站點了),不是差不多碰得到就停下來。
    const half = stationHalf(def);
    const touchX = half.hw + PLAYER_BODY / 2 + GRID_CELL;
    const touchY = half.hh + PLAYER_BODY / 2 + GRID_CELL;
    // sides:'tb' = 只接受站在上/下邊的中間,'any' = 四個邊都可以。
    const isFacingStation = (sides) => (c, r) => {
      const wp = this.gridToWorld(c, r);
      const dx = Math.abs(wp.x - def.x);
      const dy = Math.abs(wp.y - def.y);
      if (dx >= touchX || dy >= touchY) return false;
      if (dx < touchX - GRID_CELL && dy < touchY - GRID_CELL) return false; // 在站點範圍裡面,不是貼在邊上
      return dx <= GRID_CELL / 2 || (sides === 'any' && dy <= GRID_CELL / 2);
    };
    // 客人坐在桌子左右兩邊的椅子上,所以桌子優先從上面/下面靠近,才不會整個人疊在客人身上。
    let facingPath = null;
    if (def.type === 'table') {
      facingPath = this.searchPath(startCol, startRow, minCol, maxCol, isFacingStation('tb'), distToStation);
    }
    if (!facingPath) {
      facingPath = this.searchPath(startCol, startRow, minCol, maxCol, isFacingStation('any'), distToStation);
    }
    if (facingPath) {
      // 格子中心跟站點中心最多會差半格,最後補一步對齊到正中間。
      const end = facingPath[facingPath.length - 1];
      if (Math.abs(end.x - def.x) <= GRID_CELL / 2) facingPath.push({ x: def.x, y: end.y });
      else facingPath.push({ x: end.x, y: def.y });
      return facingPath;
    }
    return this.searchPath(startCol, startRow, minCol, maxCol, (c, r) => distToStation(c, r) <= 0, distToStation);
  }

  // A*:從起點往外搜尋,回傳走到「第一個符合 isGoal 的格子」的完整路徑(世界座標),完全走不到就回傳 null。
  searchPath(startCol, startRow, minCol, maxCol, isGoal, distToStation) {
    // 啟發函數:離「碰得到站點」還差多遠(格數),再怎麼走都不可能比這個更快抵達,
    // 所以這個估計值不會高估實際距離,可以放心拿來當 A* 的啟發函數用,引導搜尋往站點方向優先展開。
    const heuristic = (c, r) => distToStation(c, r) / GRID_CELL;

    const key = (c, r) => r * this.gridCols + c;
    const startKey = key(startCol, startRow);
    const open = [{ col: startCol, row: startRow, g: 0, f: heuristic(startCol, startRow) }];
    const gScore = new Map([[startKey, 0]]);
    const cameFrom = new Map();
    const closed = new Set();

    while (open.length > 0) {
      let bestIdx = 0;
      for (let i = 1; i < open.length; i++) {
        if (open[i].f < open[bestIdx].f) bestIdx = i;
      }
      const current = open.splice(bestIdx, 1)[0];
      const ck = key(current.col, current.row);
      if (closed.has(ck)) continue;
      closed.add(ck);

      if (isGoal(current.col, current.row)) {
        const cells = [];
        let node = ck;
        while (cameFrom.has(node)) {
          cells.push({ col: node % this.gridCols, row: Math.floor(node / this.gridCols) });
          node = cameFrom.get(node);
        }
        cells.push({ col: startCol, row: startRow });
        cells.reverse();
        return cells.map((cell) => this.gridToWorld(cell.col, cell.row));
      }

      for (const [dc, dr] of NEIGHBOR_OFFSETS) {
        const nc = current.col + dc, nr = current.row + dr;
        if (this.isCellBlocked(nc, nr, minCol, maxCol)) continue;
        // 對角移動時,兩側的正交格子也要是空的,不然會貼著障礙物的角落穿過去。
        if (dc !== 0 && dr !== 0) {
          if (this.isCellBlocked(current.col + dc, current.row, minCol, maxCol)) continue;
          if (this.isCellBlocked(current.col, current.row + dr, minCol, maxCol)) continue;
        }
        const stepCost = (dc !== 0 && dr !== 0) ? Math.SQRT2 : 1;
        const tentativeG = current.g + stepCost;
        const nk = key(nc, nr);
        if (!gScore.has(nk) || tentativeG < gScore.get(nk)) {
          gScore.set(nk, tentativeG);
          cameFrom.set(nk, ck);
          open.push({ col: nc, row: nr, g: tentativeG, f: tentativeG + heuristic(nc, nr) });
        }
      }
    }
    return null; // 從起點出發,完全走不到任何一格符合條件的位置
  }

  setupTapToMove() {
    this.input.on('pointerdown', (pointer) => {
      if (this.state && this.state.paused) return;
      if (this.localTestMode) {
        const midX = (ZONE_MAX_X.host + ZONE_MIN_X.joiner) / 2;
        const role = pointer.worldX < midX ? 'host' : 'joiner';
        this.handleLocalTestTap(role, pointer.worldX, pointer.worldY);
      } else {
        const stationId = this.findTappedStation(pointer.worldX, pointer.worldY);
        if (!stationId) return; // 點到空地不移動

        const def = STATION_LAYOUT[stationId];
        const path = this.planPathToStation(def, this.localPos.x, this.localPos.y, this.role);
        if (!path) return; // 理論上不該發生(完全被封死走不到)
        this.movePath = path;
        this.movePathIndex = 0;
        this.pendingInteractStationId = stationId;
        // 點擊動畫顯示在「點到的那個物件」本身位置,不是走位路徑上的點。
        this.showTapMarker(def.x, def.y);
      }
    });
  }

  handleLocalTestTap(role, x, y) {
    const stationId = this.findTappedStation(x, y);
    if (!stationId) return; // 點到空地不移動

    const def = STATION_LAYOUT[stationId];
    const fromPos = this.testPositions[role];
    const path = this.planPathToStation(def, fromPos.x, fromPos.y, role);
    if (!path) return;
    this.testMovePaths[role] = path;
    this.testMovePathIndex[role] = 0;
    this.testPendingInteract[role] = stationId;
    this.showTapMarker(def.x, def.y);
  }

  updateLocalTestMode(delta) {
    const step = MOVE_SPEED * (delta / 1000);

    for (const role of ['host', 'joiner']) {
      const pos = this.testPositions[role];
      const path = this.testMovePaths[role];

      if (path) {
        const otherRole = role === 'host' ? 'joiner' : 'host';
        const otherPos = this.testPositions[otherRole];
        const newIndex = this.advanceAlongPath(pos, path, this.testMovePathIndex[role], step, otherPos);
        this.testMovePathIndex[role] = newIndex;

        if (newIndex >= path.length) {
          this.testMovePaths[role] = null;
          const stationId = this.testPendingInteract[role];
          if (stationId) {
            interactStation(this.state, stationId, role);
            this.testPendingInteract[role] = null;
          }
        }
      }

      pos.x = Phaser.Math.Clamp(pos.x, ZONE_MIN_X[role], ZONE_MAX_X[role]);
      pos.y = Phaser.Math.Clamp(pos.y, 30, WORLD_H - 30);

      const sprite = this.playerSprites[role];
      sprite.container.setPosition(pos.x, pos.y);
      sprite.x = pos.x;
      sprite.y = pos.y;
      this.updateFacing(role, pos.x);
    }
  }

  // 沿著已經算好的網格路徑走一幀的距離。path 是世界座標的路徑點陣列,fromIndex 是目前走到第幾個點。
  // 回傳走完這一幀之後的新索引(呼叫端自己存起來,下一幀繼續從這個索引往後走)。
  // 路徑本身只保證繞開所有站點(建網格的時候就排除了),另一位玩家是即時移動的動態物件、
  // 沒有算進網格地圖,所以這裡額外做一個輕量的推開,避免兩個角色疊在一起就好,
  // 不需要為了另一位玩家重新規劃路徑。
  advanceAlongPath(pos, path, fromIndex, moveStep, otherPos) {
    let index = fromIndex;
    let remaining = moveStep;
    while (remaining > 0 && index < path.length) {
      const wp = path[index];
      const dx = wp.x - pos.x;
      const dy = wp.y - pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= remaining) {
        pos.x = wp.x;
        pos.y = wp.y;
        remaining -= dist;
        index++;
      } else {
        pos.x += (dx / dist) * remaining;
        pos.y += (dy / dist) * remaining;
        remaining = 0;
      }
    }
    if (otherPos) {
      const dx = pos.x - otherPos.x;
      const dy = pos.y - otherPos.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0 && dist < PLAYER_SIZE) {
        const push = PLAYER_SIZE - dist;
        pos.x += (dx / dist) * push;
        pos.y += (dy / dist) * push;
      }
    }
    return index;
  }

  // 通用的方形碰撞解算:如果 (x,y) 跟清單裡任何一個障礙物重疊,
  // 往重疊量較小的那個軸推開,讓它卡在對方邊緣,而不是直接疊上去。
  resolveCollisionAgainstList(x, y, half, obstacles) {
    for (const obs of obstacles) {
      const dx = x - obs.x;
      const dy = y - obs.y;
      const overlapX = half.hw + obs.hw - Math.abs(dx);
      const overlapY = half.hh + obs.hh - Math.abs(dy);

      if (overlapX > 0 && overlapY > 0) {
        if (overlapX < overlapY) {
          x += dx >= 0 ? overlapX : -overlapX;
        } else {
          y += dy >= 0 ? overlapY : -overlapY;
        }
      }
    }
    return { x, y };
  }

  // 依角色這一幀實際移動的方向切換 left/right/idle 圖片。
  updateFacing(role, newX) {
    const sprite = this.playerSprites[role];
    const dx = newX - sprite.lastX;
    let facing;
    if (dx > FACING_CHANGE_THRESHOLD) facing = 'right';
    else if (dx < -FACING_CHANGE_THRESHOLD) facing = 'left';
    else facing = 'idle';

    sprite.lastX = newX;
    if (facing !== sprite.facing) {
      sprite.facing = facing;
      this.setPlayerTexture(sprite.image, PLAYER_TEXTURES[role][facing]);
    }
  }

  // 編輯模式:拖拉既有物件調整位置(不能互相重疊,撞到會卡在邊緣)、
  // 用單一控制項一次調整「所有物件」的大小、新增物件,結果即時整理成可複製的佈局文字。
  // 進編輯模式時遊戲模擬(訂單/顧客/計時)是暫停的,場景裡不會有顧客。
  enableEditMode() {
    document.getElementById('btn-interact').style.display = 'none';

    this.editedLayout = {}; // { [id]: {x, y} },記錄被拖過的最終位置
    this.dynamicDefs = {}; // { [id]: def },記錄編輯模式下新增/被改種類的物件完整定義(優先於 STATION_LAYOUT)
    this.nextEditId = {};
    this.sizeFilter = 'all'; // 目前大小調整要套用在哪個種類,'all' = 全部物件
    this.pendingGadgetType = null; // 目前選好、等著點一個空桌子放上去的廚具範本
    this.armedBtnEl = null;
    this.deleteMode = false;

    this.sizes = {}; // { [id]: size },每個物件各自的大小
    for (const id in this.stationSprites) {
      const base = this.dynamicDefs[id] || STATION_LAYOUT[id];
      const isTable = this.stationSprites[id].isTable;
      this.sizes[id] = (base && base.size) || (isTable ? TABLE_SIZE : 64);
    }

    for (const id in this.stationSprites) {
      this.makeDraggable(id, this.stationSprites[id].container);
    }

    this.input.on('drag', (pointer, gameObject, dragX, dragY) => {
      if (this.deleteMode || this.pendingGadgetType) return; // 刪除/放置模式下不要順便被拖走
      const snapped = this.snapDragPosition(gameObject.stationId, dragX, dragY);
      const resolved = this.resolveCollision(gameObject.stationId, snapped.x, snapped.y, this.sizes[gameObject.stationId]);
      gameObject.x = resolved.x;
      gameObject.y = resolved.y;
    });

    this.input.on('dragend', (pointer, gameObject) => {
      if (this.deleteMode || this.pendingGadgetType) return;
      this.editedLayout[gameObject.stationId] = {
        x: Math.round(gameObject.x),
        y: Math.round(gameObject.y)
      };
      this.updateEditOutput();
    });

    const palette = document.getElementById('edit-palette');
    const levelNeeds = getLevelNeeds(this.level);
    STATION_TYPE_PALETTE.filter((tpl) => isStationUsedInLevel(tpl, levelNeeds)).forEach((tpl) => {
      const btn = document.createElement('button');
      btn.className = 'palette-btn';
      btn.textContent = '+ ' + tpl.shortLabel;
      if (tpl.type === 'counter') {
        // 桌子/檯面本身是地基,直接建立,不用兩段式放置。
        btn.onclick = () => this.addStation(tpl);
      } else {
        btn.onclick = () => this.toggleArmGadget(tpl, btn);
      }
      palette.appendChild(btn);
    });

    document.getElementById('btn-delete-mode').onclick = (e) => {
      this.deleteMode = !this.deleteMode;
      if (this.deleteMode) this.cancelArmedGadget();
      e.target.textContent = '刪除模式:' + (this.deleteMode ? '開啟(點物件刪除)' : '關閉');
      e.target.classList.toggle('active', this.deleteMode);
    };

    this.selectedEditId = null; // 最後點到的物件,盤子數量是針對這一個物件調整的
    document.getElementById('btn-plates-minus').onclick = () => this.adjustSelectedPlates(-1);
    document.getElementById('btn-plates-plus').onclick = () => this.adjustSelectedPlates(1);

    this.updateSizeDisplay();
    document.getElementById('btn-size-minus').onclick = () => this.adjustFilteredSize(-8);
    document.getElementById('btn-size-plus').onclick = () => this.adjustFilteredSize(8);

    document.getElementById('btn-copy-layout').onclick = () => {
      const textarea = document.getElementById('edit-output');
      textarea.select();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(textarea.value).catch(() => {});
      }
      try {
        document.execCommand('copy');
      } catch (e) {
        // 部分瀏覽器不支援,使用者仍可從 textarea 手動選取複製
      }
    };

    document.getElementById('btn-reset-layout').onclick = () => {
      try {
        localStorage.removeItem(LAYOUT_STORAGE_PREFIX + this.level);
        localStorage.removeItem(LEGACY_LAYOUT_STORAGE_PREFIX + this.level); // 舊位置的也要清,不然 1-1 下次載入又會被搬回來
      } catch (e) {
        // 忽略
      }
      location.reload();
    };

    document.getElementById('edit-level-label').textContent = '正在編輯:1-' + this.level;
    // 切換要編輯的關卡:目前這一關已經自動存檔了,記下要去哪一關後重新載入,main.js 會直接進那一關的編輯模式。
    const switchEditLevel = (delta) => {
      const next = Phaser.Math.Clamp(this.level + delta, 1, LEVEL_COUNT);
      if (next === this.level) return;
      try {
        sessionStorage.setItem('coopEditLevel', String(next));
      } catch (e) {
        return;
      }
      location.reload();
    };
    document.getElementById('btn-edit-level-prev').onclick = () => switchEditLevel(-1);
    document.getElementById('btn-edit-level-next').onclick = () => switchEditLevel(1);
    const editPanel = document.getElementById('edit-panel');
    editPanel.classList.remove('hidden');
    editPanel.classList.remove('collapsed');

    const toggleBtn = document.getElementById('btn-toggle-panel');
    toggleBtn.textContent = '收合 »';
    toggleBtn.onclick = () => {
      const collapsed = editPanel.classList.toggle('collapsed');
      toggleBtn.textContent = collapsed ? '« 展開' : '收合 »';
    };

    // 剛進編輯模式只顯示目前的佈局,不存檔:真的有改東西才存。不然只是進來看一眼,
    // 內建佈局就被存成「自訂佈局」,之後內建的更新了也看不到。
    this.updateEditOutput(false);
  }

  // 拖曳時的對齊:優先「吸附」到附近物件(中心對中心、邊對邊、或剛好貼齊),附近沒有東西可以對才對齊格線。
  // 只對齊格線是不夠的:原本就在場上的物件位置不一定在格線上(例如 y=245、270),大小也不一樣(64/72),
  // 拖過去的物件只會落在 8 的倍數上,跟它們永遠差個幾 px,怎麼拖都排不齊。
  snapDragPosition(movingId, x, y) {
    const half = stationHalf(this.dynamicDefs[movingId] || STATION_LAYOUT[movingId] || {}, this.sizes[movingId] || 64);
    let bestX = null;
    let bestY = null;
    const consider = (best, candidate, current) => {
      const dist = Math.abs(candidate - current);
      return dist <= EDIT_SNAP_DIST && (!best || dist < best.dist) ? { value: candidate, dist } : best;
    };
    for (const otherId in this.stationSprites) {
      if (otherId === movingId) continue;
      const other = this.stationSprites[otherId].container;
      const oh = stationHalf(this.dynamicDefs[otherId] || STATION_LAYOUT[otherId] || {}, this.sizes[otherId] || 64);
      // 只跟附近的物件對齊,離很遠的不管,不然到處都是對齊線、反而拖不到想要的位置。
      const gapX = Math.abs(x - other.x) - half.hw - oh.hw;
      const gapY = Math.abs(y - other.y) - half.hh - oh.hh;
      if (Math.max(gapX, gapY) > EDIT_SNAP_RANGE) continue;
      // 依序:中心對齊、同側的邊對齊(左對左/右對右)、貼齊在對方的右邊/左邊。
      for (const cx of [other.x, other.x - oh.hw + half.hw, other.x + oh.hw - half.hw, other.x + oh.hw + half.hw, other.x - oh.hw - half.hw]) {
        bestX = consider(bestX, cx, x);
      }
      for (const cy of [other.y, other.y - oh.hh + half.hh, other.y + oh.hh - half.hh, other.y + oh.hh + half.hh, other.y - oh.hh - half.hh]) {
        bestY = consider(bestY, cy, y);
      }
    }
    // 格線對齊的是物件的左/上「邊」,不是中心——這樣不同大小的物件邊緣才會落在同一條格線上。
    const snapEdge = (center, halfSize) => Math.round((center - halfSize) / EDIT_GRID_SIZE) * EDIT_GRID_SIZE + halfSize;
    return {
      x: bestX ? bestX.value : snapEdge(x, half.hw),
      y: bestY ? bestY.value : snapEdge(y, half.hh)
    };
  }

  makeDraggable(id, container) {
    container.stationId = id;
    const half = stationHalf(this.dynamicDefs[id] || STATION_LAYOUT[id] || {}, this.sizes[id] || 64);
    container.setSize(half.hw * 2, half.hh * 2);
    container.setInteractive();
    this.input.setDraggable(container);
    container.on('pointerdown', () => this.handleEditObjectTap(id));
  }

  // 點場景裡的物件:刪除模式下直接刪掉;放置模式下如果點到空桌子就把選好的廚具放上去;
  // 平常點一下則是「指定這個物件的種類」給下面的大小調整用(不用下拉選單)。
  handleEditObjectTap(id) {
    if (this.deleteMode) {
      this.deleteStation(id);
      return;
    }
    if (this.pendingGadgetType) {
      this.attachGadgetToCounter(id, this.pendingGadgetType);
      return;
    }
    const base = this.dynamicDefs[id] || STATION_LAYOUT[id];
    if (base) {
      this.sizeFilter = base.type;
      this.updateSizeDisplay();
    }
    this.selectedEditId = id;
    this.updatePlatesRow();
  }

  // 盤子數量那一列只在「點到的物件可以放盤子」(桌子/工作台/出餐口/取盤站)的時候才顯示。
  updatePlatesRow() {
    const id = this.selectedEditId;
    const base = id ? this.dynamicDefs[id] || STATION_LAYOUT[id] : null;
    const st = id ? this.state.stations[id] : null;
    const show = !!(base && st && PLATE_HOLDER_TYPES.includes(base.type));
    document.getElementById('edit-plates-row').classList.toggle('hidden', !show);
    if (show) document.getElementById('plates-display').textContent = st.plateStack.length;
  }

  // 編輯模式裡直接改這個站點 state 上的盤子疊,畫面馬上看得到疊了幾個,存檔時寫進佈局的 plates 欄位。
  adjustSelectedPlates(delta) {
    const id = this.selectedEditId;
    const base = id ? this.dynamicDefs[id] || STATION_LAYOUT[id] : null;
    const st = id ? this.state.stations[id] : null;
    if (!base || !st || !PLATE_HOLDER_TYPES.includes(base.type)) return;
    st.plateStack = makeEmptyPlates(Phaser.Math.Clamp(st.plateStack.length + delta, 0, 20));
    this.updatePlatesRow();
    this.updateEditOutput();
  }

  toggleArmGadget(tpl, btnEl) {
    if (this.deleteMode) {
      this.deleteMode = false;
      const delBtn = document.getElementById('btn-delete-mode');
      delBtn.textContent = '刪除模式:關閉';
      delBtn.classList.remove('active');
    }
    if (this.pendingGadgetType === tpl) {
      this.cancelArmedGadget();
      return;
    }
    this.cancelArmedGadget();
    this.pendingGadgetType = tpl;
    this.armedBtnEl = btnEl;
    btnEl.classList.add('armed');
    document.getElementById('edit-place-hint').classList.remove('hidden');
  }

  cancelArmedGadget() {
    this.pendingGadgetType = null;
    if (this.armedBtnEl) this.armedBtnEl.classList.remove('armed');
    this.armedBtnEl = null;
    document.getElementById('edit-place-hint').classList.add('hidden');
  }

  // 把選好的廚具範本「貼」到一個現有的空桌子上(保留桌子原本的位置/大小),
  // 桌子本身的站點資料被整個換成新廚具的定義,不會兩個疊在一起。
  attachGadgetToCounter(id, tpl) {
    const view = this.stationSprites[id];
    const base = this.dynamicDefs[id] || STATION_LAYOUT[id];
    if (!view || !base || base.type !== 'counter') return; // 只能點還沒放廚具的空桌子

    const pos = this.editedLayout[id] || { x: view.container.x, y: view.container.y };
    const size = tpl.size || this.sizes[id] || 64; // 有自己預設大小的種類(顧客桌位)用自己的,其他沿用底下那張桌子的大小
    this.sizes[id] = size;
    const newDef = Object.assign({}, tpl, { x: pos.x, y: pos.y, size });
    this.dynamicDefs[id] = newDef;

    this.destroyStationView(view);
    const newView = newDef.type === 'table' ? this.createTableView(newDef) : this.createEquipmentView(newDef);
    this.stationSprites[id] = newView;
    this.makeDraggable(id, newView.container);
    this.applyStationSize(id, size);

    const stationState = createStationState(newDef);
    if (stationState) this.state.stations[id] = stationState;

    // 水槽一定搭一張空桌:放水槽的時候自動在旁邊生一張(右邊沒位置就試左、下、上),洗好的盤子會自動放到那一張。
    // 旁邊四個方向都被佔滿的話就不生,洗好的盤子會放到離水槽最近的檯面。
    if (newDef.type === 'sink') {
      const spot = this.findFreeSpotBeside(id, pos, size);
      if (spot) {
        const tableId = this.addStation(STATION_TYPE_PALETTE.find((t) => t.type === 'counter'), spot);
        this.sizes[tableId] = size;
        this.applyStationSize(tableId, size);
        newDef.cleanTo = tableId;
      }
    }

    this.cancelArmedGadget();
    this.selectedEditId = id;
    this.updatePlatesRow();
    this.updateEditOutput();
  }

  deleteStation(id) {
    const view = this.stationSprites[id];
    if (!view) return;
    this.destroyStationView(view);
    delete this.stationSprites[id];
    delete this.editedLayout[id];
    delete this.dynamicDefs[id];
    delete this.sizes[id];
    delete this.state.stations[id];
    if (this.selectedEditId === id) this.selectedEditId = null;
    this.updatePlatesRow();
    this.updateEditOutput();
  }

  // 進度條/對話泡泡是畫在 container 外面的(見 OVERLAY_DEPTH),移除站點時要一起清掉。
  destroyStationView(view) {
    view.overlays.forEach((obj) => obj.destroy());
    view.container.destroy();
  }

  applyStationSize(id, size) {
    const view = this.stationSprites[id];
    const half = stationHalf(this.dynamicDefs[id] || STATION_LAYOUT[id] || view.def, size);
    view.bg.setDisplaySize(half.hw * 2, half.hh * 2);
    if (view.outline) view.outline.setSize(half.hw * 2, half.hh * 2);
    view.container.setSize(half.hw * 2, half.hh * 2);
  }

  // 目前選到的種類('all' = 全部)底下有哪些站點 id。
  getFilteredIds() {
    const ids = [];
    for (const id in this.stationSprites) {
      const base = this.dynamicDefs[id] || STATION_LAYOUT[id];
      if (this.sizeFilter === 'all' || (base && base.type === this.sizeFilter)) {
        ids.push(id);
      }
    }
    return ids;
  }

  updateSizeDisplay() {
    const ids = this.getFilteredIds();
    const size = ids.length > 0 ? this.sizes[ids[0]] : 64;
    document.getElementById('size-display').textContent = size;
    const label = this.sizeFilter === 'all' ? '全部物件' : (TYPE_LABELS[this.sizeFilter] || this.sizeFilter);
    document.getElementById('size-type-label').textContent = label;
  }

  // 只調整目前選到的種類(或全部)的物件大小。
  adjustFilteredSize(delta) {
    const ids = this.getFilteredIds();
    ids.forEach((id) => {
      const next = Phaser.Math.Clamp((this.sizes[id] || 64) + delta, 32, 140);
      this.sizes[id] = next;
      this.applyStationSize(id, next);
    });
    this.updateSizeDisplay();
    this.updateEditOutput();
  }

  // 編輯模式拖拉用:跟其他站點碰撞(排除自己),沿用共用的碰撞解算邏輯。
  resolveCollision(movingId, x, y, size) {
    const obstacles = [];
    for (const otherId in this.stationSprites) {
      if (otherId === movingId) continue;
      const other = this.stationSprites[otherId].container;
      const otherDef = this.dynamicDefs[otherId] || STATION_LAYOUT[otherId] || {};
      obstacles.push(Object.assign({ x: other.x, y: other.y }, stationHalf(otherDef, this.sizes[otherId] || 64)));
    }
    const movingDef = this.dynamicDefs[movingId] || STATION_LAYOUT[movingId] || {};
    return this.resolveCollisionAgainstList(x, y, stationHalf(movingDef, size), obstacles);
  }

  // pos 沒給就生在畫面正中央。回傳新物件的 id。
  addStation(tpl, pos) {
    // 編號要跳過已經存在的 id:上一次編輯新增的物件(例如 new_counter_1)已經存在佈局裡了,
    // 這次如果又從 1 開始編,新物件會跟舊物件撞 id——舊的那個還留在畫面上但已經不歸任何人管
    // (點它刪到的是新的那個、存檔也只存得到新的),看起來就是「刪不掉」「存完再進來不一樣」。
    let id;
    do {
      this.nextEditId[tpl.type] = (this.nextEditId[tpl.type] || 0) + 1;
      id = 'new_' + tpl.type + '_' + this.nextEditId[tpl.type];
    } while (this.stationSprites[id] || STATION_LAYOUT[id]);
    const def = Object.assign({ x: pos ? pos.x : WORLD_W / 2, y: pos ? pos.y : WORLD_H / 2 }, tpl);
    this.dynamicDefs[id] = def;

    const view = def.type === 'table' ? this.createTableView(def) : this.createEquipmentView(def);
    this.stationSprites[id] = view;

    // 新物件預設大小:如果目前選的種類正好符合,就沿用那個大小,不然用預設值。
    const defaultSize = tpl.size || 64;
    this.sizes[id] = this.sizeFilter === tpl.type ? this.sizes[this.getFilteredIds()[0]] || defaultSize : defaultSize;

    this.makeDraggable(id, view.container);
    this.applyStationSize(id, this.sizes[id]);

    const stationState = createStationState(def);
    if (stationState) this.state.stations[id] = stationState;

    this.updateEditOutput();
    return id;
  }

  // 在某個物件的旁邊找一格放得下東西的空位(依序試右、左、下、上),找不到回傳 null。
  findFreeSpotBeside(id, pos, size) {
    for (const [dx, dy] of [[size, 0], [-size, 0], [0, size], [0, -size]]) {
      const x = pos.x + dx;
      const y = pos.y + dy;
      if (x - size / 2 < 0 || x + size / 2 > WORLD_W || y - size / 2 < 0 || y + size / 2 > WORLD_H) continue;
      const blocked = Object.keys(this.stationSprites).some((otherId) => {
        if (otherId === id) return false;
        const other = this.stationSprites[otherId].container;
        const half = stationHalf(this.dynamicDefs[otherId] || STATION_LAYOUT[otherId] || {}, this.sizes[otherId] || 64);
        return Math.abs(x - other.x) < size / 2 + half.hw - 1 && Math.abs(y - other.y) < size / 2 + half.hh - 1;
      });
      if (!blocked) return { x, y };
    }
    return null;
  }

  updateEditOutput(save = true) {
    const merged = {};
    for (const id in this.stationSprites) {
      const base = this.dynamicDefs[id] || STATION_LAYOUT[id];
      const posOverride = this.editedLayout[id];
      merged[id] = Object.assign({}, base, { size: this.sizes[id] || 64 });
      const st = this.state.stations[id];
      if (st && st.plateStack && PLATE_HOLDER_TYPES.includes(base.type)) merged[id].plates = st.plateStack.length;
      else delete merged[id].plates;
      if (posOverride) {
        merged[id].x = posOverride.x;
        merged[id].y = posOverride.y;
      }
    }
    const json = JSON.stringify(merged, null, 2);
    document.getElementById('edit-output').value = json;

    // 自動存到這台裝置的瀏覽器裡,重新整理/下次進遊戲都會沿用這份佈局。
    if (!save) return;
    try {
      localStorage.setItem(LAYOUT_STORAGE_PREFIX + this.level, json);
    } catch (e) {
      // localStorage 可能被封鎖,不影響複製佈局功能
    }
  }

  showTapMarker(x, y) {
    const marker = this.add.circle(x, y, 10, 0xffffff, 0.6);
    this.tweens.add({
      targets: marker,
      scale: 2,
      alpha: 0,
      duration: 350,
      onComplete: () => marker.destroy()
    });
  }

  updateLocalMovement(delta) {
    if (this.movePath) {
      const step = MOVE_SPEED * (delta / 1000);
      const remote = this.playerSprites[this.remoteRole];
      const newIndex = this.advanceAlongPath(this.localPos, this.movePath, this.movePathIndex, step, remote);
      this.movePathIndex = newIndex;

      if (newIndex >= this.movePath.length) {
        this.movePath = null;
        if (this.pendingInteractStationId) {
          const stationId = this.pendingInteractStationId;
          this.pendingInteractStationId = null;
          if (this.isHost) {
            interactStation(this.state, stationId, 'host');
          } else {
            GameSync.sendInteract(stationId);
          }
        }
      }
    }

    this.localPos.x = Phaser.Math.Clamp(this.localPos.x, ZONE_MIN_X[this.role], ZONE_MAX_X[this.role]);
    this.localPos.y = Phaser.Math.Clamp(this.localPos.y, 30, WORLD_H - 30);

    const mySprite = this.playerSprites[this.role];
    mySprite.container.setPosition(this.localPos.x, this.localPos.y);
    mySprite.x = this.localPos.x;
    mySprite.y = this.localPos.y;
    this.updateFacing(this.role, this.localPos.x);
  }

  updateRemoteMovement(delta) {
    // 對方的位置是每隔幾十毫秒才收到一次,直接跳過去看起來會一格一格的。
    // 改成每一幀朝「最新收到的位置」走過去:平常用走路的速度,落後比較多就加快(大約 0.1 秒內追上),差太遠才直接跳。
    const remote = this.playerSprites[this.remoteRole];
    const dx = remote.targetX - remote.x;
    const dy = remote.targetY - remote.y;
    const dist = Math.hypot(dx, dy);
    if (dist > REMOTE_SNAP_DIST || dist < 0.5) {
      remote.x = remote.targetX;
      remote.y = remote.targetY;
    } else {
      const step = Math.min(dist, Math.max(MOVE_SPEED, dist / REMOTE_CATCH_UP_S) * (delta / 1000));
      remote.x += (dx / dist) * step;
      remote.y += (dy / dist) * step;
    }
    remote.container.setPosition(remote.x, remote.y);
    this.updateFacing(this.remoteRole, remote.x);

    const now = performance.now();
    if (now - this.lastMoveSent > MOVE_SEND_INTERVAL_MS) {
      this.lastMoveSent = now;
      GameSync.sendMove(this.localPos.x, this.localPos.y);
    }
  }

  handleInteractInput() {
    if (!GameInput.interactJustPressed) return;
    GameInput.interactJustPressed = false;

    const nearestId = this.findNearestStation(this.localPos.x, this.localPos.y);
    if (!nearestId) return;

    if (this.isHost) {
      interactStation(this.state, nearestId, 'host');
    } else {
      GameSync.sendInteract(nearestId);
    }
  }

  // 玩家站在 (x,y) 時,離「碰得到這個站點」還差多遠;0 代表已經碰得到。
  // 用兩個方塊之間的間距算(取 x/y 兩軸較大的那個),所以正對面跟斜對角都一樣算碰得到,
  // 站點放大縮小也會自動跟著調整,不會因為站點比較大就碰不到。
  reachGap(def, x, y) {
    const { hw, hh } = stationHalf(def);
    const pad = PLAYER_BODY / 2 + INTERACT_REACH;
    return Math.max(0, Math.abs(x - def.x) - hw - pad, Math.abs(y - def.y) - hh - pad);
  }

  findNearestStation(x, y) {
    let best = null;
    let bestDist = Infinity;
    for (const id in STATION_LAYOUT) {
      const def = STATION_LAYOUT[id];
      if (this.reachGap(def, x, y) > 0) continue;
      const d = Phaser.Math.Distance.Between(x, y, def.x, def.y);
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    }
    return best;
  }

  // 點擊/點選專用:限定要真的點在該物件自己的方塊範圍內(留一點點容錯)才算點到它,
  // 不是「離哪個站點最近」——站點排得比較密的時候,兩個站點的 72px 判定半徑會重疊,
  // 這時候用「最近」來判斷,點在 A 物件上卻可能被判定成點到隔壁的 B(尤其手指觸控不夠精準)。
  // 用嚴格的方塊範圍判斷,只要沒點進物件自己的方塊裡,就不會被算成點到它。
  findTappedStation(x, y) {
    let best = null;
    let bestDist = Infinity;
    for (const id in STATION_LAYOUT) {
      const def = STATION_LAYOUT[id];
      const { hw, hh } = stationHalf(def);
      if (Math.abs(x - def.x) > hw + 6 || Math.abs(y - def.y) > hh + 6) continue;
      const d = Phaser.Math.Distance.Between(x, y, def.x, def.y);
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    }
    return best;
  }

  // 手上/站點上「拿著的東西」統一渲染規則:
  // 空的 -> 都藏起來;拿著組合中的盤子(物件,還沒湊滿食譜)-> 顯示盤子圖 + 目前湊了幾樣的數字;
  // 拿著單一物品(字串)-> 有對應圖片就顯示圖片,沒有就退回 emoji 文字。
  setItemVisual(imageObj, textObj, value) {
    if (!value) {
      imageObj.setVisible(false);
      textObj.setText('');
      this.setPlateFood(imageObj, null);
      return;
    }
    if (typeof value === 'object' && value.isPlate) {
      const shown = this.drawContainer(imageObj, value, true);
      // 裝的東西畫得出來就畫出來;畫不出來(好幾樣、又湊不成任何一道菜)才顯示數量。
      textObj.setText(shown || value.items.length === 0 ? '' : String(value.items.length));
      if (textObj.parentContainer) textObj.parentContainer.bringToTop(textObj);
      return;
    }
    this.setPlateFood(imageObj, null);
    const key = itemImageKey(value);
    if (key) {
      imageObj.setTexture(key).setVisible(true);
      this.applyItemImageFit(imageObj, key);
      textObj.setText('');
    } else {
      imageObj.setVisible(false);
      textObj.setText(itemEmoji(value));
    }
  }

  // 畫一個容器(盤子或杯子)。回傳裡面的東西有沒有畫出來(空的也算有)。
  //   盤子:盤子圖 + 上面疊裝的東西(見 setPlateFood)。盤子不管拿在手上還是放在檯面上都一樣大。
  //   杯子:空的畫空杯;裡面的東西剛好是某一種飲料就直接畫那杯飲料;還沒湊成飲料就畫空杯 + 上面疊加了什麼。
  // showContents 是 false 的時候只畫容器本身(疊在下面的那幾個用)。
  drawContainer(imageObj, value, showContents) {
    const size = imageObj.plateSize || PLATE_DISPLAY_SIZE;
    if (value.cup) {
      const drink = showContents && value.items.length > 0 ? findRecipeByIngredients(value.items, true) : null;
      const key = drink ? itemImageKey(drink.platedItem) : 'item_cup_empty';
      // 杯子拿在手上、放在檯面上,都跟杯架上那個杯子圖示一樣大(不要一拿起來就變大)。
      const fit = this.fitDisplaySize(key, Math.max(18, size * CUP_TO_PLATE_RATIO));
      imageObj.setTexture(key).setVisible(true).setDisplaySize(fit.w, fit.h);
      if (drink || !showContents) {
        this.setPlateFood(imageObj, null);
        return true;
      }
      return this.setPlateFood(imageObj, value.items, true) || value.items.length === 0;
    }
    const plateFit = this.fitDisplaySize('equip_plate', size);
    imageObj.setTexture('equip_plate').setVisible(true).setDisplaySize(plateFit.w, plateFit.h);
    return this.setPlateFood(imageObj, showContents ? value.items : null) || value.items.length === 0;
  }

  // 在盤子圖(plateImage)上面疊「盤子裡裝的東西」:
  //   剛好湊成某道菜 -> 自動顯示那道菜的成品圖(一張大的);
  //   還沒湊成菜 -> 裝了什麼就一樣一樣並排顯示(例如熟牛肉、起士分左右),等湊齊了才變成成品圖。
  // items 傳 null 代表這個位置現在不是盤子,把疊上去的圖收掉。回傳有沒有畫出東西。
  // isCup:這是杯子裡還沒湊成飲料的東西(只會一樣一樣並排,成品由 drawContainer 直接換成飲料的圖)。
  setPlateFood(plateImage, items, isCup) {
    let keys = [];
    if (items && items.length > 0) {
      const recipe = isCup ? null : findRecipeByIngredients(items, false);
      keys = recipe ? [itemImageKey(recipe.platedItem)] : items.slice(0, 4).map((item) => itemImageKey(item));
      if (keys.some((key) => !key)) keys = []; // 有沒圖的東西就不畫,交給外面顯示數量
    }
    if (!plateImage.foodOverlays) plateImage.foodOverlays = [];
    const overlays = plateImage.foodOverlays;
    while (overlays.length < keys.length) {
      // 用到才建立,跟盤子圖放在同一層(同一個 container)、疊在盤子上面。
      const overlay = this.add.image(0, 0, keys[0]);
      if (plateImage.parentContainer) plateImage.parentContainer.add(overlay);
      else overlay.setDepth(plateImage.depth);
      overlays.push(overlay);
    }
    const plateSize = plateImage.plateSize || PLATE_DISPLAY_SIZE;
    const itemSize = plateSize * (keys.length <= 1 ? 0.72 : keys.length === 2 ? 0.5 : 0.4);
    const spacing = itemSize * 0.85;
    overlays.forEach((overlay, i) => {
      if (i >= keys.length) {
        overlay.setVisible(false);
        return;
      }
      const fit = this.fitDisplaySize(keys[i], itemSize);
      const offsetX = (i - (keys.length - 1) / 2) * spacing;
      overlay.setTexture(keys[i]).setDisplaySize(fit.w, fit.h).setPosition(plateImage.x + offsetX, plateImage.y - plateSize * 0.1).setVisible(true);
    });
    return keys.length > 0;
  }

  // 換圖後用同一個「長邊上限」重新算長寬比顯示尺寸,避免不同原始比例的圖被硬拉伸。
  applyItemImageFit(imageObj, textureKey) {
    const maxSize = imageObj.maxSize;
    if (!maxSize) return;
    const fit = this.fitDisplaySize(textureKey, maxSize);
    imageObj.setDisplaySize(fit.w, fit.h);
  }

  // 盤子疊放視覺:最多疊 4 層(每層往上偏移一點點,看起來像疊高),超過 4 個在最上面補一個數字角標。
  setPlateStackVisual(view, plateStack) {
    const count = plateStack ? plateStack.length : 0;
    const visibleLayers = Math.min(count, view.plateStackImages.length);
    for (let i = 0; i < view.plateStackImages.length; i++) {
      const layer = view.plateStackImages[i];
      if (i >= visibleLayers) {
        layer.setVisible(false);
        this.setPlateFood(layer, null);
        continue;
      }
      // 畫面上最多畫最上面的幾個。最上面那個(下一個會被拿走的)要看得到裡面裝了什麼,下面幾層只畫容器本身
      // (疊著的可能是盤子也可能是杯子)。
      const item = plateStack[count - visibleLayers + i];
      layer.plateSize = PLATE_DISPLAY_SIZE;
      this.drawContainer(layer, item, i === visibleLayers - 1);
    }
    if (count > view.plateStackImages.length) {
      view.plateStackCountText.setText('×' + count).setVisible(true);
    } else {
      view.plateStackCountText.setVisible(false);
    }
  }

  setStationBorder(view, color, width) {
    if (view.outline && typeof view.outline.setStrokeStyle === 'function') {
      view.outline.setStrokeStyle(width || 3, color);
    }
  }

  // 煮好的東西放著沒收、快要燒焦的警告:外框閃紅色,每閃一次嗶一聲,越接近燒焦閃得越快。
  // burnRatio 是「煮好之後已經放了多久 / 放多久會燒焦」(0~1)。回傳這一幀外框該不該顯示紅色。
  // 剛煮好的前一小段不閃(那時候才剛叮完,還有時間),之後才開始警告。
  updateBurnWarning(id, burnRatio) {
    if (burnRatio < BURN_WARN_START_RATIO || this.state.ended || this.state.paused) return false;
    if (!this.burnFlashAt) this.burnFlashAt = {};
    const urgency = (burnRatio - BURN_WARN_START_RATIO) / (1 - BURN_WARN_START_RATIO);
    const interval = Phaser.Math.Linear(BURN_WARN_SLOW_MS, BURN_WARN_FAST_MS, Phaser.Math.Clamp(urgency, 0, 1));
    const now = this.time.now;
    const last = this.burnFlashAt[id];
    if (last === undefined || now - last >= interval) {
      this.burnFlashAt[id] = now;
      this.sound.play('sfx_beep', { volume: 0.5 });
      return true;
    }
    return now - last < interval / 2;
  }

  renderState() {
    const state = this.state;

    for (const role of ['host', 'joiner']) {
      const carrying = state.players[role].carrying;
      const sprite = this.playerSprites[role];
      this.setItemVisual(sprite.carryImage, sprite.carryText, carrying);
    }

    for (const id in this.stationSprites) {
      const st = state.stations[id];
      const view = this.stationSprites[id];
      if (!st) continue;

      if (st.type === 'cooking') {
        if (view.def.img === 'equip_pan') this.setPanIcon(view, st.status !== 'idle');
        const cookDef = st.recipeId ? getRecipe(st.recipeId) : COOK_RECIPES[st.cookingItem];
        if (st.status === 'cooking') {
          view.progressBg.setVisible(true);
          view.progressBar.setVisible(true);
          view.progressBar.width = view.progressW * Phaser.Math.Clamp(st.progress / (cookDef ? cookDef.cookTimeMs : 1), 0, 1);
          view.progressBar.fillColor = 0xffcf8f;
          // 剛放上去還在煮的時候,先顯示生的食材原型,煮好才會換成熟的圖。
          const rawItem = st.cookingItem || (st.recipeId ? getRecipe(st.recipeId).rawItem : null);
          this.setItemVisual(view.heldItemImage, view.heldItemText, rawItem);
          this.setStationBorder(view, 0xffcf8f);
        } else if (st.status === 'done') {
          view.progressBg.setVisible(false);
          view.progressBar.setVisible(false);
          this.setItemVisual(view.heldItemImage, view.heldItemText, st.itemHeld);
          const burnRatio = cookDef ? st.doneElapsed / cookDef.burnAfterMs : 0;
          if (this.updateBurnWarning(id, burnRatio)) this.setStationBorder(view, 0xff3b30, 7);
          else this.setStationBorder(view, 0x6fe86f);
        } else if (st.status === 'burnt') {
          view.progressBg.setVisible(false);
          view.progressBar.setVisible(false);
          this.setItemVisual(view.heldItemImage, view.heldItemText, st.itemHeld || 'trash');
          this.setStationBorder(view, 0xff6b6b);
        } else {
          view.progressBg.setVisible(false);
          view.progressBar.setVisible(false);
          this.setItemVisual(view.heldItemImage, view.heldItemText, null);
          this.setStationBorder(view, 0xf5ead9);
        }
      } else if (st.type === 'cutting') {
        const cutDef = CUT_RECIPES[st.cuttingItem];
        if (st.status === 'cutting') {
          view.progressBg.setVisible(true);
          view.progressBar.setVisible(true);
          view.progressBar.width = view.progressW * Phaser.Math.Clamp(st.progress / (cutDef ? cutDef.cutTimeMs : 1), 0, 1);
          view.progressBar.fillColor = st.worker ? 0x8fd1ff : 0x9a9a9a; // 沒人顧著(暫停中)顯示灰色
          this.setItemVisual(view.heldItemImage, view.heldItemText, st.cuttingItem);
        } else {
          view.progressBg.setVisible(false);
          view.progressBar.setVisible(false);
          this.setItemVisual(view.heldItemImage, view.heldItemText, st.itemHeld);
        }
      } else if (st.type === 'pass_window' || st.type === 'workbench' || st.type === 'counter' || st.type === 'teleport_out' || st.type === 'teleport_in' || st.type === 'plate_stack') {
        this.setPlateStackVisual(view, st.plateStack);
        if (st.type === 'plate_stack' && view.icon) view.icon.setVisible(st.plateStack.length === 0);
        if (st.plateStack.length === 0) {
          this.setItemVisual(view.heldItemImage, view.heldItemText, st.itemHeld);
        } else {
          view.heldItemImage.setVisible(false);
          view.heldItemText.setText('');
        }
      } else if (st.type === 'sink') {
        // 有人在洗的時候換成「使用中」(有泡泡)的水槽圖,沒人洗就換回原本的圖。
        if (view.def.img === 'equip_sink') {
          const sinkKey = st.worker ? 'equip_sink_active' : 'equip_sink';
          if (view.bg.texture.key !== sinkKey) {
            const half = stationHalf(view.def);
            view.bg.setTexture(sinkKey).setDisplaySize(half.hw * 2, half.hh * 2);
          }
        }
        // 水槽裡疊著的髒盤(盤子圖染成髒髒的顏色,跟乾淨的盤子分得出來),超過 4 個顯示數量。
        const shown = Math.min(st.dirty, view.plateStackImages.length);
        view.plateStackImages.forEach((img, i) => img.setVisible(i < shown).setTint(DIRTY_PLATE_TINT));
        view.plateStackCountText.setText('×' + st.dirty).setVisible(st.dirty > view.plateStackImages.length);
        // 洗到一半(不管人還在不在)都顯示進度條;人走開了(暫停中)顯示灰色。
        const washing = st.dirty > 0 && (!!st.worker || st.progress > 0);
        view.progressBg.setVisible(washing);
        view.progressBar.setVisible(washing);
        view.progressBar.width = view.progressW * Phaser.Math.Clamp(st.progress / WASH_TIME_MS, 0, 1);
        view.progressBar.fillColor = st.worker ? 0x8fd1ff : 0x9a9a9a;
      } else if (st.type === 'table') {
        // 編輯模式下不管實際 state 內容為何,一律當成空桌顯示,絕對不會出現顧客。
        const showCustomers = st.occupied && !this.editMode;
        view.seats.forEach((seatView, i) => {
          const customer = showCustomers && st.seats ? st.seats[i] : null;
          this.updateCustomerView(view, seatView, customer);
          // 頭上的泡泡:坐下之後顯示他還沒拿到的每一樣(還在走過來的還沒點餐);全部到齊就收掉;
          // 同桌都吃完、等結帳的時候改成顯示 💰,提醒員工過來結帳。
          const orders = customer ? customer.orders : [];
          let bubbleItems = [];
          if (customer && st.awaitingPay) bubbleItems = ['pay'];
          else if (customer && !st.ordered && isCustomerSeated(customer)) bubbleItems = ['call']; // 坐好了,等員工來點餐
          else if (customer && !customer.served && isCustomerSeated(customer)) {
            bubbleItems = orders.filter((o) => !o.served).map((o) => getRecipe(o.recipeId).platedItem);
          }
          this.layoutOrderBubble(view, seatView, bubbleItems, st.seats.filter(Boolean).length > 1);
          // 桌上他面前:已經送到的每一份。還沒開始吃/正在吃就顯示那一份,吃完了只剩空盤、空杯。
          // 泡泡是排在桌面上的那種桌子(最上排),泡泡還在的時候桌面讓給泡泡,等東西到齊了才顯示餐點。
          const showMeals = !!customer && !(seatView.onTable && bubbleItems.length > 0);
          const finished = !!customer && customer.served && !(customer.eatLeftMs > 0);
          const served = showMeals ? orders.filter((o) => o.served && o.meal) : [];
          seatView.meals.forEach((slot, j) => {
            let meal = j < served.length ? served[j].meal : null;
            if (meal && finished) meal = typeof meal === 'object' && meal.isPlate ? { isPlate: true, cup: meal.cup, items: [] } : null;
            this.setItemVisual(slot.image, slot.text, meal);
          });
        });
        view.angryText.setVisible(showCustomers && !!st.angry);
        // 耐心條只在還有人沒拿到餐的時候顯示;大家都在吃的時候不用。
        if (showCustomers && st.seats.some((c) => c && !c.served)) {
          const ratio = Phaser.Math.Clamp(st.patience / st.maxPatience, 0, 1);
          view.progressBg.setVisible(true);
          view.progressBar.setVisible(true);
          view.progressBar.width = view.progressW * ratio;
          view.progressBar.fillColor = ratio < 0.3 ? 0xff6b6b : 0x6fe86f;
        } else {
          view.progressBg.setVisible(false);
          view.progressBar.setVisible(false);
        }
      }
    }

    this.updateCookingSounds(state);
    this.updateOrderBar(state);
    HUD.update(state);
  }

  // 把一位客人畫在該在的位置:還在走過來就照路徑走到一半的位置,坐下之後就在椅子上。
  // state 只記「還要走多久」,實際走哪條路是每台裝置自己用同一份佈局算的,所以兩邊看到的路線一樣。
  updateCustomerView(view, seatView, customer) {
    const sprite = seatView.customerSprite;
    if (!customer) {
      // 剛剛還坐在這裡的客人離開了:不要直接消失,讓他從座位走回門口。
      if (seatView.shownCustomerId != null && !this.editMode) this.spawnLeavingCustomer(view, seatView);
      seatView.shownCustomerId = null;
      sprite.setVisible(false);
      seatView.walk = null;
      return;
    }
    seatView.shownLook = customer.look;
    const seat = { x: view.container.x + seatView.seatX, y: view.container.y - 6 };
    const seated = isCustomerSeated(customer);
    let target = seat;
    if (!seated) {
      if (!seatView.walk || seatView.walk.id !== customer.id) {
        seatView.walk = { id: customer.id, points: this.planCustomerPath(view.def, seatView.side, seat) };
      }
      const progress = Phaser.Math.Clamp(1 - customer.walkLeftMs / customer.walkMs, 0, 1);
      target = this.pointAlongPath(seatView.walk.points, progress);
    }
    // 臉朝哪邊:坐下之後面向桌子(坐左邊椅子的朝右、坐右邊的朝左);走路的時候朝前進的方向。
    let facing = seatView.side < 0 ? 'right' : 'left';
    if (!seated && Math.abs(target.x - sprite.x) > 0.5) facing = target.x > sprite.x ? 'right' : 'left';
    else if (!seated && seatView.shownCustomerId === customer.id) facing = seatView.shownFacing || facing;
    seatView.shownFacing = facing;
    this.setCustomerLook(sprite, customer.look, facing);

    if (seatView.shownCustomerId !== customer.id) {
      // 新來的客人直接出現在起點(門口),不要從上一位客人的位置滑過來。
      seatView.shownCustomerId = customer.id;
      sprite.setPosition(target.x, target.y);
    } else {
      // Joiner 端的 state 是每隔一小段時間才同步一次,用漸進靠近的方式移動,看起來才不會一頓一頓的。
      sprite.setPosition(Phaser.Math.Linear(sprite.x, target.x, 0.35), Phaser.Math.Linear(sprite.y, target.y, 0.35));
    }
    sprite.setVisible(true);
  }

  // 換成某種長相、朝某一邊的客人圖。
  setCustomerLook(sprite, look, facing) {
    let key = 'customer_' + look + '_' + facing;
    if (!this.textures.exists(key)) key = 'customer_' + CUSTOMER_LOOKS[0] + '_' + facing; // 對方版本比較舊、沒有這個長相
    if (sprite.texture.key === key && sprite.customerSized) return;
    // 每種長相的圖長寬比不一樣(有馬尾的比較寬),所以統一「高度」、寬度照原圖比例算,臉的大小才會一致。
    const src = this.textures.get(key).getSourceImage();
    sprite.setTexture(key).setDisplaySize(CUSTOMER_SIZE * (src.width / src.height), CUSTOMER_SIZE);
    sprite.customerSized = true;
  }

  // 離開的客人:純畫面效果(state 裡這個座位已經空了,新客人隨時可以來),沿著進來的路反方向走回門口後消失。
  spawnLeavingCustomer(view, seatView) {
    const seat = { x: view.container.x + seatView.seatX, y: view.container.y - 6 };
    const points = this.planCustomerPath(view.def, seatView.side, seat).reverse();
    let total = 0;
    for (let i = 1; i < points.length; i++) total += Phaser.Math.Distance.BetweenPoints(points[i - 1], points[i]);
    const look = seatView.shownLook || CUSTOMER_LOOKS[0];
    const leaver = this.add.image(seat.x, seat.y, 'customer_' + CUSTOMER_LOOKS[0] + '_left').setDepth(CUSTOMER_DEPTH);
    this.setCustomerLook(leaver, look, seatView.side < 0 ? 'right' : 'left');
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: (total / CUSTOMER_WALK_SPEED) * 1000,
      onUpdate: (tween) => {
        const p = this.pointAlongPath(points, tween.getValue());
        if (Math.abs(p.x - leaver.x) > 0.5) this.setCustomerLook(leaver, look, p.x > leaver.x ? 'right' : 'left');
        leaver.setPosition(p.x, p.y);
      },
      onComplete: () => leaver.destroy()
    });
  }

  // 客人從門口走到某張椅子的路徑(世界座標):先用跟玩家一樣的網格尋路,繞過所有站點走到椅子外側,
  // 最後一步再坐上椅子。找不到路(例如桌子被整個圍住)就直接走直線過去。
  planCustomerPath(def, side, seat) {
    const role = def.x < (ZONE_MAX_X.host + ZONE_MIN_X.joiner) / 2 ? 'host' : 'joiner';
    const minCol = Math.ceil(ZONE_MIN_X[role] / GRID_CELL);
    const maxCol = Math.floor(ZONE_MAX_X[role] / GRID_CELL) - 1;
    const entranceCol = Phaser.Math.Clamp(Math.floor(CUSTOMER_ENTRANCE.x / GRID_CELL), minCol, maxCol);
    const points = [{ x: CUSTOMER_ENTRANCE.x, y: CUSTOMER_ENTRANCE.y }];
    // 客人走路要繞過所有桌子,尋路期間暫時換成客人用的網格(見 buildWalkGrid)。
    const playerGrid = this.walkGrid;
    this.walkGrid = this.customerGrid;
    const start = this.findNearestOpenCell(entranceCol, 0, minCol, maxCol);
    if (start) {
      const distToStation = (c, r) => {
        const wp = this.gridToWorld(c, r);
        return this.reachGap(def, wp.x, wp.y);
      };
      // 椅子外側正中間:貼著桌子、跟桌子同一個高度、在椅子那一邊。
      const touchX = stationHalf(def).hw + PLAYER_BODY / 2 + GRID_CELL;
      const besideChair = (c, r) => {
        const wp = this.gridToWorld(c, r);
        const dx = (wp.x - def.x) * side;
        return dx > 0 && dx < touchX && Math.abs(wp.y - def.y) <= GRID_CELL / 2;
      };
      const path = this.searchPath(start.col, start.row, minCol, maxCol, besideChair, distToStation)
        || this.searchPath(start.col, start.row, minCol, maxCol, (c, r) => distToStation(c, r) <= 0, distToStation);
      if (path) points.push(...path);
    }
    this.walkGrid = playerGrid;
    points.push(seat);
    return points;
  }

  // 沿著一串路徑點走到 progress(0~1,照路程長度算)的位置。
  pointAlongPath(points, progress) {
    let total = 0;
    for (let i = 1; i < points.length; i++) total += Phaser.Math.Distance.BetweenPoints(points[i - 1], points[i]);
    let remaining = total * progress;
    for (let i = 1; i < points.length; i++) {
      const seg = Phaser.Math.Distance.BetweenPoints(points[i - 1], points[i]);
      if (remaining <= seg) {
        const t = seg > 0 ? remaining / seg : 0;
        return { x: Phaser.Math.Linear(points[i - 1].x, points[i].x, t), y: Phaser.Math.Linear(points[i - 1].y, points[i].y, t) };
      }
      remaining -= seg;
    }
    return points[points.length - 1];
  }

  // 鍋子正在煮東西的時候循環播滋滋聲,煮好的那一刻叮一聲提醒去收。
  // 直接看 state 判斷(不是在互動當下觸發),所以 Host 跟 Joiner 兩邊聽到的都一樣。
  updateCookingSounds(state) {
    if (!this.cookStatusSeen) this.cookStatusSeen = {};
    let anyCooking = false;
    for (const id in state.stations) {
      const st = state.stations[id];
      if (st.type !== 'cooking') continue;
      if (st.status === 'cooking' && !state.ended && !state.paused) anyCooking = true;
      if (st.status === 'done' && this.cookStatusSeen[id] === 'cooking') {
        this.sound.play('sfx_bell', { volume: 0.7 });
      }
      this.cookStatusSeen[id] = st.status;
    }

    // 餐點從傳送口送到前台的那一刻(包含在入口等了一下才自動送過去的),按鈴叮一聲(音調比「煮好了」的鈴聲高,兩種聽得出來不一樣)。
    const teleportCount = state.teleportCount || 0;
    if (this.teleportCountSeen !== undefined && teleportCount > this.teleportCountSeen) {
      this.sound.play('sfx_bell', { volume: 0.8, rate: 1.5 });
    }
    this.teleportCountSeen = teleportCount;

    // 水槽:有人在洗的時候循環播水聲 + 泡泡聲;每洗好一個盤子(髒盤少一個)就有一聲把盤子放到桌上的聲音。
    if (!this.sinkDirtySeen) this.sinkDirtySeen = {};
    let anyWashing = false;
    for (const id in state.stations) {
      const st = state.stations[id];
      if (st.type !== 'sink') continue;
      if (st.worker && st.dirty > 0 && !state.ended && !state.paused) anyWashing = true;
      if (this.sinkDirtySeen[id] !== undefined && st.dirty === this.sinkDirtySeen[id] - 1) {
        this.sound.play('sfx_plate_down', { volume: 0.8 });
      }
      this.sinkDirtySeen[id] = st.dirty;
    }
    if (!this.washSound) this.washSound = this.sound.add('sfx_wash', { loop: true, volume: 0.55 });
    if (anyWashing && !this.washSound.isPlaying) this.washSound.play();
    else if (!anyWashing && this.washSound.isPlaying) this.washSound.stop();

    // 結帳收到錢(收入增加)的那一刻,響一聲錢幣的聲音。重開一局收入歸零不算。
    if (this.scoreSeen !== undefined && state.score > this.scoreSeen) {
      this.sound.play('sfx_coins', { volume: 0.8 });
    }
    this.scoreSeen = state.score;

    // 鉆板:有人顧著在切的時候循環播切菜聲,人走開(暫停)或切好就停。
    let anyChopping = false;
    for (const id in state.stations) {
      const st = state.stations[id];
      if (st.type === 'cutting' && st.status === 'cutting' && st.worker && !state.ended && !state.paused) anyChopping = true;
    }
    if (!this.chopSound) this.chopSound = this.sound.add('sfx_chop', { loop: true, volume: 0.7 });
    if (anyChopping && !this.chopSound.isPlaying) this.chopSound.play();
    else if (!anyChopping && this.chopSound.isPlaying) this.chopSound.stop();

    if (!this.sizzleSound) this.sizzleSound = this.sound.add('sfx_sizzle', { loop: true, volume: 0.45 });
    if (anyCooking && !this.sizzleSound.isPlaying) this.sizzleSound.play();
    else if (!anyCooking && this.sizzleSound.isPlaying) this.sizzleSound.stop();
  }
}
