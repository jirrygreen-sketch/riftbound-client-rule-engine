import type { CardProgram } from "../../ir/index.js";

/**
 * Protective Sands (ven-162-166) — Battlefield, Colorless.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-162-166，逐字）：
 *   "When you conquer here, if you control 4 or fewer runes, you may pay
 *    :rb_energy_1: to draw 1."
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.4.c / 383.4.c.1 / 383.4.c.2.b："When you conquer here" 是 Conquer Effect，
 *   即一条引用征服玩家（此处即本战场控制者）的触发能力；触发在征服发生且得分被替代或
 *   否定时仍会触发（383.4.c.2.c），对应的封闭时点是 events/timing-points.ts 的 conquer
 *   （规则引用 468.5.d / 471.1 / 473.2.a）。
 * - 383.2.a / 383.2.a.1：紧跟触发条件之后的 "if you control 4 or fewer runes" 属于
 *   Trigger Condition，不是 Effect（规则原文的 Sona, Harmonious 例子即此形状）：它决定
 *   触发是否成立，因此在 trigger.condition 上建模。
 * - 133.5.a.1 / 431.1：符文被 channel 后留在棋盘符文区（zone "rune-zone"），因此
 *   "you control 4 or fewer runes" = 控制者符文区中 rune 数量 <= 4。
 * - 190.6.a / 190.6.d：战场能力的 "you" 指战场控制者，所以 "you may pay" 的支付者与
 *   触发条件里的控制者都是能力控制者。
 * - 契约 3.9："you may pay … to draw 1" 是一个可选的支付后抽牌序列，写成
 *   choice.optional 并把两条指令放进 body（不是 choice + linkedTo）。
 *
 * status = judge-required（复核 2026-10-18；缺口均不近似实现）：
 * 1. cost.pay 已合入（effects/instructions/cost.pay.ts），但 740.4.a.2 要求
 *    这笔触发前置费用在 Finalize 支付；冻结的 TriggeredAbility 没有 cost 字段，且
 *    尚无 CardProgram→TriggerRegistration 的 cost/mayAtFinalize 提取接线。因此当前 IR
 *    只能把 cost.pay 保留在 optional body 中，golden 只能证明解释器结算期的支付与抽牌，
 *    不能宣称触发在无能量时会于 Finalize 被拒绝。
 * 2. conquer 时点已由合入的回合/计分流程发出（turn/flow.ts scheduleScore 的 Score
 *    提交波产生 'conquer' + 'score' 发射并带 details.battlefieldId；
 *    engine-core/test/game/lifecycle.test.mjs 断言），RIFT-257 的卡牌程序绑定
 *    （src/programs/triggers.ts）也已能注册 CardProgram 的 triggered ability；本卡
 *    的 filter 已改用封闭判别值 "conquered"（EVENT_NAMES 将其映射到 conquer 时点）。
 *    仍未接通的是 053.3 的 "here" 锚点：事件的战场身份只在 details.battlefieldId 载荷里，
 *    静态 filter 读不到事件出的战场（pipeline-match.ts 的 details 匹配只接受写死的值），
 *    且 here 过滤器键会被 programs/filters.ts 的 translateTriggerFilter 以
 *    judge-required 拒绝（fail closed），190.6 的战场能力控制者解析同样没有接线。
 * 3. 已支持并真实执行的部分：符文计数触发条件（count + rune-zone，<=4）、
 *    choice.optional 的"可以"语义（拒绝时整条被选指令跳过）与 conquer 时点的真实发射。
 * 依赖：740.4.a.2 触发费用的 TriggeredAbility/registration 接线、053.3 here 锚点 /
 * 190.6 战场能力绑定。
 */
export default {
  canonicalCardId: "card.hash-be16710fdfd6fce7243538754b9e041ce61077a17c75b104b7d6dc5dd119ce97",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：" +
    "(1) 740.4.a.2 要求「you may pay :rb_energy_1:」作为触发前置费用在 Finalize 支付，但冻结的 TriggeredAbility 没有 cost 字段，" +
    "programs/triggers.ts 也未把首段 cost.pay 提取进 TriggerRegistration.cost/mayAtFinalize；cost.pay 原语本身已合入，" +
    "当前只能证明结算期的支付与抽牌，无法让无能量时的触发在 Finalize 被拒绝。" +
    "(2) 053.3 的「here」锚点没有可求值绑定：conquer 时点（383.4.c.2.b / 473.2.a）已由 turn/flow.ts scheduleScore 的 Score 提交波" +
    "真实发射并带 details.battlefieldId，卡牌程序绑定也已能把 CardProgram 的 triggered ability 注册进管线（本卡 filter 用封闭判别值 " +
    "\"conquered\"，EVENT_NAMES 映射到 conquer 时点）；但事件的战场身份只存在于 details.battlefieldId 载荷，" +
    "pipeline-match.ts 的 details 匹配只接受写死的标量，静态 filter 读不到事件战场，programs/filters.ts 的 translateTriggerFilter " +
    "对 here 过滤器以 judge-required 拒绝（fail closed，不静默放行，golden 实测 \"Unsupported filter field here\"），" +
    "190.6 的战场能力控制者解析同样没有接线。" +
    "已支持并真实执行：触发条件（符文区 rune 计数 <= 4，133.5.a.1 / 431.1）、choice.optional 的「可以」语义、conquer 时点发射，" +
    "以及 body 内「pay :rb_energy_1: to draw 1」的 cost.pay + effect.draw 解释器执行。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // "here" 是本战场（053.3），"you" 是它的控制者（190.6.d）；
        // here 仍是未绑定的战场指代（见 judgeReason）。
        // 封闭事件判别值是 "conquered"（EVENT_NAMES 将其映射到 conquer 时点）。
        filter: { event: "conquered", here: true, player: "self" },
        condition: {
          kind: "compare",
          // 383.2.a.1：紧跟触发条件的 "if you control 4 or fewer runes" 属于触发条件。
          left: {
            kind: "count",
            subject: "runes",
            filter: { type: "rune", controller: "self", zone: "rune-zone" }
          },
          operator: "lte",
          right: { kind: "constant", value: 4 }
        }
      },
      optional: true,
      body: [
        {
          // 契约 3.9：「可以支付……然后抽 1」= 一个 choice.optional 包住被选指令。
          id: "protective-sands.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Pay 1 energy to draw 1?" },
            body: {
              kind: "constant",
              value: [
                {
                  // RIFT-261 已合入 cost.pay（effects/instructions/cost.pay.ts）；
                  // payments 形状表示 1 Energy 的资源支付，golden 端到端执行。
                  id: "protective-sands.pay",
                  op: "cost.pay",
                  args: { payments: { kind: "constant", value: { energy: 1 } } }
                },
                {
                  // 414.1 / 414.3：支付后抽 1，抽牌者缺省为能力控制者（190.6.d）。
                  id: "protective-sands.draw",
                  op: "effect.draw",
                  linkedTo: "protective-sands.pay",
                  args: { amount: { kind: "constant", value: 1 } }
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you conquer here, if you control 4 or fewer runes, you may pay :rb_energy_1: to draw 1."
} satisfies CardProgram;
