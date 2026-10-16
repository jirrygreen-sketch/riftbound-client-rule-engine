import type { CardProgram } from "../../ir/index.js";

/**
 * Gem Jammer (sfd-007-221) — Rumble SFD precon unit.
 *
 * When you play me, give a unit [Ganking] this turn.
 * (It can move from battlefield to battlefield.)
 *
 * "When you play me" subscribes to the card-played timing point with
 * role "self". The granted keyword is Ganking (CR v1.5 810), applied as an
 * end-of-turn continuous keyword grant. The continuous.grant-keyword layer
 * is owned by RIFT-91 (layers-continuous); the Ganking keyword expansion is
 * owned by RIFT-83 (kw-ganking-vision). No registered primitive currently
 * accepts a duration-bounded keyword grant, so the program is judge-required.
 */
export default {
  canonicalCardId: "card.hash-f0ac9d90de705764ec57a50fb7483a35117949080af9f6a959eb42a7b887c9e9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「give a unit [Ganking] this turn」需要带 end-of-turn 期限的 continuous.grant-keyword 持续效果；" +
    "当前没有已注册的原语 / 关键词展开可落地该授予（continuous.keyword 尚无实现）。" +
    "依赖：RIFT-91（layers-continuous）、RIFT-83（kw-ganking-vision 关键词展开）。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          id: "gem-jammer.grant-ganking",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Ganking" },
            duration: { kind: "constant", value: "end-of-turn" }
          },
          targets: [
            {
              id: "gem-jammer.unit",
              filter: { zone: "board", type: "unit" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "When you play me, give a unit [Ganking] this turn. (It can move from battlefield to battlefield.)"
} satisfies CardProgram;
