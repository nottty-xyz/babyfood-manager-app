// js/planner.js
import { FOOD_MASTER } from "./foodMaster.js";

/**
 * 重要：
 * - ブロック在庫: 各食材 8ブロック
 * - blockSizeTsp: 1ブロックが何小さじか（カテゴリごとに設定）
 *   炭水化物を 1ブロック=小さじ10 にすると、食材種類数が爆増せず現実的に回ります。
 */
export const DEFAULT_CONFIG = {
  phase: "中期",
  days: ["月", "火", "水", "木", "金", "土", "日"],
  mealsPerDay: 2,

  // 1食あたり小さじターゲット
  tspPerMeal: {
    carb: 10,
    protein: { min: 2, max: 3 },
    mineral: { min: 4, max: 6 }
  },

  // 1ブロックが何小さじか
  blockSizeTsp: {
    carb: 10,      // ←おすすめ（主食キューブ）
    protein: 1,
    mineral: 1
  },

  // 各食材の在庫ブロック数（小さじ1×8ブロック、など）
  blocksPerIngredient: 8,

  // 1食で使う食材の「種類」上限（増やしすぎ防止）
  // ※足りないと割当不能になるので、状況に応じて自動で緩めるオプションもあり
  maxKindsPerMeal: {
    carb: 2,
    protein: 2,
    mineral: 3
  },

  // 割当できないとき、種類上限を自動で緩める（true推奨）
  autoRelaxMaxKinds: true,

  // 週内で同じ食材を連発しない軽いペナルティ
  avoidRepeat: true
};

