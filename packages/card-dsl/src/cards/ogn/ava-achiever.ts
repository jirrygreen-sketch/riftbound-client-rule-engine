import type { CardProgram } from "../../ir/index.js";

/**
 * Ava Achiever (ogn-107-298) — Unit, 5 energy, Mind, Yordle, Might 4。
 *
 * 原文：When I attack, you may pay :rb_rune_mind: to play a card with [Hidden]
 * from your hand here, ignoring its cost.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.e：攻击触发（Attack Trigger），单位取得 Attacker 身份时触发；
 *   383.4.e.2.a 要求每次战斗只检查一次触发条件 → once: "per-combat"。
 * - 355.7 / 355.10.a 例："You may play a unit from your hand, ignoring its costs"
 *   不指定目标（手牌是私有区域）→ 用 picks（非目标选择）。
 * - 356.1.b.1："ignoring its cost" 把该牌的 base Energy cost 与 base Power
 *   cost 都设为 0；356.1.b.3 说明其后的附加费用仍可能把总费用抬高。
 * - 359.3.f："here" 指本能力来源的位置（object-property source.location）。
 * - 383.3.a/383.3.b：效果开头的 "you may … to …" 是可选的执行决定；按契约
 *   §3.9 用 choice.optional 把被选择的指令包进 body，而不是 choice + linkedTo。
 *
 * 状态：judge-required。攻击触发本体、choice.optional 拒绝路径与 effect.play 的
 * 零费用计划都由 golden 经链式适配器真实执行；仍缺：
 * - "play a card with [Hidden] from your hand" 的选择绑定：候选来自 filter
 *   （手牌 + [Hidden]），但冻结的 PickSpec / `ctx.picks` 只读取运行时已提供的
 *   options，Finalize / 选择管线还没有把 filter 查询绑定成 picks（RIFT-8x
 *   target/pick）；不能让卡牌程序自带 fixture 候选。
 * - "ignoring its cost" 的支付与 Finalize 计划：费用改写需要卡面费用指令
 *   （cost.printed / cost.pay，RIFT-261 未合入本工作树），effect.play 只接受
 *   已经 Finalize 的计划；卡牌程序不得自行推导打印费用。
 * - attack-declared 触发进链与自我范围拼写：宣告事务仍被 combat-start-transaction
 *   阻断（CR 466.2），并依赖 RIFT-257 的 CardProgram 触发绑定。
 *
 * 依赖：RIFT-261、RIFT-8x（Finalize / pick 选择管线）、RIFT-257。
 */
const avaAchiever = {
  canonicalCardId: "card.hash-2c1a169269b0950e25c0db04cc22a192284b006d0d720477f488d2f0ddef6e3b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「play a card with [Hidden] from your hand」的选择无法结算：冻结的 PickSpec / ctx.picks 只读取运行时提供的 options，" +
    "Finalize / 选择管线尚未把 { zone: hand, Hidden } 的 filter 查询绑定成 picks（RIFT-8x）；" +
    "「ignoring its cost」需要按 CR v1.5 356.1.b.1 生成 energy/power 置 0 的 finalized cost plan，" +
    "卡面费用指令 cost.printed / cost.pay 未合入（RIFT-261），effect.play 只接受已 Finalize 的计划，不近似实现；" +
    "attack-declared 触发还依赖战斗宣告事务（CR 466.2）与 RIFT-257 的 CardProgram 触发绑定。" +
    "choice.optional 的拒绝路径与零费用计划下的 effect.play 已由 golden 经链式适配器真实执行（play 的 location 由调用方按来源当前位置提供）。" +
    "依赖：RIFT-261、RIFT-8x（Finalize/pick 选择管线）、RIFT-257。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "attack-declared",
        filter: { event: "attack-declared", filter: { source: "self" } },
        once: "per-combat"
      },
      optional: false,
      body: [
        {
          id: "ava.opt-in",
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Pay :rb_rune_mind: to play a card with [Hidden] from your hand here?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "ava.pay",
                  op: "cost.pay",
                  args: { power: { kind: "constant", value: ["Mind"] } }
                },
                {
                  id: "ava.play-hidden",
                  op: "effect.play",
                  linkedTo: "ava.pay",
                  args: {
                    // "from your hand"：非目标选择（355.7）。候选由 Finalize /
                    // 选择管线按 pick 的 filter 提供，而不是静态 IR 里的固定对象。
                    pick: { kind: "constant", value: "ava.hidden-card" },
                    // 356.1.b.1：ignoring its cost → base Energy/Power 皆为 0 的
                    // finalized 计划由费用管线生成（卡面费用指令仍缺 RIFT-261）。这里的
                    // 0/[] 是“忽略费用”的结果，不是这张牌的印刷费用；被忽略的牌的印刷
                    // 费用仍保持无印刷值/印刷值原样，绝不在此改写为 0。
                    cost: { kind: "constant", value: { finalized: true, energy: 0, power: [] } },
                    // "here"（359.3.f）：打出到本能力来源当前所在位置。
                    location: { kind: "object-property", object: "source", property: "location" }
                  },
                  picks: [
                    {
                      id: "ava.hidden-card",
                      options: ["card-with-hidden-in-controller-hand"],
                      filter: { zone: "hand", owner: "controller", keyword: "hidden" },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "When I attack, you may pay :rb_rune_mind: to play a card with [Hidden] from your hand here, ignoring its cost."
} satisfies CardProgram;

export default avaAchiever;
