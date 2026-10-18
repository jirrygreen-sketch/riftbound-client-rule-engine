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
 *   scheduleScore('conquer') -> emissions.push({ timingPoint: 'conquer' }) with
 *   details.battlefieldId). The battlefield-relative "here" is the missing piece
 *   (see judgeReason): the frozen EventPattern has no here anchor and
 *   programs/filters.ts rejects `here` fail-closed.
 * - "you may ready a friendly gear" is one optional decision (403.1 / contract
 *   3.9): the chosen gear is a target (355.7 / 355.9.a.1) and per 355.12 it is
 *   locked together with the may-action, so the TargetSpec sits on the
 *   choice.optional node. effect.ready performs the real readied state change
 *   (416.1) and links { count, objects } under its link key.
 * - "If it's an Equipment" is a tag test on the gear that was just readied.
 *   The merged Condition vocabulary can express it at Resolve time with the
 *   contract 3.6 object-anchored expression
 *   `{ kind: "compare", left: "Equipment", operator: "in", right: { kind:
 *   "object-property", object: { target: "veiled-temple.gear" }, property:
 *   "tags" } }` — the same shape the layer-anchored conditions already use. The
 *   golden executes both branches through the real interpreter.
 * - "you may detach it" is a non-target pick (436.3) over the just-readied gear
 *   (`{ kind: "linked-value", instructionId: "veiled-temple.ready-gear", key:
 *   "readied" }`) and submits the merged detach action (436.1).
 *
 * Status: judge-required. Every in-body step executes, but the trigger itself
 * cannot be bound: `programs/filters.ts translateObjectFilter` rejects the `here`
 * key with ProgramBindingError(judge-required) and no merged consumer resolves
 * "here" to the triggering battlefield (nothing in chain/ or events/ maps
 * event.details.battlefieldId to a location filter). Emitting the conquer timing
 * exists; the battlefield-relative anchor does not. Nothing is approximated: the
 * detach branch is gated by the real Equipment tag test instead of dropping the
 * clause, and the trigger keeps the printed condition for the future binding.
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "conquer",
      // 468.5.d / 471.1: "here" means the battlefield this ability is printed
      // on; kept as the printed anchor because the filter translator rejects
      // `here` (see judgeReason) instead of silently matching every conquer.
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
            filter: { type: "gear", controller: "controller" },
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
                // "If it's an Equipment": a real tag membership test on the
                // gear that was just readied (contract 3.6 object anchor).
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
    "触发绑定仍缺 battlefield-relative 的「here」：已合入的时点发射方（由 turn/flow.ts 的 scheduleScore('conquer') 发出 conquer 时点，载荷 details.battlefieldId）" +
    "与程序侧已合入的 conquer 消费路径之间没有把载荷解析成位置过滤的消费方——发射方虽提供 details.battlefieldId，EventPattern 没有 here 锚点，programs/filters.ts translateObjectFilter 对 `here` 直接 fail-closed" +
    "（ProgramBindingError judge-required），照原样绑定会报错、去掉则会把「here」近似成任意战场的征服。" +
    "触发体本身已可执行：「may ready a friendly gear」（403.1/355.7/355.12，目标随 may 动作锁定）走 effect.ready（416.1），" +
    "「If it's an Equipment」用已合入的 Condition 与契约 3.6 对象锚点求值（compare/in + object-property(target).tags），" +
    "「you may detach it」是非目标 pick（436.3）并经 effect.detach（436.1）提交；golden 用解释器 + 参考内核真实执行 Equipment 与 " +
    "非 Equipment 两条分支（非 Equipment 时 detach 分支被 negated/skipped，不会脱离）。" +
    "依赖：conquer 事件载荷 details.battlefieldId → 位置过滤的「here」锚点接线；" +
    "programs/filters.ts 当前对未解析字段 fail-closed。不近似实现。",
  abilities,
  sourceText: "When you conquer here, you may ready a friendly gear. If it's an Equipment, you may detach it."
} satisfies CardProgram;

export default program;
