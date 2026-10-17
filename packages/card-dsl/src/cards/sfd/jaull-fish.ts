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
 * 表达说明（复核 2026-10-16）：
 * - [Accelerate]（805）已由 effects/keywords/Accelerate.ts 展开为
 *   static accelerate.cost（可选附加费 [1] + 域匹配 Power）与 replacement
 *   （object-enters-board + exhausted → effect.ready，805.6）；RIFT-257 的
 *   expandProgram 会把本卡的 keyword 声明解析为这两条能力（golden 验证）。
 * - “I cost 2 less for each of your Mighty units” 是静态费用改写（356.4/
 *   356.4.b，cost-modify 模板）：effects/instructions/ 没有 cost.modify 原语，
 *   cost/cost-plan.ts 也不读 CardProgram 声明的折扣（属仍在进行的 RIFT-261）；
 *   “for each of your Mighty units”还需要 706–711 的 Mighty 谓词计数作为
 *   折扣 amount 的输入，费用侧同样没有计数入口。故整卡保持 judge-required，
 *   不做近似实现（契约 1.5 红线）。
 */
const jaullFish = {
  canonicalCardId: "card.hash-db90e8eaf24230cfbc3b68d99971c58f465f65465b5c52be37ae1564d6e86732",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 cost.modify 与费用计划消费方：「I cost 2 less for each of your Mighty units」（356.4/356.4.b）需要静态费用改写" +
    "（effects/instructions/ 没有 cost.modify 原语，cost/cost-plan.ts 的折扣只读调用方传入的 CostDiscount，" +
    "属仍在进行的 RIFT-261），折扣数量还依赖 706–711 的 Mighty 计数，费用侧没有该谓词入口。" +
    "[Accelerate]（805）的展开（effects/keywords/Accelerate.ts：成本声明 + 入场就绪替代）已合入，" +
    "RIFT-257 的 expandProgram 可把它解析为可校验的能力（golden 验证展开形状），但不构成整卡可执行证据。不近似实现。",
  abilities: [{ kind: "keyword", keyword: "accelerate" }],
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
    "I cost :rb_energy_2: less for each of your [Mighty] units. (A unit is Mighty while it has 5+ :rb_might:.)"
} satisfies CardProgram;

export default jaullFish;
