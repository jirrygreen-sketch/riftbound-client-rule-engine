import type { CardProgram } from "../../ir/index.js";

/**
 * Emperor's Dais (sfd-207-221) — Battlefield, SFD.
 *
 * "When you conquer here, you may pay :rb_energy_1: and return a unit you
 *  control here to its owner's hand. If you do, play a 2 :rb_might: Sand
 *  Soldier unit token here."
 *
 * Rules anchors (Core Rules v1.5):
 * - "When you conquer here" is a Conquer Effect controlled by the
 *   battlefield's controller (190.6.a/190.6.d), triggered at the `conquer`
 *   timing point (383.4.c, 470.3, 471.1, 473.2.a; contract 3.5). "you" in a
 *   battlefield ability is its controller (190.6.d), which the engine's
 *   PlayerSelector spells `self` (events/trigger-spec.ts).
 * - "you may pay [1 energy] and return a unit you control here" — "unit you
 *   control here" is chosen, so it is a target (355.7, 355.9.a.1: "unit"
 *   means a Board object; 355.10). The return-to-hand is the frozen
 *   `return-to-hand` action (effect.zone to "hand" routes to the owner).
 * - "If you do, play a … token" depends on the payment/return actually having
 *   been performed (204.3.a, 205: later instructions check whether the game
 *   action happened, not whether a cost was paid), hence the linkedTo chain.
 * - Sand Soldier is the CR 187.3 token (2 Might, Shurima); playing a new token
 *   creates it on the Chain and hands it to the play flow (440.2.c, 185.2.a,
 *   350.2, 354), which is exactly effect.token's "play" mode.
 * - 383.3.b is an open semantic question this program cannot settle: a cost
 *   within instructions immediately following "you may" at the start of a
 *   triggered ability is treated as the ability's base cost (paid while
 *   finalizing), but the frozen `TriggeredAbility` shape has no cost slot.
 *
 * Status rationale (contract 3.1): the trigger, the optional wrapper, the
 * unit target, the return-to-hand zone move and the Sand Soldier token are
 * each expressible, but the 1-energy payment is NOT: no cost.pay instruction
 * primitive is merged (RIFT-89 owns cost.*), so the "If you do" receipt and
 * the 383.3.b base-cost treatment cannot be evaluated. Nothing is
 * approximated and no state is edited outside the primitives.
 */
export default {
  canonicalCardId: "card.hash-0049ad19b30eb5fd30b02674e302272e9df4b060fbe5a8e672fb9f5bb9c5e417",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 cost.pay 指令原语：1 能量支付（204.3.a/205；RIFT-89 cost.* 未合入）无法执行，'If you do' 的支付回执也因此不可求值，后续 Sand Soldier token 的 gating 不可执行；" +
    "另 383.3.b 规定紧跟 'you may' 的费用应作为触发式能力的基础费用在 Finalize 支付，但契约 3.1 的 TriggeredAbility 无 cost 槽位、Finalize 收取管线也未接通；" +
    "trigger/conquer、可选包装、unit target 与 effect.zone/effect.token 已按现契约编码，不近似支付。",
  sourceText:
    "When you conquer here, you may pay :rb_energy_1: and return a unit you control here to its owner's hand. If you do, play a 2 :rb_might: Sand Soldier unit token here.",
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
          id: "emperors-dais.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Pay 1 energy and return a unit you control here?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "emperors-dais.pay",
                  op: "cost.pay",
                  args: { energy: { kind: "constant", value: 1 }, power: { kind: "constant", value: [] } }
                },
                {
                  id: "emperors-dais.return-unit",
                  op: "effect.zone",
                  linkedTo: "emperors-dais.pay",
                  args: {
                    target: { kind: "constant", value: "emperors-dais.unit-here" },
                    to: { kind: "constant", value: "hand" }
                  },
                  targets: [
                    {
                      id: "emperors-dais.unit-here",
                      filter: {
                        type: "unit",
                        controller: "self",
                        sameLocationAs: "source"
                      },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                },
                {
                  id: "emperors-dais.sand-soldier",
                  op: "effect.token",
                  linkedTo: "emperors-dais.pay",
                  args: {
                    token: { kind: "constant", value: "sand-soldier" },
                    amount: { kind: "constant", value: 1 },
                    mode: { kind: "constant", value: "play" },
                    location: {
                      kind: "object-property",
                      object: "source",
                      property: "location"
                    },
                    linkKey: { kind: "constant", value: "sandSoldier" }
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
