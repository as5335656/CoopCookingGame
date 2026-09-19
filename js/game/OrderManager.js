// 訂單生成與顧客耐心倒數。只在 Host 端執行。

function updateTables(state, deltaMs) {
  for (const id in state.stations) {
    const st = state.stations[id];
    if (st.type !== 'table') continue;
    if (st.occupied) {
      st.patience -= deltaMs;
      if (st.patience <= 0) {
        st.occupied = false;
        st.recipeId = null;
        st.patience = 0;
        st.maxPatience = 0;
      }
    }
  }

  state.spawnTimer += deltaMs;
  if (state.spawnTimer >= SPAWN_INTERVAL_MS) {
    state.spawnTimer = 0;
    trySpawnOrder(state);
  }
}

function trySpawnOrder(state) {
  const emptyTableIds = Object.keys(state.stations).filter(
    (id) => state.stations[id].type === 'table' && !state.stations[id].occupied
  );
  if (emptyTableIds.length === 0) return;

  const tableId = emptyTableIds[Math.floor(Math.random() * emptyTableIds.length)];
  const recipe = RECIPE_LIST[Math.floor(Math.random() * RECIPE_LIST.length)];
  const table = state.stations[tableId];
  table.occupied = true;
  table.recipeId = recipe.id;
  table.patience = TABLE_MAX_PATIENCE_MS;
  table.maxPatience = TABLE_MAX_PATIENCE_MS;
}
