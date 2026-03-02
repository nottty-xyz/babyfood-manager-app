// planner.js
import { FOOD_MASTER } from "./foodMaster.js";

/**
 * 設定（あなたのルールをここで固定）
 * - tspPerMeal: 1食あたりの必要小さじ合計
 * - blockSizeTsp: 1ブロックが何小さじか（カテゴリごとに調整可能）
 * - blocksPerIngredient: 1食材あたりの在庫ブロック数（=8）
 */
export const DEFAULT_CONFIG = {
  phase: "中期",
  days: ["月", "火", "水", "木", "金", "土", "日"],
  mealsPerDay: 2,

  tspPerMeal: {
    carb: 10,
    protein: { min: 2, max: 3 }, // 2〜3
    mineral: { min: 4, max: 6 }  // 4〜6
  },

  // ★ここが超重要：
  // もし「炭水化物も小さじ1キューブ」なら blockSizeTsp.carb=1 だが、
  // その場合は炭水化物が週140ブロック必要になり、食材数が爆増する。
  // 現実運用なら炭水化物は「主食キューブ=小さじ10」などにして回すのが自然。
  blockSizeTsp: {
    carb: 10,     // ←おすすめ：主食キューブ1個=小さじ10
    protein: 1,   // 1個=小さじ1
    mineral: 1    // 1個=小さじ1
  },

  blocksPerIngredient: 8,

  // 1食で使う食材の種類数の上限（増やしすぎ防止）
  maxKindsPerMeal: {
    carb: 2,
    protein: 2,
    mineral: 3
  }
};

/**
 * それっぽいメニュー名を作る（和風/洋風っぽい語尾）
 */
function menuName(carbNames, proteinNames, mineralNames) {
  const carb = carbNames[0] ?? "ごはん";
  const p = proteinNames[0] ?? "豆腐";
  const v = mineralNames.slice(0, 2).join("と") || "野菜";

  const styles = [
    `${p}と${v}の${carb}がゆ`,
    `${p}と${v}の和風あんかけ${carb}`,
    `${v}入り${p}のとろとろ${carb}`,
    `${p}と${v}の${carb}リゾット風`,
    `${p}と${v}の${carb}煮込み`
  ];
  // ほどよく固定感（ランダム過ぎない）
  const idx = (carb.length + p.length + v.length) % styles.length;
  return styles[idx];
}

