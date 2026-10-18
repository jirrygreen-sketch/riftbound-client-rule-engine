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
    "仍缺「战场上的单位或任意 Gear」的析取目标适配：programs/filters.ts 与 Chain 的 ObjectFilter 消费路径没有按类型分支的 OR，当前宽过滤器还会包含 Base 单位，不能当作完整目标限制（CR 355.9.b/355.10.b）。" +
    "continuous.grant-keyword 与 Temporary 的 beginning-start/kill KeywordDef 展开已存在，但生产装配仍用普通 LayerEngine，未接入 KeywordGrantLayerEngine 的重展开；" +
    "且 beginning-start 尚不在生产触发词表内，programs/lifecycle.ts 也未订阅图层关键词变化来注册 Temporary 触发，不能保证授予后在其控制者 Beginning Phase、计分前消灭（CR 816.1.b/816.1.c）。",
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
