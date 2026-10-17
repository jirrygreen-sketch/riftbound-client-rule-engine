import type { CardProgram } from "../../ir/index.js";

/**
 * Legion Rearguard (ogn-010-298) — Unit, 2 Energy, 2 Might, Fury, Trifarian/Noxus.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-010-298）：
 *   [Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost
 *   to have me enter ready.)
 *
 * 规则依据（CR v1.5）：
 * - 805.1 / 805.1.a：Accelerate 是单位上的可选附加费用关键词；
 * - 805.1.b：功能上等价于「打出我时，你可以额外支付 [1][C] 使我以就绪状态进场」；
 *   805.1.b.1：本单位有 Fury 域，力量部分只能用与 Fury 匹配的力量支付；
 * - 805.4：多个 Accelerate 冗余（stacking: single），只声明一个不带数值的 keyword；
 * - 805.5：是否拥有 Accelerate 是可被引用的特征，由 keyword 能力条目承载；
 * - 805.2.a/805.2.b/805.6/805.6.a：只能在打出流程中支付，支付后以就绪状态进场，
 *   且不触发「成为就绪」类能力。
 *
 * 卡牌只声明关键词（契约 3.1/3.7、README 第 5 节）；展开由
 * effects/keywords/Accelerate.ts 负责。
 *
 * status = judge-required（复核 2026-10-17，第三轮 M2 覆盖率复核）：
 * - 已合入并真实执行：Accelerate 的展开（effects/keywords/Accelerate.ts：accelerate.cost
 *   静态声明 + 入场就绪替代）、替代管线（RIFT-260）、费用原语的 cost.pay/cost.modify
 *   （RIFT-261，已合入 HEAD）、cost/cost-plan.ts 的 optionalAdditional[accelerate] 分支
 *   （固定 [1] + 1 Power）、以及 chain/engine.ts 读 selectedAdditional 的就绪进场。
 * - 仍缺（生产方）：没有任何已合入路径把卡牌的 keyword 声明变成费用计划的
 *   optionalAdditional 组件。实测 describePlay（programs/play.ts）对本卡返回 cost: undefined、
 *   body: []，浏览器/服务端拿到的费用计划里没有 accelerate 组件；programs/play.ts 的
 *   translateCost 对 additional/keyword/optional 等费用字段直接 judgeRequired。展开出的
 *   accelerate.cost 静态能力也进不了图层：programs/statics.ts 的 layerFor 抛
 *   “Static ability kind accelerate.cost has no layer mapping”。因此 805.1.b.1（Fury 域力量匹配）
 *   与 805.2.b/805.6（延迟替代）在真实对局中不会自动生效。接线不属本卡 write scope。
 */
const legionRearguard = {
  canonicalCardId:
    "card.hash-a276ed720995bb4d684f3f838182e4271ea398c1cac8f48837c9e7c292cd0497",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 keyword → 费用计划的生产方：Accelerate 的展开与替代管线（RIFT-260）、费用原语 cost.pay/cost.modify" +
    "（RIFT-261，已合入 HEAD）、cost/cost-plan.ts 的 optionalAdditional[accelerate]（[1] + 1 Power）与 " +
    "chain/engine.ts 读 selectedAdditional 的就绪进场都已合入；但没有已合入路径把卡牌 keyword 声明变成该组件。" +
    "实测 programs/play.ts 的 describePlay 对本卡返回 cost: undefined、body: []（translateCost 对 " +
    "additional/keyword/optional 费用字段直接 judgeRequired），展开的 accelerate.cost 静态能力也被 " +
    "programs/statics.ts 以 “Static ability kind accelerate.cost has no layer mapping” 拒绝，" +
    "故 805.1.b.1（Fury 域力量匹配）与 805.2.b/805.6（延迟替代）不会自动生效。接线不属本卡 write scope。" +
    "golden 已用费用计划 + 替代管线真实执行声明出的 Accelerate 流程（805.1.b/805.6）。不近似实现。",
  abilities: [{ kind: "keyword", keyword: "accelerate" }],
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)"
} satisfies CardProgram;

export default legionRearguard;
