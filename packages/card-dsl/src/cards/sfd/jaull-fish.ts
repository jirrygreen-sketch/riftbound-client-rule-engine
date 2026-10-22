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
 * 表达说明（复核 2026-10-22）：
 * - RIFT-898 的生产链已把本卡自持的 continuous.cost-modification 经
 *   programs/play.ts 送入 Finalize；即使 binder 来源到达 Finalize，费用专用
 *   matchesCostFilter 仍未支持计数过滤器里的 mightGte，因此原始程序会在费用
 *   Finalize 前因未适配的静态收益失效而 fail-closed；不能把减费近似成固定值
 *   或忽略谓词。
 * - [Accelerate] 已展开为可选 [1][C]，费用也能在 Finalize 询问并支付；
 *   但入场 ready 替代没有读取已支付凭证。拒绝分支仍会走进场替代并 ready，
 *   不满足 805.2.b/805.6；该缺口由引擎的 receipt→entry-condition 接线修复。
 * - 生产时间线：Play -> chain-item-pending -> Finalize 选择 optional additional
 *   -> 支付 receipt -> Resolve -> Board entry。测试从冻结 plan/receipt 与最终
 *   状态读取证据，不手工提交 ready/exhaust 或伪造事件。
 */
const jaullFish = {
  canonicalCardId: "card.hash-db90e8eaf24230cfbc3b68d99971c58f465f65465b5c52be37ae1564d6e86732",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "复核 2026-10-22：整卡仍不可生产执行。生产链已由 programs/play.ts:150-153 把本卡自持的" +
    " continuous.cost-modification 送到 chain/engine.ts:876 的 finalizeCostPlan，但" +
    " cost/discounts/values.ts:48-92 的 matchesCostFilter 仍把计数过滤器中的 mightGte 判为" +
    "Unsupported cost filter field；该计数必须按 706–710 对友方场上每个单位的当前 Might >= 5（Mighty）求值，" +
    "不能忽略谓词或写成固定折扣（356.4.a/356.4.b/356.4.g）。[Accelerate] 已有可选 [1][Body] 与" +
    " effect.ready 替代（effects/keywords/Accelerate.ts:97-113），但该替代没有读取已支付附加费凭证；" +
    "events/pipeline-types.ts:198-205 的 ReplacementRegistration.matches/apply 只接收 action，" +
    "chain/engine.ts:1234-1240 先按冻结选择横置，events/pipeline.ts:501-529 随后仍把该入场" +
    "替换为 ready；" +
    "只有支付后才应产生 805.2.b/805.6 的 ready replacement，且 805.6.a" +
    "不得经过 object-readied。需让入场状态由已支付附加费 receipt 条件决定，并避免未支付入场走 ready 替代。" +
    "官方依据：Core Rules v1.5（2026-10-09，2026-10-16 生效）356.4.a/356.4.b/356.4.g、" +
    "706–710、805.1.b/805.2.b/805.6/805.6.a。",
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
