import type { CardProgram } from "../../ir/index.js";

/**
 * Minefield (sfd-212-221) — Battlefield, Rumble champion precon (rumble-sfd).
 *
 * "When you conquer here, put the top 2 cards of your Main Deck into your trash."
 *
 * CR v1.5 anchors:
 * - 383.4.c / 383.4.c.1: "When you conquer…" is a Conquer Effect, a triggered
 *   ability; the `conquer` timing point (events/timing-points.ts, refs
 *   468.5.d / 471.1 / 473.2.a) is emitted by scoring/.
 * - "put the top N cards of your Main Deck into your trash" is the merged
 *   `effect.mill` primitive (deck-top → trash), which owns deck order and Burn
 *   Out handling through the authoritative kernel.
 *
 * Status rationale (contract §3.1, re-checked 2026-10-17): the mill body is
 * executable, but the whole card remains judge-required. The conquer timing
 * point is emitted by the scoring flow, yet the printed "here" restriction still
 * has no battlefield-relative EventPattern spelling:
 * - programs/filters.ts `translateObjectFilter`/`translateTriggerFilter` reject the
 *   `here` key (ProgramBindingError: Unsupported filter field here), so binding the
 *   printed filter throws before any registration.
 * - turn/flow.ts publishes the Score wave as `{ timingPoint: score.method, player,
 *   details: { battlefieldId } }` — there is no battlefield object, and
 *   trigger-spec/`translateTriggerFilter` copy `details` verbatim, so a
 *   self-referential battlefield anchor cannot be formed from the host's identity.
 * The structure below records the exact trigger and uses effect.mill for the
 * supported sub-effect.
 */
export default {
  canonicalCardId: "card.hash-0c36f22df8ffa7bed49f59fd138d24b9b0a52a7b8ad4c720afcaa12ec816eee4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "实测 2026-10-17（HEAD 9be41b14）：effect.mill 原语与卡牌程序绑定都已合入，整卡仍不可执行，缺的是 " +
    "「conquer here」的战场相对锚点：programs/filters.ts 的 translateTriggerFilter 拒绝 printed here " +
    "键（ProgramBindingError: Unsupported filter field here），而 turn/flow.ts 的 conquer 发射只发布 " +
    "player/details（{ battlefieldId }）、没有 battlefield 对象，translateTriggerFilter 又原样复制 " +
    "details，因此无法从本卡身份构成“本战场”比较（CR 468.5.d / 471.1 / 473.2.a）。" +
    "触发过滤器的控制者锚点已按闭合词表写成 player: self（validateTriggerSpec 现在只剩 here 一处 " +
    "unknown-field，不再是 invalid-player-selector；programs/filters.ts 的 normalizePlayer 同样归一为 self）。" +
    "已支持的 mill 本体经真实解释器执行（黄金测试断言 top 2 进 trash 与牌序）。依赖：Battlefield-relative " +
    "conquer 锚点（here 键或等价载荷绑定）；不近似实现（不订阅任意 conquer）。",
  sourceText: "When you conquer here, put the top 2 cards of your Main Deck into your trash.",
  abilities: [
    {
      kind: "triggered",
      // 470/471: "you" 是能力控制者。闭合词表的拼写是 player: "self"
      // （events/trigger-spec.ts 的 PlayerSelector），programs/filters.ts 的
      // normalizePlayer 同样把 self 归一为该能力控制者；"controller" 只是
      // 旧的非契约别名，会被 validateTriggerSpec 拒绝（invalid-player-selector）。
      trigger: { at: "conquer", filter: { event: "conquered", here: true, player: "self" } },
      optional: false,
      body: [
        {
          id: "minefield.mill",
          op: "effect.mill",
          args: {
            // The controller is implicit under 190.6.d; effect.mill owns
            // deck-top order and Burn Out (441.4 / 432.x).
            amount: { kind: "constant", value: 2 }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;
