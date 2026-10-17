import type { CardProgram } from "../../ir/index.js";

/**
 * Raging Firebrand (ogn-031-298) — Unit, Fury, Dragon/Mount Targon.
 * energy 6, power 1 (Fury), Might 4.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-031-298):
 *   "When you play me, the next spell you play this turn costs
 *    :rb_energy_5: less."
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a："When you play me" 是打出触发（时点 card-played，filter 指向自身）。
 * - 349/356："the next spell you play this turn costs [5] less" 是对**下一次**
 *   法术打出的费用改写：需要一个一次性（one-shot）费用修正窗口，作用到本回合
 *   你接下来打出的第一张 Spell 的 Finalize 费用计划，随后失效。
 * - cost/ 的 buildCostPlan 支持 components/discounts 与 optionalAdditional，但
 *   没有已注册的指令原语把"安装一个一次性减费"挂到触发结算上：
 *   effects/instructions/ 下没有 cost.modify 文件（RIFT-261 的
 *   cost.pay/cost.modify 未合入本分支）；"next spell" 的一次性窗口也没有对应的
 *   持续效果期限类型（Duration 只有 permanent / end-of-turn / end-of-combat /
 *   while-source-in-zone / until），且折扣只在单次 Finalize 计划内生效。
 * - 触发注册还缺卡牌程序绑定：没有任何已合入消费方把 CardProgram 的 triggered
 *   能力登记成 TriggerRegistration（RIFT-257）。
 *
 * status：judge-required。缺 cost.modify 指令原语与 one-shot 费用窗口；
 * 依赖 cost-plan 后续任务（RIFT-261）与卡牌触发绑定（RIFT-257）。
 * 不近似为常驻减费或固定数值改写。
 */
const ragingFirebrand = {
  canonicalCardId: "card.hash-6a44ecaa1f76158a92ecce63e4d3e2d347cc32014c448f13003d9f2500cb3de7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 cost.modify 指令原语与一次性费用窗口：effects/instructions/ 下没有 cost.modify 文件" +
    "（RIFT-261 的 cost.pay/cost.modify 未合入本分支），没有原语把「本回合下一张法术 -5 能量」注册进 Finalize 费用计划" +
    "（cost/buildCostPlan 的 discounts 只在单次计划内生效），Duration 也没有 one-shot「next spell this turn」期限；" +
    "另缺卡牌触发绑定——没有任何已合入消费方把 CardProgram 的 triggered 能力登记成 TriggerRegistration（RIFT-257）。" +
    "依赖：RIFT-261（cost.pay/cost.modify 与一次性费用修正）、RIFT-257（卡牌触发绑定）。不近似为常驻减费。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        // The engine validator rejects the older { self: true } spelling; the
        // played card identifies itself by canonical id.
        filter: {
          event: "card-played",
          object: { canonicalCardId: "card.hash-6a44ecaa1f76158a92ecce63e4d3e2d347cc32014c448f13003d9f2500cb3de7" }
        }
      },
      optional: false,
      body: [
        {
          id: "raging-firebrand.cost-modify",
          op: "cost.modify",
          args: {
            resource: { kind: "constant", value: "energy" },
            amount: { kind: "constant", value: -5 },
            appliesTo: { kind: "constant", value: "next-spell-this-turn" }
          }
        }
      ]
    }
  ],
  sourceText: "When you play me, the next spell you play this turn costs :rb_energy_5: less."
} satisfies CardProgram;

export default ragingFirebrand;
