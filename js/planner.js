// js/planner.js
// v9（tsp内部統一 + ブロック換算返却）
//
// ✅ ブロック固定
//   - 炭水化物: 1ブロック=小さじ10
//   - タンパク: 1ブロック=小さじ1
//   - ミネラル単品: 1ブロック=小さじ1
//   - 野菜ミックス: 1ブロック=小さじ3
//   - 果物ミックス: 1ブロック=小さじ2
//
// ✅ 新食材（全カテゴリ）
//   - 平日1回目のみ投入、初回は必ず小さじ1
//   - その食では同じ新食材を追加で使わない（同カテゴリ他食材で補う）
//   - 2回目以降は在庫から通常消費し、表示は(新2回目以降)
//
// ✅ ミネラル
//   - ミックス（野菜/果物）は「チェック在庫のみ」で構成固定（新食材を入れない）
//   - 単品（新食材など）を優先消費するが、単品だけで枠を埋めない（偏り防止）
//
// ✅ 返却データ
//   - picks は tsp を正として返す（UIがtsp表示しやすい）
//   - 併せて blocks も返す（ブロック換算、必要ならUIで使う）

export const DEFAULT_CONFIG = {
  phase: "中期",
  days: ["月","火","水","木","金","土","日"],
  mealsPerDay: 2,

  tspPerMeal: {
    carb: 10,
    protein: { min: 2, max: 3 },
    mineral: { min: 4, max: 6 }
  },

  // 1食材の在庫ブロック数（UIの「8ブロック冷凍」）
  blocksPerIngredient: 8,

  // ブロック→小さじ（固定）
  tspPerBlock: {
    carb: 10,
    protein: 1,
    mineralSingle: 1,
    vegMix: 3,
    fruitMix: 2
  },

  // ミネラル（合計）のうち、まず野菜側で使いたい量（小さじ）
  mineralVegBaseTsp: 4,

  // ミネラル単品の混ぜ方（偏り防止）
  mineralSinglesPolicy: {
    // 1食ミネラル枠のうち、単品に回す最大割合
    maxSingleShare: 0.5,
    // 1食でミックスを最低この量は必ず出す（在庫がある限り）
    minMixTsp: 2
  }
};

function isWeekdayJP(day){ return ["月","火","水","木","金"].includes(day); }
function clampInt(n, min, max){ return Math.max(min, Math.min(max, n)); }

// 目標小さじ
function mealTargets(cfg, mealIndex){
  const protein = (mealIndex % 2 === 0) ? cfg.tspPerMeal.protein.min : cfg.tspPerMeal.protein.max;

  const base = (cfg.tspPerMeal.mineral.min + cfg.tspPerMeal.mineral.max) / 2; // 5
  const mineral = clampInt(
    Math.round(base + ((mealIndex % 3) - 1) * 0.5),
    cfg.tspPerMeal.mineral.min,
    cfg.tspPerMeal.mineral.max
  );

  return { carb: cfg.tspPerMeal.carb, protein, mineral };
}

// ===== 果物判定（あなたの食材リスト前提） =====
const FRUITS = new Set([
  "りんご","いちご","メロン","バナナ","すいか","梨","みかん","桃",
  "キウイ","ぶどう",
  "グレープフルーツ","アボカド","ブルーベリー","ラズベリー","パイン"
]);
function isFruit(name){ return FRUITS.has(name); }

// 在庫：内部は tsp（小さじ）で持つ
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
    // 新食材は使い切りたいので先頭に寄せる
    invArr.unshift(item);
  }
  return item;
}

// tsp を在庫から割当（exclude はこの食では使わない）
// NOTE: tsp単位なので端数OK（炭水化物の小さじ1も扱える）
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

// ミックス構成は「チェック在庫のみ」で固定（新食材ミネラルは入れない）
function buildMineralMix(mineralBaseInv, cfg){
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

  const mix = {
    veg: { name: meta.vegMixName, remainTsp: vegRemain },
    fruit: { name: meta.fruitMixName, remainTsp: fruitRemain }
  };

  return { mix, meta };
}

