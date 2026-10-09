// 訂單生成與顧客耐心倒數。只在 Host 端執行。

// 客人的長相:每種長相有朝左、朝右兩張圖(assets/sprites/customer_<長相>_left/right.png)。
// 要多一種客人,就多放兩張圖、在這裡加一個代號,並在 KitchenScene.js 的 preload 載入。
const CUSTOMER_LOOKS = ['a', 'b'];
// 前面的關卡每一桌只來一位客人;從這一關開始才會隨機來一位或兩位(各點各的)。
const TWO_CUSTOMER_FROM_LEVEL = 5;
const TWO_CUSTOMER_CHANCE = 0.5; // 可以來兩位的關卡裡,這一桌是兩位的機率
// 一桌的耐心 = 基本的耐心(TABLE_MAX_PATIENCE_MS)+ 每多點一樣多等這麼久(一桌的客人點的全部加起來算)。
const EXTRA_ITEM_PATIENCE_MS = 20000;
// 這一組客人一共點幾樣的機率:一樣 50%、兩樣 35%、三樣 15%(超過這一關上限的就算上限;兩位客人的話至少一人一樣)。
const ORDER_COUNT_CHANCES = [0.5, 0.85];

// 客人不會憑空出現在座位上:固定從前台上方的門口進來,走到自己的椅子坐下。
// 走路的畫面是各台裝置自己照路徑畫的(KitchenScene.js),這裡只負責決定「要走多久」跟倒數。
const CUSTOMER_ENTRANCE = { x: 730, y: 0 };
const CUSTOMER_WALK_SPEED = 240; // px/秒(比員工的 220 快一點點)
const CUSTOMER_WALK_DETOUR = 1.3; // 實際要繞過桌子,路程抓直線距離的 1.3 倍
const CUSTOMER_FOLLOW_DELAY_MS = 500; // 兩位客人一前一後進來,第二位晚一點出發
let nextCustomerId = 1;

function isCustomerSeated(customer) {
  return !(customer.walkLeftMs > 0);
}

const CUSTOMER_EAT_MS = 6000; // 拿到餐之後要吃多久

// 這桌的客人離開座位:這時候才把他們用過的盤子還回取盤的地方(沒拿到餐就走的客人沒有盤子可以還)。
function clearTable(state, table) {
  for (const customer of table.seats) {
    if (!customer) continue;
    for (const order of customer.orders) {
      const meal = order.meal;
      if (!meal) continue;
      // 杯子不用還(杯子不限量、不用洗);盤子才要還。
      const usesPlate = (typeof meal === 'object' && meal.isPlate && !meal.cup) || RECIPE_LIST.some((r) => r.needsPlate && r.platedItem === meal);
      if (usesPlate) returnPlate(state);
    }
  }
  table.occupied = false;
  table.awaitingPay = false;
  table.angry = false;
  table.ordered = false;
  table.seats = [null, null];
  table.patience = 0;
  table.maxPatience = 0;
}

