import type { CardProgram } from "../../ir/index.js";

/**
 * Hexdrinker (sfd-102-221) — Gear, 2 Energy, no printed Power, Might 1, Body,
 * tag Equipment.
 *
 * sourceText (verbatim from packages/card-data/data/deck-catalog.json sfd-102-221):
 *   "[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)"
 *
 * Rules (CR v1.5):
 * - 818.1 / 818.1.a: Equip is an Activated Ability keyword present on Equipment Gear.
 * - 818.1.c / 818.1.c.2: formatted "Equip [Cost]" and functionally short for
 *   "[Cost]: Attach this gear to a unit you control."
 * - 135.2.e.4: the printed :rb_rune_body: is one Body Power cost; the Equip cost has
 *   no Energy (the card-level 2 Energy is the play cost, not the Equip cost).
 *
 * status: judge-required. The card declares only the keyword (cards/README.md
 * section 5); execution depends on two unmerged pieces:
 * 1. the printed Equip cost (1 Body Power, 818.1.c) cannot reach the merged
 *    KeywordDef.expand: the card-program binding calls expand with only
 *    value/host (programs/keywords.ts), so contract 3.8.3 params.cost is not
 *    delivered and the merged Equip expansion always emits its generic
 *    `payments: [{ kind: "equip", value: { kind: "source" } }]` placeholder —
 *    the printed Body rune is never charged.
 * 2. cost/plan-values.ts readCost rejects that placeholder with
 *    CostPlanError reason "judge-required" ("Unsupported payment kind: equip",
 *    RIFT-261 cost-payment batch), so Finalize cannot pay the activation.
 * The merged effect.attach body is executed by the golden (the real attach
 * action); the activation cost cannot be paid, so the card is not executable.
 * 818.1.c.3/.c.4 (non-resource and cost-altering Equip text) do not apply here.
 */
const equip = {
  // Printed "Equip [Body]": one resource symbol, the Body Power rune. value
  // counts the printed resource symbols and costDomain records the Power rune.
  kind: "keyword",
  keyword: "equip",
  value: 1,
  costDomain: "Body"
} as const;

export default {
  canonicalCardId: "card.hash-655981631747696ba307a61ac6067d55653bb1215a56106697946c14c7da3146",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Equip] 仍不可执行，两处当前缺口：(1) 印刷的 Equip 费用（1 Body Power，818.1.c）无法送达已合入的 " +
    "KeywordDef.expand——卡牌程序绑定只按 value/host 调用 expand（programs/keywords.ts），契约 3.8.3 的 " +
    "params.cost 未接线，展开始终产出占位支付 payments: [{ kind: \"equip\", value: { kind: \"source\" } }]，" +
    "印刷的 Body 符文从未被收取；(2) cost/plan-values.ts readCost 以 CostPlanError reason \"judge-required\"" +
    "拒绝该占位（\"Unsupported payment kind: equip\"；结算期费用支付属 RIFT-261 批次，未合入），Finalize 无法完成支付。" +
    "已可真实执行的部分：合并后的 effect.attach 本体（golden 用真实 attach 动作执行并断言附着的宿主）。" +
    "依赖：RIFT-261（cost.pay / equip 支付种类）、RIFT-257 后续（params.cost 送达展开）。" +
    "818.1.c.3/.c.4（非资源费用与改费文本）不适用于本卡；不近似实现。",
  abilities: [equip],
  sourceText:
    "[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)"
} satisfies CardProgram;
