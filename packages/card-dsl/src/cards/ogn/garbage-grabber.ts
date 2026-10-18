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
 *   spelling and 355.10.c keeps such a cost outside the targeting rules, so
 *   the offered cards are chosen, never targeted.
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
 * gap, and 417.5's random bottom order for a multi-card recycle has no consumer
 * either: effect.repeat can emit a `shuffle` GameAction, but shuffling the
 * whole Main Deck is not "these recycled cards in a random order", and the
 * cost path that would place them has no such consumer. The merged
 * energy + exhaust + Draw 1 slice is executed by the RIFT-689 parameterized
 * golden (test/cards/templates/activated-activated-effect-draw-689.test.mjs).
 */
const garbageGrabber = {
  canonicalCardId: "card.hash-00d819e309a473483d8a8fe1f5b4cd6332aed4778597aa7272e310eba60023c8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺\"在 Finalize 时按区域动态生成非目标费用选项\"的费用形状：417.6 的 \"Recycle 3 from your trash\" 是费用的一部分" +
    "（355.10.c：只作为费用出现时不产生目标），但 CostSpec 的 payment.choice 是 PickSpec，cost/plan-values.ts 的 " +
    "choiceObjects 逐项要求精确 ObjectRef（实测抛 \"Cost requires an exact object reference\"），静态卡程序拿不到控制者 Trash 中" +
    "真实牌的 id/zoneEntryId，也没有 filter + zone 在支付计划里生成候选的路径；" +
    "effect.recycle 的 from 形式是结算效果而非费用，用它会把 417.3 的\"费用必须能完成\"变成普通效果。" +
    "费用侧的 417.5（2 张以上同时回收进 Main Deck 时随机落底）同样没有消费方：effect.repeat 虽能发出 shuffle " +
    "GameAction，但整副 Main Deck 洗牌不等于\"这些被回收的牌随机排序\"，费用支付路径也没有对应消费者。" +
    "1 能量 + exhaust self（415.4/415.5）与 Draw 1（414.1/414.3）已合入，参数化 golden 经真实链执行这两半" +
    "（test/cards/templates/activated-activated-effect-draw-689.test.mjs）。依赖：费用选择形状的共享契约扩展与 417.5 随机回收消费方；不近似实现。",
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
              // 417.3: a recycle cost must be completable, so exactly 3 cards
              // are required. min === max already encodes that; an "up-to"
              // selection would contradict the printed cost.
              min: 3,
              max: 3,
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
