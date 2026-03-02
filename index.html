// js/planner.js
// v11（v10の Promiseエラー修正：warnings二重宣言を解消）
//
// 固定ルール
// - 炭水化物: 1ブロック=小さじ10
// - タンパク: 1ブロック=小さじ1
// - ミネラル単品: 1ブロック=小さじ1
// - 野菜ミックス: 1ブロック=小さじ3
// - 果物ミックス: 1ブロック=小さじ2
//
// 新食材（全カテゴリ）
// - 平日1回目のみ投入、初回は必ず小さじ1
// - その食では同じ新食材を追加で使わない（同カテゴリ他食材で補う）
// - 2回目以降は在庫から通常消費し、表示は(新2回目以降)
//
// ミネラル
// - ミックスは「チェック在庫のみ」で構成固定（新食材を入れない）
// - 単品（新食材など）を優先消費するが、単品だけで枠を埋めない（偏り防止）
//
// 返却
// - 各 pick は { name, tsp, blocks } を返す
// - isNew は返さない（UIに勝手に(新)を付けさせない）

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

const FRUITS = new Set([
  "りんご","いちご","メロン","バナナ","すいか","梨","みかん","桃",
  "キウイ","ぶどう",
  "グレープフルーツ","アボカド","ブルーベリー","ラズベリー","パイン"
]);
function isFruit(name){ return FRUITS.has(name); }

function makeInventoryFromOverride(list, tspPerBlock, defaultBlocks){
  return (list || []).map(x => {
    const blocks = Number.isFinite(+x.blocks) ? +x.blocks : defaultBlocks;
    return { name: x.name, remainTsp: blocks * tspPerBlock };
  });
}

function ensureInventoryItem(invArr, name, tspPerBlock, defaultBlocks){
  let item = invArr.find(x => x.name === name);
  if(!item){
    item = { name, remainTsp: defaultBlocks * tspPerBlock };
    invArr.unshift(item);
  }
  return item;
}

function allocateTsp(invArr, needTsp, excludeSet){
  let need = needTsp;
  const picks = [];

  const candidates = [...invArr]
    .filter(x => x.remainTsp > 0 && !excludeSet.has(x.name))
    .sort((a,b) => b.remainTsp - a.remainTsp);

  for(const it of candidates){
    if(need <= 0) break;
    const use = Math.min(it.remainTsp, need);
    if(use > 0){
      it.remainTsp -= use;
      need -= use;
      picks.push({ name: it.name, tsp: use });
    }
  }

  return { picks, missingTsp: need };
}

function buildMineralMix(mineralBaseInv){
  const vegItems = mineralBaseInv.filter(x => !isFruit(x.name));
  const fruitItems = mineralBaseInv.filter(x => isFruit(x.name));

  const vegNames = [...vegItems].sort((a,b)=> b.remainTsp - a.remainTsp).slice(0,3).map(x=>x.name);
  const fruitNames = [...fruitItems].sort((a,b)=> b.remainTsp - a.remainTsp).slice(0,2).map(x=>x.name);

  const vegRemain = vegItems.reduce((s,x)=> s + x.remainTsp, 0);
  const fruitRemain = fruitItems.reduce((s,x)=> s + x.remainTsp, 0);

  const meta = {
    vegNames,
    fruitNames,
    vegMixName: vegNames.length ? `野菜ミックス(${vegNames.join("+")})` : "野菜ミックス(未選択)",
    fruitMixName: fruitNames.length ? `果物ミックス(${fruitNames.join("+")})` : "果物ミックス(なし)"
  };

  return {
    mix: {
      veg: { name: meta.vegMixName, remainTsp: vegRemain },
      fruit: { name: meta.fruitMixName, remainTsp: fruitRemain }
    },
    meta
  };
}

