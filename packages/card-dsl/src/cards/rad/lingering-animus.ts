import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Lingering Animus (rad-005-167) — Unit, Fury, 2 energy / 2 Might。
 *
 * 原文（deck-catalog rad-005-167，逐字）：
 *   "I enter ready if a friendly unit or gear died this turn."
 *
 * 规则依据（CR v1.5）：
 * - "I enter ready"：单位默认横置进场（143.4/359.2.c），本句是入场替代效果
 *   （369.3：以“how the unit enters”描述的入场替代，Master Yi, Honed 示例）；
 * - "if a friendly unit or gear died this turn"：条件式被动（364.3.a 的 "if"），
 *   依赖本回合“友方单位或装备死亡”的历史事实（317.2.c 的 “this turn” 窗口）。
 *
 * status: judge-required（不近似实现），当前缺口：
 * 1. 入场替代的卡牌绑定尚未接到本任务可见的路径：src/replacement/（RIFT-260）已完成
 *    replacement.enter / replacement.event 的绑定与规划，但卡程序的替代能力还需要打出流程
 *    的绑定调用方（RIFT-257 programs 绑定）——没有它，“I enter ready” 无法在入场动作上生效。
 * 2. 条件的“本回合死亡的单位或装备”没有可求值谓词：Condition 只有
 *    always/never/compare/all/any/not/expression，没有 history 节点（364.3.a 的条件式被动
 *    写在替代能力上，不是可放指令的 condition.history）；HistoryQuery 只支持
 *    scope/action/timingPoint/player/object（+ 契约 3.8 增补的 exclude / objectFilter），
 *    “死亡的单位或装备（按类型/控制者过滤）”仍无类型/控制者维度。
 * 说明：不把条件写成 count + 一个不存在的 zone，那会在求值时静默变成 0/恒假，等于把
 * “本回合有死亡”近似成 false。条件字段因此省略，缺口写在这里（见 judgeReason）。
 * golden 只真实执行可执行的一半：replacement 的 with 体（effect.ready）本身。
 * 依赖：RIFT-257/260（替代能力绑定）、条件历史的类型/控制者维度。
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    replaces: { event: "object-enters-board", filter: { source: "self" } },
    // 364.3.a 的条件式被动：条件应在入场替代判定时读取“本回合有友方单位或装备死亡”。
    // 合并 Condition / HistoryQuery 没有该谓词（见 judgeReason），因此这里不填占位条件，
    // 避免把“本回合有死亡”静默近似成恒假。
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
    "两处未合入依赖：(1)「I enter ready」是入场替代（143.4 横置进场 + 369.3 替代），src/replacement/ 的 " +
    "replacement.enter / replacement.event 绑定已合入（RIFT-260），但没有卡牌程序绑定的调用方把本卡的 " +
    "replacement 能力接到入场动作上（RIFT-257 programs 绑定）；已合入的 effect.ready 不能事后模拟入场状态" +
    "（805.6.a 同源语义：不经过先横置再就绪的中间状态）。(2) 条件「a friendly unit or gear died this turn」" +
    "也无求值路径：Condition 只有 always/never/compare/all/any/not/expression，没有 history 节点（364.3.a 的" +
    "条件式被动写在替代能力上，不是可放指令的 condition.history），HistoryQuery 也只有 " +
    "scope/action/timingPoint/player/object（+ 契约 3.8 的 exclude / objectFilter，见 interpreter/history.ts），" +
    "无法按“本回合死亡的单位或装备（类型/控制者）”计数。不写成 count + 假 zone 的占位条件（那会静默恒假）。不近似实现。",
  abilities,
  sourceText: "I enter ready if a friendly unit or gear died this turn."
} satisfies CardProgram;

export default program;
