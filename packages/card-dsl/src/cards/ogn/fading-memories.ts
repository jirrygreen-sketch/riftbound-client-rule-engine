import type { CardProgram } from "../../ir/index.js";

/**
 * Fading Memories (ogn-180-298) — Spell, 4 energy + 1 Chaos Power, Chaos.
 *
 * Printed text:
 *   Give a unit at a battlefield or a gear [Temporary]. (Kill it at the start
 *   of its controller's Beginning Phase, before scoring.)
 *
 * Structure (contract 3.1 / 3.2 / 3.9, Core Rules v1.5):
 * - The choice is between two shapes of object: "a unit at a battlefield OR a
 *   gear". The printed sentence is one choice over one object, so the program
 *   uses one TargetSpec whose filter admits both alternatives ("or"), not a
 *   mode choice (contract 3.9 reserves choice.mode for bulleted modes).
 * - "a unit at a battlefield OR a gear" is a disjunction of two shapes with
 *   different Location restrictions (355.10.b restricts only the unit
 *   alternative; Gear lives in a Base by default, 149.2). The merged
 *   ObjectFilter vocabulary is a conjunction of single field values
 *   (events/trigger-spec.ts ObjectFilter, layers/filter.ts), so the
 *   alternatives are recorded descriptively below and the gap is listed in
 *   judgeReason instead of being narrowed to one shape.
 * - The granted [Temporary] is a keyword, so per cards README section 5 the
 *   card only declares it; granting/removal, the expiry trigger and the layer
 *   consumption stay in the engine keyword file (contract 3.7).
 * - The granted keyword has no duration of its own: 816 is a static
 *   characteristic on the permanent ("whether or not a permanent has
 *   Temporary, is a characteristic", 816.3), so the declaration below carries
 *   no end-of-turn duration — the kill happens at the controller's Beginning
 *   Phase (816.1.b), not when an effect expires.
 *
 * Status: judge-required — continuous.grant-keyword and the Temporary KeywordDef
 * are merged, so the grant can be executed through the interpreter and layer
 * engine. The remaining gaps are the adapter that expands granted keywords
 * into live triggers, the Beginning Phase trigger subscription, and the
 * disjunctive unit-at-battlefield-or-gear target filter.
 */
const fadingMemories = {
  canonicalCardId: "card.hash-14d6255fe1976a488bb687562e989583b5f23cc0d020651042bf3573f790809b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "continuous.grant-keyword 原语、ability 图层消费与 Temporary KeywordDef 已合入，选择目标后授予 Temporary 的局部效果可执行；" +
    "仍缺 CardProgram 适配器把授予的 KeywordDef 接入实时触发注册，以及 Temporary 在目标控制者 Beginning Phase 的 beginning-start 触发链路" +
    "（CR 816.1.b/816.1.c；RIFT-257、RIFT-270）。此外冻结的 ObjectFilter 还不能表达“战场上的单位或任意 Gear”的析取目标，不能宣称整卡 executable。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "fading-memories.grant-temporary",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Temporary" },
            target: { kind: "constant", value: "fading-memories.unit-or-gear" }
          },
          targets: [
            {
              id: "fading-memories.unit-or-gear",
              // 「战场上的单位 或 装备」：两个形状的析取，见 judgeReason；
              // 过滤器不能只写 location 而把 Base 上的装备排除掉。
              filter: { zone: "board", type: ["unit", "gear"] },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "Give a unit at a battlefield or a gear [Temporary]. (Kill it at the start " +
    "of its controller's Beginning Phase, before scoring.)"
} satisfies CardProgram;

export default fadingMemories;
