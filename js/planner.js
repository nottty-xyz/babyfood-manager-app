// js/planner.js
// - 在庫（チェックした食材×8ブロック）で1週間(7日×2回食)を組む
// - 平日1回目だけ新食材(小さじ1)
// - ミネラルは「野菜ミックス(最大3種)」「果物ミックス(最大2種)」にして1週間同じミックスを使う
// - ★不足は「実際に埋められなかった欠損量」で出す（余りがあるのに不足を出さない）
// - ★ミネラルは野菜/果物のどちらかが足りなくても、もう片方の余りで合計を埋める（合計が足りるなら不足にしない）

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
  // 現状：炭水化物は10小さじ=1ブロック / タンパク&ミネラルは1小さじ=1ブロック
  blockSizeTsp: {
    carb: 10,
    protein: 1,
    mineral: 1
  },

  blocksPerIngredient: 8,

  maxKindsPerMeal: {
    carb: 2,
    protein: 2
  },

  // ミネラル配分（合計=mineral）
  mineralSplit: {
    vegTspBase: 4
  },

  // 在庫が足りるなら「種類制限」で不足にしない（必要なら全部使う）
  autoRelaxMaxKinds: true,

  // 連続同じ食材を避ける（不足防止のため、在庫が足りる限りは回避、足りないなら使う）
  avoidRepeat: true
};

function clone(obj){ return JSON.parse(JSON.stringify(obj)); }

function deepMerge(base, override){
  if(!override) return clone(base);
  const out = clone(base);
  const stack = [{a: out, b: override}];
  while(stack.length){
    const {a,b} = stack.pop();
    for(const k of Object.keys(b)){
      const bv = b[k], av = a[k];
      if(bv && typeof bv==="object" && !Array.isArray(bv) && av && typeof av==="object" && !Array.isArray(av)){
        stack.push({a: av, b: bv});
      }else{
        a[k] = bv;
      }
    }
  }
  return out;
}

function clampInt(n,min,max){ return Math.max(min, Math.min(max,n)); }
function tspToBlocks(tsp, blockSize){ return Math.ceil(tsp / blockSize); }
function totalMeals(cfg){ return cfg.days.length * cfg.mealsPerDay; }

function mealTargets(cfg, mealIndex){
  const protein = (mealIndex % 2 === 0) ? cfg.tspPerMeal.protein.min : cfg.tspPerMeal.protein.max;

  const mineralBase = (cfg.tspPerMeal.mineral.min + cfg.tspPerMeal.mineral.max) / 2; // 5
  const mineral = clampInt(
    Math.round(mineralBase + ((mealIndex % 3) - 1) * 0.5),
    cfg.tspPerMeal.mineral.min,
    cfg.tspPerMeal.mineral.max
  );

  return { carb: cfg.tspPerMeal.carb, protein, mineral };
}

function isWeekdayJP(day){ return ["月","火","水","木","金"].includes(day); }

function makeInventoryFromOverride(list, blocksDefault){
  return (list||[]).map(x=>({
    name: x.name,
    remain: Number.isFinite(+x.blocks) ? +x.blocks : blocksDefault
  }));
}

function scoreItem(item, recentlyUsedSet, avoidRepeat){
  let s = item.remain;
  if(avoidRepeat && recentlyUsedSet.has(item.name)) s -= 1000;
  return s;
}

// ★「足りるなら全部使って埋める」割当（不足があるなら partial で返す）
function allocateUpTo(inv, blocksNeeded, maxKinds, opts){
  const { recentlyUsedSet, avoidRepeat, autoRelaxMaxKinds } = opts;
  const kindsLimit = autoRelaxMaxKinds ? inv.filter(x=>x.remain>0).length : maxKinds;

  let need = blocksNeeded;
  const picks = [];

  const sorted = [...inv]
    .filter(x=>x.remain>0)
    .sort((a,b)=> scoreItem(b,recentlyUsedSet,avoidRepeat) - scoreItem(a,recentlyUsedSet,avoidRepeat));

  for(const item of sorted){
    if(need<=0) break;
    if(picks.length >= kindsLimit) break;

    const use = Math.min(item.remain, need);
    if(use>0){
      item.remain -= use;
      picks.push({ name:item.name, blocks:use });
      need -= use;
    }
  }

  return { picks, missing: need }; // missing=0なら埋まった
}

