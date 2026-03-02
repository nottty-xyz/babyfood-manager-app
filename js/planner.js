// js/planner.js
// v17  (shortageBlocks 未定義エラー修正 + 仕様まとめ)
//
// ✅ 同日 1回目/2回目でなるべく同じものを使わない
// - 炭水化物は許容（重複OK）
// - 野菜ミックス/果物ミックスは許容（重複OK）
// - タンパクは重複を避ける（足りなければ戻す）
// - ミネラル単品は重複を避ける（足りなければ戻す）
//
// ✅ 固定ブロック
// - 炭水化物: 1ブロック=小さじ10
// - タンパク: 1ブロック=小さじ1
// - ミネラル単品: 1ブロック=小さじ1
// - 野菜ミックス: 1ブロック=小さじ3
// - 果物ミックス: 1ブロック=小さじ2
//
// ✅ 新食材の数え方
// - 平日1回目にだけ “新初回(小さじ1)” を1つ導入（その食で(新初回)は必ず1つだけ）
// - 導入されるまでは在庫割当で出ない（初回が飛ばされない）
// - 導入後は在庫割当で出てOK、表示は(新2回目以降)
// - 初回の食では同じ新食材を追加で使わない（同カテゴリから除外）
//
// ✅ ミネラル
// - ミックスはチェック在庫のみで固定（新食材は混ぜない）
// - 単品を優先消費するが、単品だけで枠を埋めない（偏り防止）
//
// ✅ 返却：picks は {name,tsp,blocks}
// ✅ leftovers は UI向けに {name, remainBlocks} で返す
// ✅ shortageBlocks を必ず定義して返す（エラー修正）

export const DEFAULT_CONFIG = {
  phase: "中期",
  days: ["月","火","水","木","金","土","日"],
  mealsPerDay: 2,

  tspPerMeal: {
    carb: 10,
    protein: { min: 2, max: 3 },
    mineral: { min: 4, max: 6 }
  },

  blocksPerIngredient: 8,

  tspPerBlock: {
    carb: 10,
    protein: 1,
    mineralSingle: 1,
    vegMix: 3,
    fruitMix: 2
  },

  mineralVegBaseTsp: 4,

  mineralSinglesPolicy: {
    maxSingleShare: 0.5,
    minMixTsp: 2
  }
};

function isWeekdayJP(day){ return ["月","火","水","木","金"].includes(day); }
function clampInt(n, min, max){ return Math.max(min, Math.min(max, n)); }

function mealTargets(cfg, i){
  const protein = (i % 2 === 0) ? cfg.tspPerMeal.protein.min : cfg.tspPerMeal.protein.max;

  const base = (cfg.tspPerMeal.mineral.min + cfg.tspPerMeal.mineral.max) / 2; // 5
  const mineral = clampInt(
    Math.round(base + ((i % 3) - 1) * 0.5),
    cfg.tspPerMeal.mineral.min,
    cfg.tspPerMeal.mineral.max
  );

  return { carb: cfg.tspPerMeal.carb, protein, mineral };
}

// ===== 果物判定 =====
const FRUITS = new Set([
  "りんご","いちご