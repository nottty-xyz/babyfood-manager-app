// js/planner.js
// 仕様
// - 在庫（チェックした食材×8ブロック）で1週間(7日×2回食)を組む
// - 平日1回目だけ新食材(小さじ1)を差し込む
// - ★ミネラルは「野菜ミックス(最大3種)」「果物ミックス(最大2種)」に変換して1週間同じものを使う
//   例：目安ミネラル6なら 野菜4 + 果物2（合計6）
// - ★矛盾修正：余りが出る（=新食材在庫がある）なら不足にしない（不足計算に新食材8ブロックも含める）

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

  blocksPerIngredient: 8,

  maxKindsPerMeal: {
    carb: 2,
    protein: 2,
    mineral: 2 // ★ミネラルは「野菜ミックス」「果物ミックス」2種になる前提
  },

  autoRelaxMaxKinds: true,
  avoidRepeat: true,

  // ミネラル内訳（合計=mineral）
  // デフォルト：野菜4、残りを果物に（0〜2）
  mineralSplit: {
    vegTspBase: 4
  }
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
  const vegMix = mineralPicks.find(x=>String(x.name||"").startsWith("野菜ミックス"))?.name || "野菜";
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

// ===== ミネラルの「果物判定」 =====
const FRUITS = new Set([
  "りんご","いちご","メロン","バナナ","すいか","梨","みかん","桃",
  "キウイ","ぶどう",
  "グレープフルーツ","アボカド","ブルーベリー","ラズベリー",
  "パイン"
]);

function isFruit(name){
  return FRUITS.has(name);
}

// ミネラル在庫（個別食材）→ 野菜ミックス/果物ミックス 2アイテムに変換（1週間固定の配合名）
function buildMineralMixInventory(mineralInv, cfg){
  const veg = [];
  const fruit = [];
  for(const it of mineralInv){
    (isFruit(it.name) ? fruit : veg).push(it);
  }

  // 名前は「在庫の残りが多い順」から固定選定（最大：野菜3、果物2）
  const byRemainDesc = (a,b)=> b.remain - a.remain;

  const vegNames = [...veg].sort(byRemainDesc).slice(0,3).map(x=>x.name);
  const fruitNames = [...fruit].sort(byRemainDesc).slice(0,2).map(x=>x.name);

  const vegSum = veg.reduce((s,x)=> s + x.remain, 0);
  const fruitSum = fruit.reduce((s,x)=> s + x.remain, 0);

  const inv = [];
  const meta = {
    vegMixName: vegNames.length ? `野菜ミックス(${vegNames.join("+")})` : "野菜ミックス(未選択)",
    fruitMixName: fruitNames.length ? `果物ミックス(${fruitNames.join("+")})` : "果物ミックス(なし)",
    vegNames,
    fruitNames,
    vegAvailable: vegSum,
    fruitAvailable: fruitSum
  };

  if(vegSum>0){
    inv.push({ name: meta.vegMixName, remain: vegSum, _mixType:"veg" });
  }
  if(fruitSum>0){
    inv.push({ name: meta.fruitMixName, remain: fruitSum, _mixType:"fruit" });
  }

  return { mineralMixInv: inv, mineralMixMeta: meta };
}

