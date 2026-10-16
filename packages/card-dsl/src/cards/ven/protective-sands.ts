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
 * status = judge-required（缺口均不近似实现）：
 * 1. 缺 cost.pay 原语：effects/instructions/ 只有 effect.* 文件，RIFT-9 原语清单把
 *    cost.pay 列为必需（费用计划归属 RIFT-89），因此 "pay :rb_energy_1:" 这一步没有
 *    已合入执行路径；程序里保留描述性 cost.pay 指令（同 sfd/sunken-temple 的处理）。
 * 2. 触发侧未接通：conquer 时点虽在封闭枚举中，但 scoring/（RIFT-76）未接入
 *    chain/events 单管线（RIFT-120），没有生产者 emit conquer；也没有已合入订阅方把
 *    CardProgram 的 triggered ability 注册成 TriggerRegistration，190.6 的战场能力
 *    控制者解析同样缺失。filter 的 here: true 是 053.3（"Battlefields say here"）的
 *    战场指代占位，引擎 trigger-spec 校验器当前不接受该键。
 * 3. 已支持并真实执行的部分：符文计数触发条件（count + rune-zone，<=4）与
 *    choice.optional 的"可以"语义（拒绝时整条被选指令跳过）。
 * 依赖：RIFT-89（cost.pay 费用计划接线）、RIFT-76 → RIFT-120（conquer 发射与战场能力
 * 注册，契约 §7.2 批 5）。
 */
export default {
  canonicalCardId: "card.hash-be16710fdfd6fce7243538754b9e041ce61077a17c75b104b7d6dc5dd119ce97",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) 缺 cost.pay 原语：effects/instructions/ 只有 effect.* 文件，" +
    "RIFT-9 原语清单把 cost.pay 列为必需原语（费用计划接线属 RIFT-89），" +
    "所以「you may pay :rb_energy_1: to draw 1」的支付步没有已合入执行路径；" +
    "(2) 触发侧未接通：conquer 时点（383.4.c.2.b / 473.2.a）虽在 events/timing-points.ts 的封闭枚举中，" +
    "但 scoring/（RIFT-76）未接入 chain/events 单管线（RIFT-120），没有生产者 emit conquer，" +
    "也没有已合入订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration" +
    "（含 190.6 战场能力控制者解析）；filter 的 here: true 是 053.3 的战场指代占位。" +
    "已支持部分：触发条件（符文区 rune 计数 <= 4，133.5.a.1 / 431.1）与 choice.optional 的「可以」语义" +
    "已由 golden 用解释器 + 参考内核真实执行；effect.draw 本体已合入，但缺支付步无法完整结算。" +
    "依赖：RIFT-89（cost.pay 与费用计划）、RIFT-76 → RIFT-120（conquer 发射与战场能力注册，契约 §7.2 批 5）。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // "here" 是本战场（053.3），"you" 是它的控制者（190.6.d）；
        // 同类战场程序沿用同一处占位写法，等待触发注册落地。
        filter: { event: "conquer", here: true, player: "self" },
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
                  // 描述性 cost.pay：RIFT-9 列为必需原语的支付指令，尚未有文件（见 judgeReason）。
                  id: "protective-sands.pay",
                  op: "cost.pay",
                  args: { energy: { kind: "constant", value: 1 } }
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
