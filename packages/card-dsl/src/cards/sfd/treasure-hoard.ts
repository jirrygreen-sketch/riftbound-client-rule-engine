import type { CardProgram } from "../../ir/index.js";

/**
 * Treasure Hoard (sfd-220-221) — Battlefield, Rumble precon.
 *
 * "When you conquer here, you may pay {1 energy} to play a Gold gear token
 *  exhausted."
 *
 * Status: executable after re-checking the merged production path on
 * 2026-10-23. Default Match setup creates the selected Battlefield on the Board
 * at its own Location (CR v1.5 133.6.a.1 / 199.1), and ProgramBinding attaches
 * the trigger to that exact Board incarnation. A real Conquer makes the leading
 * "you may" choice and pays its one Energy during Finalize (383.3.a / 405.1).
 * Resolve then Creates a canonical Gold on the Chain and Plays it; the token's
 * stipulated exhausted entry survives the Gear Play (184.1 / 185.2.a / 185.2.d)
 * and it enters its controller's Base. Gold's canonical 187.5 Reaction is then
 * available through the same production ProgramBinding.
 */
export default {
  canonicalCardId: "card.hash-77763eae5320de558954776a37677e8638b6d4af73399e5a7c4f5d5321a2b564",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText: "When you conquer here, you may pay :rb_energy_1: to play a Gold gear token exhausted.",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "conquer", filter: { event: "conquer", here: true, player: "controller" } },
      optional: true,
      body: [
        {
          id: "treasure-hoard.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Pay 1 energy to play a Gold gear token exhausted?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "treasure-hoard.pay",
                  op: "cost.pay",
                  args: { payments: { kind: "constant", value: { energy: 1 } } }
                },
                {
                  id: "treasure-hoard.create",
                  op: "effect.token",
                  linkedTo: "treasure-hoard.pay",
                  args: {
                    token: { kind: "constant", value: "gold" },
                    // 印刷的 "play a … token"：effect.token mode "play" 在链上创建
                    // 新 token（440.2.c / 185.2.a / 350.2 / 354），再交给打出流程。
                    mode: { kind: "constant", value: "play" },
                    amount: { kind: "constant", value: 1 },
                    linkKey: { kind: "constant", value: "goldToken" },
                    // CR 184.1 / 185.2.d：印刷的 exhausted 是 token 入场状态，
                    // 由 effect.token 写入 runtime TokenSpec，不能追加事后 Exhaust。
                    entersExhausted: { kind: "constant", value: true },
                    // Non-Unit Gear normally enters at its controller's Base
                    // (359.2.d). The controller-relative selector resolves
                    // through the production location adapter.
                    location: {
                      kind: "location",
                      value: "ability-controller-base"
                    }
                  }
                },
              ]
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;
