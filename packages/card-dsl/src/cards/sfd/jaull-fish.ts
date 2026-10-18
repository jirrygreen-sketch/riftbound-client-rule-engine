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
 *   （object-enters-board + exhausted → effect.ready，805.6）；现有 expandProgram 会把本卡的
 *   keyword 声明解析为这两条能力（golden 验证）。
 * - “I cost 2 less for each of your Mighty units” 是静态费用改写（356.4/
 *   356.4.b）。费用收集器和 cost.modify 原语已能处理表达式金额，但当前
 *   ObjectFilter/费用求值没有 Mighty 的 might>=5 谓词，生产 static binder 也
 *   不接受 cost-modification 图层；因此这里只声明完整的计数表达式并让消费方
 *   fail-closed，整卡保持 judge-required，不做近似实现（契约 1.5 红线）。
 */
const jaullFish = {
  canonicalCardId: "card.hash-db90e8eaf24230cfbc3b68d99971c58f465f65465b5c52be37ae1564d6e86732",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "cost.modify 原语与 cost/discounts/collect.ts 已能把静态声明的表达式金额送入费用计划，" +
    "但本卡仍有两处真实缺口：「I cost 2 less for each of your Mighty units」（356.4/356.4.b）" +
    "的计数过滤需要对每个友方单位求当前 Might >= 5；费用侧 matchesCostFilter 对 mightGte 会" +
    "以 Unsupported cost filter field mightGte fail-closed，Mighty.ts 的 condition.value 也没有" +
    "接入费用求值。另有生产接线缺口：programs/statics.ts 的 layerFor 不映射" +
    "continuous.cost-modification，chain/engine.ts Finalize 没有把 CardProgram static 传给" +
    "finalizeCostPlan。[Accelerate]（805）的展开与入场 ready replacement 已由 golden 真实执行，" +
    "但不构成整卡可执行证据。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "accelerate" },
    {
      kind: "static",
      effect: {
        kind: "continuous.cost-modification",
        resource: "energy",
        appliesTo: "self",
        amount: {
          kind: "arithmetic",
          operator: "multiply",
          operands: [
            { kind: "constant", value: 2 },
            {
              kind: "count",
              subject: "units",
              filter: { type: "unit", controller: "self", zone: "board", mightGte: 5 }
            }
          ]
        }
      }
    }
  ],
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
    "I cost :rb_energy_2: less for each of your [Mighty] units. (A unit is Mighty while it has 5+ :rb_might:.)"
} satisfies CardProgram;

export default jaullFish;
