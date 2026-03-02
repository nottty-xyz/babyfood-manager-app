// js/planner.js
// 安定版：不足＝実際に埋められなかった量のみ

export const DEFAULT_CONFIG = {
  phase: "中期",
  days: ["月","火","水","木","金","土","日"],
  mealsPerDay: 2,

  tspPerMeal: {
    carb: 10,
    protein: { min: 2, max: 3 },
    mineral: { min: 4, max: 6 }
  },

  blockSizeTsp: {
    carb: 10,
    protein: 1,
    mineral: 1
  },

  blocksPerIngredient: 8,

  mineralVegBase: 4
};

function clone(o){ return JSON.parse(JSON.stringify(o)); }
function deepMerge(a,b){ return Object.assign(clone(a),b||{}); }
function tspToBlocks(tsp,size){ return Math.ceil(tsp/size); }
function totalMeals(cfg){ return cfg.days.length * cfg.mealsPerDay; }

function mealTargets(cfg,i){
  const p = (i%2===0)?cfg.tspPerMeal.protein.min:cfg.tspPerMeal.protein.max;
  const mBase = (cfg.tspPerMeal.mineral.min+cfg.tspPerMeal.mineral.max)/2;
  return {
    carb: cfg.tspPerMeal.carb,
    protein: p,
    mineral: Math.round(mBase)
  };
}

const FRUITS = new Set([
  "りんご","いちご","メロン","バナナ","すいか","梨","みかん","桃",
  "キウイ","ぶどう","グレープフルーツ","アボカド",
  "ブルーベリー","ラズベリー","パイン"
]);

function isFruit(n){ return FRUITS.has(n); }

function makeInventory(list,blocks){
  return (list||[]).map(x=>({
    name:x.name,
    remain:Number.isFinite(+x.blocks)?+x.blocks:blocks
  }));
}

