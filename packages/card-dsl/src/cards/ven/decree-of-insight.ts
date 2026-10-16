import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Decree of Insight (ven-061-166) — Spell, 1 energy, no printed Power/Might, domain Mind.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-061-166，逐字）：
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
 *   "Ignore [Deflect] while paying this spell's cost.\n" +
 *   "Give an enemy Body (:rb_rune_body:) unit -5 :rb_might: this turn."
 *
 * 规则依据（Core Rules v1.5）：
 * - [Reaction]（813.1 / 813.1.c）：许可类关键词，可在任意玩家的 Closed State 打出；
 *   卡侧只声明 keyword（契约 3.7），展开与链许可由 keywords/Reaction.ts 与 chain/ 负责。
 * - "Ignore [Deflect] while paying this spell's cost."：Deflect（809.1.c）是对手为选择
 *   该对象为目标而必须支付的强制附加费用；本句在支付本法术费用时跳过它（356.x 的费用
 *   计算/支付窗口）。它是打出本牌时的费用改写，不是结算期的一条效果，因此写成 static
 *   声明（target-tax 忽略）而不是 body 指令。
 * - "Give an enemy Body (:rb_rune_body:) unit -5 :rb_might: this turn."：
 *   敌方单位是 Target（355.7 / 355.9.b："enemy" 与 "Body unit" 都是目标限制）；
 *   "-5 Might this turn" 是带回合期限的临时 Might 修改，属算术图层
 *   （continuous.might + 317.2.c 到期），effect.buff 文件头明确临时 Might 修改绝不归
 *   Buff 计数器。本卡没有印刷下限（143.2.c 的“小于 0 按 0 处理”是一般规则），不写 minimum。
 *
 * status = judge-required（缺口均不近似实现）：
 * 1. 「Ignore [Deflect]」没有消费方：已合入的 Deflect 展开（effects/keywords/Deflect.ts）
 *    只声明 static target.tax，而 target tax 的读取/支付路径属 RIFT-90（TargetPlan 与
 *    费用计划的对接点为 TargetTaxAdapter.appendTargetTax()），尚无生产者把该声明接进
 *    Finalize 的目标计划；也没有已合入的“忽略目标税”原语或 CostSpec 字段
 *    （ogn/qiyana-victorious、sfd/navori-scout 记录同一缺口）。
 * 2. 「Give an enemy Body unit -5 :rb_might: this turn」的临时 Might 修改没有已合入的
 *    执行原语：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，effects/instructions/
 *    也没有注册通过 ResolveContext.addContinuous 创建 continuous.might 的 op
 *    （layers 能求值，卡牌侧无入口；RIFT-91）。
 *    另外 "Body" 作为目标限制需要按单位的领域（power 含 Body，135.2.x）过滤，而已合入的
 *    查询消费方不读 domain/power 键（layers/filter.ts 只比 type/zone/location/controller/
 *    owner/state/tags/characteristics），因此该限制也只能以具名描述保留，绝不把它当可用
 *    过滤器（未知键会被静默忽略，任意敌方单位都会变成合法目标）。
 * 依赖：RIFT-90（目标税读取与忽略）、RIFT-91（continuous.might 卡牌侧入口与到期）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "reaction" },
  {
    // "Ignore [Deflect] while paying this spell's cost." — 打出本牌时的目标税忽略声明
    // （809.1.c 的强制附加费用在支付本法术费用时跳过）；消费方未合入（见 judgeReason 第 1 点）。
    kind: "static",
    effect: {
      kind: "continuous.ignore-target-tax",
      appliesTo: "self",
      tax: { kind: "constant", value: "deflect" },
      window: { kind: "constant", value: "paying-this-spells-cost" }
    }
  },
  {
    kind: "play",
    cost: {
      kind: "cost.printed",
      energy: { kind: "constant", value: 1 }
    },
    body: [
      {
        // "Give an enemy Body unit -5 :rb_might: this turn." — 算术图层的临时 Might
        // 修正，end-of-turn 到期；创建该持续效果的 op 尚未合入（见 judgeReason 第 2 点）。
        id: "decree-of-insight.give-minus-5",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: -5 },
          duration: { kind: "constant", value: "this-turn" },
          target: { kind: "constant", value: "decree-of-insight.enemy-body-unit" }
        },
        targets: [
          {
            id: "decree-of-insight.enemy-body-unit",
            filter: {
              type: "unit",
              zone: "board",
              controller: "opponent",
              // 描述性限制，不是可求值谓词："Body unit" 需要按 power 含 Body 过滤，
              // 已合入的查询消费方不读该键（见 judgeReason 第 2 点）。
              targetRestriction: "domain-body"
            },
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
    "card.hash-f345f205e63964bf3901c9e175e8aee2a18b9ada1c14fb80568ff7dce79b66e3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1)「Ignore [Deflect] while paying this spell's cost」没有消费方：809.1.c 的 Deflect 是" +
    "对手选择该对象为目标时的强制附加费用，已合入的 Deflect 展开（effects/keywords/Deflect.ts）只声明 static target.tax，" +
    "而目标税的读取与支付属 RIFT-90（TargetPlan 与费用计划的对接点 TargetTaxAdapter.appendTargetTax()），尚无生产者把该声明接进 " +
    "Finalize 的目标计划；也没有已合入的“忽略目标税”原语或 CostSpec 字段（ogn/qiyana-victorious、sfd/navori-scout 记录同一缺口）。" +
    "(2)「Give an enemy Body unit -5 :rb_might: this turn」的临时 Might 修改没有已合入执行原语：契约 3.6 的封闭 GameAction 集合" +
    "没有 Might 修改动作，effects/instructions/ 也没有注册通过 ResolveContext.addContinuous 创建 continuous.might 的 op（layers 能求值，" +
    "卡牌侧无入口），effect.buff 只处理 CR 702 的 Buff 计数，不能近似；「Body」的目标限制还需按单位领域（power 含 Body）过滤，" +
    "而已合入的查询消费方不读 domain/power 键，故只能以具名描述 targetRestriction 保留，绝不把它当可用过滤器" +
    "（未知键会被静默忽略，任意敌方单位都会变成合法目标）。本卡没有印刷下限（143.2.c 是一般规则），不写 minimum。" +
    "依赖：RIFT-90（目标税读取与忽略）、RIFT-91（continuous.might 卡牌侧入口与到期）。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Ignore [Deflect] while paying this spell's cost.\n" +
    "Give an enemy Body (:rb_rune_body:) unit -5 :rb_might: this turn."
} satisfies CardProgram;
