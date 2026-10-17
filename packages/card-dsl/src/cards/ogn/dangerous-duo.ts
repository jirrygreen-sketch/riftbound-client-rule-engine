import type { CardProgram } from "../../ir/index.js";

/**
 * Dangerous Duo (ogn-016-298) — Rumble SFD precon unit.
 *
 * [Legion] — When you play me, give a unit +2 [M] this turn.
 * (Get the effect if you've played another card this turn.)
 *
 * Legion (CR v1.5 812.1.b.1: "If you have played another card this turn,
 * this card gains [Text]") is a dependent keyword; it gates the dependent
 * ability is a card-played trigger whose body grants +2 Might for the rest
 * of the turn. A duration-bounded Might modifier is continuous.might
 * territory; the merged instruction registers the
 * arithmetic-layer effect through ctx.addContinuous.
 */
export default {
  canonicalCardId: "card.hash-d4e849d845765608b07bf4af4aa19877f6303dfff539b541d0d070320dd05d91",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 continuous.might 正文进链前的 Legion 历史条件适配（CR 812.1.b.1/812.1.c、383.2.c）：" +
    "普通 count 表达式只查询当前对象，不读取 cards-finalized-this-turn 历史；" +
    "condition.history 已是解释器指令，HistoryQuery.exclude:self 也已能排除本卡并保留同名的另一实体，但尚无将该查询用于 TriggerSpec.condition 的条件表达式。" +
    "还须对齐本回合 Finalize 时点的记录与重置；程序触发注册本身已有实现。",
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
