import type { CardProgram } from "../../ir/index.js";

/**
 * Sprite Mother (ogn-106-298) — Unit, 4 energy + 1 Power, 3 Might, Mind, Fae.
 *
 * Printed text:
 *   When you play me, play a ready 3 :rb_might: Sprite unit token with
 *   [Temporary] here. (Kill it at the start of its controller's Beginning
 *   Phase, before scoring.)
 *
 * Status: judge-required (re-checked 2026-10-17; every gap is measured).
 * The trigger (card-played, 383.4.a) and the body are described as data, but the
 * printed token play has no complete execution path:
 * - 187.2 defines the printed Sprite token with Temporary, while the frozen
 *   effect.token definitions do not provide that ability-bearing token: the
 *   primitive negates with blockedReason
 *   "token-definition-or-abilities-judge-required".
 * - "play a … token" (440.2.c / 185.2.a / 350.2 / 354) needs Chain creation
 *   followed by the play handoff, and "ready" is an entry-state override
 *   (143.4 / 185.2.d); the primitive's argument list rejects any entry-state
 *   argument ("Invalid effect.token argument"), and its "location" argument
 *   accepts only an evaluated LocationRef (an object-property expression is
 *   rejected as well), so "here" is bound through condition.value first
 *   (the merged faithful-manufactor pattern).
 * - the Temporary KeywordDef expands the printed trigger, but it does not
 *   supply the Sprite token definition or its entry state; the expansion's
 *   beginning-start trigger is additionally outside the closed trigger event
 *   vocabulary.
 * Nothing is approximated; the intended shape stays visible for review.
 */
export default {
  canonicalCardId: "card.hash-26cfa8163b875ae8bd95af44a7541e83fd82ea28a881b705af27b209ad3167b0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "复核 2026-10-17（缺口均实测，均不近似实现）：(1) 187.2 的 3 Might Sprite token 携带 " +
    "[Temporary]，而 effect.token 的冻结定义表不含这个带能力的 token——同名定义以 blockedReason " +
    "「token-definition-or-abilities-judge-required」negated。(2)「play a ... token」需要 create-token 的 " +
    "chain 创建 + play 交接（440.2.c / 185.2.a / 350.2 / 354），本卡继承 merged 的 mode: play 形状；" +
    "但「ready」是入场状态改写（143.4 / 185.2.d），原语参数表直接拒绝入场状态参数" +
    "（实测 Invalid effect.token argument），事后 effect.ready 会凭空多出原文没有的动作；" +
    "「here」由 condition.value 先读取来源位置（与已合入的 ogn/faithful-manufactor 同一写法）再交给 " +
    "location，因为原语只接受已求值的 LocationRef。(3) [Temporary] 的 KeywordDef 已合入，" +
    "但既不提供 Sprite token 定义与入场状态，其 beginning-start 触发也仍被封闭事件词表拒绝。" +
    "依赖：sprite token 定义、入场状态改写与新时点的触发接线。不近似实现。",
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
          // "here": the ability source's current location, read at resolution.
          // The merged ogn/faithful-manufactor uses this two-step form because
          // effect.token only accepts an already-evaluated LocationRef (an
          // object-property expression is rejected by the primitive's own
          // argument schema).
          id: "sprite-mother.read-here",
          op: "condition.value",
          args: {
            value: { kind: "object-property", object: "source", property: "location" },
            key: { kind: "constant", value: "here" }
          }
        },
        {
          id: "sprite-mother.play-sprite",
          op: "effect.token",
          linkedTo: "sprite-mother.read-here",
          args: {
            token: { kind: "constant", value: "sprite" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: {
              kind: "linked-value",
              instructionId: "sprite-mother.read-here",
              key: "here"
            },
            linkKey: { kind: "constant", value: "sprite" }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you play me, play a ready 3 :rb_might: Sprite unit token with [Temporary] here. (Kill it at the start of its controller's Beginning Phase, before scoring.)"
} satisfies CardProgram;
