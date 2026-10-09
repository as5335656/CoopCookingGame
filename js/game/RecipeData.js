// 本關可用的菜色定義。之後要加菜色/改關卡,只需要改這份資料,不用動邏輯程式碼。
//
// V2.3 新增了「組合類」食譜(漢堡):一份成品需要好幾種食材湊在一起,
// 不像薯條/飲料那樣單一食材就能做完。組合順序不重要;盤子上什麼食材都可以放,
// 放上去的東西剛好等於某份食譜時就自動算是那道菜(見 findRecipeByIngredients)。

const RECIPES = {
  fries: {
    id: 'fries',
    name: '薯條',
    color: 0xe8b23a,
    needsPlate: true,
    rawItem: 'potato_raw',
    cookedItem: 'fries_cooked',
    platedItem: 'fries_plated',
    cookStationType: 'fryer',
    cookTimeMs: 6000,
    burnAfterMs: 5000
  },
  drink: {
    id: 'drink',
    name: '飲料',
    color: 0x5ac8e8,
    needsPlate: false,
    platedItem: 'drink_ready',
    dispenserStationType: 'drink_dispenser'
  },

  // price:客人結帳時付的錢,照做起來的難易度訂——只要煎的 $10;漢堡要夾生菜跟麵包 $20;
  // 再多一樣起士 $25;番茄要另外拿去鉆板顧著切所以最貴 $30。
  // 漢堡的作法照 菜單.xlsx 的「Level1」工作表:熟肉 + 生菜 + 麵包,起士堡再加起士,番茄堡再加番茄切片。
  burger_beef: { id: 'burger_beef', price: 20, name: '牛肉堡', platedItem: 'burger_beef', ingredients: ['beef_cooked', 'lettuce', 'bun'] },
  burger_beef_cheese: { id: 'burger_beef_cheese', price: 25, name: '牛肉起士堡', platedItem: 'burger_beef_cheese', ingredients: ['beef_cooked', 'lettuce', 'bun', 'cheese'] },
  burger_beef_tomato: { id: 'burger_beef_tomato', price: 30, name: '牛肉番茄堡', platedItem: 'burger_beef_tomato', ingredients: ['beef_cooked', 'lettuce', 'bun', 'tomato_sliced'] },
  burger_chicken: { id: 'burger_chicken', price: 20, name: '雞肉堡', platedItem: 'burger_chicken', ingredients: ['chicken_cooked', 'lettuce', 'bun'] },
  burger_chicken_cheese: { id: 'burger_chicken_cheese', price: 25, name: '雞肉起士堡', platedItem: 'burger_chicken_cheese', ingredients: ['chicken_cooked', 'lettuce', 'bun', 'cheese'] },
  burger_chicken_tomato: { id: 'burger_chicken_tomato', price: 30, name: '雞肉番茄堡', platedItem: 'burger_chicken_tomato', ingredients: ['chicken_cooked', 'lettuce', 'bun', 'tomato_sliced'] },

  // 飲料(前台做):裝在杯子裡(container: 'cup'),不用盤子。拿著杯子依序加:茶包 -> 熱水 -> (牛奶),
  // 順序不能換(杯子裡要先有茶包才能倒熱水,泡好茶才能加牛奶,見 canCupAccept)。
  // 杯子裡的東西剛好等於下面某一種就自動變成那杯飲料。奶茶 = 紅茶再加牛奶,奶綠 = 綠茶再加牛奶。
  // 不用煮也不用顧,所以比餐點便宜。ingredients 照加的順序寫(訂單卡片上的小圈圈也照這個順序排)。
  black_tea: { id: 'black_tea', price: 10, name: '紅茶', container: 'cup', platedItem: 'black_tea', ingredients: ['black_tea_bag', 'hot_water'] },
  green_tea: { id: 'green_tea', price: 10, name: '綠茶', container: 'cup', platedItem: 'green_tea', ingredients: ['green_tea_bag', 'hot_water'] },
  milk_tea: { id: 'milk_tea', price: 15, name: '奶茶', container: 'cup', platedItem: 'milk_tea', ingredients: ['black_tea_bag', 'hot_water', 'milk'] },
  milk_green_tea: { id: 'milk_green_tea', price: 15, name: '奶綠', container: 'cup', platedItem: 'milk_green_tea', ingredients: ['green_tea_bag', 'hot_water', 'milk'] },

  // 單一食材就能端走的簡化菜色(不用夾麵包/配料),給比較早、比較簡單的關卡用。
  plate_beef: { id: 'plate_beef', price: 10, name: '熟牛肉', platedItem: 'beef_cooked', ingredients: ['beef_cooked'] },
  plate_chicken: { id: 'plate_chicken', price: 10, name: '熟雞肉', platedItem: 'chicken_cooked', ingredients: ['chicken_cooked'] }
};

