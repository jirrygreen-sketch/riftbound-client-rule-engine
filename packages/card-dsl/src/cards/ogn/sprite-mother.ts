import type { CardProgram } from "../../ir/index.js";

/**
 * Sprite Mother (ogn-106-298) — Unit, 4 energy + 1 Power, 3 Might, Mind, Fae.
 *
 * Printed text:
 *   When you play me, play a ready 3 :rb_might: Sprite unit token with
 *   [Temporary] here. (Kill it at the start of its controller's Beginning
 *   Phase, before scoring.)
 *
 * Status: judge-required. The trigger (card-played, 383.4.a) and the body are
 * described as data, but the printed token play has no merged execution path:
 * - 187.2 defines the printed "3 [M] Sprite token with Temporary" as a
 *   domainless unit token with 3 Might, the Fae tag and the Temporary keyword.
 *   effect.token's frozen definition table holds only recruit / sand-soldier /
 *   mech / reflection / tentacle; the comment above it says definitions
 *   "requiring other abilities, including Gold, remain blocked/judge-required",
 *   and a token carrying [Temporary] (816) is exactly such an ability-bearing
 *   token, so `token: "sprite"` would be negated with
 *   blockedReason "token-definition-or-abilities-judge-required";
 * - "play a … token" (440.2.c / 185.2.a / 350.2 / 354) requires creating the
 *   token on the Chain and handing it to the play flow (create-token to "chain"),
 *   plus a finalized cost plan for the free play (185.3); mode "play" is
 *   documented as blocked in merged code;
 * - "ready" is an entry-state override (143.4 / 185.2.d) that the frozen
 *   create-token action explicitly does not support ("Entry overrides are not
 *   supported"), and "here" would come from the event/source location.
 * - [Temporary] (816.1.b) itself is an unmerged KeywordDef (no
 *   effects/keywords/Temporary.ts), so even the token's own trigger is absent.
 * Nothing is approximated; the intended shape stays visible for review.
 */
export default {
  canonicalCardId: "card.hash-26cfa8163b875ae8bd95af44a7541e83fd82ea28a881b705af27b209ad3167b0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「play a ready 3 [M] Sprite unit token with [Temporary] here」缺原语支持：187.2 的 Sprite token 携带 [Temporary] 关键词，" +
    "而 effect.token 的定义表只有 recruit/sand-soldier/mech/reflection/tentacle，带能力的 token 定义被显式阻断" +
    "（blockedReason: token-definition-or-abilities-judge-required）；打出新 token 需要 create-token 的 " +
    "to \"chain\" + play 交接（440.2.c / 185.2.a / 350.2 / 354），且「ready」是入场状态改写（143.4 / 185.2.d），冻结的 create-token 动作明确不支持入场改写；" +
    "[Temporary]（816）也没有已合入的 KeywordDef。依赖：RIFT-62 之后的链上 token / 入场改写与关键词批次。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          id: "sprite-mother.play-sprite",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "sprite" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: {
              kind: "object-property",
              object: "source",
              property: "location"
            },
            entersReady: { kind: "constant", value: true },
            linkKey: { kind: "constant", value: "sprite" }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you play me, play a ready 3 :rb_might: Sprite unit token with [Temporary] here. (Kill it at the start of its controller's Beginning Phase, before scoring.)"
} satisfies CardProgram;
