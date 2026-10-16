import type { CardProgram } from "../../ir/index.js";

/**
 * Dune Drake (ogn-131-298) — Unit, 5 energy, no printed power (Body), 5 Might.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-131-298):
 *   When I attack, give me +2 :rb_might: this turn if there is a ready enemy
 *   unit here.
 *
 * 规则依据（CR v1.5）：
 * - “When I attack”：攻击触发（383.4.e；时点 attack-declared，ruleRefs 323.2、383.4.e、
 *   466.2.c），filter 指向自身。
 * - 383.2.a.1：“if there is a ready enemy unit here” 紧跟在触发条件之后，属于 Trigger
 *   Condition（不是效果的一部分），在进链前判定。
 * - “give me +2 Might this turn”：临时 Might 修正，期限为本回合末（143.2.a、479 图层）。
 *   effect.buff 的边界注释明确临时 Might 归 layers 的 continuous.might，绝不写成 Buff
 *   counter（702/703 是另一回事）。
 *
 * status: judge-required —— Might 指令本体已经可以注册并在回合末到期；仍有两处依赖：
 * 1. 触发条件需要“此处是否有 ready 敌方单位”的集合判定；`states: "ready"` 是
 *    events/trigger-spec.ts 的 ObjectState 拼写，但引擎侧 matchesObjectFilter 之外的
 *    payload/条件求值路径尚未对触发条件开放该判定，且 attack-declared 无发射方（见
 *    crackshot-corsair 的同一缺口）。条件写法保留为可审查意图，不近似实现。
 */
export default {
  canonicalCardId: "card.hash-129e18f9d31400f8fce66c0a8cb60d4ca43ce586a107ec18cb24bee9d79e81d9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "continuous.might 与 end-of-turn 期限已经由 RIFT-258/259 合入，正文 +2 Might 可通过解释器和图层内核执行；" +
    "仍缺「if there is a ready enemy unit here」在 attack-declared 触发中的运行时条件求值，以及 attack-declared 的 Combat 角色事务发射方" +
    "（CR 383.2.a.1、383.4.e、466.2.c；RIFT-124、RIFT-270）。卡牌程序触发绑定仍依赖 RIFT-257，不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "attack-declared",
        filter: { event: "attack-declared", filter: { source: "self" } },
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "ready-enemy-units-here",
            filter: {
              type: "unit",
              controller: "opponent",
              states: "ready",
              sameLocationAs: "source"
            }
          },
          operator: "gte",
          right: { kind: "constant", value: 1 }
        }
      },
      optional: false,
      body: [
        {
          id: "dune-drake.grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "this-turn" },
            appliesTo: { kind: "constant", value: "self" }
          }
        }
      ]
    }
  ],
  sourceText:
    "When I attack, give me +2 :rb_might: this turn if there is a ready enemy unit here."
} satisfies CardProgram;
