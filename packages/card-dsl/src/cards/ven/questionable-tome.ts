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
 * 当前状态与剩余接线见 judgeReason；不以原语存在代替整卡执行证据。
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
    "当前缺口：(1) Empower KeywordDef 已接受 params.cost，能展开本卡横置费用与未 Empowered 限制（827.1.c.1/415.5）；但 KeywordAbility / programs/keywords.ts 仍只传 keyword/value，未传印刷费用，展开的 cost.kind=empower 无法支付。ObjectSnapshot 仍未声明 empowered，生产状态读取与 442.1.b 的重复 Empower 限制须统一。(2) Disempower this 是 Finalize 启动费用（404.1.a/443.2.a），cost/plan-values.ts 尚无 disempower 支付种类。已有 effect.empower 的 Disempower 结算动作不能替代费用支付。Energy/Exhaust 支付、抽 1 与参数化 Empower 展开已有子效果执行证据；整卡保持 judge-required，不近似实现。",
  abilities,
  sourceText:
    "[Empower] —  :rb_exhaust: (Pay the cost: Empower me. Use only if not Empowered.)\n" +
    "Disempower this, :rb_energy_1:, :rb_exhaust:: Draw 1."
} satisfies CardProgram;
