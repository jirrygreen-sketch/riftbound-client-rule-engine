import type { CardProgram } from "../../ir/index.js";

/**
 * Guards! (sfd-154-221) — Spell, 3 energy, Order.
 *
 * Printed text:
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)
 *   Play a 2 :rb_might: Sand Soldier unit token. You may pay :rb_rune_order: to ready it.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Hidden] (811) is declared as a keyword ability; its expansion (the Hide
 *   discretionary action, the facedown-zone restrictions and the free play
 *   from the facedown zone) belongs to effects/keywords/Hidden.ts, whose
 *   expansion still records cost.hidden / cost.pay / continuous.timing as
 *   unconsumed (RIFT-89/RIFT-91).
 * - "Play a 2 [M] Sand Soldier unit token" uses the frozen CR 187.3 token
 *   definition (effect.token id "sand-soldier"). A token played by an effect
 *   is created on the Chain and then handed to the play action; the merged
 *   effect.token mode "play" now performs exactly that handoff (440.2.c /
 *   185.2.a / 350.2 / 354; the golden executes it). Because the text gives no
 *   location, the playing player chooses a legal location at Finalize
 *   (355.2.a: their Base or a Battlefield they control); the option set cannot
 *   be enumerated in static IR, so the destinations stay a documented
 *   placeholder that the target / location provider must fill with real
 *   LocationRefs.
 * - "You may pay :rb_rune_order: to ready it" is one optional decision, so it
 *   is written as choice.optional with the chosen instructions inside the
 *   body (contract 3.9), linked to the token instruction: if the token was not
 *   played there is nothing to ready (359.3.e.14).
 *
 * Status: judge-required. The create-token half is executable: the merged
 * effect.token creates the played token on the Chain and hands it to play (the
 * golden executes the card's own argument shape with a concrete location).
 * The card as printed still cannot run:
 * 1. the printed "choose a legal location at Finalize" list has no provider —
 *    no module turns "dynamic:legal-unit-locations" into real LocationRefs, so
 *    the authored argument is refused (negated/impossible) exactly as written;
 * 2. the optional ready needs the payment of one Order rune at resolution, and
 *    no merged instruction primitive pays costs inside a resolving body
 *    (effects/instructions/ has no cost.pay; RIFT-261 owns the cost.pay /
 *    cost.modify batch).
 * The [Hidden] expansion still has no consumer (RIFT-89/RIFT-91). Nothing is
 * approximated by a Board creation or a free ready.
 */
const guards = {
  canonicalCardId: "card.hash-96f6071389124163d72b59b25dca5a642f1cd93402158c5237be9ba305f9dd44",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Play a 2 :rb_might: Sand Soldier unit token」的可执行半段已合入：effect.token 的 mode: \"play\" 现在按 " +
    "440.2.c / 185.2.a / 350.2 / 354 先在链上创建再把返回的 ObjectRef 交给 play 行动（golden 用本卡自己的参数形状、以具体" +
    " LocationRef 驱动该真实路径）。整卡仍不可执行：(1) 印刷的「合法位置在 Finalize 选择」(355.2.a) 没有位置提供方——" +
    "没有任何模块把本卡的 \"dynamic:legal-unit-locations\" 占位符解析为真实 LocationRef，按现状参数被拒绝为 " +
    "negated/impossible；(2)「You may pay :rb_rune_order: to ready it」需要在结算体里支付 1 点 Order 符文，" +
    "而 effects/instructions/ 没有 cost.pay 原语（结算期费用支付与 cost.modify 属 RIFT-261 批次，未合入）。" +
    "[Hidden] 的展开（cost.hidden 的 Hide 行动与背面打出许可）也仍无消费方（RIFT-89/RIFT-91）。" +
    "不近似实现（不用 Board 创建冒充链上 play，也不做免费 ready）。",
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "Play a 2 :rb_might: Sand Soldier unit token. You may pay :rb_rune_order: to ready it.",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    {
      kind: "play",
      body: [
        {
          id: "guards.play-sand-soldier",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "sand-soldier" },
            amount: { kind: "constant", value: 1 },
            // 440.2.c / 185.2.a: a played token is created on the Chain and
            // then played; effect.token's play mode implements that handoff.
            mode: { kind: "constant", value: "play" },
            // 355.2.a legal locations for the played token; the list is
            // runtime data and stays a documented placeholder until the
            // target/location provider supplies real LocationRefs.
            locations: { kind: "constant", value: ["dynamic:legal-unit-locations"] },
            choiceId: { kind: "constant", value: "guards-token-location" },
            linkKey: { kind: "constant", value: "sandSoldier" }
          }
        },
        {
          // "You may pay :rb_rune_order: to ready it" — contract 3.9 shape:
          // one optional decision with the chosen instructions in the body.
          id: "guards.may-ready",
          op: "choice.optional",
          linkedTo: "guards.play-sand-soldier",
          args: {
            prompt: { kind: "constant", value: "Pay :rb_rune_order: to ready the Sand Soldier?" },
            body: {
              kind: "constant",
              value: [
                {
                  // 204.3-style Cost within Instructions: no merged primitive
                  // pays it yet (RIFT-261); the pending op fails closed.
                  id: "guards.pay-order-rune",
                  op: "cost.pay",
                  args: { power: { kind: "constant", value: ["Order"] } }
                },
                {
                  id: "guards.ready-sand-soldier",
                  op: "effect.ready",
                  linkedTo: "guards.pay-order-rune",
                  args: {
                    objects: {
                      kind: "linked-value",
                      instructionId: "guards.play-sand-soldier",
                      key: "sandSoldier.objects"
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

export default guards;
