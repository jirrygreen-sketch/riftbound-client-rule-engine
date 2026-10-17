import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Lingering Animus — CR v1.5 143.4/359.2.c, 369.3, 364.3.a.
 * Entry replacement binding is implemented by programs/statics.ts and
 * replacement/bind.ts. HistoryQuery.objectFilter also supports historical
 * type/controller filters. The missing boundary is exposing that turn history
 * to a replacement Condition; a body condition.history instruction cannot gate
 * the entry replacement. The partial body must stay judge-required.
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    replaces: { event: "object-enters-board", filter: { source: "self" } },
    // The historical if-clause still needs a replacement Condition adapter.
    with: [
      {
        id: "lingering-animus.enter-ready",
        op: "effect.ready",
        // 369.3：入场替代把“横置进场”替换为“就绪进场”；替代体作用于被替代事件的对象
        // （本卡自身），用入场事件的来源引用而不是事后状态改写。
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-bc88b399b22771c1b0e8eea598eb3d2815cb30e736bb70aa1852191e66c735e3",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺入场替代的历史条件求值（CR 364.3.a/369.3）：Condition/Expr 不能读取「本回合有友方单位或装备死亡」的 HistoryQuery；" +
    "condition.history 是 body 指令，不能作为替代能力的 Condition 执行。history.objectFilter 已支持按历史对象类型/控制者过滤，" +
    "入场替代也已有 programs/statics.ts → replacement/bind.ts 路径；还需让 replacement/bind.ts 的 " +
    "matchesEnterAction 分支在命中入场时消费该条件（目前先直接返回 true），不能省略 if 后执行整卡。",
  abilities,
  sourceText: "I enter ready if a friendly unit or gear died this turn."
} satisfies CardProgram;

export default program;
