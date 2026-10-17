import type { CardProgram } from "../../ir/index.js";

/**
 * Ancient Henge (sfd-117-221) — Gear, 2 Energy, 1 printed Body Power, no Might,
 * Body, no tags.
 *
 * sourceText (verbatim from packages/card-data/data/deck-catalog.json sfd-117-221):
 *   ":rb_exhaust:: [Reaction] — Pay any amount of Energy to [Add] that much
 *    :rb_rune_rainbow:. (Abilities that add resources can't be reacted to.)"
 *
 * Rules (CR v1.5):
 * - 377.1/415.5: the :rb_exhaust: before the "—" is the activation cost "Exhaust this".
 *   The merged cost plan supports { kind: "exhaust", object: "self" }.
 * - 813.1.d/813.1.c.2: [Reaction] on an ability is the Closed-State activation
 *   permission; the abstraction is declared as the activated.timing "reaction".
 * - 204.3/204.3.a: "Pay any amount of Energy to [Add] that much [A]" is a Cost within
 *   an Instruction; CR v1.5 204.3 quotes this exact card as the example. The amount is
 *   chosen as the ability resolves and the Add amount equals the amount actually paid.
 * - 430.1/430.5: [Add] puts Energy/Power into the Rune Pool; [A] is Universal Power
 *   (135.2.e.5/163.2.b).
 *
 * 当前复核：保持 judge-required；具体未接通路径见 judgeReason。
 */
export default {
  canonicalCardId: "card.hash-d07e48aa4c135d7523968d576a0ed10afd4b5574804fc3baa31b2d60b20f46a3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "CR 204.3/204.3.a 的 “Pay any amount of Energy” 在 Resolve 时选择并支付：已注册原语表（effects/instructions/registry.generated.ts）里没有 cost.pay-any，" +
    "现有 cost.pay 只接受已锁定的 Finalize 计划（payments 形式的数组也不是它的可支付计划形状），没有「任意金额询问 + 成功作用域 + 实付量链接」这条路径，故本卡首条指令无法执行。" +
    "[A] Universal Power（135.2.e.5/163.2.b）缺独立资源表示：effect.resources 只接受已关闭的 Domain 集合，rainbow 会被判为 impossible，绝不用某个有色域近似。" +
    "programs/activate.ts 把本能力描述为 activated 链项（kind: \"activated\"），而 430.2/430.2.a 要求 add 能力立即结算且在支付期间不可被响应；没有消费者按 add 处理该 draft。",
  abilities: [
    {
      kind: "activated",
      // 813.1.c.2 / 813.1.d: [Reaction] ability = Closed-State activation
      // permission, declared directly on the ability.
      timing: "reaction",
      cost: {
        kind: "activated",
        // 404.1.a / 415.5: :rb_exhaust: before the dash is "Exhaust this".
        payments: [{ kind: "exhaust", object: "self" }]
      },
      body: [
        {
          id: "ancient-henge.pay-any-energy",
          // "Pay any amount of Energy" — a resolve-time Cost within an Instruction
          // (204.3/204.3.a). The amount must be chosen at resolution and reported
          // for the Add below; no merged primitive does that (see judgeReason 1).
          op: "cost.pay-any",
          args: {
            resource: { kind: "constant", value: "energy" },
            amount: { kind: "constant", value: "any" },
            linkKey: { kind: "constant", value: "paid" },
            prompt: { kind: "constant", value: "Pay any amount of Energy?" }
          }
        },
        {
          id: "ancient-henge.add-that-much",
          // "... to [Add] that much [A]": the Add amount equals the amount
          // actually paid (204.3.a), so the repeat count reads the payment's
          // linked result. [A] has no executable value (see judgeReason 2).
          op: "repeat",
          linkedTo: "ancient-henge.pay-any-energy",
          args: {
            count: {
              kind: "linked-value",
              instructionId: "ancient-henge.pay-any-energy",
              key: "paid"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "ancient-henge.add-one-universal-power",
                  op: "effect.resources",
                  args: {
                    // Descriptive Universal Power marker; the merged primitive
                    // answers negated(impossible) rather than guessing a domain.
                    power: { kind: "constant", value: ["rainbow"] }
                  }
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    ":rb_exhaust:: [Reaction] — Pay any amount of Energy to [Add] that much :rb_rune_rainbow:. " +
    "(Abilities that add resources can't be reacted to.)"
} satisfies CardProgram;