const RECIPE_LIST = Object.values(RECIPES);

function getRecipeList(allowedIds) {
  if (!allowedIds) return RECIPE_LIST;
  return RECIPE_LIST.filter((r) => allowedIds.includes(r.id));
}

// 每一關客人會點的菜(照 菜單.xlsx 各關的工作表)。沒列在這裡的關卡沿用 default。
// 要改某一關的菜單,改這裡就好:關卡裡會出現哪些材料箱/需不需要鉆板,都是從這份菜單自動推出來的(見 getLevelNeeds)。
const MENU_MEAT = ['plate_beef', 'plate_chicken'];
const MENU_BURGER = [...MENU_MEAT, 'burger_beef', 'burger_chicken'];
const MENU_CHEESE = [...MENU_BURGER, 'burger_beef_cheese', 'burger_chicken_cheese'];
const MENU_TOMATO = [...MENU_CHEESE, 'burger_beef_tomato', 'burger_chicken_tomato'];
const DRINKS_TEA = ['black_tea', 'green_tea'];
const DRINKS_ALL = [...DRINKS_TEA, 'milk_tea', 'milk_green_tea'];
const LEVEL_RECIPE_IDS = {
  1: MENU_MEAT,
  2: MENU_BURGER,
  3: [...MENU_BURGER, ...DRINKS_TEA],
  4: [...MENU_CHEESE, ...DRINKS_TEA],
  5: [...MENU_CHEESE, ...DRINKS_TEA],
  6: [...MENU_TOMATO, ...DRINKS_ALL],
  7: [...MENU_TOMATO, ...DRINKS_ALL],
  8: [...MENU_TOMATO, ...DRINKS_ALL],
  default: ['fries', 'drink']
};

// 每一組客人(一桌)最多點多少(菜單.xlsx 各關工作表上的「每組客人 N 個餐點,N 個飲料」):
// food = 吃的最多幾樣、drink = 喝的最多幾樣、total = 合計最多幾樣。不一定會點滿,最少點一樣。
const LEVEL_ORDER_LIMITS = {
  1: { food: 1, drink: 0, total: 1 },
  2: { food: 1, drink: 0, total: 1 },
  3: { food: 1, drink: 1, total: 2 },
  4: { food: 1, drink: 1, total: 2 },
  5: { food: 2, drink: 2, total: 3 },
  6: { food: 2, drink: 2, total: 3 },
  7: { food: 2, drink: 2, total: 3 },
  8: { food: 2, drink: 2, total: 3 }
};

// 只能放進杯子裡的東西(不能放到盤子上);杯子本身(cup_empty)從杯架拿,數量不限、不用洗。
const DRINK_INGREDIENTS = ['hot_water', 'black_tea_bag', 'green_tea_bag', 'milk'];

function isDrinkRecipe(recipe) {
  return !!recipe && recipe.container === 'cup';
}

// 每一關幾張顧客桌(菜單.xlsx 各關工作表右上角的「桌子 N 張」)。
const LEVEL_TABLE_COUNT = { 1: 3, 2: 3, 3: 4, 4: 3, 5: 4, 6: 4, 7: 5, 8: 6 };

// 每一關幾個平底鍋(菜單.xlsx 各關工作表上的「N 個平底鍋」)。
const LEVEL_PAN_COUNT = { 1: 1, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 3, 8: 3 };

function getLevelRecipeIds(level) {
  return LEVEL_RECIPE_IDS[level] || LEVEL_RECIPE_IDS.default;
}

// 這一關的菜單「做得出來」需要哪些東西:哪些材料箱、要不要鍋子、要不要鉆板。
// 菜單裡用不到的材料不會出現在關卡裡,用得到的一定要有。
function getLevelNeeds(level) {
  const recipeIds = getLevelRecipeIds(level);
  const sources = new Set();
  let cooking = false;
  let cutting = false;
  const addIngredient = (item) => {
    const cookRaw = Object.keys(COOK_RECIPES).find((raw) => COOK_RECIPES[raw].cookedItem === item);
    const cutRaw = Object.keys(CUT_RECIPES).find((raw) => CUT_RECIPES[raw].cutItem === item);
    if (cookRaw) cooking = true;
    if (cutRaw) cutting = true;
    sources.add(cookRaw || cutRaw || item);
  };
  for (const id of recipeIds) {
    const recipe = getRecipe(id);
    if (!recipe) continue;
    if (recipe.ingredients) recipe.ingredients.forEach(addIngredient);
    else if (recipe.rawItem) sources.add(recipe.rawItem); // 舊版單一食材食譜(薯條)
    if (isDrinkRecipe(recipe)) sources.add('cup_empty'); // 有飲料就要有杯架
  }
  return { recipeIds, sources: [...sources], cooking, cutting };
}

