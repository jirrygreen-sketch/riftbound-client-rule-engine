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
 * 官方依据：Core Rules v1.5（published 2026-10-09, effective 2026-10-16）
 * https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
 * - 356.4.a/356.4.b/356.4.g：卡牌自身可变减费在 Finalize 的折扣步骤按当时值计算；
 * - 706–710：Mighty 为单位当前 Might >= 5；
 * - 805.1.b/805.2.b/805.6/805.6.a：Accelerate 为可选 [1][C] 附加费，只有支付后
 *   才以 ready 状态进场且不触发 object-readied。
 *
 * 生产时间线：Play -> chain-item-pending -> Finalize 选择 optional additional
 * -> 按图层后的当前 Might 计算折扣并冻结费用 -> 支付 receipt -> Resolve ->
 * Board entry。测试从冻结 plan/receipt 与最终状态读取证据，不手工提交
 * ready/exhaust 或伪造事件。
 *
 * 2026-10-22 复核：RIFT-946 已让生产 Finalize 在计数过滤器中按图层后的当前
 * Might 求值 mightGte；RIFT-947 与 RIFT-950 已让 Accelerate 的 ready 入场替代
 * 只匹配同一打出实例的已支付 receipt，并在支付前冻结“默认横置进场”的选择。
 * Core Rules v1.5 356.4、356.6、706-710 与 805.1.b/805.2.b/805.6/805.6.a
 * 均由整卡生产 golden 覆盖。
 */
const jaullFish = {
  canonicalCardId: "card.hash-db90e8eaf24230cfbc3b68d99971c58f465f65465b5c52be37ae1564d6e86732",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "accelerate" },
    {
      kind: "static",
      effect: {
        kind: "continuous.cost-modification",
        stage: "discount",
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
