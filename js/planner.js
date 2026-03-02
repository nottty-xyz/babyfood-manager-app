// js/planner.js
// 完全整理版 v6
// ✅ 新食材は初回は必ず小さじ1のみ（全カテゴリ統一）
// ✅ その食では同じ新食材を追加で消費しない
// ✅ 不足は同カテゴリ他食材で補う
// ✅ ミネラル単品は優先消費するが、ミックスは必ず残す

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

  mineralVegBase: 4,

  mineralSinglesPolicy: {
    maxSingleShare: 0.5,
    minMixTsp: 2
  }
};

function tspToBlocks(tsp,size){ return Math.ceil(tsp/size); }
function isWeekdayJP(d){ return ["月","火","水","木","金"].includes(d); }
function clamp(n,min,max){ return Math.max(min,Math.min(max,n)); }

function mealTargets(cfg,i){
  const protein=(i%2===0)?cfg.tspPerMeal.protein.min:cfg.tspPerMeal.protein.max;
  const mBase=(cfg.tspPerMeal.mineral.min+cfg.tspPerMeal.mineral.max)/2;
  const mineral=clamp(Math.round(mBase),cfg.tspPerMeal.mineral.min,cfg.tspPerMeal.mineral.max);
  return {carb:cfg.tspPerMeal.carb,protein,mineral};
}

const FRUITS=new Set(["りんご","いちご","メロン","バナナ","すいか","梨","みかん","桃","キウイ","ぶどう","グレープフルーツ","アボカド","ブルーベリー","ラズベリー","パイン"]);
function isFruit(n){return FRUITS.has(n);}

function makeInv(list,b){return (list||[]).map(x=>({name:x.name,remain:b}));}

function ensure(inv,name,b){
  let i=inv.find(x=>x.name===name);
  if(!i){i={name,remain:b};inv.unshift(i);}
  return i;
}

function alloc(inv,need,exclude){
  let n=need; const picks=[];
  const list=[...inv].filter(x=>x.remain>0 && !exclude.has(x.name)).sort((a,b)=>b.remain-a.remain);
  for(const it of list){
    if(n<=0)break;
    const u=Math.min(it.remain,n);
    it.remain-=u; n-=u;
    picks.push({name:it.name,blocks:u});
  }
  return {picks,missing:n};
}

function buildMix(base){
  const veg=base.filter(x=>!isFruit(x.name));
  const fruit=base.filter(x=>isFruit(x.name));
  const vegNames=veg.slice(0,3).map(x=>x.name);
  const fruitNames=fruit.slice(0,2).map(x=>x.name);
  return {
    veg:{name:`野菜ミックス(${vegNames.join("+")})`,remain:veg.reduce((s,x)=>s+x.remain,0)},
    fruit:{name:`果物ミックス(${fruitNames.join("+")})`,remain:fruit.reduce((s,x)=>s+x.remain,0)}
  };
}

