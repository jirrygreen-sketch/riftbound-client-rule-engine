import type { CardProgram } from "../../ir/index.js";

/** Eager Drakehound (sfd-006-221). */
export default {
  canonicalCardId: "card.hash-1497e682bf282da7f38e77af1bfab763e1be0d7a44c62995f1af09d4ba6b6281",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『I enter ready』是 CR 369.3 的入场替代效果（单位默认横置进场，359.2.c/143.4）；当前缺少 CardProgram replacement 到 replacement.enter 事件管线的消费方（RIFT-120/引擎批 4/5）。effect.ready 只保留替代体声明，不能作为事后重置近似。",
  abilities: [
    {
      kind: "replacement",
      replaces: { event: "object-enters-board", filter: { source: "self", exhausted: true } },
      with: [
        {
          id: "eager-drakehound.enter-ready",
          op: "effect.ready",
          args: { objects: { kind: "constant", value: { kind: "source" } } }
        }
      ]
    }
  ],
  sourceText: "I enter ready."
} satisfies CardProgram;
