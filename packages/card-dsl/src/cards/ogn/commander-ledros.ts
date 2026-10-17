import type { CardProgram } from "../../ir/index.js";

/**
 * Commander Ledros (ogn-231-298) - Unit, Order, Spirit/Shadow Isles (M2 unit shard 12).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-231-298):
 *   As you play me, you may kill any number of friendly units as an additional
 *   cost. Reduce my cost by :rb_rune_order: for each killed this way.
 *   [Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell
 *   or ability.)
 *   [Ganking] (I can move from battlefield to battlefield.)
 *
 * 规则依据（CR v1.5）：
 * - 204.2 / 204.2.a：Additional Cost，写在 "as an additional cost" 里，必须在 finalize
 *   卡牌时支付。
 * - 356.2 / 356.2.b / 356.2.b.1：可选附加费用（"may"）在第 2 步由控制者声明是否支付；
 *   356.4.f.1：可选附加费用"已支付"看的是玩家是否做出支付决定（不要求消灭实际发生）。
 * - 356.4 / 356.4.b / 356.4.f：按数量的减费属于费用计划的 discount 步骤
 *   （CR 1931 行例子："As you play me, you may pay ... If you do, reduce my cost by ..."）。
 * - 429.1.a.1.a / 429.3：以费用形式指示的消灭也是 Kill Instruction；只有游戏效果指示时才能消灭。
 * - 355.10.c：只作为费用（或触发条件、替代效果）出现的对象不指向目标，因此
 *   "kill any number of friendly units" 在本卡里是费用选择而不是目标选择。
 * - 809.1 / 809.1.b.3：Deflect 未写数值时按 Deflect Value = 1；809.1.c / 356.2.a.2 是对选择本
 *   永久物的对手法术/能力追加的 Mandatory Additional Cost。
 * - 810.1 / 810.1.b / 144.4.c.1：Ganking 是给单位 Standard Move 增加
 *   battlefield-to-battlefield 许可的被动能力。
 *
 * status: judge-required —— 四处依赖未合入，均不近似实现：
 * 1. 可选附加费用的 cost kind、kill payment 和 cost.pay 均存在，但 programs/play.ts
 *    仍拒绝 CardProgram 的 additional-cost/optional 字段，不能把选择与“killed this way”回执
 *    送入生产费用计划；
 * 2. 按数量减费（每只 1 个 Order Power）仍缺卡牌程序到费用计划的数量链接；
 * 3. [Deflect] 的 target.tax 展开存在，target-plan 也能收集 taxAdapter 请求，但没有把卡牌
 *    static 声明接到目标 Finalize，且当前链路把税转换成 Energy，不能表达无域 Power [A]；
 * 4. [Ganking] 的 continuous.movement 展开和 static binder 均已存在，但 KeywordDef 使用
 *    标量 permission，而 movement() 查询要求 normalized permission.routes，当前注册结果无法
 *    被规则查询消费。
 *
 * 结构：abilities[0] 声明两个关键词；abilities[1] 是 play 能力，其 cost 描述可选附加费用
 * （kill，any number，friendly unit）与折扣（每只 1 个 Order Power）；body 为空——
 * 本卡的正文全部属于费用与关键词，不在结算期产生指令。
 */
const commanderLedros = {
  canonicalCardId: "card.hash-c80681881ea8ea46056b7e0beb729fa6209936934189d25a1dda9a04ebf36b79",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处依赖未合入：(1)「you may kill any number of friendly units as an additional cost」的 cost kind、kill payment 与 cost.pay 已存在，" +
    "但 programs/play.ts 仍拒绝 CardProgram 的 additional-cost/optional 字段，无法把选择和「killed this way」回执接入生产费用计划（204.2.a / 356.2.b.1）；" +
    "(2)「Reduce my cost by [C] for each killed this way」缺卡牌程序 → 费用计划的接线与数量链接" +
    "（356.4 折扣；buildCostPlan 只消费调用方传入的 discounts）；" +
    "(3) [Deflect] 的 target.tax 展开（809.1.c / 356.2.a.2）没有接入卡牌 static 的目标 Finalize：target-plan 能收集 taxAdapter 请求，" +
    "但当前链路把税转换成 Energy，不能表达无域 Power [A]；" +
    "(4) [Ganking] 的 continuous.movement 展开和 static binder 均已存在，但 KeywordDef 的标量 permission 与 movement() 所需的 normalized permission.routes 不匹配，注册结果无法被规则查询消费。" +
    "依赖：CardProgram → CostPlanInput/discount 数量链接、target.tax 的无域 Power 支付，以及 Ganking permission 的 routes 归一化。",
  sourceText:
    "As you play me, you may kill any number of friendly units as an additional cost. Reduce my cost by :rb_rune_order: for each killed this way.\n" +
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "[Ganking] (I can move from battlefield to battlefield.)",
  abilities: [
    { kind: "keyword", keyword: "deflect", value: 1 },
    { kind: "keyword", keyword: "ganking" },
    {
      kind: "play",
      cost: {
        kind: "additional-cost",
        optional: true,
        // 355.10.c：只作为费用出现的对象不指向目标；这里用 choice（非目标选择）声明数量与对象。
        payments: [
          {
            kind: "kill",
            choice: {
              id: "commander-ledros.killed-units",
              options: ["friendly-unit"],
              filter: { type: "unit", zone: "board", controller: "controller" },
              // 355.13："any number" 含 0 个。
              min: 0,
              selection: "any"
            }
          }
        ],
        // 356.4：按 "killed this way" 的数量减费；数量由费用收取记录提供。
        discount: {
          resource: "power",
          domains: ["Order"],
          amountPerKilled: 1,
          killedBy: "commander-ledros.killed-units"
        }
      },
      body: []
    }
  ]
} satisfies CardProgram;

export default commanderLedros;
