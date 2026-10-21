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
 * 表达说明（复核 2026-10-21）：
 * - [Accelerate]（805）已由 effects/keywords/Accelerate.ts 展开为
 *   static accelerate.cost（可选附加费 [1] + 域匹配 Power）与 replacement
 *   （object-enters-board + exhausted → effect.ready，805.6）；现有 expandProgram 会把本卡的
 *   keyword 声明解析为这两条能力（golden 验证）。
 * - “I cost 2 less for each of your Mighty units” 是静态费用改写（356.4/
 *   356.4.b/356.4.g）。费用收集器和静态 binder 已存在，但费用专用的
 *   matchesCostFilter 仍拒绝 mightGte；CardProgram 的自持 static 减费也没有
 *   由 cost-adapters/Finalize 送入收集器。这里保留完整计数表达式并让消费方
 *   fail-closed，整卡保持 judge-required，不做近似实现（契约 1.5 红线）。
 */
const jaullFish = {
  canonicalCardId: "card.hash-db90e8eaf24230cfbc3b68d99971c58f465f65465b5c52be37ae1564d6e86732",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "复核 2026-10-21：整卡仍不可生产执行。[Accelerate]（805.1.b/805.6）已能由默认 ProgramBinding + " +
    "ChainEngine Finalize 询问并收费，但拒绝支付后展开的入场 ready replacement 仍无已付凭证条件，" +
    "因此拒绝路径也会 ready（违反 805.2.b：只有支付后产生该延迟替代）。更关键的是自身减费「I cost 2 " +
    "less for each of your Mighty units」（356.4.a/356.4.b/356.4.g）有三层缺口：" +
    "(1) engine-core/src/programs/cost-adapters/index.ts 的 bindProgramCost 不把 CardProgram 的 " +
    "continuous.cost-modification 送入 CostPlanInput.discounts；" +
    "(2) engine-core/src/chain/engine.ts 的 Finalize 仍直接 buildCostPlan，没有调用 " +
    "cost/discounts.finalizeCostPlan 收集程序静态来源；" +
    "(3) 即使把真实 binder 来源显式交给 finalizeCostPlan，engine-core/src/cost/discounts/values.ts 的 " +
    "matchesCostFilter 仍以 Unsupported cost filter field mightGte fail-closed；该计数必须按 706–710 对每个" +
    "友方场上单位的当前 Might >= 5 求值，不能忽略谓词或写成固定折扣。官方依据：Core Rules v1.5（2026-10-09，" +
    "2026-10-16 生效）356.4.a/356.4.b/356.4.g、706–710、805.1.b/805.2.b/805.6/805.6.a。",
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
