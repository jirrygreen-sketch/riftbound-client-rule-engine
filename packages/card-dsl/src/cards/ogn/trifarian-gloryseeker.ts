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
    "[Legion]（CR 812.1.b.1/812.1.c）的本回合另一张已 Finalized 牌条件仍缺触发时求值：count 表达式只数当前对象，condition.history 是结算期指令；Legion 展开的 condition.predicate 无 statics.layerFor 图层映射，触发时谓词消费仍未接入（RIFT-359）。" +
    "契约 §3.8 与 condition.history 已支持 exclude: 'self'，能排除本卡对象并保留相同 canonicalCardId 的另一张牌；Legion 展开的 history.excluding 是过时字段，需要改用现有 exclude 选择器，不需要新增按 canonicalCardId 排除的契约。" +
    "「buff me」属于非目标自身选择（355.10.d.1），effect.buff 目前仅收 TargetSpec id；现有 self-unit TargetSpec 只能保留为受阻描述，不能通过 Finalize 冒充非目标选择，否则会错误产生 became-target。" +
    "CardProgram 触发注册与 self 锚点归一化已合入，但 body TargetSpec 的 object:'self' 键仍被 programs/filters.translateObjectFilter 拒绝；需修正关键词展开、接入触发时历史谓词，并支持 effect.buff 的非目标自身选择。",
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
