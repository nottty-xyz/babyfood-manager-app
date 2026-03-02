// run.js
import { generateWeeklyPlan } from "./planner.js";

const result = generateWeeklyPlan({
  phase: "中期",
  // もし「炭水化物も小さじ1キューブ」でやるなら ↓ を 1 にしてみて（食材数が激増する）
  // blockSizeTsp: { carb: 1, protein: 1, mineral: 1 }
});

console.log(JSON.stringify(result, null, 2));