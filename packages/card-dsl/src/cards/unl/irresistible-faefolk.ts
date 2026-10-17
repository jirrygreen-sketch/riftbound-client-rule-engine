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
 *   the triggering Move, captured when the trigger condition is fulfilled (359.3.f.3).
 * - 421.2.a / 451: this is an effect Move, so no exhaust cost applies; the
 *   frozen effect.move primitive submits the move-location action. "that
 *   battlefield" uses the merged source-location expression over the captured
 *   trigger source, rather than the source object's later live location.
 *
 * Status: judge-required. The remaining gap is the object-moved event vocabulary
 * and Destination-kind gate. The merged location expression resolves the captured
 * source snapshot, so later moves or zone exits do not redirect this instruction
 * (359.3.f.3). The original optional body has real execution coverage. It does not
 * prove the missing event registration or Destination gate.
 */
export default {
  canonicalCardId: "card.hash-bd638db89dd40b1e7a4af53d4b6502145b269d568f69478b4f5e9f979e6a89c3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺 object-moved 触发的生产绑定（CR 449.2、359.3.f.3）：EVENT_PATTERN_TYPES 未收录 object-moved，" +
    "action-adapter.ts 未填充 fromKind/toKind/fromLocationId/toLocationId，movedToBattlefield 也没有过滤器适配，无法限制“目的地为战场”的 Move。",
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
                    // 359.3.f.3：链上下文 source 是触发时的快照；随后移动不改指代。
                    to: { kind: "location", value: "source-location" },
                    amount: { kind: "constant", value: 1 },
                    linkKey: { kind: "constant", value: "moved" }
                  }
                }
              ]
            }
          },
          // Lock the enemy target when finalizing this optional ability (355.5.b).
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
  ],
  sourceText: "When I move to a battlefield, you may move an enemy unit to that battlefield."
} satisfies CardProgram;
