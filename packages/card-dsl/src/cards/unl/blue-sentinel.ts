import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Blue Sentinel (unl-087-219) — Unit, 4 energy + 1 Mind power，Might 4，Mind，
 * 标签 Mount Targon。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-087-219，逐字）：
 *   [Shield 2] (+2 :rb_might: while I'm a defender.)
 *   Your hold effects for holding here trigger an additional time.
 *   When I hold, [Add] :rb_rune_rainbow: at the start of your next Main Phase.
 *   (Abilities that add resources can't be reacted to.)
 *
 * 规则依据（CR v1.5）：
 * - [Shield 2]（814.1.b/814.1.c）：带数值的被动关键词，声明 `value: 2`（README 第 5 节）；
 *   展开归 effects/keywords/Shield.ts。
 * - “Your hold effects for holding here trigger an additional time”：383.4.d.2.b 的 Hold Effect
 *   倍率改写——在本战场固守时，你的固守效果额外触发一次；同族先例是 ogn/karthus-eternal 与
 *   rad/detonation-amplifier 的 continuous.trigger-multiplicity 声明。
 * - “When I hold”：383.4.d/383.4.d.1 的 Hold Effect，时点 hold（scoring 发出），
 *   filter 取事件对象为来源自身（同 sfd/dunebreaker 的写法）。
 * - “at the start of your next Main Phase”：391.2/392 的延迟触发；“next” 是相对本次固守的
 *   下一个 Main Phase，需要延迟触发的登记与期限窗口。
 * - “[Add] :rb_rune_rainbow:”：430.1/430.5 的 Add 动作；`:rb_rune_rainbow:` 是 163.2.b /
 *   135.2.e.5 的 Universal Power（[A]，任意域力量）。430.2/430.2.a 规定 Add 能力立即结算、
 *   不传递优先权；括号提醒按 430.2.a 是说明文本。
 *
 * status = judge-required（缺口均不近似实现）：
 * - [A]（Universal Power）在契约的封闭 Domain 集合（Fury/Calm/Mind/Body/Chaos/Order）内不可表达；
 *   effect.resources 明确记录“Universal Power is not representable … never approximated by a
 *   chosen domain”（实测对 ["rainbow"] 返回 negated(impossible)）。
 * - “trigger an additional time” 没有引擎模型：Ability 六种形状没有触发倍率，ContinuousEffect.kind
 *   没有消费者，触发收集阶段（events/）也没有倍率接口。
 * - 延迟触发 “at the start of your next Main Phase” 没有已注册原语消费 ctx.registerDelayedTrigger，
 *   也没有“下一次 Main Phase”的期限模型。
 * 依赖：触发倍率接口、延迟触发原语（RIFT-9 trigger.delayed / RIFT-120）、Universal Power 的契约变更请求。
 */
const abilities: Ability[] = [
  // 814.1.b：印刷为 [Shield 2]，带数值。
  { kind: "keyword", keyword: "shield", value: 2 },
  {
    // 383.4.d.2.b：“Your hold effects for holding here trigger an additional time.”
    // 触发收集阶段的倍率改写；保留待接线声明（同 Karthus, Eternal / Detonation Amplifier）。
    kind: "static",
    effect: {
      kind: "continuous.trigger-multiplicity",
      mode: "additional",
      amount: { kind: "constant", value: 1 },
      appliesTo: {
        keyword: "hold-effect",
        controller: "controller",
        zone: "board",
        here: true
      }
    }
  },
  {
    kind: "triggered",
    // 383.4.d / 383.4.d.1：“When I hold” = 来源自身在 hold 时点的 Hold Effect。
    trigger: { at: "hold", filter: { event: "hold", filter: { source: "self" } } },
    optional: false,
    body: [
      {
        id: "blue-sentinel.schedule-add",
        // “at the start of your next Main Phase”：延迟触发登记（391.2/392）；
        // 没有已注册原语消费 ctx.registerDelayedTrigger，也没有 next-Main-Phase 期限模型。
        op: "trigger.delayed",
        args: {
          at: { kind: "constant", value: "main-start" },
          window: { kind: "constant", value: "next-main-phase" },
          body: {
            kind: "constant",
            value: [
              {
                id: "blue-sentinel.add-universal-power",
                op: "effect.resources",
                args: {
                  // 163.2.b / 135.2.e.5：[A] 任意域力量；封闭 Domain 集合无该值，
                  // 以 "rainbow" 保留记号（原语返回 negated(impossible)，不近似成任一具体域）。
                  power: { kind: "constant", value: ["rainbow"] }
                }
              }
            ]
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-cc5b4c7c8552ab416ee26137732c2e83c4df87b7e9fed57fdc4d1c19b390bcba",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处缺口，均不近似实现：(1)「Your hold effects for holding here trigger an additional time」（383.4.d.2.b）没有引擎模型：" +
    "Ability 六种形状没有触发倍率，ContinuousEffect.kind 没有消费者，触发收集阶段（events/）也没有倍率接口（同 Karthus, Eternal 的缺口）。" +
    "(2)「at the start of your next Main Phase」是延迟触发（391.2/392）：effects/instructions/ 没有任何 opcode 消费 " +
    "ctx.registerDelayedTrigger，也没有「下一次 Main Phase」的期限模型。" +
    "(3)「[Add] :rb_rune_rainbow:」的 [A]（163.2.b / 135.2.e.5）不在封闭 Domain 集合内：effect.resources 明确 Universal Power " +
    "不可表达、绝不用某个域近似（实测 power: [\"rainbow\"] 返回 negated(impossible)），本卡保留记号并提交契约变更请求。" +
    "[Shield 2]（814）已声明；hold 触发结构（383.4.d 的时点 hold）已保留。" +
    "依赖：触发倍率接口（events/）、RIFT-9 的 trigger.delayed 原语 / RIFT-120、Universal Power 的契约变更请求。",
  abilities,
  sourceText:
    "[Shield 2] (+2 :rb_might: while I'm a defender.)\n" +
    "Your hold effects for holding here trigger an additional time.\n" +
    "When I hold, [Add] :rb_rune_rainbow: at the start of your next Main Phase. (Abilities that add resources can't be reacted to.)"
} satisfies CardProgram;

export default program;
