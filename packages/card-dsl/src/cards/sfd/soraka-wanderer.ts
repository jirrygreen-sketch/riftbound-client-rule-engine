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
 * Status: judge-required — the whole ability is barred by four merged gaps,
 * none approximated:
 * - [Backline] has no KeywordDef (effects/keywords/ contains no Backline.ts)
 *   and the combat damage step binds no assignment-priority requirement:
 *   combat/base-combat-allocation.ts states "No Tank/Backline/other
 *   assignment-priority requirement is bound here", so 826.3/826.4.b cannot be
 *   executed.
 * - a card-declared ReplacementAbility has no registration path (engine batch
 *   4's event pipeline registers replacements as action matchers; no code turns
 *   a card program into one), and there is no selector for the replaced event's
 *   object (the dying unit is not a target choice, 355.10.c).
 * - "if it has less Might than me" needs the effective Might of two different
 *   objects compared at replacement time; the frozen IR has no expression that
 *   reads another object's Might, and the layer engine's conditionMatches does
 *   not evaluate compare conditions.
 * - effect.move blocks its recall mode ("Recall requires an action distinct
 *   from Move (CR 457-460)") and submits no substitute Move, so even a bound
 *   unit could not be recalled. Recall is not a Move (458), so approximating it
 *   with move-location/effect.zone is forbidden.
 * Dependencies: keyword batch (Backline), combat assignment batch (826),
 * replacement.enter/event registration (engine batch 4), the recall action, and
 * the Might-comparison contract request recorded in the reply.
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
    "四处依赖未合入：(1) [Backline]（826）没有 KeywordDef（effects/keywords/ 无 Backline.ts），战斗伤害步骤也未绑定 Tank/Backline 的分配优先级" +
    "（combat/base-combat-allocation.ts 明确 “No Tank/Backline/other assignment-priority requirement is bound here”），826.3/826.4.b 不可执行；" +
    "(2) 卡牌级 ReplacementAbility 没有注册路径（RIFT-120 的事件管线以动作匹配器注册替代，但没有卡牌程序→注册的接线），with 体也没有指向“被替代事件对象”的选择符" +
    "（该单位按 355.10.c 不是目标选择）；(3)「if it has less Might than me」需要在替代时比较两个对象的有效 Might（143.2.a），冻结 IR 没有读取他者 Might 的表达式，" +
    "图层 conditionMatches 也不求值 compare；(4) 即使绑定到对象，effect.move 的 recall 模式被显式阻断" +
    "（“Recall requires an action distinct from Move”，458/458.3），且不得用普通移动近似（Recall 不是 Move）。" +
    "依赖：关键词批次（Backline）、战斗分配批次（826）、替代注册（引擎批 4）、Recall 动作与事件对象选择符（见契约变更请求）。",
  abilities,
  sourceText:
    "I must be assigned combat damage last.\n" +
    "If another unit you control here would die, if it has less Might than me, instead heal it, exhaust it, and recall it. (Send it to base. This isn't a move.)"
} satisfies CardProgram;

export default program;
