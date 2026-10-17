import type { CardProgram } from "../../ir/index.js";

/**
 * Hall of Legends (sfd-210-221) — Battlefield, SFD.
 *
 * "When you conquer here, you may pay :rb_energy_1: to ready your legend."
 *
 * Rules anchors (Core Rules v1.5):
 * - "When you conquer here" is a Conquer Effect of the battlefield's
 *   controller (190.6.a/190.6.d, 383.4.c, 471.1, 473.2.a); the closed conquer
 *   timing point is emitted by the merged scoring wave (turn/flow.ts, with the
 *   battlefieldId detail).
 * - "you may pay [1 energy]" is a cost within an instruction paid at
 *   resolution (204.3 / 204.3.a, 205); the merged cost.pay primitive pays it
 *   through its `payments` record. 383.3.b's base-cost question (the paid
 *   clause directly follows a leading "you may") has no TriggeredAbility cost
 *   slot in contract 3.1 and no Finalize-time collection consumer
 *   (programs/triggers.ts does not lift a leading optional payment into
 *   TriggerRegistration.cost / mayAtFinalize), so the payment still happens on
 *   resolution exactly as the printed text reads it here.
 * - "your legend" does NOT target: 355.10.g makes a legend "you" control an
 *   exception to targeting ("Ready your legend" is the rulebook's own
 *   example). The legend is chosen at resolution, so it is a non-target
 *   selection inside effect.ready's choose descriptor, not a TargetSpec. The
 *   golden executes that choose selection through the production adapter.
 * - Ready is the 416.1 action; a legend is a game object that can be readied
 *   (174.6-174.8, 415.3.a), and 416.1.b/416.1.c make readying an already-ready
 *   object a no-op.
 *
 * Status rationale (cards/README.md section 2): judge-required. The effect is
 * fully executable and the golden drives it end to end through the production
 * chain adapter: the 1 Energy payment through cost.pay, the resolution-time
 * "your legend" choose inside effect.ready, the pay/decline branches and the
 * already-ready no-op. What still blocks the whole card is the trigger: the
 * closed EventPattern vocabulary has no battlefield-relative "here" anchor for
 * conquer. events/trigger-spec.ts rejects the extra field
 * ("EventPattern does not allow this field"), and programs/filters.ts's
 * translateTriggerFilter throws "Unsupported filter field here" while
 * turn/flow.ts publishes the identity only as details.battlefieldId. Nothing is
 * approximated by free readying, a fabricated payment, or a widened trigger.
 */
export default {
  canonicalCardId: "card.hash-e4adbb3b6a16047a000e20a54481f947239754cc236a48b06ad0cebcbfd7ed57",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "唯一剩余缺口是 conquer 触发的 \"here\" 锚点：events/trigger-spec.ts 的封闭 EventPattern 词表没有" +
    "战场相对锚点（额外字段直接以 unknown-field 拒绝），programs/filters.ts 的 translateTriggerFilter 也抛" +
    " \"Unsupported filter field here\"；turn/flow.ts 的计分 wave 只把身份放在 details.battlefieldId，" +
    "没有任何已合入路径把它接成过滤器，本卡因此无法锚定到自己所在的战场（383.4.c / 473.2.a）。" +
    "效果本身已可真实执行：choice.optional 与结算期 1 能量支付走已合入的 cost.pay payments 记录（204.3 / 204.3.a），" +
    "effect.ready 的非目标 choose 形状选择本卡控制者的 legend（355.10.g），golden 经 chain/interpreter-adapter.ts " +
    "的生产适配器执行支付+就绪、declined 与已就绪无操作（416.1.c）三个分支，并实测不可支付时抛 " +
    "CostPlanError(cannot-pay-cost) 而非免费就绪。383.3.b 的 Finalize 基础费用槽位仍不存在于契约 3.1 的" +
    " TriggeredAbility，programs/triggers.ts 也未把前导可选支付提升为 TriggerRegistration.cost/mayAtFinalize。" +
    "依赖：conquer 触发的 battlefield \"here\" 锚点载荷与其过滤器翻译。不近似实现（不做免费 ready，也不伪造支付）。",
  sourceText: "When you conquer here, you may pay :rb_energy_1: to ready your legend.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: { event: "conquer", here: true, player: "self" }
      },
      optional: true,
      body: [
        {
          id: "hall-of-legends.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Pay 1 energy to ready your legend?" },
            body: {
              kind: "constant",
              value: [
                {
                  // 204.3 / 204.3.a: the printed payment inside the resolving
                  // body, paid by the merged cost.pay `payments` record (1
                  // Energy). A failed payment throws CostPlanError and never
                  // becomes a free ready.
                  id: "hall-of-legends.pay",
                  op: "cost.pay",
                  args: {
                    payments: { kind: "constant", value: { energy: 1 } }
                  }
                },
                {
                  id: "hall-of-legends.ready",
                  op: "effect.ready",
                  linkedTo: "hall-of-legends.pay",
                  args: {
                    objects: {
                      kind: "constant",
                      value: {
                        kind: "choose",
                        id: "hall-of-legends.legend",
                        filter: { type: "legend", controller: "self" },
                        min: 1,
                        max: 1
                      }
                    }
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
