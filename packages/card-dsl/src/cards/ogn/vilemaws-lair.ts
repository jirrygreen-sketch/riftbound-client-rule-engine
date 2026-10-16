import type { CardProgram } from "../../ir/index.js";

/**
 * Vilemaw's Lair (ogn-295-298) — Battlefield, Colorless.
 *
 * sourceText: Units can't move from here to base.
 *
 * CR v1.5 anchors:
 * - 054 / 054.1: "Can't beats Can" — this is a prohibition that beats the Move
 *   permissions granted by cards (the rules use exactly this Battlefield as the
 *   example: 358.3.a, 359.3.e.14.b — Ride the Wind is legal to play, but the
 *   move instruction is negated on resolution while the ready instruction still
 *   executes).
 * - 421.1 / 449: a move between two Board locations; 144.4.b defines the
 *   Battlefield→Base Standard Move this restriction removes.
 * - 053.3: "here" is this Battlefield.
 *
 * Status: judge-required. The ability is a passive movement restriction with no
 * chain interaction; the merged layers engine does record it (LayerEngine's
 * applyAbility stores effect.restriction into the object's movement.restrictions,
 * which the golden test exercises with an equivalent registration) but nothing
 * consumes it:
 * - zones/movement.ts validates Standard Moves from its own explicit
 *   DuelStandardMoveTiming/DuelBoard inputs and never reads the layers
 *   MovementPermissions, so a registered restriction cannot negate the move;
 * - effect.move documents that path restrictions and the corrective Recall are
 *   move-location's concern, and move-location has no hook for continuous
 *   movement restrictions either;
 * - layers/filter.ts implements no sameLocationAs anchor, so "here" would attach
 *   the restriction to units at every Battlefield once a producer exists;
 * - no merged producer turns a CardProgram's static ability into a
 *   ContinuousEffectSpec registration at all.
 * The 358.3.a/359.3.e.14.b expectation (the move is negated at resolution while
 * later instructions still execute) therefore still has to be produced by the
 * missing restriction consumer; it is recorded as a test.todo, not approximated.
 */
export default {
  canonicalCardId: "card.hash-3e2d969f2528a782a98c698fc45d9937d376dd06244c444271adf9cbd4100e77",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Units can't move from here to base.」是 054/054.1 的禁止型移动限制（358.3.a、359.3.e.14.b 正好以本战场为例）：该限制要覆盖 144.4.b 的" +
    "Battlefield→Base Standard Move 与效果移动。已合入的 layers/LayerEngine 能记录该限制（把 effect.restriction 写进 ObjectSnapshot.movement.restrictions），" +
    "但没有任何消费方：① zones/movement.ts 只按自己的 DuelStandardMoveTiming / DuelBoard 输入校验 Standard Move，从不读图层 MovementPermissions，注册后也无法否定移动；" +
    "② effect.move 文档明确路径限制与矫正 Recall 归 move-location，而 move-location 也没有读持续移动限制的接口；③ layers/filter.ts 不实现 sameLocationAs 锚点，" +
    "「here」会落到任意战场的单位上；④ 没有已合入的路径把 CardProgram 的 static 能力注册成 ContinuousEffectSpec。依赖：RIFT-75（batch1-zones）、RIFT-91（layers-continuous）" +
    "之后的移动限制消费任务。不近似实现（不把限制改写成一个假的 negated 占位指令）。",
  sourceText: "Units can't move from here to base.",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.movement",
        restriction: "move-from-here-to-base",
        // 054.1: a prohibition; it removes the 144.4.b option and never grants
        // one. The merged layers loader records the restriction string on the
        // filtered objects' movement permissions (see judgeReason for the
        // missing consumer).
        addsPermission: false,
        filter: {
          type: "unit",
          zone: "board",
          sameLocationAs: "self"
        }
      }
    }
  ]
} satisfies CardProgram;
