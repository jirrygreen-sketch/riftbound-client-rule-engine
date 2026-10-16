import type { CardProgram } from "../../ir/index.js";

/**
 * Startipped Peak (ogn-288-298) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-288-298):
 *   "When you hold here, you may channel 1 rune exhausted."
 *
 * CR v1.5 anchors:
 * - 383.4.d / 383.4.d.1: "When you hold here …" is a Hold Effect; the closed
 *   `hold` timing point is the one scoring/ is meant to emit (471.2, 473.2.b).
 * - "you may" makes the ability optional; contract 3.9 wraps the chosen
 *   instructions in `choice.optional` with a body (never choice + linkedTo).
 * - 431.1 / 431.2: channeling takes the top rune of the controller's Rune Deck
 *   onto the board, and the stipulation "exhausted" makes it enter exhausted
 *   instead of the default readied. effect.channel carries exactly that
 *   stipulation, and 431.3 governs the shortfall.
 *
 * Status: judge-required — the body only uses the merged effect.channel
 * primitive (and is executed by the golden test), but no merged module emits
 * the `hold` timing point into the single event pipeline, so the trigger
 * cannot run in production (see judgeReason).
 */
const startippedPeak = {
  canonicalCardId: "card.hash-3baf147c819e802d3468d8c30b6fb475909fc861e0dda2bdaa7adba32bfc23e9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺时点接线：\"When you hold here\" 依赖 hold 时点（CR 383.4.d、471.2、473.2.b）进入唯一事件管线，" +
    "但已合入代码没有任何模块 emit hold，SCENARIO-COVERAGE.md 的 triggers-hold-unit-present 标注未覆盖，" +
    "需 scoring/触发接线任务（RIFT-31 scenarios-scoring / RIFT-33 scenarios-triggers 及契约 §7.2 批 5）；" +
    "触发器 filter 里的 here=true 是等待 scoring 载荷的占位键，引擎侧 assertTriggerSpec 同样拒绝它" +
    "（golden 测试断言了这一点）。能力本体只用已合入的 effect.channel " +
    "（exhausted=true 对应 431.2 的入场限定），并用契约 3.9 的 choice.optional 包装“you may”；" +
    "参考测试内核不模拟符文入场状态（exhausted），该部分在执行测试中标为 todo；整卡在时点接线前保持 judge-required。",
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
