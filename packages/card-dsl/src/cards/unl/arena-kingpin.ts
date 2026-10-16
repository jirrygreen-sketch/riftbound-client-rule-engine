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
 * status = judge-required（缺口不近似实现）：
 * - "I enter ready." 需要"卡牌程序的 replacement 能力 → 事件管线替代注册与执行"的
 *   适配路径（入口事件 object-enters-board 的替代消费方），合并代码没有该路径
 *   （warwick-hunter / disposal-expert / vanguard-attendant 记录同一批次缺口），
 *   且 effect.ready 不能替代入场替代（会多产生一次"成为就绪"事件）。
 * - 「Give a unit +3 :rb_might: this turn」需要已注册的 continuous.might 原语与
 *   end-of-turn 期限：effects/instructions/ 下没有该 op 文件，layers/ 也没有读取
 *   卡牌指令/static 能力的注册入口（RIFT-91）。
 *
 * 已合入并真实执行的部分：印刷费用 "Exhaust me"（145.1 / 415.4 / 415.5）由
 * cost/ 的 buildCostPlan + payCostPlan 消费（golden 中执行，并验证已横置对象不能
 * 再次支付该费用）。
 *
 * 依赖：RIFT-89~91（费用计划 / layers-continuous / replacement.enter 批次）、
 * RIFT-120 的卡牌程序注册适配（触发与替代）。
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
        // 143.2.a / 475：本回合的 Might 算术修正；原语未注册，见 judgeReason。
        op: "continuous.might",
        args: {
          mode: { kind: "constant", value: "add" },
          layer: { kind: "constant", value: "arithmetic" },
          amount: { kind: "constant", value: 3 },
          duration: { kind: "constant", value: "end-of-turn" },
          target: { kind: "constant", value: "arena-kingpin.unit" }
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
    "两处依赖未合入：(1) 「I enter ready.」是人入场替代效果（143.4 / 359.2.c / 369.3；" +
    "805.6.a 说明不经过先横置再就绪的中间状态），契约 3.1 只能写成 replacement 能力，" +
    "而卡牌替代能力到事件管线替代注册与执行的适配路径未合入（warwick-hunter、disposal-expert、" +
    "vanguard-attendant 记录同一批次缺口）；effect.ready 明确不能模拟入场替代。" +
    "(2) 「Give a unit +3 :rb_might: this turn」需要已注册的 continuous.might 原语与 end-of-turn 期限" +
    "（143.2.a 的 Effective Might 算术修正 / 475 图层）：effects/instructions/ 下没有该 op 文件，" +
    "layers/（RIFT-91）也没有读取卡牌指令的注册入口；不能改用 effect.buff——Buff 是 702 的计数器，" +
    "不是 Might 修正。依赖：RIFT-91（layers-continuous / continuous.might 消费方）、RIFT-89~91 的" +
    "入场替代批次与 RIFT-120 的卡牌程序注册适配。" +
    "已合入部分：印刷费用 “Exhaust me”（145.1 / 415.4 / 415.5）由 cost/ 的费用计划真实支付，golden 执行该费用。",
  abilities,
  sourceText: "I enter ready.\n:rb_exhaust:: Give a unit +3 :rb_might: this turn."
} satisfies CardProgram;
