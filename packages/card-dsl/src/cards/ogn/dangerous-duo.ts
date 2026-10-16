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
 * territory (layers / RIFT-91); the merged instruction registers the
 * arithmetic-layer effect through ctx.addContinuous.
 */
export default {
  canonicalCardId: "card.hash-d4e849d845765608b07bf4af4aa19877f6303dfff539b541d0d070320dd05d91",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "continuous.might 已合入并可通过 dangerous-duo.unit 的 TargetSpec 注册本回合结束到期的 +2 Might；" +
    "仍缺 [Legion] 的本回合另一张牌历史条件（包括排除本卡自身）以及 CardProgram triggered ability 的生产链绑定，" +
    "不能仅凭局部 Might 执行证据将整卡标为 executable。依赖：RIFT-82（Legion 关键词定义）、" +
    "RIFT-9（history/excluding 条件语义）、RIFT-257（CardProgram 能力与触发订阅绑定）。",
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
            duration: { kind: "constant", value: "end-of-turn" },
            target: { kind: "constant", value: "dangerous-duo.unit" }
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
