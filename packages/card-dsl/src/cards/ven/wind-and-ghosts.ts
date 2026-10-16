import type { CardProgram } from "../../ir/index.js";

/**
 * Wind and Ghosts（ven-106-166）— Spell，3 Energy + 1 Chaos Power，领域 Chaos。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-106-166，逐字）：
 *   "[Action] (Play on your turn or in showdowns.)\n"
 *   "Choose a unit at a battlefield. If it has 3 :rb_might: or less, banish it.
 *    Otherwise, return it to its owner's hand."
 *
 * 规则依据（Core Rules v1.5）：
 * - [Action]（806.1 / 159.2.a）：许可类关键词，可在任意玩家回合的 Showdown 期间打出；卡只声明关键词，
 *   展开与链准入归 effects/keywords/Action.ts 与 chain（契约 3.7），提示文字本身无规则效果（135.2.d.3）。
 * - "Choose a unit at a battlefield."：被点名的单位是 Target（355.7 / 355.9.a.1 的 unit 指 Board 对象）；
 *   "at a battlefield" 只是目标限制（355.10.b 的原文例子："Kill a unit at a battlefield" 目标是单位，
 *   不是战场），用已合入的 location 过滤键表达（layers/filter.ts 比较 location.type）。
 * - "If it has 3 :rb_might: or less, banish it. Otherwise, return it to its owner's hand."：
 *   分支判定读的是选定目标的当前有效 Might（143.2.a），不是玩家的选择，因此两条指令各自带条件
 *   （契约 3.4：条件只作用于所在指令）；"Otherwise" 就是同一比较的否定，两分支互斥（同 ogn-225-298
 *   Solari Chief、rad-064-167 Scrutinizing Scope 的写法，不写 choice.mode）。
 * - "banish it"：428.1/428.2 把该永久物放进其拥有者的 Banishment（428.2.a/.b：不是 Kill 也不是 Discard）。
 * - "return it to its owner's hand"：区域移动（448.2），目的地是拥有者的手牌；动作层按拥有者路由
 *   （108.1），卡牌不写玩家参数。
 *
 * status = judge-required（两处缺口，均不近似实现）：
 * 1. "with 3 :rb_might: or less" 的 Might 阈值不可执行：冻结的 ObjectFilter 没有 Might 谓词，已合入过滤器
 *    （layers/filter.ts 的 matchesObjectFilter、参考内核的 matchesFilter）只按
 *    type/types/zone/location/controller/owner/states/tags/characteristics 匹配——描述性 mightLte 会被静默忽略，
 *    那会让任意单位都进入"3 或以下"分支（同 sfd-158-221 Sandshifter、ogn-169-298 Gust 的记录）；
 *    143.2.a 的有效 Might 读数与阈值谓词属 RIFT-83/RIFT-91 的 Mighty 类批次。
 * 2. 分支条件里的 Might 比较同样依赖该读数：条件表达式只能读 ObjectSnapshot 的现有字段（读 might 是可行的，
 *    但"3 或以下"的合法性判定必须与目标限制一致，且 143.2.a 要求的是图层计算后的有效 Might，当前 ObjectSnapshot
 *    的 might 由图层引擎提供、条件管线（RIFT-90/91）未接线到卡牌条件）。因此即使分支写得出，也不能声称整卡可执行。
 * 依赖：RIFT-83/RIFT-91（Might 谓词与有效 Might）、RIFT-90（条件/目标计划接线）。
 * 已合入部分：effect.banish（428.1/428.2）与 effect.zone（448.2 的拥有者手牌路由）本体，golden 用真实原语
 * 分别执行"放逐"与"回到拥有者手牌"两个已支持半段（含目标失效 ignored 与敌方牌回敌方手牌的边界）。
 */
const windAndGhosts = {
  canonicalCardId: "card.hash-0ee067030c4b375395ac5d95f7243ff4e4e3a7cbb6f6147ab14d3e2b30998d9f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1)「with 3 :rb_might: or less」的 Might 阈值不可执行——冻结的 ObjectFilter 没有 Might 谓词，" +
    "已合入过滤器只按 type/types/zone/location/controller/owner/states/tags/characteristics 匹配，描述性 mightLte 会被静默忽略，" +
    "从而让任意单位都进入「3 或以下」分支（同 sfd-158-221 Sandshifter / ogn-169-298 Gust），143.2.a 的有效 Might 阈值属 RIFT-83/RIFT-91；" +
    "(2) 两条分支的 Might 比较同样依赖该读数与卡牌条件管线——没有任何已合入路径把图层计算后的有效 Might 接到 CardProgram 的 condition" +
    "（RIFT-90/RIFT-91），因此条件分支不能声称已可执行。" +
    "已合入部分：effect.banish（428.1/428.2）与 effect.zone（448.2 的拥有者手牌路由，108.1）本体，golden 用真实原语分别执行两个半段" +
    "（含目标失效 ignored 与敌方牌回敌方手牌）。依赖：RIFT-83/RIFT-91（Might 谓词与有效 Might）、RIFT-90（条件/目标计划接线）。不近似实现。",
  abilities: [
    // 806.1 / 159.2.a：印刷 [Action]，许可类关键词，展开归 Action.ts。
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        // 印刷费用 3 Energy + 1 Chaos Power（catalog energy=3, power=1, domains ["Chaos"]）。
        energy: { kind: "constant", value: 3 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "wind-and-ghosts.banish-if-small",
          op: "effect.banish",
          // "If it has 3 :rb_might: or less, banish it."：以选定目标的当前 Might 分流（143.2.a）。
          // 该比较读的是 ObjectSnapshot 的 might 字段；阈值判定与目标限制的一致性仍依赖缺失的
          // Might 谓词/条件管线（见 judgeReason），故该指令不参与 golden 执行。
          condition: {
            kind: "compare",
            left: {
              kind: "object-property",
              object: { target: "wind-and-ghosts.unit" },
              property: "might"
            },
            operator: "lte",
            right: { kind: "constant", value: 3 }
          },
          args: {
            objects: { kind: "constant", value: { target: "wind-and-ghosts.unit" } },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "wind-and-ghosts.unit",
              // "a unit at a battlefield"：Board 上的单位（355.9.a.1），"at a battlefield" 是目标限制
              // （355.10.b），战场本身不是目标。
              filter: { type: "unit", zone: "board", location: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "wind-and-ghosts.return-otherwise",
          op: "effect.zone",
          // "Otherwise, return it to its owner's hand."：同一比较的否定，两分支互斥；
          // 目的地是拥有者手牌，由动作层按拥有者路由（108.1 / 448.2）。
          condition: {
            kind: "not",
            condition: {
              kind: "compare",
              left: {
                kind: "object-property",
                object: { target: "wind-and-ghosts.unit" },
                property: "might"
              },
              operator: "lte",
              right: { kind: "constant", value: 3 }
            }
          },
          args: {
            target: { kind: "constant", value: "wind-and-ghosts.unit" },
            to: { kind: "constant", value: "hand" },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "wind-and-ghosts.unit",
              filter: { type: "unit", zone: "board", location: "battlefield" },
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
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Choose a unit at a battlefield. If it has 3 :rb_might: or less, banish it. " +
    "Otherwise, return it to its owner's hand."
} satisfies CardProgram;

export default windAndGhosts;
