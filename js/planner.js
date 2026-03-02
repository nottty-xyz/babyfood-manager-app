// js/planner.js
// 完全整理版 v5
// ✅ 新食材は「初回（平日1回目）」は必ず小さじ1のみ
// ✅ 初回の不足分は同カテゴリの他食材で補う（初回は新食材を追加で使わない）
// ✅ 新食材は在庫8ブロックとして追加 → 2回目以降は通常在庫として消費（週内で使い切りやすい）
// ✅ ミネラルは「野菜ミックス(最大3種)」「果物ミックス(最大2種)」固定
// ✅ ミネラル新食材はミックスに入れない：単品として表示
// ✅ ただし、ミックスが足りてても「単品（新食材など）」を優先的に少量混ぜて使い切り促進
//    - 単品だけで枠を埋めない（偏り防止）：1食あたり単品は最大で「総ミネラルの半分」まで、かつ「ミックス最低2」
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
  mineralVegBase: 4,

  // ★偏り防止 + 使い切り促進のパラメータ
  mineralSinglesPolicy: {
    // ミックスが足りてても、単品（新食材など）を入れる最大割合（例: 0.5 = 半分まで）
    maxSingleShare: 0.5,
    // 1食でミックスを最低この量は必ず出す（単品だけにならない）
    minMixTsp: 2
  }
};

function tspToBlocks(tsp, size){ return Math.ceil(tsp / size); }
function clampInt(n,min,max){ return Math.max(min, Math.min(max,n)); }
function isWeekdayJP(day){ return ["月","火","水","木","金"].includes(day); }

function mealTargets(cfg, i){
  const protein = (i % 2 === 0) ? cfg.tspPerMeal.protein.min : cfg.tspPerMeal.protein.max;

  // 5中心で軽く揺らす（4〜6に収まる）
  const mineralBase = (cfg.tspPerMeal.mineral.min + cfg.tspPerMeal.mineral.max) / 2; // 5
  const mineral = clampInt(
    Math.round(mineralBase + ((i % 3) - 1) * 0.5),
    cfg.tspPerMeal.mineral.min,
    cfg.tspPerMeal.mineral.max
  );

  return { carb: cfg.tspPerMeal.carb, protein, mineral };
}

// ===== ミネラル：果物判定（あなたのリスト前提） =====
const FRUITS = new Set([
  "りんご","いちご","メロン","バナナ","すいか","梨","みかん","桃",
  "キウイ","ぶどう",
  "グレープフルーツ","アボカド","ブルーベリー","ラズベリー",
  "パイン"
]);
function isFruit(n){ return FRUITS.has(n); }

function makeInventoryFromOverride(list, blocksPerIngredient){
  return (list || []).map(x => ({
    name: x.name,
    remain: Number.isFinite(+x.blocks) ? +x.blocks : blocksPerIngredient
  }));
}

function ensureInventoryItem(invArr, name, blocksPerIngredient){
  let item = invArr.find(x => x.name === name);
  if(!item){
    item = { name, remain: blocksPerIngredient };
    // 新食材は使い切りたいので先頭に寄せる（登場しやすくする）
    invArr.unshift(item);
  }
  return item;
}

// 在庫から必要量を割り当て（除外名はこの食では使わない）
function allocateFromInventory(invArr, needBlocks, excludeSet){
  let need = needBlocks;
  const picks = [];

  // 使い切りやすさ重視：残量が多い順
  const candidates = [...invArr]
    .filter(x => x.remain > 0 && !excludeSet.has(x.name))
    .sort((a,b) => b.remain - a.remain);

  for(const it of candidates){
    if(need <= 0) break;
    const use = Math.min(it.remain, need);
    if(use > 0){
      it.remain -= use;
      picks.push({ baseName: it.name, name: it.name, blocks: use });
      need -= use;
    }
  }

  return { picks, missing: need };
}

