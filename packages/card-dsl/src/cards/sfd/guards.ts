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
 *   from the facedown zone) belongs to effects/keywords/Hidden.ts, which
 *   records cost.hidden / cost.pay / continuous.timing as not yet merged.
 * - "Play a 2 [M] Sand Soldier unit token" uses the frozen CR 187.3 token
 *   definition (effect.token id "sand-soldier"). A token played by an effect
 *   is created on the Chain and then handed to the play action (440.2.c /
 *   185.2.a / 350.2 / 354). Because the text gives no location, the playing
 *   player chooses a legal location at Finalize (355.2.a: their Base or a
 *   Battlefield they control); the option set cannot be enumerated in static
 *   IR, so the destinations stay a documented placeholder that the target /
 *   location provider must fill with real LocationRefs.
 * - "You may pay :rb_rune_order: to ready it" is one optional decision, so it
 *   is written as choice.optional with the chosen instructions inside the
 *   body (contract 3.9), linked to the token instruction: if the token was not
 *   played there is nothing to ready (359.3.e.14).
 *
 * Status: judge-required. The token half is not executable with merged
 * primitives (the frozen create-token action only creates on the Board, so
 * effect.token negates mode "play" with blockedReason
 * token-play-requires-chain-creation), and the optional half needs cost.pay
 * to pay one Order rune before effect.ready may run. Neither half is
 * approximated by a Board creation or a free ready.
 */
const guards = {
  canonicalCardId: "card.hash-96f6071389124163d72b59b25dca5a642f1cd93402158c5237be9ba305f9dd44",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Play a 2 :rb_might: Sand Soldier unit token」需要 CR v1.5 440.2.c / 185.2.a / 350.2 / 354 的链上创建 + play 接手路径；" +
    "封闭 GameAction create-token 只支持 to: \"board\"，effect.token 对 mode: \"play\" 返回 negated" +
    "（blockedReason: token-play-requires-chain-creation），且 355.2.a 的“合法位置在 Finalize 选择”没有可用的位置提供方。" +
    "「You may pay :rb_rune_order: to ready it」需要未合入的 cost.pay（支付 1 Order 符文），因此也无法执行；" +
    "两半都不近似实现。依赖：链上 token 创建与 play 管线、cost.pay / cost.hidden（Hidden 展开）与目标位置提供方。",
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
            // then played; the merged kernel only creates on the Board.
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
