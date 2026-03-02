// js/planner.js

export const DEFAULT_CONFIG = {
  phase: "中期",
  days: ["月","火","水","木","金","土","日"],
  mealsPerDay: 2,

  tspPerMeal: {
    carb: 10,
    protein: { min: 2, max: 3 },
    mineral: { min: 4, max: 6 }
  },

  // 1ブロックが何小さじか（炭水化物は10推奨）
  blockSizeTsp: {
    carb: 10,
    protein: 1,
    mineral: 1
  },

  blocksPerIngredient: 8,

  maxKindsPerMeal: {
    carb: 2,
    protein: 2,
    mineral: 3
  },

  autoRelaxMaxKinds: true,
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

function allocate(inv, blocksNeeded, maxKinds, opts){
  const { recentlyUsedSet, avoidRepeat, autoRelaxMaxKinds } = opts;
  let kindsLimit = maxKinds;

  for(;;){
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

    if(need<=0){
      return { ok:true, picks, usedKindsLimit:kindsLimit };
    }

    // rollback
    for(const p of picks){
      const it = inv.find(x=>x.name===p.name);
      if(it) it.remain += p.blocks;
    }

    if(autoRelaxMaxKinds && kindsLimit < inv.length){
      kindsLimit += 1;
      continue;
    }

    return {
      ok:false,
      picks:[],
      usedKindsLimit:kindsLimit,
      reason:`割当不能：blocksNeeded=${blocksNeeded}（maxKinds=${kindsLimit}）`
    };
  }
}

function menuName(carbPicks, proteinPicks, mineralPicks, phase){
  const carb = carbPicks[0]?.name ?? "ごはん";
  const p1 = proteinPicks[0]?.name ?? "豆腐";
  const vegs = mineralPicks.slice(0,2).map(x=>x.name);
  const v = vegs.length ? vegs.join("と") : "野菜";

  const base = (phase==="初期")
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

// ===== 必要ブロック / 在庫ブロック / 不足ブロック（カテゴリ合計） =====

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

// ★メイン：在庫指定 + 新食材 + 不足ブロック情報
export function generateWeeklyPlanWithInventory(customConfig = {}){
  const cfg = deepMerge(DEFAULT_CONFIG, customConfig);
  const warnings = [];
  const errors = [];

  // 週に必要なブロック / 在庫ブロック / 不足ブロック（カテゴリ合計）
  const requiredBlocksPerWeek = calcRequiredBlocksPerWeek(cfg);
  const availableBlocks = sumAvailableBlocks(cfg.inventoryOverride || {});
  const shortageBlocks = {
    carb: Math.max(0, requiredBlocksPerWeek.carb - availableBlocks.carb),
    protein: Math.max(0, requiredBlocksPerWeek.protein - availableBlocks.protein),
    mineral: Math.max(0, requiredBlocksPerWeek.mineral - availableBlocks.mineral)
  };

  if (shortageBlocks.carb > 0) warnings.push(`炭水化物が不足：あと ${shortageBlocks.carb} ブロック必要`);
  if (shortageBlocks.protein > 0) warnings.push(`タンパク質が不足：あと ${shortageBlocks.protein} ブロック必要`);
  if (shortageBlocks.mineral > 0) warnings.push(`ミネラルが不足：あと ${shortageBlocks.mineral} ブロック必要`);

  const inv = {
    carb: makeInventoryFromOverride(cfg.inventoryOverride?.carb || [], cfg.blocksPerIngredient),
    protein: makeInventoryFromOverride(cfg.inventoryOverride?.protein || [], cfg.blocksPerIngredient),
    mineral: makeInventoryFromOverride(cfg.inventoryOverride?.mineral || [], cfg.blocksPerIngredient)
  };

  if(inv.carb.length===0) warnings.push("炭水化物の在庫が0です（チェックしてください）");
  if(inv.protein.length===0) warnings.push("タンパク質の在庫が0です（チェックしてください）");
  if(inv.mineral.length===0) warnings.push("ミネラルの在庫が0です（チェックしてください）");

  const newRule = cfg.newFoodRule || { enabled:false };
  const newQueue = Array.isArray(newRule.queue) ? [...newRule.queue] : [];
  const categoryOf = newRule.categoryOf || (()=>null);

  const plan = [];
  let recent = { carb:new Set(), protein:new Set(), mineral:new Set() };

  const meals = totalMeals(cfg);
  let mealIndex = 0;

  for(const day of cfg.days){
    for(let mealNo=1; mealNo<=cfg.mealsPerDay; mealNo++){

      const t = mealTargets(cfg, mealIndex);

      const need = {
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
          if(!cat || !need[cat]){
            warnings.push(`[${day}${mealNo}食] 新食材「${nf}」カテゴリ判定失敗`);
          }else{
            const blocks = tspToBlocks(newRule.tsp ?? 1, cfg.blockSizeTsp[cat]);
            newFoodPick = { name:nf, category:cat, blocks };
            need[cat] = Math.max(0, need[cat]-blocks);
          }
        }
      }

      const carbAlloc = allocate(inv.carb, need.carb, cfg.maxKindsPerMeal.carb, {
        recentlyUsedSet: recent.carb, avoidRepeat: cfg.avoidRepeat, autoRelaxMaxKinds: cfg.autoRelaxMaxKinds
      });
      const proAlloc = allocate(inv.protein, need.protein, cfg.maxKindsPerMeal.protein, {
        recentlyUsedSet: recent.protein, avoidRepeat: cfg.avoidRepeat, autoRelaxMaxKinds: cfg.autoRelaxMaxKinds
      });
      const minAlloc = allocate(inv.mineral, need.mineral, cfg.maxKindsPerMeal.mineral, {
        recentlyUsedSet: recent.mineral, avoidRepeat: cfg.avoidRepeat, autoRelaxMaxKinds: cfg.autoRelaxMaxKinds
      });

      if(!carbAlloc.ok) warnings.push(`[${day}${mealNo}食] 炭水化物: ${carbAlloc.reason}`);
      if(!proAlloc.ok) warnings.push(`[${day}${mealNo}食] タンパク: ${proAlloc.reason}`);
      if(!minAlloc.ok) warnings.push(`[${day}${mealNo}食] ミネラル: ${minAlloc.reason}`);

      // 新食材を先頭に表示
      if(newFoodPick){
        const arr = newFoodPick.category==="carb" ? carbAlloc.picks
                  : newFoodPick.category==="protein" ? proAlloc.picks
                  : minAlloc.picks;
        arr.unshift({ name:newFoodPick.name, blocks:newFoodPick.blocks, isNew:true });
      }

      const name = menuName(carbAlloc.picks, proAlloc.picks, minAlloc.picks, cfg.phase);

      plan.push({
        day, meal: mealNo,
        ok: carbAlloc.ok && proAlloc.ok && minAlloc.ok,
        menuName: name,
        newFood: newFoodPick ? newFoodPick.name : null,
        targetsTsp: t,
        blocks: { carb: carbAlloc.picks, protein: proAlloc.picks, mineral: minAlloc.picks }
      });

      recent = {
        carb: new Set(carbAlloc.picks.map(x=>x.name)),
        protein: new Set(proAlloc.picks.map(x=>x.name)),
        mineral: new Set(minAlloc.picks.map(x=>x.name))
      };

      mealIndex++;
      if(mealIndex>=meals) break;
    }
  }

  const leftovers = {
    carb: inv.carb.map(x=>({name:x.name, remainBlocks:x.remain})).filter(x=>x.remainBlocks>0),
    protein: inv.protein.map(x=>({name:x.name, remainBlocks:x.remain})).filter(x=>x.remainBlocks>0),
    mineral: inv.mineral.map(x=>({name:x.name, remainBlocks:x.remain})).filter(x=>x.remainBlocks>0)
  };

  return {
    ok: errors.length===0,
    config: cfg,
    plan,
    leftovers,
    warnings,
    errors,
    requiredBlocksPerWeek,
    availableBlocks,
    shortageBlocks
  };
}