// ===== 必要/在庫/不足ブロック（カテゴリ合計） =====

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

  if(invRaw.carb.length===0) warnings.push("炭水化物の在庫が0です（チェックしてください）");
  if(invRaw.protein.length===0) warnings.push("タンパク質の在庫が0です（チェックしてください）");
  if(invRaw.mineral.length===0) warnings.push("ミネラルの在庫が0です（チェックしてください）");

  // ★ミネラルはミックス化して使う
  const { mineralMixInv, mineralMixMeta } = buildMineralMixInventory(invRaw.mineral, cfg);
  const inv = {
    carb: invRaw.carb,
    protein: invRaw.protein,
    mineral: mineralMixInv
  };

  if(mineralMixInv.length===0){
    warnings.push("ミネラルの在庫が0です（チェックしてください）");
  }else{
    if(mineralMixMeta.vegNames.length===0) warnings.push("野菜ミックスの材料が足りません（野菜系ミネラルをチェックしてね）");
    if(mineralMixMeta.fruitNames.length===0) warnings.push("果物ミックスが作れません（果物をチェックしてね / 果物なしでも生成はできます）");
  }

  const newRule = cfg.newFoodRule || { enabled:false };
  const newQueue = Array.isArray(newRule.queue) ? [...newRule.queue] : [];
  const categoryOf = newRule.categoryOf || (()=>null);

  // ★新食材の在庫（8ブロック）を別枠で持つ
  // さらに「不足計算に足すための追加在庫ブロック」もカテゴリ別に積む
  const newFoodStock = new Map(); // key: `${cat}::${name}` -> remainBlocks
  const newFoodAddedBlocks = { carb:0, protein:0, mineral:0 };

  const ensureNewFoodStock = (cat, name) => {
    const key = `${cat}::${name}`;
    if(!newFoodStock.has(key)){
      newFoodStock.set(key, cfg.blocksPerIngredient);
      newFoodAddedBlocks[cat] += cfg.blocksPerIngredient;
    }
    return key;
  };

  // 新食材がミネラルの場合は「野菜ミックス or 果物ミックス」の在庫に足す（固定ミックスとして同週使用する想定）
  const addMineralNewFoodToMix = (name) => {
    // 新食材をミックス構成に含める（表記のため）
    if(isFruit(name)){
      if(!mineralMixMeta.fruitNames.includes(name) && mineralMixMeta.fruitNames.length < 2) {
        mineralMixMeta.fruitNames.push(name);
      }
      mineralMixMeta.fruitMixName = mineralMixMeta.fruitNames.length
        ? `果物ミックス(${mineralMixMeta.fruitNames.join("+")})`
        : "果物ミックス(なし)";
    }else{
      if(!mineralMixMeta.vegNames.includes(name) && mineralMixMeta.vegNames.length < 3) {
        mineralMixMeta.vegNames.push(name);
      }
      mineralMixMeta.vegMixName = mineralMixMeta.vegNames.length
        ? `野菜ミックス(${mineralMixMeta.vegNames.join("+")})`
        : "野菜ミックス(未選択)";
    }

    // ミックス在庫（remain）に8ブロック追加（作り置きした扱い）
    const targetName = isFruit(name) ? mineralMixMeta.fruitMixName : mineralMixMeta.vegMixName;
    let item = inv.mineral.find(x => x._mixType === (isFruit(name) ? "fruit" : "veg"));
    if(!item){
      item = { name: targetName, remain: 0, _mixType: isFruit(name) ? "fruit" : "veg" };
      inv.mineral.push(item);
    }
    // 名前更新（構成名が変わるので）
    item.name = targetName;
    item.remain += cfg.blocksPerIngredient;

    // 不足計算に加える（ミネラル在庫が増えた）
    newFoodAddedBlocks.mineral += cfg.blocksPerIngredient;
  };

  const plan = [];
  let recent = { carb:new Set(), protein:new Set(), mineral:new Set() };

  const meals = totalMeals(cfg);
  let mealIndex = 0;

  for(const day of cfg.days){
    for(let mealNo=1; mealNo<=cfg.mealsPerDay; mealNo++){

      const t = mealTargets(cfg, mealIndex);

      // 1食あたり必要ブロック（ミネラルは後で「野菜/果物」に配分）
      const need = {
        carb: tspToBlocks(t.carb, cfg.blockSizeTsp.carb),
        protein: tspToBlocks(t.protein, cfg.blockSizeTsp.protein),
        mineral: tspToBlocks(t.mineral, cfg.blockSizeTsp.mineral)
      };

      // ★ミネラル配分：野菜4、残りを果物（0〜2）に
      const vegBase = cfg.mineralSplit?.vegTspBase ?? 4;
      const vegNeed = Math.min(need.mineral, vegBase);
      const fruitNeed = Math.max(0, need.mineral - vegNeed);

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
              // ミネラル新食材は「ミックス化して在庫に追加→そこから消費」扱い
              addMineralNewFoodToMix(nf);

              // どっち（野菜/果物）に割り当てるかで差し引き
              if(isFruit(nf)){
                // 果物枠から差し引き（なければ野菜枠から）
                // fruitNeedは0〜2想定なので、まずfruitNeedから引く
                // ※引けない分はveg側から引く
                let fn = fruitNeed;
                let vn = vegNeed;
                if(fn >= blocks){
                  // ok
                }else{
                  const rest = blocks - fn;
                  fn = 0;
                  vn = Math.max(0, vn - rest);
                }
                // 後でallocateするためにローカル変数で持つ必要があるので、下で再代入する
                // （このスコープではconstなので、下で別変数を使う）
              }else{
                // 野菜枠から差し引き、足りなければ果物枠から
                // 同様に下で調整
              }
            } else {
              // carb/protein 新食材は「別枠8ブロック在庫」を作って消費する（余り表示＆不足計算に含める）
              const key = ensureNewFoodStock(cat, nf);
              newFoodStock.set(key, Math.max(0, newFoodStock.get(key) - blocks));
              need[cat] = Math.max(0, need[cat] - blocks);
            }
          }
        }
      }

      // ★ミネラル配分の確定（新食材がミネラルの場合に差し引く）
      let vegNeedFinal = vegNeed;
      let fruitNeedFinal = fruitNeed;

      if(newFoodPick && newFoodPick.category === "mineral"){
        const blocks = newFoodPick.blocks;
        if(isFruit(newFoodPick.name)){
          if(fruitNeedFinal >= blocks){
            fruitNeedFinal -= blocks;
          }else{
            const rest = blocks - fruitNeedFinal;
            fruitNeedFinal = 0;
            vegNeedFinal = Math.max(0, vegNeedFinal - rest);
          }
        }else{
          if(vegNeedFinal >= blocks){
            vegNeedFinal -= blocks;
          }else{
            const rest = blocks - vegNeedFinal;
            vegNeedFinal = 0;
            fruitNeedFinal = Math.max(0, fruitNeedFinal - rest);
          }
        }

        // ミネラル新食材はミックス在庫から消費する（=合計のinv.mineralから allocate で引ける形にする）
        // ここでは「表示のため」に newFoodPick を残すだけで、消費は allocate 経由で行う。
      }

      // allocate（炭水化物/タンパク）
      const carbAlloc = allocate(inv.carb, need.carb, cfg.maxKindsPerMeal.carb, {
        recentlyUsedSet: recent.carb, avoidRepeat: cfg.avoidRepeat, autoRelaxMaxKinds: cfg.autoRelaxMaxKinds
      });
      const proAlloc = allocate(inv.protein, need.protein, cfg.maxKindsPerMeal.protein, {
        recentlyUsedSet: recent.protein, avoidRepeat: cfg.avoidRepeat, autoRelaxMaxKinds: cfg.autoRelaxMaxKinds
      });

      // ★ミネラルは「野菜ミックス」「果物ミックス」へ分けて消費
      const vegItem = inv.mineral.find(x=>x._mixType==="veg");
      const fruitItem = inv.mineral.find(x=>x._mixType==="fruit");

      const mineralPicks = [];
      let mineralOk = true;

      // 野菜ミックス消費
      if(vegNeedFinal > 0){
        if(vegItem && vegItem.remain >= vegNeedFinal){
          vegItem.remain -= vegNeedFinal;
          mineralPicks.push({ name: vegItem.name, blocks: vegNeedFinal, mix:"veg" });
        }else{
          mineralOk = false;
          mineralPicks.push({ name: vegItem?.name || "野菜ミックス(不足)", blocks: Math.min(vegItem?.remain||0, vegNeedFinal), mix:"veg" });
          if(vegItem) vegItem.remain = 0;
          warnings.push(`[${day}${mealNo}食] ミネラル(野菜ミックス)が不足：あと ${Math.max(0, vegNeedFinal - (vegItem?.remain||0))} 小さじ相当`);
        }
      }

      // 果物ミックス消費
      if(fruitNeedFinal > 0){
        if(fruitItem && fruitItem.remain >= fruitNeedFinal){
          fruitItem.remain -= fruitNeedFinal;
          mineralPicks.push({ name: fruitItem.name, blocks: fruitNeedFinal, mix:"fruit" });
        }else{
          mineralOk = false;
          mineralPicks.push({ name: fruitItem?.name || "果物ミックス(不足)", blocks: Math.min(fruitItem?.remain||0, fruitNeedFinal), mix:"fruit" });
          if(fruitItem) fruitItem.remain = 0;
          warnings.push(`[${day}${mealNo}食] ミネラル(果物ミックス)が不足：あと ${Math.max(0, fruitNeedFinal - (fruitItem?.remain||0))} 小さじ相当`);
        }
      }

      if(!carbAlloc.ok) warnings.push(`[${day}${mealNo}食] 炭水化物: ${carbAlloc.reason}`);
      if(!proAlloc.ok) warnings.push(`[${day}${mealNo}食] タンパク: ${proAlloc.reason}`);

      // 表示：新食材は先頭に付ける
      if(newFoodPick){
        if(newFoodPick.category==="carb") carbAlloc.picks.unshift({ name:newFoodPick.name, blocks:newFoodPick.blocks, isNew:true });
        if(newFoodPick.category==="protein") proAlloc.picks.unshift({ name:newFoodPick.name, blocks:newFoodPick.blocks, isNew:true });
        if(newFoodPick.category==="mineral") mineralPicks.unshift({ name:newFoodPick.name, blocks:newFoodPick.blocks, isNew:true });
      }

      const name = menuName(carbAlloc.picks, proAlloc.picks, mineralPicks, cfg.phase);

      plan.push({
        day, meal: mealNo,
        ok: carbAlloc.ok && proAlloc.ok && mineralOk,
        menuName: name,
        newFood: newFoodPick ? newFoodPick.name : null,
        targetsTsp: t,
        // ★ミネラルは blocks=小さじ（blockSizeTsp.mineral=1 前提）
        blocks: { carb: carbAlloc.picks, protein: proAlloc.picks, mineral: mineralPicks },
        mineralDetail: {
          vegTsp: vegNeedFinal,
          fruitTsp: fruitNeedFinal
        }
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

  // leftovers（通常在庫）
  const leftovers = {
    carb: invRaw.carb.map(x=>({name:x.name, remainBlocks:x.remain})).filter(x=>x.remainBlocks>0),
    protein: invRaw.protein.map(x=>({name:x.name, remainBlocks:x.remain})).filter(x=>x.remainBlocks>0),
    // ★ミネラルはミックス在庫の残りを出す
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

  // ===== 不足計算（矛盾修正：新食材8ブロックも available に含める） =====
  const requiredBlocksPerWeek = calcRequiredBlocksPerWeek(cfg);

  const baseAvailable = sumAvailableBlocks(cfg.inventoryOverride || {});
  const availableBlocks = {
    carb: baseAvailable.carb + newFoodAddedBlocks.carb,
    protein: baseAvailable.protein + newFoodAddedBlocks.protein,
    mineral: baseAvailable.mineral + newFoodAddedBlocks.mineral
  };

  const shortageBlocks = {
    carb: Math.max(0, requiredBlocksPerWeek.carb - availableBlocks.carb),
    protein: Math.max(0, requiredBlocksPerWeek.protein - availableBlocks.protein),
    mineral: Math.max(0, requiredBlocksPerWeek.mineral - availableBlocks.mineral)
  };

  if(shortageBlocks.carb > 0) warnings.push(`炭水化物が不足：あと ${shortageBlocks.carb} ブロック必要`);
  if(shortageBlocks.protein > 0) warnings.push(`タンパク質が不足：あと ${shortageBlocks.protein} ブロック必要`);
  if(shortageBlocks.mineral > 0) warnings.push(`ミネラルが不足：あと ${shortageBlocks.mineral} ブロック必要`);

  return {
    ok: errors.length===0,
    config: cfg,
    plan,
    leftovers,
    warnings,
    errors,
    requiredBlocksPerWeek,
    availableBlocks,
    shortageBlocks,
    mineralMixMeta
  };
}