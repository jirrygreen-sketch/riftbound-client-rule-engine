import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Momentary Companion — CR v1.5 811, 383.4.a, 816.1.b/816.3.
 * Hidden payment planning, Temporary expansion and continuous.grant-keyword are
 * implemented. "Give me" is a source grant, not a target. Re-probed
 * 2026-10-17, three boundaries remain:
 * - No Condition/Expr node exposes the turn player vs the ability controller:
 *   ResolveContext (effects/contract.ts) has no turnPlayer, and TriggerSpec
 *   conditions are evaluated through PipelineHost.testTrigger without an event
 *   turn predicate; do not use a truthy descriptive string as a predicate.
 * - Hidden: effects/keywords/Hidden.ts expands to static { kind: "cost.hidden" },
 *   but programs/statics.ts layerFor() has no mapping for it (bindStatic throws
 *   "Static ability kind cost.hidden has no layer mapping"), and
 *   programs/play.ts/lifecycle.ts do not consume a hide cost or facedown play.
 * - Temporary: the granted keyword expands to a beginning-start trigger whose
 *   event pattern is not in the closed EVENT_PATTERN_TYPES enum, so
 *   pipeline.registerTrigger throws TriggerSpecValidationError; programs/
 *   lifecycle.ts also only installs triggers on zone entry.
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "hidden" },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      // The non-controller turn condition needs a turn-player predicate.
      filter: { self: true }
    },
    optional: false,
    body: [
      {
        id: "momentary-companion.grant-temporary",
        op: "continuous.grant-keyword",
        args: {
          keyword: { kind: "constant", value: "Temporary" },
          duration: { kind: "constant", value: "permanent" },
          appliesTo: { kind: "constant", value: "self" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-acd7471a82a9a0d5caee4793bb24dd67313afca36a5e9b63e8e43bb188c5e0d4",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺「if it is not your turn」的真实回合玩家/控制者条件：effects/contract.ts 的 ResolveContext 没有 turnPlayer，Condition/Expr " +
    "没有回合上下文，不能把描述性字符串作为布尔谓词。Hidden（CR 811）的静态展开与 buildHiddenCostPlan 已存在，" +
    "但 programs/statics.ts 的 layerFor 没有 cost.hidden 映射（实测 bindStatic 抛 “Static ability kind cost.hidden has no layer mapping”），" +
    "programs/play.ts/lifecycle.ts 也未消费 cost.hidden 建立 Hide 与面朝下反应打出的权限/费用路径。" +
    "Temporary 授予及关键词展开已可执行，但 programs/lifecycle.ts 只在入区时安装触发，未在连续授予关键词后重新安装其 beginning-start " +
    "自毁触发（816.1.b）；同时 beginning-start 目前也不在 events/trigger-spec.ts 的事件模式闭集内，" +
    "pipeline.registerTrigger 实测抛 TriggerSpecValidationError。",
  abilities,
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "When you play me, if it's not your turn, give me [Temporary]. (Kill me at the start of my controller's Beginning Phase, before scoring.)"
} satisfies CardProgram;

export default program;
