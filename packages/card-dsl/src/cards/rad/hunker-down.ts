import type { CardProgram } from "../../ir/index.js";

/**
 * Hunker Down (rad-034-167) — Spell, 1 Energy, no Power, Calm.
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Ready a friendly unit. It can't move this turn. Draw 1.
 *
 * Rules evidence (Core Rules v1.5):
 * - 813 [Reaction] is a Permissive keyword (merged keywords/Reaction.ts); the
 *   card only declares it. 159.2.b covers the spell's own timing.
 * - "Ready a friendly unit": effect.ready takes a TargetSpec (the merged
 *   primitive documents "Ready a friendly unit/gear/legend" as a target,
 *   355.10.a); "you control" is filter controller = the ability's controller.
 * - "Draw 1.": effect.draw. It is a separate sentence, so it is NOT linked to
 *   the ready instruction: a replaced or negated ready must still draw
 *   (359.3.e.14.b, and 359.3.e.8 for partial target loss).
 * - "It can't move this turn" is a duration-bounded movement restriction on
 *   the readied unit. Layers has the merged
 *   `continuous.movement`/`continuous.restrict` consumer shape
 *   (layers/engine.ts reads effect.movement / permission, canMove, restriction),
 *   but there is NO registered instruction op that registers such a continuous
 *   effect: contract 3.6's closed GameAction set has no movement-restriction
 *   action and ctx.addContinuous has no merged card-facing primitive. The
 *   ability-templates survey lists this as `continuous.movement` /
 *   `continuous.restrict` (RIFT-91 scope).

 * Status: judge-required — the restriction half has no executable path, so the
 * card cannot be called executable. Ready + Draw 1 are executed for real in the
 * golden test.
 */
const hunkerDown = {
  canonicalCardId: "card.hash-2664ce34bf1adce071ce02ab9d89d11c45b42381e2728fbb02be19a2d83e1575",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「It can't move this turn」的落地：契约 3.6 的封闭 GameAction 集合没有移动限制动作，" +
    "也没有已注册原语通过 ctx.addContinuous 注册带 end-of-turn 期限的 continuous.movement / " +
    "continuous.restrict 持续效果（layers/ 已能消费该形状，但卡牌侧无原语入口）。" +
    "依赖：RIFT-91（layers-continuous 持续效果层）与 RIFT-90（目标/费用适配）。" +
    "Ready a friendly unit（effect.ready）与 Draw 1（effect.draw）已合入并有真实执行证据；" +
    "不近似实现移动限制。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          id: "hunker-down.ready-unit",
          op: "effect.ready",
          args: {
            objects: { kind: "constant", value: { kind: "target", id: "hunker-down.unit" } },
            amount: { kind: "constant", value: 1 },
            linkKey: { kind: "constant", value: "readied" }
          },
          targets: [
            {
              id: "hunker-down.unit",
              filter: { type: "unit", zone: "board", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "It can't move this turn" — recorded with the contract 3.7 / RIFT-9
          // continuous shape; no merged primitive consumes it yet (judgeReason).
          id: "hunker-down.cant-move",
          op: "continuous.movement",
          args: {
            movement: {
              kind: "constant",
              value: { canMove: false, restriction: "hunker-down-cant-move" }
            },
            duration: { kind: "constant", value: "end-of-turn" }
          },
          picks: [
            {
              id: "hunker-down.readied-unit",
              options: [{ kind: "linked-value", instructionId: "hunker-down.ready-unit", key: "readied" }],
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
          linkedTo: "hunker-down.ready-unit"
        },
        {
          // "Draw 1." — a separate sentence; not linked to the ready, so a
          // mistargeted ready does not stop the draw (359.3.e.14.b).
          id: "hunker-down.draw",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Ready a friendly unit. It can't move this turn. Draw 1."
} satisfies CardProgram;

export default hunkerDown;
