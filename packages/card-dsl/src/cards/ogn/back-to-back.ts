import type { CardProgram } from "../../ir/index.js";

/**
 * Back to Back — ogn-206-298 (Spell, Order, 3 Energy, no Power).
 *
 * Printed text (packages/card-data/data/deck-catalog.json, ogn-206-298):
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Give two friendly units each +2 :rb_might: this turn.
 *
 * Modeling notes (Core Rules v1.5):
 * - "[Reaction]" (813) is a permissive keyword expanded by the keyword
 *   registry (effects/keywords/Reaction.ts) into a continuous.timing static
 *   ability; the card only names it.
 * - "two friendly units" is one target group of exactly two units (355.9.b
 *   "unit you control"). The printed count is fixed, so the TargetSpec pins
 *   min: 2 / max: 2; it is not "up to" (355.13 would allow zero). Finalize
 *   rejects the card when fewer than two friendly units are available.
 * - "each +2 :rb_might: this turn" is a temporary Might modification that
 *   expires in the end-of-turn cleanup (317.2.c "3d. All 'this turn' effects
 *   expire simultaneously."; 433.1.a layer modulation). That effect belongs
 *   to the layers system: effect.buff's own header states that temporary
 *   Might changes "belong to continuous.might, never to this primitive", and
 *   no registered instruction turns a card instruction into
 *   ctx.addContinuous with a continuous.might effect. The layers engine
 *   (RIFT-91, merged) is the consumer; the card-facing instruction op is
 *   still missing, so the printed amount is recorded on the pending
 *   `continuous.might` op instead of being approximated with Buff counters
 *   (703: Buffs are counters, not a Might modification).
 *
 * Status: judge-required for the Might half. Identity, keywords, the fixed
 * two-unit target group and the target group bounds are covered by the golden
 * test; the merged target system enforces the 2/2 bounds.
 */
const backToBack = {
  canonicalCardId: "card.hash-da1c2e22f4362a3f4d0eaa86e904a11354020a28a999ebe7cd71d8e76da691d7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺临时 Might 修正的指令原语：CR 317.2.c / 433.1.a 的「this turn +2 Might」属于 layers 的" +
    "continuous.might（本回合到期），effect.buff 明确临时 Might 不入 Buff 计数器（CR 703）；" +
    "RIFT-91 已合入 layers 引擎（addContinuous / Duration / 到期时点），但 effects/instructions 里" +
    "没有任何已注册 op 把卡指令转成带 end-of-turn 期限的持续效果调用（层引擎缺『卡牌侧入口』这一原语）。" +
    "依赖：M1 原语清单里的 continuous.might 指令（与 RIFT-91 的层引擎对接）。" +
    "不近似实现（不改写成 Buff、不固定伤害）。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 3 }
      },
      body: [
        {
          // "Give two friendly units each +2 Might this turn" — the pending
          // layers instruction (continuous.might with an end-of-turn duration
          // and the 317.2.c expiry). No registered primitive consumes it yet
          // (see judgeReason).
          id: "back-to-back.grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "literal", value: 2 },
            duration: { kind: "literal", value: "this-turn" }
          },
          targets: [
            {
              id: "back-to-back.units",
              filter: { types: "unit", controller: "controller" },
              min: 2,
              max: 2,
              selection: "any"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Give two friendly units each +2 :rb_might: this turn."
} satisfies CardProgram;

export default backToBack;
