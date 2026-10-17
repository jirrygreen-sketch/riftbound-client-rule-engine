import type { CardProgram } from "../../ir/index.js";

/**
 * Legion Rearguard (ogn-010-298), CR v1.5 805.1.b/805.2.b/805.6.
 * 当前复核：费用规划器与链已能执行手工提供的 optionalAdditional[accelerate]；
 * 缺卡牌 keyword 到该费用组件的生产方，不能据局部执行证据提升整卡状态。
 */
const legionRearguard = {
  canonicalCardId:
    "card.hash-a276ed720995bb4d684f3f838182e4271ea398c1cac8f48837c9e7c292cd0497",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Accelerate keyword 到费用计划的生产方：programs/play.ts 的 describePlay 对本卡未生成 optionalAdditional，" +
    "返回 cost: undefined；展开的 accelerate.cost 静态声明也无图层映射。" +
    "须在打出时可选支付 [1] 与匹配 Fury 的 Power（805.1.b.1），并由该支付建立 delayed replacement，" +
    "使其进入 Board 时即 ready，且不触发 object-readied（805.2.b/805.6/805.6.a）。" +
    "现有费用规划器和 selectedAdditional 入场分支只能消费已提供的组件，未补齐 keyword 的生产接线。",
  abilities: [{ kind: "keyword", keyword: "accelerate" }],
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)"
} satisfies CardProgram;

export default legionRearguard;
