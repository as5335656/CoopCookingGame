// 通用互動站點邏輯。所有站點共用同一個 interactStation() 入口,
// 依 station.type 決定行為,不區分「廚師站/服務生站」這種程式碼層級的角色。
// 只在 Host 端執行,執行結果透過 GameSync 廣播出去。
//
// player.carrying 有三種可能:
//   null                                空手
//   字串(例如 'beef_raw' / 'fries_plated')  拿著單一一樣東西(食材,或不需要盤子的單一食材成品如薯條/飲料)
//   { isPlate: true, items: [...] }      拿著一個盤子(組合類食譜用,不管湊了幾樣都是這個狀態,
//                                         算哪道菜留到送餐給客人那一刻才判定,見 itemsMatchIngredients)

// 嘗試把一樣東西交給玩家:空手就直接拿;拿著盤子就加進盤子(什麼食材都可以放,只有放滿了會被擋下);
// 手上已經拿著別的單一物品則不能再拿。回傳 true/false 代表這次有沒有成功拿到。
function canReceiveItem(player) {
  return !player.carrying || (typeof player.carrying === 'object' && player.carrying.isPlate);
}

function tryGiveItemToPlayer(player, itemType) {
  if (!player.carrying) {
    // 杯架:拿到的是一個空杯子(容器),之後拿著它去加熱水、茶包、牛奶。熱水沒有杯子接不了。
    if (itemType === 'cup_empty') player.carrying = { isPlate: true, cup: true, items: [] };
    else if (itemType === 'hot_water') return false;
    else player.carrying = itemType;
    return true;
  }
  // 茶包跟杯子先拿哪個都可以:手上先拿著茶包再到杯架,茶包會直接掛進剛拿到的杯子。
  // (熱水還是要等杯子裡有茶包才接得到,見 canCupAccept。)
  if (itemType === 'cup_empty' && TEA_BAGS.includes(player.carrying)) {
    player.carrying = { isPlate: true, cup: true, items: [player.carrying] };
    return true;
  }
  if (typeof player.carrying === 'object' && player.carrying.isPlate) {
    if (!canContainerAccept(player.carrying, itemType)) return false;
    // 湊到哪一步都還是同一個盤子(記著一樣一樣的食材),剛好等於某份食譜時畫面會自動顯示成成品。
    player.carrying.items.push(itemType);
    return true;
  }
  return false;
}

// 從玩家手上拿走一樣符合條件的東西(給鍋子/鉆板用),回傳拿走的那樣,沒有符合的就回傳 null。
// 手上直接拿著那樣東西 -> 整個拿走,變空手;手上是盤子、盤子裡有那樣東西 -> 只拿走那一樣
// (有好幾樣符合就拿最後放上去的),盤子跟盤子裡其他東西留在手上。
function takeFromHands(player, wanted) {
  const carrying = player.carrying;
  if (typeof carrying === 'string') {
    if (!wanted(carrying)) return null;
    player.carrying = null;
    return carrying;
  }
  if (carrying && carrying.isPlate) {
    for (let i = carrying.items.length - 1; i >= 0; i--) {
      if (wanted(carrying.items[i])) return carrying.items.splice(i, 1)[0];
    }
  }
  return null;
}

