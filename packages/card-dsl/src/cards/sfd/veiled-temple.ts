import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Veiled Temple (sfd-221-221) — Battlefield, Fiora precon.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-221-221):
 *   When you conquer here, you may ready a friendly gear. If it's an
 *   Equipment, you may detach it.
 *
 * Rules evidence (Core Rules v1.5):
 * - "When you conquer here" is the Conquer trigger (468.5.d / 471.1); the
 *   `conquer` timing point is emitted by the scoring flow (turn/flow.ts
 *   scheduleScore('conquer') with details.battlefieldId). The merged event
 *   contract now has the battlefield-relative `here` anchor: EventPattern
 *   accepts it (events/trigger-spec.ts:203-216), programs/filters.ts preserves
 *   it (256-259), and events/pipeline-match.ts compares the event battlefield
 *   identity with the live source location (89-94).
 * - "you may ready a friendly gear" is one optional decision (403.1 / contract
 *   3.9): the chosen gear is a target (355.7 / 355.9.a.1) and per 355.12 it is
 *   locked together with the may-action, so the TargetSpec sits on the
 *   choice.optional node. effect.ready performs the real readied state change
 *   (416.1) and links { count, objects } under its link key.
 * - "If it's an Equipment" is a tag test on the gear selected by the may
 *   action. An already-ready gear changes nothing (416.1.c), while the locked
 *   target remains the antecedent of "it". The merged Condition vocabulary can
 *   express the test at Resolve time with the contract 3.6 expression
 *   `{ kind: "compare", left: "Equipment", operator: "in", right: { kind:
 *   "object-property", object: { target: "veiled-temple.gear" }, property:
 *   "tags" } }` — the same shape the layer-anchored conditions already use. The
 *   golden executes both branches through the real interpreter.
 * - "you may detach it" is a non-target pick (436.3) over that same selected
 *   gear and submits the merged detach action (436.1). A data-only
 *   condition.value captures the locked target's `ref` before readying. This
 *   keeps "it" stable even when the selected gear was already ready and
 *   416.1.c therefore yields an empty `readied` receipt.
 *
 * Status: judge-required. The `here` trigger and the individual in-body
 * primitives are executable, but production trigger registration still fails
 * closed on this two-decision ability. The leading may must be decided during Finalize
 * (383.3.a), while the later may is decided during Resolve (383.3.a.3).
 * programs/trigger-adapters/leading-choice.ts:78-81 rejects the nested
 * choice.optional, programs/triggers.ts:23-31 then reports "unsupported leading
 * may shape", and its adapted-target extraction at 38-45 would not lift the
 * TargetSpec printed on the outer choice. Even if the control node were merely
 * admitted, chain/finalize/choices.ts:207-217 asks every nested
 * choice.optional during Finalize, so it would wrongly ask "you may detach it"
 * at Finalize instead of Resolve. The card is not approximated by moving the
 * target, dropping either decision, or dropping the conditional detach clause.
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "conquer",
      // 468.5.d / 471.1 and 053.3: "here" means the battlefield this ability is
      // printed on. The production translator preserves this anchor and the
      // pipeline compares it with details.battlefieldId; never widen to every
      // conquer.
      filter: { event: "conquer", here: true, player: "controller" }
    },
    optional: true,
    body: [
      {
        id: "veiled-temple.ready-opt",
        op: "choice.optional",
        // 403.1 / 355.7 / 355.12: the may-action chooses its friendly gear when
        // the action is locked, so the target lives on the choice node.
        targets: [
          {
            id: "veiled-temple.gear",
            filter: { type: "gear", zone: "board", controller: "controller" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ],
        args: {
          prompt: { kind: "constant", value: "Ready a friendly gear?" },
          body: {
            kind: "constant",
            value: [
              {
                id: "veiled-temple.read-selected",
                op: "condition.value",
                // Preserve "it" as the gear locked with the may action. The
                // ready action's receipt contains only objects that actually
                // changed state and is empty for an already-ready gear.
                args: {
                  value: {
                    kind: "object-attribute",
                    object: { target: "veiled-temple.gear" },
                    attribute: "ref"
                  },
                  key: { kind: "constant", value: "selected" }
                }
              },
              {
                id: "veiled-temple.ready-gear",
                op: "effect.ready",
                args: {
                  objects: { kind: "constant", value: { kind: "target", id: "veiled-temple.gear" } },
                  amount: { kind: "constant", value: 1 }
                }
              },
              {
                id: "veiled-temple.detach-opt",
                op: "choice.optional",
                linkedTo: "veiled-temple.read-selected",
                // "If it's an Equipment": a real tag membership test on the gear
                // selected by the may action (contract 3.6 object anchor).
                condition: {
                  kind: "compare",
                  left: { kind: "constant", value: "Equipment" },
                  operator: "in",
                  right: {
                    kind: "object-property",
                    object: { target: "veiled-temple.gear" },
                    property: "tags"
                  }
                },
                args: {
                  prompt: { kind: "constant", value: "Detach that Equipment?" },
                  body: {
                    kind: "constant",
                    value: [
                      {
                        id: "veiled-temple.detach",
                        op: "effect.detach",
                        // 436.3: detaching a named card is a non-target pick.
                        args: { pick: { kind: "constant", value: "veiled-temple.detached-gear" } },
                        picks: [
                          {
                            id: "veiled-temple.detached-gear",
                            options: [
                              { kind: "linked-value", instructionId: "veiled-temple.read-selected", key: "selected" }
                            ],
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
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-9daf60cdf4c82e4fba1f685af1c9b0d748003f7e9ad9c68f02f429bdd0cf85e5",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「here」与触发体已接通：turn/flow.ts 的真实 conquer 波携带 details.battlefieldId，" +
    "events/trigger-spec.ts:203-216、programs/filters.ts:256-259 与 events/pipeline-match.ts:89-94 已能绑定并比较战场位置；" +
    "effect.ready（416.1）、Equipment 条件（355.7/355.12）与 effect.detach（436.1/436.3）原语单独执行可用，" +
    "detach 的 it 由 condition.value 在 Resolve 时从已锁定 TargetSpec 保存 ref，因此即使 gear 本来已 ready、" +
    "416.1.c 使 readied 回执为空，仍能与 Equipment 判定和 detach pick 指向同一对象。" +
    "整卡仍不能注册：程序首段是应当于 Finalize 决定的 may（383.3.a），但其 body 内还有应在 Resolve 决定的第二个 may（383.3.a.3）。" +
    "programs/trigger-adapters/leading-choice.ts:78-81 把嵌套 choice.optional 当作不可提升的控制体，程序绑定实测抛 " +
    "ProgramBindingError(judge-required)「unsupported leading may shape」（programs/triggers.ts:23-31）；" +
    "programs/triggers.ts:38-45 的 target 搬运也只读取被提升 body 内的 TargetSpec，不能保留挂在外层 may 上、须按 355.12 随该动作锁定的 friendly gear。" +
    "此外，chain/finalize/choices.ts:207-217 会把任何嵌套 choice.optional 在 Finalize 询问；若只放行控制体而不区分阶段，" +
    "「If it's an Equipment, you may detach it」会在错误时点被询问。" +
    "不移动、删除或近似任何一句，待引擎提供外层 Finalize may + 内层 Resolve may 的精确提升与外层 TargetSpec 搬运。",
  abilities,
  sourceText: "When you conquer here, you may ready a friendly gear. If it's an Equipment, you may detach it."
} satisfies CardProgram;

export default program;
