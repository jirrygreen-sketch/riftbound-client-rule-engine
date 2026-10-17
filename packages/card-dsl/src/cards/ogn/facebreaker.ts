import type { CardProgram } from "../../ir/index.js";

/**
 * Facebreaker — CR v1.5 811, 806 and 424.1.
 * Hidden cost planning/payment, Action timing and both Stun effects exist.
 * Hide/facedown play needs its zone, turn and battlefield restrictions wired
 * to that cost plan. The cross-target sameLocationAs filter also needs a
 * Finalize target adapter; it is not a missing Stun primitive.
 */
const facebreaker = {
  canonicalCardId: "card.hash-87a99b58ae6328e24ded8a032bff52588b3676f3c2eec58aafc5bafaa7a78aa0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺 cost.hidden 到 Hide 行动的绑定、facedown 生命周期、下一回合起 Reaction 许可及 Hidden 法术的隐藏战场目标限制（CR 811.1.b/811.1.c/811.1.d.2）；Hidden 费用计划与支付已存在。另缺跨目标 Finalize 绑定：programs/filters.ts 不翻译 sameLocationAs；TargetSpec.location 已支持 target-location，但 Chain Finalize context 未逐项写入先前选择，第二目标仍无法读取第一目标的战场（CR 355.9.b）。chain/interpreter-adapter.ts 的 LITERAL_FIELDS 也未解包 effect.stun 的 target Expr，导致原始正文在 Chain Resolve 被原语参数校验拒绝。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 }
      },
      body: [
        {
          id: "facebreaker.stun-friendly-unit",
          op: "effect.stun",
          args: { target: { kind: "constant", value: "facebreaker.friendly-unit" } },
          targets: [
            {
              id: "facebreaker.friendly-unit",
              filter: { types: "unit", controller: "controller", location: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "facebreaker.stun-enemy-unit",
          op: "effect.stun",
          args: { target: { kind: "constant", value: "facebreaker.enemy-unit" } },
          targets: [
            {
              id: "facebreaker.enemy-unit",
              // "an enemy unit at the same battlefield": the anchor resolves
              // against the friendly unit's location, so both stuns land at
              // one battlefield on any board (contract 3.2 anchors, CR 355.5).
              filter: {
                types: "unit",
                controller: "opponent",
                sameLocationAs: { target: "facebreaker.friendly-unit" }
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Stun a friendly unit and an enemy unit at the same battlefield. (They don't deal combat damage this turn.)"
} satisfies CardProgram;

export default facebreaker;
