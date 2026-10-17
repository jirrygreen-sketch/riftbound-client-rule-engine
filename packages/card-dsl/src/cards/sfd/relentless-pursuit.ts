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
 *   different location where the unit is allowed to be present. effect.move
 *   accepts a destination choice only as a concrete list of LocationRefs
 *   ({ kind: "choose", id, options }) or a target.location provider; no
 *   merged provider enumerates the legal destinations, so the instruction
 *   still carries the documented `dynamic:legal-move-destinations` placeholder.
 * - "You may attach an Equipment with the same controller to it" is an
 *   optional (choice.optional, contract 3.9) attach whose controller must
 *   equal the moved unit's controller. effect.attach exists (RIFT-118), but the
 *   "same controller" anchor for an object filter is not expressible: filters
 *   match a literal PlayerId (or the self/opponent spelling relative to the
 *   filter owner), not "the controller of another selected object".
 *   programs/filters.ts also rejects the anchor-style spellings it cannot
 *   translate. (The two merged primitives spell their object selection
 *   differently: effect.move reads `{ target: id }` / `{ pick: id }`, while
 *   effect.attach reads `{ kind: "target", id }`; each instruction below uses
 *   the vocabulary of the primitive it calls.)
 * - "This turn, that unit has 'When I conquer, you may move me to my base.'"
 *   grants a new triggered ability to the moved unit for the rest of the turn
 *   (830/803-style ability grant). The merged layer primitives cover keyword and
 *   Might grants (continuous.grant-keyword / continuous.might, RIFT-258), but no
 *   merged op grants a whole triggered ability, and the ability-layer consumer
 *   for card statics is still a caller-supplied ProgramStaticBinder callback.
 *   The conquer timing point itself is emitted (turn/flow.ts Score wave).
 *
 * Status: judge-required. Clauses 1 and 3 remain without merged support; the
 * structure keeps the intended target, optional decision and linked referents
 * visible without approximating any of them. Clause 2 is expressible only after
 * an object-relative controller anchor lands.
 */
const relentlessPursuit = {
  canonicalCardId: "card.hash-d07372b97e2617a79fd38c84519913156cea70c47ae9f230f3f51b6aab1a644d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三个缺口：(1)「Move a friendly unit」按 CR v1.5 355.4 需在 Finalize 选定 Move Destination，355.4.a 还要求是「另一个合法位置」；" +
    "effect.move 只接受具体 LocationRef 列表或 target.location 提供方（{ kind: choose, options }），当前没有枚举合法目的地的提供方，" +
    "程序里仍是声明的 dynamic:legal-move-destinations 占位；" +
    "(2)「an Equipment with the same controller」需要「控制者与另一个已选对象相同」的过滤器锚点：现有过滤器只匹配字面 PlayerId 或相对" +
    "过滤器持有者的 self/opponent，programs/filters.ts 也拒绝无法翻译的锚点拼写；" +
    "(3)「This turn, that unit has \"When I conquer, you may move me to my base.\"」需要给被移动单位授予一整条触发能力：" +
    "RIFT-258 的 continuous.grant-keyword / continuous.might 只能授予关键词与 Might，没有授予触发能力的原语，" +
    "卡牌 static 的图层注册消费方也仍是调用方提供的 ProgramStaticBinder 回调（programs/statics.ts 默认 noop）；" +
    "conquer 时点本身已由 turn/flow.ts 的计分波发出。" +
    "不近似实现；依赖：目标位置提供方、对象相对控制者锚点、触发能力授予的 continuous 原语与注册消费方。",
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
