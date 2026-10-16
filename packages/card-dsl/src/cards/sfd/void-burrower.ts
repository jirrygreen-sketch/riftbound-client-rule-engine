import type { CardProgram } from "../../ir/index.js";

/**
 * Void Burrower (sfd-187-221 / sfd-243-221) — Legend, Fury/Order, tag Rek'Sai.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-187-221, verbatim):
 *   "When you conquer, you may exhaust me to reveal the top 2 cards of your Main
 *    Deck. You may play one. Then recycle the rest."
 *
 * Rules evidence (Core Rules v1.5):
 * - 383.4.c / 383.4.c.1 / 383.4.c.2.b: "When you conquer" is a Conquer Effect that
 *   references the player who Conquered, at the closed `conquer` timing point
 *   (events/timing-points.ts, ruleRefs 468.5.d / 471.1 / 473.2.a).
 * - 383.3.a / 383.3.a.3: the first "you may" opens the effect, so whether the
 *   ability is performed is the Finalize decision (TriggeredAbility.optional); the
 *   later "You may play one" is decided on resolution. Contract 3.9 freezes that
 *   second shape as one `choice.optional` whose body holds the chosen instruction —
 *   never a bare choice with a `linkedTo` consumer.
 * - 383.3.b / 404.1.b.1 / 740.4.a.2: "exhaust me" immediately follows that leading
 *   "you may", so it is a cost within instructions and becomes this triggered
 *   ability's base cost, paid at Finalize; 355.10.c.1 keeps such a cost from being a
 *   target. The printed instruction is declared in its printed position as the
 *   non-target `choose` form of effect.exhaust anchored to the source — the same
 *   declaration sibling leading-cost Legends use (ogn/relentless-storm.ts) — because
 *   IR's TriggeredAbility has no cost field to carry it (see judgeReason 2).
 * - 425.1 / 425.3 / 425.3.a: "reveal the top 2 cards of your Main Deck" shows them
 *   to all players without moving them. Main Deck order is secret (108.4.d), so the
 *   top two travel as an ordered pick: effect.reveal refuses to slice a count out of
 *   a set query ("a subset of this zone requires upstream ordered picks"), which is
 *   why the ordered slice must come from ctx.zoneSlice(controller, "deck", "top", 2)
 *   (contract 3.6) and is never taken from query order.
 * - 420.3 / 420.3.a / 420.3.b / 420.3.c: "You may play one" is a Limited Play
 *   Effect; when no revealed card is eligible, nothing happens and resolution
 *   continues. The card is chosen as a resolution-time non-target pick (355.10.a:
 *   Main Deck cards are not public), and no cost override is supplied — the printed
 *   Play procedure pays the card's own cost, so inventing a finalized zero plan
 *   would be wrong (420.3.b.1's alternate costs are not printed here).
 * - 417.1.a / 417.4: "Then recycle the rest" recycles the remaining revealed cards
 *   to their owner's Main Deck bottom. The played card has left the deck, so its old
 *   zone identity is invalid (124) and the merged mechanics drop it from `revealed`;
 *   that is "the rest", not a set difference written by this card. "Then" is
 *   sequencing rather than a dependent clause, so the recycle is not linked to the
 *   play — the convention ogn/baited-hook.ts uses for its own "Then recycle the
 *   rest." (the same instruction shape also has an unmerged ordered-slice gap in
 *   that file, recorded there).
 *
 * status (cards/README.md section 2): judge-required, for four reasons.
 * 1. Nothing emits the `conquer` timing point into the chain pipeline: scoring/
 *    (RIFT-76) is not bridged to chain/events (RIFT-120), and no merged consumer
 *    registers a CardProgram triggered ability as a TriggerRegistration (contract
 *    3.5). rad/ruined-monastery.ts and sfd/treasure-hoard.ts record the same
 *    blocker.
 * 2. The leading "exhaust me" is the trigger's base cost (383.3.b / 404.1.b.1) and
 *    must be charged at Finalize. IR's TriggeredAbility has no cost field and no
 *    merged path turns a program's leading [do X] into one, so the cost cannot be
 *    charged as printed; effect.exhaust is a resolution-time state change, not a cost
 *    payment (its own header draws that boundary for 415.4/415.5).
 *    TriggerRegistration.cost / mayAtFinalize is the merged home for such a leading
 *    cost, but nothing builds a registration out of a CardProgram yet.
 * 3. "the top 2 cards of your Main Deck" needs the ordered deck slice as a pick, and
 *    the merged chain adapter does not unwrap it: interpreter-adapter.ts lists only
 *    `target` for effect.reveal in LITERAL_FIELDS, so through the production adapter
 *    the `pick` argument still arrives inside its Expr envelope and the primitive
 *    rejects it ("pick must be a non-empty id"). The direct interpreter path
 *    evaluates the same argument correctly. ogn/teemo-strategist.ts,
 *    sfd/twisted-fate-gambler.ts and rad/mechanical-bandit.ts record the ordered
 *    slice itself as missing for reveal; the adapter's argument field is reported in
 *    the contract-change request instead of being worked around.
 * 4. This canonical identity has a non-reminder printing difference: sfd-243-221
 *    reads "You may banish one, then play it. Recycle the rest.", which changes
 *    whether the chosen card enters Banishment before being played (428.1 vs 420.3)
 *    and therefore its zone path, triggers and card identity. The local catalog and
 *    the survey give no erratum choosing one reading for the identity
 *    (docs/plans/survey/unclassified-rad-sfd.md item 5, blocker
 *    "non-reminder-printing-difference"), so this program follows the printing the
 *    task names (sfd-187-221) and does not merge the two readings.
 * Dependencies: RIFT-76 → RIFT-120 conquer emission and ability registration,
 * RIFT-89 (triggered-ability base cost wiring), the ordered deck-slice binding for
 * reveal plus the adapter's argument unwrapping, and the printing-difference ruling.
 * Nothing is approximated: no cost is turned into an effect instruction, no
 * unordered slice is taken, and the other printing's banish step is not folded in.
 */