// ミックスから必要 tsp を割当（合計優先・野菜→果物→余りで埋め）
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

  // 合計が足りないなら残ってる方で埋める
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

// 表示ラベル統一：必ず末尾に付ける
function labelNew(name, isFirst){
  return isFirst ? `${name}(新初回)` : `${name}(新2回目以降)`;
}

export function generateWeeklyPlanWithInventory(customConfig = {}){
  const cfg = { ...DEFAULT_CONFIG, ...customConfig };
  cfg.mineralSinglesPolicy = {
    ...DEFAULT_CONFIG.mineralSinglesPolicy,
    ...(customConfig.mineralSinglesPolicy || {})
  };

  const warnings = [];
  const errors = [];

  const tspPerBlock = cfg.tspPerBlock;

  // 1) チェック在庫（tsp化）
  const inv = {
    carb: makeInventoryFromOverride(cfg.inventoryOverride?.carb, tspPerBlock.carb, cfg.blocksPerIngredient),
    protein: makeInventoryFromOverride(cfg.inventoryOverride?.protein, tspPerBlock.protein, cfg.blocksPerIngredient),
    mineralBase: makeInventoryFromOverride(cfg.inventoryOverride?.mineral, tspPerBlock.mineralSingle, cfg.blocksPerIngredient),
    mineralSingles: [] // ミネラル新食材など（ミックスに入れない）
  };

  // 2) 新食材キュー（最大5）
  const rule = cfg.newFoodRule || { enabled:false };
  const categoryOf = rule.categoryOf || (()=>null);
  const newQueue = Array.isArray(rule.queue) ? [...rule.queue].slice(0,5) : [];
  let newPtr = 0;

  // ★新食材を「週の在庫」として事前追加（tsp化）
  // - carb/protein はそれぞれへ
  // - mineral は mineralSingles へ（ミックスに入れない）
  const isMineralNew = new Set();
  const isCarbNew = new Set();
  const isProteinNew = new Set();

  for(const nf of newQueue){
    const cat = categoryOf(nf);
    if(cat === "carb"){
      ensureInventoryItem(inv.carb, nf, tspPerBlock.carb, cfg.blocksPerIngredient);
      isCarbNew.add(nf);
    }else if(cat === "protein"){
      ensureInventoryItem(inv.protein, nf, tspPerBlock.protein, cfg.blocksPerIngredient);
      isProteinNew.add(nf);
    }else if(cat === "mineral"){
      ensureInventoryItem(inv.mineralSingles, nf, tspPerBlock.mineralSingle, cfg.blocksPerIngredient);
      isMineralNew.add(nf);
    }
  }

  // 新食材「初回/2回目以降」管理（食材名ごと）
  const usedOnce = new Set(); // name that already had (新初回) displayed once

  // 3) ミックス構築（固定：チェック在庫のみ）
  const { mix: mineralMix, meta: mineralMixMeta } = buildMineralMix(inv.mineralBase, cfg);

  // 4) 生成
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

      // この食で「初回は追加で同じ新食材を使わない」ための除外
      const exclude = {
        carb: new Set(),
        protein: new Set(),
        mineralSingles: new Set()
      };

      // この食の新食材ピック（必ず小さじ1）
      let newPick = null; // {category, nameDisplay, tsp}

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
        }else{
          // ★初回は必ず小さじ1
          const firstTsp = 1;

          // 表示ラベルは統一（末尾）
          const display = labelNew(nf, true);
          usedOnce.add(nf);

          if(cat === "carb"){
            const item = ensureInventoryItem(inv.carb, nf, tspPerBlock.carb, cfg.blocksPerIngredient);
            item.remainTsp = Math.max(0, item.remainTsp - firstTsp);
            need.carbTsp = Math.max(0, need.carbTsp - firstTsp);
            exclude.carb.add(nf); // 初回のその食では追加で使わない
            newPick = { category:"carb", name: display, tsp: firstTsp, isNew:true };

          } else if(cat === "protein"){
            const item = ensureInventoryItem(inv.protein, nf, tspPerBlock.protein, cfg.blocksPerIngredient);
            item.remainTsp = Math.max(0, item.remainTsp - firstTsp);
            need.proteinTsp = Math.max(0, need.proteinTsp - firstTsp);
            exclude.protein.add(nf);
            newPick = { category:"protein", name: display, tsp: firstTsp, isNew:true };

          } else if(cat === "mineral"){
            const item = ensureInventoryItem(inv.mineralSingles, nf, tspPerBlock.mineralSingle, cfg.blocksPerIngredient);
            item.remainTsp = Math.max(0, item.remainTsp - firstTsp);
            need.mineralTsp = Math.max(0, need.mineralTsp - firstTsp);
            exclude.mineralSingles.add(nf);
            newPick = { category:"mineral", name: display, tsp: firstTsp, isNew:true };
          }
        }
      }

      // ===== 炭水化物（tsp割当）=====
      const carbAlloc = allocateTsp(inv.carb, need.carbTsp, exclude.carb);

      // 新食材（2回目以降）ラベル付け（在庫から拾われた分）
      const carbPicks = carbAlloc.picks.map(p => {
        const isNew = isCarbNew.has(p.name);
        const nameDisplay = isNew
          ? (usedOnce.has(p.name) ? labelNew(p.name, false) : labelNew(p.name, true))
          : p.name;
        if(isNew && !usedOnce.has(p.name)) usedOnce.add(p.name);
        return {
          name: nameDisplay,
          tsp: p.tsp,
          blocks: p.tsp / tspPerBlock.carb, // 端数OK
          unit: { blockTsp: tspPerBlock.carb, blockLabel: "ブロック" }
        };
      });

      // ===== タンパク（tsp割当）=====
      const proAlloc = allocateTsp(inv.protein, need.proteinTsp, exclude.protein);
      const proteinPicks = proAlloc.picks.map(p => {
        const isNew = isProteinNew.has(p.name);
        const nameDisplay = isNew
          ? (usedOnce.has(p.name) ? labelNew(p.name, false) : labelNew(p.name, true))
          : p.name;
        if(isNew && !usedOnce.has(p.name)) usedOnce.add(p.name);
        return {
          name: nameDisplay,
          tsp: p.tsp,
          blocks: p.tsp / tspPerBlock.protein,
          unit: { blockTsp: tspPerBlock.protein, blockLabel: "ブロック" }
        };
      });

      // ===== ミネラル（単品優先+ミックス最低保証）=====
      let mineralNeed = need.mineralTsp;
      const mineralPicks = [];

      // まず「単品の上限」を決める（単品だけで枠を埋めない）
      const maxSingle = Math.floor(mineralNeed * cfg.mineralSinglesPolicy.maxSingleShare);
      const minMix = Math.min(cfg.mineralSinglesPolicy.minMixTsp, mineralNeed);
      const singleAllowed = Math.max(0, Math.min(maxSingle, mineralNeed - minMix));

      // (A) 単品を先に少し
      if(singleAllowed > 0){
        const s1 = allocateTsp(inv.mineralSingles, singleAllowed, exclude.mineralSingles);
        for(const p of s1.picks){
          const isNew = isMineralNew.has(p.name);
          const nameDisplay = isNew
            ? (usedOnce.has(p.name) ? labelNew(p.name, false) : labelNew(p.name, true))
            : p.name;
          if(isNew && !usedOnce.has(p.name)) usedOnce.add(p.name);

          mineralPicks.push({
            name: nameDisplay,
            tsp: p.tsp,
            blocks: p.tsp / tspPerBlock.mineralSingle,
            unit: { blockTsp: tspPerBlock.mineralSingle, blockLabel: "ブロック" },
            kind: "single"
          });
        }
        mineralNeed -= (singleAllowed - s1.missingTsp);
      }

      // (B) ミックスで残り
      const mx = allocMineralFromMix(mineralMix, mineralNeed, cfg.mineralVegBaseTsp);
      for(const p of mx.picks){
        const blockTsp = (p.mix === "veg") ? tspPerBlock.vegMix : tspPerBlock.fruitMix;
        mineralPicks.push({
          name: p.name,
          tsp: p.tsp,
          blocks: p.tsp / blockTsp,
          unit: { blockTsp, blockLabel: "ブロック" },
          kind: "mix"
        });
      }
      mineralNeed = mx.missingTsp;

      // (C) それでも足りないなら単品で補填（同カテゴリ補填）
      if(mineralNeed > 0){
        const s2 = allocateTsp(inv.mineralSingles, mineralNeed, exclude.mineralSingles);
        for(const p of s2.picks){
          const isNew = isMineralNew.has(p.name);
          const nameDisplay = isNew
            ? (usedOnce.has(p.name) ? labelNew(p.name, false) : labelNew(p.name, true))
            : p.name;
          if(isNew && !usedOnce.has(p.name)) usedOnce.add(p.name);

          mineralPicks.push({
            name: nameDisplay,
            tsp: p.tsp,
            blocks: p.tsp / tspPerBlock.mineralSingle,
            unit: { blockTsp: tspPerBlock.mineralSingle, blockLabel: "ブロック" },
            kind: "single"
          });
        }
        mineralNeed = s2.missingTsp;
      }

      // ===== 新食材（初回）を先頭へ（カテゴリ混入なし）=====
      if(newPick){
        const add = (blockTsp) => ({
          name: newPick.name,
          tsp: newPick.tsp,
          blocks: newPick.tsp / blockTsp,
          unit: { blockTsp, blockLabel: "ブロック" },
          isNew: true
        });

        if(newPick.category === "carb") carbPicks.unshift(add(tspPerBlock.carb));
        if(newPick.category === "protein") proteinPicks.unshift(add(tspPerBlock.protein));
        if(newPick.category === "mineral") mineralPicks.unshift(add(tspPerBlock.mineralSingle));
      }

      // 不足集計（tsp）
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
        blocks: {
          carb: carbPicks,       // tsp + blocks(=tsp/10)
          protein: proteinPicks, // tsp + blocks
          mineral: mineralPicks  // tsp + blocks(ミックスは3 or 2 tsp/blk)
        }
      });

      mealIndex++;
    }
  }

  // 余り在庫（表示用：tsp + blocks）
  const leftovers = {
    carb: inv.carb
      .filter(x=>x.remainTsp>0)
      .map(x=>({ name:x.name, remainTsp:x.remainTsp, remainBlocks:x.remainTsp / tspPerBlock.carb })),
    protein: inv.protein
      .filter(x=>x.remainTsp>0)
      .map(x=>({ name:x.name, remainTsp:x.remainTsp, remainBlocks:x.remainTsp / tspPerBlock.protein })),
    mineral: [
      ...(mineralMix.veg.remainTsp>0 ? [{
        name: mineralMix.veg.name,
        remainTsp: mineralMix.veg.remainTsp,
        remainBlocks: mineralMix.veg.remainTsp / tspPerBlock.vegMix
      }] : []),
      ...(mineralMix.fruit.remainTsp>0 ? [{
        name: mineralMix.fruit.name,
        remainTsp: mineralMix.fruit.remainTsp,
        remainBlocks: mineralMix.fruit.remainTsp / tspPerBlock.fruitMix
      }] : []),
      ...inv.mineralSingles
        .filter(x=>x.remainTsp>0)
        .map(x=>({ name:`${x.name}(単品)`, remainTsp:x.remainTsp, remainBlocks:x.remainTsp / tspPerBlock.mineralSingle }))
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
    mineralMixMeta
  };
}