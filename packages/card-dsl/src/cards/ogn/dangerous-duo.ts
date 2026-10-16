import type { CardProgram } from "../../ir/index.js";

/**
 * Dangerous Duo (ogn-016-298) — Rumble SFD precon unit.
 *
 * [Legion] — When you play me, give a unit +2 [M] this turn.
 * (Get the effect if you've played another card this turn.)
 *
 * Legion (CR v1.5 812.1.b.1: "If you have played another card this turn,
 * this card has [Text]") is a dependent keyword owned by RIFT-82
 * (kw-deathknell-legion); it gates the dependent ability. The dependent
 * ability is a card-played trigger whose body grants +2 Might for the rest
 * of the turn. A duration-bounded Might modifier is continuous.might
 * territory (layers / RIFT-91); the reference kernel records the intended
 * continuous effect through ctx.addContinuous so the instruction body can be
 * smoke-executed, while real Might arithmetic waits for the layers work.
 */
export default {
  canonicalCardId: "card.hash-d4e849d845765608b07bf4af4aa19877f6303dfff539b541d0d070320dd05d91",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「give a unit +2 [M] this turn」需要带 end-of-turn 期限的 continuous.might 持续效果；" +
    "Might 加减不进 Buff 原语（见 effect.buff 边界注释），当前没有已注册的 continuous.might 实现。" +
    "Legion 条件（本回合已打出另一张牌）依赖 condition.history 与 RIFT-82 的关键词展开。" +
    "依赖：RIFT-91（layers-continuous）、RIFT-82（kw-deathknell-legion）、RIFT-89/90（条件历史查询落地）。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { role: "self" } },
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "cards-finalized-this-turn",
            filter: { player: "controller", exclude: "self" }
          },
          operator: "gte",
          right: { kind: "constant", value: 1 }
        }
      },
      optional: false,
      body: [
        {
          id: "dangerous-duo.grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "end-of-turn" }
          },
          targets: [
            {
              id: "dangerous-duo.unit",
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
    "[Legion] — When you play me, give a unit +2 :rb_might: this turn. (Get the effect if you've played another card this turn.)"
} satisfies CardProgram;