export function generateWeeklyPlanWithInventory(customConfig={}){
  const cfg={...DEFAULT_CONFIG,...customConfig};
  const inv={
    carb:makeInv(cfg.inventoryOverride?.carb,cfg.blocksPerIngredient),
    protein:makeInv(cfg.inventoryOverride?.protein,cfg.blocksPerIngredient),
    mineralBase:makeInv(cfg.inventoryOverride?.mineral,cfg.blocksPerIngredient),
    mineralSingles:[]
  };

  const rule=cfg.newFoodRule||{};
  const categoryOf=rule.categoryOf||(()=>null);
  const queue=(rule.queue||[]).slice(0,5);
  let ptr=0;

  // 新食材在庫追加
  for(const nf of queue){
    const cat=categoryOf(nf);
    if(cat==="mineral") ensure(inv.mineralSingles,nf,cfg.blocksPerIngredient);
    else if(cat) ensure(inv[cat],nf,cfg.blocksPerIngredient);
  }

  const mix=buildMix(inv.mineralBase);
  const missing={carb:0,protein:0,mineral:0};
  const plan=[];
  let idx=0;

  for(const day of cfg.days){
    for(let mealNo=1;mealNo<=cfg.mealsPerDay;mealNo++){

      const t=mealTargets(cfg,idx);
      let need={
        carb:tspToBlocks(t.carb,cfg.blockSizeTsp.carb),
        protein:tspToBlocks(t.protein,cfg.blockSizeTsp.protein),
        mineral:tspToBlocks(t.mineral,cfg.blockSizeTsp.mineral)
      };

      const exclude={carb:new Set(),protein:new Set(),mineral:new Set()};
      let newPick=null;

      if(rule.enabled && isWeekdayJP(day) && mealNo===1 && ptr<queue.length){
        const nf=queue[ptr++];
        const cat=categoryOf(nf);
        const blocks=1;
        newPick={name:`${nf}(新)`,blocks};
        if(cat==="mineral"){
          const it=ensure(inv.mineralSingles,nf,cfg.blocksPerIngredient);
          it.remain-=blocks;
          need.mineral-=blocks;
          exclude.mineral.add(nf);
        }else{
          const it=ensure(inv[cat],nf,cfg.blocksPerIngredient);
          it.remain-=blocks;
          need[cat]-=blocks;
          exclude[cat].add(nf);
        }
      }

      const carbAlloc=alloc(inv.carb,need.carb,exclude.carb);
      const proAlloc=alloc(inv.protein,need.protein,exclude.protein);

      missing.carb+=carbAlloc.missing;
      missing.protein+=proAlloc.missing;

      // ミネラル
      let mNeed=need.mineral;
      const mineralPicks=[];

      // 単品優先だがミックス最低確保
      const maxSingle=Math.floor(mNeed*cfg.mineralSinglesPolicy.maxSingleShare);
      const minMix=Math.min(cfg.mineralSinglesPolicy.minMixTsp,mNeed);
      const singleAllowed=Math.max(0,Math.min(maxSingle,mNeed-minMix));

      if(singleAllowed>0){
        const singleAlloc=alloc(inv.mineralSingles,singleAllowed,exclude.mineral);
        mineralPicks.push(...singleAlloc.picks);
        mNeed-=singleAllowed-singleAlloc.missing;
      }

      const vegUse=Math.min(mix.veg.remain,Math.min(cfg.mineralVegBase,mNeed));
      mix.veg.remain-=vegUse; mNeed-=vegUse;
      if(vegUse>0) mineralPicks.push({name:mix.veg.name,blocks:vegUse});

      const fruitUse=Math.min(mix.fruit.remain,mNeed);
      mix.fruit.remain-=fruitUse; mNeed-=fruitUse;
      if(fruitUse>0) mineralPicks.push({name:mix.fruit.name,blocks:fruitUse});

      if(mNeed>0){
        const singleAlloc2=alloc(inv.mineralSingles,mNeed,exclude.mineral);
        mineralPicks.push(...singleAlloc2.picks);
        mNeed=singleAlloc2.missing;
      }

      missing.mineral+=mNeed;

      if(newPick){
        if(newPick.name.includes("(新)") && need.mineral!==undefined){
          mineralPicks.unshift(newPick);
        }
        if(need.carb!==undefined) carbAlloc.picks.unshift(newPick);
        if(need.protein!==undefined) proAlloc.picks.unshift(newPick);
      }

      plan.push({
        day,meal:mealNo,ok:(mNeed===0 && carbAlloc.missing===0 && proAlloc.missing===0),
        targetsTsp:t,
        blocks:{
          carb:carbAlloc.picks,
          protein:proAlloc.picks,
          mineral:mineralPicks
        }
      });

      idx++;
    }
  }

  return {
    ok:(missing.carb+missing.protein+missing.mineral)===0,
    plan,
    shortageBlocks:missing
  };
}