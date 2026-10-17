import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Punching Poro (ven-007-166) — Unit, Fury, tags Poro / Ionia.
 * energy 2, power: none printed, Might 2.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-007-166，逐字）：
 *   [Empower] — Discard 1 (Pay the cost: Empower me. Use only if not Empowered.)
 *   [Empowered][>] I have +1 :rb_might:.
 *
 * 规则依据（Core Rules v1.5）：
 * - 827.1 / 827.1.c：Empower 是启动能力关键词，格式为 “Empower [Cost]”；827.1.c.2
 *   明确 Empower 费用可以包含非资源费用，本卡的印刷费用是「弃 1 张牌」。
 *   827.1.c.1 的功能等价文本是 “[Cost]: Empower this。仅当未 Empowered 时启动”，
 *   827.1.b.1 规定来源本身不是目标。
 * - 423.1 / 423.1.a：Discard 是把牌从手牌放入其拥有者弃牌区的动作；作为费用时由费用
 *   管线在 Finalize 收取（356.2），费用里的对象不是目标（355.10.c）。
 * - 828.1 / 828.1.b / 828.1.b.1 / 828.1.c：“[Empowered][>]” 之后的整句是 Dependent
 *   Ability，持有 Empowered 状态时 Active，等价于 “While I have the Empowered
 *   status, this card gains '[Text]'”。
 * - "I have +1 :rb_might:." 是静态 Might 修正，属 arithmetic 图层（143.2.a、475–477），
 *   不是 Buff 计数器（702/703）。
 *
 * 当前状态与剩余接线见 judgeReason；不以原语存在代替整卡执行证据。
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    keyword: "empower"
  },
  {
    // 828.1.b.1：持有 Empowered 时宿主获得 +1 Might，属算术图层的静态修正。
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      appliesTo: "self",
      amount: { kind: "constant", value: 1 }
    },
    // 828.1.c：读取宿主的当前状态，缺失状态信息时由解释器阻断。
    condition: {
      kind: "compare",
      left: { kind: "object-property", object: "self", property: "empowered" },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  }
];

export default {
  canonicalCardId: "card.hash-4e84bd06baa7f0981211f77e8859b781d223544ea2429070561399db373e5c6f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺 Empower 印刷费用的绑定：827.1.c.1/827.1.c.2 的 discard 1 属非资源费用；Empower KeywordDef 已注册并支持 params.cost、未 Empowered 限制与结算重验，但 KeywordAbility 只有 keyword/value，programs/keywords.ts 不转发 params.cost，也未把「从当前手牌选择一张」转换成费用计划的精确引用。828.1.c 的门控现改用 object-property self.empowered >= 1，参考内核可读取并通过 static → continuous.might 图层执行；ObjectSnapshot 尚未声明 empowered，生产快照及 442.1 的状态动作约束仍需统一。保留 judge-required，不近似实现。",
  abilities,
  sourceText:
    "[Empower] — Discard 1 (Pay the cost: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have +1 :rb_might:."
} satisfies CardProgram;
