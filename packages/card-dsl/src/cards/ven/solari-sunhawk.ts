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
 * 复核（2026-10-17，第二轮 M2 覆盖率复核）：+1 Might 与 Deflect 2 的图层产出已有
 * golden 执行证据（arithmetic 注册 + grant-keyword 图层）；早前作为缺口的
 * RIFT-91（图层注册入口）与 RIFT-90（target.tax 机制）已合入，不再列为缺口——
 * target.tax 现由 Deflect 展开声明，仍缺的是从关键词自动接线到目标计划。
 *
 * status = judge-required（当前真实缺口，均不近似实现）：
 * 1. keywords/registry.generated.ts 没有任何 Empower / Empowered 的 KeywordDef
 *    （RIFT-81~88 关键词批次不含它们），827.1.c.1 的启动费用与「仅当未 Empowered 时」
 *    限制、828.1.b.1 的依赖能力都无法展开；
 * 2. 没有 Empowered 状态谓词（442.1.a）：状态不在 ObjectSnapshot / Condition 里，
 *    静态效果的 condition 只能以显式谓词字符串占位（由关键词系统消费）；
 * 3. 卡牌侧没有把 continuous.might / continuous.grant-keyword 静态效果注册进图层的入口
 *    （ctx.addContinuous 只有 chain/engine 内部接线；RIFT-91 的 layers 引擎已合入求值
 *    骨架），因此依赖能力无法激活。
 * 依赖：新增 Empower/Empowered 关键词任务、RIFT-91（图层与卡牌持续效果注册）、
 * RIFT-90（Deflect 的 target.tax 消费方）。
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
    "两条缺口（复核 2026-10-17；+1 Might 与 Deflect 2 的图层产出已有 golden 执行证据，" +
    "图层注册入口与 target.tax 机制均已合入，不再列为缺口）：(1) keywords/registry.generated.ts " +
    "没有任何 Empower / Empowered 的 KeywordDef，827.1.c.1 的「2 Energy：Empower me，仅当未 " +
    "Empowered 时启动」与 828.1.b.1 的依赖能力都无展开实现；(2) 没有 Empowered 状态谓词（442.1.a）" +
    "——状态不在 ObjectSnapshot / Condition 里，静态效果里的 condition 只能以显式谓词字符串占位，" +
    "828.1.b.1 的依赖能力无法激活，[Deflect 2] 的 target.tax 也缺从关键词到目标计划的自动接线。" +
    "依赖：新增 Empower/Empowered 关键词任务与 442.1.a 状态谓词；并把卡内声明的 continuous.might 与 [Deflect 2] 的 continuous.grant-keyword 接到图层/target.tax 执行入口（图层求值骨架已合入）。不近似实现（不把 +1 :rb_might: 写成 Buff）。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_2: (:rb_energy_2:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have +1 :rb_might: and [Deflect 2]. (Opponents must pay " +
    ":rb_rune_rainbow::rb_rune_rainbow: to choose me with a spell or ability.)"
} satisfies CardProgram;
