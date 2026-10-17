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
 * 1. 可选附加费用 "kill any number of friendly units" 需要 cost.additional / cost.sacrifice
 *    指令原语（把消灭作为费用收取，并记录 "killed this way" 的数量承诺与可选支付决定，RIFT-261）；
 * 2. 按数量减费（每只 1 个 Order 符文）需要卡牌程序 → 费用计划的接线与数量链接
 *    （356.4、RIFT-257）；已合入的 buildCostPlan（RIFT-89）接受 discounts，但只消费调用方传入的输入；
 * 3. [Deflect] 的展开（target.tax）没有读取方：RIFT-90 的 target-plan 已提供 taxAdapter 通道，
 *    但没有任何代码读取卡牌 static 能力声明的 target.tax（卡牌 static 绑定 RIFT-257），
 *    且任意域 Power [A] 的支付路径属 RIFT-261；
 * 4. [Ganking] 的 continuous.movement 展开存在，但卡牌 static 绑定（RIFT-257）与移动系统读取
 *    路径均未接线。
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
    "四处依赖未合入：(1)「you may kill any number of friendly units as an additional cost」缺附加费用指令原语" +
    "（cost.additional / cost.sacrifice：把消灭作为费用收取并保留「killed this way」的数量承诺，204.2.a / 356.2.b.1，RIFT-261）；" +
    "(2)「Reduce my cost by [C] for each killed this way」缺卡牌程序 → 费用计划的接线与数量链接" +
    "（356.4 折扣；已合入的 buildCostPlan 只消费调用方传入的 discounts，RIFT-257）；" +
    "(3) [Deflect] 的 target.tax 展开（809.1.c / 356.2.a.2）没有读取方：RIFT-90 的 target-plan 已提供 taxAdapter 通道，" +
    "但没有任何代码读取卡牌 static 能力声明的 target.tax（卡牌 static 绑定 RIFT-257），任意域 Power [A] 的支付路径属 RIFT-261；" +
    "(4) [Ganking] 的 continuous.movement 展开存在，但卡牌 static 绑定（RIFT-257）与移动系统读取路径均未接线。" +
    "依赖：RIFT-257（CardProgram 绑定/费用接线）、RIFT-261（cost.pay 与任意域 Power）。",
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
