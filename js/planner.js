// js/planner.js
// v8（前提統一版）
// ✅ 全カテゴリ：1ブロック = 小さじ1（各食材は小さじ1×8ブロック）
// ✅ 新食材の初回（平日1回目）は必ず小さじ1のみ（全カテゴリ）
// ✅ 初回のその食では同じ新食材を追加で使わない（同カテゴリ他食材で補う）
// ✅ 新食材は在庫8ブロックとして追加 → 2回目以降は通常消費して使い切りやすい
// ✅ ミネラル：野菜ミックス(最大3) + 果物ミックス(最大2)は「チェック在庫のみ」で固定
// ✅ ミネラル新食材はミックスに入れない：単品として登場
// ✅ ミネラル単品（新食材など）は優先的に混ぜて消費するが、単品だけで枠を埋めない（偏り防止）
// ✅ 不足は「実際に埋められなかった量（小さじ）」のみ

export const DEFAULT_CONFIG = {
  phase: "中期",
  days: ["月","火","水","木","金","土","日"],
  mealsPerDay: 2,

  // 1食あたりの目安（小さじ）
  tspPerMeal: {
    carb: 10,
    protein: { min: 2, max: 3 },
    mineral: { min: 4, max: 6 }
  },

  // ★全カテゴリ：1ブロック=小さじ1
  blockSizeTsp: {
    carb: 1,
    protein: 1,
    mineral: 1
  },

  // 各食材の冷凍在庫（小さじ1×8ブロック）
  blocksPerIngredient: 8,

  // ミネラル（合計）のうち、まず野菜側で使いたい量（残りを果物へ）
  mineralVegBase: 4,

  // ミネラル単品をどれくらい混ぜるか（偏り防止）
  mineralSinglesPolicy: {
    // 1食のミネラル枠のうち、単品（新食材など）に回す最大割合
    maxSingleShare: 0.5,
    // 1食でミックスを最低この量は必ず出す（在庫がある限り）
    minMixTsp: 2
  }
};

function clampInt(n, min, max){ return Math.max(min, Math.min(max, n)); }
function isWeekdayJP(day){ return ["月","火","水","木","金"].includes(day); }

function mealTargets(cfg, mealIndex){
  // タンパクは交互に 2 / 3
  const protein = (mealIndex % 2 === 0) ? cfg.tspPerMeal.protein.min : cfg.tspPerMeal.protein.max;

  // ミネラルは 4〜6 の範囲で軽く揺らす（中心は5）
  const base = (cfg.tspPerMeal.mineral.min + cfg.tspPerMeal.mineral.max) / 2; // 5
  const mineral = clampInt(
    Math.round(base + ((mealIndex % 3) - 1) * 0.5),
    cfg.tspPerMeal.mineral.min,
    cfg.tspPerMeal.mineral.max
  );

  return { carb: cfg.tspPerMeal.carb, protein, mineral };
}

// ===== ミネラル：果物判定（あなたのリストに合わせたもの） =====
const FRUITS = new Set([
  "りんご","いちご","メロン","バナナ","すいか","梨","みかん","桃",
  "キウイ","ぶどう",
  "グレープフルーツ","アボカド","ブルーベリー","ラズベリー",
  "パイン"
]);
function isFruit(name){ return FRUITS.has(name); }

function makeInventoryFromOverride(list, defaultBlocks){
  return (list || []).map(x => ({
    name: x.name,
    remain: Number.isFinite(+x.blocks) ? +x.blocks : defaultBlocks
  }));
}

function ensureInventoryItem(invArr, name, blocksPerIngredient){
  let item = invArr.find(x => x.name === name);
  if(!item){
    item = { name, remain: blocksPerIngredient };
    // 新食材は使い切りたいので先頭に寄せる（次以降に登場しやすく）
    invArr.unshift(item);
  }
  return item;
}

// 在庫から必要量を割り当て（excludeSet の名前はこの食では使わない）
function allocateFromInventory(invArr, needBlocks, excludeSet){
  let need = needBlocks;
  const picks = [];

  // 使い切りやすさ：残量が多い順
  const candidates = [...invArr]
    .filter(x => x.remain > 0 && !excludeSet.has(x.name))
    .sort((a,b) => b.remain - a.remain);

  for(const it of candidates){
    if(need <= 0) break;
    const use = Math.min(it.remain, need);
    if(use > 0){
      it.remain -= use;
      need -= use;
      picks.push({ name: it.name, blocks: use });
    }
  }

  return { picks, missing: need };
}

// ミネラルミックスは「チェック在庫のみ」で固定（新食材は入れない）
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

