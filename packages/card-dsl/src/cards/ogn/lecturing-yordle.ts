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
 * - Tank (815): the KeywordDef is merged (RIFT-264, effects/keywords/Tank.ts
 *   expands to a static continuous.combat damage-assignment requirement), but
 *   `continuous.combat` still has no combat consumer: the merged combat
 *   allocation binds no assignment-priority requirement
 *   (combat/base-combat-allocation.ts: "No Tank/Backline/other
 *   assignment-priority requirement is bound here") and the layers consumer
 *   only persists the kind (layers/ops/index.ts). 815.1.b / 815.1.c.2
 *   ("I must be assigned lethal damage before any other unit with the same
 *   controller") therefore cannot be executed. Not approximated.
 * - "When you play me, draw 1" subscribes to the card-played timing point
 *   (383.4.a) and its body is a single merged effect.draw primitive (414.3);
 *   the golden test executes it on the reference kernel. Registering the
 *   trigger from the CardProgram (program binding) is still RIFT-257 work.
 */
export default {
  canonicalCardId: "card.hash-d5bee8c48f53404d08ff88d8472305114b39bc2f137cfb3e59c46e99340d0119",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Tank]（815）的 KeywordDef 已合入（RIFT-264，effects/keywords/Tank.ts 展开为 static continuous.combat 的致命分配要求），" +
    "但 continuous.combat 仍没有 combat 消费方：combat/base-combat-allocation.ts 明确不绑定 assignment-priority，" +
    "layers/ops/index.ts 也只为该 kind 提供注册/持久化，815.1.b / 815.1.c.2 的「先被分配致命伤害」不可执行。" +
    "「When you play me, draw 1」的 effect.draw 已合入并有真实执行证据；触发的能力注册（card-played 的自引用过滤词汇与程序绑定）依赖 RIFT-257。" +
    "依赖：combat 分配消费方（continuous.combat）与 RIFT-257。不近似实现。",
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
