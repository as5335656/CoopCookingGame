// 通用互動站點邏輯。所有站點共用同一個 interactStation() 入口,
// 依 station.type 決定行為,不區分「廚師站/服務生站」這種程式碼層級的角色。
// 只在 Host 端執行,執行結果透過 GameSync 廣播出去。
//
// player.carrying 有三種可能:
//   null                                空手
//   字串(例如 'beef_raw' / 'fries_plated')  拿著單一一樣東西(食材或已完成的成品)
//   { isPlate: true, items: [...] }      拿著一個「正在組合中」的盤子(漢堡類多食材食譜用)

// 嘗試把一樣東西交給玩家:空手就直接拿;拿著盤子就試著加進盤子(不符合食譜規則會被擋下);
// 手上已經拿著別的單一物品則不能再拿。回傳 true/false 代表這次有沒有成功拿到。
function canReceiveItem(player) {
  return !player.carrying || (typeof player.carrying === 'object' && player.carrying.isPlate);
}

function tryGiveItemToPlayer(player, itemType) {
  if (!player.carrying) {
    player.carrying = itemType;
    return true;
  }
  if (typeof player.carrying === 'object' && player.carrying.isPlate) {
    if (!canAddIngredientToPlate(player.carrying.items, itemType)) return false;
    const nextItems = player.carrying.items.concat([itemType]);
    const dish = findDishByIngredients(nextItems);
    if (dish) {
      player.carrying = dish.platedItem; // 湊滿了,盤子變成端得出去的成品
    } else {
      player.carrying.items = nextItems;
    }
    return true;
  }
  return false;
}

function interactStation(state, stationId, role) {
  const st = state.stations[stationId];
  const player = state.players[role];
  if (!st || !player) return;

  switch (st.type) {
    case 'ingredient_source':
      tryGiveItemToPlayer(player, st.itemType);
      break;

    case 'cooking': {
      if (st.status === 'idle' && typeof player.carrying === 'string') {
        if (st.recipeId) {
          // 舊版:固定食譜的鍋具(例如油炸鍋只煮薯條)
          const recipe = getRecipe(st.recipeId);
          if (player.carrying === recipe.rawItem) {
            st.status = 'cooking';
            st.progress = 0;
            player.carrying = null;
          }
        } else {
          // 新版:通用平底鍋,煮什麼由放上去的生食決定
          const cookDef = COOK_RECIPES[player.carrying];
          if (cookDef) {
            st.status = 'cooking';
            st.progress = 0;
            st.cookingItem = player.carrying;
            player.carrying = null;
          }
        }
      } else if (st.status === 'done' && canReceiveItem(player)) {
        if (tryGiveItemToPlayer(player, st.itemHeld)) {
          st.itemHeld = null;
          st.status = 'idle';
          st.progress = 0;
          st.doneElapsed = 0;
          st.cookingItem = null;
        }
      } else if (st.status === 'burnt' && !player.carrying) {
        player.carrying = 'trash';
        st.status = 'idle';
        st.progress = 0;
        st.doneElapsed = 0;
        st.itemHeld = null;
        st.cookingItem = null;
      }
      break;
    }

    case 'cutting': {
      if (st.status === 'idle' && typeof player.carrying === 'string') {
        const cutDef = CUT_RECIPES[player.carrying];
        if (cutDef) {
          st.status = 'cutting';
          st.progress = 0;
          st.cuttingItem = player.carrying;
          player.carrying = null;
        }
      } else if (st.status === 'done' && canReceiveItem(player)) {
        if (tryGiveItemToPlayer(player, st.itemHeld)) {
          st.itemHeld = null;
          st.status = 'idle';
          st.progress = 0;
          st.cuttingItem = null;
        }
      }
      break;
    }

    case 'plate_stack': {
      if (!player.carrying) {
        player.carrying = { isPlate: true, items: [] };
      } else if (typeof player.carrying === 'string') {
        const recipe = getRecipeByCookedItem(player.carrying);
        if (recipe && recipe.needsPlate) {
          // 舊版:單一食材食譜(例如薯條),直接轉成可端出去的成品
          player.carrying = recipe.platedItem;
        } else if (canAddIngredientToPlate([], player.carrying)) {
          // 新版:手上單一食材開始組合成漢堡類食譜,直接連盤子一起拿起來
          player.carrying = { isPlate: true, items: [player.carrying] };
        }
      }
      // 已經拿著盤子的話,再點取盤站沒有動作(盤子要靠其他站點加料)
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
    case 'counter': {
      // 三者行為相同:拿著東西且站點是空的 -> 放下;沒拿東西且站點有東西 -> 拿起來。
      // 盤子(isPlate,不管是空盤還是還在組合中)例外:可以一直往上疊,不受「一格只能放一樣」限制。
      const carryingPlate = player.carrying && typeof player.carrying === 'object' && player.carrying.isPlate;
      if (carryingPlate && !st.itemHeld) {
        st.plateStack.push(player.carrying);
        player.carrying = null;
      } else if (player.carrying && !st.itemHeld && st.plateStack.length === 0) {
        st.itemHeld = player.carrying;
        player.carrying = null;
      } else if (!player.carrying && st.plateStack.length > 0) {
        player.carrying = st.plateStack.pop();
      } else if (!player.carrying && st.itemHeld) {
        player.carrying = st.itemHeld;
        st.itemHeld = null;
      }
      break;
    }

    case 'trash':
      if (player.carrying) {
        player.carrying = null;
      }
      break;

    case 'table': {
      if (st.occupied && typeof player.carrying === 'string') {
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

    if (st.type === 'cooking') {
      const cookDef = st.recipeId ? getRecipe(st.recipeId) : COOK_RECIPES[st.cookingItem];
      if (!cookDef) continue;

      if (st.status === 'cooking') {
        st.progress += deltaMs;
        if (st.progress >= cookDef.cookTimeMs) {
          st.status = 'done';
          st.itemHeld = cookDef.cookedItem;
          st.progress = 0;
          st.doneElapsed = 0;
        }
      } else if (st.status === 'done') {
        st.doneElapsed += deltaMs;
        if (st.doneElapsed >= cookDef.burnAfterMs) {
          st.status = 'burnt';
          st.doneElapsed = 0;
          st.itemHeld = cookDef.burntItem || 'trash';
        }
      }
    } else if (st.type === 'cutting') {
      if (st.status !== 'cutting') continue;
      const cutDef = CUT_RECIPES[st.cuttingItem];
      if (!cutDef) continue;
      st.progress += deltaMs;
      if (st.progress >= cutDef.cutTimeMs) {
        st.status = 'done';
        st.itemHeld = cutDef.cutItem;
        st.progress = 0;
      }
    }
  }
}
