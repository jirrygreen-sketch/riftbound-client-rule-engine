import type { CardProgram } from "../../ir/index.js";

/**
 * Hall of Legends (sfd-210-221) — Battlefield, SFD.
 *
 * "When you conquer here, you may pay :rb_energy_1: to ready your legend."
 *
 * Rules anchors (Core Rules v1.5):
 * - "When you conquer here" is a Conquer Effect of the battlefield's
 *   controller (190.6.a/190.6.d, 383.4.c, 471.1, 473.2.a); the engine spells
 *   the controller as PlayerSelector `self` (events/trigger-spec.ts).
 * - "you may pay [1 energy]" is a cost within an instruction paid at
 *   resolution (204.3.a, 205); the 383.3.b question (base cost when the paid
 *   clause directly follows "you may" at the start of the effect) applies
 *   here too and has no TriggeredAbility cost slot.
 * - "your legend" does NOT target: 355.10.g makes a legend "you" control an
 *   exception to targeting ("Ready your legend" is the rulebook's own
 *   example). The legend is chosen at resolution, so it is a non-target
 *   selection inside effect.ready's choose descriptor, not a TargetSpec.
 * - Ready is the 416.1 action; a legend is a game object that can be readied
 *   (174.6-174.8, 415.3.a), and 416.1.b/416.1.c make readying an already-ready
 *   object a no-op.
 *
 * Status rationale (contract 3.1): the conquer trigger, the optional wrapper
 * and the effect.ready primitive are merged, but the 1-energy payment is not
 * — no cost.pay instruction primitive exists (RIFT-89 owns cost.*). The card
 * therefore stays judge-required; the structure below records the full shape
 * (optional → pay → ready the chosen legend) and no substitute payment or
 * direct state change is written into the card.
 */
export default {
  canonicalCardId: "card.hash-e4adbb3b6a16047a000e20a54481f947239754cc236a48b06ad0cebcbfd7ed57",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 cost.pay 指令原语（1 能量支付，204.3.a/205；RIFT-89 cost.* 未合入），'you may pay :rb_energy_1: to ready your legend' 的支付无法真实执行，整条可选结算链不能标记 executable；" +
    "另 383.3.b 的触发式能力基础费用处理（紧跟 'you may' 的费用）在契约 3.1 的 TriggeredAbility 无 cost 槽位、Finalize 收费管线未接通；" +
    "trigger/conquer 与 effect.ready 的非目标 choose 形状（355.10.g）已按现契约编码，不近似支付。",
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
                  id: "hall-of-legends.pay",
                  op: "cost.pay",
                  args: { energy: { kind: "constant", value: 1 }, power: { kind: "constant", value: [] } }
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
