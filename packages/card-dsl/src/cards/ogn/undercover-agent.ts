import type { CardProgram } from "../../ir/index.js";

/**
 * Undercover Agent (ogn-178-298) — Unit, Chaos.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-178-298):
 *   [Deathknell] — Discard 2, then draw 2. (When I die, get the effect.)
 *
 * Modeling (CR v1.5):
 * - Deathknell is a triggered ability keyword (808.1, functionally "When I
 *   die, [Effect]") and is declared as a keyword ability. Its merged expansion
 *   subscribes to object-killed but carries an unregistered trigger.leave
 *   primitive, so the keyword cannot yet expand into an executable ability;
 *   the card stays judge-required.
 * - The [Effect] body is authored explicitly on the object-killed trigger
 *   (808.1.c equivalence, same pattern as the merged sfd Unsung Hero):
 *   effect.discard 2 followed by effect.draw 2. Per 423.4 a discard that is
 *   part of an effect discards as much as possible, and the later draw is a
 *   separate instruction that still resolves when the discard is negated
 *   (359.3.e.14.b); both primitives are merged and golden-executed below.
 */
export default {
  canonicalCardId: "card.hash-1838f6a22b76ababa713378ed2b4096f3e39f6b61a01bcf17bb8610b0ac08347",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Deathknell 关键词展开不可执行：keywords/Deathknell.ts 的触发体引用尚未注册的 trigger.leave 原语，" +
    "关键词注册表也还没有把 object-killed + last-known 的死亡触发接成可执行能力（808.1.d）。" +
    "卡牌效果本体「Discard 2, then draw 2」已用已合入的 effect.discard/effect.draw 写全并单独真实执行。" +
    "依赖：RIFT-82（kw-deathknell-legion）。",
  abilities: [
    { kind: "keyword", keyword: "deathknell" },
    {
      kind: "triggered",
      trigger: { at: "object-killed", filter: { self: true } },
      optional: false,
      body: [
        {
          id: "undercover-agent.discard-2",
          op: "effect.discard",
          args: { amount: { kind: "constant", value: 2 } }
        },
        {
          id: "undercover-agent.draw-2",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 2 } }
        }
      ]
    }
  ],
  sourceText: "[Deathknell] — Discard 2, then draw 2. (When I die, get the effect.)"
} satisfies CardProgram;
