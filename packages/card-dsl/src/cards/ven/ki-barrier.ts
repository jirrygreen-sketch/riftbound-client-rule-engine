import type { CardProgram } from "../../ir/index.js";

/**
 * Ki Barrier (ven-126-166) — Spell, 2 energy + 1 Order power, no tags.
 * Might null（法术无印刷 Might）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-126-166，逐字）:
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)\n"
 *   "Choose a unit. Prevent the next 7 damage that would be dealt to it this turn. "
 *   "(Opponents can assign it extra combat damage to kill it.)"
 *
 * 规则依据（CR v1.5）：
 * - [Reaction]（813）是许可类关键词（159.2.b 的法术内在属性）；卡只声明关键词身份，
 *   展开（continuous.timing 的 closed-state 许可）归 effects/keywords/Reaction.ts 与 chain 的
 *   canAct 准入（契约 3.7/3.5）。
 * - "Choose a unit"：单位在 Board 上被具体选中，是目标（355.7/355.9.a.1/355.10）。
 * - "Prevent the next 7 damage that would be dealt to it this turn"：438.1/438.1.b.1 把 Prevent
 *   定义为「按 Prevent Value（此处 7）减少一组对象将受到的伤害」，438.2 规定被防止的伤害被
 *   「减少该 Prevent Value」的事件替代，438.3 规定按实际防止量递减 Unit 上跟踪的 Prevent Value，
 *   438.3.a 说明降到 0 或以下就不再跟踪。438.7/438.6 把它定为 Delayed Replacement Effect
 *   （367/369 的替代效果管线），窗口是 "this turn"（317.2.c/318 的清理到期）。
 * - 括号内文字是 438.5 的提示文本（"Opponents can assign it extra combat damage to kill it"
 *   说明战斗伤害仍可被分配、超出 Prevent Value 的部分照常标记），不构成第二条能力。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。三处依赖未合入，均不近似实现：
 * (1) 卡牌程序无法安装伤害预防替代：ResolveContext（契约 3.6）只有 addContinuous /
 *     registerDelayedTrigger，没有替代效果注册接口，effects/instructions 也没有
 *     replacement.prevent 原语；effects/keywords/ 下不存在任何预防展开（同型记录见
 *     ogn/unyielding-spirit、rad/firebrand-raider）。
 * (2) Prevent Value 的跟踪与消费没有实现：438.3 要求在被影响单位上保留剩余额度并按后续伤害事件递减，
 *     ObjectSnapshot 没有该字段，damage GameAction 也只有 {source, target, amount, combat}，
 *     无法表达「接下来 7 点」的部分防止与递减。
 * (3) "this turn" 的期限：契约 3.1 的 replacement 能力没有 duration 字段，
 *     需要 replacement 自身的本回合到期/清理接线，不能借用 continuous.might 的 duration。
 * 本文件保留可审查的声明形状（目标 + Prevent 语义 + 7 点 + this-turn），不写成伤害减免的近似实现。
 */
const kiBarrier = {
  canonicalCardId: "card.hash-c7314bf7e9131668bdd7205b5d3fbea9f04822a76c74bdac078317dc203fae52",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入，均不近似实现：(1) 卡牌程序无法安装伤害预防替代——ResolveContext（契约 3.6）只有 " +
    "addContinuous / registerDelayedTrigger，没有替代效果注册接口，effects/instructions 也没有 " +
    "replacement.prevent 原语（同型记录见 ogn/unyielding-spirit、rad/firebrand-raider）。" +
    "(2) Prevent Value 的跟踪与部分递减没有实现：438.1/438.1.b.1 的 Prevent Value 7、438.2 的" +
    "「按实际防止量减少伤害」事件与 438.3/438.3.a 的额度递减要求在被影响单位上保留剩余额度，" +
    "ObjectSnapshot 没有该字段，冻结的 damage GameAction 也只有 {source, target, amount, combat}，" +
    "无法表达「接下来 7 点」的部分防止。" +
    "(3)「this turn」的期限：契约 3.1 的 replacement 能力没有 duration 字段，需要 replacement 自身的 " +
    "本回合到期/清理接线。" +
    "「Choose a unit」的目标声明本身按 355.7/355.9.a.1 正确；[Reaction]（813.1/813.1.c）关键词已合入。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          // 438.1/438.1.b.1/438.7：结算中的法术创建延迟替代效果，被替代事件是
          // 「本回合对该单位将造成的伤害」，Prevent Value 为 7（438.3 的额度递减）。
          // 替代注册与 Prevent Value 消费方未合入，因此声明为未注册 op（见 judgeReason）。
          id: "ki-barrier.prevent-7",
          op: "replacement.prevent",
          args: {
            amount: { kind: "constant", value: 7 },
            duration: { kind: "constant", value: "this-turn" },
            target: { kind: "constant", value: "ki-barrier.unit" }
          },
          targets: [
            {
              id: "ki-barrier.unit",
              filter: { type: "unit", zone: "board" },
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
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose a unit. Prevent the next 7 damage that would be dealt to it this turn. " +
    "(Opponents can assign it extra combat damage to kill it.)"
} satisfies CardProgram;

export default kiBarrier;
