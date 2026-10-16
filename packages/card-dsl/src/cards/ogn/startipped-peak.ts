import type { CardProgram } from "../../ir/index.js";

/**
 * Startipped Peak (ogn-288-298) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-288-298):
 *   "When you hold here, you may channel 1 rune exhausted."
 *
 * CR v1.5 anchors:
 * - 383.4.d / 383.4.d.1: "When you hold here …" is a Hold Effect; the closed
 *   `hold` timing point is emitted by the merged turn/scoring flow (471.2,
 *   473.2.b; turn/flow.ts scheduleScore → 'hold' emission with a battlefieldId
 *   payload detail, asserted by engine-core/test/game/lifecycle.test.mjs).
 * - "you may" makes the ability optional; contract 3.9 wraps the chosen
 *   instructions in `choice.optional` with a body (never choice + linkedTo).
 * - 431.1 / 431.2: channeling takes the top rune of the controller's Rune Deck
 *   onto the board, and the stipulation "exhausted" makes it enter exhausted
 *   instead of the default readied. effect.channel carries exactly that
 *   stipulation, and 431.3 governs the shortfall.
 *
 * Status: judge-required — the body only uses the merged effect.channel
 * primitive and the golden test executes it, and the hold timing point is now
 * emitted. The card still cannot run as printed:
 * 1. "here" has no evaluable anchor: the emitted hold event carries the held
 *    Battlefield only as a payload detail (details.battlefieldId), and the
 *    static filter cannot reference its own host's runtime location id;
 *    the `here: true` key below is the documented placeholder, and the
 *    engine-side assertTriggerSpec rejects it (the golden test asserts that);
 * 2. no merged subscriber turns a CardProgram's triggered ability into a live
 *    TriggerRegistration (RIFT-257).
 */
const startippedPeak = {
  canonicalCardId: "card.hash-3baf147c819e802d3468d8c30b6fb475909fc861e0dda2bdaa7adba32bfc23e9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "hold 时点本身已由回合/计分流程发出（turn/flow.ts 的 scheduleScore 产生 'hold' 发射，" +
    "载荷 details.battlefieldId 指明固守的战场；game/lifecycle.test.mjs 断言了该事件），" +
    "能力本体只用已合入的 effect.channel（exhausted=true 对应 431.2 的入场限定），并用契约 3.9 的 choice.optional 包装“you may”。" +
    "整卡仍不可执行：(1)「here」没有可求值的锚点——事件只以 details 载荷携带战场 id，" +
    "静态 filter 读不到宿主运行时的地点身份，程序里的 here=true 是等待载荷绑定的占位键，" +
    "引擎侧 assertTriggerSpec 会以 unknown-field 拒绝它（golden 测试断言了这一点）；" +
    "(2) 没有消费方把卡牌的 triggered ability 注册成实时触发（卡牌程序绑定 RIFT-257）。" +
    "另外参考测试内核不模拟符文入场状态（exhausted），该部分在执行测试中标为 todo。",
  sourceText: "When you hold here, you may channel 1 rune exhausted.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        filter: { event: "hold", here: true, player: "controller" }
      },
      // "you may": the printed optional decision is recorded on the ability and
      // the chosen instruction sits inside choice.optional (contract 3.9).
      optional: true,
      body: [
        {
          id: "startipped-peak.channel-opt",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Channel 1 rune exhausted?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "startipped-peak.channel",
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

export default startippedPeak;
