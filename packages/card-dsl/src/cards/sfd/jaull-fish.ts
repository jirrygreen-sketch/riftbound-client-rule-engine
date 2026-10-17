import type { CardProgram } from "../../ir/index.js";

/**
 * Jaull-Fish (sfd-103-221) — Unit, fiora-sfd (M1).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-103-221):
 *   [Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional
 *   cost to have me enter ready.)
 *   I cost :rb_energy_2: less for each of your [Mighty] units. (A unit is
 *   Mighty while it has 5+ :rb_might:.)
 *
 * 表达说明（复核 2026-10-17）：
 * - [Accelerate]（805）已由 effects/keywords/Accelerate.ts 展开为
 *   static accelerate.cost（可选附加费 [1] + 域匹配 Power）与 replacement
 *   （object-enters-board + exhausted → effect.ready，805.6）；RIFT-257 的
 *   expandProgram 会把本卡的 keyword 声明解析为这两条能力（golden 验证）。
 * - “I cost 2 less for each of your Mighty units” 是静态费用改写（356.4/
 *   356.4.b，cost-modify 模板）：cost.modify 原语已合入
 *   （effects/instructions/cost.modify.ts，完整管线），但静态绑定层没有它——
 *   programs/statics.ts 的 layerFor 对 cost.modify 抛 Static ability kind
 *   cost.modify has no layer mapping，卡程序声明的折扣无法注册进图层；
 *   cost/cost-plan.ts 的 CostDiscount 只读调用方传入的 amount（仍在进行的
 *   RIFT-261），没有卡程序入口。“for each of your Mighty units”可用
 *   Mighty 的条件谓词计数（Mighty.ts 已展开 condition.value，导出
 *   mightyCondition），但费用侧没有消费入口。故整卡保持 judge-required，
 *   不做近似实现（契约 1.5 红线）。
 */
const jaullFish = {
  canonicalCardId: "card.hash-db90e8eaf24230cfbc3b68d99971c58f465f65465b5c52be37ae1564d6e86732",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "cost.modify 原语已合入（effects/instructions/cost.modify.ts），但静态费用改写仍缺三层：「I cost 2 less " +
    "for each of your Mighty units」（356.4/356.4.b）需要 (a) static cost.modify 的图层映射——" +
    "programs/statics.ts 的 layerFor 对该 kind 抛 has-no-layer-mapping，卡程序声明的折扣无法注册进图层；" +
    "(b) 卡程序→费用计划的接线——cost/cost-plan.ts 的 CostDiscount 只读调用方传入的 amount（RIFT-261 费用批次）；" +
    "(c) Mighty 计数入口——Mighty.ts 已展开 condition.value 谓词并导出 mightyCondition（706–711），" +
    "但费用侧没有读取该谓词的入口。[Accelerate]（805）的展开已合入（golden 验证），不构成整卡可执行证据。不近似实现。",
  abilities: [{ kind: "keyword", keyword: "accelerate" }],
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
    "I cost :rb_energy_2: less for each of your [Mighty] units. (A unit is Mighty while it has 5+ :rb_might:.)"
} satisfies CardProgram;

export default jaullFish;
