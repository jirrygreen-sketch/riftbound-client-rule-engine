import type { CardProgram } from "../../ir/index.js";

/**
 * Scrapheap (ogn-182-298) — Gear, 2 Energy, Chaos.
 *
 * "When this is played, discarded, or killed, draw 1."
 *
 * CR v1.5 anchors:
 * - 383.4.a.2: "When this is played" is a Play Effect; it is placed on the
 *   Chain after the Gear is finalized and enters the board. The card-played
 *   timing point carries that event, filtered to this card (source "self").
 * - 423.1.b: "when I am discarded" triggered abilities are executed after the
 *   discard has occurred; the card-discarded timing point carries it.
 * - 429.1 / 383.4.c: being killed corresponds to the object-killed timing
 *   point; the dying Gear's ability is collected with its last-known
 *   information before the zone change (383.2.c.3 / 383.2.c.3.b).
 * - 414: "Draw 1" is effect.draw (414.1 default Main Deck top, 414.3
 *   formatting)."
 *
 * All three triggers are independent abilities: each one subscribes to its own
 * timing point and owns its own draw instruction, so a single physical event
 * cannot double-fire, and there is no linking between them.
 *
 * Status rationale: two trigger-matching gaps block full executability.
 * - "When this is discarded" is executed after the discard has occurred
 *   (423.1.b), so per 385 its zone context is the zone the card is in after
 *   the zone change (Trash) and it must self-describe that context.
 *   TriggerSpec/CardProgram expose no active-zone field and
 *   TriggerRegistration.activeZones is supplied only by the still-missing
 *   card-program adapter (the kernel defaults to ['board']), so this trigger
 *   would be registered in Board and never fire from Trash.
 * - The merged matcher (events/pipeline-match.ts) reads only the top-level
 *   event-pattern keys object/source/target/player; the nested
 *   filter: { role: 'self' } spelling used below is rejected by
 *   assertTriggerSpec (unknown-field) and ignored by the matcher, so all three
 *   triggers would match every qualifying event instead of this card's own
 *   incarnation. The binding adapter is the RIFT-257 card-program binding
 *   (RIFT-21 payload-filter follow-up).
 * The IR below keeps all three triggers plus their draw-1 bodies; both gaps are
 * judged, and partial primitive execution is not full-card evidence.
 */
const scrapheap = {
  canonicalCardId: "card.hash-d67f99047d4623fcb8c8cd0527b63550d8061a4b4f71c53edcf8fa25e239b8ee",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处触发匹配缺口：(1)「When this is discarded」按 CR 423.1.b 在弃置发生后执行，依 385 其区域上下文是换区后的区域（Trash）并需自述该上下文，" +
    "但契约 3.1 的 TriggerSpec/CardProgram 没有 active-zone 字段，TriggerRegistration.activeZones（pipeline-types.ts）默认 ['board'] " +
    "且只能由尚未合入的 card-program → TriggerRegistration 适配器提供（RIFT-257 绑定），合入内核会把它注册在 Board，弃置时永远不会触发；" +
    "(2) 三个触发沿用嵌套写法 filter: { role: 'self' }：已合入的触发匹配器（events/pipeline-match.ts）只读 event-pattern 的顶层 " +
    "object/source/target/player，assertTriggerSpec 也以 unknown-field 拒绝该键，匹配器会忽略它，三个触发都会匹配任意同类事件而非本牌自身" +
    "（RIFT-21 payload 过滤接线）。" +
    "played（board）与 killed（383.2.c.3.b last-known）两个触发以及 effect.draw 均已可执行并单独测试；整卡不可执行，不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          id: "scrapheap.draw-on-play",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    },
    {
      kind: "triggered",
      trigger: {
        at: "card-discarded",
        filter: { event: "card-discarded", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          id: "scrapheap.draw-on-discard",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    },
    {
      kind: "triggered",
      trigger: {
        at: "object-killed",
        filter: { event: "object-killed", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          id: "scrapheap.draw-on-kill",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText: "When this is played, discarded, or killed, draw 1."
} satisfies CardProgram;

export default scrapheap;
