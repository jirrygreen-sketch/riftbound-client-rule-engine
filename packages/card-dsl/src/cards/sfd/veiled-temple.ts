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
 *   accepts it (events/trigger-spec.ts:207-216), programs/filters.ts preserves
 *   it (201-281), and events/pipeline-match.ts compares the event battlefield
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
 *   gear and submits the merged detach action (436.1). The merged ready
 *   primitive yields only objects that actually changed state; when the
 *   selected gear was already ready, 416.1.c yields an empty receipt. PickSpec
 *   cannot yet consume the locked TargetSpec directly, so the current IR keeps
 *   the executable receipt neighborhood without claiming that boundary.
 *
 * Status: judge-required. The `here` trigger and the individual in-body
 * primitives are executable, but production trigger registration still fails
 * closed on this two-decision ability. The leading may must be decided during Finalize
 * (383.3.a), while the later may is decided during Resolve (383.3.a.3).
 * programs/trigger-adapters/leading-choice.ts:123-136 rejects the nested
 * choice.optional, programs/triggers.ts:22-31 then reports "unsupported leading
 * may shape", and its adapted-target extraction at 129-133 only scans targets
 * on nested instructions, not the TargetSpec printed on the outer choice. Even
 * if the control node were merely admitted, chain/finalize/choices.ts:207-218 asks every nested
 * choice.optional during Finalize, so it would wrongly ask "you may detach it"
 * at Finalize instead of Resolve. Even after separating the timings, the detach
 * pick cannot consume the locked TargetSpec: target/picks/plan.ts:220-236
 * accepts linked receipts, queries, and static options, not a symbolic target
 * source. The card is not approximated by moving either decision or dropping
 * the conditional detach clause.
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
                linkedTo: "veiled-temple.ready-gear",
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
                              { kind: "linked-value", instructionId: "veiled-temple.ready-gear", key: "readied" }
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
    "整卡仍不能注册（2026-10-22 生产复核）。「here」与触发体已接通：turn/flow.ts 的真实 conquer 波携带 details.battlefieldId，" +
    "events/trigger-spec.ts:207-216、programs/filters.ts:201-281 与 events/pipeline-match.ts:89-94 已能绑定并比较战场位置；" +
    "effect.ready（416.1）、Equipment 条件（355.7/355.12）与 effect.detach（436.1/436.3）原语单独执行可用，" +
    "a friendly gear 不必横置；gear 本来已 ready 时，416.1.c 使 ready 的 readied 回执为空，" +
    "但原文的 it 仍是已锁定的 gear，不能退化成「没有 detach 选项」。" +
    "target/picks/plan.ts:220-236 只接 linked receipt、query 与 static options，没有 symbolic target source，" +
    "因此现有 IR 只能在没有发生 ready 状态变化时 fail-closed。" +
    "整卡仍不能注册：程序首段是应当于 Finalize 决定的 may（383.3.a），但其 body 内还有应在 Resolve 决定的第二个 may（383.3.a.3）。" +
    "programs/trigger-adapters/leading-choice.ts:123-136 把嵌套 choice.optional 当作不可提升的控制体，程序绑定实测抛 " +
    "ProgramBindingError(judge-required)「unsupported leading may shape」（programs/triggers.ts:22-31）；" +
    "且 leading-choice.ts:129-133 只搬运被提升 body 指令上的 TargetSpec，不能保留挂在外层 may 上、须按 355.12 随该动作锁定的 friendly gear。" +
    "此外，chain/finalize/choices.ts:207-218 会把任何嵌套 choice.optional 在 Finalize 询问；若只放行控制体而不区分阶段，" +
    "「If it's an Equipment, you may detach it」会在错误时点被询问。" +
    "不移动、删除或近似任何一句，待引擎提供外层 Finalize may + 内层 Resolve may 的精确提升、外层 TargetSpec 搬运与 target-backed pick。",
  abilities,
  sourceText: "When you conquer here, you may ready a friendly gear. If it's an Equipment, you may detach it."
} satisfies CardProgram;

export default program;
