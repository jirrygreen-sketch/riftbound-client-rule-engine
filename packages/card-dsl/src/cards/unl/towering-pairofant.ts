import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Towering Pairofant (unl-008-219) — Unit, 6 Energy, Might 6, Fury, tag Shurima.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-008-219，逐字）：
 *   "[Assault] (+1 :rb_might: while I'm an attacker.)\n"
 *   "If a unit died this turn, I enter ready."
 *
 * 规则依据（CR v1.5）：
 * - [Assault]（807.1.b.3）：印刷省略数值时 Assault Value 视为 1；807.1.c 功能上等价于
 *   "While I am an attacker, I have +1 [M]"；807.1.d / 807.1.d.1 说明该修正在维持
 *   Attacker designation 期间生效；807.2 多来源相加；807.3 这是可引用特征。
 *   卡按契约 3.7 只声明 keyword，展开（static continuous.might + designation 条件）归
 *   effects/keywords/Assault.ts（RIFT-81）。
 * - "If a unit died this turn, I enter ready."：369.3 说明以"单位进入的方式"描述的
 *   陈述是入场替代效果（把 359.2.c 的"横置进场"替换为"就绪进场"）；前置的 "If a unit
 *   died this turn" 是该替代效果的适用条件（364.3.a 的条件被动形态），需要在入场判定时
 *   读取"本回合有单位死亡"这一事件历史。
 *
 * status = judge-required（缺口不近似实现）：
 * - 入场替代需要"卡牌程序的 replacement 能力 → 事件管线替代注册与执行"的适配路径
 *   （object-enters-board 的替代消费方），合并代码没有该路径（warwick-hunter、
 *   disposal-expert、vanguard-attendant 记录同一批次缺口）；effect.ready 不能模拟入场替代
 *   （会多产生一次"成为就绪"事件，805.6.a 同源语义）。
 * - 条件 "If a unit died this turn" 需要在本回合窗口内按对象特征过滤的死亡事件历史谓词：
 *   已合入的 condition.history 原语经 interpreter/history.ts 只接受
 *   { scope, action, timingPoint, player, object }（额外字段直接抛错），契约 3.8 增补的
 *   HistoryQuery.objectFilter / exclude 未进当前 HEAD，且 ObjectSnapshot 没有死亡标记。
 *
 * 依赖：RIFT-89~91（replacement.enter / layers 批次）、契约 3.8 的历史查询增补与
 * RIFT-120 的卡牌程序替代注册适配。
 */
const abilities: Ability[] = [
  // 807.1.b.3：省略数值 → Assault Value 1，不写 value 与写 value: 1 等价；
  // 本程序按印刷原文省略数值（与 sfd/lucian-gunslinger 的写法一致）。
  { kind: "keyword", keyword: "assault" },
  {
    kind: "replacement",
    // 369.3 / 359.2.c：把自身"横置进场"替换为"就绪进场"。
    replaces: { event: "object-enters-board", filter: { self: true, exhausted: true } },
    condition: {
      // 364.3.a 的条件被动形态：条件写在替代能力上，在入场替代判定时求值。
      // count 表达式的 subject 记录 "units died this turn" 这一历史窗口；合并 IR 没有
      // 按特征过滤的历史查询（见 judgeReason），因此该形状当前不可求值。
      kind: "compare",
      left: {
        kind: "count",
        subject: "units-died-this-turn",
        filter: { type: "unit" }
      },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    },
    with: [
      {
        id: "towering-pairofant.enter-ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-236b348b03423e44bd4951c615315452d5da4f0e0be98b47ebafeddb51fe1f8a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入：(1) 「I enter ready.」是入场替代效果（359.2.c / 369.3；805.6.a 说明不经过" +
    "先横置再就绪的中间状态），契约 3.1 只能写成 replacement 能力，而卡牌替代能力到事件管线替代注册" +
    "与执行的适配路径未合入（warwick-hunter、disposal-expert、vanguard-attendant 记录同一批次缺口）；" +
    "effect.ready 明确不能模拟入场替代。" +
    "(2) 条件「If a unit died this turn」需要本回合窗口内按对象特征过滤的死亡事件历史：已合入的 " +
    "condition.history 原语（interpreter/history.ts）只接受 { scope, action, timingPoint, player, object }，" +
    "遇到额外字段直接抛错，契约 3.8 增补的 HistoryQuery.objectFilter / exclude 未进当前 HEAD，" +
    "ObjectSnapshot 也没有死亡标记，因此该条件无法诚实求值。" +
    "[Assault]（807.1.b.3 省略数值 = Assault Value 1）按 807 只声明关键词与 807.1.b.3 的缺省值；" +
    "其展开文件已合入但没有卡牌→图层的注册路径（registerContinuousEffect 无调用方，且 807.1.d 的" +
    "Attacker designation 不是 ObjectSnapshot 特征，契约 3.8 combatRole 未进 HEAD）。" +
    "依赖：RIFT-89~91（replacement.enter / layers 批次）、契约 3.8 历史查询增补、RIFT-120 卡牌注册适配。不近似实现。",
  abilities,
  sourceText:
    "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
    "If a unit died this turn, I enter ready."
} satisfies CardProgram;
