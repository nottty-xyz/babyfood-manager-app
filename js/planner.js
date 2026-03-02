// js/planner.js
// 完全整理版 v2

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

function tspToBlocks(tsp,size){ return Math.ceil(tsp/size); }
function totalMeals(cfg){ return cfg.days.length * cfg.mealsPerDay; }

function mealTargets(cfg,i){
  const p = (i%2===0)?cfg.tspPerMeal.protein.min:cfg.tspPerMeal.protein.max;
  const mBase=(cfg.tspPerMeal.mineral.min+cfg.tspPerMeal.mineral.max)/2;
  return {
    carb: cfg.tspPerMeal.carb,
    protein: p,
    mineral: Math.round(mBase)
  };
}

const FRUITS=new Set([
  "りんご","いちご","メロン","バナナ","すいか","梨","みかん","桃",
  "キウイ","ぶどう","グレープフルーツ","アボカド",
  "ブルーベリー","ラズベリー","パイン"
]);

function isFruit(n){return FRUITS.has(n);}

function makeInventory(list,blocks){
  return (list||[]).map(x=>({name:x.name,remain:blocks}));
}

// ===== メイン =====

export function generateWeeklyPlanWithInventory(customConfig={}){

  const cfg={...DEFAULT_CONFIG,...customConfig};
  const warnings=[];
  const errors=[];

  // ===== 1️⃣ 在庫構築 =====

  const inv={
    carb:makeInventory(cfg.inventoryOverride?.carb,cfg.blocksPerIngredient),
    protein:makeInventory(cfg.inventoryOverride?.protein,cfg.blocksPerIngredient),
    mineral:makeInventory(cfg.inventoryOverride?.mineral,cfg.blocksPerIngredient)
  };

  // 新食材を先に在庫へ追加（最大5つ）
  const rule=cfg.newFoodRule||{};
  const queue=(rule.queue||[]).slice(0,5);
  const categoryOf=rule.categoryOf||(()=>null);

  queue.forEach(n=>{
    const cat=categoryOf(n);
    if(!cat)return;
    if(cat==="mineral"){
      inv.mineral.push({name:n,remain:cfg.blocksPerIngredient});
    }else{
      inv[cat].push({name:n,remain:cfg.blocksPerIngredient});
    }
  });

  // ===== ミネラルをミックス化（週固定） =====

  const veg=inv.mineral.filter(x=>!isFruit(x.name));
  const fruit=inv.mineral.filter(x=>isFruit(x.name));

  const vegNames=veg.slice(0,3).map(x=>x.name);
  const fruitNames=fruit.slice(0,2).map(x=>x.name);

  const mineralMix={
    veg:{
      name:`野菜ミックス(${vegNames.join("+")})`,
      remain:veg.reduce((s,x)=>s+x.remain,0)
    },
    fruit:{
      name:`果物ミックス(${fruitNames.join("+")})`,
      remain:fruit.reduce((s,x)=>s+x.remain,0)
    }
  };

  // ===== 2️⃣ 割当フェーズ =====

  const plan=[];
  const missing={carb:0,protein:0,mineral:0};

  let mealIndex=0;

  for(const day of cfg.days){
    for(let mealNo=1;mealNo<=cfg.mealsPerDay;mealNo++){

      const t=mealTargets(cfg,mealIndex);

      let need={
        carb:tspToBlocks(t.carb,cfg.blockSizeTsp.carb),
        protein:tspToBlocks(t.protein,cfg.blockSizeTsp.protein),
        mineral:tspToBlocks(t.mineral,cfg.blockSizeTsp.mineral)
      };

      // 平日1回目は新食材1ブロック消費
      if(rule.enabled && ["月","火","水","木","金"].includes(day) && mealNo===1){
        const nf=queue.shift();
        if(nf){
          const cat=categoryOf(nf);
          if(cat==="mineral"){
            if(isFruit(nf)){
              mineralMix.fruit.remain--;
            }else{
              mineralMix.veg.remain--;
            }
            need.mineral--;
          }else{
            const item=inv[cat].find(x=>x.name===nf);
            if(item){item.remain--;need[cat]--;}
          }
        }
      }

      function alloc(list,cat){
        const picks=[];
        for(const it of list){
          if(need[cat]<=0)break;
          const use=Math.min(it.remain,need[cat]);
          if(use>0){
            it.remain-=use;
            need[cat]-=use;
            picks.push({name:it.name,blocks:use});
          }
        }
        if(need[cat]>0)missing[cat]+=need[cat];
        return picks;
      }

      const carbP=alloc(inv.carb,"carb");
      const proP=alloc(inv.protein,"protein");

      // ミネラル
      let mineralNeed=need.mineral;
      const mineralP=[];

      const vegUse=Math.min(mineralMix.veg.remain,cfg.mineralVegBase,mineralNeed);
      mineralMix.veg.remain-=vegUse;
      mineralNeed-=vegUse;
      if(vegUse>0)mineralP.push({name:mineralMix.veg.name,blocks:vegUse});

      const fruitUse=Math.min(mineralMix.fruit.remain,mineralNeed);
      mineralMix.fruit.remain-=fruitUse;
      mineralNeed-=fruitUse;
      if(fruitUse>0)mineralP.push({name:mineralMix.fruit.name,blocks:fruitUse});

      if(mineralNeed>0)missing.mineral+=mineralNeed;

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

  // ===== 3️⃣ 結果生成 =====

  const leftovers={
    carb:inv.carb.filter(x=>x.remain>0).map(x=>({name:x.name,remainBlocks:x.remain})),
    protein:inv.protein.filter(x=>x.remain>0).map(x=>({name:x.name,remainBlocks:x.remain})),
    mineral:[
      ...(mineralMix.veg.remain>0?[{name:mineralMix.veg.name,remainBlocks:mineralMix.veg.remain}]:[]),
      ...(mineralMix.fruit.remain>0?[{name:mineralMix.fruit.name,remainBlocks:mineralMix.fruit.remain}]:[])
    ]
  };

  const shortageBlocks={
    carb:missing.carb,
    protein:missing.protein,
    mineral:missing.mineral
  };

  if(shortageBlocks.carb>0)warnings.push(`炭水化物不足:${shortageBlocks.carb}`);
  if(shortageBlocks.protein>0)warnings.push(`タンパク不足:${shortageBlocks.protein}`);
  if(shortageBlocks.mineral>0)warnings.push(`ミネラル不足:${shortageBlocks.mineral}`);

  return{
    ok:warnings.length===0,
    plan,
    leftovers,
    warnings,
    errors,
    shortageBlocks
  };
}