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
 * Status (cards/README.md §2): judge-required, re-reviewed against the merged
 * turn/event pipeline. Both instructions exist and the merged interpreter
 * executes the whole printed body end to end (the golden test accepts the
 * optional, discards the chosen card, and channels one rune). The conquer
 * timing point is now really emitted: TurnFlow's Score wave publishes
 * { timingPoint: "conquer", player, details: { battlefieldId } }
 * (src/turn/flow.ts, RIFT-124/RIFT-76; producers audit marks conquer as 已有).
 * The remaining blockers are trigger-side only:
 * 1. no merged subscriber turns a CardProgram's triggered ability into a
 *    TriggerRegistration (src/programs/ is RIFT-257, unmerged), so the emitted
 *    event never reaches this ability; 190.6's controller resolution for a
 *    Battlefield ability is missing with it;
 * 2. the printed 053.3 "here" restriction has no evaluable spelling: the
 *    engine's EventPattern/ObjectFilter vocabulary has no host-relative
 *    anchor, and the emission only carries details.battlefieldId, which cannot
 *    be compared against this Battlefield's own identity from static IR.
 * Nothing about the effect is approximated: the discard is not rewritten as a
 * cost, and "exhausted" is passed through to the channel-rune action (the
 * reference kernel records the action; its rune entry state is not modelled,
 * which the golden test states explicitly).
 * Dependency: RIFT-257 (CardProgram → TriggerRegistration binding).
 */
export default {
  canonicalCardId: "card.hash-71ba0d1fe11d64b565b797f33a69b572a821f2e6f56b0643eae299ca2c9a9d5d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "指令体完全用已合入原语表达并由 golden 真实执行（choice.optional 通过后 effect.discard 数量 1 → effect.channel 数量 1、exhausted=true；拒绝时两者都不发生），" +
    "conquer 时点也已由 TurnFlow 的 Score 波真实发出（src/turn/flow.ts，player + details.battlefieldId），" +
    "阻断只在触发侧：① 没有已合入订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration" +
    "（src/programs/ 属 RIFT-257，未合入），190.6 的战场能力控制者解析缺失；" +
    "② 印刷的 053.3 「here」没有可求值拼写——引擎的 EventPattern/ObjectFilter 词表没有宿主相对锚点，" +
    "而事件只带 details.battlefieldId，静态 IR 无法把它与本战场自身身份比较（filter 因此只声明事件与征服者）。" +
    "另注：契约 3.9 要求「you may A and B」写成一个 choice.optional 包住两条指令（本文件如此实现），不使用 choice + linkedTo；" +
    "参考测试内核不模拟符文入场状态（exhausted 仅作为动作参数传递），该部分在执行测试中标为 todo。" +
    "依赖：RIFT-257。不近似实现。",
  sourceText: "When you conquer here, you may discard 1 and channel 1 rune exhausted.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // "you" is this Battlefield's Controller (190.6.d); the engine's closed
        // event spelling for the conquer event is "conquered" (events/trigger-spec.ts
        // EVENT_PATTERN_TYPES), which pipeline-match maps to the conquer timing point.
        // The printed 053.3 "here" restriction has no host-relative anchor in that
        // vocabulary, so it is not written as an unevaluable placeholder; see
        // judgeReason point 2.
        filter: { event: "conquered", player: "self" }
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

