import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Lingering Animus (rad-005-167) — Unit, Fury, 2 energy / 2 Might.
 *
 * 原文（deck-catalog rad-005-167，逐字）：
 *   "I enter ready if a friendly unit or gear died this turn."
 *
 * 规则依据（CR v1.5）：
 * - "I enter ready"：单位默认横置进场（143.4），本句是入场替代效果
 *   （369.3：以“how the unit enters”描述的入场替代，Master Yi, Honed 示例），
 *   replacement 能力的 with 体用已合入的 effect.ready；
 * - "if a friendly unit or gear died this turn"：条件式被动（364.3.a 的 "if"），
 *   依赖本回合“友方单位或装备死亡”的历史计数。
 *
 * status: judge-required（不近似实现）：
 * - 入场替代管线（replacement.enter 家族）尚未合入；
 * - 历史条件无法落地：Condition 只有 always/never/compare/all/any/not/expression，没有
 *   history 谓词；HistoryQuery 只支持 scope/action/timingPoint/player/object，无法按
 *   “本回合死亡的单位或装备（按类型/控制者过滤）”计数。
 *
 * 依赖：RIFT-83/RIFT-84（replacement.enter 入场替代）、RIFT-89/90（condition.history 与
 * 过滤扩展）。
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    replaces: { event: "object-enters-board", filter: { source: "self" } },
    condition: {
      kind: "compare",
      left: {
        kind: "count",
        // 占位主题：解释器/历史系统需把“本回合死亡的友方单位或装备”计数绑定到此 subject。
        // 过滤器带一个不存在的 zone，使条件在依赖落地前 fail-closed（默认“本回合还没有死亡”），
        // 不因为“没有过滤条件就计数全部对象”而意外成立。
        subject: "friendly-unit-or-gear-died-this-turn",
        filter: { zone: "history-record" }
      },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    },
    with: [{ id: "lingering-animus.enter-ready", op: "effect.ready", args: {} }]
  }
];

const program = {
  canonicalCardId: "card.hash-bc88b399b22771c1b0e8eea598eb3d2815cb30e736bb70aa1852191e66c735e3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺入场替代管线：“I enter ready”（143.4 横置进场 + 369.3 入场替代）需要 replacement.enter" +
    "家族实现（RIFT-83/RIFT-84），已合入的 effect.ready 不能事后模拟入场状态；" +
    "条件“a friendly unit or gear died this turn”也无可执行依据：Condition 无 history 谓词，" +
    "HistoryQuery（contract.ts 98-104）只有 scope/action/timingPoint/player/object，" +
    "无法按“本回合死亡的单位或装备（类型/控制者）”计数，依赖 RIFT-89/90 的历史查询与过滤扩展。" +
    "不近似实现。",
  abilities,
  sourceText: "I enter ready if a friendly unit or gear died this turn."
} satisfies CardProgram;

export default program;
