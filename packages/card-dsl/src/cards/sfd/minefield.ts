import type { CardProgram } from "../../ir/index.js";

/**
 * Minefield (sfd-212-221) — Battlefield, Rumble champion precon (rumble-sfd).
 *
 * "When you conquer here, put the top 2 cards of your Main Deck into your trash."
 *
 * Default setup now puts the selected Battlefield on the Board, lifecycle
 * attachment binds that exact pre-existing object, combat establishes the
 * current controller on the Battlefield ObjectSnapshot, and a multi-Unit Score
 * wave is collected once under its shared batch identity. The trigger therefore
 * uses once: "per-batch": CR 472 permits Scoring a Battlefield only once per
 * player per turn, and CR 473.2.c limits this Score ability to that occurrence.
 * This is narrower than unconditional once: "per-turn" collection, which would
 * create multiple Pending items when several Units participate in one conquer.
 *
 * The whole card remains judge-required for one production-path gap:
 * apps/game-server/src/engine-runtime/host.ts:745-749 (and the reference host at
 * effects/testing/test-kernel.ts:558) implement mill by moving only the cards
 * presently in the Main Deck. effect.mill at
 * effects/instructions/effect.mill.ts:358-371 delegates to that action, while
 * turn/burn-out.ts:38-74 exposes one Burn Out step without a mill continuation.
 * With fewer than two cards in the Main Deck, the instruction therefore stops
 * after the remaining cards instead of performing CR 441.4 and 432.1.b: recycle
 * and randomize Trash, give an opponent 1 point, then burn the shortfall.
 *
 * Full-deck and multi-Unit conquest still execute through the real default
 * lifecycle, TurnFlow, ChainEngine, Finalize, and Resolve path; those positive
 * portions are covered by production goldens. The shortfall above is a semantic
 * Burn Out gap, so this program must not claim complete executable coverage.
 */
export default {
  canonicalCardId: "card.hash-0c36f22df8ffa7bed49f59fd138d24b9b0a52a7b8ad4c720afcaa12ec816eee4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "整卡仍保持 judge-required（2026-10-22，当前 integration）：apps/game-server/src/engine-runtime/host.ts:745-749 " +
    "的 mill 只移动当前存在的牌；effect.mill 在 effects/instructions/effect.mill.ts:358-371 仅委派该动作，" +
    "turn/burn-out.ts:38-74 的 Burn Out 步骤也未接入 mill continuation。Main Deck 不足 2 张时现路径只烧剩余牌，" +
    "不会按 CR 441.4、432.1.b、432.2.a-d 回收并随机化 trash、令对手得 1 分后继续烧差额；" +
    "不能把“放顶部 2 张”静默降级成“至多 2 张”。",
  sourceText: "When you conquer here, put the top 2 cards of your Main Deck into your trash.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: { event: "conquered", here: true, player: "self" },
        once: "per-batch"
      },
      optional: false,
      body: [
        {
          id: "minefield.mill",
          op: "effect.mill",
          args: {
            // The Battlefield controller is the implicit "you" under
            // CR 190.6.a/d. The amount is two, not an "up to" amount; any
            // shortfall must continue through the engine's Burn Out rule.
            amount: { kind: "constant", value: 2 }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;