function interactStation(state, stationId, role) {
  const st = state.stations[stationId];
  const player = state.players[role];
  if (!st || !player) return;

  // 切菜/洗盤子到一半跑去用別的站點,就算放下手邊的工作(進度保留,回來再點一次才會接著做)。
  for (const id in state.stations) {
    const other = state.stations[id];
    if (id !== stationId && (other.type === 'cutting' || other.type === 'sink') && other.worker === role) other.worker = null;
  }

  switch (st.type) {
    case 'ingredient_source':
      tryGiveItemToPlayer(player, st.itemType);
      break;

    case 'cooking': {
      if (st.status === 'idle' && player.carrying) {
        if (st.recipeId) {
          // 舊版:固定食譜的鍋具(例如油炸鍋只煮薯條)
          const recipe = getRecipe(st.recipeId);
          if (takeFromHands(player, (item) => item === recipe.rawItem)) {
            st.status = 'cooking';
            st.progress = 0;
          }
        } else {
          // 新版:通用平底鍋,煮什麼由放上去的生食決定(直接拿著生食,或是裝在盤子上端過來都可以)
          const rawItem = takeFromHands(player, (item) => !!COOK_RECIPES[item]);
          if (rawItem) {
            st.status = 'cooking';
            st.progress = 0;
            st.cookingItem = rawItem;
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
      } else if (st.status === 'burnt' && canReceiveItem(player)) {
        // 燒焦了:空手拿走,或是拿著盤子把它夾到盤子上(之後整盤倒進垃圾桶,盤子會留在手上)。
        // 以前只能空手清,端著盤子回來發現燒焦的話會卡住沒辦法處理。
        if (tryGiveItemToPlayer(player, st.itemHeld || 'trash')) {
          st.status = 'idle';
          st.progress = 0;
          st.doneElapsed = 0;
          st.itemHeld = null;
          st.cookingItem = null;
        }
      }
      break;
    }

    case 'cutting': {
      if (st.status === 'idle' && player.carrying) {
        // 直接拿著要切的食材,或是裝在盤子上端過來都可以(盤子留在手上)。
        const rawItem = takeFromHands(player, (item) => !!CUT_RECIPES[item]);
        if (rawItem) {
          st.status = 'cutting';
          st.progress = 0;
          st.cuttingItem = rawItem;
          st.worker = role;
        }
      } else if (st.status === 'cutting') {
        // 切到一半走開過,回來點一下接著切(進度不歸零)。
        st.worker = role;
      } else if (st.status === 'done' && canReceiveItem(player)) {
        if (tryGiveItemToPlayer(player, st.itemHeld)) {
          st.itemHeld = null;
          st.status = 'idle';
          st.progress = 0;
          st.cuttingItem = null;
          st.worker = null;
        }
      }
      break;
    }

    case 'plate_stack': {
      // 取盤站上的盤子是有限的(關卡設定幾個就是幾個),拿完就沒有了;空盤可以放回來。
      const carrying = player.carrying;
      if (!carrying) {
        if (st.plateStack.length > 0) player.carrying = st.plateStack.pop();
      } else if (typeof carrying === 'object' && carrying.isPlate) {
        if (carrying.cup) break; // 杯子不放到取盤站
        st.plateStack.push(carrying);
        player.carrying = null;
      } else if (st.plateStack.length > 0) {
        const recipe = getRecipeByCookedItem(carrying);
        if (recipe && recipe.needsPlate) {
          // 舊版:單一食材食譜(例如薯條),用掉一個盤子,直接轉成可端出去的成品
          st.plateStack.pop();
          player.carrying = recipe.platedItem;
        } else if (canContainerAccept(st.plateStack[st.plateStack.length - 1], carrying)) {
          // 手上拿著食材:裝到最上面那個盤子裡,連盤子一起拿起來
          const plate = st.plateStack.pop();
          plate.items.push(carrying);
          player.carrying = plate;
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
    case 'counter': {
      // 三者行為相同:拿著東西且站點是空的 -> 放下;沒拿東西且站點有東西 -> 拿起來。
      // 盤子(isPlate,不管是空盤還是還在組合中)例外:可以一直往上疊,不受「一格只能放一樣」限制。
      const carryingPlate = player.carrying && typeof player.carrying === 'object' && player.carrying.isPlate;
      if (carryingPlate && st.itemHeld) {
        // 拿著盤子點放著食材的檯面:把那樣食材裝到手上的盤子裡。
        if (canContainerAccept(player.carrying, st.itemHeld)) {
          player.carrying.items.push(st.itemHeld);
          st.itemHeld = null;
        }
      } else if (typeof player.carrying === 'string' && st.plateStack.length > 0) {
        // 拿著食材點放著盤子的檯面:把食材放到最上面那個盤子裡。
        const topPlate = st.plateStack[st.plateStack.length - 1];
        if (canContainerAccept(topPlate, player.carrying)) {
          topPlate.items.push(player.carrying);
          player.carrying = null;
        }
      } else if (carryingPlate && !st.itemHeld) {
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

    case 'sink':
      // 有髒盤才洗得了;點一下開始洗(或走開之後回來接著洗),之後要一直站在水槽前面。
      if (st.dirty > 0) st.worker = role;
      break;

    case 'teleport_in': {
      // 前台的出口是空的 -> 直接送過去;出口還有東西沒被拿走 -> 先放在入口這裡等,出口一空會自動送過去
      // (見 updateStations)。入口跟出口都各只放得下一樣,兩邊都滿了就送不了。
      // 空手點入口:把還在等的那一樣拿回來。
      if (!player.carrying) {
        player.carrying = takeFromPad(st);
        break;
      }
      const outId = findEmptyTeleportOut(state);
      if (outId) {
        putOnPad(state.stations[outId], player.carrying);
        player.carrying = null;
        // 每送到前台一次就加一,畫面那邊看到數字變了就叮一聲(通知前台餐點到了)。
        state.teleportCount = (state.teleportCount || 0) + 1;
      } else if (isPadEmpty(st)) {
        putOnPad(st, player.carrying);
        player.carrying = null;
      }
      break;
    }

    case 'teleport_out': {
      // 出口基本上只能拿(要送東西過來請用後台的傳送入口)。唯一的例外是盤子可以放回來:
      // 前台沒有空桌的關卡(例如 1-6),手上端著一盤暫時沒人要的菜會沒地方放、兩手被佔住什麼都做不了,
      // 至少讓它可以先擱回出口(出口要是空的),等有客人點了再拿。擱著的期間後台的下一盤會在入口等。
      if (player.carrying) {
        const carryingPlate = typeof player.carrying === 'object' && player.carrying.isPlate;
        if (carryingPlate && isPadEmpty(st)) {
          putOnPad(st, player.carrying);
          player.carrying = null;
        }
        break;
      }
      player.carrying = takeFromPad(st);
      break;
    }

    case 'trash':
      // 盤子不能丟:拿著盤子點垃圾桶只會把盤子裡的東西倒掉,盤子留在手上。
      // 杯子可以丟(杯子不限量):連杯子一起丟掉,手上變空的。
      if (player.carrying && typeof player.carrying === 'object' && player.carrying.cup) {
        player.carrying = null;
      } else if (player.carrying && typeof player.carrying === 'object' && player.carrying.isPlate) {
        player.carrying.items = [];
      } else if (player.carrying) {
        // 舊版已經裝盤的成品(例如薯條)丟掉的是食物,盤子一樣要回去。
        if (RECIPE_LIST.some((r) => r.needsPlate && r.platedItem === player.carrying)) returnPlate(state);
        player.carrying = null;
      }
      break;

    case 'table': {
      if (!st.occupied) break;
      // 吃完了在等結帳:員工走過來點一下桌子就是結帳(手上有沒有拿東西都可以),
      // 這時候才算收入,客人才會離開座位、盤子才會還回去。
      if (st.awaitingPay) {
        let bill = 0;
        for (const c of st.seats) {
          if (!c) continue;
          for (const order of c.orders) {
            if (order.served) bill += getRecipePrice(order.recipeId);
          }
        }
        // 讓客人等到耐心用完的那一桌,只付一半。
        state.score += st.angry ? Math.round(bill * LATE_PAY_RATIO) : bill;
        clearTable(state, st);
        break;
      }
      // 客人都坐好了、還沒點餐:員工走過來點一下桌子就是幫這一桌點餐(手上有沒有拿東西都可以)。
      // 點了餐,客人要的東西才會出現在頭上跟畫面上方的訂單列,後台才知道要做什麼。
      // 訂單列照點餐的先後由左到右排(先點的在左邊),所以在這一刻編流水號。
      if (!st.ordered) {
        if (!st.seats.every((c) => !c || isCustomerSeated(c))) break; // 還有人在走過來
        st.ordered = true;
        for (const c of st.seats) {
          if (!c) continue;
          state.nextOrderSeq = (state.nextOrderSeq || 0) + 1;
          c.orderSeq = state.nextOrderSeq;
        }
        break;
      }
      // 一桌可能有一或兩位客人,每位可能點好幾樣:手上的東西符合哪一位還沒拿到的那一樣,就給他那一樣。
      // 還在走過來、沒坐下的客人不能先上菜。
      let target = null;
      for (const c of st.seats) {
        if (!c || c.served || !isCustomerSeated(c)) continue;
        const order = c.orders.find((o) => !o.served && carryingMatchesRecipe(player.carrying, getRecipe(o.recipeId)));
        if (order) {
          target = { customer: c, order };
          break;
        }
      }
      if (!target) break;

      // 餐點(連盤子/杯子)留在客人面前;他點的每一樣都到齊了才開始吃。
      // 吃完、結完帳離開座位的時候盤子才會還回去(見 OrderManager.js)。
      target.order.served = true;
      target.order.meal = player.carrying;
      player.carrying = null;
      if (target.customer.orders.every((o) => o.served)) {
        target.customer.served = true;
        target.customer.eatLeftMs = CUSTOMER_EAT_MS;
      }
      break;
    }
  }
}

// 傳送口(入口/出口)上一次只放一樣:盤子記在 plateStack(最多一個),其他東西記在 itemHeld,
// 這樣畫面可以沿用檯面的畫法。
function isPadEmpty(pad) {
  return !pad.itemHeld && pad.plateStack.length === 0;
}

function putOnPad(pad, thing) {
  if (typeof thing === 'object' && thing.isPlate) pad.plateStack.push(thing);
  else pad.itemHeld = thing;
}

function takeFromPad(pad) {
  if (pad.plateStack.length > 0) return pad.plateStack.pop();
  const item = pad.itemHeld;
  pad.itemHeld = null;
  return item || null;
}

function findEmptyTeleportOut(state) {
  return Object.keys(state.stations).find((id) => state.stations[id].type === 'teleport_out' && isPadEmpty(state.stations[id])) || null;
}

// 把一個用過的盤子(洗好的空盤)放回取盤的地方:優先放回取盤站;關卡裡沒有取盤站的話,
// 放回一開始就疊著盤子的那張檯面(state.plateHomeIds)。
function returnPlate(state) {
  const ids = Object.keys(state.stations);
  // 關卡裡有水槽的話,用過的盤子是髒的:先疊到水槽裡,要有人去洗才會變回可以用的盤子。
  const sinkId = ids.find((id) => state.stations[id].type === 'sink');
  if (sinkId) {
    state.stations[sinkId].dirty += 1;
    return;
  }
  const homeId = ids.find((id) => state.stations[id].type === 'plate_stack')
    || (state.plateHomeIds || []).find((id) => state.stations[id] && !state.stations[id].itemHeld);
  if (homeId) state.stations[homeId].plateStack.push({ isPlate: true, items: [] });
}

// 水槽洗好的盤子自動放到「旁邊的空桌」:佈局裡水槽有指定 cleanTo 就放那一張,
// 沒指定(或那張桌子被別的東西佔住)就放到離水槽最近、放得下盤子的檯面。
function placeCleanPlate(state, sinkId) {
  const canHold = (id) => {
    const st = state.stations[id];
    return !!st && id !== sinkId && Array.isArray(st.plateStack) && !st.itemHeld && st.type !== 'teleport_out';
  };
  const layout = typeof STATION_LAYOUT !== 'undefined' ? STATION_LAYOUT : {};
  const sinkDef = layout[sinkId];
  let targetId = sinkDef && canHold(sinkDef.cleanTo) ? sinkDef.cleanTo : null;
  if (!targetId) {
    let best = Infinity;
    for (const id in state.stations) {
      if (!canHold(id)) continue;
      const def = layout[id];
      const dist = sinkDef && def ? Math.hypot(def.x - sinkDef.x, def.y - sinkDef.y) : 0;
      if (dist < best) {
        best = dist;
        targetId = id;
      }
    }
  }
  if (targetId) state.stations[targetId].plateStack.push({ isPlate: true, items: [] });
}

// 手上的東西是不是這份食譜要的成品。
// 組合類食譜(有 ingredients):要拿著盤子,而且盤子內容跟食譜完全一致才算對。
// 單一食材食譜(例如薯條/飲料,沒有 ingredients):直接比對手上的成品字串。
function carryingMatchesRecipe(carrying, recipe) {
  if (!recipe || !carrying) return false;
  if (recipe.ingredients) {
    // 飲料要裝在杯子裡、餐點要裝在盤子上,容器不對不算。
    return typeof carrying === 'object' && carrying.isPlate && !!carrying.cup === isDrinkRecipe(recipe)
      && itemsMatchIngredients(carrying.items, recipe.ingredients);
  }
  return carrying === recipe.platedItem;
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
    } else if (st.type === 'teleport_in') {
      // 入口上有東西在等:前台的出口一空就自動送過去。
      if (isPadEmpty(st)) continue;
      const outId = findEmptyTeleportOut(state);
      if (!outId) continue;
      putOnPad(state.stations[outId], takeFromPad(st));
      state.teleportCount = (state.teleportCount || 0) + 1;
    } else if (st.type === 'sink') {
      if (st.dirty <= 0) {
        st.worker = null;
        st.progress = 0;
        continue;
      }
      // 沒有人顧著就不跑進度(已經洗的進度留著);洗好一個就接著洗下一個,直到髒盤洗完。
      if (!st.worker) continue;
      st.progress += deltaMs;
      if (st.progress >= WASH_TIME_MS) {
        st.progress = 0;
        st.dirty -= 1;
        placeCleanPlate(state, id);
        if (st.dirty === 0) st.worker = null;
      }
    } else if (st.type === 'cutting') {
      // 沒有人顧著(worker 是 null)就不跑進度,但已經切的進度會留著。
      if (st.status !== 'cutting' || !st.worker) continue;
      const cutDef = CUT_RECIPES[st.cuttingItem];
      if (!cutDef) continue;
      st.progress += deltaMs;
      if (st.progress >= cutDef.cutTimeMs) {
        st.status = 'done';
        st.itemHeld = cutDef.cutItem;
        st.progress = 0;
        st.worker = null;
      }
    }
  }
}
