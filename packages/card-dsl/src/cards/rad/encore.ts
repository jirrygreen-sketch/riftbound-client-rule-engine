import type { CardProgram } from "../../ir/index.js";

/**
 * Encore — rad-152-167 (Spell, Mind/Order, 3 Energy + 1 Power,
 * Seraphine / Signature).
 *
 * Printed text (verbatim, deck-catalog rad-152-167):
 *   "Choose two —
 *    Deal 2 to a unit.Play two 1 :rb_might: Recruit unit tokens.Give up to two
 *    units each +1 :rb_might: this turn.Look at the top 2 cards of your Main
 *    Deck, draw 1 and recycle the other."
 *
 * Modeling notes (Core Rules v1.5):
 * - "Choose two —" is a bulleted mode list; per 355.3 the modes are chosen as
 *   the spell is finalized, and the chosen instructions resolve top to bottom
 *   (158.1). Contract 3.9 encodes that as one choice.mode node with count: 2 and
 *   different: true; the selected mode bodies execute in declaration order.
 * - "Deal 2 to a unit" is one Deal action against a target (355.7 / 418.1.b),
 *   fully covered by the merged effect.damage primitive (see the golden test).
 * - "Play two 1 :rb_might: Recruit unit tokens" uses the CR 187.1 Recruit unit
 *   token and plays it through the Play procedure (420.3 / 420.3.a / 350.2).
 *   Playing a NEW token creates it on the Chain (440.2.c / 185.2.a); the unit's
 *   play destination defaults to the controller's Base or a battlefield they
 *   control (355.2.a).
 * - "Give up to two units each +1 :rb_might: this turn" is a temporary Might
 *   modification, which belongs to the layers arithmetic pass (continuous.might
 *   with an end-of-turn duration; "this turn" expires as one batch per 317.2.c),
 *   never to Buff counters (702, 703). "up to two" permits choosing zero
 *   (355.13).
 * - "Look at the top 2 cards of your Main Deck, draw 1 and recycle the other":
 *   look (128.3-128.4) at the top two cards in Main Deck order, then draw one
 *   (414) and recycle the other (417.1).
 *
 * Status: judge-required. Only the first mode is executable; the other three are
 * not, and no mode is approximated:
 * - mode 2: the Recruit definition exists, but the token's play destination is
 *   the controller's Base (355.2.a) and a base LocationRef must name a resolved
 *   PlayerId, while the card-facing location expression cannot produce the
 *   controller's id (effect.token negates a literal "controller" base);
 * - mode 3: layers/engine.ts evaluates arithmetic continuous.might and
 *   ResolveContext.addContinuous exists (contract 3.6), but
 *   effects/instructions/ registers no op that creates such an effect (RIFT-91);
 * - mode 4: effect.inspect's top scope requires an ordered PickSpec
 *   (picksSpecId) because query() does not guarantee zone order and PickSpec
 *   options are static data; "recycle the other" additionally needs a
 *   complement selection, which effect.recycle cannot express (it takes N from
 *   one zone, or an explicit target/objects list).
 */
