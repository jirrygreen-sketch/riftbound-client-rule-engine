import type { CardProgram } from "../../ir/index.js";

/**
 * Irresistible Faefolk (unl-112-219) — Unit, Body, Fae/Ionia; energy 2, Might 1.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-112-219, verbatim):
 *   When I move to a battlefield, you may move an enemy unit to that battlefield.
 *
 * Rules evidence (Core Rules v1.5):
 * - 421.1 / 449.1 / 449.2: a Move is defined by Origin and Destination; the
 *   closed timing point is "object-moved" (events/timing-points.ts), and 458
 *   keeps a Recall (Battlefield→Base, not a Move) out of this trigger.
 * - 383.3.a.3: "you may" is the first part of the effect, so the decision is
 *   made when this triggered ability is finalized/resolved; contract 3.9 writes
 *   it as choice.optional with the chosen instruction inside its body.
 * - 355.5 / 355.7: "an enemy unit" is chosen by the ability's controller and is
 *   therefore a target (TargetSpec). "to that battlefield" is the Destination of
 *   the triggering Move, i.e. the source unit's current location (449.2).
 * - 421.2.a / 451: this is an effect Move, so no exhaust cost applies; the
 *   frozen effect.move primitive submits the move-location action. "that
 *   battlefield" is read at resolution with the contract 3.2 object-property
 *   expression over the symbolic "source" selector (royal-guard precedent), not
 *   a hard-coded location id.
 *
 * Status: judge-required. Re-checked against the merged instruction, program-
 * binding and event batches (RIFT-257/258/259/260/270, 2026-10-16). Two
 * remaining gaps (none approximated):
 * - "to a battlefield" restricts the trigger to Moves whose Destination is a
 *   Battlefield. The declared object-moved payload (fromKind / toKind /
 *   fromLocationId / toLocationId) is still not populated by
 *   events/action-adapter.ts, and the closed EVENT_PATTERN_TYPES has no
 *   "object-moved" spelling, so registerProgramTriggers fails closed
 *   (invalid-event-type, or an unsupported filter field for the retained
 *   `movedToBattlefield` placeholder).
 * - The destination is read with the contract 3.6 symbolic selector
 *   ({kind: "object-property", object: "source"}), and the merged effect.move
 *   schema still does not accept it: its own isExpr requires a runtime ObjectRef
 *   for object-property (effect.move.ts isExpr), so the instruction fails closed
 *   with "effect.move requires a to Expr" before the interpreter can bind the
 *   host reference. The merged read-then-move alternative (condition.value +
 *   effect.move linked-value, the azir-sovereign/fae-porter precedent) is
 *   proven end to end in the golden for the accepting branch, but README §3
 *   forbids rewriting the printed destination away from the contract selector
 *   here.
 * - No merged module registers a CardProgram's triggered ability as
 *   TriggerRegistration, nor resolves the `{source: "self"}` self anchor for
 *   trigger subscriptions (engine batch 4 / RIFT-120 follow-up); the golden test
 *   therefore executes the ability body through the interpreter and reference
 *   kernel and records the production subscription as test.todo.
 */
export default {
  canonicalCardId: "card.hash-bd638db89dd40b1e7a4af53d4b6502145b269d568f69478b4f5e9f979e6a89c3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现（已按 2026-10-16 合入批次复核）：" +
    "(1)「move to a battlefield」把触发限制在目的地为战场的 Move 上（449.2）：events/action-adapter.ts 仍未为 " +
    "move-location 填充 timing-points.ts 声明的 fromKind/toKind/fromLocationId/toLocationId 载荷（RIFT-270 审计记为“已有”时点但不含载荷），" +
    "且封闭 EVENT_PATTERN_TYPES（events/trigger-spec.ts）不含 \"object-moved\"，programs/triggers.ts 注册时抛 invalid-event-type；" +
    "事件 filter 里的 movedToBattlefield 只是描述性占位键，programs/filters.ts 也会以不支持的过滤字段拒绝它。" +
    "(2) 目的地的契约 3.6 符号选择器（{ kind: \"object-property\", object: \"source\" }）仍未被 effect.move 的 schema 接受：" +
    "该原语自己的 isExpr 要求 object-property 的 object 是运行时 ObjectRef（effect.move.ts），因此指令在解释器绑定宿主引用之前就失败关闭" +
    "（\"effect.move requires a to Expr\"）。golden 覆盖两侧证据：拒绝分支在合并 schema 处失败关闭；接受分支用已合入的 " +
    "condition.value + effect.move linked-value 读取来源当前位置并真实把敌方单位移过去（azir-sovereign/fae-porter 先例），" +
    "但 README 第 3 节要求不得把印刷的符号目的地改写成其它形状。" +
    "触发形状与 effect.move 调用形状只用已合入契约结构。依赖：事件载荷与 object-moved 触发拼写/注册（RIFT-120 后续）、" +
    "effect.move 的符号选择器支持（RIFT-90/91 后续）。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-moved",
        filter: {
          event: "object-moved",
          filter: {
            // “When I move”：事件对象是本卡。
            object: "self",
            // “to a battlefield”：目的地种类必须为战场（449.2）；事件载荷未填充，
            // 该键是描述性占位（见 judgeReason 第 1 点）。
            movedToBattlefield: true
          }
        }
      },
      optional: true,
      body: [
        {
          id: "irresistible-faefolk.move-opt",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Move an enemy unit to that battlefield?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "irresistible-faefolk.move-enemy",
                  op: "effect.move",
                  args: {
                    objects: {
                      kind: "constant",
                      value: { target: "irresistible-faefolk.enemy-unit" }
                    },
                    // “that battlefield” = 触发那次 Move 的目的地 = 本卡当前所在位置（449.2）。
                    to: {
                      kind: "object-property",
                      object: "source",
                      property: "location"
                    },
                    amount: { kind: "constant", value: 1 },
                    linkKey: { kind: "constant", value: "moved" }
                  },
                  targets: [
                    {
                      id: "irresistible-faefolk.enemy-unit",
                      filter: { type: "unit", zone: "board", controller: "opponent" },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText: "When I move to a battlefield, you may move an enemy unit to that battlefield."
} satisfies CardProgram;
