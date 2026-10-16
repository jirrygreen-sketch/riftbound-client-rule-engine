import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Stalking Wolf (unl-166-219) — Unit, Order, energy 4, power 1, Might 6,
 * tags Dog/Freljord.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-166-219，逐字）:
 *   "[Ambush] (You may play me as a [Reaction] to a battlefield where you have
 *    units.)\nAs an additional cost to play me, kill a Bird, Cat, Dog, or Poro
 *    you control. You may play me to its battlefield (even if you don't have
 *    other units there.)"
 *
 * 规则依据（CR v1.5）:
 * - [Ambush]（822）：Passive Ability 关键词；822.1.b 功能上等于"我可以被打到你有单位
 *   的战场"+"只要被打到该战场就具有 [Reaction]"；822.1.c 把该许可加进 349 打出卡牌的
 *   Make Relevant Choices 步骤。卡程序按契约 3.7 只声明
 *   { kind: "keyword", keyword: "ambush" }，展开归关键词批次（当前没有已合入的
 *   effects/keywords/Ambush.ts，见 judgeReason）。
 * - "As an additional cost to play me, kill a Bird, Cat, Dog, or Poro you control"：
 *   356.2.a / 356.2.a.1 的强制附加费用（Mandatory Additional Cost），由被打出卡牌的
 *   Passive Ability 指定；355.10.c 明确"作为费用包含的游戏对象不是目标"，所以该
 *   kill 是费用组件（cost 计划的 kill payment kind），不是效果，也不触发"成为目标"。
 *   "Bird, Cat, Dog, or Poro" 是标签之一（133.8：标签是被文本引用时才有效义），
 *   "you control"＝费用支付者控制。
 * - "You may play me to its battlefield (even if you don't have other units there)"：
 *   这扩大的是本卡打出位置许可（355.2.b/355.2.b.1 与 822.1.c 同族）：合法位置多出
 *   "被该费用消灭的那个单位原所在地点"。
 *
 * status = judge-required（缺口不近似实现）:
 * 1. [Ambush] 没有已合入 KeywordDef：effects/keywords/ 下没有 Ambush.ts（关键词批次
 *    RIFT-81~88 不含它），合法位置与 Reaction 许可改写未落地。
 * 2. 强制附加费用需要 CardProgram → CostPlan 的接线：已合入 cost 计划能收 kill 组件
 *    （golden 实测：kill 动作按对象执行），但没有组件把卡牌的 static 费用声明接入
 *   打出的 Finalize。
 * 3. "Bird, Cat, Dog, or Poro" 的"四者之一"标签过滤：ObjectFilter 的 tags 是"全部
 *    命中"的合取（layers/filter.ts 的 tags.every 与 pipeline-match.ts 的
 *    tags.every），IR 没有析取标签形态；用单标签近似会只认一种生物（错误语义）。
 * 4. "You may play me to its battlefield" 的位置许可需要引用该费用消灭单位的原位置，
 *    没有"上一个费用对象的位置"表达式（cost 计划也无此回执）。
 * golden 里真实执行的是 kill 费用组件（经 buildCostPlan/payCostPlan 支付）与
 * effect.kill 本体；其余写 test.todo。
 *
 * 依赖：RIFT-84 / 关键词批次（Ambush 展开）、RIFT-89（费用计划与卡牌接线、
 * cost.sacrifice）、RIFT-90（打出位置许可与标签析取过滤）。
 */
const abilities: Ability[] = [
  // 822：Ambush 是 Passive Ability 关键词，卡只声明（展开归关键词批次）。
  { kind: "keyword", keyword: "ambush" },
  {
    // 356.2.a / 356.2.a.1：强制附加费用（Mandatory Additional Cost），由打出卡牌的
    // Passive Ability 指定；355.10.c：费用里的对象不是目标。
    kind: "static",
    effect: {
      kind: "cost.additional",
      id: "stalking-wolf.additional-cost",
      appliesTo: "self",
      optional: false,
      stage: "mandatory-additional",
      payments: [
        {
          kind: "kill",
          amount: { kind: "constant", value: 1 },
          choice: {
            // 355.10.c：非目标的费用选择（选择者＝支付者）。
            id: "stalking-wolf.creature",
            options: ["creature-you-control"],
            min: 1,
            max: 1,
            selection: "one",
            // 133.8：Bird / Cat / Dog / Poro 是标签；IR 的 tags 是合取，"四者之一"
            // 尚无析取形态（见 judgeReason 第 3 点），此处按原文记录候选标签
            // 集合，不被当作已实现的过滤。
            tagsAny: ["Bird", "Cat", "Dog", "Poro"],
            type: "unit",
            zone: "board",
            controller: "self"
          }
        }
      ]
    }
  }
];

const program = {
  canonicalCardId:
    "card.hash-e0d6dea411202c84bc9da351b6c16a63eb618c96e03be8274b3ff5babc3419f8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口：(1) [Ambush]（822）没有已合入 KeywordDef（effects/keywords/ 下无 Ambush.ts），" +
    "822.1.b/822.1.c 的合法打出位置与 Reaction 许可改写未落地（关键词批次 RIFT-81~88 不含它）。" +
    "(2) 强制附加费用（356.2.a / 356.2.a.1）需要 CardProgram → CostPlan 的接线：已合入的费用计划能收 kill 组件（golden 实测支付成功），" +
    "但没有任何组件把卡牌的 static 费用声明接入打出的 Finalize（RIFT-89）。" +
    "(3)「Bird, Cat, Dog, or Poro」的「四者之一」标签过滤没有 IR 形态：ObjectFilter.tags 是全部命中（合取），" +
    "用单标签近似会只认一种生物、实现成另一张卡。(4)「You may play me to its battlefield」的位置许可要引用" +
    "被该费用消灭单位的原所在地点（355.2.b），费用回执没有该位置表达式。" +
    "已可执行部分：kill 费用组件的规划与支付（429.1/429.6 的消灭动作）、effect.kill 本体。" +
    "依赖：RIFT-84 / 关键词批次（Ambush 展开）、RIFT-89（费用计划与卡牌接线、cost.sacrifice）、RIFT-90（位置许可与标签析取）。不近似实现。",
  abilities,
  sourceText:
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "As an additional cost to play me, kill a Bird, Cat, Dog, or Poro you control. " +
    "You may play me to its battlefield (even if you don't have other units there)."
} satisfies CardProgram;

export default program;
