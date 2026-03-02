// js/planner.js
// 完全整理版 v4
// ✅ 新食材は「初回（平日1回目）」は必ず小さじ1のみ
// ✅ 初回の不足分は同カテゴリの他食材で補う（初回は新食材を追加で使わない）
// ✅ 新食材は在庫8ブロックとして追加 → 2回目以降は通常在庫として消費（週内で使い切りやすい）
// ✅ ミネラルは「野菜ミックス(最大3種)」「果物ミックス(最大2種)」固定で週内同じものを使う
// ✅ ただし「ミネラル新食材」はミックスに入れない：初回は小さじ1で単独表示、残りはミックスで補う
// ✅ 不足は「実際に埋められなかった量」だけ（余りがあるのに不足は出ない）

export const DEFAULT_CONFIG = {
  phase: "中期",
  days: ["月","火","水","木","金","土","日"],
  mealsPerDay: 2,

  tspPerMeal: {
    carb: 10,
    protein: { min: 2, max: 3 },
    mineral: { min: 4, max: 6 }
  },

  // 1ブロックが何小さじか
  blockSizeTsp: {
    carb: 10,
    protein: 1,
    mineral: 1
  },

  // 1食材あたりの冷凍在庫（ブロック数）
  blocksPerIngredient: 8,

  // ミネラル（合計）のうち、まず野菜側で使いたい量（残りを果物へ）
  mineralVegBase: 4
};

function tspToBlocks(tsp, size){ return Math.ceil(tsp / size); }
function clampInt(n,min,max){ return Math.max(min, Math.min(max,n)); }
function isWeekdayJP(day){ return ["月","火","水","