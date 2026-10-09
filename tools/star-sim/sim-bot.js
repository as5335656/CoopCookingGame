// 自動玩家:給 tools/star-sim/run-sim.js 用,在遊戲頁面裡執行(不是遊戲本身的程式,遊戲不會載入這個檔案)。
// 兩個照固定策略行動的玩家——後台一個負責煎/組合/洗盤子,前台一個負責做飲料/上菜/結帳——用真正的遊戲規則
// (tick / interactStation)跟真正的走路距離(場景的尋路 / MOVE_SPEED)玩完整一局,回傳每一局的收入。
// reactionMs:每個動作額外花的「想 + 瞄準」時間,用來模擬反應快或慢的玩家。
//
// 策略寫死了內建佈局的站點 id(src_beef、pan_N、plate_stack、counter_clean、sink、teleport_in/out、
// src_cup、src_hot_water、src_black_tea_bag、src_green_tea_bag、src_milk、trash_bin、trash_front...)。
// 內建佈局的 id 有改、或加了新的料理步驟,這裡要跟著改。
window.simulateLevel = function (runs, reactionMs) {
  const scene = window.game.scene.scenes[0];
  const level = scene.level;
  const STEP = 100;
  const results = [];

  const isContainer = (v) => !!v && typeof v === 'object' && v.isPlate;
  const meatSource = { beef_cooked: 'src_beef', chicken_cooked: 'src_chicken' };
  const pickupSource = { bun: 'src_bun', cheese: 'src_cheese', lettuce: 'src_lettuce' };
  const drinkSource = { hot_water: 'src_hot_water', black_tea_bag: 'src_black_tea_bag', green_tea_bag: 'src_green_tea_bag', milk: 'src_milk' };

  for (let run = 0; run < runs; run++) {
    const s = createInitialState(level);
    const panIds = Object.keys(s.stations).filter((id) => s.stations[id].type === 'cooking');
    const tableIds = Object.keys(s.stations).filter((id) => s.stations[id].type === 'table');
    const cook = { role: 'host', x: PLAYER_SPAWN.host.x, y: PLAYER_SPAWN.host.y, busyUntil: 0, target: null, job: null };
    const waiter = { role: 'joiner', x: PLAYER_SPAWN.joiner.x, y: PLAYER_SPAWN.joiner.y, busyUntil: 0, target: null, queue: [] };
    let now = 0;
    const started = new Set(); // 已經有人開始做(或做完)的訂單:「客人 id:第幾樣」
    const preheated = {}; // 訂單 -> 已經先幫它把肉放上去的那個鍋子

    const go = (agent, stationId) => {
      const def = STATION_LAYOUT[stationId];
      const path = def && scene.planPathToStation(def, agent.x, agent.y, agent.role);
      if (!path) { agent.target = null; agent.busyUntil = now + 300; return false; }
      let dist = 0, px = agent.x, py = agent.y;
      for (const p of path) { dist += Math.hypot(p.x - px, p.y - py); px = p.x; py = p.y; }
      agent.target = { stationId, x: px, y: py };
      agent.busyUntil = now + reactionMs + (dist / MOVE_SPEED) * 1000;
      return true;
    };
    const wait = (agent, ms) => { agent.target = null; agent.busyUntil = now + ms; };
    const padFree = (id) => !s.stations[id].itemHeld && s.stations[id].plateStack.length === 0;

    // 所有還沒送到的訂單(客人還在走過來的也算,可以先準備)。
    const pendingOrders = (wantDrink) => {
      const list = [];
      for (const id of tableIds) {
        const st = s.stations[id];
        if (!st.occupied || !st.ordered) continue; // 還沒點餐的桌子不知道要什麼
        for (const c of st.seats) {
          if (!c) continue;
          c.orders.forEach((order, i) => {
            const recipe = getRecipe(order.recipeId);
            if (!order.served && isDrinkRecipe(recipe) === wantDrink) list.push({ key: c.id + ':' + i, recipe, customer: c, table: id });
          });
        }
      }
      return list;
    };
    // 手上這一份有沒有人要:回傳 'now'(有坐好的客人要,可以上)、'soon'(要的人還在走過來)、null(沒人要)。
    const whoWants = (carrying) => {
      let soon = false;
      for (const id of tableIds) {
        const st = s.stations[id];
        if (!st.occupied || !st.ordered) continue;
        for (const c of st.seats) {
          if (!c || c.served) continue;
          if (!c.orders.some((o) => !o.served && carryingMatchesRecipe(carrying, getRecipe(o.recipeId)))) continue;
          if (isCustomerSeated(c)) return { when: 'now', table: id };
          soon = true;
        }
      }
      return soon ? { when: 'soon' } : null;
    };

    // ---------- 後台:一次做一道菜;肉先下鍋,煎的時候去拿盤子跟其他材料 ----------
    const buildFoodJob = (order, havePlate) => {
      const ing = order.recipe.ingredients;
      const meat = ing.find((i) => meatSource[i]);
      const pan = preheated[order.key] || null;
      const steps = [];
      const extras = ing.filter((i) => pickupSource[i]).map((i) => ({ go: pickupSource[i] }));
      const takeMeat = [{ waitFor: (job) => s.stations[job.pan].status !== 'cooking' }, { goJobPan: true }, { verifyMeat: meat }];
      if (!pan) steps.push({ go: meatSource[meat] }, { goIdlePan: true });
      if (!havePlate) steps.push({ plate: true });
      // 肉是之前就先放上去的話,拿了盤子先去把肉收起來(不然會燒焦),再拿其他材料。
      if (pan) steps.push(...takeMeat, ...extras);
      else steps.push(...extras, ...takeMeat);
      // 要站著切的東西排在把肉收起來之後,不然慢一點的玩家會站在鉆板前面看著肉燒焦。
      if (ing.includes('tomato_sliced')) {
        steps.push({ go: 'src_tomato' }, { go: 'cutting_board_1' }, { waitFor: () => s.stations.cutting_board_1.status === 'done' }, { go: 'cutting_board_1' });
      }
      steps.push({ deliver: true });
      return { key: order.key, recipe: order.recipe, pan, steps, meat };
    };
    const cookThink = (a) => {
      if (!a.job) {
        if (s.players.host.carrying) { go(a, 'trash_bin'); return; } // 手上有做壞的東西:倒掉
        const burnt = panIds.find((id) => s.stations[id].status === 'burnt' && !Object.values(preheated).includes(id));
        if (burnt) { go(a, burnt); return; }
        const pending = pendingOrders(false);
        const next = pending.find((o) => preheated[o.key]) || pending.find((o) => !started.has(o.key));
        if (!next) {
          // 沒菜要做:趁空檔洗髒盤。
          const sink = s.stations.sink;
          if (sink && sink.dirty > 0 && sink.worker !== 'host') { go(a, 'sink'); return; }
          wait(a, sink && sink.dirty > 0 ? STEP : 300);
          return;
        }
        started.add(next.key);
        a.job = buildFoodJob(next, false);
        // 有第二個鍋子的話,順手把下一道菜的肉也先放上去(這一道不用切東西才這樣做,不然等太久會燒焦)。
        const other = pending.find((o) => o.key !== next.key && !started.has(o.key));
        if (other && !preheated[next.key] && panIds.length > 1 && !next.recipe.ingredients.includes('tomato_sliced')) {
          const otherMeat = other.recipe.ingredients.find((i) => meatSource[i]);
          a.job.steps.splice(2, 0, { go: meatSource[otherMeat] }, { goIdlePan: true, preheatFor: other.key });
        }
        delete preheated[next.key];
      }
      const job = a.job;
      if (job.steps.length === 0) { a.job = null; return cookThink(a); }
      const step = job.steps[0];
      if (step.waitFor) {
        if (step.waitFor(job)) { job.steps.shift(); return cookThink(a); }
        wait(a, STEP);
        return;
      }
      if (step.goIdlePan) {
        const idle = panIds.find((id) => s.stations[id].status === 'idle');
        if (!idle) {
          if (step.preheatFor) { job.steps.shift(); job.steps.unshift({ go: 'trash_bin' }); return cookThink(a); } // 沒有空的鍋子:手上那塊生肉丟掉,之後再做
          wait(a, STEP);
          return;
        }
        if (step.preheatFor) { started.add(step.preheatFor); preheated[step.preheatFor] = idle; }
        else job.pan = idle;
        job.steps.shift();
        go(a, idle);
        return;
      }
      if (step.goJobPan) { job.steps.shift(); go(a, job.pan); return; }
      if (step.verifyMeat) {
        job.steps.shift();
        const carrying = s.players.host.carrying;
        if (isContainer(carrying) && carrying.items.includes(step.verifyMeat)) return cookThink(a);
        // 肉燒焦了(或沒拿到):盤子裡的東西倒掉,拿著空盤從頭再做一次這道菜。
        const retry = buildFoodJob({ key: job.key, recipe: job.recipe }, true);
        a.job = retry;
        a.job.steps.unshift({ go: 'trash_bin' });
        return cookThink(a);
      }
      if (step.deliver) {
        // 送餐:前台的出口空著就直接送;出口還有東西就先放在入口等;兩邊都滿了就端著等。
        if (!s.players.host.carrying) { job.steps.shift(); return cookThink(a); }
        if (padFree('teleport_out') || padFree('teleport_in')) go(a, 'teleport_in'); else wait(a, STEP);
        return;
      }
      if (step.plate) {
        // 哪裡有乾淨的盤子就去哪裡拿;全部都是髒的就去洗(要站在水槽前面)。
        const src = ['plate_stack', 'counter_clean'].find((id) => s.stations[id] && s.stations[id].plateStack.length > 0);
        if (src) { job.steps.shift(); go(a, src); return; }
        const sink = s.stations.sink;
        if (sink && sink.dirty > 0 && sink.worker !== 'host') { go(a, 'sink'); return; }
        wait(a, STEP);
        return;
      }
      job.steps.shift();
      go(a, step.go);
    };

    // ---------- 前台:手上有東西就上菜;不然先幫剛坐下的客人點餐、結帳、再去拿後台送來的菜、再做飲料 ----------
    const waiterThink = (a) => {
      const carrying = s.players.joiner.carrying;
      if (a.queue.length > 0) { go(a, a.queue.shift()); return; }
      if (isContainer(carrying)) {
        const wanted = whoWants(carrying);
        if (wanted && wanted.when === 'now') { go(a, wanted.table); return; }
        if (wanted) { wait(a, 200); return; }
        // 沒人要的東西:杯子倒掉重來;盤子找地方擱著(有空桌放空桌,沒有就放回出口)。
        if (carrying.cup) {
          // 空杯留著做下一杯;裝了沒人要的東西就倒掉(杯子會留在手上)。
          if (carrying.items.length > 0) { go(a, 'trash_front'); return; }
          const nextDrink = pendingOrders(true).find((o) => !started.has(o.key));
          if (nextDrink) {
            started.add(nextDrink.key);
            a.queue = nextDrink.recipe.ingredients.map((i) => drinkSource[i]);
            go(a, a.queue.shift());
            return;
          }
          wait(a, 200);
          return;
        }
        const spare = Object.keys(s.stations).find((id) => id.startsWith('counter_front_') && !s.stations[id].itemHeld);
        if (spare) { go(a, spare); return; }
        if (padFree('teleport_out')) { go(a, 'teleport_out'); return; }
        wait(a, 200);
        return;
      }
      // 有客人坐好了在等點餐:先去點餐(不點餐後台沒事做)。
      const calling = tableIds.find((id) => s.stations[id].occupied && !s.stations[id].ordered && s.stations[id].seats.every((c) => !c || isCustomerSeated(c)));
      if (calling) { go(a, calling); return; }
      const pay = tableIds.find((id) => s.stations[id].awaitingPay);
      if (pay) { go(a, pay); return; }
      const out = s.stations.teleport_out;
      const top = out.plateStack[out.plateStack.length - 1];
      if (top && whoWants(top)) { go(a, 'teleport_out'); return; }
      const drink = pendingOrders(true).find((o) => !started.has(o.key));
      if (drink) {
        started.add(drink.key);
        a.queue = ['src_cup', ...drink.recipe.ingredients.map((i) => drinkSource[i])];
        go(a, a.queue.shift());
        return;
      }
      wait(a, 200);
    };

    while (!s.ended) {
      for (const a of [cook, waiter]) {
        if (now < a.busyUntil) continue;
        if (a.target) {
          a.x = a.target.x; a.y = a.target.y;
          interactStation(s, a.target.stationId, a.role);
          a.target = null;
        }
        if (a.role === 'host') cookThink(a); else waiterThink(a);
      }
      tick(s, STEP);
      now += STEP;
    }
    results.push(s.score);
  }
  return results;
};
