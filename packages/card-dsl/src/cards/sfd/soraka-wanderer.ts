import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Soraka, Wanderer (sfd-173-221) — Unit, 4 energy + 1 Order power, Might 4,
 * tags Soraka / Mount Targon / Champion.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-173-221):
 *   I must be assigned combat damage last.
 *   If another unit you control here would die, if it has less Might than me,
 *   instead heal it, exhaust it, and recall it. (Send it to base. This isn't a
 *   move.)
 *
 * Rules evidence (Core Rules v1.5):
 * - "I must be assigned combat damage last" is the Backline assignment
 *   restriction (826.3 / 826.4.b: units with Backline are invalid assignments
 *   until every unit without Backline has lethal damage assigned). It is a
 *   Passive Ability keyword; the card declares keyword "backline" (the same
 *   shape Merged Volibear/Caitlyn programs use for Tank) and does not restate
 *   the assignment rule.
 * - "would die ... instead heal it, exhaust it, and recall it" is a Replacement
 *   Effect (369.1 names Zhonya's Hourglass, whose text includes "heal that unit,
 *   exhaust it, and recall it", as its example); the replaced event is the death
 *   of another unit the controller controls at Soraka's location (370.3, 370.4:
 *   her replacement also applies to deaths simultaneous with her own leaving).
 *   "if it has less Might than me" compares the two units' Might (143.2.a).
 * - 457 / 458 / 460: a Recall relocates a permanent to its Base without being a
 *   Move; 460.1 keeps damage and statuses, so the printed heal and exhaust are
 *   performed by the replacement body.
 *
 * Status: judge-required — every remaining gap is reproduced against merged
 * source in the golden test, none approximated:
 * - [Backline] now has a KeywordDef (effects/keywords/Backline.ts) that binds
 *   into the ability layer as continuous.combat, but the combat damage step
 *   still consumes no assignment-priority requirement:
 *   combat/base-combat-allocation.ts states "No Tank/Backline/other
 *   assignment-priority requirement is bound here" and layers/engine.ts has no
 *   combat-effect branch, so 826.3/826.4.b still cannot be executed.
 * - the replacement registration path has landed (replacement/bind.ts): a card
 *   ReplacementAbility becomes an event-pipeline registration and the replaced
 *   event's object is addressable as { linked: "replacement.object" }
 *   (CR 355.10.c "it"). This card's with body uses that selector; the printed
 *   "here"/"another unit" filter still cannot be enforced — the production
 *   pattern matcher ignores sameLocationAs/other and the production filter
 *   translator rejects both keys, so bindReplacement fails on the recall step
 *   before any of that (golden).
 * - the replacement-time Might comparison is unevaluable: the CardProgram
 *   validator rejects { linked: "replacement.object" } as a condition operand
 *   (linked-instruction-not-prior / unresolved-instruction), the card's declarative { target: ... }
 *   spelling throws MissingInformation inside evaluateCondition because the
 *   replacement pipeline's condition environment binds no targets, and
 *   layers/engine.ts conditionMatches still does not evaluate compare.
 * - effect.move still blocks its recall mode ("Recall requires an action
 *   distinct from Move (CR 457-460)") and submits no substitute Move. Recall is
 *   not a Move (458), so approximating it with move-location/effect.zone is
 *   forbidden; replacement/planner.ts rejects the authored mode at plan time.
 * Dependencies: combat assignment batch (826), the location/other anchors for
 * replacement patterns, replacement-time condition object binding, and the
 * recall action (CR 457-460).
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "backline" },
  {
    kind: "replacement",
    replaces: {
      event: "object-killed",
      filter: {
        type: "unit",
        // "another unit you control" (355.9.c, 370.3): same controller as
        // Soraka and not Soraka herself. "here" needs the from/current-location
        // anchor of the replaced unit (359.3.f), recorded descriptively.
        controller: "self",
        other: true,
        sameLocationAs: "self"
      }
    },
    // "if it has less Might than me": no merged expression reads another
    // object's Might; the comparison is recorded in the ability condition and
    // its evaluator is the judged part.
    condition: {
      kind: "compare",
      left: {
        kind: "object-property",
        object: { target: "soraka.dying-unit" },
        property: "might"
      },
      operator: "lt",
      right: {
        kind: "object-property",
        object: "self",
        property: "might"
      }
    },
    with: [
      {
        id: "soraka.heal-dying-unit",
        op: "effect.heal",
        args: {
          // The replaced event's unit; not a target (355.10.c), so the planner
          // resolves the event-object link at replacement application time.
          objects: { kind: "constant", value: { linked: "replacement.object" } },
          linkKey: { kind: "constant", value: "healed" }
        },
        // The condition's declarative selector needs a named target in the
        // frozen CardProgram validator. Replacement planning ignores this
        // choice and resolves the printed "it" through replacement.object.
        targets: [
          {
            id: "soraka.dying-unit",
            filter: {
              type: "unit",
              controller: "controller",
              other: true,
              sameLocationAs: "self"
            },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        id: "soraka.exhaust-dying-unit",
        op: "effect.exhaust",
        linkedTo: "soraka.heal-dying-unit",
        args: {
          // 460.1 exception stated by this card: the recalled unit is exhausted,
          // so the state change is authored explicitly (as in the merged
          // Zhonya's Hourglass program).
          target: { kind: "constant", value: { linked: "replacement.object" } }
        }
      },
      {
        id: "soraka.recall-dying-unit",
        op: "effect.move",
        linkedTo: "soraka.exhaust-dying-unit",
        args: {
          objects: { kind: "constant", value: { linked: "replacement.object" } },
          // A Recall returns the permanent to its Base (457); the merged
          // primitive accepts "recall" but returns negated/impossible with a
          // blockedReason instead of substituting a Move (458/458.3).
          to: { kind: "constant", value: "controller-base" },
          mode: { kind: "constant", value: "recall" },
          linkKey: { kind: "constant", value: "recalled" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-0d756f766acd32a10e9b167b29aabb9d0be6ef340ce4d1b8ad068ed7f9fb3d15",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "四处当前缺口，均不近似实现：(1) [Backline]（826）的 KeywordDef 已合入（effects/keywords/Backline.ts，注册为 continuous.combat/damage-assignment），" +
    "但它只落到 ability 图层；战斗伤害步骤仍未绑定 Tank/Backline 的分配优先级（combat/base-combat-allocation.ts 明确 “No Tank/Backline/other assignment-priority requirement is bound here”，" +
    "layers/engine.ts 也没有 continuous.combat 消费分支），826.3/826.4.b 仍不可执行；(2) 替代注册路径已合入（replacement/bind.ts：bindReplacement 把卡牌 ReplacementAbility 注册为事件管线替代，" +
    "被替代事件对象以 { linked: \"replacement.object\" } 绑定），本卡 with 体已直接使用该事件对象链接选择符，golden 可经真实 planner 规划 heal/exhaust 两步；" +
    "但印刷的 “here”/“another unit” 过滤无法执行：生产 pattern 匹配忽略 sameLocationAs/other（golden 实测异地单位的 kill 仍然匹配），" +
    "programs/filters.ts 也直接拒绝这两个键。(3)「if it has less Might than me」需要在替代时比较两个对象的有效 Might（143.2.a）：" +
    "compare/object-property 求值本身已合入（effects/interpreter/condition.ts），但 CardProgram 条件校验器不允许把替代专用的 { linked: \"replacement.object\" } 当作条件链接（linked-instruction-not-prior / unresolved-instruction，只能引用此前 instruction），" +
    "而本卡声明的 { target: ... } 选择符在 replacement 的条件环境里没有 target 绑定，求值抛 MissingInformation（golden 实测）；" +
    "layers/engine.ts 的 conditionMatches 仍不求值 compare，静态/图层路线也带不了它。(4) 即使绑定到对象，effect.move 的 recall 模式仍被显式阻断" +
    "（“Recall requires an action distinct from Move”，458/458.3），replacement/planner.ts 在规划期即抛 BlockedReplacementError，且不得用普通移动近似（Recall 不是 Move）。" +
    "依赖：战斗分配批次（826）、替代 pattern 的 here/other 锚点、替代时条件对象绑定与 Recall 动作（457-460）（见契约变更请求）。",
  abilities,
  sourceText:
    "I must be assigned combat damage last.\n" +
    "If another unit you control here would die, if it has less Might than me, instead heal it, exhaust it, and recall it. (Send it to base. This isn't a move.)"
} satisfies CardProgram;

export default program;
