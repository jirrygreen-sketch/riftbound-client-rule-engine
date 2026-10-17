import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Solari Sunhawk (ven-122-166) — Unit, 3 Energy, Might 3, Order,
 * tags Bird / Mount Targon.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-122-166，逐字）：
 *   [Empower] :rb_energy_2: (:rb_energy_2:: Empower me. Use only if not Empowered.)
 *   [Empowered][>] I have +1 :rb_might: and [Deflect 2]. (Opponents must pay
 *   :rb_rune_rainbow::rb_rune_rainbow: to choose me with a spell or ability.)
 *
 * 规则依据（CR v1.5）：
 * - 827.1 / 827.1.c / 827.1.c.1：[Empower] 是启动能力关键词，本卡印刷形态为
 *   "Empower [2 Energy]"，功能等价于「[2]：Empower 我。仅当未 Empowered 时启动」；
 *   827.1.b.1 明确来源自身不是目标。按契约 3.7 与 README 第 5 节只声明关键词与印刷
 *   费用，不重写展开（KeywordAbility 没有 params 字段，见 judgeReason）。
 * - 828.1 / 828.1.b / 828.1.b.1 / 828.1.c：[Empowered][>] 是依赖关键词，从关键词到
 *   子句末尾整段是 Empowered 能力，功能等价于「当我拥有 Empowered 状态时，此牌获得
 *   [Text]」；是否 Active 由关键词系统按条件判定，不由卡程序手写门控。
 * - 814.1 / 814.1.b.2 / 814.1.b.3 / 814.1.c：[Deflect 2] 在此处是把印刷数值 2 的
 *   Deflect 授予宿主自身（省略数值时按 1，本卡写明 2）；809.1.b.2/809.1.b.3 的 Deflect
 *   Value 与 809.1.c/809.1.c.1 的对手附加 Power 费用由关键词展开负责。
 * - 143.2 / 143.2.a："+1 :rb_might:" 是算术图层的 Might 修正，不是 702 的 Buff 计数器。
 *
 * 复核（2026-10-17 RIFT-618 第三轮 M2 覆盖率复核；结论以源码与本任务 golden 实测为准）：
 * - Empower KeywordDef 已合入（effects/keywords/Empower.ts，RIFT-593）并会展开
 *   827.1.c.1 的启动费用与 “Use only if not Empowered” 限制；+1 Might 与 [Deflect 2]
 *   的图层产出（continuous.might / continuous.grant-keyword）也已可由生产 binder 求值。
 * - 本卡仍不能 executable：印刷的 2 Energy 无法到达 expand，Empowered 门控没有可求值谓词，
 *   且 [Deflect 2] 的税没有生产收集方。
 *
 * status = judge-required（当前真实缺口，均不近似实现）：
 * 1. 印刷的 2 Energy 无法到达 KeywordDef.expand：827.1.c.1 的费用属于启动费用，
 *   契约 3.1 的 KeywordAbility 只有 keyword/value，programs/keywords.ts 的
 *   expandProgram 调用 def.expand({ value, host }) 时不传 params.cost（契约 3.8.3）。
 *   本任务实测：展开出的费用是 { kind: "empower" }，buildCostPlan 抛
 *   CostPlanError "Unsupported cost kind: empower"，因此 2 Energy 尚未成为可支付的费用。
 * 2. 没有 Empowered 状态谓词（442.1.a/828.1.b.1）：ObjectSnapshot 没有 empowered 字段、
 *   Condition 词表也没有对应谓词，程序里的 "empowered" expression 只是描述性占位。
 *   本任务实测：用生产 binder 绑定 mightGrant 后，未 Empowered 的 Solari Sunhawk 也求解出
 *   +1 Might（layers/engine.ts 的 conditionMatches 对未知 kind 落回 true）。
 * 3. [Deflect 2] 的税没有生产收集方（809.1.c/809.1.c.1）：continuous.grant-keyword 可把
 *   deflect 2 加入图层关键词列表，但没有消费方把该关键词转成 target.tax；
 *   chain/engine.ts 的 finalizeTargetPlan 不传 tax 选项（target/target-plan.ts 只在调用方
 *   显式传 tax 时才追加 TargetTaxRequest），本任务 golden 实测选择带 Deflect 2 的单位
 *   不会产生任何税，也不会因税不可支付而被拒绝。
 * 依赖：KeywordAbility 印刷 Empower 费用传递（契约变更请求）、442.1.a 状态谓词、
 * layered Deflect → target tax 的生产接线。
 */
const abilities: Ability[] = [
  {
    // 印刷费 2 Energy 见 judgeReason；不伪造第二条启动能力。
    kind: "keyword",
    keyword: "empower"
  },
  {
    // [Empowered][>] 的依赖能力：+1 Might（算术图层）。
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      amount: { kind: "constant", value: 1 },
      appliesTo: "self"
    },
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "empowered" }
    }
  },
  {
    // [Empowered][>] 的依赖能力：I have [Deflect 2]。
    kind: "static",
    effect: {
      kind: "continuous.grant-keyword",
      appliesTo: "self",
      keywords: [{ id: "deflect", value: 2 }]
    },
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "empowered" }
    }
  }
];

export default {
  canonicalCardId:
    "card.hash-b50ebe7425cbcc3607642935536039f10f7ddfeb4a0537dbf96c5aac8f96a4ad",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三条当前缺口（复核 2026-10-17，RIFT-618；均不近似实现）：" +
    "(1) 印刷的 2 Energy 无法到达 KeywordDef.expand（827.1.c.1）：KeywordAbility 只有 keyword/value，" +
    "programs/keywords.ts 调用 def.expand({ value, host }) 时不传 params.cost（契约 3.8.3）；本任务实测" +
    "展开出的启动费用是 { kind: \"empower\" }，buildCostPlan 抛 CostPlanError " +
    "\"Unsupported cost kind: empower\"。" +
    "(2) 没有 Empowered 状态谓词（442.1.a/828.1.b.1）：ObjectSnapshot 无 empowered 字段、Condition 词表" +
    "无该谓词，程序里的 empowered expression 只是描述性占位；本任务实测用生产 binder 绑定 mightGrant 后，" +
    "未 Empowered 的 Solari Sunhawk 也求解出 +1 Might（conditionMatches 对未知 kind 落回 true）。" +
    "(3) [Deflect 2] 的税没有生产收集方（809.1.c/809.1.c.1）：continuous.grant-keyword 能把 deflect 2 加入" +
    "图层关键词列表，但没有消费方把关键词转成 target.tax；chain/engine.ts 的 finalizeTargetPlan 不传 tax" +
    "选项，本任务 golden 实测选择带 Deflect 2 的单位不产生任何税，也不因不可支付被拒绝。" +
    "已合入且非缺口：Empower KeywordDef、continuous.might 的 +1 Might 算术图层求值、[Deflect 2] 的关键词图层授予、" +
    "target/tax/collect.ts 的税收集器与 TargetTaxCostAdapter（由调用方显式传入 effects/tax 时）。" +
    "依赖：KeywordAbility 印刷 Empower 费用传递（契约变更请求）、442.1.a 状态谓词、layered Deflect → target tax 生产接线。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_2: (:rb_energy_2:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have +1 :rb_might: and [Deflect 2]. (Opponents must pay " +
    ":rb_rune_rainbow::rb_rune_rainbow: to choose me with a spell or ability.)"
} satisfies CardProgram;
