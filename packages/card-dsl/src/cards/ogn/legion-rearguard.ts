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
 * status = judge-required：同 Blazing Scorcher —— 关键词展开已合入，但缺少把卡牌
 * keyword 能力接到费用计划/替代管线的消费方（见 judgeReason）。
 */
const legionRearguard = {
  canonicalCardId:
    "card.hash-a276ed720995bb4d684f3f838182e4271ea398c1cac8f48837c9e7c292cd0497",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Accelerate 的展开文件（effects/keywords/Accelerate.ts）已合入，但合并内核没有任何生产方把卡牌 " +
    "keyword 能力接进打出流程：cost/cost-plan.ts 只消费调用方传入的 optionalAdditional，没有由 keyword " +
    "声明生成 { kind: 'accelerate' } 费用组件的路径；accelerate.cost 静态效果无消费方；" +
    "chain/engine.ts:357 的就绪进场只读已生成的 cost plan。805.1.b.1（Fury 域力量匹配）与 " +
    "805.2.b/805.6（延迟替代）因此不生效。缺少的是「卡牌程序 → 费用/替代管线」接线，不属于本卡 " +
    "write scope；接线落地前不近似实现。",
  abilities: [{ kind: "keyword", keyword: "accelerate" }],
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)"
} satisfies CardProgram;

export default legionRearguard;
