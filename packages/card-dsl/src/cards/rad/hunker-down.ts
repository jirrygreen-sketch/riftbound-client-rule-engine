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
 * - "Ready a friendly unit": effect.ready takes the target form (the merged
 *   primitive documents "Ready a friendly unit/gear/legend" as a target,
 *   355.10.a); "you control" is filter controller = the ability's controller.
 * - "It can't move this turn" is a duration-bounded movement restriction on the
 *   readied unit. The merged `continuous.movement` primitive (RIFT-259)
 *   registers an ability-layer restriction through ctx.addContinuous
 *   (`restriction: "cannot-move"`, `addsPermission: false`, duration
 *   "this-turn" → end-of-turn), and the target is the same finalized object the
 *   ready instruction acted on, so the restriction is not re-chosen. A
 *   restriction-only shape is exactly what the primitive's
 *   `addsPermission: false` branch records (450.1 / 054 "can't" removes the
 *   option rather than granting one). The golden test registers the
 *   restriction and reads it back through layers/rules/query `movement()`.
 * - "Draw 1.": effect.draw. It is a separate sentence, so it is NOT linked to
 *   the ready instruction: a replaced or negated ready must still draw
 *   (359.3.e.14.b, and 359.3.e.8 for partial target loss).
 *
 * Status: judge-required — every instruction runs on merged primitives, but the
 * card cannot be called executable end to end: the movement system still does
 * not consume the recorded restriction. zones/movement.ts validates a Standard
 * Move from its own board/timing inputs and never reads the layer engine's
 * MovementPermissions, and effect.move documents that path restrictions belong
 * to move-location, which has no continuous-restriction hook either, so the
 * registered "cannot-move" label cannot yet negate a move. CardProgram static
 * ability binding is also still pending (RIFT-257). Dependencies: the movement
 * restriction consumer plus RIFT-257. Not approximated: the restriction is
 * declared through the real primitive and never faked as an allowed move.
 */
export default {
  canonicalCardId: "card.hash-2664ce34bf1adce071ce02ab9d89d11c45b42381e2728fbb02be19a2d83e1575",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三段正文都已有已合入原语并真实执行（effect.ready、continuous.movement 的 restriction 形状、effect.draw；golden 用链解释器适配器 + 图层查询断言就绪、cannot-move 限制与抽 1）。" +
    "整卡仍不可执行：「It can't move this turn」登记的移动禁止没有消费方——zones/movement.ts 只按自己的 Standard Move 输入校验、从不读图层的 MovementPermissions，" +
    "effect.move 也明确把路径限制归 move-location，而它同样没有读取持续限制的接口，所以 054/054.1 的禁止（含 451.1 的效果移动）目前无法否定移动。" +
    "另外卡牌 static/触发能力绑定仍待 RIFT-257。依赖：移动限制消费任务与 RIFT-257。不近似实现。",
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
          // "It can't move this turn" — the merged continuous.movement
          // restriction shape (054/054.1: a prohibition removes the option
          // instead of granting permission), aimed at the finalized unit.
          id: "hunker-down.cant-move",
          op: "continuous.movement",
          args: {
            restriction: { kind: "constant", value: "cannot-move" },
            addsPermission: { kind: "constant", value: false },
            duration: { kind: "constant", value: "this-turn" },
            target: { kind: "constant", value: "hunker-down.unit" }
          },
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
