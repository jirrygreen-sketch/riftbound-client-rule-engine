import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Helm of Suppression (ven-045-166) — Gear, 4 Energy, 1 Calm Power, Might null
 * (no printed Might), Calm, no tags.
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json, ven-045-166）：
 *   "[Empower] :rb_energy_4::rb_rune_calm: (:rb_energy_4::rb_rune_calm:: Empower this.
 *    Use only if not Empowered.)\n"
 *   "Opponents' spells cost :rb_energy_1: more. If this is [Empowered], they cost
 *    :rb_energy_1::rb_rune_rainbow: more instead."
 *
 * 规则依据（CR v1.5）：
 * - 827.1 / 827.1.a / 827.1.c：Empower 是启动式能力关键词，印在永久物上，格式
 *   "Empower [Cost]"；本卡印刷费用为 4 Energy + 1 Calm Power；827.1.c.1 功能等价于
 *   "[费用]：Empower this。仅当未 Empowered 时启动。"；827.1.b.1 明确来源不是目标。
 * - 442.1 / 442.2：Empower 把 Board 上的对象变为 Empowered 状态。
 * - 828.1.a–828.1.c：[Empowered][>] 是 Dependent Keyword；从关键词到子句末尾整段是
 *   Empowered 能力（828.1.b），等价于"只要我拥有 Empowered 状态，此牌获得 [Text]"，
 *   并按 828.1.c 在该状态下 Active。
 * - 356.3："cost … more" 是费用增加（Increase），在 Finalize 的「3. Apply cost increases」
 *   步骤结算，是持续性的被动费用改写（364.2 陈述事实、365.1 永久物被动能力在其停留
 *   Board 期间生效）；740.1.b 的 enemy 决定 "Opponents' spells" 指对手施放的法术。
 * - 135.2.e.5 / 135.2.e.5.a：:rb_rune_rainbow: 是任意域 Power [A]，作为费用可由任意域
 *   Power 支付；"instead" 表示 Empowered 时把 +1 Energy 替换为"+1 Energy 与 +1 [A]"，
 *   不是两者同时叠加。
 *
 * status = judge-required（缺口逐个列出，均不近似实现）：
 * 复核（2026-10-17，RIFT-613 第三轮 M2 覆盖率复核，实测见 test.mjs 的 probe 用例）：
 * 1. Empower/Empowered 关键词已合入（effects/keywords/Empower.ts，RIFT-593 已 merge），
 *    但卡侧印刷费用仍未到达展开：冻结的 KeywordAbility 只有 keyword/value，
 *    programs/keywords.ts 的 expandProgram 只向 def.expand 传 value/host，实测本卡
 *    Empower 展开出的 activated.cost 是 { kind: "empower" }（无 4 Energy + 1 Calm Power，
 *    costDomain 仍只是描述性扩展字段），且在 describeActivate 的 translateCost 里被拒
 *    （"Unsupported cost kind empower"）。
 * 2. 费用增加没有 static→费用计划的消费方：ProgramStaticBinder.staticTarget 对
 *    appliesTo "spell-play-cost" 抛 "Unsupported static appliesTo"（实测两条 static 都
 *    在 programs/statics.ts 被拒），cost/cost-plan.ts 的 buildCostPlan 只应用调用方显式
 *    传入的 CostPlanInput.increases；chain/engine.ts 的 Finalize 也从不从已绑定 static
 *    推导 increases。effects/instructions/cost.modify.ts 已注册，但它是卡牌指令，不是本
 *    卡的 static 路径。
 * 3. "If this is [Empowered]" 缺可求值谓词：实测 expression 常量串 self-is-empowered 直接
 *    求真为 true（不读状态），object-property "empoweredCount" 抛 MissingInformation
 *    （ObjectSnapshot 在 effects/contract.ts 里不声明 Empowered 计数）；两个分支因此既不能
 *    互斥也不能按状态求值，本卡 IR 目前用该常量串描述性占位并如实记为缺口。
 * 已支持部分：[A]（135.2.e.5.a / 163.2.b）可用 kind:"power" 与六域 allowedDomains
 * 表达并分配支付资源；golden 覆盖各域 Power 对该增加分量的支付分配，无需新增 Domain 值。
 * 依赖：KeywordAbility 印刷费用参数承载 + expandProgram params.cost 转发、static 费用改写
 * 进费用计划的消费方（appliesTo 绑定）、可求值的 Empowered 状态谓词（进行中任务 RIFT-359）。
 */
