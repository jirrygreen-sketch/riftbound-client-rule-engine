import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Atakhan (unl-170-219) — Unit, Order, energy 10, power 3, Might 7,
 * tags Noxus/Demon.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-170-219，逐字）:
 *   "You may kill a friendly unit as an additional cost to play me. If you do, I
 *    cost :rb_energy_1: less for each Energy it costs and :rb_rune_order: less
 *    for each Power it costs.\n[Ganking] (I can move from battlefield to
 *    battlefield.)\nWhen I attack, the defender must kill one of their units
 *    here."
 *
 * 规则依据（CR v1.5）:
 * - 356.2.b / 356.2.b.1：“You may kill a friendly unit as an additional cost to
 *   play me”是由被打出卡牌自身的 Passive Ability 指定的可选附加费用；355.10.c
 *   明确作为费用包含的对象不是目标。
 * - 356.4.b / 356.4.c / 356.4.c.1 / 206：减费读的是**该牌印刷/复制**的费用（206：
 *   需要判定费用时一律用印刷或复制费用；CR 用本卡作为 206 的示例：“每 1 点 Energy
 *   少 1，每 1 点 Order Power 少 1”），属于分量折扣，在 356.4 阶段应用。
 * - 356.4.f.1：可选附加费用一旦做了支付决定即算“已付”，其授予的折扣随之生效。
 * - [Ganking]（810）：Passive Ability 关键词，810.1.c 给单位的标准移动增加许可；
 *   卡程序按契约 3.7 只声明 keyword，展开归已合入的 effects/keywords/Ganking.ts。
 * - “When I attack, the defender must kill one of their units here”：383.4.e 的
 *   Attack Trigger（attack-declared 时点）；“the defender must kill”是强制指令，
 *   “here”按 359.3.f 指攻击发生时本卡所在战场，“one of their units”＝防御者控制的、
 *   同在该战场的单位。
 *
 * status = judge-required（缺口不近似实现）:
 * 1. 可选附加费用与“If you do”的凭证：没有 cost.additional 的卡牌 op，也没有
 *    CardProgram → CostPlan 的接线（已合入的 cost 计划能收 kill 组件与折扣，但
 *    不接受卡牌程序声明，cost/README.md 记录该缺口）。
 * 2. 折扣量必须读**印刷费用**（206），且要按被消灭单位的实际费用逐点换算：
 *    CostDiscount.amount 是静态 Expr，读不到“刚被作为费用消灭的对象的印刷费用”，
 *    也没有组件化折扣绑定“该可选费用已付”的闸门（356.4.f.1）。
 * 3. “the defender must kill one of their units here”需要移动/战斗流程暴露
 *    “谁是本次攻击的防御者”，并按防御者扇出强制选择 + 在“here”位置内选择；
 *    effect.kill 只接受一个 target / picks / self 来源，IR 没有按玩家枚举的重复
 *    结构；且 attack-declared 时点载荷是否带防御者身份属战斗批次（383.4.e.1
 *    的“取得 Attacker 身份”已定义，防御者身份在战斗流程里产生）。
 * golden 里真实执行的是已合入部分：effect.kill 本体（对被锁定的“here”单位）与
 * Ganking 关键词的已合入 KeywordDef 展开；其余写 test.todo。
 *
 * 依赖：RIFT-9（cost.additional / cost.sacrifice）、RIFT-89（费用计划接线、
 * 组件折扣与已付回执）、战斗批次（attack/defend 身份和 here 位置选择）。
 */
const ENEMY_UNIT_HERE = "atakhan.defender-unit-here";