// ミネラル在庫（個別）→ ミックス2種に圧縮（週固定）
// ★この関数に渡す mineralBaseInv には「ミネラル新食材」を入れない
function buildMineralMix(mineralBaseInv){
  const vegItems = mineralBaseInv.filter(x => !isFruit(x.name));
  const fruitItems = mineralBaseInv.filter(x => isFruit(x.name));

  const vegNames = [...vegItems].sort((a,b)=> b.remain - a.remain).slice(0,3).map(x=>x.name);
  const fruitNames = [...fruitItems].sort((a,b)=> b.remain - a.remain).slice(0,2).map(x=>x.name);

  const vegRemain = vegItems.reduce((s,x)=> s + x.remain, 0);
  const fruitRemain = fruitItems.reduce((s,x)=> s + x.remain, 0);

  const meta = {
    vegNames,
    fruitNames,
    vegMixName: vegNames.length ? `野菜ミックス(${vegNames.join("+")})` : "野菜ミックス(未選択)",
    fruitMixName: fruitNames.length ? `果物ミックス(${fruitNames.join("+")})` : "果物ミックス(なし)"
  };

  const mix = {
    veg: { name: meta.vegMixName, remain: vegRemain },
    fruit: { name: meta.fruitMixName, remain: fruitRemain }
  };

  return { mix, meta };
}

function allocMineralFromMix(mineralMix, totalNeedTsp, vegBaseTsp){
  let need = totalNeedTsp;
  const picks = [];

  const vegTarget = Math.min(need, vegBaseTsp);
  const vegUse = Math.min(mineralMix.veg.remain, vegTarget);
  if(vegUse > 0){
    mineralMix.veg.remain -= vegUse;
    need -= vegUse;
    picks.push({ name: mineralMix.veg.name, blocks: vegUse, mix: "veg" });
  }

  const fruitUse = Math.min(mineralMix.fruit.remain, need);
  if(fruitUse > 0){
    mineralMix.fruit.remain -= fruitUse;
    need -= fruitUse;
    picks.push({ name: mineralMix.fruit.name, blocks: fruitUse, mix: "fruit" });
  }

  // 合計が足りないなら、残ってる方で埋める
  if(need > 0){
    const pools = [
      { key:"veg", it:mineralMix.veg },
      { key:"fruit", it:mineralMix.fruit }
    ].filter(x => x.it.remain > 0).sort((a,b)=> b.it.remain - a.it.remain);

    for(const p of pools){
      if(need <= 0) break;
      const use = Math.min(p.it.remain, need);
      p.it.remain -= use;
      need -= use;

      const ex = picks.find(x => x.name === p.it.name);
      if(ex) ex.blocks += use;
      else picks.push({ name: p.it.name, blocks: use, mix: p.key });
    }
  }

  return { picks, missing: need };
}

function upsertAppend(picks, add){
  // name が同じならブロック加算
  const ex = picks.find(x => x.name === add.name);
  if(ex) ex.blocks += add.blocks;
  else picks.push(add);
}

