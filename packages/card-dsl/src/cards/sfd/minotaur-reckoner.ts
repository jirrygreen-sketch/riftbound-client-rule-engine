import type { CardProgram } from "../../ir/index.js";

/**
 * Minotaur Reckoner (sfd-014-221) — Unit.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, verbatim):
 *   "Units can't move to base."
 *
 * CR v1.5 anchors:
 * - 054/054.1: "Can't beats Can" — this is a global prohibition, never a
 *   permission (addsPermission stays false).
 * - 144.4.b: the Standard Move's Battlefield→Base route is removed for every
 *   unit; an effect move to a Base is likewise forbidden (451.1).
 *
 * Status: judge-required. The generic static CardProgram binder is merged and
 * records this ability, but its production registration preserves the
 * continuous.movement instruction's singular `restriction` field. The
 * movement() rule query consumes the normalized plural `restrictions` field,
 * while the binder does not perform that normalization; the standard movement
 * and effect-move consumers therefore cannot enforce this card through the
 * default lifecycle path yet. The layer snapshot path does fold the singular
 * field into ObjectSnapshot.movement.restrictions, so the IR and filtered
 * object shape remain covered below. This card stays pending the shared
 * engine normalization fix.
 */
export default {
  canonicalCardId: "card.hash-4707dc730254c2d3c4ed3484a961094d03925ec45f647f561ff4b106e7e22ebe",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "通用 CardProgram static binder 已合入并会注册本能力，但生产注册保留 continuous.movement 的单数 restriction 字段；" +
    "movement() 与标准移动消费的是规范化后的复数 restrictions，默认绑定没有做该归一化，" +
    "因此标准移动与 effect.move 仍不会执行「Units can't move to base」的禁止。层引擎快照会记录该限制，" +
    "但这不足以证明默认生命周期消费链已闭合。依赖共享引擎对 continuous.movement restriction/restrictions 的统一归一化；不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.movement",
        // 054.1: the prohibition only removes the option; it grants nothing.
        restriction: "move-to-base",
        addsPermission: false,
        // 053.2: the text names no host, so every unit on the board is covered.
        filter: { type: "unit", zone: "board" }
      }
    }
  ],
  sourceText: "Units can't move to base."
} satisfies CardProgram;
