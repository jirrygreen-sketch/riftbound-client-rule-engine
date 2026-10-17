import type { CardProgram } from "../../ir/index.js";

/**
 * Trifarian Gloryseeker — CR v1.5 812.1.b.1/812.1.c, 702.2.a, 702.3.a.
 * Legion requires another card Finalized this turn. Its history-dependent
 * activation and a non-target Buff-self path still need adapters (RIFT-359).
 * The retained TargetSpec is blocked data, not a substitute for non-target Buff.
 */
const trifarianGloryseeker = {
  canonicalCardId: "card.hash-0e5542d49264324b5497b244de3b3ad36381c763af055108066e1b17f7fb2aa7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Legion]（CR 812.1.b.1/812.1.c）的本回合另一张已 Finalized 牌条件仍缺触发时求值：count 表达式只数当前对象，condition.history 是结算期指令；Legion 展开 condition.predicate 的 history.excluding 也未接入静态谓词消费。依赖条件谓词 RIFT-359。" +
    "「buff me」属于非目标自身选择（355.10.d.1），effect.buff 目前仅收 TargetSpec id；现有 self-unit TargetSpec 只能保留为受阻描述，不能通过 Finalize 冒充非目标选择，否则会错误产生 became-target。" +
    "CardProgram 触发注册与 self 锚点归一化已合入；但生产触发绑定先经 programs/filters.translateObjectFilter，Legion 展开 condition.predicate 无 statics.layerFor 图层映射会被拒绝，history.excluding 也不在 condition.history 允许键中（HistoryQuery 契约级缺口），且 body TargetSpec 的 object:'self' 键被 translateObjectFilter 拒绝；仍需 Legion 条件的历史/身份排除绑定和 effect.buff 的非目标自身选择。",
  abilities: [
    { kind: "keyword", keyword: "legion" },
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self" } },
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
          id: "trifarian-gloryseeker.buff-me",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "self-unit" }
          },
          targets: [
            {
              id: "self-unit",
              filter: { object: "self", type: "unit", zone: "board" },
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
    "[Legion] — When you play me, buff me. (If I don't have a buff, I get a +1 :rb_might: buff. " +
    "Get the effect if you've played another card this turn.)"
} satisfies CardProgram;

export default trifarianGloryseeker;