// ミックスから必要量を割当（合計優先、野菜→果物の順）
function allocMineralFromMix(mix, needTsp, vegBaseTsp){
  let need = needTsp;
  const picks = [];

  const vegTarget = Math.min(need, vegBaseTsp);
  const vegUse = Math.min(mix.veg.remain, vegTarget);
  if(vegUse > 0){
    mix.veg.remain -= vegUse;
    need -= vegUse;
    picks.push({ name: mix.veg.name, blocks: vegUse, mix: "veg" });
  }

  const fruitUse = Math.min(mix.fruit.remain, need);
  if(fruitUse > 0){
    mix.fruit.remain -= fruitUse;
    need -= fruitUse;
    picks.push({ name: mix.fruit.name, blocks: fruitUse, mix: "fruit" });
  }

  // 合計が足りないなら残ってる方で埋める
  if(need > 0){
    const pools = [
      { key:"veg", it: mix.veg },
      { key:"fruit", it: mix.fruit }
    ].filter(p => p.it.remain > 0).sort((a,b)=> b.it.remain - a.it.remain);

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

// ミネラル新食材の「回数」表示
function makeMineralNewLabeler(mineralNewNames){
  const set = new Set(mineralNewNames);
  const cnt = new Map(); // name -> count
  return (name, isFirstLabel=false) => {
    if(!set.has(name)) return name; // 新食材じゃなければ素の名前
    if(isFirstLabel) return `${name}(新)`; // 初回は「(新)」
    const next = (cnt.get(name) || 1) + 1; // 初回は1扱いにして2回目から出す
    cnt.set(name, next);
    return `${name}(新${next}回目)`;
  };
}

// ===== メイン =====
export function generateWeeklyPlanWithInventory(customConfig = {}){
  const cfg = { ...DEFAULT_CONFIG, ...customConfig };
  cfg.mineralSinglesPolicy = { ...DEFAULT_CONFIG.mineralSinglesPolicy, ...(customConfig.mineralSinglesPolicy || {}) };

  const warnings = [];
  const errors = [];

  // 1) 在庫（チェック分）
  const inv = {
    carb: makeInventoryFromOverride(cfg.inventoryOverride?.carb, cfg.blocksPerIngredient),
    protein: makeInventoryFromOverride(cfg.inventoryOverride?.protein, cfg.blocksPerIngredient),
    // ミネラル：ミックス用（チェック分のみ）
    mineralBase: makeInventoryFromOverride(cfg.inventoryOverride?.mineral, cfg.blocksPerIngredient),
    // ミネラル：単品用（新食材など）
    mineralSingles: []
  };

  // 2) 新食材ルール
  const rule = cfg.newFoodRule || { enabled:false };
  const categoryOf = rule.categoryOf || (()=>null);

  // 平日5日の1回目だけ → 最大5つ
  const newQueue = Array.isArray(rule.queue) ? [...rule.queue].slice(0,5) : [];
  let newPtr = 0;

  // ★新食材は「週の在庫」として先に8ブロック追加
  // ただしミネラル新食材はミックスに入れず、単品在庫へ
  const mineralNewNames = [];
  for(const nf of newQueue){
    const cat = categoryOf(nf);
    if(!cat) continue;

    if(cat === "mineral"){
      ensureInventoryItem(inv.mineralSingles, nf, cfg.blocksPerIngredient);
      mineralNewNames.push(nf);
    }else if(cat === "carb" || cat === "protein"){
      ensureInventoryItem(inv[cat], nf, cfg.blocksPerIngredient);
    }
  }

  const labelMineralNew = makeMineralNewLabeler(mineralNewNames);

  // 3) ミネラルミックス構築（固定）
  const { mix: mineralMix, meta: mineralMixMeta } = buildMineralMix(inv.mineralBase);

  // 4) 生成
  const plan = [];
  const missingSum = { carb:0, protein:0, mineral:0 };

  let mealIndex = 0;

  for(const day of cfg.days){
    for(let mealNo=1; mealNo<=cfg.mealsPerDay; mealNo++){

      const targets = mealTargets(cfg, mealIndex);

      // need は全部「小さじ＝ブロック」
      let need = {
        carb: targets.carb,
        protein: targets.protein,
        mineral: targets.mineral
      };

      // 初回の同食で「新食材を追加で使わない」除外
      const exclude = {
        carb: new Set(),
        protein: new Set(),
        mineralSingles: new Set()
      };

      // この食の新食材（初回は必ず小さじ1）
      let newPick = null;       // {name, blocks, category}
      let newCat = null;
      let newName = null;

      const doNew =
        rule.enabled &&
        isWeekdayJP(day) &&
        (mealNo === (rule.mealNo || 1)) &&
        newPtr < newQueue.length;

      if(doNew){
        newName = newQueue[newPtr++];
        newCat = categoryOf(newName);

        if(!newCat){
          warnings.push(`[${day}${mealNo}食] 新食材「${newName}」カテゴリ判定失敗`);
        }else{
          const one = 1; // ★初回は必ず小さじ1

          if(newCat === "mineral"){
            // 単品在庫から1消費（その食では追加消費しない）
            const item = ensureInventoryItem(inv.mineralSingles, newName, cfg.blocksPerIngredient);
            if(item.remain > 0){
              item.remain -= one;
              need.mineral = Math.max(0, need.mineral - one);
            }else{
              // 在庫が0でも表示は出す（不足は後段で同カテゴリ補填→ダメなら不足）
              need.mineral = Math.max(0, need.mineral - one);
            }

            exclude.mineralSingles.add(newName);
            newPick = { name: `${newName}(新)`, blocks: 1, category: "mineral", isNew:true };

            // 初回カウントを1にしておく（2回目以降に(新2回目)）
            // makeMineralNewLabeler は「初回=1」扱いで進めるのでここは何もしなくてOK

          } else if(newCat === "carb" || newCat === "protein"){
            const item = ensureInventoryItem(inv[newCat], newName, cfg.blocksPerIngredient);
            if(item.remain > 0){
              item.remain -= one;
              need[newCat] = Math.max(0, need[newCat] - one);
            }else{
              need[newCat] = Math.max(0, need[newCat] - one);
            }

            // ★初回のその食では追加で使わない
            exclude[newCat].add(newName);

            newPick = { name: `${newName}(新)`, blocks: 1, category: newCat, isNew:true };
          }
        }
      }

      // 炭水化物 / タンパク：不足分は同カテゴリ他食材で補う（初回の新食材は除外）
      const carbAlloc = allocateFromInventory(inv.carb, need.carb, exclude.carb);
      const proAlloc  = allocateFromInventory(inv.protein, need.protein, exclude.protein);

      // ミネラル：単品優先（ただしミックス最低保証）→ ミックス → 足りなきゃ単品で補填
      let mineralNeed = need.mineral;
      const mineralPicks = [];

      // 単品で使う量を決める（単品だけで埋めない）
      const maxSingle = Math.floor(mineralNeed * cfg.mineralSinglesPolicy.maxSingleShare);
      const minMix = Math.min(cfg.mineralSinglesPolicy.minMixTsp, mineralNeed);

      // ミックス最低量を確保したうえで、単品に回せる上限
      const singleAllowed = Math.max(0, Math.min(maxSingle, mineralNeed - minMix));

      // (A) 単品を先に少し使う（ただし初回の新食材は除外）
      if(singleAllowed > 0){
        const s1 = allocateFromInventory(inv.mineralSingles, singleAllowed, exclude.mineralSingles);

        for(const p of s1.picks){
          // 新食材の単品は「(新2回目)」などを付ける（初回は別で(新)を出しているため）
          const display = mineralNewNames.includes(p.name) ? labelMineralNew(p.name, false) : p.name;
          mineralPicks.push({ name: display, blocks: p.blocks, single:true });
        }

        mineralNeed -= (singleAllowed - s1.missing);
      }

      // (B) ミックスで残りを埋める
      const mx = allocMineralFromMix(mineralMix, mineralNeed, cfg.mineralVegBase);
      mineralPicks.push(...mx.picks);
      mineralNeed = mx.missing;

      // (C) それでも足りないなら単品で補填（同カテゴリ補填）
      if(mineralNeed > 0){
        const s2 = allocateFromInventory(inv.mineralSingles, mineralNeed, exclude.mineralSingles);

        for(const p of s2.picks){
          const display = mineralNewNames.includes(p.name) ? labelMineralNew(p.name, false) : p.name;
          mineralPicks.push({ name: display, blocks: p.blocks, single:true });
        }

        mineralNeed = s2.missing;
      }

      // 不足（実欠損のみ）
      if(carbAlloc.missing > 0) missingSum.carb += carbAlloc.missing;
      if(proAlloc.missing  > 0) missingSum.protein += proAlloc.missing;
      if(mineralNeed       > 0) missingSum.mineral += mineralNeed;

      // 表示：新食材は該当カテゴリにだけ先頭追加（混入なし）
      if(newPick){
        if(newPick.category === "carb") carbAlloc.picks.unshift(newPick);
        if(newPick.category === "protein") proAlloc.picks.unshift(newPick);
        if(newPick.category === "mineral") mineralPicks.unshift(newPick);
      }

      const okThisMeal = (carbAlloc.missing===0 && proAlloc.missing===0 && mineralNeed===0);

      plan.push({
        day,
        meal: mealNo,
        ok: okThisMeal,
        menuName: "献立",
        newFood: newPick ? (newName || null) : null,
        targetsTsp: targets,
        blocks: {
          carb: carbAlloc.picks,
          protein: proAlloc.picks,
          mineral: mineralPicks
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

  if(shortageBlocks.carb>0) warnings.push(`炭水化物が不足：あと ${shortageBlocks.carb}（小さじ）`);
  if(shortageBlocks.protein>0) warnings.push(`タンパク質が不足：あと ${shortageBlocks.protein}（小さじ）`);
  if(shortageBlocks.mineral>0) warnings.push(`ミネラルが不足：あと ${shortageBlocks.mineral}（小さじ）`);

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