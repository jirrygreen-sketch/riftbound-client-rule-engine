import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Scorchclaw (unl-016-219) — Unit, 3 Energy + 1 Fury power, Might 3, Fury,
 * tags Dog/Noxus.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-016-219，逐字）：
 *   "[Hunt 2] (When I conquer or hold, gain 2 XP.)\n"
 *   "[Level 3][>] I have +1 :rb_might: and enter ready. (While you have 3+ XP, get the effect.)"
 *
 * 规则依据（CR v1.5）：
 * - [Hunt 2]（823）：823.1 是 Triggered Ability 关键词、823.1.a 出现在单位上；823.1.b 同时是
 *   Conquer 与 Hold 效果；823.1.c / 823.1.c.1 定义格式与功能文本 "When I Conquer or Hold, my
 *   controller gains X XP."；823.1.c.2 省略 X 时视为 1（本例印刷 X = 2）；823.2 多来源的 Hunt
 *   Value 相加；823.3 说明这是可被引用的特征。卡按契约 3.7 只声明 keyword 与印刷值，展开
 *   （conquer/hold 触发 + effect.xp）归 effects/keywords/Hunt.ts。
 * - [Level 3][>]（824）：824.1 是 Dependent Keyword，824.1.a 的格式为 "[Level [N][>] [Text]"；
 *   824.1.b / 824.1.b.1 说明从关键词到子句结尾整段是 Level Ability，功能上等价于 "While you
 *   have [N] or more XP, this card gains '[Text]'"；824.1.c / 824.1.d 说明控制者 XP 变化会即时让
 *   依赖能力 Active / Inactive。因此这里的两条子效果是同一依赖能力的两个部分：
 *   · "I have +1 :rb_might:" 是对 Effective Might 的算术修正（143.2.a / 475 / 477），归 layers 的
 *     continuous.might（不是 702 的 Buff 计数器）；
 *   · "enter ready" 是入场替代（359.2.c / 369.3；805.6.a 说明不经过先横置再就绪的中间状态），
 *     按契约 3.1 写成 replacement 能力。
 *   括号内的 "(While you have 3+ XP, get the effect.)" 是 824.1.b.1 的提醒文本，不是第三条能力。
 *
 * status = judge-required（缺口不近似实现）：
 * - [Hunt 2]（823）的 KeywordDef 已合入（effects/keywords/Hunt.ts：conquer/hold 两条
 *   effect.xp 触发，823.1.c.1），展开体在 golden 中经真实解释器执行。仍缺的是消费侧：
 *   scoring/turn 流程发出的 conquer / hold 时点没有进入卡牌触发的注册链路，也没有生产方
 *   把卡牌 keyword 能力解析成 KeywordDef 并注册（RIFT-257 的 programs/ 适配器无运行时调用方）。
 * - [Level 3][>]（824.1 的 Dependent Keyword）的展开已合入（effects/keywords/Level.ts），
 *   但它产出的是 condition.predicate 声明的 XP 谓词，图层条件词表（layers/engine.ts 的
 *   conditionMatches）只认 always/never/type/has-tag/has-keyword，condition.predicate 不识别
 *   且未知条件按 true —— 直接绑定会让依赖能力恒生效；824.1.c.1 / 824.1.d 的即时失活同样缺失。
 * - 两条子效果各自的绑定也未接通：「I have +1 :rb_might:」的 continuous.might 图层算术修正
 *   与「enter ready」的入场替代（replacement.enter 已合入，golden 用真实 replacement 绑定验证）
 *   都没有卡牌程序 → 能力的注册路径（RIFT-257）。
 *
 * 依赖：RIFT-257（卡牌程序 → 图层/触发的生产接线）、conquer/hold 时点进入触发注册链路、
 * 图层条件对 condition.predicate 的消费（824.1.c.1/824.1.d 的即时失活）。
 */
const abilities: Ability[] = [
  // 823.1.c：印刷为 "Hunt 2"，Hunt Value = 2（823.1.c.2 的缺省 1 不适用）。
  { kind: "keyword", keyword: "hunt", value: 2 },
  {
    kind: "static",
    // 824.1.b.1：Level 3 依赖能力的 "I have +1 :rb_might:" 分支；XP 门槛见 judgeReason。
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      appliesTo: "self",
      amount: { kind: "constant", value: 1 }
    },
    condition: {
      // 824.1.c："While you have 3+ XP"。count 表达式的 subject 记录 XP 门槛语义；
      // PlayerSnapshot.xp 没有 Expr 读取路径（见 judgeReason），该形状当前不可求值。
      kind: "compare",
      left: { kind: "count", subject: "controller-xp", filter: { player: "controller" } },
      operator: "gte",
      right: { kind: "constant", value: 3 }
    }
  },
  {
    kind: "replacement",
    // 824.1.b.1 的第二个分支 "and enter ready"（359.2.c / 369.3 的入场替代）。
    replaces: { event: "object-enters-board", filter: { self: true, exhausted: true } },
    condition: {
      kind: "compare",
      left: { kind: "count", subject: "controller-xp", filter: { player: "controller" } },
      operator: "gte",
      right: { kind: "constant", value: 3 }
    },
    with: [
      {
        id: "scorchclaw.enter-ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-2958889db75762be77762e57c20843ec822b4e17041923975b21d9edc0fd4494",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入：(1) [Hunt 2]（823）的 KeywordDef 与展开体都已合入（effects/keywords/Hunt.ts 用 effect.xp 产生 " +
    "conquer/hold 两条触发，823.1.c.1），golden 经真实解释器执行该展开体；仍缺消费侧——scoring/turn 发出的 conquer/hold " +
    "时点没有进入触发注册链路，也没有生产方把卡牌 keyword 解析成 KeywordDef 并注册（RIFT-257）。" +
    "(2) [Level 3][>]（824.1 的 Dependent Keyword）的展开已合入（effects/keywords/Level.ts），但它产出 condition.predicate " +
    "的 XP 谓词，而图层条件词表（layers/engine.ts 的 conditionMatches）只认 always/never/type/has-tag/has-keyword，" +
    "condition.predicate 不识别且未知条件按 true——直接绑定会让 824.1.c 的依赖能力恒生效，824.1.c.1 / 824.1.d 的" +
    "XP 变化即时失活同样缺失。" +
    "(3) 依赖能力的两条子效果也缺绑定：「I have +1 :rb_might:」是 arithmetic 图层的 continuous.might（143.2.a / 475），" +
    "「enter ready」是入场替代（359.2.c / 369.3）——replacement.enter 原语已合入并在 golden 中用真实 replacement 绑定验证，" +
    "但没有卡牌程序 → 图层/替代能力的生产接线（RIFT-257）；effect.ready 不能模拟入场替代（会多产生一次“成为就绪”事件）。" +
    "依赖：RIFT-257（卡牌程序绑定）、conquer/hold 时点进入触发注册链路、图层条件对 condition.predicate 的消费。不近似实现。",
  abilities,
  sourceText:
    "[Hunt 2] (When I conquer or hold, gain 2 XP.)\n" +
    "[Level 3][>] I have +1 :rb_might: and enter ready. (While you have 3+ XP, get the effect.)"
} satisfies CardProgram;