const abilities: Ability[] = [
  {
    // 356.2.b / 356.2.b.1：可选附加费用（由被打出卡牌自身的 Passive Ability 指定）。
    kind: "static",
    effect: {
      kind: "cost.additional",
      id: "atakhan.additional-cost",
      appliesTo: "self",
      optional: true,
      stage: "optional-additional",
      payments: [
        {
          kind: "kill",
          amount: { kind: "constant", value: 1 },
          choice: {
            // 355.10.c：费用里的对象不是目标；选择者是支付者。
            id: "atakhan.friendly-unit",
            options: ["friendly-unit"],
            min: 1,
            max: 1,
            selection: "one",
            type: "unit",
            zone: "board",
            controller: "self"
          }
        }
      ]
    }
  },
  {
    // 356.4.b / 356.4.c / 206：由该可选费用授予的分量折扣；量读被消灭单位的印刷费用。
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      appliesTo: "self",
      resource: "energy",
      // 206：按“被支付费用的那个单位的印刷 Energy 费用”每点少 1。这里用 count 表达式
      // 保留“读取该费用对象印刷费用”的意图（合取的 filter 只作可审查记号，区域
      // cost-receipt 不是真实区域，故在依赖落地前 fail-closed；与 rad/shimmering-swimmer
      // 的 cost-receipt 占位同型），不写成静态常量近似。
      amount: {
        kind: "count",
        subject: "energy-cost-of-the-killed-unit",
        filter: { zone: "cost-receipt" }
      },
      stage: "discount",
      // 356.4.f.1：只在该可选附加费用真的被选择时生效。
      grantedBy: "atakhan.additional-cost"
    }
  },
  {
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      appliesTo: "self",
      resource: "power",
      // 206 / 135.2.e.4：印刷的 Order Power 费用，每点少 1 枚 Order Power；同样用
      // cost-receipt 占位（依赖落地前 fail-closed，不写静态常量近似）。
      amount: {
        kind: "count",
        subject: "order-power-cost-of-the-killed-unit",
        filter: { zone: "cost-receipt" }
      },
      domains: ["Order"],
      stage: "discount",
      grantedBy: "atakhan.additional-cost"
    }
  },
  // 810：Ganking 只声明，展开归 effects/keywords/Ganking.ts。
  { kind: "keyword", keyword: "ganking" },
  {
    kind: "triggered",
    trigger: {
      at: "attack-declared",
      filter: { event: "attack-declared", filter: { source: "self", player: "controller" } }
    },
    optional: false,
    body: [
      {
        id: "atakhan.defender-kills",
        op: "effect.kill",
        args: {
          // “the defender must kill one of their units here”：非目标的强制选择
          // （355.10.c 的结算期选择）；候选范围（防御者控制 + here）与按玩家扇出
          // 未合入，这里只保留形状（见 judgeReason 第 3 点）。
          picks: { kind: "constant", value: "atakhan.defender-unit-here" }
        },
        picks: [
          {
            id: ENEMY_UNIT_HERE,
            options: ["defender-unit-here"],
            // “here”＝本卡所在战场（359.3.f），用契约 3.6 的 sameLocationAs 锚点；
            // “the defender's” 的玩家求值没有 IR 形态（见 judgeReason）。
            filter: { type: "unit", zone: "board", sameLocationAs: "source" },
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
    "card.hash-828f8b87c552d0b972bcc9a40a8e2ec7760cfe5125ba1d735038c830884900c3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) 可选附加费用与其凭证：没有已注册的 cost.additional 卡牌原语，也没有 CardProgram → CostPlan 的接线" +
    "（已合入的 cost 计划能收 kill 组件，但不消费卡牌程序声明的 static 费用；RIFT-89）。" +
    "(2) 折扣量必须读被作为费用消灭单位的印刷费用（206 用本卡作示例：每 1 点 Energy 少 1、每 1 点 Order Power 少 1），" +
    "而 CostDiscount.amount 是静态 Expr，读不到该费用对象的印刷费用，也没有「仅在该可选费用已付时授予」的组件折扣闸门（356.4.f.1）。" +
    "(3)「the defender must kill one of their units here」需要战斗流程暴露本次攻击的防御者并按防御者扇出强制选择：" +
    "effect.kill 只接受一个 target / picks / self 来源，IR 没有按玩家枚举的重复结构，也没有「防御者」的过滤器取值；" +
    "「here」用 sameLocationAs 锚点已声明。已可执行部分：effect.kill 本体与已合入的 Ganking 关键词展开（810）。" +
    "依赖：RIFT-9（cost.additional / cost.sacrifice）、RIFT-89（费用计划接线、组件折扣与已付回执）、战斗批次。不近似实现。",
  abilities,
  sourceText:
    "You may kill a friendly unit as an additional cost to play me. If you do, I cost :rb_energy_1: less " +
    "for each Energy it costs and :rb_rune_order: less for each Power it costs.\n" +
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
    "When I attack, the defender must kill one of their units here."
} satisfies CardProgram;

export default program;
