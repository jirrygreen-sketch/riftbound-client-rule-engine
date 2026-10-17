import type { Ability, CardProgram, Condition } from "../../ir/index.js";

/**
 * Legion Marauder (ven-074-166) — Unit, 2 Energy, 2 Might, Body, Trifarian/Noxus
 * （无印刷 Power）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-074-166，逐字）：
 *   [Empower] — :rb_energy_1: or :rb_rune_body: (Pay either cost: Empower me. Use
 *   only if not Empowered.)
 *   [Empowered][>] I have +1 :rb_might:.
 *
 * 规则依据（CR v1.5）：
 * - 827.1 / 827.1.c / 827.1.c.1：[Empower] 是启动能力关键词，功能等价于“[费用]：
 *   Empower me。仅当未 Empowered 时启动。”；“Pay either cost” 是印刷在关键词上的
 *   二选一费用（827.1.c.2 允许资源与非资源费用并存）。
 * - 827.1.b.1：Empower 的来源自身不是目标；827.2/442.1：动作完成后宿主获得
 *   Empowered 状态。
 * - 828.1.a / 828.1.b.1 / 828.1.b.2：[Empowered][>] 是依赖型关键词，整段功能等价于
 *   “当我拥有 Empowered 状态时，此牌获得 [Text]”。
 * - 143.2.a：“+1 :rb_might:” 是算术图层的 Might 修正（契约 3.4），不是 Buff 计数器。
 *
 * status = judge-required（三处缺口均不近似实现）：
 * 1. keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef：
 *    827.1.c.1 的启动能力与 827.1.c.2 的 “or” 二选一费用没有展开实现；契约 3.8.3 的
 *    `params` 只加在 KeywordDef.expand 的输入上，card-dsl 的 KeywordAbility 只有
 *    keyword / value（value 是 number），Carrier 不足以承载 “1 Energy 或 1 Body
 *    Power” 的二选一费用，因此本程序只声明关键词，印刷费用记录在此处与 judgeReason
 *   里（见回复的契约变更请求），不伪造第二条启动能力；
 * 2. 没有 Empowered 状态谓词（442.1.a）：Empowered 状态不在 ObjectSnapshot 也不在
 *    契约的 Condition 代数里；
 * 3. “I have +1 :rb_might:” 的 continuous.might 原语与图层注册已合入；它仍受
 *    Empowered 状态门控，不能在门控缺失时视为可执行。
 * 依赖新的 Empower/Empowered 关键词任务与 RIFT-87（条件/谓词）。
 */

/** 442.1.a / 828.1.c：Empowered 门槛（描述性谓词，见 judgeReason）。 */
const empoweredGate: Condition = {
  kind: "compare",
  left: { kind: "object-property", object: "self", property: "empoweredCount" },
  operator: "gte",
  right: { kind: "constant", value: 1 }
};

const abilities: Ability[] = [
  {
    // 印刷费 “1 Energy 或 1 Body Power” 见 judgeReason；KeywordAbility 没有承载
    // 二选一费用的字段，不伪造启动能力。
    kind: "keyword",
    keyword: "empower"
  },
  {
    // [Empowered][>]「I have +1 :rb_might:」（143.2.a 的算术图层修正）。
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      amount: { kind: "constant", value: 1 },
      appliesTo: "self"
    },
    condition: empoweredGate
  }
];

export default {
  canonicalCardId: "card.hash-211eca36faf7df8cbf91263292d612607b7b7e515ee1ee6aaeb0003817aff8f8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef：827.1.c.1 的" +
    "「Empower me，仅当未 Empowered 时启动」无法展开，827.1.c.2 的「Pay either cost: :rb_energy_1: or" +
    " :rb_rune_body:」二选一印刷费用也没有承载字段（契约 3.8.3 的 params 只加在 KeywordDef.expand 的输入上，" +
    "card-dsl 的 KeywordAbility 只有 keyword / value，value 是 number）——印刷费用为 1 Energy 或 1 Body Power，" +
    "登记为契约变更请求（依赖新的 Empower 关键词任务）；(2) 没有 Empowered 状态谓词——442.1.a 的二元状态" +
    "不在 ObjectSnapshot / Condition 里，828.1.c 的门槛不可求值（依赖 RIFT-87）；(3) 「I have +1 :rb_might:」" +
    "使用的 continuous.might 原语与 CardProgram static 注册已合入，但 Empowered 门控仍无法求值。" +
    "不近似实现（不把 +1 :rb_might: 写成 Buff 计数器，也不把二选一费用写成" +
    "单一路径的假费用）。",
  abilities,
  sourceText:
    "[Empower] \u2014 :rb_energy_1: or :rb_rune_body: (Pay either cost: Empower me. Use only if " +
    "not Empowered.)\n" +
    "[Empowered][>] I have +1 :rb_might:."
} satisfies CardProgram;
