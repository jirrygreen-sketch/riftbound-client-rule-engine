import type { CardProgram } from "../../ir/index.js";

/**
 * Marai Spire (sfd-211-221) — Battlefield, SFD.
 *
 * "While you control this battlefield, friendly [Repeat] costs cost
 *  :rb_energy_1: less."
 *
 * Rules anchors (Core Rules v1.5):
 * - "While you control this battlefield" is the controller window of a
 *   battlefield ability: 190.6.a gives the controller its abilities and
 *   190.6.d makes "you" the battlefield's controller.
 * - The affected cost is the additional cost of the [Repeat] keyword (820.1,
 *   820.1.a/820.1.c). "cost [1] less" is a discount (356.4, 356.4.b); it can
 *   reduce additional costs, including to 0 (356.4.f). 356.6 floors Energy
 *   and Power at 0, and 204.4's applied-cost distinction does not apply (this
 *   is a discount on Repeat's additional cost).
 * - The discount applies only to the Repeat instances on friendly spells and
 *   abilities (the printed cost belongs to the card/ability carrying Repeat,
 *   per 820.1.c and 820.4), so the static effect filters friendly Repeat
 *   sources rather than granting Repeat to anything.
 *
 * Current status: judge-required. Generic cost planning/payment is merged;
 * programs/statics.ts rejects appliesTo "repeat-additional-cost" and layerFor
 * has no cost.modify mapping, so the static ability cannot register at all. No
 * consumer applies this controller's discount to friendly Repeat components,
 * collects repeat.cost at Finalize, or binds paid instances to extra resolution.
 */
export default {
  canonicalCardId: "card.hash-e00a3fe8d0f18d062b1743d6d5d1eb534e884d83303af037d7c1d05c3a6a21bd",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Repeat 展开与 cost.modify/cost.pay 已合入，通用费用计划也支持追加费用减至零（356.4.b/f / 356.6）。" +
    "仍缺本卡的生产接线：programs/statics.ts 拒绝 appliesTo=repeat-additional-cost（实测 ProgramBindingError judge-required），" +
    "其 staticFilter 也不识别印刷的 keyword 过滤字段（已实测拒绝），" +
    "cost.modify 也没有静态图层映射（layerFor 对 cost.modify 抛 no layer mapping）；" +
    "尚无按战场当前控制者，把 -1 Energy 应用到友方 Repeat 费用组件的消费者。repeat.cost 未接入卡牌 Finalize 收取，" +
    "已付实例数也未接到额外结算（820.1.c/d）。不把通用减费原语当成本卡已执行。",
  sourceText: "While you control this battlefield, friendly [Repeat] costs cost :rb_energy_1: less.",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "cost.modify",
        value: { kind: "constant", value: { energy: -1 } },
        appliesTo: "repeat-additional-cost",
        filter: {
          keyword: "Repeat",
          controller: "self",
          zone: "board"
        }
      },
      condition: { kind: "always" }
    }
  ]
} satisfies CardProgram;
