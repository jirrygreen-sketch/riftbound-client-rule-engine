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
 * 复核（2026-10-17，第二轮 M2 覆盖率复核）：旧 judgeReason 的「effects/instructions
 * 也没有 cost.modify 原语（RIFT-9 清单要求，属 RIFT-89）」已不成立：
 * effects/instructions/cost.modify.ts 已注册（它是卡牌指令，不是 static → 费用计划
 * 的消费方；本卡第 2 条缺口与它无关，保持不变）。
 * 1. effects/keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef：
 *    827.1.c.1 的起动费用、442.1.b / 827.1.c.5 的"仅当未 Empowered"限制、以及 828.1.c
 *    的 Dependent Ability 状态门控都没有展开实现；完整程序绑定实测
 *    「Keyword empower has no executable KeywordDef」。
 * 2. 费用增加没有消费方：cost/cost-plan.ts 的 buildCostPlan 只在调用方显式传入
 *    CostPlanInput.increases 时应用「3. Apply cost increases」（356.3）；没有任何已合入
 *    路径把 CardProgram 的 static 费用改写送进被施放法术的费用计划
 *    （ProgramStaticBinder.staticTarget 对 appliesTo "spell-play-cost" 抛
 *    「Unsupported static appliesTo」，实测 activeEffects = 0）。
 * 3. [A]（任意域 Power）在封闭的六域 Domain 集合（Fury/Calm/Mind/Body/Chaos/Order）里
 *    没有对应值：163.2.b / 135.2.e.5.a 要求"任意域均可支付"，用某个具体域书写就是近似
 *    （effect.resources 已记录同一缺口）。本程序以彩虹域列表描述该分支，不写成单域。
 * 4. "If this is [Empowered]" 需要可求值的 Empowered 谓词；冻结的 Condition 只有
 *    always/never/expression/compare/all/any/not，ObjectSnapshot 也不暴露 Empowered 状态。
 * 依赖：新增 Empower/Empowered 关键词任务、static 费用改写进费用计划的消费方
 * （appliesTo 绑定）、[A] 的可支付表示、Empowered 状态谓词（进行中任务 RIFT-359）。
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
    // 只以具名谓词记录，不写成恒真或硬编码。
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
        // 135.2.e.5.a / 163.2.b：[A] 可由任意域 Power 支付。封闭六域集合里没有
        // Universal Power 值，故以彩虹域的全部六域作为"任意域"的支付集合描述，
        // 绝不退化成某个具体域。
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
    "四处缺口，均不近似实现：(1) 没有 Empower/Empowered KeywordDef：827.1.c.1 的起动费用" +
    "（4 Energy + 1 Calm Power，来源非目标）、442.1.b/827.1.c.5 的『仅当未 Empowered』限制、" +
    "828.1.c 的 Dependent Ability 门控都无展开（完整程序绑定实测 Keyword empower has no " +
    "executable KeywordDef）；(2) 费用增加（356.3『Apply cost increases』）没有 static→费用计划的消费方：" +
    "cost/cost-plan.ts 只在调用方显式传入 CostPlanInput.increases 时应用，" +
    "ProgramStaticBinder.staticTarget 对 appliesTo \"spell-play-cost\" 抛 Unsupported static appliesTo" +
    "（实测 activeEffects = 0）；effects/instructions/cost.modify.ts 指令原语已注册，" +
    "但那是卡牌指令，不是本卡的 static 费用改写路径；(3) Empowered 分支的 :rb_rune_rainbow: 是任意域 Power [A]" +
    "（135.2.e.5.a/163.2.b），封闭六域 Domain 集合没有可支付的通用值，用单一域书写即为近似；" +
    "(4) 『If this is [Empowered]』缺可求值谓词：冻结的 Condition 只有 always/never/expression/" +
    "compare/all/any/not，生产 ObjectSnapshot 也不暴露 Empowered 状态，具名 expression 谓词在测试内核恒真、" +
    "在生产解释器抛 MissingInformation，不能作为可执行证据。依赖新增 Empower/Empowered 关键词任务、" +
    "static 费用改写进费用计划的消费方（appliesTo 绑定）、[A] 的可支付表示、" +
    "Empowered 状态谓词（进行中任务 RIFT-359）。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_4::rb_rune_calm: (:rb_energy_4::rb_rune_calm:: Empower this. Use only if not Empowered.)\n" +
    "Opponents' spells cost :rb_energy_1: more. If this is [Empowered], they cost :rb_energy_1::rb_rune_rainbow: more instead."
} satisfies CardProgram;
