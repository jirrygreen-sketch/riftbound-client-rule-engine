import type { CardProgram } from "../../ir/index.js";

/**
 * The Grand Plaza (ogn-293-298) — Battlefield, Colorless.
 *
 * sourceText: When you hold here, if you have 7+ units here, you win the game.
 *
 * CR v1.5 anchors:
 * - 383.4.d / 383.4.d.1 / 473.2.b: "When you hold here" is a Hold Effect, a
 *   triggered ability at the hold timing point (emitted for the Beginning
 *   scoring step, 315.2.b.2 / 471.2).
 * - 195: "A player also wins the game if an effect instructs them to do so" —
 *   this is the direct-win effect, not a point gain (194.2's Victory Score path
 *   is separate, 470.1/473.1).
 * - 053.3 / 740.1.a: "here" is this Battlefield and "you" is the holding player;
 *   "7+ units here" counts the holding player's units at this Battlefield.
 *
 * Status: judge-required. The win instruction itself is fully merged
 * (effect.win, CR 195) and the golden test executes it; what blocks the card is
 * the trigger side:
 * - the hold timing point is declared, but the Beginning scoring step lives in
 *   duel/turn-flow.ts / turn-executor-v2.ts, which has no bridge to the
 *   chain/events pipeline (RIFT-120), so nothing emits "hold";
 * - the "if you have 7+ units here" clause is a condition on the hold event,
 *   which can only read a count through the same pipeline binding that is
 *   missing; layers' filter anchors (sameLocationAs) are also unimplemented, so
 *   the location scope would over-count;
 * - no merged subscriber turns a CardProgram's triggered ability into a
 *   TriggerRegistration, and 190.6's "control of a Battlefield determines
 *   control of its abilities" is not resolved for battlefield programs.
 */
export default {
  canonicalCardId: "card.hash-627933b535ef66e1e1bb12785313b937e23dc2c7ac48a1ff26c8c49a94e0c233",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "“you win the game”指令本身完全可用已合入的 effect.win（CR 195）表达并在 golden 里真实执行，阻断在触发侧：" +
    "① hold 时点虽在 events/timing-points.ts 定义，但 Beginning 计分步骤在 duel/turn-flow.ts / turn-executor-v2.ts 内，未接入 " +
    "chain/events 单管线（RIFT-120），没有任何生产者发出 hold 时点；② “if you have 7+ units here” 是 hold 事件上的条件，需要 383.4.d 的触发载荷" +
    "绑定（事件 → 条件求值）与 053.3 的 here 位置锚定，而引擎过滤器的 sameLocationAs 锚点未实现，会把任意战场的单位算进来（过度计数，不得据此标 executable）；" +
    "③ 没有已合入的订阅方把 CardProgram 的 triggered ability 注册为 TriggerRegistration，190.6 的战场能力控制者解析也未落地。" +
    "依赖：RIFT-76（batch1-scoring）、RIFT-90（batch3-target-plan）、RIFT-120（batch4-chain-events）之后的 hold 发射与战场能力注册。不近似实现。",
  sourceText: "When you hold here, if you have 7+ units here, you win the game.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        filter: { event: "hold", here: true, player: "controller" },
        // 383.4.d + 053.3: "if you have 7+ units here" guards the whole effect;
        // it belongs to the hold Condition, not to the win instruction
        // (135.2.b.6: instructions do not include trigger conditions).
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "units",
            filter: {
              type: "unit",
              controller: "controller",
              zone: "board",
              sameLocationAs: "self"
            }
          },
          operator: "gte",
          right: { kind: "constant", value: 7 }
        }
      },
      optional: false,
      body: [
        {
          // 195: the effect instructs the holding player to win; no player
          // argument means the ability controller (the player who held).
          id: "grand-plaza.win",
          op: "effect.win",
          args: {}
        }
      ]
    }
  ]
} satisfies CardProgram;
