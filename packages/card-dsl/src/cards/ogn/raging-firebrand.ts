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
 * - cost/ 的 buildCostPlan 支持 components/discounts 与 optionalAdditional，且
 *   cost.modify 指令原语已合入并能对调用方给的 CostSpec 建立 finalized 计划；仍缺的
 *   是把“本回合下一张法术 -5 能量”作为一次性窗口接到后续 Finalize。replacement
 *   已有 next-time-this-turn 的 GameAction 窗口，但费用支付/Finalize 没有可拦截的
 *   GameAction，折扣仍只在单次计划内生效。
 * - 触发注册的卡牌程序绑定（RIFT-257）已合入：programs/triggers.ts 的
 *   registerProgramTriggers + attachProgramLifecycle 能把 card-played 这类普通
 *   触发登记为 TriggerRegistration；缺的是该触发结算出的一次性费用修正窗口。
 *
 * status：judge-required。缺一次性（one-shot）费用窗口与把 cost.modify 计划挂到
 * 后续 Finalize 的消费方；不近似为常驻减费或固定数值改写。
 */
const ragingFirebrand = {
  canonicalCardId: "card.hash-6a44ecaa1f76158a92ecce63e4d3e2d347cc32014c448f13003d9f2500cb3de7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺一次性（one-shot）费用窗口（复核 2026-10-17）：cost.modify 指令原语已合入，" +
    "能对调用方给的 CostSpec 生成 finalized 计划（golden 实测 -5 energy discount 与 356.6 的 0 下限）；" +
    "但没有任何已合入消费方把「本回合下一张法术 -5 能量」安装成后续打出的一张法术的费用修正——" +
    "replacement 的 next-time-this-turn 只拦截 GameAction，费用支付/Finalize 没有可拦截的 GameAction，" +
    "cost/buildCostPlan 的 discounts 仍只在单次计划内生效。" +
    "卡牌触发绑定已合入（programs/triggers.ts 的 registerProgramTriggers + attachProgramLifecycle " +
    "能登记 card-played 触发），缺的只是触发结算出的一次性窗口本身。" +
    "依赖：一次性费用修正窗口与卡牌费用描述符→后续 Finalize 计划的消费者。不近似为常驻减费。",
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
