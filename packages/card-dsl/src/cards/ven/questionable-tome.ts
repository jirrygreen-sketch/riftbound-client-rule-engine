import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Questionable Tome (ven-054-166) — Gear, 3 Energy, power null (no printed
 * Power), Might null (no printed Might), Mind, no tags.
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json, ven-054-166；
 * "—" 之后是两个空格，保持原样）：
 *   "[Empower] —  :rb_exhaust: (Pay the cost: Empower me. Use only if not Empowered.)\n"
 *   "Disempower this, :rb_energy_1:, :rb_exhaust:: Draw 1."
 *
 * 规则依据（CR v1.5）：
 * - 827.1 / 827.1.b / 827.1.c：Empower 是启动式能力关键词；827.1.c 的格式
 *   "Empower [Cost]"，本卡费用是横置自身（415.5 把 Exhaust 作为启动费用）；
 *   827.1.c.1 功能等价于 "[费用]：Empower this。仅当未 Empowered 时启动。"，
 *   827.1.b.1 明确来源本身不是目标。
 * - 442.1 / 442.2：Empower 动作把 Board 上的对象变为 Empowered。
 * - 377.1 / 404.1.a / 415.5：第二行冒号之前是启动能力的费用："Disempower this"、
 *   ":rb_energy_1:" 与 ":rb_exhaust:" 三项都属于该启动能力的基础费用，必须在 Finalize
 *   支付；443.1 / 443.1.a / 443.2 定义 Disempower（移除 Empowered 状态、只作用于当前
 *   Empowered 的对象、属受限动作），151/151.2 说明 Gear 的启动能力可在控制者 Main
 *   Phase 执行。
 * - "Draw 1" = effect.draw（414.1 / 414.3，已合入原语）；抽牌者缺省为能力控制者
 *   （190.6.d 的隐含 "you"）。
 *
 * status = judge-required（缺口逐个列出，均不近似实现）：
 * 1. effects/keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef：
 *    827.1.c.1 的起动费用（横置自身 + effect.empower）、442.1.b / 827.1.c.5 的
 *    "仅当未 Empowered"限制都没有展开实现（RIFT-81~88 关键词批次不含它们）。
 * 2. "Disempower this" 作为启动费用无法支付：cost/plan-values.ts 的 readCost 只接受
 *    energy/power/xp/exhaust/discard/recycle/kill/reveal/spend-buff 这些支付种类，
 *    kind: "disempower" 会被以 CostPlanError（reason "judge-required"）阻断（RIFT-89）。
 *    已合入的 effect.empower 原语能在结算期执行 disempower 动作，但那是效果而不是费用
 *    （204.3 / 443.2.a 要求费用在 Finalize 支付），不能用来替代。
 * 3. 降解费用（443.1.a：只作用于当前 Empowered 的对象；443.1.a.1：未 Empowered 时什么
 *    也不做）由动作层拥有，本卡不重复实现。
 * 依赖：新增 Empower/Empowered 关键词任务与 RIFT-89（disempower 支付种类）。
 * 已合入的 effect.draw 与费用计划中的 energy + exhaust 两段由 golden 用真实原语执行；
 * 第三条费用缺口使本条启动能力仍不可完整支付，故整卡不标 executable。
 */
const abilities: Ability[] = [
  // 827.1.b/827.1.c：印刷的 [Empower] 费用是横置自身。value 省略（该关键词不带印刷数值），
  // 横置费用由 KeywordDef.expand 依 827.1.c.1 生成；本卡不改写关键词展开。
  { kind: "keyword", keyword: "empower" },
  {
    // 151/151.2：Gear 的启动能力，Action 时机（控制者 Main Phase 的 Open State）。
    kind: "activated",
    timing: "action",
    cost: {
      kind: "activated",
      // 404.1.a/415.5：冒号前的「Disempower this」「1 Energy」「Exhaust」都是费用。
      energy: { kind: "constant", value: 1 },
      payments: [
        // 443.2.a 的 Disempower 是受限动作；作为费用需要 cost/plan-values.ts 的
        // disempower 支付种类（当前不存在，见 judgeReason 2），不近似成 effect。
        { kind: "disempower", object: "self" },
        // 415.5：横置作为费用，对象是能力来源自身。
        { kind: "exhaust", object: "self" }
      ]
    },
    body: [
      {
        id: "questionable-tome.draw",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-a1ab154053bc70a80a473f0fd0410a73b87c97807d9efc4295ee589662fde3d3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) effects/keywords/registry.generated.ts 没有 Empower/Empowered 的 " +
    "KeywordDef（RIFT-81~88 批次不含）：827.1.c.1 的『横置自身：Empower me，仅当未 Empowered 时启动』" +
    "（415.5 的 Exhaust 费用、442.1.b/827.1.c.5 的限制）没有展开实现；" +
    "(2) 『Disempower this』作为启动能力的基础费用（404.1.a/415.5，443.2.a 的 Disempower 是受限动作）" +
    "无法支付：cost/plan-values.ts 的 readCost 只接受 energy/power/xp/exhaust/discard/recycle/kill/" +
    "reveal/spend-buff，kind: \"disempower\" 会被 CostPlanError（reason \"judge-required\"）阻断（RIFT-89）。" +
    "已合入的 effect.empower 能在结算期执行 disempower，但 204.3/443.2.a 要求费用在 Finalize 支付，" +
    "不能用结算效果替代。依赖新增 Empower/Empowered 关键词任务与 RIFT-89 的 disempower 支付种类；" +
    "效果本体 effect.draw（414.3）与费用计划的 energy/exhaust 两段已由 golden 真实执行。",
  abilities,
  sourceText:
    "[Empower] —  :rb_exhaust: (Pay the cost: Empower me. Use only if not Empowered.)\n" +
    "Disempower this, :rb_energy_1:, :rb_exhaust:: Draw 1."
} satisfies CardProgram;
