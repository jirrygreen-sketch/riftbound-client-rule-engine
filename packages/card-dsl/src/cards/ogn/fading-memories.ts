import type { CardProgram } from "../../ir/index.js";

/**
 * Fading Memories — CR v1.5 355.10.b and 816.1.b.
 * The Temporary grant and Beginning Phase timing exist. The remaining gaps
 * are the heterogeneous target disjunction and refreshing live keyword
 * triggers when an ability-layer grant changes an existing permanent.
 */
const fadingMemories = {
  canonicalCardId: "card.hash-14d6255fe1976a488bb687562e989583b5f23cc0d020651042bf3573f790809b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺「战场上的单位或任意 Gear」的异构析取目标过滤及 Finalize 翻译（CR 355.10.b；RIFT-359）。programs/lifecycle.ts 只在入区时展开 KeywordDef，未在图层授予/失去 Temporary 时更新实时触发注册，无法保证 CR 816.1.b/816.1.c 的控制者 Beginning Phase 消灭。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "fading-memories.grant-temporary",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Temporary" },
            objects: { kind: "constant", value: { kind: "target", id: "fading-memories.unit-or-gear" } }
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
