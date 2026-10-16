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
 * status = judge-required（三处缺口均不近似实现）：
 * 1. keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef：
 *    827.1.c.1 的启动费用、“仅当未 Empowered 时”限制与 828.1.b.1 的依赖能力都无法
 *    展开（已合入的关键词批次不含它们）；
 * 2. 没有 Empowered 状态谓词（442.1.a / 828.1.c）：Empowered 状态不在 ObjectSnapshot
 *    也不在契约的 Condition 代数里，本程序的 empoweredCount 只是描述性记录；
 * 3. “I have +2 :rb_might:” 需要卡牌侧 continuous.might 的注册/求值入口（RIFT-91
 *    已合入 layers 引擎，但没有任何已合入路径把 CardProgram 的 static 能力注册为
 *    ContinuousEffectSpec）。
 * 依赖新的 Empower/Empowered 关键词任务、RIFT-87（条件/谓词）与 RIFT-91（layers 接线）。
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
    // 印刷费 3 Energy 见 judgeReason；KeywordAbility 没有承载印刷费用的字段。
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
    "三处缺口：(1) keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef：827.1.c.1 的" +
    "「3 Energy：Empower me，仅当未 Empowered 时启动」与 828.1.b.1 的依赖能力都无展开实现（依赖新的" +
    "Empower/Empowered 关键词任务）；(2) 没有 Empowered 状态谓词——442.1.a 的二元状态不在 ObjectSnapshot / " +
    "Condition 里，828.1.c 的门槛不可求值（本程序以描述性 empoweredCount >= 1 记录，不伪造可执行条件，" +
    "依赖 RIFT-87）；(3) 「I have +2 :rb_might:」与「I have [Ganking]」需要卡牌侧的 continuous.might / " +
    "continuous.grant-keyword 注册入口，RIFT-91 只合入了 layers 引擎、没有 CardProgram → ContinuousEffectSpec 的" +
    "接线。不近似实现（不把 +2 :rb_might: 写成 Buff 计数器，也不把关键词授予写成卡级无条件关键词声明）。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have +2 :rb_might: and [Ganking]. (I can move from battlefield to battlefield.)"
} satisfies CardProgram;