// 這個站點在這一關用不用得到(needs 是 getLevelNeeds 的結果)。桌子、垃圾桶、出餐口這類通用的東西一律算用得到。
function isStationUsedInLevel(def, needs) {
  if (def.type === 'ingredient_source') return needs.sources.includes(def.itemType);
  if (def.type === 'cutting') return needs.cutting;
  if (def.type === 'cooking') return def.recipeId ? needs.recipeIds.includes(def.recipeId) : needs.cooking;
  if (def.type === 'dispenser') return needs.recipeIds.includes(def.recipeId);
  return true;
}

// 這份佈局是不是把這一關需要的東西都擺齊了:每種材料箱、鍋子、鉆板、盤子、至少一張顧客桌。
function layoutCoversLevel(layout, needs) {
  const defs = Object.values(layout);
  const has = (test) => defs.some(test);
  if (!needs.sources.every((item) => has((d) => d.type === 'ingredient_source' && d.itemType === item))) return false;
  if (needs.cooking && !has((d) => d.type === 'cooking' && !d.recipeId)) return false;
  if (needs.cutting && !has((d) => d.type === 'cutting')) return false;
  if (!has((d) => d.type === 'plate_stack' || d.plates > 0)) return false;
  return has((d) => d.type === 'table');
}

// 平底鍋:生食 -> 煮熟,煮好放太久 -> 燒焦。哪個生食對應哪組時間/成品,查這裡。
const COOK_RECIPES = {
  // cookTimeMs:煎多久會熟;burnAfterMs:煎好之後再放多久會燒焦。
  beef_raw: { cookedItem: 'beef_cooked', burntItem: 'beef_burnt', cookTimeMs: 6000, burnAfterMs: 10000 },
  chicken_raw: { cookedItem: 'chicken_cooked', burntItem: 'chicken_burnt', cookTimeMs: 6000, burnAfterMs: 10000 }
};

// 鉆板:切生食材。目前只有番茄需要切。
const CUT_RECIPES = {
  tomato_raw: { cutItem: 'tomato_sliced', cutTimeMs: 3000 }
};

// 這道菜客人付多少錢(沒標價的舊菜色用統一價)。
function getRecipePrice(id) {
  const recipe = RECIPES[id];
  return (recipe && recipe.price) || SCORE_PER_DISH;
}

function getRecipe(id) {
  return RECIPES[id] || null;
}

function getRecipeByRawItem(itemType) {
  return RECIPE_LIST.find((r) => r.rawItem === itemType) || null;
}

function getRecipeByCookedItem(itemType) {
  return RECIPE_LIST.find((r) => r.cookedItem === itemType) || null;
}

// 盤子裡目前裝的這一包食材(順序不重要),內容是否跟某份食譜的食材清單「完全一樣」
// (不多不少)。只在送餐那一刻拿玩家手上的盤子內容去跟客人這桌指定的那份食譜比對,
// 用意是「湊到哪一步都還是同一個盤子物件,由送餐當下的比對結果決定端出去算哪道菜」,
// 這樣同一關才能同時有「單一食材就算完成」跟「要湊好幾樣才算完成」的食譜並存,不會
// 因為湊到某個中繼狀態就被提早鎖定成別的菜(例如熟牛肉是簡單菜色,但也是漢堡的半成品)。
function itemsMatchIngredients(items, ingredients) {
  if (!ingredients || items.length !== ingredients.length) return false;
  const sortedItems = [...items].sort();
  const sortedNeed = [...ingredients].sort();
  return sortedItems.every((v, i) => v === sortedNeed[i]);
}

// 盤子上可以放任何食材(生的、熟的、切過的都可以,不管湊不湊得出食譜),只限制最多放幾樣。
// 例外:垃圾不能放;舊版單一食材菜色(薯條/飲料)有自己的裝盤流程,不走「盤子裝食材」這一套。
const PLATE_MAX_ITEMS = 6;

function canPlateAccept(currentItems, newItem) {
  if (typeof newItem !== 'string' || newItem === 'trash') return false;
  if (newItem === 'cup_empty' || DRINK_INGREDIENTS.includes(newItem)) return false; // 飲料的東西只能進杯子
  if (currentItems.length >= PLATE_MAX_ITEMS) return false;
  const legacy = RECIPE_LIST.some((r) => !r.ingredients && [r.rawItem, r.cookedItem, r.platedItem].includes(newItem));
  return !legacy;
}

