import type { CardProgram } from "../../ir/index.js";

/**
 * The Dreaming Tree (ogn-292-298) — Battlefield, Colorless.
 *
 * sourceText:
 *   When a player chooses a friendly unit here with a spell for the first time
 *   each turn, they draw 1.
 *
 * CR v1.5 anchors:
 * - 383.4.b / 383.4.b.1 / 383.4.b.3: "When … chooses …" is a Targeting Effect
 *   (a triggered ability whose condition is a Game Object becoming targeted);
 *   355.6/355.7 own what counts as targeting (picks are not targets).
 * - 383.3.e / 383.3.e.1: "for the first time each turn" is the once-per-turn
 *   trigger lifetime; the frozen TriggerSpec expresses it as once: "per-turn".
 * - 414.1/414.3: "they draw 1" is an ordinary draw by the choosing player.
 * - 053.3: "here" refers to this Battlefield.
 *
 * Status: judge-required. The merged became-target timing point is really
 * emitted by the chain (chain/engine.ts, TargetPlan finalization), and the draw
 * body runs through the reference kernel in the golden test, but the ability
 * cannot execute:
 * - "they draw 1" must draw for the player who did the choosing (the spelling
 *   player's controller). The frozen TriggerSpec/ResolveContext exposes no
 *   event-payload binding to the ability body, so only a placeholder pick (the
 *   same device Minefield uses for its miller) can name the drawer;
 * - "with a spell" and "here" would need the trigger's source-type gate and the
 *   053.3 referent anchored to this Battlefield. EventPattern.source is typed,
 *   but the merged pipeline emits became-target without a spell-type
 *   discriminator, and the engine's matchers implement no sameLocationAs anchor:
 *   an event that satisfies "a friendly unit becoming targeted by a spell"
 *   cannot be told apart from one at another Battlefield, and the filter would
 *   over-trigger. Writing it without those gates would be the approximation;
 * - no merged subscriber turns a CardProgram's triggered ability into a
 *   TriggerRegistration, and the controller of a Battlefield ability (190.6) is
 *   not resolved for a battlefield program.
 */
export default {
  canonicalCardId: "card.hash-a1fe32c7a5d6ccb45f7a6ad5b46788ec7aef047cd24e116d3ffa028b28a7f1c8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "“they draw 1”必须为做出选择的玩家（该法术的控制者）抽牌，但冻结的 TriggerSpec / ResolveContext 没有把触发事件载荷绑定进能力体的通道，" +
    "只能像 minefield 的 miller 那样用一个占位 pick 命名抽牌者（383.4.b.2 的 Targeting Effect 载荷未落地）；“with a spell” 需要事件来源为法术的门" +
    "（EventPattern.source 虽被类型化，但 pipeline 发出的 became-target 载荷不带法术类型判别），053.3 的 “here” 需要锚定到本战场——引擎匹配器不实现" +
    "sameLocationAs 等锚点：无法把“友方单位在本战场被法术指定为目标”与其他战场的事件区分开，按现状实现会过度触发（不得据此标 executable）；此外没有已合入的订阅方把 CardProgram 的 triggered ability" +
    "注册为 TriggerRegistration，战场卡作为能力来源的控制器（190.6）也未解析。依赖：RIFT-64（inspect/targeting 载荷）、RIFT-90（batch3-target-plan）、" +
    "RIFT-120（batch4 链与事件单管线）之后的战场能力注册与事件载荷绑定。不近似实现。",
  sourceText: "When a player chooses a friendly unit here with a spell for the first time each turn, they draw 1.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        // 383.4.b: a Targeting Effect. The target filter keeps the "friendly
        // unit here" scope; sameLocationAs carries the 053.3 "here" referent
        // and "friendly" is relative to the chooser, which the became-target
        // payload already determines. 740.1.a: friendly means sharing a
        // controller with the player who did the choosing.
        at: "became-target",
        filter: {
          event: "became-target",
          target: { type: "unit", sameLocationAs: "self" },
          source: { type: "spell" },
          player: "any"
        },
        once: "per-turn"
      },
      optional: false,
      body: [
        {
          // 414.3: draw 1 for the choosing player. The drawer travels as a
          // non-target pick supplied by the trigger-payload binding that is
          // still missing (see judgeReason); Minefield uses the same device for
          // its instructed player.
          id: "dreaming-tree.draw",
          op: "effect.draw",
          args: {
            amount: { kind: "constant", value: 1 },
            pick: { kind: "constant", value: "dreaming-tree.chooser" }
          },
          picks: [
            {
              id: "dreaming-tree.chooser",
              options: ["choosing-player"],
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;
