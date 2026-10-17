import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Ephemeral Ward — CR v1.5 143.2.a/475-479 (continuous Might),
 * 420.4.a/429.1 (your unit play trigger kills this).
 * The source itself is included: the printed text does not say another.
 */

const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      amount: { kind: "constant", value: 2 },
      filter: { type: "unit", controller: "controller", zone: "board" }
    }
  },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      // "When you play a unit"：打出完成时点（420.4.a），玩家是能力控制者、牌是单位；
      // 原文没有 "another"，打出本卡自身也满足条件。
      filter: { event: "card-played", object: { type: "unit" }, player: "controller" }
    },
    optional: false,
    body: [
      {
        id: "ephemeral-ward.kill-this",
        op: "effect.kill",
        args: {
          self: { kind: "constant", value: true },
          reason: { kind: "constant", value: "card-played-unit" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-9ec6311582c4337e549c7a39070aeaf28ae3996142538fa2fb11c3b16cebcf5b",
  rulesetVersion: "core-1.5" as const,
  status: "executable" as const,
  abilities,
  sourceText: "Your units have +2 :rb_might:.\nWhen you play a unit, kill this."
} satisfies CardProgram;

export default program;
