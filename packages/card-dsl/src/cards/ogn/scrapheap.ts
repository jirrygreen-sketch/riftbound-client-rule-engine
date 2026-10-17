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
 * Status rationale: one trigger-matching gap blocks full executability.
 * - "When this is discarded" is executed after the discard has occurred
 *   (423.1.b), so per 385 its zone context is the zone the card is in after
 *   the zone change (Trash). TriggerSpec/CardProgram expose no active-zone
 *   field and the merged triggerRegistrations adapter defaults a permanent
 *   card to ['board'], so this trigger cannot fire from Trash. The nested
 *   `filter: { role: 'self' }` spelling is already translated to the source
 *   incarnation.
 * The IR below keeps all three triggers plus their draw-1 bodies; the active
 * zone gap is judged, and partial primitive execution is not full-card evidence.
 */
const scrapheap = {
  canonicalCardId: "card.hash-d67f99047d4623fcb8c8cd0527b63550d8061a4b4f71c53edcf8fa25e239b8ee",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "一处触发匹配缺口：「When this is discarded」按 CR 423.1.b 在弃置发生后执行，依 385 其区域上下文是换区后的区域（Trash）并需自述该上下文，" +
    "但契约 3.1 的 TriggerSpec/CardProgram 没有 active-zone 字段，TriggerRegistration.activeZones（pipeline-types.ts）默认 ['board'] " +
    "且 triggerRegistrations 对永久卡默认 activeZones=['board']，而弃置后的本牌位于 Trash，契约没有 active-zone 覆盖字段，弃置触发永远不会命中；" +
    "嵌套 filter: { role: 'self' } 已由触发绑定适配为本牌 incarnation 过滤，不再是缺口。" +
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
