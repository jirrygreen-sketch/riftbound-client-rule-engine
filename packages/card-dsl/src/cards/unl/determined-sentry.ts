import type { CardProgram } from "../../ir/index.js";

/**
 * Determined Sentry (unl-111-219) — Unit, Body, Yordle/Bandle City;
 * energy 1, Might 1.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-111-219, verbatim):
 *   I can't move to base.
 *
 * Rules evidence (Core Rules v1.5):
 * - 054 / 054.1: "Can't beats Can" — this is a prohibition on the host, not a
 *   permission; it removes the Battlefield→Base option of 144.4.b for this unit
 *   and also forbids an effect Move to its Base (451.1: the source of the Move
 *   supplies destination restrictions).
 * - 421.1 / 448 / 449: a Move between two Board locations; 144.4.b is the
 *   Standard Move option it removes. 053.1: "I" is the ability host.
 * - Contract 3.4 / layers: a passive prohibition is a continuous effect in the
 *   ability layer; the merged LayerEngine records `continuous.movement`
 *   restriction strings on the filtered object's MovementPermissions.
 *
 * Status: judge-required:
 * - the merged static-program binder can register this CardProgram ability as a
 *   ContinuousEffectSpec, and the layer query reports the restriction;
 * - movement execution still does not consume MovementPermissions: the rules
 *   query layer is not wired into Standard Move validation or effect.move, so a
 *   recorded restriction cannot negate the move.
 * The ability stays a passive movement restriction; it is not rewritten into a
 * fake negated placeholder instruction.
 */
export default {
  canonicalCardId: "card.hash-1fdab35e21db7372013c7ccc1c69b1ebf752b66cdac3f9cef733a8a4619b112b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「I can't move to base」是 054/054.1 的禁止型移动限制：它移除 144.4.b 的本单位战场→基地选项，" +
    "并同样禁止效果移动把本单位送往基地（451.1）。静态程序 binder 已能把 CardProgram 的 " +
    "continuous.movement 注册为 ContinuousEffectSpec，layers/LayerEngine 与 movement() 查询也能报告该限制；" +
    "但 Standard Move 校验和 effect.move 仍不读取 MovementPermissions，登记后的 restriction 尚不能否定移动。" +
    "依赖：zones/movement 与 move-location 对 MovementPermissions 的生产消费接线。不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.movement",
        // 054.1：禁止只移除选项、不授予任何许可。
        restriction: "move-to-base",
        addsPermission: false,
        filter: { object: "self" }
      }
    }
  ],
  sourceText: "I can't move to base."
} satisfies CardProgram;
