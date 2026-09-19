// 通用互動站點邏輯。所有站點共用同一個 interactStation() 入口,
// 依 station.type 決定行為,不區分「廚師站/服務生站」這種程式碼層級的角色。
// 只在 Host 端執行,執行結果透過 GameSync 廣播出去。

function interactStation(state, stationId, role) {
  const st = state.stations[stationId];
  const player = state.players[role];
  if (!st || !player) return;

  switch (st.type) {
    case 'ingredient_source':
      if (!player.carrying) {
        player.carrying = st.itemType;
      }
      break;

    case 'cooking': {
      const recipe = getRecipe(st.recipeId);
      if (st.status === 'idle' && player.carrying === recipe.rawItem) {
        st.status = 'cooking';
        st.progress = 0;
        player.carrying = null;
      } else if (st.status === 'done' && !player.carrying) {
        player.carrying = st.itemHeld;
        st.itemHeld = null;
        st.status = 'idle';
        st.progress = 0;
        st.doneElapsed = 0;
      } else if (st.status === 'burnt' && !player.carrying) {
        player.carrying = 'trash';
        st.status = 'idle';
        st.progress = 0;
        st.doneElapsed = 0;
        st.itemHeld = null;
      }
      break;
    }

    case 'plate_stack': {
      if (player.carrying) {
        const recipe = getRecipeByCookedItem(player.carrying);
        if (recipe && recipe.needsPlate) {
          player.carrying = recipe.platedItem;
        }
      }
      break;
    }

    case 'dispenser': {
      if (!player.carrying) {
        const recipe = getRecipe(st.recipeId);
        player.carrying = recipe.platedItem;
      }
      break;
    }

    case 'pass_window':
    case 'workbench':
      // 兩者行為相同:拿著東西且站點是空的 -> 放下;沒拿東西且站點有東西 -> 拿起來
      if (player.carrying && !st.itemHeld) {
        st.itemHeld = player.carrying;
        player.carrying = null;
      } else if (!player.carrying && st.itemHeld) {
        player.carrying = st.itemHeld;
        st.itemHeld = null;
      }
      break;

    case 'trash':
      if (player.carrying) {
        player.carrying = null;
      }
      break;

    case 'table': {
      if (st.occupied && player.carrying) {
        const recipe = getRecipeByPlatedItem(player.carrying);
        if (recipe && recipe.id === st.recipeId) {
          state.score += SCORE_PER_DISH;
          player.carrying = null;
          st.occupied = false;
          st.recipeId = null;
          st.patience = 0;
          st.maxPatience = 0;
        }
      }
      break;
    }
  }
}

function updateStations(state, deltaMs) {
  for (const id in state.stations) {
    const st = state.stations[id];
    if (st.type !== 'cooking') continue;

    const recipe = getRecipe(st.recipeId);

    if (st.status === 'cooking') {
      st.progress += deltaMs;
      if (st.progress >= recipe.cookTimeMs) {
        st.status = 'done';
        st.itemHeld = recipe.cookedItem;
        st.progress = 0;
        st.doneElapsed = 0;
      }
    } else if (st.status === 'done') {
      st.doneElapsed += deltaMs;
      if (st.doneElapsed >= recipe.burnAfterMs) {
        st.status = 'burnt';
        st.doneElapsed = 0;
      }
    }
  }
}
