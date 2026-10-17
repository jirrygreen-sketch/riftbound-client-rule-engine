import type { CardProgram } from "../../ir/index.js";

/** CR v1.5 187.11、440.2.c、441.1/441.4、829。Burn 与动态 Base 位置可执行；token 能力和 Flow 费用必须闭合后才能放开整卡。 */
const deathMark = {
  canonicalCardId: "card.hash-abf7e6ef39804eabe153a1ee70a3ec9ebdb7f4da0b7ad72855b0aa57798dd5c2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "187.11 的 Shadow Clone 仍未收录于 effect.token 的定义表，也没有把新 token 的内嵌攻击能力绑定到其实例的生产路径；不可用无能力 token 替代。Flow 仍缺卡侧费用参数与生产绑定：KeywordAbility 不承载 1 Energy + 2 rainbow Power 的 CostSpec，programs/keywords 不传 params.cost，programs/play 不把 flow.cost 接入已有 Flow 费用计划，也未将所选 Flow 实例与 829.1.b.1 的离链替代条件关联。动态控制者 Base 的 location 表达与 linked-value 绑定已合入并有执行证据；剩余 token/Flow 不闭合时不能放开整卡。此外 combat/ 尚未发出 attack-declared，需要把实际取得战斗身份的路径接入现有事件管线。",
  abilities: [
    { kind: "keyword", keyword: "flow" },
    {
      kind: "play",
      body: [
        {
          // "[Burn 3]" / "Put the top 3 cards of your Main Deck into your trash."
          // （441.1/441.2/441.4）：烧牌者缺省为能力控制者（190.6.d），
          // 主牌库顶与 Burn Out 的后续由内核拥有。
          id: "death-mark.burn-3",
          op: "effect.mill",
          args: { amount: { kind: "constant", value: 3 } }
        },
        {
          id: "death-mark.base-location",
          op: "condition.value",
          args: {
            value: { kind: "location", value: "ability-controller-base" }
          }
        },
        {
          // "Play a 0 :rb_might: Shadow Clone unit token"：440.2.c/185.2.a 的链上生成 + 打出。
          // 定义 id "shadow-clone" 不在冻结定义表内，原语会以 blockedReason negated
          // （见 judgeReason 第 1 点），不会创建替代 token。
          id: "death-mark.play-shadow-clone",
          linkedTo: "death-mark.base-location",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "shadow-clone" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: {
              kind: "linked-value",
              instructionId: "death-mark.base-location",
              key: "value"
            },
            linkKey: { kind: "constant", value: "shadowClone" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Burn 3]. (Put the top 3 cards of your Main Deck into your trash.)\n" +
    "Play a 0 :rb_might: Shadow Clone unit token. (It has \"When I attack, you may banish a unit " +
    "from your trash. If you do, give me [Assault 4] this turn.\")\n" +
    "[Flow] :rb_energy_1::rb_rune_rainbow::rb_rune_rainbow: (You may play this from your trash for its Flow cost. Then banish it.)"
} satisfies CardProgram;

export default deathMark;
