// 遊戲關卡參數與整體狀態(Host 端權威,Joiner 端只接收快照渲染)

const LEVEL_DURATION_MS = 3 * 60 * 1000; // 3 分鐘
const SPAWN_INTERVAL_MS = 9000;
const TABLE_MAX_PATIENCE_MS = 35000;
const SCORE_PER_DISH = 10;

// 依站點類型建立初始 state(單一站點),編輯模式新增站點時也會呼叫這個函式,
// 確保動態新增的站點跟關卡一開始就有的站點資料結構一致。
function createStationState(def) {
  if (def.type === 'ingredient_source') {
    return { type: 'ingredient_source', itemType: def.itemType };
  } else if (def.type === 'cooking') {
    return { type: 'cooking', recipeId: def.recipeId, status: 'idle', progress: 0, doneElapsed: 0, itemHeld: null };
  } else if (def.type === 'plate_stack') {
    return { type: 'plate_stack' };
  } else if (def.type === 'dispenser') {
    return { type: 'dispenser', recipeId: def.recipeId };
  } else if (def.type === 'pass_window') {
    return { type: 'pass_window', itemHeld: null };
  } else if (def.type === 'workbench') {
    return { type: 'workbench', itemHeld: null };
  } else if (def.type === 'trash') {
    return { type: 'trash' };
  } else if (def.type === 'table') {
    return { type: 'table', occupied: false, recipeId: null, patience: 0, maxPatience: 0 };
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

function createInitialState() {
  return {
    timeRemaining: LEVEL_DURATION_MS,
    score: 0,
    ended: false,
    spawnTimer: 0,
    players: {
      host: { carrying: null },
      joiner: { carrying: null }
    },
    stations: createInitialStations()
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
