// js/planner.js
// 完全整理版 v3
// ✅ 新食材は「初回（平日1回目）」は必ず小さじ1のみ
// ✅ 初回の不足分は同カテゴリの他食材で補う（初回は新食材を追加で使わない）
// ✅ 新食材は在庫8ブロックとして追加 → 2回目以降は通常在庫として消費され、週内で使い切れる
// ✅ ミネラルは「野菜ミックス(最大3種)」「果物ミックス(最大2種)」固定で週内同じものを使う
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
function totalMeals(cfg){ return cfg.days.length * cfg.mealsPerDay; }

function clampInt(n,min,max){ return Math.max(min, Math.min(max,n)); }

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
    // 新食材は使い切りたいので先頭に寄せる（2回目以降に登場しやすくする）
    invArr.unshift(item);
  }
  return item;
}

function isWeekdayJP(day){ return ["月","火","水","木","金"].includes(day); }

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
      picks.push({ name: it.name, blocks: use });
      need -= use;
    }
  }

  return { picks, missing: need };
}

// ミネラル在庫（個別）→ ミックス2種に圧縮（週固定）
function buildMineralMix(mineralInv){
  const vegItems = mineralInv.filter(x => !isFruit(x.name));
  const fruitItems = mineralInv.filter(x => isFruit(x.name));

  // 週固定の構成：残量が多い順に最大 野菜3 / 果物2
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

function allocMineralMix(mineralMix, totalNeedTsp, vegBaseTsp){
  // まず野菜枠（最大 vegBaseTsp）、残りを果物へ。足りなければ合計優先で残ってる方から埋める
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

  // 合計が足りないなら、残ってる方で埋める（余りがあるなら不足にしない）
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

// ===== メイン =====
export function generateWeeklyPlanWithInventory(customConfig = {}){
  const cfg = { ...DEFAULT_CONFIG, ...customConfig };

  const warnings = [];
  const errors = [];

  // 1) ベース在庫
  const inv = {
    carb: makeInventoryFromOverride(cfg.inventoryOverride?.carb, cfg.blocksPerIngredient),
    protein: makeInventoryFromOverride(cfg.inventoryOverride?.protein, cfg.blocksPerIngredient),
    mineral: makeInventoryFromOverride(cfg.inventoryOverride?.mineral, cfg.blocksPerIngredient)
  };

  // 2) 新食材ルール
  const rule = cfg.newFoodRule || { enabled:false };
  const categoryOf = rule.categoryOf || (()=>null);

  // 平日5日・1回目だけ使うので最大5つ
  const newQueue = Array.isArray(rule.queue) ? [...rule.queue].slice(0,5) : [];

  // ★ポイント：新食材は「週の在庫」として最初に8ブロック追加しておく（使い切り対象にする）
  // ただし「初回のその食」では小さじ1以外使わない（後で除外する）
  for(const nf of newQueue){
    const cat = categoryOf(nf);
    if(!cat) continue;

    if(cat === "mineral"){
      // ミネラルは後でミックス化するので、個別在庫に追加しておく
      ensureInventoryItem(inv.mineral, nf, cfg.blocksPerIngredient);
    }else{
      ensureInventoryItem(inv[cat], nf, cfg.blocksPerIngredient);
    }
  }

  // 3) ミネラルをミックス化（週固定）
  const { mix: mineralMix, meta: mineralMixMeta } = buildMineralMix(inv.mineral);

  // 4) 割当
  const plan = [];
  const missingSum = { carb:0, protein:0, mineral:0 };

  let mealIndex = 0;

  // 「初回（平日1回目）」で使う新食材を順番に取り出すためのポインタ
  let newPtr = 0;

  for(const day of cfg.days){
    for(let mealNo=1; mealNo<=cfg.mealsPerDay; mealNo++){

      const targets = mealTargets(cfg, mealIndex);

      let need = {
        carb: tspToBlocks(targets.carb, cfg.blockSizeTsp.carb),
        protein: tspToBlocks(targets.protein, cfg.blockSizeTsp.protein),
        mineral: tspToBlocks(targets.mineral, cfg.blockSizeTsp.mineral)
      };

      // この食で「新食材小さじ1」を入れるか？
      const doNewFood =
        rule.enabled &&
        isWeekdayJP(day) &&
        (mealNo === (rule.mealNo || 1)) &&
        newPtr < newQueue.length;

      // 初回の同食で「新食材を追加で使わない」ための除外セット
      const exclude = {
        carb: new Set(),
        protein: new Set()
      };

      // 新食材（初回は必ず小さじ1のみ）
      let newFoodPick = null;

      if(doNewFood){
        const nf = newQueue[newPtr++];
        const cat = categoryOf(nf);

        if(!cat){
          warnings.push(`[${day}${mealNo}食] 新食材「${nf}」カテゴリ判定失敗`);
        }else{
          const blocks = tspToBlocks(rule.tsp ?? 1, cfg.blockSizeTsp[cat]); // 基本1

          newFoodPick = { name: nf, category: cat, blocks, isNew:true };

          if(cat === "mineral"){
            // ミネラル：ミックス在庫から1だけ減らす（残りはミックスで補う）
            if(isFruit(nf)){
              mineralMix.fruit.remain = Math.max(0, mineralMix.fruit.remain - blocks);
            }else{
              mineralMix.veg.remain = Math.max(0, mineralMix.veg.remain - blocks);
            }
            need.mineral = Math.max(0, need.mineral - blocks);
          }else{
            // carb / protein：在庫から1だけ減らす（初回はこの食で追加消費しない）
            const item = ensureInventoryItem(inv[cat], nf, cfg.blocksPerIngredient);
            item.remain = Math.max(0, item.remain - blocks);
            need[cat] = Math.max(0, need[cat] - blocks);

            // ★ここが要件：「初回は必ず小さじ1のみ」→ この食では新食材を割当対象から外す
            exclude[cat].add(nf);
          }
        }
      }

      // 炭水化物 / タンパク：不足分は同カテゴリの他食材で補う
      const carbAlloc = allocateFromInventory(inv.carb, need.carb, exclude.carb);
      const proAlloc  = allocateFromInventory(inv.protein, need.protein, exclude.protein);

      if(carbAlloc.missing>0) missingSum.carb += carbAlloc.missing;
      if(proAlloc.missing>0)  missingSum.protein += proAlloc.missing;

      // ミネラル：残りをミックスで補う（合計優先）
      const mineralAlloc = allocMineralMix(mineralMix, need.mineral, cfg.mineralVegBase);
      if(mineralAlloc.missing>0) missingSum.mineral += mineralAlloc.missing;

      // 表示：新食材を先頭に出す（初回は1だけ）
      if(newFoodPick){
        if(newFoodPick.category==="carb") carbAlloc.picks.unshift(newFoodPick);
        if(newFoodPick.category==="protein") proAlloc.picks.unshift(newFoodPick);
        if(newFoodPick.category==="mineral") mineralAlloc.picks.unshift(newFoodPick);
      }

      const ok = (carbAlloc.missing===0 && proAlloc.missing===0 && mineralAlloc.missing===0);

      plan.push({
        day,
        meal: mealNo,
        ok,
        menuName: "献立",
        newFood: newFoodPick ? newFoodPick.name : null,
        targetsTsp: targets,
        blocks: {
          carb: carbAlloc.picks,
          protein: proAlloc.picks,
          mineral: mineralAlloc.picks
        }
      });

      mealIndex++;
    }
  }

  // 5) 余り在庫
  const leftovers = {
    carb: inv.carb.filter(x=>x.remain>0).map(x=>({name:x.name, remainBlocks:x.remain})),
    protein: inv.protein.filter(x=>x.remain>0).map(x=>({name:x.name, remainBlocks:x.remain})),
    mineral: [
      ...(mineralMix.veg.remain>0 ? [{name:mineralMix.veg.name, remainBlocks:mineralMix.veg.remain}] : []),
      ...(mineralMix.fruit.remain>0 ? [{name:mineralMix.fruit.name, remainBlocks:mineralMix.fruit.remain}] : [])
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