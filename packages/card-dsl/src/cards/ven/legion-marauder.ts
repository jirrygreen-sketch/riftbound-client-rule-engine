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
 * status = judge-required。已合入依赖与剩余生产接线已重新核对；
 * 当前真实缺口以 judgeReason 为准，子效果执行不证明整卡可执行。
 */

/** 442.1.a / 828.1.c：Empowered 门槛（描述性谓词，见 judgeReason）。 */
const empoweredGate: Condition = {
  kind: "compare",
  left: { kind: "object-property", object: "self", property: "empowered" },
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
    "仍缺：(1) KeywordAbility / programs/keywords.ts 未传 params.cost，无法绑定 Empower 的 1 Energy 或 1 Body Power 二选一费用（827.1.c.1 / 827.1.c.2）；" +
    "(2) ObjectSnapshot 契约未公开 Empowered 状态，continuous.might 的 442.1.a / 828.1.b.1 门控仍需权威状态接线。" +
    "RIFT-672 模板通过真实付费打出与效果链验证 +1 静态门控及撤销，并确认缺失费用的启动失败闭合；" +
    "不把效果赋予的 Empowered 当作本卡二选一启动费用的执行证据。",
  abilities,
  sourceText:
    "[Empower] \u2014 :rb_energy_1: or :rb_rune_body: (Pay either cost: Empower me. Use only if " +
    "not Empowered.)\n" +
    "[Empowered][>] I have +1 :rb_might:."
} satisfies CardProgram;
