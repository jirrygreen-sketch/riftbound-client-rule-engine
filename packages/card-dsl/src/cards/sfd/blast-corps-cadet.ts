import type { Ability, CardProgram } from "../../ir/index.js";

/** Blast Corps Cadet (sfd-013-221). */
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
    "可选追加费用需要 cost.additional/费用计划接线（356.2.b.1，RIFT-9/RIFT-89）；" +
    "『if you paid the additional cost』还需要 356.4.f.1 的费用选择回执绑定，当前冻结 IR 没有该结果条件。effect.damage 与战场单位目标本身已合入，保持可审查结构，不把伤害伪装成无条件可执行卡。",
  abilities,
  sourceText:
    "You may pay :rb_energy_1::rb_rune_fury: as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, deal 2 to a unit at a battlefield."
} satisfies CardProgram;
