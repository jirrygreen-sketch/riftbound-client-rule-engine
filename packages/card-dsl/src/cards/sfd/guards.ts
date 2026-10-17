import type { CardProgram } from "../../ir/index.js";

/**
 * Guards! (sfd-154-221) — Spell, 3 energy, Order.
 *
 * Printed text:
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)
 *   Play a 2 :rb_might: Sand Soldier unit token. You may pay :rb_rune_order: to ready it.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Hidden] (811) is declared as a keyword ability only (cards/README section 5).
 *   Its expansion (effects/keywords/Hidden.ts) is the single static effect
 *   { kind: "cost.hidden" }.
 * - "Play a 2 [M] Sand Soldier unit token" uses the frozen CR 187.3 token
 *   definition (effect.token id "sand-soldier"); a played token is created on
 *   the Chain first and then handed to the play action (440.2.c / 185.2.a /
 *   350.2 / 354). The printed text names no location, so the playing player
 *   chooses a valid one when the resulting game object is finalized (355.2 /
 *   355.2.a: their Base or a Battlefield they control). The merged
 *   instruction.locations provider (target/location/candidates.ts plus the
 *   interpreter's chooseLocations) binds that Finalize-time choice, and
 *   effect.token reads it through the linked value, exactly as the merged
 *   sfd/deserts-call program does (RIFT-357 / RIFT-489).
 * - "You may pay :rb_rune_order: to ready it" is one optional decision, so it
 *   is written as choice.optional with the chosen instructions inside the body
 *   (contract 3.9). The 1 Order Power is a Cost within Instructions (204.3 /
 *   204.3.a) paid by the merged cost.pay primitive through its `payments`
 *   record; "it" is the Sand Soldier handed back by the token instruction
 *   (359.3.e.14).
 *
 * Status: judge-required (cards/README section 2). Everything the card prints
 * beyond [Hidden] is executable and the golden executes it against the
 * production chain adapter: the Finalize-time location selection, the
 * chain-create + play handoff, the resolving-body payment of one Order Power
 * and the linked ready. The whole card still cannot run because [Hidden]'s
 * expansion has no runtime consumer: programs/statics.ts layerFor() throws
 * "Static ability kind cost.hidden has no layer mapping", so the 811.1.b Hide
 * action, the facedown storage and the 811.6 free play from facedown have no
 * implementation (cost/kinds/hidden.ts only locks and pays the fee plan;
 * cost/README.md integration request 3 keeps the Hide/facedown zones open).
 * Nothing is approximated: no Board creation stands in for the played token and
 * no free ready stands in for the payment.
 */
const guards = {
  canonicalCardId: "card.hash-96f6071389124163d72b59b25dca5a642f1cd93402158c5237be9ba305f9dd44",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "唯一剩余缺口是 [Hidden]（811.1.b / 811.1.c.2 / 811.6）的运行时消费方：keywords/Hidden.ts 只展开 " +
    "static effect { kind: \"cost.hidden\" }，而 programs/statics.ts 的 layerFor() 对该 kind 直接抛 " +
    "\"Static ability kind cost.hidden has no layer mapping\"，Hide 行动、facedown 存储与「从面朝下免费打出」许可都无处执行；" +
    "cost/kinds/hidden.ts 的 buildHiddenCostPlan / payHiddenCostPlan 已合入，但按 cost/README.md 的集成请求 3 只负责费用计划与支付，" +
    "facedown 区域、解除时点与战场目标限制仍缺。" +
    "其余印刷能力已可真实执行：位置由 instruction.locations 的 target-location 选择器在 Finalize 绑定（355.2.a，" +
    "target/location/candidates.ts + 解释器 chooseLocations），effect.token 的 mode \"play\" 按 440.2.c / 185.2.a / 350.2 / 354 " +
    "先在链上创建再把 ObjectRef 交给 play（187.3 的 Sand Soldier，无印刷费用、绝不写成 0），" +
    "\"You may pay :rb_rune_order:\" 由已合入的 cost.pay 原语按 payments 记录支付 1 点 Order 力量（204.3 / 204.3.a），" +
    "再经 linked 值就绪该 token。" +
    "依赖：cost.hidden 的 Hide/facedown/免费打出消费方。不近似实现（不用 Board 创建冒充链上 play，也不做免费 ready）。",
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "Play a 2 :rb_might: Sand Soldier unit token. You may pay :rb_rune_order: to ready it.",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    {
      kind: "play",
      body: [
        {
          // 355.2 / 355.2.a: the printed text names no destination, so the
          // playing player chooses a valid Location when the resulting game
          // object is finalized. The merged location provider enumerates it and
          // condition.value publishes the chosen LocationRef for the linked
          // token instruction (the merged sfd/deserts-call shape).
          id: "guards.choose-location",
          op: "condition.value",
          locations: [
            {
              id: "guards.token-location",
              type: "any",
              controller: "controller",
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
          args: {
            value: {
              kind: "location",
              value: { kind: "target-location", target: "guards.token-location" }
            },
            key: { kind: "constant", value: "location" }
          }
        },
        {
          // 440.2.c / 185.2.a: a played token is created on the Chain and then
          // played; effect.token's play mode implements that handoff.
          id: "guards.play-sand-soldier",
          op: "effect.token",
          linkedTo: "guards.choose-location",
          args: {
            token: { kind: "constant", value: "sand-soldier" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: {
              kind: "linked-value",
              instructionId: "guards.choose-location",
              key: "location"
            },
            linkKey: { kind: "constant", value: "sandSoldier" }
          }
        },
        {
          // "You may pay :rb_rune_order: to ready it" — contract 3.9 shape: one
          // optional decision with the chosen instructions in the body.
          id: "guards.may-ready",
          op: "choice.optional",
          linkedTo: "guards.play-sand-soldier",
          args: {
            prompt: { kind: "constant", value: "Pay :rb_rune_order: to ready the Sand Soldier?" },
            body: {
              kind: "constant",
              value: [
                {
                  // 204.3 / 204.3.a: one Order Power paid while the spell
                  // resolves, through the merged cost.pay `payments` record
                  // (135.2.e.4 domain Power; the payment plan checks the pool).
                  id: "guards.pay-order-rune",
                  op: "cost.pay",
                  args: { payments: { kind: "constant", value: { power: ["Order"] } } }
                },
                {
                  // "it" = the token handed back by the token instruction
                  // (359.3.e.14); a paid-but-unplayable token leaves the ready
                  // instruction without a live reference.
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
