// 本關可用的菜色定義。之後要加菜色/改關卡,只需要改這份資料,不用動邏輯程式碼。

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
  }
};

const RECIPE_LIST = Object.values(RECIPES);

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

const ITEM_EMOJI = {
  potato_raw: '🥔',
  fries_cooked: '🍟',
  fries_plated: '🍟',
  drink_ready: '🥤',
  trash: '💨'
};

function itemEmoji(itemType) {
  return ITEM_EMOJI[itemType] || '❓';
}
