import type { CardProgram } from "../../ir/index.js";

/**
 * Lecturing Yordle (ogn-087-298) — Unit, 3 energy, 2 Might, Mind,
 * Yordle / Bandle City.
 *
 * Printed text:
 *   [Tank] (I must be assigned combat damage first.)
 *   When you play me, draw 1.
 *
 * Status: judge-required.
 * - Tank (815) has no merged KeywordDef (effects/keywords/ contains no
 *   Tank.ts), and the merged combat allocation binds no assignment-priority
 *   requirement (combat/base-combat-allocation.ts: "No Tank/Backline/other
 *   assignment-priority requirement is bound here"), so 815.1.b /
 *   815.1.c.2 ("I must be assigned lethal damage before any other unit with
 *   the same controller") cannot be executed. Not approximated.
 * - "When you play me, draw 1" subscribes to the card-played timing point
 *   (383.4.a) and its body is a single merged effect.draw primitive (414.3);
 *   the golden test executes it on the reference kernel.
 */
export default {
  canonicalCardId: "card.hash-d5bee8c48f53404d08ff88d8472305114b39bc2f137cfb3e59c46e99340d0119",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Tank]（815）没有已合入的 KeywordDef（effects/keywords/ 无 Tank.ts），战斗伤害分配也未绑定 Tank/Backline 的分配优先要求" +
    "（combat/base-combat-allocation.ts 明确不绑定 assignment-priority），815.1.b / 815.1.c.2 不可执行。" +
    "依赖：关键词注册表（Tank KeywordDef）与 combat 分配批次。" +
    "card-played 的 Draw 1 半只使用已合入的 effect.draw。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "tank" },
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          id: "lecturing-yordle.draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText: "[Tank] (I must be assigned combat damage first.)\nWhen you play me, draw 1."
} satisfies CardProgram;
