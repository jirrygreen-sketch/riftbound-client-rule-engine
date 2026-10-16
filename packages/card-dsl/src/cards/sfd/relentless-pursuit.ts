import type { CardProgram } from "../../ir/index.js";

/**
 * Relentless Pursuit (sfd-184-221) — Spell, 2 energy + 1 Fury/Body power,
 * Fury/Body, tags Lucian/Signature.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Move a friendly unit. You may attach an Equipment with the same controller
 *   to it. This turn, that unit has "When I conquer, you may move me to my
 *   base."
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is declared as a keyword ability.
 * - "Move a friendly unit" is one targeted Move. 355.4 requires the Move
 *   Destination to be chosen during Finalize, and 355.4.a restricts it to a
 *   different location where the unit is allowed to be present. No merged
 *   primitive supplies that plan: effect.move takes an already-finalized
 *   destination as an argument and throws for anything it does not recognize,
 *   and there is no target/location provider (target.location) in merged code.
 * - "You may attach an Equipment with the same controller to it" is an
 *   optional (choice.optional, contract 3.9) attach whose controller must
 *   equal the moved unit's controller. effect.attach exists, but the
 *   "same controller" anchor for an object filter is not expressible: the
 *   merged filters match a literal PlayerId, not "the controller of another
 *   selected object". (The two merged primitives spell their object selection
 *   differently: effect.move reads `{ target: id }` / `{ pick: id }`, while
 *   effect.attach reads `{ kind: "target", id }`; each instruction below uses
 *   the vocabulary of the primitive it calls.)
 * - "This turn, that unit has 'When I conquer, you may move me to my base.'"
 *   grants a new triggered ability to the moved unit for the rest of the turn
 *   (830/803-style ability grant). It needs a continuous ability-layer grant
 *   with an end-of-turn duration plus the conquer trigger and the Move of the
 *   conquer effect; none of those exist in merged code.
 *
 * Status: judge-required. All three clauses are missing merged support; the
 * structure keeps the intended target, optional decision and linked referents
 * visible without approximating any of them.
 */
const relentlessPursuit = {
  canonicalCardId: "card.hash-d07372b97e2617a79fd38c84519913156cea70c47ae9f230f3f51b6aab1a644d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三个缺口都没有已合入支持：(1)「Move a friendly unit」按 CR v1.5 355.4 需在 Finalize 选定 Move Destination，" +
    "355.4.a 还要求是「另一个合法位置」；当前没有 target.location / 目标位置提供方，effect.move 只接受已 Finalize 的目的地。" +
    "(2)「an Equipment with the same controller」需要「控制者与另一个已选对象相同」的过滤器锚点，现有 filter 只能匹配字面 PlayerId。" +
    "(3)「This turn, that unit has \"When I conquer, you may move me to my base.\"」需要带 end-of-turn 期限的 continuous 能力授予" +
    "与征服触发的 Move（RIFT-91 layers-continuous 未实现）。不近似实现；依赖：目标位置提供方、continuous 能力层与征服触发管线。",
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Move a friendly unit. You may attach an Equipment with the same controller to it. This turn, that unit has \"When I conquer, you may move me to my base.\"",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          // "Move a friendly unit" — 355.4 destination chosen at Finalize;
          // no merged provider supplies it (see judgeReason).
          id: "relentless-pursuit.move",
          op: "effect.move",
          args: {
            objects: { kind: "constant", value: { target: "relentless-pursuit.unit" } },
            // 355.4: the destination is chosen at Finalize; the option list is
            // runtime data that only a location provider can fill.
            to: {
              kind: "constant",
              value: {
                kind: "choose",
                id: "relentless-pursuit.destination",
                options: ["dynamic:legal-move-destinations"]
              }
            }
          },
          targets: [
            {
              id: "relentless-pursuit.unit",
              filter: { type: "unit", controller: "controller" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "You may attach an Equipment with the same controller to it":
          // one optional decision wrapping the attach (contract 3.9).
          id: "relentless-pursuit.may-attach",
          op: "choice.optional",
          linkedTo: "relentless-pursuit.move",
          args: {
            prompt: { kind: "constant", value: "Attach an Equipment with the same controller to that unit?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "relentless-pursuit.attach",
                  op: "effect.attach",
                  args: {
                    objects: {
                      kind: "constant",
                      value: { kind: "target", id: "relentless-pursuit.equipment" }
                    },
                    host: {
                      kind: "constant",
                      value: { kind: "target", id: "relentless-pursuit.unit" }
                    }
                  },
                  targets: [
                    {
                      id: "relentless-pursuit.equipment",
                      // "with the same controller": the anchor cannot name the
                      // other selected object's controller (judgeReason).
                      filter: {
                        type: "gear",
                        tags: ["Equipment"],
                        controller: "same-as:relentless-pursuit.unit"
                      },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        },
        {
          // "This turn, that unit has '...'": a continuous ability grant with
          // an end-of-turn duration; no merged op consumes it (judgeReason).
          id: "relentless-pursuit.grant-ability",
          op: "continuous.grant-ability",
          args: {
            duration: { kind: "constant", value: "this-turn" },
            ability: {
              kind: "constant",
              value: {
                kind: "triggered",
                trigger: { at: "conquer", filter: { role: "self" } },
                optional: true,
                body: [
                  {
                    id: "relentless-pursuit.conquer-recall",
                    op: "effect.move",
                    args: {
                      objects: { kind: "constant", value: "self" },
                      to: { kind: "constant", value: "controller-base" }
                    }
                  }
                ]
              }
            },
            target: { kind: "constant", value: "relentless-pursuit.unit" }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default relentlessPursuit;
