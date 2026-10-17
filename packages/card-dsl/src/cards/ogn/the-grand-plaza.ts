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
 * (effect.win, CR 195) and the golden test executes it; the hold timing point
 * is now really emitted by TurnFlow's Beginning Score wave (471.2 / 473.2.b).
 * What still blocks the card:
 * - the trigger registration path exists, but 190.6's "control of a
 *   Battlefield determines control of its abilities" is not resolved for
 *   battlefield programs;
 * - the trigger filter keeps the sibling battlefield spelling (here: true /
 *   player: "controller") for the 053.3 referent, which the merged
 *   translateTriggerFilter / trigger-spec layer does not resolve;
 * - the "if you have 7+ units here" clause is a condition on the hold event: the
 *   interpreter's set query implements the sameLocationAs anchor (contract
 *   3.6), and events/pipeline.ts now evaluates trigger conditions through the
 *   canonical event-aware evaluator. The condition still needs its controller
 *   placeholder and Battlefield anchor bound before the query can run in the
 *   production registration path.
 */
export default {
  canonicalCardId: "card.hash-627933b535ef66e1e1bb12785313b937e23dc2c7ac48a1ff26c8c49a94e0c233",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "“you win the game”指令本身完全可用已合入的 effect.win（CR 195）表达并在 golden 里真实执行；hold 时点也已由 TurnFlow 的 Beginning Score 波真实发出（471.2 / 473.2.b）。阻断在触发侧：" +
    "① 190.6 的战场能力控制者解析也未落地；② filter 的 here: true / player: controller 是同类战场卡占位（053.3 的 here 指代），已合入的 translateTriggerFilter / trigger-spec 不解析这两个键；" +
    "③ “if you have 7+ units here” 是 hold 事件上的触发条件：解释器的集合查询已实现 sameLocationAs 锚点（契约 3.6），" +
    "events/pipeline.ts 已有 canonical event-aware condition fallback；但 condition 的 count 过滤器仍含未绑定的 controller: \"controller\" 占位，" +
    "而触发注册的 here/controller 锚点也未解析。依赖：here/controller 归一化、条件查询的能力控制者绑定与 Battlefield 控制者解析（契约变更请求）。不近似实现。",
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
