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
 * Status: judge-required — two of the original four gaps are now closed by
 * merged work, none approximated:
 * - [Backline] now has a KeywordDef (effects/keywords/Backline.ts, keyword
 *   batch RIFT-264~268) and the combat damage step still binds no
 *   assignment-priority requirement: combat/base-combat-allocation.ts states
 *   "No Tank/Backline/other assignment-priority requirement is bound here", so
 *   826.3/826.4.b still cannot be executed.
 * - the replacement registration path has landed (RIFT-260 replacement/):
 *   bindReplacement turns a card ReplacementAbility into an event-pipeline
 *   registration, and the replaced event's object is addressable as
 *   { linked: "replacement.object" } (CR 355.10.c "it"). This card's with body
 *   still spells it as a declarative { target: "soraka.dying-unit" } selector,
 *   which makes replacement/planner.ts's selectorRef recurse until the stack
 *   overflows (RangeError) instead of binding; the body needs the event-object
 *   selector spelling.
 * - the Might-comparison gap remains, but it is narrower than "the IR has no
 *   expression": evaluation exists (effects/interpreter/condition.ts evaluates
 *   compare/object-property against live snapshots). What is missing is a
 *   replacement-time binding for two different objects: the left operand must
 *   read the replaced event's unit — the same { linked: "replacement.object" }
 *   spelling — and layers/engine.ts's conditionMatches still does not evaluate
 *   compare conditions, so a static/layer route cannot carry it either.
 * - effect.move still blocks its recall mode ("Recall requires an action
 *   distinct from Move (CR 457-460)") and submits no substitute Move, so even a
 *   bound unit could not be recalled. Recall is not a Move (458), so
 *   approximating it with move-location/effect.zone is forbidden.
 * Dependencies: combat assignment batch (826), the replacement event-object
 * selector binding for the card's own with body, the recall action (CR 457-460),
 * and the Might-comparison contract request recorded in the reply.
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
          // The replaced event's unit; not a target (355.10.c), so the selector
          // id stays declarative until the event-object selector lands.
          // effect.heal reads its selection as { kind: "target", id }.
          objects: {
            kind: "constant",
            value: { kind: "target", id: "soraka.dying-unit" }
          },
          linkKey: { kind: "constant", value: "healed" }
        },
        // Declarative stand-in for the replaced event's unit, kept so the with
        // body has a single named referent ("it", 355.10.c) and so the Might
        // comparison below validates. The unit is NOT a target choice the
        // replacement makes; the real binding comes from the replaced event
        // once the event-object selector lands (see judgeReason).
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
          target: { kind: "constant", value: "soraka.dying-unit" }
        }
      },
      {
        id: "soraka.recall-dying-unit",
        op: "effect.move",
        linkedTo: "soraka.exhaust-dying-unit",
        args: {
          objects: { kind: "constant", value: { target: "soraka.dying-unit" } },
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
    "原始四处缺口中的两处已由合入工作收窄，仍不近似实现：(1) [Backline]（826）的 KeywordDef 已合入（effects/keywords/Backline.ts，关键词批次 RIFT-264~268），" +
    "但战斗伤害步骤仍未绑定 Tank/Backline 的分配优先级（combat/base-combat-allocation.ts 明确 “No Tank/Backline/other assignment-priority requirement is bound here”），" +
    "826.3/826.4.b 仍不可执行；(2) 替代注册路径已合入（RIFT-260 的 replacement/：bindReplacement 把卡牌 ReplacementAbility 注册为事件管线替代，" +
    "被替代事件对象以 { linked: \"replacement.object\" } 绑定），但本卡 with 体仍把它写成声明性的 { target: \"soraka.dying-unit\" } 选择符——`forEach` 计划器在解析该选择符时" +
    "无限递归（RangeError），无法完成绑定；需要把 with 体改写成事件对象链接选择符。(3)「if it has less Might than me」需要在替代时比较两个对象的有效 Might（143.2.a）：" +
    "compare/object-property 求值本身已合入（effects/interpreter/condition.ts），缺口是替代时的对象绑定——左操作数要读被替代事件单位（同一个 { linked: \"replacement.object\" }），" +
    "而 layers/engine.ts 的 conditionMatches 仍不求值 compare，静态/图层路线也带不了它。(4) 即使绑定到对象，effect.move 的 recall 模式仍被显式阻断" +
    "（“Recall requires an action distinct from Move”，458/458.3），且不得用普通移动近似（Recall 不是 Move）。" +
    "依赖：战斗分配批次（826）、替代事件对象选择符绑定（RIFT-260 的 with 体接线）、Recall 动作（457-460）与 Might 比较的替代时对象绑定（见契约变更请求）。",
  abilities,
  sourceText:
    "I must be assigned combat damage last.\n" +
    "If another unit you control here would die, if it has less Might than me, instead heal it, exhaust it, and recall it. (Send it to base. This isn't a move.)"
} satisfies CardProgram;

export default program;