export function generateWeeklyPlanWithInventory(customConfig={}){

  const cfg = deepMerge(DEFAULT_CONFIG,customConfig);
  const warnings = [];

  const inv = {
    carb: makeInventory(cfg.inventoryOverride?.carb,cfg.blocksPerIngredient),
    protein: makeInventory(cfg.inventoryOverride?.protein,cfg.blocksPerIngredient),
    mineral: makeInventory(cfg.inventoryOverride?.mineral,cfg.blocksPerIngredient)
  };

  // ===== ミネラルミックス作成 =====
  const veg = inv.mineral.filter(x=>!isFruit(x.name));
  const fruit = inv.mineral.filter(x=>isFruit(x.name));

  const vegNames = veg.slice(0,3).map(x=>x.name);
  const fruitNames = fruit.slice(0,2).map(x=>x.name);

  const vegRemain = veg.reduce((s,x)=>s+x.remain,0);
  const fruitRemain = fruit.reduce((s,x)=>s+x.remain,0);

  const mineralMix = {
    veg:{ name:`野菜ミックス(${vegNames.join("+")})`, remain:vegRemain },
    fruit:{ name:`果物ミックス(${fruitNames.join("+")})`, remain:fruitRemain }
  };

  // ===== 新食材在庫 =====
  const newStock = { carb:{}, protein:{}, mineral:{} };

  function addNewFood(cat,name){
    if(cat==="mineral"){
      if(isFruit(name)){
        mineralMix.fruit.remain += cfg.blocksPerIngredient;
      }else{
        mineralMix.veg.remain += cfg.blocksPerIngredient;
      }
    }else{
      if(!newStock[cat][name]){
        newStock[cat][name]=cfg.blocksPerIngredient;
      }
    }
  }

  const plan=[];
  const missing={carb:0,protein:0,mineral:0};

  let mealIndex=0;

  for(const day of cfg.days){
    for(let mealNo=1;mealNo<=cfg.mealsPerDay;mealNo++){

      const t = mealTargets(cfg,mealIndex);

      let need={
        carb:tspToBlocks(t.carb,cfg.blockSizeTsp.carb),
        protein:tspToBlocks(t.protein,cfg.blockSizeTsp.protein),
        mineral:tspToBlocks(t.mineral,cfg.blockSizeTsp.mineral)
      };

      // ===== 新食材 =====
      let newFood=null;
      const rule = cfg.newFoodRule||{};
      if(rule.enabled && mealNo===1 && ["月","火","水","木","金"].includes(day) && rule.queue?.length){
        const nf=rule.queue.shift();
        const cat=rule.categoryOf(nf);
        const blocks=tspToBlocks(rule.tsp||1,cfg.blockSizeTsp[cat]);
        newFood={name:nf,category:cat,blocks};
        addNewFood(cat,nf);
        need[cat]=Math.max(0,need[cat]-blocks);
      }

      function alloc(list,cat){
        let picks=[];
        for(const it of list){
          if(need[cat]<=0) break;
          const use=Math.min(it.remain,need[cat]);
          if(use>0){
            it.remain-=use;
            picks.push({name:it.name,blocks:use});
            need[cat]-=use;
          }
        }
        if(need[cat]>0){
          missing[cat]+=need[cat];
        }
        return picks;
      }

      const carbP=alloc(inv.carb,"carb");
      const proP=alloc(inv.protein,"protein");

      // ===== ミネラル割当（合計優先）=====
      let mineralNeed=need.mineral;
      let mineralP=[];

      const vegUse=Math.min(mineralMix.veg.remain,cfg.mineralVegBase,mineralNeed);
      mineralMix.veg.remain-=vegUse;
      mineralNeed-=vegUse;
      if(vegUse>0) mineralP.push({name:mineralMix.veg.name,blocks:vegUse});

      const fruitUse=Math.min(mineralMix.fruit.remain,mineralNeed);
      mineralMix.fruit.remain-=fruitUse;
      mineralNeed-=fruitUse;
      if(fruitUse>0) mineralP.push({name:mineralMix.fruit.name,blocks:fruitUse});

      if(mineralNeed>0){
        missing.mineral+=mineralNeed;
      }

      if(newFood){
        if(newFood.category==="carb") carbP.unshift(newFood);
        if(newFood.category==="protein") proP.unshift(newFood);
        if(newFood.category==="mineral") mineralP.unshift(newFood);
      }

      plan.push({
        day,
        meal:mealNo,
        ok:(missing.carb+missing.protein+missing.mineral)===0,
        menuName:"献立",
        targetsTsp:t,
        blocks:{carb:carbP,protein:proP,mineral:mineralP}
      });

      mealIndex++;
    }
  }

  // ===== 余り =====
  const leftovers={
    carb:inv.carb.filter(x=>x.remain>0).map(x=>({name:x.name,remainBlocks:x.remain})),
    protein:inv.protein.filter(x=>x.remain>0).map(x=>({name:x.name,remainBlocks:x.remain})),
    mineral:[
      ...(mineralMix.veg.remain>0?[{name:mineralMix.veg.name,remainBlocks:mineralMix.veg.remain}]:[]),
      ...(mineralMix.fruit.remain>0?[{name:mineralMix.fruit.name,remainBlocks:mineralMix.fruit.remain}]:[])
    ]
  };

  // ===== 不足は実欠損のみ =====
  const shortageBlocks={
    carb:missing.carb,
    protein:missing.protein,
    mineral:missing.mineral
  };

  if(shortageBlocks.carb>0) warnings.push(`炭水化物不足:${shortageBlocks.carb}`);
  if(shortageBlocks.protein>0) warnings.push(`タンパク不足:${shortageBlocks.protein}`);
  if(shortageBlocks.mineral>0) warnings.push(`ミネラル不足:${shortageBlocks.mineral}`);

  return{
    ok:warnings.length===0,
    plan,
    leftovers,
    warnings,
    shortageBlocks
  };
}