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
 * described as data, but the printed token play has no complete execution path:
 * - 187.2 defines the printed Sprite token with Temporary, while the frozen
 *   effect.token definitions do not provide that ability-bearing token;
 * - "play a … token" (440.2.c / 185.2.a / 350.2 / 354) needs Chain creation
 *   followed by the play handoff, and "ready" is an entry-state override
 *   (143.4 / 185.2.d) that the creation action does not support;
 * - the Temporary KeywordDef expands the printed trigger, but it does not
 *   supply the Sprite token definition or its entry state.
 * Nothing is approximated; the intended shape stays visible for review.
 */
export default {
  canonicalCardId: "card.hash-26cfa8163b875ae8bd95af44a7541e83fd82ea28a881b705af27b209ad3167b0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「play a ready 3 [M] Sprite unit token with [Temporary] here」缺原语支持：187.2 的 Sprite token 携带 [Temporary] 关键词，" +
    "而 effect.token 的冻结定义表没有这个带能力的 token 定义；打出新 token 需要 create-token 的 " +
    "to \"chain\" + play 交接（440.2.c / 185.2.a / 350.2 / 354），且「ready」是入场状态改写（143.4 / 185.2.d），" +
    "冻结的 create-token 动作明确不支持入场改写；[Temporary] 的 KeywordDef 已合入，但只展开已印在宿主上的 816.1.b 触发，" +
    "不提供 Sprite token 定义与入场状态。依赖：token 定义表扩充与入场改写。不近似实现。",
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