function allocMineralFromMix(mix, needTsp, vegBaseTsp){
  let need = needTsp;
  const picks = [];

  const vegTarget = Math.min(need, vegBaseTsp);
  const vegUse = Math.min(mix.veg.remainTsp, vegTarget);
  if(vegUse > 0){
    mix.veg.remainTsp -= vegUse;
    need -= vegUse;
    picks.push({ name: mix.veg.name, tsp: vegUse, mix: "veg" });
  }

  const fruitUse = Math.min(mix.fruit.remainTsp, need);
  if(fruitUse > 0){
    mix.fruit.remainTsp -= fruitUse;
    need -= fruitUse;
    picks.push({ name: mix.fruit.name, tsp: fruitUse, mix: "fruit" });
  }

  if(need > 0){
    const pools = [
      { key:"veg", it: mix.veg },
      { key:"fruit", it: mix.fruit }
    ].filter(p => p.it.remainTsp > 0).sort((a,b)=> b.it.remainTsp - a.it.remainTsp);

    for(const p of pools){
      if(need <= 0) break;
      const use = Math.min(p.it.remainTsp, need);
      p.it.remainTsp -= use;
      need -= use;

      const ex = picks.find(x => x.name === p.it.name);
      if(ex) ex.tsp += use;
      else picks.push({ name: p.it.name, tsp: use, mix: p.key });
    }
  }

  return { picks, missingTsp: need };
}

function labelNew(name, isFirst){
  return isFirst ? `${name}(新初回)` : `${name}(新2回目以降)`;
}

