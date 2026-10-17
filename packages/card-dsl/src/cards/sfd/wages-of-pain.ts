import type { CardProgram } from "../../ir/index.js";

/**
 * Wages of Pain — sfd-070-221 (CR v1.5 811.1, 187.5, 184.1).
 * Damage executes through effect.damage. The Gold definition/intrinsic ability,
 * exhausted entry and complete Hidden play path still block the whole card.
 */
const wagesOfPain = {
  canonicalCardId: "card.hash-431738fdce44471075e7d0f77a009dde71d56c7be7e2c9ef022d6b124a857a3c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "effect.token 的卡牌原语路径仍缺 CR 187.5 的 Gold 定义及内建 [Reaction][>] Kill this, [E]: [Add] [A] 能力；现有 token 创建/打出管线不能用普通无能力 Gear 代替。另缺 184.1/185.2.d 的 exhausted 入场状态覆盖（entersExhausted 尚非受支持参数，事后横置不等价），以及 163.2.b 的 Universal Power 资源来源。Hidden 的 cost.hidden 尚未接通 811.1.b 的 Hide、面朝下/下回合解锁、Reaction 免费打出和 811.1.d.2 的原战场目标限制。effect.damage 子效果已可真实执行；Gold 和 Hidden 不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "deal-3",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 3 },
            target: { kind: "constant", value: "damaged-unit" }
          },
          targets: [
            {
              id: "damaged-unit",
              filter: { type: "unit", location: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "Play a Gold gear token exhausted." — authored with the token args
          // the merged primitive consumes, plus the entry-stipulation argument
          // the primitive's schema rejects. The Gold definition itself is absent
          // from the frozen table (see judgeReason).
          id: "play-gold-token",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "gold" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: { kind: "constant", value: { type: "base", player: "controller" } },
            entersExhausted: { kind: "constant", value: true },
            linkKey: { kind: "constant", value: "goldToken" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Deal 3 to a unit at a battlefield. Play a Gold gear token exhausted."
} satisfies CardProgram;

export default wagesOfPain;
