import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Blast Corps Cadet (sfd-013-221).
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-013-221，逐字）:
 *   You may pay 1 energy + 1 Fury power as an additional cost to play me.
 *   When you play me, if you paid the additional cost, deal 2 to a unit at a battlefield.
 *
 * 规则依据（CR v1.5）：356.2.b 的可选追加费用、356.4.f.1 的费用选择回执；
 * cost.additional / buildAdditionalCostPlan 与 cost.modify 的 optionalAdditional 输入已合入。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，当前真实缺口：
 * - 没有管线把卡程序声明的 cost.additional（optional-additional 阶段）接进打出
 *   Finalize 的 optionalAdditional 收取。
 * - 「if you paid the additional cost」需要 356.4.f.1 的费用选择回执绑定；冻结 IR
 *   的指令条件没有「已付回执」这一结果来源。
 * effect.damage 与战场单位目标本体已合入。不近似实现（不把伤害伪装成无条件）。
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      kind: "cost.additional",
      id: "blast-corps-cadet.additional-cost",
      appliesTo: "self",
      optional: true,
      stage: "optional-additional",
      payments: [
        { kind: "energy", amount: { kind: "constant", value: 1 } },
        { kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Fury"] }
      ]
    }
  },
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { event: "card-played", filter: { source: "self" } } },
    optional: false,
    body: [
      {
        id: "blast-corps-cadet.deal-two",
        op: "effect.damage",
        args: {
          amount: { kind: "constant", value: 2 },
          target: { kind: "constant", value: "blast-corps-cadet.battlefield-unit" }
        },
        targets: [
          {
            id: "blast-corps-cadet.battlefield-unit",
            filter: { type: "unit", location: "battlefield" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-61c2c98673d31b1cc983ca4dea64165ef227232e1816a012d1c058d13db5bb4f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "可选追加费用的 cost.additional/buildAdditionalCostPlan 与 cost.modify 的 optionalAdditional 输入已合入，" +
    "但没有管线把卡程序声明的 optional-additional 阶段费用接进打出 Finalize 的收取（356.2.b.1）；" +
    "『if you paid the additional cost』还需要 356.4.f.1 的费用选择回执绑定，当前冻结 IR 没有该结果条件。effect.damage 与战场单位目标本身已合入，保持可审查结构，不把伤害伪装成无条件可执行卡。",
  abilities,
  sourceText:
    "You may pay :rb_energy_1::rb_rune_fury: as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, deal 2 to a unit at a battlefield."
} satisfies CardProgram;