export function generateWeeklyPlanWithInventory(customConfig = {}){
  const cfg = { ...DEFAULT_CONFIG, ...customConfig };
  cfg.mineralSinglesPolicy = { ...DEFAULT_CONFIG.mineralSinglesPolicy, ...(customConfig.mineralSinglesPolicy || {}) };

  const warnings = [];
  const errors = [];

  // 1) ベース在庫（チェック分）
  const inv = {
    carb: makeInventoryFromOverride(cfg.inventoryOverride?.carb, cfg.blocksPerIngredient),
    protein: makeInventoryFromOverride(cfg.inventoryOverride?.protein, cfg.blocksPerIngredient),
    // ★ミネラルは「ミックス用ベース在庫」（新食材は混ぜない）
    mineralBase: makeInventoryFromOverride(cfg.inventoryOverride?.mineral, cfg.blocksPerIngredient),
    // ★ミネラル単品（新食材など）用
    mineralSingles: []
  };

  // 2) 新食材ルール
  const rule = cfg.newFoodRule || { enabled:false };
  const categoryOf = rule.categoryOf || (()=>null);

  // 平日5日・1回目だけ使うので最大5つ
  const newQueue = Array.isArray(rule.queue) ? [...rule.queue].slice(0,5) : [];
  let newPtr = 0;

  // ★新食材は「週の在庫」として最初に8ブロック追加
  // - carb/protein はそれぞれの在庫へ
  // - mineral は mineralSingles へ（ミックスに入れない）
  const mineralNewSet = new Set();
  for(const nf of newQueue){
    const cat = categoryOf(nf);
    if(!cat) continue;
    if(cat === "mineral"){
      ensureInventoryItem(inv.mineralSingles, nf, cfg.blocksPerIngredient);
      mineralNewSet.add(nf);
    }else if(cat === "carb" || cat === "protein"){
      ensureInventoryItem(inv[cat], nf, cfg.blocksPerIngredient);
    }
  }

  // ミネラル新食材の「何回目」表示用カウンタ
  const mineralNewUseCount = new Map(); // baseName -> count
  const labelMineralNew = (baseName) => {
    const next = (mineralNewUseCount.get(baseName) || 0) + 1;
    mineralNewUseCount.set(baseName, next);
    if(next === 1) return `${baseName}(新)`;
    return `${baseName}(新${next}回目)`;
  };

  // 3) ミネラルミックスは「チェック在庫（mineralBase）」だけで固定
  const { mix: mineralMix, meta: mineralMixMeta } = buildMineralMix(inv.mineralBase);

  // 4) 割当
  const plan = [];
  const missingSum = { carb:0, protein:0, mineral:0 };

  let mealIndex = 0;

  for(const day of cfg.days){
    for(let mealNo=1; mealNo<=cfg.mealsPerDay; mealNo++){

      const targets = mealTargets(cfg, mealIndex);

      let need = {
        carb: tspToBlocks(targets.carb, cfg.blockSizeTsp.carb),
        protein: tspToBlocks(targets.protein, cfg.blockSizeTsp.protein),
        mineral: tspToBlocks(targets.mineral, cfg.blockSizeTsp.mineral)
      };

      const doNewFood =
        rule.enabled &&
        isWeekdayJP(day) &&
        (mealNo === (rule.mealNo || 1)) &&
        newPtr < newQueue.length;

      // 初回の同食で「新食材を追加で使わない」ための除外セット
      const exclude = { carb:new Set(), protein:new Set(), mineralSingles:new Set() };

      // 新食材（初回は必ず小さじ1のみ）
      let newFoodPick = null;

      if(doNewFood){
        const nf = newQueue[newPtr++];
        const cat = categoryOf(nf);

        if(!cat){
          warnings.push(`[${day}${mealNo}食] 新食材「${nf}」カテゴリ判定失敗`);
        }else{
          const blocks = tspToBlocks(rule.tsp ?? 1, cfg.blockSizeTsp[cat]); // 基本1
          newFoodPick = { name: `${nf}(新)`, baseName: nf, category: cat, blocks, isNew:true };

          if(cat === "mineral"){
            // ミネラル新食材は単品在庫から1だけ減らし、残りは「単品優先+ミックス」で補う
            const item = ensureInventoryItem(inv.mineralSingles, nf, cfg.blocksPerIngredient);
            item.remain = Math.max(0, item.remain - blocks);
            need.mineral = Math.max(0, need.mineral - blocks);

            // この食では「同じ新食材」を追加で使わない（初回は必ず1のみ）
            exclude.mineralSingles.add(nf);

            // 初回ラベルの回数も進める（(新)で統一したいのでここで1回消費として扱う）
            mineralNewUseCount.set(nf, 1);
          }else if(cat === "carb" || cat === "protein"){
            const item = ensureInventoryItem(inv[cat], nf, cfg.blocksPerIngredient);
            item.remain = Math.max(0, item.remain - blocks);
            need[cat] = Math.max(0, need[cat] - blocks);

            exclude[cat].add(nf); // 初回は追加で使わない
          }
        }
      }

      // 炭水化物 / タンパク：不足分は同カテゴリの他食材で補う
      const carbAlloc = allocateFromInventory(inv.carb, need.carb, exclude.carb);
      const proAlloc  = allocateFromInventory(inv.protein, need.protein, exclude.protein);

      if(carbAlloc.missing>0) missingSum.carb += carbAlloc.missing;
      if(proAlloc.missing>0)  missingSum.protein += proAlloc.missing;

      // ===== ミネラル：単品を優先しつつ、ミックスも必ず出す =====
      // ルール：
      // - 単品（mineralSingles）は「総ミネラルの maxSingleShare まで」
      // - かつ ミックスは minMixTsp 以上を保証（在庫がある限り）
      // - ミックスが足りない場合は、単品で補完（ただし初回の新食材は除外される）

      let mineralNeed = need.mineral;
      const mineralPicks = [];

      const maxSingle = Math.floor(mineralNeed * cfg.mineralSinglesPolicy.maxSingleShare);
      const minMix = Math.min(cfg.mineralSinglesPolicy.minMixTsp, mineralNeed);

      // まず「単品で入れてよい上限」を決める（ただしミックス最低量を残す）
      // mixNeededAtLeast = minMix
      // singleAllowed = mineralNeed - mixNeededAtLeast を超えない + maxSingle
      const singleAllowed = Math.max(0, Math.min(maxSingle, mineralNeed - minMix));

      // (A) 先に単品を singleAllowed だけ優先的に割り当て
      if(singleAllowed > 0){
        const singleAllocA = allocateFromInventory(inv.mineralSingles, singleAllowed, exclude.mineralSingles);

        for(const p of singleAllocA.picks){
          let displayName = p.baseName;
          if(mineralNewSet.has(p.baseName)){
            displayName = labelMineralNew(p.baseName);
          }
          mineralPicks.push({ name: displayName, baseName: p.baseName, blocks: p.blocks, single:true });
        }

        mineralNeed -= (singleAllowed - singleAllocA.missing);
      }

      // (B) 次にミックスで残りを割り当て（基本はここで埋まる）
      const mixAlloc = allocMineralFromMix(mineralMix, mineralNeed, cfg.mineralVegBase);
      for(const mp of mixAlloc.picks){
        mineralPicks.push(mp);
      }
      mineralNeed = mixAlloc.missing;

      // (C) それでも足りない場合は単品で補う（同カテゴリ補填）
      if(mineralNeed > 0){
        const singleAllocB = allocateFromInventory(inv.mineralSingles, mineralNeed, exclude.mineralSingles);

        for(const p of singleAllocB.picks){
          let displayName = p.baseName;
          if(mineralNewSet.has(p.baseName)){
            displayName = labelMineralNew(p.baseName);
          }
          mineralPicks.push({ name: displayName, baseName: p.baseName, blocks: p.blocks, single:true });
        }

        mineralNeed = singleAllocB.missing;
      }

      if(mineralNeed > 0) missingSum.mineral += mineralNeed;

      // 表示：新食材（初回）は先頭に出す（ミネラル新食材は単独で小さじ1）
      if(newFoodPick){
        if(newFoodPick.category==="carb") carbAlloc.picks.unshift({ name:newFoodPick.name, blocks:newFoodPick.blocks, isNew:true });
        if(newFoodPick.category==="protein") proAlloc.picks.unshift({ name:newFoodPick.name, blocks:newFoodPick.blocks, isNew:true });
        if(newFoodPick.category==="mineral") mineralPicks.unshift({ name:newFoodPick.name, blocks:newFoodPick.blocks, isNew:true });
      }

      const ok = (carbAlloc.missing===0 && proAlloc.missing===0 && mineralNeed===0);

      plan.push({
        day,
        meal: mealNo,
        ok,
        menuName: "献立",
        newFood: newFoodPick ? newFoodPick.baseName : null,
        targetsTsp: targets,
        blocks: {
          carb: carbAlloc.picks.map(x=>({ name:x.name, blocks:x.blocks })),
          protein: proAlloc.picks.map(x=>({ name:x.name, blocks:x.blocks })),
          mineral: mineralPicks.map(x=>({ name:x.name, blocks:x.blocks }))
        }
      });

      mealIndex++;
    }
  }

  // 5) 余り在庫
  const leftovers = {
    carb: inv.carb.filter(x=>x.remain>0).map(x=>({name:x.name, remainBlocks:x.remain})),
    protein: inv.protein.filter(x=>x.remain>0).map(x=>({name:x.name, remainBlocks:x.remain})),
    // ミネラルは「ミックス残り」＋「単品残り」を両方出す
    mineral: [
      ...(mineralMix.veg.remain>0 ? [{name:mineralMix.veg.name, remainBlocks:mineralMix.veg.remain}] : []),
      ...(mineralMix.fruit.remain>0 ? [{name:mineralMix.fruit.name, remainBlocks:mineralMix.fruit.remain}] : []),
      ...inv.mineralSingles.filter(x=>x.remain>0).map(x=>({name:`${x.name}(単品)`, remainBlocks:x.remain}))
    ]
  };

  // 6) 不足は実欠損のみ
  const shortageBlocks = {
    carb: missingSum.carb,
    protein: missingSum.protein,
    mineral: missingSum.mineral
  };

  if(shortageBlocks.carb>0) warnings.push(`炭水化物が不足：あと ${shortageBlocks.carb} ブロック`);
  if(shortageBlocks.protein>0) warnings.push(`タンパク質が不足：あと ${shortageBlocks.protein} ブロック`);
  if(shortageBlocks.mineral>0) warnings.push(`ミネラルが不足：あと ${shortageBlocks.mineral}（小さじ相当）`);

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