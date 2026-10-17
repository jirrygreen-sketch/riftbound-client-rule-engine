import type { CardProgram } from "../../ir/index.js";

/**
 * Garbage Grabber (ogn-099-298) — Gear, 2 energy, Mind.
 *
 * Printed text:
 *   Recycle 3 from your trash, :rb_energy_1:, :rb_exhaust:: Draw 1.
 *
 * Rules evidence (Core Rules v1.5):
 * - 417.1 / 417.1.a / 417.1.c: recycling takes cards from a zone to the
 *   bottom of the owner's Main Deck; 417.6 is the "Recycle X from [Zone]"
 *   spelling, a choice made as the instruction resolves that does not target
 *   the recycled cards.
 * - 417.3: when Recycling is a Cost, the action must be completable for the
 *   cost to be paid — the printed trio (recycle 3, 1 energy, exhaust) is one
 *   cost, not an effect.
 * - 415.4 / 415.5: :rb_exhaust: is the cost "Exhaust this".
 * - 414.3: "Draw 1." is the resolved effect.
 *
 * Status: judge-required — the cost cannot be described with the frozen
 * CostSpec shape. A cost payment that chooses objects from a zone needs a
 * PickSpec whose `options` are the exact ObjectRefs of the offered cards
 * (cost/plan-values.ts `choiceObjects` requires an exact reference per
 * option), and the card program is static data that cannot know those
 * references; 417.6's non-targeting "X from your trash" selection has no
 * filter-based cost form. effect.recycle's `from` form is a resolving effect,
 * not a cost, and using it would turn a payable cost (417.3) into an effect.
 * The dynamic cost selection and payment binding are still a current cost-plan
 * gap. The intended shape is kept; the golden test executes only the Draw 1 half
 * through the merged effect.draw primitive.
 */
const garbageGrabber = {
  canonicalCardId: "card.hash-00d819e309a473483d8a8fe1f5b4cd6332aed4778597aa7272e310eba60023c8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺\"从区域按筛选选择对象\"的费用选择形状：CostSpec 的 pick 只接受逐项列出的精确 ObjectRef" +
    "（cost/plan-values.ts choiceObjects 要求每个 option 是精确引用），静态卡程序无法写出 " +
    "417.6 的 \"Recycle 3 from your trash\"（选择在 Finalize 才存在，且不指定目标）；" +
    "effect.recycle 的 from 形式是结算效果而非费用，用它会把 417.3 的\"费用必须能完成\"变成普通效果。" +
    "当前缺少在 Finalize 时按 controller Trash 动态生成非目标费用选项并把选择交给支付计划的形状；" +
   "费用侧的 417.5 随机落牌次序（同时回收多张）也还没有 shuffle/choose 原语落地（effect.recycle 文件头明确随机化归解释器/内核）。" +
    "1 能量、exhaust self 与 Draw 1 效果已合入，golden 仅执行 Draw 1；不近似实现。",
  abilities: [
    {
      kind: "activated",
      cost: {
        kind: "activated",
        energy: { kind: "constant", value: 1 },
        payments: [
          {
            // "Recycle 3 from your trash" (417.6): a non-targeting cost pick.
            // The offered cards only exist at Finalize, so this static shape
            // cannot name them; see judgeReason.
            kind: "recycle",
            amount: { kind: "constant", value: 3 },
            choice: {
              id: "garbage-grabber.recycled-cards",
              options: ["card-in-controller-trash"],
              min: 3,
              max: 3,
              selection: "up-to",
              zone: "trash",
              type: "card",
              owner: "controller"
            }
          },
          { kind: "exhaust" }
        ]
      },
      timing: "action",
      body: [
        {
          // "Draw 1." — the ability controller draws (414.3, 190.6.d).
          id: "draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText: "Recycle 3 from your trash, :rb_energy_1:, :rb_exhaust:: Draw 1."
} satisfies CardProgram;

export default garbageGrabber;
