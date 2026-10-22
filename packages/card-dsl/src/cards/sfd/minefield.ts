import type { CardProgram } from "../../ir/index.js";

/**
 * Minefield (sfd-212-221) — Battlefield, Rumble champion precon (rumble-sfd).
 *
 * "When you conquer here, put the top 2 cards of your Main Deck into your trash."
 *
 * The current production path closes the original local gaps: setup Battlefields
 * are bound by the lifecycle initial scan (programs/lifecycle.ts:515-518),
 * Battlefield control follows combat/flow.ts:190-205, and every conquer event in
 * one Score wave shares a per-batch frequency that EventPipeline deduplicates
 * while collecting Pending items (events/pipeline.ts:486-490). The IR therefore
 * uses once: "per-batch": CR 472 permits Scoring a Battlefield only once per
 * player per turn, and CR 473.2.c limits this Score ability to that occurrence.
 * This is narrower than unconditional once: "per-turn" collection, which would
 * create multiple Pending items when several Units participate in one conquer.
 *
 * The whole card remains judge-required because two production-path gaps remain:
 * - apps/game-server/src/room.ts:236-243 assembles programs only from Main Deck,
 *   Legend, and Champion cards. A selected Battlefield's canonical card program
 *   is absent, so the public room path never supplies Minefield to ProgramBinding.
 * - apps/game-server/src/engine-runtime/host.ts:745-748 (and the shared test host
 *   at effects/testing/test-kernel.ts:558) implement mill by moving only the
 *   available cards. effect.mill delegates to that action; turn/burn-out.ts:38-74
 *   exists but is not wired into a mill continuation. With one card in the Main
 *   Deck, the second instructed card therefore does not perform CR 432.1.b,
 *   432.2 (recycle trash, shuffle, opponent point), then complete the remainder.
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
    "整卡仍保持 judge-required（2026-10-22，当前 integration）。已闭合的旧缺口：RIFT-959 的 " +
    "programs/lifecycle.ts:515-518 会在 attachLifecycle 初始扫描中绑定 setup 时已在 Board 的 Battlefield；" +
    "RIFT-954 的 combat/flow.ts:190-205 通过真实 take-control 同步 Battlefield ObjectSnapshot.controller；" +
    "turn/flow.ts:174-192 给同一 Score wave 的所有 conquer/score 事件统一 batchId，events/pipeline.ts:486-490 " +
    "在 Pending 收集阶段按 per-batch 去重，因此本卡一旦由生产 registry 提供，多名单位同次征服只产生一个触发。" +
    "仍有两个当前生产缺口：(1) apps/game-server/src/room.ts:236-243 的公开房间 deckPrograms 只收集 " +
    "mainDeck、championLegend、chosenChampion，没有把双方选中的 Battlefield canonicalCardId 送入 " +
    "ProgramBinding，所以默认公开房间对局根本不会注册本战场能力；" +
    "(2) apps/game-server/src/engine-runtime/host.ts:745-748 的 mill 只移动当前存在的牌，shared reference host " +
    "effects/testing/test-kernel.ts:558 同构；effect.mill 在 effects/instructions/effect.mill.ts:348-371 只是委派并返回实际移动数，" +
    "而 turn/burn-out.ts:38-74 未接入 mill continuation。Main Deck 不足 2 张时，现路径只烧剩余牌，不会按 " +
    "CR 441.4、432.1.b、432.2.a-d 回收 trash、随机化、令对手得 1 分并继续烧差额。上述两句卡文只有在完整 2 张可燃时才正确，" +
    "不把缺口静默解释成“至多 2 张”。",
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
