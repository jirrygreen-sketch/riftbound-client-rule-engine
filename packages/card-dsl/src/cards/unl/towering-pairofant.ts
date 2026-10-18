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
 * - 入场替代的绑定层已合入（RIFT-260 的 src/replacement/bind.ts 能消费卡牌 replacement 能力、
 *   识别 object-enters-board 的入场状态改写并把 effect.ready 规划成 ready action），golden 用真实
 *   bindReplacement 绑定该能力并驱动了入口改写；programs/lifecycle（RIFT-257）也已用
 *   createEngineStaticBinder（非 noop）在入场时把卡牌 replacement 经 bindReplacementAbility
 *   注册；apps/game-server 的 engine-runtime 在显式传入 programs 时会调用
 *   ProgramBinding.attachLifecycle，默认房间仍不注入本卡程序。
 * - 条件 "If a unit died this turn" 仍不可诚实求值：卡内用 Condition 的 compare(count) 形状表达，
 *   但解释器求值 count 时执行的是 ctx.query(filter) 的**集合计数**（interpreter/expr.ts 忽略
 *   subject 字段），"units-died-this-turn" 会被当成在场单位集合，条件会静默判错（无死亡也判
 *   真、就绪入场在错误时机发生）；Condition 代数里
 *   没有历史谓词形态（只有 condition.history 指令，且它只作指令求值，不能作为 replacement 的 condition）。
 *   契约 3.8 的 HistoryQuery.exclude/objectFilter 已在 interpreter/history.ts 落地，但那是指令侧通道，
 *   不能作为替代能力的门控。不近似实现：不把条件改成 always、不用事后 effect.ready。
 *
 * RIFT-700 的模板 golden 先让 Hextech Ray 经真实链和清理杀死单位，再打出本卡；
 * 无死亡场景按原文要求横置入场，保留为失败 TODO，不把集合计数当成死亡历史。
 * 依赖：替代条件的历史谓词求值、入场条件求值、compare(designation) 门控求值。
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
    "(1) 「I enter ready.」是入场替代效果（359.2.c / 369.3；805.6.a 说明不经过先横置再就绪的中间状态），" +
    "契约 3.1 的 replacement 形状与绑定层都已就绪（RIFT-260 的 src/replacement/bind.ts 识别 object-enters-board 的" +
    "入场状态改写并把 effect.ready 规划成 ready action，golden 用真实 bindReplacement 绑定该能力并驱动入口改写），" +
    "programs/lifecycle（RIFT-257）已用 createEngineStaticBinder（非 noop）在入场时把卡牌 replacement 经 bindReplacementAbility 注册，" +
    "golden 也驱动了该绑定；apps/game-server 的 engine-runtime 在显式传入 programs 时会调用 ProgramBinding.attachLifecycle，" +
    "RIFT-700 模板显式注册本卡程序并执行真实进链和入场，effect.ready 本体不等于条件替代已可执行。" +
    "(2) 条件「If a unit died this turn」不可诚实求值：卡内用 Condition 的 compare(count) 形状保留，但解释器对 count 的" +
    "求值走 ctx.query(filter) 的集合计数（interpreter/expr.ts 忽略 subject），\"units-died-this-turn\" 会被当成在场单位集合，" +
    "条件会静默判错（无死亡也判真、就绪入场在错误时机发生）；replacement 的 condition 也接不到 condition.history 指令（它只在指令体里求值），Condition 代数没有" +
    "历史谓词形态，契约 3.8 的 HistoryQuery.exclude/objectFilter（interpreter/history.ts 已落地）不适用于替代门控。" +
    "[Assault]（807.1.b.3 省略数值 = Assault Value 1）的 KeywordDef 已合入（RIFT-81），expandProgram 也已把关键词展开的 static 能力接入 lifecycle 绑定；" +
    "但 807.1.d.1 的 designation 门控是 compare 条件：programs/statics.ts 把它交给 evaluateCondition，object-property 求值对 designation 特征" +
    "抛 MissingInformation、被 try/catch 吞成恒 false（fail-closed 无操作），+1 Might 从不生效；layers/engine.ts 的结构化 conditionMatches 也不求值 compare。" +
    "此外 replacement/bind.ts 的 matchesEnterAction 命中入场形状后直接返回 true，不调用 testCondition，" +
    "所以无死亡也会错误就绪入场（RIFT-700 的无死亡边界以正确预期保留 TODO）。" +
    "契约变更请求：为 replacement.condition 增加可查询本回合单位死亡的历史谓词；" +
    "依赖 RIFT-260 入场条件求值、历史谓词及 RIFT-81 的 compare(designation) 门控后续接线。不近似实现。",
  abilities,
  sourceText:
    "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
    "If a unit died this turn, I enter ready."
} satisfies CardProgram;
