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
 * section 5); execution still depends on two pieces:
 * 1. the printed Equip cost (1 Body Power, 818.1.c) cannot reach the merged
 *    KeywordDef.expand: the card-program binding calls expand with only
 *    value/host (programs/keywords.ts expandProgram), so contract 3.8.3
 *    params.cost is not delivered and the merged Equip expansion emits its generic
 *    `payments: [{ kind: "equip", value: { kind: "source" } }]` placeholder —
 *    the printed Body rune is never charged.
 * 2. cost/plan-values.ts readCost rejects that placeholder with
 *    CostPlanError reason "judge-required" ("Unsupported payment kind: equip"),
 *    so Finalize cannot pay the activation; describeActivate still describes the
 *    draft, but its cost plan cannot be built.
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
    "KeywordDef.expand——卡牌程序绑定的 expandProgram 只按 value/host 调用 expand（programs/keywords.ts），" +
    "契约 3.8.3 的 params.cost 未接线，展开始终产出占位支付 payments: [{ kind: \"equip\", value: { kind: \"source\" } }]，" +
    "印刷的 Body 符文从未被收取；(2) cost/plan-values.ts readCost 以 CostPlanError reason \"judge-required\"" +
    "拒绝该占位（\"Unsupported payment kind: equip\"），Finalize 无法完成支付；describeActivate 能给出草稿，但该草稿的费用计划无法建立。" +
    "已可真实执行的部分：合并后的 effect.attach 本体（golden 用真实 attach 动作执行并断言附着的宿主）。" +
    "依赖：cost 层的 Equip 支付种类与 KeywordDef.expand params.cost 的装配接线。" +
    "818.1.c.3/.c.4（非资源费用与改费文本）不适用于本卡；不近似实现（不把 2 Energy 打出费用当作装备费）。",
  abilities: [equip],
  sourceText:
    "[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)"
} satisfies CardProgram;
