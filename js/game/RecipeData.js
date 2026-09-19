// 本關可用的菜色定義。之後要加菜色/改關卡,只需要改這份資料,不用動邏輯程式碼。
//
// V2.3 新增了「組合類」食譜(漢堡):一份成品需要好幾種食材湊在一起,
// 不像薯條/飲料那樣單一食材就能做完。組合順序不重要,但必須「一路上」
// 都還對得上某一份食譜才准許放上去(比如生牛肉不能加起士,因為所有食譜
// 都只認「熟」牛肉,生牛肉本身就不會出現在任何食譜清單裡)。

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

  burger_beef_cheese: { id: 'burger_beef_cheese', name: '牛肉吉士堡', platedItem: 'burger_beef_cheese', ingredients: ['beef_cooked', 'cheese', 'lettuce', 'bun'] },
  burger_beef: { id: 'burger_beef', name: '牛肉堡', platedItem: 'burger_beef', ingredients: ['beef_cooked', 'lettuce', 'bun'] },
  burger_beef_tomato: { id: 'burger_beef_tomato', name: '牛肉番茄堡', platedItem: 'burger_beef_tomato', ingredients: ['beef_cooked', 'lettuce', 'tomato_sliced', 'bun'] },
  burger_chicken_cheese: { id: 'burger_chicken_cheese', name: '雞肉吉士堡', platedItem: 'burger_chicken_cheese', ingredients: ['chicken_cooked', 'cheese', 'lettuce', 'bun'] },
  burger_chicken: { id: 'burger_chicken', name: '雞肉堡', platedItem: 'burger_chicken', ingredients: ['chicken_cooked', 'lettuce', 'bun'] },
  burger_chicken_tomato: { id: 'burger_chicken_tomato', name: '雞肉番茄堡', platedItem: 'burger_chicken_tomato', ingredients: ['chicken_cooked', 'lettuce', 'tomato_sliced', 'bun'] }
};

const RECIPE_LIST = Object.values(RECIPES);

// 每一關可以出的訂單種類。沒列在這裡的關卡先沿用預設(薯條+飲料),
// 之後要客製化其他關卡的菜色,在這裡加一筆對應的關卡編號就好。
const LEVEL_RECIPE_IDS = {
  1: ['burger_beef_cheese', 'burger_beef', 'burger_beef_tomato', 'burger_chicken_cheese', 'burger_chicken', 'burger_chicken_tomato'],
  default: ['fries', 'drink']
};

function getLevelRecipeIds(level) {
  return LEVEL_RECIPE_IDS[level] || LEVEL_RECIPE_IDS.default;
}

// 平底鍋:生食 -> 煮熟,煮好放太久 -> 燒焦。哪個生食對應哪組時間/成品,查這裡。
const COOK_RECIPES = {
  beef_raw: { cookedItem: 'beef_cooked', burntItem: 'beef_burnt', cookTimeMs: 6000, burnAfterMs: 6000 },
  chicken_raw: { cookedItem: 'chicken_cooked', burntItem: 'chicken_burnt', cookTimeMs: 6000, burnAfterMs: 6000 }
};

// 鉆板:切生食材。目前只有番茄需要切。
const CUT_RECIPES = {
  tomato_raw: { cutItem: 'tomato_sliced', cutTimeMs: 3000 }
};

function getRecipe(id) {
  return RECIPES[id] || null;
}

function getRecipeByPlatedItem(itemType) {
  return RECIPE_LIST.find((r) => r.platedItem === itemType) || null;
}

function getRecipeByRawItem(itemType) {
  return RECIPE_LIST.find((r) => r.rawItem === itemType) || null;
}

function getRecipeByCookedItem(itemType) {
  return RECIPE_LIST.find((r) => r.cookedItem === itemType) || null;
}

// 給一組食材(順序不重要),找出「完全符合」的組合類食譜(缺一樣或多一樣都不算)。
function findDishByIngredients(items) {
  const sorted = [...items].sort();
  return RECIPE_LIST.find((r) => {
    if (!r.ingredients) return false;
    const need = [...r.ingredients].sort();
    return need.length === sorted.length && need.every((v, i) => v === sorted[i]);
  }) || null;
}

// 目前這組食材(還沒放新的這樣之前)+ 要新加進去的這一樣,加了之後是不是還「有機會」
// 湊出某一份組合類食譜(也就是新食材必須是某份食譜還缺的東西之一)。
// 這就是「生牛肉不能跟起士放在一起」的規則來源:因為所有食譜的食材清單裡都只有
// 熟牛肉、沒有生牛肉,生牛肉不管跟什麼放在一起都不會符合任何食譜,一律擋下。
function canAddIngredientToPlate(currentItems, newItem) {
  const next = [...currentItems, newItem].sort();
  return RECIPE_LIST.some((r) => {
    if (!r.ingredients) return false;
    const need = [...r.ingredients].sort();
    if (next.length > need.length) return false;
    // next 必須是 need 的子多重集合(每個元素出現次數都不超過need)
    const needCopy = [...need];
    return next.every((item) => {
      const idx = needCopy.indexOf(item);
      if (idx === -1) return false;
      needCopy.splice(idx, 1);
      return true;
    });
  });
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
  burger_chicken_tomato: '🍔'
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
  burger_chicken_tomato: 'item_burger_chicken_tomato'
};

function itemImageKey(itemType) {
  return ITEM_IMAGE_KEYS[itemType] || null;
}
