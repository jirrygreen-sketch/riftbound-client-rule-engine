import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Lingering Animus — CR v1.5 143.4/359.2.c, 369.3, 364.3.a.
 * Entry replacement binding is implemented by programs/statics.ts and
 * replacement/bind.ts. HistoryQuery.objectFilter also supports historical
 * type/controller filters. Re-probed 2026-10-17, the missing boundary has two
 * parts:
 * - No Condition/Expr node can evaluate a turn HistoryQuery. condition.history
 *   is a body instruction (effects/interpreter.ts), and evaluateCondition()
 *   only implements always/never/expression/compare/all/any/not, so a
 *   ReplacementAbility.condition cannot count this turn's friendly deaths.
 * - replacement/bind.ts evaluates the ability condition only in the generic
 *   matchFor() path; matchesEnterAction() returns true before testCondition()
 *   is reached, so an entry-orientation replacement ignores ability.condition
 *   entirely (verified: a condition: { kind: "never" } copy still readied the
 *   entering unit). The partial body must stay judge-required.
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    replaces: { event: "object-enters-board", filter: { source: "self" } },
    // 364.3.a：把本回合友方单位或 Gear 的死亡历史保留在替代能力条件上。
    // `history-record` 使当前集合查询 fail-closed；它不是把 live objects 当作死亡记录的近似。
    condition: {
      kind: "compare",
      left: {
        kind: "count",
        subject: "friendly-unit-or-gear-died-this-turn",
        filter: { zone: "history-record", type: ["unit", "gear"], controller: "self" }
      },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    },
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
    "condition.history 是 body 指令，effects/interpreter/condition.ts 的 evaluateCondition 只实现 always/never/expression/compare/all/any/not，" +
    "不能作为替代能力的 Condition 执行。history.objectFilter 已支持按历史对象类型/控制者过滤，入场替代也已有 " +
    "programs/statics.ts → replacement/bind.ts 路径；还需让 replacement/bind.ts 的 matchesEnterAction 分支在命中入场时消费该条件" +
    "（实测 condition: { kind: \"never\" } 的副本仍会把入场单位就绪，因为 matchesEnterAction 命中后先返回 true，未走 testCondition），" +
    "不能省略 if 后执行整卡。",
  abilities,
  sourceText: "I enter ready if a friendly unit or gear died this turn."
} satisfies CardProgram;

export default program;
