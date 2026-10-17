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
 * status = judge-required。执行证据在 templates/keyword-static-static-673.test.mjs；
 * 已合入依赖与剩余生产接线已重新核对；
 * 当前真实缺口以 judgeReason 为准，子效果执行不证明整卡可执行。
 */
const abilities: Ability[] = [
  {
    // 827.1.c.1：印刷的 :rb_energy_2: 无法从 KeywordAbility 送达 expand
    //（judgeReason 第 1 条；契约 3.1 没有 params 承载字段）。value 2 保留印刷
    // 符号数的可审查记录，不被当作可执行费用；不伪造启动能力。
    kind: "keyword",
    keyword: "empower",
    value: 2
  },
  {
    // [Empowered][>] 的“I have +1 :rb_might:”：算术层 Might 增加（479.4.e.1）。
    // 828.1.c: use the reference kernel's live empowered field; the public
    // ObjectSnapshot state contract still needs integration (judgeReason).
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
        property: "empowered"
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
        property: "empowered"
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
    "仍缺：(1) KeywordAbility / programs/keywords.ts 未传 params.cost，无法把印刷的 2 Energy 交给 Empower 展开（827.1.c.1）；" +
    "(2) ObjectSnapshot 契约未公开 Empowered 状态，continuous.might / continuous.grant-keyword 的 828.1.b.1 门控仍需权威状态与静态层、Ganking 能力重绑定。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_2: (:rb_energy_2:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have +1 :rb_might: and [Ganking]. (I can move from battlefield to battlefield.)"
} satisfies CardProgram;