export default {
  canonicalCardId: "card.hash-3812004b1ace905a5750f12683fd2ae066128769b8d39d3a460ea8a2bce04b99",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四个模式中只有「Deal 2 to a unit」可由已合入的 effect.damage 执行（见 golden 测试），其余未合入：" +
    "「Play two 1 :rb_might: Recruit unit tokens」的 token 定义（187.1 Recruit）已存在，但打出目的地需为控制者基地/其控制的战场（355.2.a），" +
    "而 base 的 LocationRef 必须给出已解析 PlayerId，卡牌侧没有能产出控制者 id 的表达式，effect.token 拒绝字面 \"controller\" 的 base；" +
    "「Give up to two units each +1 :rb_might: this turn」（可为零，355.13；到期 317.2.c）需要 layers 的 continuous.might 持续效果，" +
    "ResolveContext.addContinuous 已存在但指令注册表没有创建它的 op（依赖 RIFT-91），不得用 Buff 计数器代替；" +
    "「Look at the top 2 cards of your Main Deck, draw 1 and recycle the other」的 top 查看需要有序 PickSpec（query 不保证区域内顺序，PickSpec.options 是静态数据），" +
    "且「recycle the other」是补集选择，effect.recycle 只能从单一区域取 N 张或按显式 target/objects 列表。" +
    "依赖：RIFT-90 目标/选择、RIFT-91 layers 卡牌侧入口；不近似实现。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "encore.choose-two",
          op: "choice.mode",
          args: {
            count: { kind: "constant", value: 2 },
            different: { kind: "constant", value: true },
            modes: {
              kind: "constant",
              value: [
                {
                  id: "encore.deal-two-mode",
                  body: [
                    {
                      id: "encore.deal-two",
                      op: "effect.damage",
                      args: {
                        amount: { kind: "constant", value: 2 },
                        target: { kind: "constant", value: "encore.damaged-unit" }
                      },
                      targets: [
                        {
                          id: "encore.damaged-unit",
                          filter: { type: "unit" },
                          min: 1,
                          max: 1,
                          selection: "one"
                        }
                      ]
                    }
                  ]
                },
                {
                  id: "encore.recruit-tokens-mode",
                  body: [
                    {
                      // "Play two 1 Might Recruit unit tokens" — Recruit is CR
                      // 187.1; the destination (the controller's Base, 355.2.a)
                      // is the open part (see judgeReason).
                      id: "encore.recruit-tokens",
                      op: "effect.token",
                      args: {
                        token: { kind: "constant", value: "recruit" },
                        amount: { kind: "constant", value: 2 },
                        mode: { kind: "constant", value: "play" },
                        location: {
                          kind: "constant",
                          value: { type: "base", player: "controller" }
                        },
                        linkKey: { kind: "constant", value: "encore.recruits" }
                      }
                    }
                  ]
                },
                {
                  id: "encore.grant-might-mode",
                  body: [
                    {
                      // "Give up to two units each +1 Might this turn" —
                      // layers arithmetic effect; no merged op creates it (see
                      // judgeReason).
                      id: "encore.grant-might",
                      op: "continuous.might",
                      args: {
                        amount: { kind: "constant", value: 1 },
                        duration: { kind: "constant", value: "end-of-turn" }
                      },
                      targets: [
                        {
                          id: "encore.buffed-units",
                          filter: { type: "unit" },
                          min: 0,
                          max: 2,
                          selection: "up-to"
                        }
                      ]
                    }
                  ]
                },
                {
                  id: "encore.look-and-recycle-mode",
                  body: [
                    {
                      // "Look at the top 2 cards of your Main Deck" — the
                      // ordered top selection is the open part (see judgeReason).
                      id: "encore.look-top-two",
                      op: "effect.inspect",
                      args: {
                        player: { kind: "constant", value: "controller" },
                        zone: {
                          kind: "constant",
                          value: { owner: "controller", zone: "deck" }
                        },
                        scope: { kind: "constant", value: "top" },
                        amount: { kind: "constant", value: 2 },
                        picksSpecId: { kind: "constant", value: "encore.top-two" },
                        choiceId: { kind: "constant", value: "encore.look-top-two" }
                      },
                      picks: [
                        {
                          id: "encore.top-two",
                          options: ["dynamic:top-2-of-main-deck"],
                          min: 2,
                          max: 2,
                          selection: "all"
                        }
                      ]
                    },
                    {
                      id: "encore.draw-one",
                      op: "effect.draw",
                      args: { amount: { kind: "constant", value: 1 } }
                    },
                    {
                      // "and recycle the other" — the complement of the drawn
                      // card; effect.recycle has no complement selection (see
                      // judgeReason).
                      id: "encore.recycle-other",
                      op: "effect.recycle",
                      linkedTo: "encore.look-top-two",
                      args: {
                        objects: {
                          kind: "linked-value",
                          instructionId: "encore.look-top-two",
                          key: "inspected-picked"
                        },
                        exclude: { kind: "constant", value: "drawn-card" }
                      }
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "Choose two —\n" +
    "Deal 2 to a unit.Play two 1 :rb_might: Recruit unit tokens." +
    "Give up to two units each +1 :rb_might: this turn." +
    "Look at the top 2 cards of your Main Deck, draw 1 and recycle the other."
} satisfies CardProgram;
