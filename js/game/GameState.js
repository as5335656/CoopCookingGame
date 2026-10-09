// 遊戲關卡參數與整體狀態(Host 端權威,Joiner 端只接收快照渲染)

const LEVEL_DURATION_MS = 3 * 60 * 1000; // 3 分鐘
const SPAWN_INTERVAL_MS = 9000;
const TABLE_MAX_PATIENCE_MS = 50000; // 一桌只點一樣的耐心;每多點一樣再多等一段(見 OrderManager.js 的 EXTRA_ITEM_PATIENCE_MS)
const LATE_PAY_RATIO = 0.5; // 等到耐心用完才拿到餐的那一桌,結帳只付這個比例
const SCORE_PER_DISH = 10;
const WASH_TIME_MS = 3000; // 水槽洗一個髒盤要多久(人要一直站在水槽前面)

// 盤子是有限的:關卡佈局裡每個「可以放盤子的站點」用 plates 欄位設定一開始疊了幾個盤子,
// 整關就只有這些盤子在流通(上菜用掉的會回到取盤的地方,見 Station.js 的 returnPlate)。
// 沒設定 plates 的話,取盤站預設給 PLATE_STACK_DEFAULT_PLATES 個,其他檯面預設沒有盤子。
const PLATE_HOLDER_TYPES = ['plate_stack', 'counter', 'workbench', 'pass_window'];
const PLATE_STACK_DEFAULT_PLATES = 4;

function makeEmptyPlates(count) {
  return Array.from({ length: Math.max(0, Math.floor(count) || 0) }, () => ({ isPlate: true, items: [] }));
}

function initialPlates(def) {
  if (typeof def.plates === 'number') return makeEmptyPlates(def.plates);
  return makeEmptyPlates(def.type === 'plate_stack' ? PLATE_STACK_DEFAULT_PLATES : 0);
}

// 依站點類型建立初始 state(單一站點),編輯模式新增站點時也會呼叫這個函式,
// 確保動態新增的站點跟關卡一開始就有的站點資料結構一致。
function createStationState(def) {
  if (def.type === 'ingredient_source') {
    return { type: 'ingredient_source', itemType: def.itemType };
  } else if (def.type === 'cooking') {
    // recipeId 有填代表舊版單一食譜的鍋具(例如油炸鍋固定只煮薯條);
    // 沒填代表新版通用平底鍋,煮什麼由放上去的生食(cookingItem)臨時決定。
    return { type: 'cooking', recipeId: def.recipeId || null, cookingItem: null, status: 'idle', progress: 0, doneElapsed: 0, itemHeld: null };
  } else if (def.type === 'cutting') {
    // worker:目前站在鉆板前面切菜的玩家('host'/'joiner')。切菜要人一直顧著才會跑進度,
    // 人走開就變回 null、進度停在原地(不歸零),回來再點一次鉆板才會接著切。
    return { type: 'cutting', cuttingItem: null, status: 'idle', progress: 0, itemHeld: null, worker: null };
  } else if (def.type === 'plate_stack') {
    return { type: 'plate_stack', plateStack: initialPlates(def) };
  } else if (def.type === 'dispenser') {
    return { type: 'dispenser', recipeId: def.recipeId };
  } else if (def.type === 'pass_window') {
    // itemHeld 放一般單一物品;plateStack 專門給盤子疊放(可以疊不只一個),兩者互斥。
    return { type: 'pass_window', itemHeld: null, plateStack: initialPlates(def) };
  } else if (def.type === 'sink') {
    // 水槽:dirty = 疊在這裡等著洗的髒盤數量;progress = 目前這一個洗到哪裡;
    // worker = 正在洗的人('host'/'joiner'),人走開就變回 null、進度停住不歸零(跟鉆板切菜一樣)。
    return { type: 'sink', dirty: 0, progress: 0, worker: null };
  } else if (def.type === 'teleport_in') {
    // 後台的傳送入口:點一下把手上的東西送到前台的傳送出口。出口上的東西還沒被拿走的話,
    // 可以先在入口這裡放一樣等著(itemHeld 或 plateStack 裡的那一個),出口一空就自動送過去。
    return { type: 'teleport_in', itemHeld: null, plateStack: [] };
  } else if (def.type === 'teleport_out') {
    // 前台的傳送出口:傳過來的東西會出現在這裡等人拿。一次只放得下一樣(一個盤子或一樣東西)。
    return { type: 'teleport_out', itemHeld: null, plateStack: [] };
  } else if (def.type === 'workbench') {
    return { type: 'workbench', itemHeld: null, plateStack: initialPlates(def) };
  } else if (def.type === 'counter') {
    // 還沒放廚具的空桌子:遊戲中當成通用的暫放點,行為跟工作台一樣(放一樣東西/拿回來),盤子可以疊放。
    return { type: 'counter', itemHeld: null, plateStack: initialPlates(def) };
  } else if (def.type === 'trash') {
    return { type: 'trash' };
  } else if (def.type === 'table') {
    // seats[0] = 坐左邊椅子的客人,seats[1] = 坐右邊椅子的客人;沒人坐是 null,
    // 有人坐是 { id, look, orders, served, walkMs, walkLeftMs, eatLeftMs }(look = 客人的長相代號)。
    // orders 是他點的每一樣:[{ recipeId, served, meal }],meal 是送到他面前的那一份(連盤子或杯子)。
    // 客人的 served = 他點的每一樣都到齊了(這時候才開始吃)。一桌可能只來一位,也可能兩位各點各的。
    // orderSeq 是坐下點餐時拿到的流水號(越小越早點),訂單列用它排序。
    // walkLeftMs > 0 代表客人還在從門口走過來(還沒坐下),見 OrderManager.js。
    // awaitingPay:同桌都吃完了,等員工過去結帳(結了帳才會離開、才算收入)。
    // ordered:員工過來點過餐了沒。客人坐下之後要有人走過去點一下桌子(點餐),訂單才會出現、後台才看得到。
    // angry:這一桌等到耐心用完了。客人不會走,會繼續等,但結帳時只付一半。
    return { type: 'table', occupied: false, seats: [null, null], patience: 0, maxPatience: 0, awaitingPay: false, angry: false, ordered: false };
  }
  return null;
}

function createInitialStations() {
  const stations = {};
  for (const id in STATION_LAYOUT) {
    stations[id] = createStationState(STATION_LAYOUT[id]);
  }
  return stations;
}

function createInitialState(level) {
  return {
    level: level || 1,
    timeRemaining: LEVEL_DURATION_MS,
    score: 0,
    ended: false,
    spawnTimer: 0,
    recipeIds: getLevelRecipeIds(level || 1),
    players: {
      host: { carrying: null },
      joiner: { carrying: null }
    },
    stations: createInitialStations(),
    // 一開始就疊著盤子的檯面(取盤站以外),給 returnPlate 當「盤子的家」用。
    plateHomeIds: Object.keys(STATION_LAYOUT).filter((id) => STATION_LAYOUT[id].type !== 'plate_stack' && STATION_LAYOUT[id].plates > 0)
  };
}

function tick(state, deltaMs) {
  if (state.ended) return;

  state.timeRemaining -= deltaMs;
  if (state.timeRemaining <= 0) {
    state.timeRemaining = 0;
    state.ended = true;
    return;
  }

  updateStations(state, deltaMs);
  updateTables(state, deltaMs);
}