// 盤子上這包食材如果剛好等於某一份食譜(不多不少),回傳那份食譜——畫面上就會自動顯示成那道菜的成品。
// 盤子本身還是記著一樣一樣的食材,所以成品上面還可以繼續加料(例如熟牛肉再加生菜跟麵包變牛肉堡)。
// isCup:這包東西是裝在杯子裡(找飲料)還是盤子上(找餐點)。
function findRecipeByIngredients(items, isCup) {
  return RECIPE_LIST.find((r) => r.ingredients && isDrinkRecipe(r) === !!isCup && itemsMatchIngredients(items, r.ingredients)) || null;
}

// 杯子裡只能放飲料的材料,而且有順序:先放一個茶包(紅茶包或綠茶包擇一)-> 再倒熱水 -> 最後才能加牛奶。
// 空杯不能先倒熱水。
const TEA_BAGS = ['black_tea_bag', 'green_tea_bag'];
function canCupAccept(currentItems, newItem) {
  if (!DRINK_INGREDIENTS.includes(newItem) || currentItems.includes(newItem)) return false;
  const hasBag = currentItems.some((item) => TEA_BAGS.includes(item));
  if (TEA_BAGS.includes(newItem)) return !hasBag; // 一杯只放一個茶包
  if (newItem === 'hot_water') return hasBag;
  if (newItem === 'milk') return currentItems.includes('hot_water');
  return false;
}

// 手上的容器(盤子或杯子)放不放得下這樣東西。杯子在程式裡是「有 cup 記號的盤子」:{ isPlate: true, cup: true, items: [...] },
// 所以可以跟盤子一樣拿著、放在檯面上、用傳送口送,只是能裝的東西不一樣、畫出來是杯子。
function canContainerAccept(container, newItem) {
  return container.cup ? canCupAccept(container.items, newItem) : canPlateAccept(container.items, newItem);
}

const ITEM_EMOJI = {
  potato_raw: '🥔',
  fries_cooked: '🍟',
  fries_plated: '🍟',
  drink_ready: '🥤',
  trash: '💨',

  beef_raw: '🥩',
  chicken_raw: '🍗',
  beef_cooked: '🥩',
  chicken_cooked: '🍗',
  beef_burnt: '💀',
  chicken_burnt: '💀',
  tomato_raw: '🍅',
  tomato_sliced: '🍅',
  lettuce: '🥬',
  cheese: '🧀',
  bun: '🍞',

  burger_beef_cheese: '🍔',
  burger_beef: '🍔',
  burger_beef_tomato: '🍔',
  burger_chicken_cheese: '🍔',
  burger_chicken: '🍔',
  burger_chicken_tomato: '🍔',

  cup_empty: '🥛',
  hot_water: '♨️',
  black_tea_bag: '🟤',
  green_tea_bag: '🟢',
  milk: '🥛',
  black_tea: '🍵',
  green_tea: '🍵',
  milk_tea: '🧋',
  milk_green_tea: '🧋'
};

function itemEmoji(itemType) {
  return ITEM_EMOJI[itemType] || '❓';
}

// 食材/成品對應的圖片素材 key(preload() 裡載入時用同樣的 key)。
// 沒列在這裡的 itemType 會 fallback 用上面的 emoji 顯示。
const ITEM_IMAGE_KEYS = {
  beef_raw: 'item_beef_raw',
  chicken_raw: 'item_chicken_raw',
  beef_cooked: 'item_beef_cooked',
  chicken_cooked: 'item_chicken_cooked',
  beef_burnt: 'item_beef_burnt',
  chicken_burnt: 'item_chicken_burnt',
  tomato_raw: 'item_tomato_raw',
  tomato_sliced: 'item_tomato_sliced',
  lettuce: 'item_lettuce',
  cheese: 'item_cheese',
  bun: 'item_bun',

  burger_beef_cheese: 'item_burger_beef_cheese',
  burger_beef: 'item_burger_beef',
  burger_beef_tomato: 'item_burger_beef_tomato',
  burger_chicken_cheese: 'item_burger_chicken_cheese',
  burger_chicken: 'item_burger_chicken',
  burger_chicken_tomato: 'item_burger_chicken_tomato',

  cup_empty: 'item_cup_empty',
  hot_water: 'item_hot_water',
  black_tea_bag: 'item_black_tea_bag',
  green_tea_bag: 'item_green_tea_bag',
  milk: 'item_milk',
  black_tea: 'item_black_tea',
  green_tea: 'item_green_tea',
  milk_tea: 'item_milk_tea',
  milk_green_tea: 'item_milk_green_tea'
};

function itemImageKey(itemType) {
  return ITEM_IMAGE_KEYS[itemType] || null;
}
