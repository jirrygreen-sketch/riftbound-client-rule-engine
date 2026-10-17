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
 * 状态：judge-required。cost.pay 与 effect.play 的子效果可以执行，仍缺：
 * - 战斗开启/攻防身份事务发射真实 attack-declared（466.2 / 383.4.e.2）。
 * - 在结算时把手牌 Hidden 的 filter 变成非目标选项；zoneSlice/linked 来源不做筛选。
 * - 从所选牌生成 ignore-base 后仍含附加费用/加费的 finalized cost plan
 *   （356.1.b.1 / 356.1.b.3）。现有零费用常量为占位，不是通用费用计划。
 * golden 不把预绑定 picks 和无加费样例当成整卡执行证据。
 */
const avaAchiever = {
  canonicalCardId: "card.hash-2c1a169269b0950e25c0db04cc22a192284b006d0d720477f488d2f0ddef6e3b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺三处接线：（1）attack-declared 真实发射仍被 combat-start-transaction 阻断（CR 466.2/383.4.e.2）；（2）chain/picks 虽支持 zoneSlice/linked 来源，仍不把手牌 Hidden 的 PickSpec.filter 转成结算时非目标选择；（3）cost.pay/cost.modify 未将所选牌的印刷费用、ignore-base、附加费用与加费组成 finalized cost plan 再交给 effect.play（CR 356.1.b.1/356.1.b.3）。现有 IR 的硬编码零费用计划仅为占位，不能忽略仍需支付的附加费用或加费。",
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
                  args: {
                    payments: {
                      kind: "constant",
                      value: { energy: 0, power: ["Mind"] }
                    }
                  }
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
                    // finalized 计划由费用管线生成。这里的
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