function clampInt(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * 週の各食で「たんぱく/ミネラル」を 2,3 / 4..6 の範囲でブレさせる
 * （在庫を使い切りやすくするため）
 */
function mealTargets(config, mealIndex) {
  // mealIndex: 0..13
  const protein = (mealIndex % 2 === 0) ? config.tspPerMeal.protein.min : config.tspPerMeal.protein.max; // 2,3,2,3...
  const mineralBase = (config.tspPerMeal.mineral.min + config.tspPerMeal.mineral.max) / 2; // 5
  const mineral = clampInt(Math.round(mineralBase + ((mealIndex % 3) - 1) * 0.5), config.tspPerMeal.mineral.min, config.tspPerMeal.mineral.max);
  return {
    carb: config.tspPerMeal.carb,
    protein,
    mineral
  };
}

/**
 * 必要ブロック数 = 必要小さじ / blockSizeTsp
 * 端数は切り上げ（ブロックは割れない想定）
 */
function tspToBlocks(tsp, blockSizeTsp) {
  return Math.ceil(tsp / blockSizeTsp);
}

function makeInventory(foods, blocksPerIngredient) {
  return foods.map(name => ({ name, remain: blocksPerIngredient }));
}

function totalBlocks(inventory) {
  return inventory.reduce((s, x) => s + x.remain, 0);
}

/**
 * フェーズの候補から、必要ブロック総量を満たすだけ食材を選ぶ。
 * 「余りゼロで使い切り」は、必要量が8の倍数でないと不可能なので、
 * ここでは "不足しない＆余り最小" を目指す。
 */
function pickFoodsForCategory(phaseFoods, requiredBlocks, blocksPerIngredient) {
  const needKinds = Math.ceil(requiredBlocks / blocksPerIngredient);
  if (phaseFoods.length < needKinds) {
    throw new Error(
      `食材マスタが不足：必要=${needKinds}種類 / マスタ=${phaseFoods.length}種類。` +
      `（requiredBlocks=${requiredBlocks} blocks）`
    );
  }
  return phaseFoods.slice(0, needKinds);
}

/**
 * 1食分のブロック割当（在庫から消費）
 * - できるだけ少ない種類で
 * - 在庫が多いものから使う（偏りを減らす）
 */
function allocateFromInventory(inventory, blocksNeeded, maxKinds) {
  const picks = [];
  let remain = blocksNeeded;

  // 在庫が多い順
  const sorted = [...inventory].sort((a, b) => b.remain - a.remain);

  for (const item of sorted) {
    if (remain <= 0) break;
    if (item.remain <= 0) continue;
    if (picks.length >= maxKinds) break;

    const use = Math.min(item.remain, remain);
    if (use > 0) {
      item.remain -= use;
      picks.push({ name: item.name, blocks: use });
      remain -= use;
    }
  }

  // maxKindsに引っかかって足りない場合：残在庫から追加で取る（種類制限を緩めず、同一種類を増やせないので）
  // → ここは設計上の限界。足りないなら maxKinds を増やすべき。
  if (remain > 0) {
    throw new Error(
      `割当失敗：blocksNeeded=${blocksNeeded} だが remain=${remain}。` +
      ` maxKinds=${maxKinds} が厳しすぎる可能性。`
    );
  }

  return picks;
}

/**
 * 週次献立生成
 */
export function generateWeeklyPlan(customConfig = {}) {
  const config = deepMerge(DEFAULT_CONFIG, customConfig);

  const phaseMaster = FOOD_MASTER[config.phase];
  if (!phaseMaster) throw new Error(`未知のフェーズ: ${config.phase}`);

  const totalMeals = config.days.length * config.mealsPerDay;

  // 週で必要なブロック総数を計算
  let required = { carb: 0, protein: 0, mineral: 0 };
  for (let m = 0; m < totalMeals; m++) {
    const t = mealTargets(config, m);
    required.carb += tspToBlocks(t.carb, config.blockSizeTsp.carb);
    required.protein += tspToBlocks(t.protein, config.blockSizeTsp.protein);
    required.mineral += tspToBlocks(t.mineral, config.blockSizeTsp.mineral);
  }

  // 必要量を満たすだけ食材を選定（マスタ先頭から取る＝安定）
  const chosen = {
    carb: pickFoodsForCategory(phaseMaster.carb, required.carb, config.blocksPerIngredient),
    protein: pickFoodsForCategory(phaseMaster.protein, required.protein, config.blocksPerIngredient),
    mineral: pickFoodsForCategory(phaseMaster.mineral, required.mineral, config.blocksPerIngredient)
  };

  // 在庫生成
  const inv = {
    carb: makeInventory(chosen.carb, config.blocksPerIngredient),
    protein: makeInventory(chosen.protein, config.blocksPerIngredient),
    mineral: makeInventory(chosen.mineral, config.blocksPerIngredient)
  };

  // 週の献立
  const plan = [];

  let mealIndex = 0;
  for (const day of config.days) {
    for (let mealNo = 1; mealNo <= config.mealsPerDay; mealNo++) {
      const t = mealTargets(config, mealIndex);

      const carbBlocks = tspToBlocks(t.carb, config.blockSizeTsp.carb);
      const proteinBlocks = tspToBlocks(t.protein, config.blockSizeTsp.protein);
      const mineralBlocks = tspToBlocks(t.mineral, config.blockSizeTsp.mineral);

      const carb = allocateFromInventory(inv.carb, carbBlocks, config.maxKindsPerMeal.carb);
      const protein = allocateFromInventory(inv.protein, proteinBlocks, config.maxKindsPerMeal.protein);
      const mineral = allocateFromInventory(inv.mineral, mineralBlocks, config.maxKindsPerMeal.mineral);

      const name = menuName(
        carb.map(x => x.name),
        protein.map(x => x.name),
        mineral.map(x => x.name)
      );

      plan.push({
        day,
        meal: mealNo,
        menuName: name,
        targetsTsp: t,
        blocks: {
          carb,
          protein,
          mineral
        },
        // 表示用：小さじ換算（ブロック数×ブロックサイズ）
        tsp: {
          carb: carb.reduce((s, x) => s + x.blocks * config.blockSizeTsp.carb, 0),
          protein: protein.reduce((s, x) => s + x.blocks * config.blockSizeTsp.protein, 0),
          mineral: mineral.reduce((s, x) => s + x.blocks * config.blockSizeTsp.mineral, 0)
        }
      });

      mealIndex++;
    }
  }

  // 余り在庫
  const leftovers = {
    carb: inv.carb.filter(x => x.remain > 0),
    protein: inv.protein.filter(x => x.remain > 0),
    mineral: inv.mineral.filter(x => x.remain > 0)
  };

  return {
    config,
    requiredBlocks: required,
    chosenFoods: chosen,
    plan,
    leftovers,
    notes: [
      "leftovers が空でない場合：必要量が8の倍数でない/ブロックサイズ設定の影響で完全消費できていません。",
      "炭水化物を 1ブロック=小さじ10 にすると、現実的な食材数で回せます。"
    ]
  };
}

/** 簡易deep merge */
function deepMerge(base, override) {
  if (!override) return structuredClone(base);
  const out = structuredClone(base);
  const stack = [{ a: out, b: override }];

  while (stack.length) {
    const { a, b } = stack.pop();
    for (const k of Object.keys(b)) {
      const bv = b[k];
      const av = a[k];
      if (bv && typeof bv === "object" && !Array.isArray(bv) && av && typeof av === "object" && !Array.isArray(av)) {
        stack.push({ a: av, b: bv });
      } else {
        a[k] = bv;
      }
    }
  }
  return out;
}