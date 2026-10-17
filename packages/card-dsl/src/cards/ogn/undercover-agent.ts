import type { CardProgram } from "../../ir/index.js";

/**
 * Undercover Agent (ogn-178-298) — Unit, Chaos.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-178-298):
 *   [Deathknell] — Discard 2, then draw 2. (When I die, get the effect.)
 *
 * Modeling (CR v1.5, re-reviewed 2026-10-17):
 * - Deathknell is a triggered ability keyword (808.1, functionally "When I
 *   die, [Effect]") and is declared as a keyword ability. Its KeywordDef
 *   (effects/keywords/Deathknell.ts) subscribes to object-killed but
 *   its expansion body still references the trigger.leave primitive, which has
 *   no registered implementation in this worktree, so the keyword cannot yet
 *   expand into an executable ability; the card stays judge-required. The
 *   ordinary CardProgram → TriggerRegistration path is present, but it does
 *   not supply Deathknell's card-specific effect payload binding.
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
    "Deathknell 关键词展开不可执行：keywords/Deathknell.ts 的触发体引用未注册的 trigger.leave 原语，" +
    "且关键词骨架没有把本卡的 [Effect] 正文作为 payload 绑定到该死亡触发（808.1.c/808.1.d）；" +
    "普通 CardProgram → TriggerRegistration 接线已存在，但不能替代 Deathknell 的正文挂接。" +
    "卡牌效果本体「Discard 2, then draw 2」已用已合入的 effect.discard/effect.draw 写全并真实执行（含弃牌不足的边界）。" +
    "依赖：trigger.leave 原语、Deathknell 正文 payload 绑定与死亡触发消费方。",
  abilities: [
    { kind: "keyword", keyword: "deathknell" },
    {
      kind: "triggered",
      // 引擎验证器接受的自身死亡拼写：object:{objectId:"self"}（对照
      // ogs/vanguard-attendant 的写法；旧的 { self: true } 会被拒绝）。
      trigger: { at: "object-killed", filter: { event: "object-killed", object: { objectId: "self" } } },
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