export function generateWeeklyPlanWithInventory(customConfig = {}){
  const cfg = { ...DEFAULT_CONFIG, ...customConfig };
  cfg.mineralSinglesPolicy = { ...DEFAULT_CONFIG.mineralSinglesPolicy, ...(customConfig.mineralSinglesPolicy || {}) };

  const warnings = [];
  const errors = [];

  const tspPerBlock = cfg.tspPerBlock;

  const inv = {
    carb: makeInventoryFromOverride(cfg.inventoryOverride?.carb, tspPerBlock.carb, cfg.blocksPerIngredient),
    protein: makeInventoryFromOverride(cfg.inventoryOverride?.protein, tspPerBlock.protein, cfg.blocksPerIngredient),
    mineralBase: makeInventoryFromOverride(cfg.inventoryOverride?.mineral, tspPerBlock.mineralSingle, cfg.blocksPerIngredient),
    mineralSingles: []
  };

  const rule = cfg.newFoodRule || { enabled:false };
  const categoryOf = rule.categoryOf || (()=>null);
  const newQueue = Array.isArray(rule.queue) ? [...rule.queue].slice(0,5) : [];
  let newPtr = 0;

  const newByCat = { carb:new Set(), protein:new Set(), mineral:new Set() };
  const newFirstShown = new Set();

  for(const nf of newQueue){
    const cat = categoryOf(nf);
    if(cat === "carb"){
      ensureInventoryItem(inv.carb, nf, tspPerBlock.carb, cfg.blocksPerIngredient);
      newByCat.carb.add(nf);
    } else if(cat === "protein"){
      ensureInventoryItem(inv.protein, nf, tspPerBlock.protein, cfg.blocksPerIngredient);
      newByCat.protein.add(nf);
    } else if(cat === "mineral"){
      ensureInventoryItem(inv.mineralSingles, nf, tspPerBlock.mineralSingle, cfg.blocksPerIngredient);
      newByCat.mineral.add(nf);
    }
  }

  const { mix: mineralMix, meta: mineralMixMeta } = buildMineralMix(inv.mineralBase);

  const plan = [];
  const missingSum = { carbTsp:0, proteinTsp:0, mineralTsp:0 };

  let mealIndex = 0;

  for(const day of cfg.days){
    for(let mealNo=1; mealNo<=cfg.mealsPerDay; mealNo++){

      const targets = mealTargets(cfg, mealIndex);

      let need = {
        carbTsp: targets.carb,
        proteinTsp: targets.protein,
        mineralTsp: targets.mineral
      };

      const exclude = { carb:new Set(), protein:new Set(), mineralSingles:new Set() };

      let newLine = null; // { category, name, tsp }

      const doNew =
        rule.enabled &&
        isWeekdayJP(day) &&
        (mealNo === (rule.mealNo || 1)) &&
        newPtr < newQueue.length;

      if(doNew){
        const nf = newQueue[newPtr++];
        const cat = categoryOf(nf);

        if(!cat){
          warnings.push(`[${day}${mealNo}食] 新食材「${nf}」カテゴリ判定失敗`);
        } else {
          const firstTsp = 1; // ★絶対1
          newLine = { category: cat, name: labelNew(nf, true), tsp: 1 };
          newFirstShown.add(nf);

          if(cat === "carb"){
            const it = ensureInventoryItem(inv.carb, nf, tspPerBlock.carb, cfg.blocksPerIngredient);
            it.remainTsp = Math.max(0, it.remainTsp - firstTsp);
            need.carbTsp = Math.max(0, need.carbTsp - firstTsp);
            exclude.carb.add(nf);

          } else if(cat === "protein"){
            const it = ensureInventoryItem(inv.protein, nf, tspPerBlock.protein, cfg.blocksPerIngredient);
            it.remainTsp = Math.max(0, it.remainTsp - firstTsp);
            need.proteinTsp = Math.max(0, need.proteinTsp - firstTsp);
            exclude.protein.add(nf);

          } else if(cat === "mineral"){
            const it = ensureInventoryItem(inv.mineralSingles, nf, tspPerBlock.mineralSingle, cfg.blocksPerIngredient);
            it.remainTsp = Math.max(0, it.remainTsp - firstTsp);
            need.mineralTsp = Math.max(0, need.mineralTsp - firstTsp);
            exclude.mineralSingles.add(nf);
          }
        }
      }

      // carb
      const carbAlloc = allocateTsp(inv.carb, need.carbTsp, exclude.carb);
      const carbPicks = carbAlloc.picks.map(p => {
        const isNew = newByCat.carb.has(p.name);
        const nameDisplay = isNew ? labelNew(p.name, !newFirstShown.has(p.name)) : p.name;
        if(isNew && !newFirstShown.has(p.name)) newFirstShown.add(p.name);
        return { name: nameDisplay, tsp: p.tsp, blocks: p.tsp / tspPerBlock.carb };
      });

      // protein
      const proAlloc = allocateTsp(inv.protein, need.proteinTsp, exclude.protein);
      const proteinPicks = proAlloc.picks.map(p => {
        const isNew = newByCat.protein.has(p.name);
        const nameDisplay = isNew ? labelNew(p.name, !newFirstShown.has(p.name)) : p.name;
        if(isNew && !newFirstShown.has(p.name)) newFirstShown.add(p.name);
        return { name: nameDisplay, tsp: p.tsp, blocks: p.tsp / tspPerBlock.protein };
      });

      // mineral
      let mineralNeed = need.mineralTsp;
      const mineralPicks = [];

      const maxSingle = Math.floor(mineralNeed * cfg.mineralSinglesPolicy.maxSingleShare);
      const minMix = Math.min(cfg.mineralSinglesPolicy.minMixTsp, mineralNeed);
      const singleAllowed = Math.max(0, Math.min(maxSingle, mineralNeed - minMix));

      if(singleAllowed > 0){
        const s1 = allocateTsp(inv.mineralSingles, singleAllowed, exclude.mineralSingles);
        for(const p of s1.picks){
          const isNew = newByCat.mineral.has(p.name);
          const nameDisplay = isNew ? labelNew(p.name, !newFirstShown.has(p.name)) : p.name;
          if(isNew && !newFirstShown.has(p.name)) newFirstShown.add(p.name);
          mineralPicks.push({ name: nameDisplay, tsp: p.tsp, blocks: p.tsp / tspPerBlock.mineralSingle });
        }
        mineralNeed -= (singleAllowed - s1.missingTsp);
      }

      const mx = allocMineralFromMix(mineralMix, mineralNeed, cfg.mineralVegBaseTsp);
      for(const p of mx.picks){
        const blockTsp = (p.mix === "veg") ? tspPerBlock.vegMix : tspPerBlock.fruitMix;
        mineralPicks.push({ name: p.name, tsp: p.tsp, blocks: p.tsp / blockTsp });
      }
      mineralNeed = mx.missingTsp;

      if(mineralNeed > 0){
        const s2 = allocateTsp(inv.mineralSingles, mineralNeed, exclude.mineralSingles);
        for(const p of s2.picks){
          const isNew = newByCat.mineral.has(p.name);
          const nameDisplay = isNew ? labelNew(p.name, !newFirstShown.has(p.name)) : p.name;
          if(isNew && !newFirstShown.has(p.name)) newFirstShown.add(p.name);
          mineralPicks.push({ name: nameDisplay, tsp: p.tsp, blocks: p.tsp / tspPerBlock.mineralSingle });
        }
        mineralNeed = s2.missingTsp;
      }

      // add newLine (tsp=1 fixed)
      if(newLine){
        const addPick = (blockTsp) => ({ name: newLine.name, tsp: 1, blocks: 1 / blockTsp });
        if(newLine.category === "carb") carbPicks.unshift(addPick(tspPerBlock.carb));
        if(newLine.category === "protein") proteinPicks.unshift(addPick(tspPerBlock.protein));
        if(newLine.category === "mineral") mineralPicks.unshift(addPick(tspPerBlock.mineralSingle));
      }

      if(carbAlloc.missingTsp > 0) missingSum.carbTsp += carbAlloc.missingTsp;
      if(proAlloc.missingTsp > 0) missingSum.proteinTsp += proAlloc.missingTsp;
      if(mineralNeed > 0) missingSum.mineralTsp += mineralNeed;

      const okThisMeal = (carbAlloc.missingTsp===0 && proAlloc.missingTsp===0 && mineralNeed===0);

      plan.push({
        day,
        meal: mealNo,
        ok: okThisMeal,
        menuName: "献立",
        targetsTsp: targets,
        blocks: { carb: carbPicks, protein: proteinPicks, mineral: mineralPicks }
      });

      mealIndex++;
    }
  }

  const leftovers = {
    carb: inv.carb.filter(x=>x.remainTsp>0).map(x=>({
      name:x.name, remainTsp:x.remainTsp, remainBlocks:x.remainTsp / tspPerBlock.carb
    })),
    protein: inv.protein.filter(x=>x.remainTsp>0).map(x=>({
      name:x.name, remainTsp:x.remainTsp, remainBlocks:x.remainTsp / tspPerBlock.protein
    })),
    mineral: [
      ...(mineralMix.veg.remainTsp>0 ? [{
        name:mineralMix.veg.name, remainTsp:mineralMix.veg.remainTsp, remainBlocks:mineralMix.veg.remainTsp / tspPerBlock.vegMix
      }] : []),
      ...(mineralMix.fruit.remainTsp>0 ? [{
        name:mineralMix.fruit.name, remainTsp:mineralMix.fruit.remainTsp, remainBlocks:mineralMix.fruit.remainTsp / tspPerBlock.fruitMix
      }] : []),
      ...inv.mineralSingles.filter(x=>x.remainTsp>0).map(x=>({
        name:`${x.name}(単品)`, remainTsp:x.remainTsp, remainBlocks:x.remainTsp / tspPerBlock.mineralSingle
      }))
    ]
  };

  const shortageBlocks = {
    carbTsp: missingSum.carbTsp,
    proteinTsp: missingSum.proteinTsp,
    mineralTsp: missingSum.mineralTsp
  };

  if(shortageBlocks.carbTsp>0) warnings.push(`炭水化物が不足：あと 小さじ${shortageBlocks.carbTsp}`);
  if(shortageBlocks.proteinTsp>0) warnings.push(`タンパク質が不足：あと 小さじ${shortageBlocks.proteinTsp}`);
  if(shortageBlocks.mineralTsp>0) warnings.push(`ミネラルが不足：あと 小さじ${shortageBlocks.mineralTsp}`);

  return {
    ok: warnings.length===0,
    config: cfg,
    plan,
    leftovers,
    warnings,
    errors,
    shortageBlocks,
    mineralMixMeta: mineralMixMeta
  };
}