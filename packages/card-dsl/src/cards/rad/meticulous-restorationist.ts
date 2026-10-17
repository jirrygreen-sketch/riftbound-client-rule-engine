import type { CardProgram } from "../../ir/index.js";

/**
 * Meticulous Restorationist — CR v1.5 383.3.a, 206.1, 420.3/420.4.
 * Leading "you may" is represented once, by triggered.optional. The supported
 * body plays the source with an Order Power override. Re-probed 2026-10-17, two
 * boundaries remain:
 * - No Condition/Expr node binds the played card's event object to compare its
 *   printed Energy >= 7 (CR 206.1); Yordle Explorer's approach
 *   (EventPattern.details: { printedEnergyCostAtLeast }) is still fail-closed
 *   because chain/engine.ts emits card-played with object/player only, and this
 *   program has no equivalent declaration at all.
 * - programs/triggers.ts gives a permanent's card-played trigger
 *   activeZones: ["board"] (verified even when the source snapshot is in Trash),
 *   and programs/lifecycle.ts only attaches on object-enters-board / chain, so
 *   the trigger never activates from Trash. TriggeredAbility has no activeZones
 *   field for the card to declare.
 */
const program = {
  canonicalCardId: "card.hash-c53e9086202d34746759796f864fa5b794a4a294941dad556175a2e226acace5",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺 CR 206.1 的触发事件对象费用条件：需要在 card-played 时读取被打出牌的基础 Energy 并判断 >=7，当前 Condition/Expr " +
    "没有该事件对象绑定；EventPattern.details 的费用载荷路径（沿用 Yordle Explorer 的 printedEnergyCostAtLeast）仍是 fail-closed，" +
    "因为 chain/engine.ts 的 card-played 发射只带 object/player，且 PipelineHost.testTrigger 没有默认的事件条件适配。" +
    "另缺从 Trash 生效的触发范围：programs/triggers.ts 给永久物的 card-played 触发固定 activeZones: [board]（实测 source 在 trash 时仍为 [board]），" +
    "TriggeredAbility 没有声明 trash 活动区域的字段；programs/lifecycle.ts 也未在进入 trash 时安装该订阅。" +
    "必须保留「from your trash」与 383.3.a 的一次可选决定。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", player: "controller" }
      },
      optional: true,
      body: [
        {
          id: "meticulous-restorationist.play-me",
          op: "effect.play",
          args: {
            object: { kind: "object-property", object: "source", property: "ref" },
            cost: { kind: "constant", value: { finalized: true, power: ["Order"] } },
            linkKey: { kind: "constant", value: "restored" }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you play a card with Energy cost :rb_energy_7: or more, you may play me from your trash for :rb_rune_order:."
} satisfies CardProgram;

export default program;
