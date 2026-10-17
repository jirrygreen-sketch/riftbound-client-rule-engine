import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Arena Kingpin (unl-001-219) — Unit, 5 Energy, Might 3, Fury, tags Yordle/Noxus.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-001-219，逐字）：
 *   "I enter ready.\n:rb_exhaust:: Give a unit +3 :rb_might: this turn."
 *
 * 规则依据（CR v1.5）：
 * - 143.4 / 359.2.c：单位默认以横置状态进入 Board；"I enter ready." 按 369.3
 *   （该条以 Master Yi, Honed 的 "I enter ready." 举例说明入场替代效果）是把
 *   "横置进场"替换为"就绪进场"，因此按契约 3.1 写成 replacement 能力，with 体是
 *   就绪结果。805.6.a 的同型语义：这类替代不经过"先横置再就绪"的中间状态，因此
 *   effect.ready 文件头明确本原语不能模拟入场替代。
 * - 145.1 / 377.1：冒号之前是费用；本例的 ":rb_exhaust:" 是 415.5 的 "Exhaust this"
 *   （= Exhaust me）。145.2 / 377.3 规定单位启动能力在控制者的 Main Phase Open State
 *   执行并进入链，按契约 3.1 写成 activated.timing "action"（无 [Reaction] 印刷）。
 * - 「Give a unit +3 :rb_might: this turn」：355.9 的 "a unit" 由控制者在 Finalize 选择，
 *   是选目标（TargetSpec，不是 pick）；+3 是本回合的 Effective Might 算术修正
 *   （143.2.a 的三种 Might 形式 / 475 图层），归 layers 的 continuous.might，
 *   不是 702 的 Buff 计数器（effect.buff 文件头同款边界）。
 *
 * status = judge-required（复核 2026-10-17：缺口只剩入场替代一处，不近似实现）：
 * - 「Give a unit +3 :rb_might: this turn」已由 RIFT-258 合入的 continuous.might 原语
 *   真实执行（arithmetic 图层 + end-of-turn 期限，478 / 143.2.a）；本文件已按合入后的
 *   参数形状改写（objects + mode/amount/duration，不再有 `layer` 键，该键会被原语
 *   schema 拒绝），golden 用 resolveChainBody + LayerEngine 断言 +3 与到期失效。
 * - 仍缺「I enter ready.」：RIFT-260 的 bindReplacement 已能绑定入场朝向替代
 *   （Accelerate 同型），但 RIFT-257 的 attachLifecycle 只在 object-enters-board 时
 *   才回调 bindStatic/bindReplacement（chain 入场处只注册触发），那时换区已完成、
 *   替代不可能再匹配该次入场；也没有任何已合入的 ProgramStaticBinder 实现把
 *   ContinuousEffectSpec 注册进 LayerEngine。effect.ready 不能代替入场替代
 *   （805.6.a：不存在"先横置再就绪"的中间状态）。
 *
 * 已合入并真实执行的部分：印刷费用 "Exhaust me"（145.1 / 415.4 / 415.5）由
 * cost/ 的 buildCostPlan + payCostPlan 消费（golden 中执行，并验证已横置对象不能
 * 再次支付该费用）。
 *
 * 依赖：RIFT-257 后续（在 chain 入场前绑定卡牌替代/静态能力，并提供
 * ContinuousEffectSpec 的 ProgramStaticBinder 实现）。
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    // 369.3：以"单位进入的方式"描述的替代效果；自身以横置状态进入的事件被替代。
    replaces: { event: "object-enters-board", filter: { self: true, exhausted: true } },
    with: [
      {
        id: "arena-kingpin.enter-ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  },
  {
    kind: "activated",
    timing: "action",
    cost: {
      kind: "activated",
      // 415.5：[E] 是费用即 "Exhaust this"；无印刷 Energy 费用（不加 energy: 0）。
      payments: [{ kind: "exhaust", object: "self" }]
    },
    body: [
      {
        id: "arena-kingpin.grant-might",
        // 143.2.a / 475：本回合的 Might 算术修正，由已合入的 continuous.might
        // 原语写进 arithmetic 图层；objects 是 RIFT-258 之后的合入参数形状。
        op: "continuous.might",
        args: {
          mode: { kind: "constant", value: "add" },
          amount: { kind: "constant", value: 3 },
          duration: { kind: "constant", value: "end-of-turn" },
          objects: {
            kind: "constant",
            value: { kind: "target", id: "arena-kingpin.unit" }
          }
        },
        targets: [
          {
            id: "arena-kingpin.unit",
            // "a unit"（355.9）：Board 上的任意单位，不带控制者限制。
            filter: { zone: "board", type: "unit" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-42a7a3191d0a9e6cd6ac270c7dc6e9f36ee510fbfccf82e3b005ffd797864187",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺「I enter ready.」（143.4 / 359.2.c / 369.3 的人入场替代；805.6.a：不存在先横置再就绪的中间状态）：" +
    "RIFT-260 的 bindReplacement 已能绑定入场朝向替代（Accelerate 同型，golden 直接绑定后真实执行），" +
    "但 RIFT-257 的 attachLifecycle 只在 object-enters-board 时才回调 bindStatic/bindReplacement" +
    "（chain 入场路径仅注册触发），那时换区已经完成、替代不可能再匹配该次入场；" +
    "也没有任何已合入的 ProgramStaticBinder 实现把 ContinuousEffectSpec 注册进 LayerEngine。" +
    "effect.ready 不能代替入场替代（会多产生一次“成为就绪”事件）。" +
    "已合入并以真实执行验证：「Give a unit +3 :rb_might: this turn」由 RIFT-258 的 continuous.might" +
    "写进 arithmetic 图层并带 end-of-turn 期限（golden 用 resolveChainBody + LayerEngine 断言 +3 与到期失效）；" +
    "印刷费用 “Exhaust me”（145.1 / 415.4 / 415.5）由 cost/ 的费用计划真实支付。" +
    "依赖：RIFT-257 后续（在 chain 入场前绑定卡牌替代/静态能力，并提供 ContinuousEffectSpec 的 binder 实现）。不近似实现。",
  abilities,
  sourceText: "I enter ready.\n:rb_exhaust:: Give a unit +3 :rb_might: this turn."
} satisfies CardProgram;
