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
 * status = judge-required：Accelerate 展开（静态 accelerate.cost 声明 + 入场就绪的
 * 替代）与费用计划的 optionalAdditional accelerance 分支、替代管线（RIFT-260）都已合入，
 * 费用计划的 accelerate 组件由 cost/cost-plan.ts 生成（固定 [1]+1 Power），chain 的就绪
 * 进场也读 selectedAdditional；缺少的是把卡牌 keyword 能力自动接进打出流程的生产方
 * （RIFT-257 程序绑定 / RIFT-261 费用原语），见 judgeReason。
 */
const legionRearguard = {
  canonicalCardId:
    "card.hash-a276ed720995bb4d684f3f838182e4271ea398c1cac8f48837c9e7c292cd0497",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Accelerate 的展开文件（effects/keywords/Accelerate.ts）与替代管线（RIFT-260）已合入，费用计划的 " +
    "optionalAdditional[accelerate] 分支也能生成 [1] + 1 Power 的组件（cost/cost-plan.ts）且 chain 就绪进场读 selectedAdditional；" +
    "但合并内核没有任何生产方把卡牌 keyword 能力接进打出流程：没有由 keyword 声明自动生成 { kind: 'accelerate' } " +
    "费用组件的路径（卡牌程序绑定 RIFT-257、费用原语 RIFT-261），accelerate.cost 静态效果无消费方，" +
    "805.1.b.1（Fury 域力量匹配）与 805.2.b/805.6（延迟替代）因此不会自动生效。" +
    "golden 已用费用计划 + 替代管线真实执行声明出的 Accelerate 流程；缺少的是接线本身，不属于本卡 write scope。",
  abilities: [{ kind: "keyword", keyword: "accelerate" }],
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)"
} satisfies CardProgram;

export default legionRearguard;
