import type { Ability, CardProgram, Condition } from "../../ir/index.js";

/**
 * Brutal Hunter (ven-070-166) — Unit, 3 Energy + 1 Power, 4 Might, Body, Noxus。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-070-166，逐字）：
 *   [Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not
 *   Empowered.)
 *   [Empowered][>] I have +2 :rb_might: and [Ganking]. (I can move from
 *   battlefield to battlefield.)
 *
 * 规则依据（CR v1.5）：
 * - 827.1 / 827.1.c.1：[Empower] 是启动能力关键词，功能等价于“[3 Energy]：
 *   Empower me。仅当未 Empowered 时启动。”；827.1.b.1 明确来源自身不是目标。
 * - 828.1.a / 828.1.b.1：[Empowered][>] 是依赖型关键词，从关键词到子句末尾整段是
 *   Empowered 能力，功能等价于“当我拥有 Empowered 状态时，此牌获得 [Text]”。
 *   828.1.b.2 说明 [Text] 即 Dependent Ability 本体。
 * - 143.2.a：“+2 :rb_might:” 是算术图层的 Might 修正（契约 3.4 的 layers 顺序），
 *   不是 Buff 计数器（702）。
 * - 810 Ganking：被动能力关键词；810.1.b 功能上等同“我可以以标准移动从战场移动到
 *   另一个战场”。按 README 第 5 节只声明关键词，展开（continuous.movement 形状）
 *   由 effects/keywords/Ganking.ts 负责。
 *
 * 复核（2026-10-17，M2 覆盖率复核）：RIFT-593 的 Empower KeywordDef
 * （effects/keywords/Empower.ts）已合入，Empowered 状态也用 `empowered` 属性暴露给
 * object-property 谓词（与本卡门控一致，见下），因此旧的「无 KeywordDef / 无状态谓词」
 * 两条理由均过时。仍不能整卡可执行的当前缺口：
 * 1. 印刷的 Empower 费用无法从卡侧送达展开：827.1.c 的 “[Cost]: Empower this” 是
 *    CostSpec，而契约 3.1 的 KeywordAbility 只有 keyword / value（没有 params 承载字段），
 *    programs/keywords.ts 的 expandProgram 也仍以 `def.expand({ value, host })` 调用、
 *    不传契约 3.8.3 的 params.cost；因此本卡无法声明印刷的 3 Energy，展开只得到
 *    Empower.ts 的兜底 `{ kind: "empower" }`（该文件头同样记录“Missing printed costs
 *    remain an unsupported cost kind, so binding fails closed”，不把缺省当免费）。
 * 2. 即使展开能带上印刷费用，费用管线也还不认识 empower 支付种类：
 *    cost/plan-values.ts 的 readCost 对非资源支付只接受 exhaust / discard / recycle /
 *    kill / reveal / spend-buff，其余一律 blocked(`Unsupported payment kind`)。实测
 *    describeActivate 直接抛 “Unsupported cost kind empower”，故 [Empower] 目前
 *    既不能定价也不能支付，整卡保持 judge-required。
 * 已合入并用真实执行验证的部分：「I have +2 :rb_might:」的算术图层授予、
 * 「and [Ganking]」的 ability 图层关键词授予，以及 828.1.c 门控（object-property
 * self.empowered）在真实 static 绑定下按 Empowered 状态开关。不近似实现：
 * 不把 +2 :rb_might: 写成 Buff 计数器，也不把关键词授予写成卡级无条件关键词声明。
 * 依赖：契约 3.8.3 的 KeywordAbility params 生产侧接线与 empower 费用种类。
 */

/**
 * 442.1.a / 828.1.c：Empowered 门槛。`empowered` 与已合入 Empower.ts 展开读的是同一个
 * 属性拼写（442.1.a 的二元状态计数）；状态信息缺失时 object-property 求值抛
 * MissingInformation 而门控不成立，绝不把缺失当成 0 或无条件成立。
 */
const empoweredGate: Condition = {
  kind: "compare",
  left: { kind: "object-property", object: "self", property: "empowered" },
  operator: "gte",
  right: { kind: "constant", value: 1 }
};

const abilities: Ability[] = [
  {
    // 印刷费 3 Energy 无法表达（judgeReason 第 1 条）；KeywordAbility 没有承载字段。
    kind: "keyword",
    keyword: "empower"
  },
  {
    // [Empowered][>]「I have +2 :rb_might:」：arithmetic 图层修正（143.2.a）。
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      amount: { kind: "constant", value: 2 },
      appliesTo: "self"
    },
    condition: empoweredGate
  },
  {
    // [Empowered][>]「and [Ganking]」：ability 图层的持续关键词授予（810.1.b）。
    kind: "static",
    effect: {
      kind: "continuous.grant-keyword",
      keyword: "Ganking",
      appliesTo: "self"
    },
    condition: empoweredGate
  }
];

export default {
  canonicalCardId: "card.hash-3f9f5a7cd793affe45d17580dab715f09ada17e0f10121517e9abce676d36e2b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口，均不近似实现：(1) 印刷的 Empower 费用送不进展开——827.1.c 的 “[Cost]: Empower this” 是 " +
    "CostSpec，而契约 3.1 的 KeywordAbility 只有 keyword / value，programs/keywords.ts 的 expandProgram " +
    "仍以 def.expand({ value, host }) 调用、不传契约 3.8.3 的 params.cost，卡层无法声明印刷的 3 Energy，" +
    "展开只得到 Empower.ts 的兜底 { kind: \"empower\" }（缺省不是免费，该文件头同记 “Missing printed costs " +
    "remain an unsupported cost kind, so binding fails closed”）。(2) 费用管线不认识 empower 支付种类：" +
    "cost/plan-values.ts 的 readCost 对非资源支付只接受 exhaust / discard / recycle / kill / reveal / spend-buff，" +
    "其余 blocked(\"Unsupported payment kind\")；实测 describeActivate 抛 “Unsupported cost kind empower on " +
    "activate:src:1:A:1”，[Empower] 既不能定价也不能支付。" +
    "已合入并用真实执行验证的部分：RIFT-593 的 Empower KeywordDef 已存在，「I have +2 :rb_might:」的算术图层授予、" +
    "「and [Ganking]」的 ability 图层关键词授予，以及 828.1.c 的 Empowered 门控（object-property self.empowered，" +
    "与 Empower.ts 展开读同一属性；信息缺失时门控不成立而不是当成 0）都有可执行证据。" +
    "依赖：契约 3.8.3 的 KeywordAbility params 生产侧接线与 empower 费用种类。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have +2 :rb_might: and [Ganking]. (I can move from battlefield to battlefield.)"
} satisfies CardProgram;
