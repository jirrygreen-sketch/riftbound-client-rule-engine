import type { CardProgram } from "../../ir/index.js";

/**
 * Blazing Scorcher (ogn-001-298) — Unit, 5 Energy, 5 Might, Fury, Dragon/Noxus.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-001-298）：
 *   [Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost
 *   to have me enter ready.)
 *
 * 规则依据（CR v1.5）：
 * - 805.1 / 805.1.a：Accelerate 是单位上的可选附加费用关键词；
 * - 805.1.b：功能上等价于「打出我时，你可以额外支付 [1][C] 使我以就绪状态进场」；
 *   805.1.b.1：本单位有 Fury 域，力量部分只能用与 Fury 匹配的力量支付；
 * - 805.4：多个 Accelerate 冗余（stacking: single），因此只声明一个不带数值的
 *   keyword 能力；
 * - 805.5：是否拥有 Accelerate 是可被引用的特征，由 keyword 能力条目承载；
 * - 805.2.a/805.2.b/805.6/805.6.a：费用只能在打出该单位的流程中支付，支付后产生
 *   「横置进场 → 就绪进场」的延迟替代效果，不触发「成为就绪」类能力。
 *
 * 卡牌只声明关键词（契约 3.1/3.7、README 第 5 节）；展开（accelerate.cost 静态
 * 费用声明 + 入场替代）由 engine-core 的 Effects/keywords/Accelerate.ts 负责，
 * 本文件不重复实现。
 *
 * status = judge-required：关键词展开（accelerate.cost + 入场替代）与费用计划对
 * optionalAdditional 的 accelerate 组件支持都已合入，但卡牌程序仍没有把 keyword
 * 能力接入打出费用与替代流程；accelerate.cost 也没有可由打出流程消费的绑定入口（见
 * judgeReason）。依赖落地后复核并改为 executable。
 */
const blazingScorcher = {
  canonicalCardId:
    "card.hash-0da93712208ccce43badde9998369ec8b785af649c804e812feb2bb580f2908c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Accelerate 的展开文件（effects/keywords/Accelerate.ts：accelerate.cost 静态费用声明 + " +
    "object-enters-board 入场替代）与 cost/cost-plan.ts 对 { kind: 'accelerate' } 组件的收取" +
    "（含 805.1.b.1 的域匹配力量）均已合入，本卡测试真实执行展开后的就绪进场替代体；" +
    "但卡牌程序仍没有生产接线把 keyword 生成 optionalAdditional accelerate 组件，" +
    "accelerate.cost 静态效果也没有可由打出流程消费的注册入口，" +
    "chain/engine.ts 的就绪进场只读调用方已生成的 cost plan，805.2.b 的延迟替代因此不生效。" +
    "缺少的是「卡牌程序 → 费用/替代管线」接线；接线落地前不近似实现。",
  abilities: [{ kind: "keyword", keyword: "accelerate" }],
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)"
} satisfies CardProgram;

export default blazingScorcher;
