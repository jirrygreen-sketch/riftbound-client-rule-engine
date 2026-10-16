import type { CardProgram } from "../../ir/index.js";

/**
 * Valley of Idols (unl-218-219) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-218-219, 逐字)：
 *   When a player plays a unit here, they may pay :rb_energy_1: to [Buff] it.
 *   (Give it a +1 :rb_might: buff if it doesn't have one.)
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a.4 / 359 / 407：“When a player plays a unit here” 是“另一个对象被
 *   打出”的触发（不是 Play Effect），时点用封闭表的 card-played；“here” 是本源
 *   战场（053.3，Battlefields say "here"）。
 * - 190.6.c／190.6.a：“they” 是打出该单位的玩家：战场能力指明由某名玩家做选择时，
 *   该玩家就是这条能力的控制者（rule 190.6.c 的示例与该卡同型）。
 * - 383.3.a.3／355.1：“they may” 出现在效果内部且位于效果开头，按 383.3.a 仍是
 *   效果首部的 may；383.3.b 规定紧随其后的“费用在指令中”是触发能力的基础费用
 *   （在 Finalize 支付），因此 “pay :rb_energy_1:” 属基础费用，而不是结算效果。
 * - 契约 3.9：“可以……” 一律用 choice.optional 把被选指令包进 body。
 * - 702.2.a／702.3.a／703：Buff 是放在单位上的计数器，每个 Buff 提供 +1 Might；
 *   已有 Buff 的单位被指示再 Buff 时不放置第二个（括号内是提醒文本，135.2.d.1–d.3：
 *   提醒文本对游戏规则没有影响）。effect.buff（mode "buff"）执行该动作。
 *
 * status = judge-required（逐个记录缺口，不近似实现）：
 * 1. “they” 没有可求值的事件玩家选择器：chooser 与付款人都应是打出该单位的玩家，
 *    而冻结 IR 的 chooser/PlayerId 只能是静态 id 或玩家表达式，读不到触发事件的
 *    player（同 ogn/rakelstake 的缺口）。
 * 2. “pay :rb_energy_1:” 是紧随 “they may” 的基础费用（383.3.b、404.1.b.1）：
 *    TriggeredAbility 没有 CostSpec 字段（同 unl/piltover-enforcer 的 “exhaust me”），
 *    且 cost.pay 不是已合入的指令原语（RIFT-89）；把它留成结算期的付款指令会让
 *    “付不出也照样 Buff” 成立，属错误近似。
 * 3. “it” 指被打出的那个单位（事件载荷对象）：契约 3.6 的 ObjectSelector 只有
 *    self/source/target/pick/linked，没有事件对象选择器；effect.buff 的 target 只接受
 *    TargetSpec id，而该单位由效果程序化指定（355.10.d），不能声明成目标。
 * 4. 触发侧：card-played 时点由 chain/engine.ts 发出，但没有已合入订阅方把卡牌程序的
 *    triggered ability 注册成触发，打出目的地的 “here” 也没有载荷（RIFT-31/RIFT-33、
 *    RIFT-120）；filter 里的 here: true 是同类战场卡占位（053.3）。
 * 依赖：事件玩家/事件对象选择器（契约变更请求）、RIFT-89（费用与 cost.pay）、
 * RIFT-31/RIFT-33/RIFT-120。
 */
export default {
  canonicalCardId: "card.hash-8bf10670367f6b61f3c498325e7f4439d4e2341b2c8c6d47e1771e902955a174",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口，均不近似实现：(1) 「they may pay … to [Buff] it」的 “they” 是打出该单位的玩家（190.6.c：战场能力指明由某名玩家做选择时该玩家是该能力的控制者），" +
    "但 IR 没有事件玩家选择器，chooser 与付款人都无法绑定该玩家。" +
    "(2) 「pay :rb_energy_1:」紧随效果首部的 “they may”，按 383.3.b / 404.1.b.1 是触发能力的基础费用（Finalize 支付），而 TriggeredAbility 没有 CostSpec 字段，" +
    "cost.pay 也不是已合入的指令原语（RIFT-89）；写成结算期付款会让“付不出仍 Buff”成立。" +
    "(3) 「[Buff] it」的 it 是事件载荷里被打出的单位：契约 3.6 的 ObjectSelector 只有 self/source/target/pick/linked，没有事件对象选择器；" +
    "effect.buff 的 target 只接受 TargetSpec id，而该单位由效果程序化指定（355.10.d），不能声明为目标（程序里只写占位 id，不声明 targets）。" +
    "(4) 触发侧：card-played 已由 chain/engine.ts 发出，但没有已合入订阅方把卡牌程序的 triggered ability 注册成触发，打出目的地也没有载荷（RIFT-120、RIFT-31/RIFT-33）。" +
    "Buff 本体（702.2.a/702.3.a）与 choice.optional 包装（契约 3.9）已合入，golden 用真实内核执行了拒绝分支与 effect.buff；依赖：事件玩家/事件对象选择器（契约变更请求）、RIFT-89、RIFT-31/RIFT-33/RIFT-120。",
  sourceText:
    "When a player plays a unit here, they may pay :rb_energy_1: to [Buff] it. " +
    "(Give it a +1 :rb_might: buff if it doesn't have one.)",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        // 383.4.a.4：这是“另一个对象被打出”的触发；打出地点用 here 占位（053.3）。
        filter: { event: "card-played", here: true, object: { type: "unit" } }
      },
      // “they may” 在效果首部（383.3.a.3），由 choice.optional 表达（契约 3.9）。
      optional: true,
      body: [
        {
          id: "valley-of-idols.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Pay 1 energy to Buff that unit?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "valley-of-idols.pay",
                  // 383.3.b 的基础费用形态；cost.pay 没有已合入原语，付款人（事件玩家）
                  // 也无法绑定（见 judgeReason 第 1、2 点）。
                  op: "cost.pay",
                  args: { energy: { kind: "constant", value: 1 } }
                },
                {
                  id: "valley-of-idols.buff-played-unit",
                  op: "effect.buff",
                  linkedTo: "valley-of-idols.pay",
                  args: {
                    mode: { kind: "constant", value: "buff" },
                    // “it” 是事件载荷里被打出的单位（355.10.d：程序化指定不是选择
                    // 目标）；此处只写占位 id，不声明 TargetSpec（见 judgeReason 第 3 点）。
                    target: { kind: "constant", value: "valley-of-idols.played-unit" }
                  }
                }
              ]
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;