function menuName(carbPicks, proteinPicks, mineralPicks, phase){
  const carb = carbPicks[0]?.name ?? "ごはん";
  const p1 = proteinPicks[0]?.name ?? "豆腐";

  const vegMix = mineralPicks.find(x=>String(x.name||"").startsWith("野菜ミックス"))?.name || "野菜ミックス";
  const fruitMix = mineralPicks.find(x=>String(x.name||"").startsWith("果物ミックス"))?.name || "";

  const base = (phase==="初期")
    ? [
      `${p1}と${vegMix}のとろとろ${carb}`,
      `${vegMix}入り${p1}のなめらか${carb}`,
      `${p1}と${vegMix}のやさしい${carb}がゆ`
    ]
    : [
      `${p1}と${vegMix}の${carb}がゆ`,
      `${p1}と${vegMix}の和風あんかけ${carb}`,
      `${vegMix}入り${p1}の${carb}リゾット風`,
      `${p1}と${vegMix}の${carb}煮込み`,
      `${p1}と${vegMix}の${carb}まぜごはん風`
    ];

  const key = (carb.length + p1.length + vegMix.length + fruitMix.length) % base.length;
  return base[key];
}

// ===== ミネラル：果物判定 =====
const FRUITS = new Set([
  "りんご","いちご","メロン","バナナ","すいか","梨","みかん","桃",
  "キウイ","ぶどう",
  "グレープフルーツ","アボカド","ブルーベリー","ラズベリー",
  "パイン"
]);

function isFruit(name){ return FRUITS.has(name); }

// ミネラル在庫（個別食材）→ ミックス2アイテムに圧縮（1週間固定）
function buildMineralMixInventory(mineralInv, cfg){
  const veg = [];
  const fruit = [];
  for(const it of mineralInv){
    (isFruit(it.name) ? fruit : veg).push(it);
  }

  const byRemainDesc = (a,b)=> b.remain - a.remain;

  const vegNames = [...veg].sort(byRemainDesc).slice(0,3).map(x=>x.name);
  const fruitNames = [...fruit].sort(byRemainDesc).slice(0,2).map(x=>x.name);

  const vegSum = veg.reduce((s,x)=> s + x.remain, 0);
  const fruitSum = fruit.reduce((s,x)=> s + x.remain, 0);

  const meta = {
    vegNames,
    fruitNames,
    vegMixName: vegNames.length ? `野菜ミックス(${vegNames.join("+")})` : "野菜ミックス(未選択)",
    fruitMixName: fruitNames.length ? `果物ミックス(${fruitNames.join("+")})` : "果物ミックス(なし)"
  };

  const inv = [];
  if(vegSum>0) inv.push({ name: meta.vegMixName, remain: vegSum, _mixType:"veg" });
  if(fruitSum>0) inv.push({ name: meta.fruitMixName, remain: fruitSum, _mixType:"fruit" });

  return { mineralMixInv: inv, mineralMixMeta: meta };
}

// ===== 週の必要ブロック（表示用）=====
function calcRequiredBlocksPerWeek(cfg){
  const meals = totalMeals(cfg);
  const req = { carb:0, protein:0, mineral:0 };
  for(let m=0; m<meals; m++){
    const t = mealTargets(cfg, m);
    req.carb += tspToBlocks(t.carb, cfg.blockSizeTsp.carb);
    req.protein += tspToBlocks(t.protein, cfg.blockSizeTsp.protein);
    req.mineral += tspToBlocks(t.mineral, cfg.blockSizeTsp.mineral);
  }
  return req;
}

function sumAvailableBlocks(inventoryOverride){
  const sum = (arr)=> (arr||[]).reduce((s,x)=> s + (Number.isFinite(+x.blocks)? +x.blocks : 0), 0);
  return {
    carb: sum(inventoryOverride?.carb),
    protein: sum(inventoryOverride?.protein),
    mineral: sum(inventoryOverride?.mineral)
  };
}

