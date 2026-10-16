import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Kennen, Storm of Shuriken (ven-113-166) — Unit, 3 Energy + 1 Chaos Power,
 * Might 4, Chaos, tags Yordle / Kennen / Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-113-166，逐字）：
 *   When you play me, [Burn 2]. (Put the top 2 cards of your Main Deck into
 *   your trash.)
 *   When I conquer, give a spell in your trash [Flow] equal to its cost this
 *   turn. (You may play it from your trash for its Flow cost. Then banish it.)
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a / 383.4.a.1 / 420.4.a：「When you play me」是 Play Effect，封闭时点
 *   "card-played"，filter 用契约 3.6 的符号选择器 { source: "self" } 指向来源本体。
 * - 441.1 / 441.2 / 441.2.a / 441.4：Burning 是「把一名玩家主牌库顶的 X 张牌移到其
 *   弃牌区」；[Burn 2] 的 X = 2，牌库不足时尽可能多地烧。已合入原语 effect.mill
 *   （RIFT-112）就是该动作：用 zoneSlice 按真实区域顺序取主牌库顶、经 perform({type:
 *   "mill"}) 提交。括号里的文字是 [Burn 2] 的提示文本（441.2 的动作格式说明），
 *   不构成第二条能力；烧牌者缺省为能力控制者（190.6.d 的 "you"）。
 * - 383.4.c / 383.4.c.1 / 473.2.a：「When I conquer」是 Conquer Effect，封闭时点
 *   "conquer"。
 * - 829.1 / 829.1.a–c / 829.1.c.1：Flow 是「以备选费用替换基础费用」的关键词；
 *   "give a spell in your trash [Flow] equal to its cost this turn" 是授予该法术一个
 *   费用等于其自身费用的 Flow 实例（829.1.c.3 的多实例规则要求各自独立）。
 *   effects/keywords/Flow.ts 已合入 KeywordDef（flow.cost 静态效果 + 离链放逐替代），
 *   但其消费方（RIFT-261 的备选费用选择、RIFT-260 的替代注册）未合入；卡牌侧也没有
 *   把 Flow 授予某对象的 continuous.grant-keyword 原语（RIFT-91）。
 * - 355.7 / 355.10.a.1：Trash 是公开区域（Public Information），"a spell in your trash"
 *   是玩家选定的公开区域对象 → TargetSpec（非 pick）。
 *
 * status = judge-required（缺口均不近似实现）：
 * 1. [Burn 2] 半段可执行（effect.mill），golden 用真实解释器 + 参考内核执行；
 * 2. 「give a spell in your trash [Flow]」需要已合入 KeywordDef 的消费方（RIFT-261 /
 *    RIFT-260）与卡牌侧的 continuous.grant-keyword 原语：effects/instructions/ 下没有
 *    该 op，卡程序无法把 Flow 授予被选法术，"equal to its cost" 也只能以
 *    { kind: "cost.printed" } 描述（费用计划尚未消费该形状）；
 * 3. conquer 时点没有生产者（scoring/ 未接入 chain/events 单管线，RIFT-120），也没有把
 *    CardProgram 的 triggered ability 注册成 TriggerRegistration 的适配器。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        // 441.1/441.2/441.4：主牌库顶 2 张进入弃牌区；烧牌者缺省为 ctx.controller。
        id: "kennen-storm-of-shuriken.burn-2",
        op: "effect.mill",
        args: { amount: { kind: "constant", value: 2 } }
      }
    ]
  },
  {
    kind: "triggered",
    trigger: {
      at: "conquer",
      filter: { event: "conquer", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        // 829.1：给被选法术一个 Flow 实例；"equal to its cost" 是其印刷费用
        // （829.1.c.1 的备选费用替换基础费用），用 { kind: "cost.printed" } 记录。
        // effects/instructions/ 下没有 continuous.grant-keyword 原语（见 judgeReason）。
        id: "kennen-storm-of-shuriken.grant-flow",
        op: "continuous.grant-keyword",
        args: {
          keyword: { kind: "constant", value: "Flow" },
          cost: { kind: "constant", value: { kind: "cost.printed" } },
          duration: { kind: "constant", value: "this-turn" }
        },
        targets: [
          {
            id: "kennen-storm-of-shuriken.spell-in-trash",
            // "a spell in your trash"：公开区域里的法术牌，由玩家选择（355.7/355.10.a.1）。
            filter: { type: "spell", zone: "trash", owner: "controller" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-f8e2a3619f710bd235f910a96127e6c5f05eb8a3971f892d3d728bab7dc7d677",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) 「give a spell in your trash [Flow] equal to its cost this turn」需要 " +
    "已合入 KeywordDef（effects/keywords/Flow.ts，829.1）的消费方与卡牌侧的授予入口：flow.cost 的备选费用选择属 " +
    "RIFT-261、离链放逐的替代注册属 RIFT-260，而 effects/instructions/ 下没有 continuous.grant-keyword 原语" +
    "（RIFT-91），卡程序无法把 Flow 授予被选法术；\"equal to its cost\"（829.1.c.1 的备选费用）只能用 " +
    "{ kind: \"cost.printed\" } 描述，费用计划尚未消费该形状。(2) 「When I conquer」的 conquer 时点" +
    "（383.4.c.2.b / 473.2.a）虽在 events/timing-points.ts 的封闭枚举中，但 scoring/（RIFT-76）未接入 " +
    "chain/events 单管线（RIFT-120），没有生产者 emit conquer，也没有把 CardProgram 的 triggered ability " +
    "注册成 TriggerRegistration 的适配器。[Burn 2] 半段（441.1/441.2/441.4）用已合入的 effect.mill 真实执行，" +
    "golden 断言主牌库顶 2 张按序进入弃牌区与牌库不足时的部分烧牌；Flow 与 conquer 两半保持 test.todo。",
  abilities,
  sourceText:
    "When you play me, [Burn 2]. (Put the top 2 cards of your Main Deck into your trash.)\n" +
    "When I conquer, give a spell in your trash [Flow] equal to its cost this turn. " +
    "(You may play it from your trash for its Flow cost. Then banish it.)"
} satisfies CardProgram;
