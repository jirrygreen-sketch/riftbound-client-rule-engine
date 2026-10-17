import type { CardProgram } from "../../ir/index.js";

/**
 * Back Off — CR v1.5 811 (Hidden), 806 (Action), 424.1 (Stun),
 * 356.1/356.2 (play origin). Stun 本体可执行；来源条件、Hidden 与链适配仍需接线。
 */
const backOff = {
  canonicalCardId: "card.hash-8976907cb3568b5c00ce51faf4a35f8342adffe884444d535f12324bb4ae3778",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（CR v1.5）：(1)「If you played this from your hand」需要 356.1/356.2 的打出来源事实；ObjectSnapshot 与 card-played 载荷未提供 playedFromHand，不能用当前位置或无条件抽牌代替。(2) Hidden 的 KeywordDef 已存在，但展开仅声明 cost.hidden；仍缺 811 的 Hide 动作、按起始回合启用面朝下打出许可及免基础费用的消费路径。cost.pay/cost.modify 和 Action 的链时机判断已合入，不再列为缺失原语。(3) chain/interpreter-adapter.ts 的 LITERAL_FIELDS 未解码 effect.stun.target，原始 body 经生产适配器时会被原语 schema 拒绝；解释器直接执行 Stun 本体的证据不能代替该接线。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "back-off.stun-unit",
          op: "effect.stun",
          args: { target: { kind: "constant", value: "back-off.stunned-unit" } },
          targets: [
            {
              id: "back-off.stunned-unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "back-off.draw-if-from-hand",
          // 「If you played this from your hand」：play origin 事实（见 judgeReason）。
          // 不含 linkedTo：抽牌不引用 Stun 的动作结果（055 / 359.3.e.11）。
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } },
          condition: {
            kind: "compare",
            left: { kind: "object-property", object: "source", property: "playedFromHand" },
            operator: "eq",
            right: { kind: "constant", value: true }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "[Stun] a unit. (It doesn't deal combat damage this turn.)\n" +
    "If you played this from your hand, draw 1."
} satisfies CardProgram;

export default backOff;