// ★メイン
export function generateWeeklyPlanWithInventory(customConfig = {}){
  const cfg = deepMerge(DEFAULT_CONFIG, customConfig);
  const warnings = [];
  const errors = [];

  // 通常在庫（チェックした分）
  const invRaw = {
    carb: makeInventoryFromOverride(cfg.inventoryOverride?.carb || [], cfg.blocksPerIngredient),
    protein: makeInventoryFromOverride(cfg.inventoryOverride?.protein || [], cfg.blocksPerIngredient),
    mineral: makeInventoryFromOverride(cfg.inventoryOverride?.mineral || [], cfg.blocksPerIngredient)
  };

  // ミネラルをミックス化（固定）
  const { mineralMixInv, mineralMixMeta } = buildMineralMixInventory(invRaw.mineral, cfg);

  const inv = {
    carb: invRaw.carb,
    protein: invRaw.protein,
    mineral: mineralMixInv
  };

  const newRule = cfg.newFoodRule || { enabled:false };
  const newQueue = Array.isArray(newRule.queue) ? [...newRule.queue] : [];
  const categoryOf = newRule.categoryOf || (()=>null);

  // ★新食材在庫（8ブロック）…不足計算に含めるために「追加在庫」を記録
  const newFoodStock = new Map(); // key: `${cat}::${name}` -> remain
  const newFoodAddedBlocks = { carb:0, protein:0, mineral:0 };

  const ensureNewFoodStock = (cat, name) => {
    const key = `${cat}::${name}`;
    if(!newFoodStock.has(key)){
      newFoodStock.set(key, cfg.blocksPerIngredient);
      newFoodAddedBlocks[cat] += cfg.blocksPerIngredient;
    }
    return key;
  };

  // ミネラル新食材は「ミックス在庫」に8追加してそこから消費
  const addMineralNewFoodToMix = (name) => {
    const type = isFruit(name) ? "fruit" : "veg";

    if(type==="fruit"){
      if(!mineralMixMeta.fruitNames.includes(name) && mineralMixMeta.fruitNames.length < 2){
        mineralMixMeta.fruitNames.push(name);
      }
      mineralMixMeta.fruitMixName = mineralMixMeta.fruitNames.length
        ? `果物ミックス(${mineralMixMeta.fruitNames.join("+")})`
        : "果物ミックス(なし)";
    }else{
      if(!mineralMixMeta.vegNames.includes(name) && mineralMixMeta.vegNames.length < 3){
        mineralMixMeta.vegNames.push(name);
      }
      mineralMixMeta.vegMixName = mineralMixMeta.vegNames.length
        ? `野菜ミックス(${mineralMixMeta.vegNames.join("+")})`
        : "野菜ミックス(未選択)";
    }

    let item = inv.mineral.find(x=>x._mixType===type);
    if(!item){
      item = { name: type==="fruit" ? mineralMixMeta.fruitMixName : mineralMixMeta.vegMixName, remain:0, _mixType:type };
      inv.mineral.push(item);
    }
    item.name = type==="fruit" ? mineralMixMeta.fruitMixName : mineralMixMeta.vegMixName;
    item.remain += cfg.blocksPerIngredient;

    newFoodAddedBlocks.mineral += cfg.blocksPerIngredient;
  };

  // ===== 生成（ここで「実欠損」を集計する）=====
  const plan = [];
  let recent = { carb:new Set(), protein:new Set(), mineral:new Set() };

  // ★不足は「実際に埋められなかった量」で集計（これが矛盾修正の本体）
  const missingSum = { carb:0, protein:0, mineral:0 };

  const meals = totalMeals(cfg);
  let mealIndex = 0;

  for(const day of cfg.days){
    for(let mealNo=1; mealNo<=cfg.mealsPerDay; mealNo++){

      const t = mealTargets(cfg, mealIndex);

      let need = {
        carb: tspToBlocks(t.carb, cfg.blockSizeTsp.carb),
        protein: tspToBlocks(t.protein, cfg.blockSizeTsp.protein),
        mineral: tspToBlocks(t.mineral, cfg.blockSizeTsp.mineral)
      };

      // 新食材（平日1回目に小さじ1）
      let newFoodPick = null;
      if(newRule.enabled){
        const okDay = newRule.weekdayOnly ? isWeekdayJP(day) : true;
        const okMeal = (mealNo === (newRule.mealNo || 1));
        if(okDay && okMeal && newQueue.length>0){
          const nf = newQueue.shift();
          const cat = categoryOf(nf);
          if(!cat){
            warnings.push(`[${day}${mealNo}食] 新食材「${nf}」カテゴリ判定失敗`);
          }else{
            const blocks = tspToBlocks(newRule.tsp ?? 1, cfg.blockSizeTsp[cat]);
            newFoodPick = { name:nf, category:cat, blocks };

            if(cat === "mineral"){
              addMineralNewFoodToMix(nf);
              need.mineral = Math.max(0, need.mineral - blocks);
            }else{
              const key = ensureNewFoodStock(cat, nf);
              newFoodStock.set(key, Math.max(0, newFoodStock.get(key) - blocks));
              need[cat] = Math.max(0, need[cat] - blocks);
            }
          }
        }
      }

      // 炭水化物/タンパク割当（足りるなら全部使う）
      const carbAlloc = allocateUpTo(inv.carb, need.carb, cfg.maxKindsPerMeal.carb, {
        recentlyUsedSet: recent.carb, avoidRepeat: cfg.avoidRepeat, autoRelaxMaxKinds: cfg.autoRelaxMaxKinds
      });
      const proAlloc = allocateUpTo(inv.protein, need.protein, cfg.maxKindsPerMeal.protein, {
        recentlyUsedSet: recent.protein, avoidRepeat: cfg.avoidRepeat, autoRelaxMaxKinds: cfg.autoRelaxMaxKinds
      });

      if(carbAlloc.missing>0) missingSum.carb += carbAlloc.missing;
      if(proAlloc.missing>0) missingSum.protein += proAlloc.missing;

      // ミネラル割当（野菜4＋果物残り、ただし片方足りないならもう片方で合計埋める）
      const vegBase = cfg.mineralSplit?.vegTspBase ?? 4;
      let vegNeed = Math.min(need.mineral, vegBase);
      let fruitNeed = Math.max(0, need.mineral - vegNeed);

      const vegItem = inv.mineral.find(x=>x._mixType==="veg");
      const fruitItem = inv.mineral.find(x=>x._mixType==="fruit");

      const mineralPicks = [];
      let remainingTotal = need.mineral;

      // まず野菜枠
      if(vegNeed>0 && vegItem && vegItem.remain>0){
        const use = Math.min(vegItem.remain, vegNeed);
        vegItem.remain -= use;
        mineralPicks.push({ name: vegItem.name, blocks: use, mix:"veg" });
        remainingTotal -= use;
      }

      // 次に果物枠
      if(fruitNeed>0 && fruitItem && fruitItem.remain>0){
        const use = Math.min(fruitItem.remain, fruitNeed);
        fruitItem.remain -= use;
        mineralPicks.push({ name: fruitItem.name, blocks: use, mix:"fruit" });
        remainingTotal -= use;
      }

      // ★合計がまだ足りないなら、残ってる方から埋める（ここが「余りがあるなら不足にしない」）
      if(remainingTotal>0){
        const pool = [];
        if(vegItem && vegItem.remain>0) pool.push(vegItem);
        if(fruitItem && fruitItem.remain>0) pool.push(fruitItem);

        // 残量が多い方から使う
        pool.sort((a,b)=> b.remain - a.remain);

        for(const it of pool){
          if(remainingTotal<=0) break;
          const use = Math.min(it.remain, remainingTotal);
          it.remain -= use;

          const exists = mineralPicks.find(x=>x.name===it.name);
          if(exists) exists.blocks += use;
          else mineralPicks.push({ name: it.name, blocks: use, mix: it._mixType });

          remainingTotal -= use;
        }
      }

      if(remainingTotal>0){
        missingSum.mineral += remainingTotal;
      }

      // 表示：新食材を先頭に付ける
      if(newFoodPick){
        if(newFoodPick.category==="carb") carbAlloc.picks.unshift({ name:newFoodPick.name, blocks:newFoodPick.blocks, isNew:true });
        if(newFoodPick.category==="protein") proAlloc.picks.unshift({ name:newFoodPick.name, blocks:newFoodPick.blocks, isNew:true });
        if(newFoodPick.category==="mineral") mineralPicks.unshift({ name:newFoodPick.name, blocks:newFoodPick.blocks, isNew:true });
      }

      const ok = (carbAlloc.missing===0 && proAlloc.missing===0 && remainingTotal===0);

      const name = menuName(carbAlloc.picks, proAlloc.picks, mineralPicks, cfg.phase);

      plan.push({
        day, meal: mealNo,
        ok,
        menuName: name,
        newFood: newFoodPick ? newFoodPick.name : null,
        targetsTsp: t,
        blocks: { carb: carbAlloc.picks, protein: proAlloc.picks, mineral: mineralPicks }
      });

      recent = {
        carb: new Set(carbAlloc.picks.map(x=>x.name)),
        protein: new Set(proAlloc.picks.map(x=>x.name)),
        mineral: new Set(mineralPicks.map(x=>x.name))
      };

      mealIndex++;
      if(mealIndex>=meals) break;
    }
  }

  // leftovers
  const leftovers = {
    carb: invRaw.carb.map(x=>({name:x.name, remainBlocks:x.remain})).filter(x=>x.remainBlocks>0),
    protein: invRaw.protein.map(x=>({name:x.name, remainBlocks:x.remain})).filter(x=>x.remainBlocks>0),
    mineral: inv.mineral.map(x=>({name:x.name, remainBlocks:x.remain})).filter(x=>x.remainBlocks>0)
  };

  // carb/protein 新食材在庫（残り7など）を leftovers に追加
  for(const [key, remain] of newFoodStock.entries()){
    const [cat, name] = key.split("::");
    if(remain > 0){
      leftovers[cat].push({ name, remainBlocks: remain, isNew:true });
    }
  }

  leftovers.carb.sort((a,b)=> a.name.localeCompare(b.name, "ja"));
  leftovers.protein.sort((a,b)=> a.name.localeCompare(b.name, "ja"));
  leftovers.mineral.sort((a,b)=> a.name.localeCompare(b.name, "ja"));

  // ===== 表示用：必要/在庫/不足（★不足は missingSum で出す）=====
  const requiredBlocksPerWeek = calcRequiredBlocksPerWeek(cfg);

  const baseAvailable = sumAvailableBlocks(cfg.inventoryOverride || {});
  const availableBlocks = {
    carb: baseAvailable.carb + newFoodAddedBlocks.carb,
    protein: baseAvailable.protein + newFoodAddedBlocks.protein,
    mineral: baseAvailable.mineral + newFoodAddedBlocks.mineral
  };

  // ★不足＝「実際に埋められなかった欠損」なので、余りがあるのに不足は出ない
  const shortageBlocks = {
    carb: missingSum.carb,
    protein: missingSum.protein,
    mineral: missingSum.mineral
  };

  const warnings = [];
  if(shortageBlocks.carb>0) warnings.push(`炭水化物が不足：あと ${shortageBlocks.carb} ブロック必要`);
  if(shortageBlocks.protein>0) warnings.push(`タンパク質が不足：あと ${shortageBlocks.protein} ブロック必要`);
  if(shortageBlocks.mineral>0) warnings.push(`ミネラルが不足：あと ${shortageBlocks.mineral}（小さじ相当）必要`);

  return {
    ok: warnings.length===0,
    config: cfg,
    plan,
    leftovers,
    warnings,
    errors: [],
    requiredBlocksPerWeek,
    availableBlocks,
    shortageBlocks,
    mineralMixMeta
  };
}