/* ---------- ユーティリティ ---------- */

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function deepMerge(base, override) {
  if (!override) return clone(base);
  const out = clone(base);
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

function clampInt(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function tspToBlocks(tsp, blockSizeTsp) {
  return Math.ceil(tsp / blockSizeTsp);
}

function totalMeals(config) {
  return config.days.length * config.mealsPerDay;
}

/**
 * 1週間の各食に対して protein/mineral を範囲内で揺らす
 * 目的：在庫を使い切りやすくする & 単調になりにくい
 */
function mealTargets(config, mealIndex) {
  const protein = (mealIndex % 2 === 0) ? config.tspPerMeal.protein.min : config.tspPerMeal.protein.max;
  const mineralBase = (config.tspPerMeal.mineral.min + config.tspPerMeal.mineral.max) / 2; // 5
  const mineral = clampInt(
    Math.round(mineralBase + ((mealIndex % 3) - 1) * 0.5),
    config.tspPerMeal.mineral.min,
    config.tspPerMeal.mineral.max
  );
  return { carb: config.tspPerMeal.carb, protein, mineral };
}

function makeInventory(names, blocksPerIngredient) {
  return names.map(name => ({ name, remain: blocksPerIngredient }));
}

function sumRemain(inv) {
  return inv.reduce((s, x) => s + x.remain, 0);
}

/* ---------- 食材選定（不足しても止めない） ---------- */

function calcRequiredBlocksPerWeek(config) {
  const meals = totalMeals(config);
  const req = { carb: 0, protein: 0, mineral: 0 };
  for (let m = 0; m < meals; m++) {
    const t = mealTargets(config, m);
    req.carb += tspToBlocks(t.carb, config.blockSizeTsp.carb);
    req.protein += tspToBlocks(t.protein, config.blockSizeTsp.protein);
    req.mineral += tspToBlocks(t.mineral, config.blockSizeTsp.mineral);
  }
  return req;
}

function neededKinds(requiredBlocks, blocksPerIngredient) {
  return Math.ceil(requiredBlocks / blocksPerIngredient);
}

/**
 * master から「必要種類数」だけ取る。足りない場合は不足を返す（throwしない）。
 */
function chooseNames(masterList, needKinds) {
  const available = masterList.length;
  const take = Math.min(available, needKinds);
  return {
    chosen: masterList.slice(0, take),
    shortage: Math.max(0, needKinds - available)
  };
}

/* ---------- 割当ロジック（割当不能でも止めない） ---------- */

/**
 * 直近に使った食材を避けるための軽いスコア
 */
function scoreItem(item, recentlyUsedSet, avoidRepeat) {
  let s = item.remain; // 在庫多いほど使う
  if (avoidRepeat && recentlyUsedSet.has(item.name)) s -= 1000; // 強ペナルティ
  return s;
}

/**
 * 1食分の割当
 * - 在庫(remain)があるものから blocksNeeded を満たす
 * - maxKinds で種類数を制限
 * - autoRelaxMaxKinds=true なら、足りない時に上限を段階的に緩める
 */
function allocate(inv, blocksNeeded, maxKinds, opts) {
  const { recentlyUsedSet, avoidRepeat, autoRelaxMaxKinds } = opts;

  let kindsLimit = maxKinds;
  for (;;) {
    let remainNeed = blocksNeeded;
    const picks = [];

    // スコア順（在庫多い＆直近回避）
    const sorted = [...inv]
      .filter(x => x.remain > 0)
      .sort((a, b) => scoreItem(b, recentlyUsedSet, avoidRepeat) - scoreItem(a, recentlyUsedSet, avoidRepeat));

    for (const item of sorted) {
      if (remainNeed <= 0) break;
      if (picks.length >= kindsLimit) break;

      const use = Math.min(item.remain, remainNeed);
      if (use > 0) {
        item.remain -= use;
        picks.push({ name: item.name, blocks: use });
        remainNeed -= use;
      }
    }

    if (remainNeed <= 0) {
      return { ok: true, picks, usedKindsLimit: kindsLimit };
    }

    // 失敗：種類上限を緩めるか、諦める
    if (autoRelaxMaxKinds && kindsLimit < inv.length) {
      kindsLimit += 1;
      continue;
    }

    // 元に戻す（この試行で減らした分を戻す）
    for (const p of picks) {
      const it = inv.find(x => x.name === p.name);
      if (it) it.remain += p.blocks;
    }

    return {
      ok: false,
      picks: [],
      usedKindsLimit: kindsLimit,
      reason: `割当不能：blocksNeeded=${blocksNeeded} を満たせません（maxKinds=${kindsLimit} / 在庫合計=${sumRemain(inv)}）。`
    };
  }
}

/* ---------- メニュー名生成（それっぽく） ---------- */

function menuName(carbPicks, proteinPicks, mineralPicks, phase) {
  const carb = carbPicks[0]?.name ?? "ごはん";
  const p1 = proteinPicks[0]?.name ?? "豆腐";
  const vegs = mineralPicks.slice(0, 2).map(x => x.name);
  const v = vegs.length ? vegs.join("と") : "野菜";

  // フェーズで語尾を少し変える（初期は「とろとろ」多め）
  const base = (phase === "初期")
    ? [
        `${p1}と${v}のとろとろ${carb}`,
        `${v}入り${p1}のなめらか${carb}`,
        `${p1}と${v}のやさしい${carb}がゆ`
      ]
    : [
        `${p1}と${v}の${carb}がゆ`,
        `${p1}と${v}の和風あんかけ${carb}`,
        `${v}入り${p1}の${carb}リゾット風`,
        `${p1}と${v}の${carb}煮込み`,
        `${p1}と${v}の${carb}まぜごはん風`
      ];

  const key = (carb.length + p1.length + v.length) % base.length;
  return base[key];
}

/* ---------- メイン ---------- */

export function generateWeeklyPlan(customConfig = {}) {
  const config = deepMerge(DEFAULT_CONFIG, customConfig);

  const master = FOOD_MASTER[config.phase];
  if (!master) {
    return {
      ok: false,
      config,
      errors: [`未知のフェーズ: ${config.phase}`],
      plan: []
    };
  }

  const errors = [];
  const warnings = [];

  const requiredBlocks = calcRequiredBlocksPerWeek(config);

  // 必要種類数を計算
  const needKinds = {
    carb: neededKinds(requiredBlocks.carb, config.blocksPerIngredient),
    protein: neededKinds(requiredBlocks.protein, config.blocksPerIngredient),
    mineral: neededKinds(requiredBlocks.mineral, config.blocksPerIngredient)
  };

  // 選定（不足しても止めない）
  const carbSel = chooseNames(master.carb, needKinds.carb);
  const proSel = chooseNames(master.protein, needKinds.protein);
  const minSel = chooseNames(master.mineral, needKinds.mineral);

  const shortages = {
    carb: carbSel.shortage,
    protein: proSel.shortage,
    mineral: minSel.shortage
  };

  if (shortages.carb > 0) warnings.push(`炭水化物がマスタ不足：あと ${shortages.carb} 種類必要`);
  if (shortages.protein > 0) warnings.push(`タンパク質がマスタ不足：あと ${shortages.protein} 種類必要`);
  if (shortages.mineral > 0) warnings.push(`ミネラルがマスタ不足：あと ${shortages.mineral} 種類必要`);

  // 在庫生成
  const inv = {
    carb: makeInventory(carbSel.chosen, config.blocksPerIngredient),
    protein: makeInventory(proSel.chosen, config.blocksPerIngredient),
    mineral: makeInventory(minSel.chosen, config.blocksPerIngredient)
  };

  // もし不足があって在庫合計が必要量に届かないカテゴリがあれば警告
  if (sumRemain(inv.carb) < requiredBlocks.carb) warnings.push("炭水化物在庫が週必要量に足りません（献立が埋まらない可能性）");
  if (sumRemain(inv.protein) < requiredBlocks.protein) warnings.push("タンパク質在庫が週必要量に足りません（献立が埋まらない可能性）");
  if (sumRemain(inv.mineral) < requiredBlocks.mineral) warnings.push("ミネラル在庫が週必要量に足りません（献立が埋まらない可能性）");

  const plan = [];
  const meals = totalMeals(config);

  // 直近回避用（カテゴリ別に直近1食分だけ避ける）
  let recent = {
    carb: new Set(),
    protein: new Set(),
    mineral: new Set()
  };

  let mealIndex = 0;
  for (const day of config.days) {
    for (let mealNo = 1; mealNo <= config.mealsPerDay; mealNo++) {
      const t = mealTargets(config, mealIndex);

      const need = {
        carb: tspToBlocks(t.carb, config.blockSizeTsp.carb),
        protein: tspToBlocks(t.protein, config.blockSizeTsp.protein),
        mineral: tspToBlocks(t.mineral, config.blockSizeTsp.mineral)
      };

      // 割当
      const carbAlloc = allocate(inv.carb, need.carb, config.maxKindsPerMeal.carb, {
        recentlyUsedSet: recent.carb,
        avoidRepeat: config.avoidRepeat,
        autoRelaxMaxKinds: config.autoRelaxMaxKinds
      });

      const proAlloc = allocate(inv.protein, need.protein, config.maxKindsPerMeal.protein, {
        recentlyUsedSet: recent.protein,
        avoidRepeat: config.avoidRepeat,
        autoRelaxMaxKinds: config.autoRelaxMaxKinds
      });

      const minAlloc = allocate(inv.mineral, need.mineral, config.maxKindsPerMeal.mineral, {
        recentlyUsedSet: recent.mineral,
        avoidRepeat: config.avoidRepeat,
        autoRelaxMaxKinds: config.autoRelaxMaxKinds
      });

      // 失敗がある場合も plan は埋める（ok=false で理由を書いておく）
      const ok = carbAlloc.ok && proAlloc.ok && minAlloc.ok;
      if (!carbAlloc.ok) warnings.push(`[${day}${mealNo}食] 炭水化物: ${carbAlloc.reason}`);
      if (!proAlloc.ok) warnings.push(`[${day}${mealNo}食] タンパク質: ${proAlloc.reason}`);
      if (!minAlloc.ok) warnings.push(`[${day}${mealNo}食] ミネラル: ${minAlloc.reason}`);

      const name = menuName(carbAlloc.picks, proAlloc.picks, minAlloc.picks, config.phase);

      plan.push({
        day,
        meal: mealNo,
        ok,
        menuName: name,
        targetsTsp: t,
        blocks: {
          carb: carbAlloc.picks,
          protein: proAlloc.picks,
          mineral: minAlloc.picks
        },
        tsp: {
          carb: carbAlloc.picks.reduce((s, x) => s + x.blocks * config.blockSizeTsp.carb, 0),
          protein: proAlloc.picks.reduce((s, x) => s + x.blocks * config.blockSizeTsp.protein, 0),
          mineral: minAlloc.picks.reduce((s, x) => s + x.blocks * config.blockSizeTsp.mineral, 0)
        },
        usedKindsLimit: {
          carb: carbAlloc.usedKindsLimit,
          protein: proAlloc.usedKindsLimit,
          mineral: minAlloc.usedKindsLimit
        }
      });

      // recent を更新（この食で使ったものを “次の食では避ける”）
      recent = {
        carb: new Set(carbAlloc.picks.map(x => x.name)),
        protein: new Set(proAlloc.picks.map(x => x.name)),
        mineral: new Set(minAlloc.picks.map(x => x.name))
      };

      mealIndex++;
      if (mealIndex >= meals) break;
    }
  }

  // leftovers
  const leftovers = {
    carb: inv.carb.map(x => ({ name: x.name, remainBlocks: x.remain })).filter(x => x.remainBlocks > 0),
    protein: inv.protein.map(x => ({ name: x.name, remainBlocks: x.remain })).filter(x => x.remainBlocks > 0),
    mineral: inv.mineral.map(x => ({ name: x.name, remainBlocks: x.remain })).filter(x => x.remainBlocks > 0)
  };

  // 「できるだけ使い切り」評価
  const used = {
    carb: requiredBlocks.carb - Math.max(0, requiredBlocks.carb - (config.blocksPerIngredient * carbSel.chosen.length - sumRemain(inv.carb))),
    protein: requiredBlocks.protein - Math.max(0, requiredBlocks.protein - (config.blocksPerIngredient * proSel.chosen.length - sumRemain(inv.protein))),
    mineral: requiredBlocks.mineral - Math.max(0, requiredBlocks.mineral - (config.blocksPerIngredient * minSel.chosen.length - sumRemain(inv.mineral)))
  };

  return {
    ok: errors.length === 0,
    config,
    requiredBlocksPerWeek: requiredBlocks,
    needKinds,
    chosenFoods: {
      carb: carbSel.chosen,
      protein: proSel.chosen,
      mineral: minSel.chosen
    },
    shortages,
    plan,
    leftovers,
    warnings,
    errors,
    tips: [
      "献立が埋まらない/食材種類が増えすぎる場合：blockSizeTsp の見直しが効果的です（特に carb）。",
      "maxKindsPerMeal が厳しいと割当不能になります。autoRelaxMaxKinds=true で自動緩和します。",
      "調味料や油は foodMaster.js の extras に分けてあります（配分計算に含めません）。"
    ]
  };
}