export default {
  canonicalCardId: "card.hash-289ad4d681c7cb59dd55bae00863be7516f68dff172a97e886f4ff7920625b0c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口，均不近似实现：(1) 没有已合入模块把 conquer 时点发进链管线——scoring/（RIFT-76）尚未接入 " +
    "chain/events（RIFT-120），也没有消费者把 CardProgram 的 triggered 能力注册成 TriggerRegistration（契约 3.5），" +
    "与 rad/ruined-monastery、sfd/treasure-hoard 记录的同一阻断一致；" +
    "(2) 开头的「exhaust me」按 383.3.b / 404.1.b.1 / 740.4.a.2 是触发能力的基础费用，须在 Finalize 支付，" +
    "但 IR 的 TriggeredAbility 没有 cost 字段、也没有已合入路径把程序里位于效果开头的 [do X] 变成触发费用，费用无法按印刷语义收取；" +
    "effect.exhaust 是结算期的状态改变而非费用支付（其文首明确 415.4/415.5 的费用式横置属费用计划），" +
    "合并类型里 TriggerRegistration.cost / mayAtFinalize 才是这类前置费用的归属，但尚无卡牌程序→registration 的构造方；" +
    "(3)「the top 2 cards of your Main Deck」需要把有序牌库顶作为 pick，而合并链适配器没有解包该参数：" +
    "interpreter-adapter.ts 为 effect.reveal 的 LITERAL_FIELDS 只列了 target，`pick` 会连同 Expr 外壳一起传给原语并被拒绝" +
    "（\"pick must be a non-empty id\"），直接解释器路径则能正确求值；ogn/teemo-strategist、sfd/twisted-fate-gambler、" +
    "rad/mechanical-bandit 也记录了 reveal 缺有序切片消费（适配器参数字段见最终回复的契约变更请求）；" +
    "(4) 同一 canonical 身份的 sfd-243-221 写作「You may banish one, then play it. Recycle the rest.」，" +
    "改变了被选牌是先进入 Banishment 再打出、还是直接打出（428.1 vs 420.3），从而影响区域路径、触发与卡牌身份；" +
    "本地目录与调研都未给出按印刷号执行或勘误统一的依据（docs/plans/survey/unclassified-rad-sfd.md 第 5 条，" +
    "blocker non-reminder-printing-difference），本程序按任务指定的 sfd-187-221 原文编写，不合并两种读法。" +
    "依赖：RIFT-76 → RIFT-120 的 conquer 发射与能力注册、RIFT-89（触发基础费用接线）、reveal 的有序牌库切片与适配器解包、" +
    "以及印刷差异裁定。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // The closed EventPattern spelling for conquering is "conquered"
        // (events/trigger-spec.ts EVENT_PATTERN_TYPES; pipeline-match aliases it to
        // the `conquer` timing point). "you conquer" = this ability's controller
        // performed the action (383.4.c.2.b / 190.6.d).
        filter: { event: "conquered", player: "self" }
      },
      // 383.3.a: the leading "you may" is this ability's own Finalize decision.
      optional: true,
      body: [
        {
          id: "void-burrower.exhaust-self",
          // 383.3.b / 355.10.c.1: "exhaust me" is the trigger's base cost, not a
          // target; declared in printed position as a non-target choose anchored to
          // the source. The real Finalize charging is judgeReason 2.
          op: "effect.exhaust",
          args: {
            choose: {
              kind: "constant",
              value: { id: "void-burrower.exhaust-self", filter: { object: "self" } }
            }
          }
        },
        {
          id: "void-burrower.reveal-top-two",
          // 425.1 / 425.3.a: reveal the ordered top two of the Main Deck; they stay
          // in the deck (425.1.a.2). Only picks can carry real deck order.
          op: "effect.reveal",
          args: {
            pick: { kind: "constant", value: "void-burrower.top-two" }
          },
          picks: [
            {
              id: "void-burrower.top-two",
              // Ordered Main Deck slice, supplied by the caller from
              // ctx.zoneSlice(controller, "deck", "top", 2) (contract 3.6); the
              // query vocabulary cannot express deck order.
              options: ["dynamic:top-two-main-deck-cards"],
              selection: "all"
            }
          ]
        },
        {
          id: "void-burrower.may-play-one",
          // 383.3.a.3 + contract 3.9: the later "You may" is one choice.optional
          // whose body holds the chosen instruction.
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Play one of the revealed cards?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "void-burrower.play-one",
                  // 420.3.a / 420.3.b / 420.3.c: a Limited Play Effect that reads
                  // the revealed cards as a resolution-time non-target pick and
                  // leaves the card's own cost to the normal Play procedure.
                  op: "effect.play",
                  args: {
                    pick: { kind: "constant", value: "void-burrower.play-one" },
                    choice: {
                      kind: "constant",
                      value: { id: "void-burrower.play-one-choice", min: 1, max: 1 }
                    }
                  },
                  picks: [
                    {
                      id: "void-burrower.play-one",
                      options: [
                        {
                          kind: "linked-value",
                          instructionId: "void-burrower.reveal-top-two",
                          key: "revealed"
                        }
                      ],
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        },
        {
          id: "void-burrower.recycle-rest",
          // 417.1.a / 417.4: recycle the remaining revealed cards to their owner's
          // Main Deck bottom. The played card's deck identity is invalid after it
          // leaves the deck (124), so the merged mechanics drop it and the rest is
          // genuinely "the rest". Not linked to the play: 359.3.e.11 keeps "Then
          // recycle the rest." resolving when the optional play is declined.
          op: "effect.recycle",
          args: {
            objects: {
              kind: "linked-value",
              instructionId: "void-burrower.reveal-top-two",
              key: "revealed"
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you conquer, you may exhaust me to reveal the top 2 cards of your Main Deck. " +
    "You may play one. Then recycle the rest."
} satisfies CardProgram;
