import type { CardProgram } from "../../ir/index.js";

/**
 * Dazzling Aurora (ogn-160-298) — Gear, 9 Energy + 2 Body Power.
 *
 * "At the end of your turn, reveal cards from the top of your Main Deck until
 *  you reveal a unit. Play it, ignoring its cost, and recycle the rest."
 *
 * CR v1.5 anchors:
 * - "At the end of your turn" subscribes to the turn-end timing point
 *   (317.1.a); "your turn" is the ability controller's turn (190.6.d).
 * - 425.3 / 425.3.a: "Reveal cards from the top of your Main Deck until you
 *   reveal a unit" is an ordered reveal that stops at the first matching card.
 * - "Play it, ignoring its cost": 420.3 Play action with the 356.1.b.1 base
 *   cost rewrite to zero.
 * - "recycle the rest": 417 recycles the non-unit cards revealed before the
 *   unit; that set is defined by the reveal-until result.
 *
 * Measured current gaps (2026-10-17, each one reproduced by the golden below):
 * 1. Ordered reveal-until has no executor. The card's `effect.reveal-until` is
 *    not in the instruction registry (the interpreter throws "Unregistered
 *    instruction opcode: effect.reveal-until"), and the merged `effect.reveal`
 *    cannot stand in: a fixed count over the Main Deck throws "a subset of this
 *    zone requires upstream ordered picks", and there is no stop predicate for
 *    "until you reveal a unit" even after ordered picks exist.
 * 2. The trigger cannot be registered. programs/filters.ts
 *    translateTriggerFilter preserves the authored `event: "turn-end"`, and
 *    events/trigger-spec.ts assertTriggerSpec accepts only the closed
 *    EVENT_PATTERN_TYPES list, which holds object/state events and no phase
 *    timings. Attaching the lifecycle therefore raises
 *    TriggerSpecValidationError and registers zero triggers.
 * 3. "Play it, ignoring its cost" still needs a finalized plan derived from the
 *    revealed object's printed cost. effect.play returns negated(impossible)
 *    for a plan whose `finalized` flag is not true (verified by the golden),
 *    and the only merged producer (`cost.modify`) takes a static printed-cost
 *    projection that static IR cannot bind to a Resolve-time revealed identity.
 *
 * The structure below keeps the trigger and the intended body shape with the
 * missing ops named; nothing here pretends to resolve.
 */
const dazzlingAurora = {
  canonicalCardId: "card.hash-ec34157eb04ae011d9a79dacfd64f6303e1d79eb376db6975abef7998e893318",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处当前缺口（均已实测，不近似实现）：" +
    "（1）有序 reveal-until 没有执行者：本卡的 effect.reveal-until 不在指令注册表中（解释器抛 " +
    "Unregistered instruction opcode: effect.reveal-until），已合入的 effect.reveal 也不能替代——" +
    "对主牌库取固定张数会抛「a subset of this zone requires upstream ordered picks」，" +
    "且即使有了有序 picks 也没有「直到出现单位为止」的停止谓词（CR 425.3/425.3.a）。" +
    "（2）触发无法注册：programs/filters.ts 的 translateTriggerFilter 保留原文 filter 的 event:\"turn-end\"，" +
    "而 events/trigger-spec.ts 的 assertTriggerSpec 只接受封闭的事件名表 EVENT_PATTERN_TYPES（内含对象/状态事件，没有任何阶段时点），" +
    "实测 attachLifecycle 抛 TriggerSpecValidationError 且注册 0 个触发（CR 317.1.a）。" +
    "（3）「Play it, ignoring its cost」仍需把被揭示对象的印刷费用接入 finalized plan：" +
    "effect.play 对 finalized 不为 true 的计划返回 negated(impossible)（golden 已固定），" +
    "而已合入的 cost.modify 只接受静态 printed 投影，静态 IR 无法把它绑定到结算期才揭示的对象身份（CR 420.3、356.1.b.1）。" +
    "（4）「recycle the rest」依赖同一 reveal-until 结果集，因此同样不可执行。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "turn-end",
        filter: { event: "turn-end", player: "self" }
      },
      optional: false,
      body: [
        {
          id: "dazzling-aurora.reveal-until-unit",
          // Missing primitive: ordered reveal until the first matching object
          // (unregistered opcode; effect.reveal cannot take a Main Deck subset).
          op: "effect.reveal-until",
          args: {
            from: { kind: "constant", value: "deck-top" },
            until: { kind: "constant", value: { type: "unit" } },
            linkKey: { kind: "constant", value: "revealed" }
          }
        },
        {
          id: "dazzling-aurora.play-unit",
          // Missing support: derive a finalized zero-cost plan for the revealed object.
          op: "effect.play",
          linkedTo: "dazzling-aurora.reveal-until-unit",
          args: {
            object: {
              kind: "linked-value",
              instructionId: "dazzling-aurora.reveal-until-unit",
              key: "revealedUnit"
            },
            ignoreCost: { kind: "constant", value: "printed" }
          }
        },
        {
          id: "dazzling-aurora.recycle-rest",
          op: "effect.recycle",
          linkedTo: "dazzling-aurora.reveal-until-unit",
          args: {
            objects: {
              kind: "linked-value",
              instructionId: "dazzling-aurora.reveal-until-unit",
              key: "revealedRest"
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "At the end of your turn, reveal cards from the top of your Main Deck until you reveal a unit. Play it, ignoring its cost, and recycle the rest."
} satisfies CardProgram;

export default dazzlingAurora;
