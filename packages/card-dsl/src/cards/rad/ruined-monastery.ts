import type { CardProgram } from "../../ir/index.js";

/**
 * Ruined Monastery (rad-166-167) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, rad-166-167):
 *   "When you conquer here, you may discard 1 and channel 1 rune exhausted."
 *
 * CR v1.5 anchors:
 * - 383.4.c / 383.4.c.1 / 383.4.c.2.b: "When you conquer here" is a Conquer
 *   Effect referencing the player who Conquered; 383.4.c.2.c keeps it
 *   triggering if the point gain is negated or replaced.
 * - 190.6.a / 190.6.d: "you" is this Battlefield's Controller, so that player
 *   discards and channels.
 * - "you may discard 1 and channel 1 rune exhausted" is one optional decision
 *   over two linked actions; the effect does both if accepted and neither if
 *   declined, so contract §3.9 requires one choice.optional whose body holds
 *   both instructions (never a choice plus a linkedTo consumer).
 * - 423.1 / 423.1.a / 423.2.a / 423.4: discarding moves a chosen card from the
 *   controller's hand to their Trash; as part of an effect it discards as many
 *   cards as possible, and discarding more than the hand holds negates the
 *   discard instruction (359.3.e.11's partial-following rule).
 * - 431.1 / 431.2 / 431.3: channeling takes runes from the top of the Rune
 *   Deck onto the board; "exhausted" makes them enter exhausted, and a shortfall
 *   channels as many as possible without negating the instruction.
 *
 * Status (cards/README.md §2): judge-required. Both instructions exist and the
 * merged interpreter executes the whole printed body end to end (the golden
 * test accepts the optional, discards the chosen card, and channels one rune),
 * but the card cannot run in production because of the engine-side trigger
 * bridge only: scoring/ (RIFT-76) is not bridged to the chain/events pipeline
 * (RIFT-120), so nothing emits the conquer timing point; no merged subscriber
 * turns a CardProgram's triggered ability into a TriggerRegistration, and
 * 190.6's controller resolution for a Battlefield ability is missing. The
 * filter keeps the sibling battlefield placeholder spelling (here: true /
 * player: "controller") for the 053.3 referent, which the engine trigger-spec
 * validator does not accept yet. Nothing about the effect is approximated: the
 * discard is not rewritten as a cost, and "exhausted" is passed through to the
 * channel-rune action (the reference kernel records the action; its rune entry
 * state is not modelled, which the golden test states explicitly).
 * Dependencies: RIFT-76 scoring → RIFT-120 chain/events conquer emission and
 * Battlefield ability registration (contract §7.2 batch 5).
 */
export default {
  canonicalCardId: "card.hash-71ba0d1fe11d64b565b797f33a69b572a821f2e6f56b0643eae299ca2c9a9d5d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "指令体完全用已合入原语表达并由 golden 真实执行（choice.optional 通过后 effect.discard 数量 1 → effect.channel 数量 1、exhausted=true；拒绝时两者都不发生），" +
    "阻断只在触发侧：① scoring/（RIFT-76）未接入 chain/events 单管线（RIFT-120），没有任何生产者发出 conquer 时点；" +
    "② 没有已合入订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration，190.6 的战场能力控制者解析缺失；" +
    "③ filter 的 here: true / player: \"controller\" 是同类战场卡占位（053.3 的 here 指代），引擎 trigger-spec 校验器当前不接受" +
    "（EventPattern 无 here、PlayerSelector 无 controller）。" +
    "另注：契约 3.9 要求「you may A and B」写成一个 choice.optional 包住两条指令（本文件如此实现），不使用 choice + linkedTo；" +
    "参考测试内核不模拟符文入场状态（exhausted 仅作为动作参数传递），该部分在执行测试中标为 todo。" +
    "依赖：RIFT-76 之后的 conquer 发射与战场能力注册（契约 §7.2 批 5）。不近似实现。",
  sourceText: "When you conquer here, you may discard 1 and channel 1 rune exhausted.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // "here" is this Battlefield (053.3); "you" is its Controller
        // (190.6.d). Sibling battlefield programs keep this placeholder
        // spelling while the trigger pipeline is unmerged.
        filter: { event: "conquer", here: true, player: "controller" }
      },
      // The printed "you may …" is recorded on the ability and realised by the
      // §3.9 choice.optional body wrapper below.
      optional: true,
      body: [
        {
          id: "ruined-monastery.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Discard 1 and channel 1 rune exhausted?" },
            body: {
              kind: "constant",
              value: [
                {
                  // 423.1 / 423.1.a / 423.4: the controller chooses which card
                  // leaves their hand; the discard-as-effect rule discards as
                  // many as possible and negates when the hand is short. The
                  // choice is private to the discarding player and is not a
                  // target (355.10.a).
                  id: "ruined-monastery.discard",
                  op: "effect.discard",
                  args: {
                    amount: { kind: "constant", value: 1 },
                    choiceId: { kind: "constant", value: "ruined-monastery-discard" }
                  }
                },
                {
                  // 431.1 / 431.2: channel 1 rune from the top of the
                  // controller's Rune Deck, entering exhausted; 431.3 governs
                  // the shortfall. Not linked to the discard: the accepted
                  // decision covers both actions (contract 3.9), and a
                  // shortened channel still resolves as far as possible.
                  id: "ruined-monastery.channel",
                  op: "effect.channel",
                  args: {
                    amount: { kind: "constant", value: 1 },
                    exhausted: { kind: "constant", value: true }
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