/**
 * 827.1.c：印刷 "Empower 4 Energy + 1 Calm Power"。value 记印刷 Energy 数量 4，costDomain
 * 记 Power 的领域（沿用 sfd/long-sword 的扩展字段先例；契约 3.8.3 的 params.cost 通道未合入）。
 */
const empower = {
  kind: "keyword",
  keyword: "empower",
  value: 4,
  costDomain: "Calm"
} as const;

const abilities: Ability[] = [
  empower,
  {
    // 356.3：默认分支 "Opponents' spells cost [1] more"——对手施放的法术 +1 Energy。
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      resource: "energy",
      // 增加分量用正数（356.3 的 Apply cost increases；356.6 的下限只约束折扣）。
      amount: { kind: "constant", value: 1 },
      appliesTo: "spell-play-cost",
      // 740.1.b："Opponents' spells" 是能力控制者的对手施放的法术。
      filter: { type: "spell", controller: "opponent" }
    },
    // "If this is [Empowered]"：Empowered 谓词（828.1.c）当前没有可求值形状，
    // 仅记录描述性条件；非空字符串不查询状态，不能作为运行时门控的执行证据。
    condition: {
      kind: "not",
      condition: {
        kind: "expression",
        value: { kind: "constant", value: "self-is-empowered" }
      }
    }
  },
  {
    // "…if this is [Empowered], they cost [1][A] more instead."："instead" 把默认分支的
    // +1 Energy 换成 +1 Energy 与 +1 任意域 Power；insteadOf 只作评审标记（记录被替换的
    // 是上面那条默认分支），真实语义由互斥条件求值，不产生额外叠加。
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      resource: "energy",
      amount: { kind: "constant", value: 1 },
      appliesTo: "spell-play-cost",
      filter: { type: "spell", controller: "opponent" },
      insteadOf: { kind: "constant", value: "helm-of-suppression-base-increase" },
      additionalPower: {
        // 135.2.e.5.a / 163.2.b：[A] 可由任意域 Power 支付。该六域资格集合对应
        // 费用计划的 power payment.allowedDomains；static → 费用计划的绑定仍缺失。
        kind: "constant",
        value: {
          amount: 1,
          eligibleDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]
        }
      }
    },
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "self-is-empowered" }
    }
  }
];

export default {
  canonicalCardId: "card.hash-c78464f75c9c394d39ba60be62b2e010158f2a4a17cebed21a59e9bf42bd8207",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现（2026-10-17 RIFT-613 复核实测）：(1) Empower/Empowered 关键词已合入" +
    "（effects/keywords/Empower.ts），但卡侧印刷费用没有到达展开：KeywordAbility 只有 keyword/value，" +
    "programs/keywords.ts 的 expandProgram 只传 value/host，实测本卡展开出的 activated.cost 是 " +
    "{ kind: \"empower\" }（不含 4 Energy + 1 Calm Power，costDomain 只是描述性字段），" +
    "translateCost 随后以 \"Unsupported cost kind empower\" 拒绝该启动费用。(2) 费用增加（356.3）没有 " +
    "static→费用计划的消费方：ProgramStaticBinder.staticTarget 对 appliesTo \"spell-play-cost\" 抛 " +
    "\"Unsupported static appliesTo\"（实测两条 static 均被拒），buildCostPlan 只应用调用方显式传入的 " +
    "CostPlanInput.increases，chain/engine.ts 的 Finalize 也不从已绑定 static 推导 increases；" +
    "effects/instructions/cost.modify.ts 已注册，但那是卡牌指令而非本卡的 static 路径。(3) 『If this is " +
    "[Empowered]』缺可求值谓词：expression 常量串 self-is-empowered 直接求真为 true（不读状态），" +
    "object-property \"empoweredCount\" 抛 MissingInformation（ObjectSnapshot 在 effects/contract.ts " +
    "里不声明 Empowered 计数），两个分支既不能互斥也不能按状态求值。已支持部分：Empowered 分支的 " +
    ":rb_rune_rainbow: 是任意域 Power [A]" +
    "（135.2.e.5.a/163.2.b），费用计划支持 kind:power 与六域 allowedDomains，并由 golden 覆盖支付分配。" +
    "依赖 KeywordAbility 印刷费用参数承载与 expandProgram 转发、static 费用改写进费用计划的消费方、" +
    "可求值的 Empowered 状态谓词（进行中任务 RIFT-359）。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_4::rb_rune_calm: (:rb_energy_4::rb_rune_calm:: Empower this. Use only if not Empowered.)\n" +
    "Opponents' spells cost :rb_energy_1: more. If this is [Empowered], they cost :rb_energy_1::rb_rune_rainbow: more instead."
} satisfies CardProgram;
