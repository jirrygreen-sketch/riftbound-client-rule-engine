import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Safety Inspector (unl-164-219) — Unit, Order, energy 5, power 1, Might 3,
 * tags Yordle/Bandle City.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-164-219，逐字）:
 *   "You may spend 3 XP as an additional cost to play me.\n"
 *   "When you play me, each player must kill one of their units. If you paid my
 *    additional cost, you don't kill a unit this way."
 *
 * 规则依据（CR v1.5）:
 * - 356.2.b / 356.2.b.1："You may spend 3 XP as an additional cost to play me" 是
 *   由被打出的卡牌自身的 Passive Ability 指定的可选附加费用（Optional Additional
 *   Cost）；决定权在打出的费用步骤（355.1 / 355.1.a），组件在 356.2 应用，XP 支付
 *   经已合入的 cost 计划（payment.ts 的 spend-xp 动作）。
 * - 356.4.f.1：可选附加费用只要玩家做了支付决定即视为"已付"，与实际扣除的数值
 *   无关；支付凭证由费用计划的 selectedAdditional 回执给出。
 * - 383.4.a / 383.4.a.1："When you play me" 是 Play Effect，时点 card-played、
 *   filter 指向本卡自身。
 * - 429.6 / 429.1.a.1："kill one of their units" 是 Kill 指令，用已合入的
 *   effect.kill；"each player must kill one of their units" 的受害者是各玩家自己
 *   控制的单位，"若我付了附加费用，我就不这样消灭单位"是同一触发里的条件从句。
 *
 * status = judge-required（缺口不近似实现）:
 * 1. 每条指令的"每个玩家各消灭一个自己的单位"需要按玩家扇出的迭代（355.10.d 的
 *    程序化集合 + 逐玩家选择）：effect.kill 只接受一个 target/picks/self 来源，
 *    IR 没有按玩家枚举的重复结构（ogn/whirlwind、sfd/the-papertree 记录同一缺口），
 *    也没有"该玩家选择自己单位"的双向选择器。
 * 2. "If you paid my additional cost" 的闸门需要读取费用计划的已付回执（356.4.f.1）；
 *    冻结 IR 没有费用结果绑定（调研记为 condition.result），无法用它 gate 本条
 *    kill 指令。
 * 3. 附加费用本身：cost 计划能收 XP（已实测），但没有 CardProgram → CostPlan 的接线，
 *    因此这块也无法端到端执行。
 * golden 里真实执行的是 effect.kill 本体（对被锁定的敌方单位）与 3 XP 的费用
 * 计划支付；其余写 test.todo。
 *
 * 依赖：RIFT-9（cost.additional / cost.sacrifice 与 condition.result）、
 * RIFT-89（费用计划接线与回执）、玩家扇出迭代（RIFT-9 target.player / 批 2）。
 */
const abilities: Ability[] = [
  {
    // 356.2.b / 356.2.b.1：可选附加费用由被打出卡牌的 Passive Ability 指定。
    kind: "static",
    effect: {
      kind: "cost.additional",
      id: "safety-inspector.additional-cost",
      appliesTo: "self",
      optional: true,
      stage: "optional-additional",
      payments: [
        {
          // 730.2：Spend XP 是减少该玩家标记的 XP；支付走费用计划的 spend-xp 动作。
          kind: "xp",
          amount: { kind: "constant", value: 3 }
        }
      ]
    }
  },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "safety-inspector.kill-unit",
        op: "effect.kill",
        args: {
          // "kill one of their units"：选择是非目标的 pick（355.10.c 的结算期选择），
          // 成员由"该玩家自己的单位"给出；按玩家扇出尚未合入（见 judgeReason），
          // 这里的 pick 只是形状与占位，不声称已实现"each player"。
          picks: { kind: "constant", value: "safety-inspector.each-player-unit" }
        },
        picks: [
          {
            id: "safety-inspector.each-player-unit",
            options: ["unit-controlled-by-each-player"],
            // "one of their units"＝由该玩家控制的一个单位；controller 选择器
            // 没有"逐玩家"取值，故只记录形状（见 judgeReason）。
            filter: { type: "unit", zone: "board", controller: "each-player" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-e6ded9cf1a86a9d78660918b257ded9725d2afb4395c59332d8c3f7d09d03eb9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) 「each player must kill one of their units」需要按玩家扇出的迭代与「该玩家在自己的单位里选一个」的" +
    "双向选择：effect.kill 只接受一个 target / picks / self 来源，IR 的 instruction 没有逐玩家重复结构，" +
    "ObjectFilter 也没有「逐玩家」的取值（ogn/whirlwind、sfd/the-papertree 记录同一缺口），故不能把" +
    "each player 折成一次单玩家 kill 近似。(2) 「If you paid my additional cost」的闸门需要费用计划的已付回执" +
    "（356.4.f.1：以玩家决定支付为准）；冻结 IR 没有费用结果绑定（调研记为 condition.result），无法用它 gate 本条 kill。" +
    "(3) 可选附加费用本身：已合入的 cost 计划能收 3 XP（golden 实测），但没有 CardProgram → CostPlan 的接线。" +
    "已可执行部分：effect.kill 本体（429.1/429.6）对被锁定单位的真实执行，以及 3 XP 费用计划的支付。" +
    "依赖：RIFT-9（cost.additional / cost.sacrifice、condition.result）、RIFT-89（费用计划接线与回执）、玩家扇出迭代。不近似实现。",
  abilities,
  sourceText:
    "You may spend 3 XP as an additional cost to play me.\n" +
    "When you play me, each player must kill one of their units. If you paid my additional cost, you don't kill a unit this way."
} satisfies CardProgram;

export default program;