function updateTables(state, deltaMs) {
  for (const id in state.stations) {
    const st = state.stations[id];
    if (st.type !== 'table') continue;
    if (st.occupied) {
      // 已經拿到餐的客人在吃;同桌每個人都拿到餐、也都吃完了,就坐著等員工過去結帳
      // (結帳在 Station.js 的 table 互動裡處理,結完才會離開座位)。
      const customers = st.seats.filter(Boolean);
      for (const customer of customers) {
        if (customer.served && customer.eatLeftMs > 0) customer.eatLeftMs -= deltaMs;
      }
      if (customers.every((c) => c.served)) {
        if (customers.every((c) => !(c.eatLeftMs > 0))) st.awaitingPay = true;
        continue; // 大家都拿到餐了,不用再扣耐心(等結帳也不會不耐煩走掉)
      }

      // 客人還在走過來的時候不扣耐心;坐好了、等員工過來點餐的時候也不扣。點了餐才開始倒數。
      let allSeated = true;
      for (const customer of st.seats) {
        if (!customer || isCustomerSeated(customer)) continue;
        customer.walkLeftMs -= deltaMs;
        if (!isCustomerSeated(customer)) allSeated = false;
      }
      if (!allSeated || !st.ordered) continue;
      // 耐心用完了客人不會走,會繼續坐著等;只是這一桌之後結帳只付一半(見 Station.js 的結帳)。
      st.patience -= deltaMs;
      if (st.patience <= 0) {
        st.patience = 0;
        st.angry = true;
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

  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const ids = state.recipeIds && state.recipeIds.length ? state.recipeIds : RECIPE_LIST.map((r) => r.id);
  // 一位客人隨機坐左邊或右邊的椅子;兩位就左右各坐一位。
  const tableId = pick(emptyTableIds);
  const table = state.stations[tableId];
  const def = typeof STATION_LAYOUT !== 'undefined' ? STATION_LAYOUT[tableId] : null;
  const dist = def ? Math.hypot(def.x - CUSTOMER_ENTRANCE.x, def.y - CUSTOMER_ENTRANCE.y) : 0;
  const walkMs = Math.max(600, (dist * CUSTOMER_WALK_DETOUR / CUSTOMER_WALK_SPEED) * 1000);
  let arrived = 0;
  // walkMs 是實際走路的時間;walkLeftMs 一開始比 walkMs 多出來的部分,是在門口等前一位先走的時間。
  const makeCustomer = () => ({
    id: nextCustomerId++,
    look: pick(CUSTOMER_LOOKS),
    orders: [],
    served: false,
    walkMs,
    walkLeftMs: walkMs + CUSTOMER_FOLLOW_DELAY_MS * arrived++
  });
  const two = (state.level || 1) >= TWO_CUSTOMER_FROM_LEVEL && Math.random() < TWO_CUSTOMER_CHANCE;
  table.seats = [null, null];
  if (two) {
    table.seats = [makeCustomer(), makeCustomer()];
  } else {
    table.seats[Math.floor(Math.random() * 2)] = makeCustomer();
  }

  // 這一組客人點什麼:最少一樣(兩位客人就至少一人一樣),最多照這一關的上限(吃的幾樣、喝的幾樣、合計幾樣),不一定點滿。
  // 點的東西輪流分給同桌的客人。
  const customers = table.seats.filter(Boolean);
  const limits = LEVEL_ORDER_LIMITS[state.level || 1] || { food: 1, drink: 0, total: 1 };
  const foods = ids.filter((id) => !isDrinkRecipe(getRecipe(id)));
  const drinks = ids.filter((id) => isDrinkRecipe(getRecipe(id)));
  const roll = Math.random();
  const wanted = roll < ORDER_COUNT_CHANCES[0] ? 1 : roll < ORDER_COUNT_CHANCES[1] ? 2 : 3;
  const count = Math.max(customers.length, Math.min(limits.total, wanted));
  let foodCount = 0;
  let drinkCount = 0;
  for (let i = 0; i < count; i++) {
    const canFood = foods.length > 0 && foodCount < limits.food;
    const canDrink = drinks.length > 0 && drinkCount < limits.drink;
    if (!canFood && !canDrink) break;
    const drink = canDrink && (!canFood || Math.random() < 0.5);
    if (drink) drinkCount++;
    else foodCount++;
    customers[i % customers.length].orders.push({ recipeId: pick(drink ? drinks : foods), served: false, meal: null });
  }
  // 理論上每位客人都會分到東西;萬一這一關的上限比客人數還少,沒分到的就點一樣吃的。
  for (const customer of customers) {
    if (customer.orders.length === 0) customer.orders.push({ recipeId: pick(foods.length > 0 ? foods : ids), served: false, meal: null });
  }
  const itemCount = table.seats.reduce((sum, c) => sum + (c ? c.orders.length : 0), 0);
  table.occupied = true;
  table.ordered = false;
  table.maxPatience = TABLE_MAX_PATIENCE_MS + EXTRA_ITEM_PATIENCE_MS * (itemCount - 1);
  table.patience = table.maxPatience;
}
