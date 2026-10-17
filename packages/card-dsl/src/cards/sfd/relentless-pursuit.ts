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
 * Current review:
 * CR v1.5 355.4/355.4.a: Move destinations are fixed at Finalize.
 * target.location can enumerate locations, but this card still needs a legal
 * destination plan, nested optional targets and a temporary triggered-ability
 * grant. Default static binding is already present; see judgeReason.
 */
const relentlessPursuit = {
  canonicalCardId: "card.hash-d07372b97e2617a79fd38c84519913156cea70c47ae9f230f3f51b6aab1a644d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Move a friendly unit」仍缺 CR v1.5 355.4/355.4.a 的 Finalize 目的地计划：target.location/queryLocationCandidates 已能枚举位置，但未按被移动单位绑定「另一个合法位置」，当前 IR 的 dynamic:legal-move-destinations 仍是占位。可选附装备的嵌套 TargetSpec 缺目标生命周期适配，same-as:relentless-pursuit.unit 也不是 programs/filters.ts 支持的控制者锚点。最后的 continuous.grant-ability 没有指令或图层消费方，无法授予并在回合结束移除整条 conquer 触发能力。依赖：Move 目的地 Finalize 绑定、可选嵌套目标与触发能力授予/到期；不近似实现。",
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
          // location enumeration exists; the Finalize Move plan is still missing.
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
