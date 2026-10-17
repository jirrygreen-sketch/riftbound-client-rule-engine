import type { CardProgram } from "../../ir/index.js";

/** Minotaur Reckoner (sfd-014-221). */
export default {
  canonicalCardId: "card.hash-4707dc730254c2d3c4ed3484a961094d03925ec45f647f561ff4b106e7e22ebe",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『Units can't move to base』是 054/054.1 的全局移动禁止，限制 144.4.b 的 Battlefield→Base 标准移动及效果移动；" +
    "当前 layers 只能记录 MovementPermissions，zones/movement.ts 与 effect.move 没有消费限制的路径，也没有 CardProgram static→ContinuousEffectSpec 注册接线（RIFT-75/RIFT-91）。不以假的 negated 指令近似。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.movement",
        restriction: "move-to-base",
        addsPermission: false,
        filter: { type: "unit", zone: "board" }
      }
    }
  ],
  sourceText: "Units can't move to base."
} satisfies CardProgram;
