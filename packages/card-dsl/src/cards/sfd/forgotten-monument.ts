import type { CardProgram } from "../../ir/index.js";

/**
 * Forgotten Monument (sfd-209-221) — Battlefield, SFD.
 *
 * "Players can't score here until their third turn."
 *
 * Rules anchors (Core Rules v1.5):
 * - Scoring is the act of a player seizing or maintaining control of a
 *   battlefield they have not yet scored this turn (470.1, 471.1/471.2);
 *   470.3 is why the card text uses "score" without naming "points".
 * - The printed window is a per-player, turn-count-based prohibition attached
 *   to one battlefield location: no player may score at this battlefield
 *   until that player's third turn (a static restriction, not a trigger and
 *   not a score replacement). It is not a "while you control" ability, so it
 *   is not conditioned on the battlefield's controller (contrast 190.6.d).
 * - The ability is a restriction on the Scoring process itself, which the
 *   scoring module owns (packages/engine-core/src/scoring/scoring.ts; the
 *   scoring authority never consults card data for such restrictions today).
 *
 * Status rationale (contract 3.1): judge-required, current gaps
 * (re-probed 2026-10-18):
 * 1. the continuous.restrict primitive, the merged self-appliesTo binding
 *    (programs/statics.ts staticTarget) and the rules/query restriction reader
 *    are executable, and the bound registration really reaches
 *    restrictions(registry, "score") for this battlefield's zone entry — but
 *    the scoring flow (scoring/scoring.ts) never consults the restriction
 *    registry, so nothing enforces it during Scoring (470.1/471);
 * 2. the printed window "until their third turn" is a per-player turn-count
 *    predicate: the IR has player-turn-count, but the scoring
 *    restriction query carries no window evaluation and continuous.restrict has
 *    no until/per-player-turn slot, so the window is not expressible yet.
 * Writing a trigger, a replacement, or a score-prevention instruction would
 * invent semantics, so the static restriction shape below is kept for review
 * only; the golden executes the merged primitive's registration, the production
 * static binder, and the restriction query as isolated evidence.
 */
export default {
  canonicalCardId: "card.hash-b6280b20779b152b78ff7c32ddd405d6d7c490bb00b2e8939b821030dffcab90",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口（2026-10-18 实测）：" +
    "（1）限制本身现在可登记：宿主 self 锚点（programs/statics.ts 的 staticTarget）由生产 static binder 绑成 " +
    "具体的 objectId+zoneEntryId（实测绑定成功、filter={objectId,zone,zoneEntryId}，" +
    "且 layers/rules/query.restrictions(registry,\"score\") 能查到该注册），" +
    "但 scoring 流程（scoring/scoring.ts）从不查询该注册表——计分时没有任何读取得分限制的调用方，" +
    "470.1/471 的禁止因此不生效；" +
    "（2）「until their third turn」是按玩家的回合序数窗口：IR 已有 player-turn-count 表达式，" +
    "但 continuous.restrict 没有 until/per-player-turn 槽位，限制查询（RuleRestrictionQuery）也不携带窗口，" +
    "窗口与限制的绑定无法表达。" +
    "不近似实现（不写触发、不写替代、不写禁止计分指令）。",
  sourceText: "Players can't score here until their third turn.",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.restrict",
        // 470.1/471：禁止的对象是 Scoring 这个动作本身，故用已合入的 actions 作用域
        // （layers/rules/query.restrictions 按 actions 过滤；只写 restriction 标签，
        // 或写成单数 action 键，都会让限制落到所有动作上）。
        actions: ["score"],
        restriction: "forgotten-monument",
        // 470.1/471：「here」指本卡所在的那个战场。能力宿主就是该 Battlefield
        // 对象，因此用已合入的 source-relative self 锚点（programs/statics.ts 的
        // staticTarget 把它绑成具体的 objectId+zoneEntryId），不写运行时引用。
        appliesTo: "self",
        // 「until their third turn」是按玩家的回合序数窗口；IR 有 player-turn-count
        // 表达式，但 continuous.restrict 没有承载该窗口的槽位，见 judgeReason。
        until: { perPlayerTurn: 3 }
      }
    }
  ]
} satisfies CardProgram;
