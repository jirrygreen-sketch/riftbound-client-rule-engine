import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Kinkou Lifeblade (ven-093-166) — Unit, 4 Energy, Might 4, Chaos, tag Ionia.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-093-166，逐字）：
 *   [Empower] :rb_energy_2: (:rb_energy_2:: Empower me. Use only if not
 *   Empowered.)
 *   [Empowered][>] I have +1 :rb_might: and [Ganking]. (I can move from
 *   battlefield to battlefield.)
 *
 * 规则依据（Core Rules v1.5）：
 * - 827.1 / 827.1.c.1：[Empower] 是 Activated Ability 关键词，功能等价于
 *   “[2 Energy]：Empower me。仅当未 Empowered 时启动。”印刷 Energy 费可写成
 *   KeywordAbility 之外的形式，但契约 3.1 的 KeywordAbility 没有费用字段（契约 3.8.3 的
 *   params 只加在 KeywordDef.expand 的输入上），因此只声明关键词身份（同 ven-084-166）。
 * - 828.1.a / 828.1.b.1：[Empowered][>] 是 Dependent Keyword，整段是“只要我拥有
 *   Empowered 状态即生效”的依赖能力。
 * - 442.1.a：Empowered 是 Board 上对象的二元状态。
 * - “+1 :rb_might:” 是算术图层的 Might 增加（143.2.a、479.4.e.1），不是 Buff 计数器（702/703）。
 * - 810.1：[Ganking] 是 Passive Ability 关键词，单位因此可用标准移动在战场之间移动。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，缺口见 judgeReason；
 * 本卡没有已合入的可执行语句，golden 只做结构与关键词身份断言，未合入依赖写 test.todo。
 */
const abilities: Ability[] = [
  {
    // 印刷费 2 Energy 见 judgeReason 第 1 条；不伪造启动能力。
    kind: "keyword",
    keyword: "empower"
  },
  {
    // [Empowered][>] 的“I have +1 :rb_might:”：算术层 Might 增加（479.4.e.1）。
    // 依赖能力的门槛是 828.1.c 的 Empowered 状态；442.1.a 的二元状态不在 ObjectSnapshot /
    // Condition 里，condition 里的 empoweredCount 只是描述性记录（见 judgeReason 第 2 条）。
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      appliesTo: "self",
      amount: { kind: "constant", value: 1 }
    },
    condition: {
      kind: "compare",
      left: {
        kind: "object-property",
        object: "self",
        property: "empoweredCount"
      },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  },
  {
    // [Empowered][>] 的“and [Ganking]”：828.1.b.1 的依赖能力在宿主 Empowered 时授予
    // 关键词；展开（continuous.movement 许可）归 effects/keywords/Ganking.ts，卡文件只声明。
    kind: "static",
    effect: {
      kind: "continuous.grant-keyword",
      keyword: "Ganking",
      appliesTo: "self"
    },
    condition: {
      kind: "compare",
      left: {
        kind: "object-property",
        object: "self",
        property: "empoweredCount"
      },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  }
];

export default {
  canonicalCardId: "card.hash-d74e1963dafb67a09e7521faddbcaaae4df80b1f2ea284a6639fdc31e3e82f35",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口：(1) keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef，827.1.c.1 的" +
    "“[2 Energy]：Empower me，仅当未 Empowered 时启动”无法展开（依赖新的 Empower/Empowered 关键词任务，" +
    "RIFT-83/84 批次不含它们）；(2) 没有 Empowered 状态谓词——442.1.a 的二元状态不在 ObjectSnapshot / " +
    "Condition 里，两条 [Empowered][>] 依赖能力（828.1.b.1）的门槛不可求值，程序里的 empoweredCount 只是" +
    "描述性记录（依赖 RIFT-87 条件/谓词）；(3) “I have +1 :rb_might:” 需要卡牌侧的 continuous.might 注册/求值" +
    "原语（RIFT-91 只合入 layers 引擎，卡牌入口缺失）；(4) “and [Ganking]” 需要 continuous.grant-keyword 指令" +
    "（effects/instructions 无该 op），且 Ganking 展开的 continuous.movement 许可在 zones/movement.ts 没有消费方" +
    "（810.1.c / 144.4.c）。不近似实现（不把 +1 Might 写成 Buff 计数器）。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_2: (:rb_energy_2:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have +1 :rb_might: and [Ganking]. (I can move from battlefield to battlefield.)"
} satisfies CardProgram;
