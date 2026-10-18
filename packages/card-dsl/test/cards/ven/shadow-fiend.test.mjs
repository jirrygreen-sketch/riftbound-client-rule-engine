// RIFT-697 execution evidence: ../templates/keyword-static-697.test.mjs runs the card's
// exported abilities through the generic scenario harness and keeps the documented
// clauses judge-required.
// RIFT-672 execution evidence: ../templates/keyword-static-672.test.mjs (supported paths only).
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/shadow-fiend.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan, CostPlanError } from "../../../../engine-core/dist/cost/index.js";
import assaultKeyword from "../../../../engine-core/dist/effects/keywords/Assault.js";
import empowerKeyword from "../../../../engine-core/dist/effects/keywords/Empower.js";
import { evaluateExpression } from "../../../../engine-core/dist/effects/interpreter/expr.js";
// The production static binder installs card static abilities into
// the merged layer engine; the chain fixture provides that engine.
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID =
  "card.hash-b0dae42b029e826ed425d0108e52126d253bfbcb0232487d1515afeae22ef257";
const SOURCE_TEXT =
  "[Empower] :rb_energy_2::rb_rune_fury: (:rb_energy_2::rb_rune_fury:: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] I have [Assault 3]. (+3 :rb_might: while I'm an attacker.)";

const [empower, assault] = program.abilities;

test("ven-014-166 Shadow Fiend: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-014-166 Shadow Fiend: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /807\.1\.c/);
  // The grant primitive and its merged static binder are merged; the remaining
  // execution gap is the Empowered gate predicate and the card-side cost wiring.
  assert.match(program.judgeReason, /bindStatic/);
  assert.match(program.judgeReason, /ObjectSnapshot/);
  assert.match(program.judgeReason, /designation/);
  // Deleted stale assertions (2026-10-18 re-sweep): the previous reason cited
  // the merged RIFT-672 / RIFT-697 template tasks as part of the gap text.
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-014-166 Shadow Fiend: [Empower] is declared as a keyword ability without a rewritten expansion", () => {
  // 827.1.c 的印刷费用（2 Energy + 1 Fury Power）记录在本文件注释与 judgeReason 中；
  // 契约 3.1 的 KeywordAbility 只有 keyword / value，无法承载印刷费用。
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  assert.equal(empower.value, undefined);
  assert.equal(empower.params, undefined);
});

test("ven-014-166 Shadow Fiend: the Empowered dependent ability grants Assault 3 to self", () => {
  // 807.1.c 的功能文本是 "While I am an attacker, I have +3 [M]"，即 [Assault 3]。
  assert.equal(assault.kind, "static");
  assert.deepEqual(assault.effect, {
    kind: "continuous.grant-keyword",
    appliesTo: "self",
    keywords: [{ id: "assault", value: 3 }]
  });
  // 卡内只声明关键词，不重写 Assault 的展开（契约 3.7 / README 第 5 节）。
  assert.equal(assault.effect.amount, undefined);
  // 828.1.c 的门控读取来源当前 Empowered 状态；不把依赖能力写成无条件能力。
  assert.deepEqual(assault.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
});

test("ven-014-166 Shadow Fiend golden: the production static binder installs Assault 3 on the host", () => {
  // The Empowered gate itself is not executable (gap 3), so this golden runs
  // the grant effect the dependent ability declares — proving the merged
  // layer path, not the printed gating.
  const f = fixture({ cards: [{ id: "shadow-fiend", types: ["unit"] }] });
  f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("shadow-fiend"),
    to: "base",
    location: { type: "base", player: "A" }
  });
  const source = f.kernel.getObject("shadow-fiend");
  const binder = createEngineStaticBinder(f.engine);

  const handle = binder.bindStatic({ kind: "static", effect: assault.effect }, source);
  const withGrant = f.engine.layers.snapshot(f.kernel.ref("shadow-fiend"));
  assert.deepEqual(withGrant && withGrant.keywords, [{ id: "assault", value: 3 }]);

  handle.unbind();
  const afterUnbind = f.engine.layers.snapshot(f.kernel.ref("shadow-fiend"));
  assert.deepEqual(afterUnbind && afterUnbind.keywords, []);
});

test.todo(
  "ven-014-166 Shadow Fiend: pass the printed 2 Energy + 1 Fury Power Empower cost through " +
    "KeywordAbility/programs/keywords.ts params.cost; the registered KeywordDef already supplies " +
    "the 'use only if not Empowered' restriction"
);
test.todo(
  "ven-014-166 Shadow Fiend: [Assault 3] while Empowered through the layers engine — needs a " +
    "card-side continuous.grant-keyword op plus the card-side registration entry point; the grant " +
    "itself installs through the merged static binder, while production ObjectSnapshot still " +
    "lacks the live empowered count used by the gate"
);

test("ven-014-166 Shadow Fiend gap: the printed 2 Energy + 1 Fury Power Empower cost is not carried", () => {
  // Measured evidence for judgeReason point 1: the registered KeywordDef keeps
  // the not-Empowered restriction but receives no CostSpec, so the printed cost
  // is judged unsupported instead of being charged (827.1.c.1).
  const [expanded] = empowerKeyword.expand({ host: { canonicalCardId: CARD_ID } });
  assert.equal(expanded.kind, "activated");
  assert.deepEqual(expanded.cost, { kind: "empower" });
  const kernel = world().unit("fiend", { cardId: CARD_ID, might: 2 }).build();
  assert.throws(
    () => buildCostPlan(kernel, { id: "cost:empower", cost: expanded.cost }),
    error => error instanceof CostPlanError && error.reason === "judge-required" && /Unsupported cost kind: empower/.test(error.message)
  );
});

test("ven-014-166 Shadow Fiend gap: the granted Assault reads a designation no snapshot publishes", () => {
  // Measured evidence for judgeReason point 3: the grant installs (asserted by
  // the golden above), but its +3 Might condition reads the attacker
  // designation, which the merged expression evaluator cannot find on a
  // contract-shaped snapshot.
  const [assaultAbility] = assaultKeyword.expand({ value: 3, host: { canonicalCardId: CARD_ID } });
  assert.deepEqual(assaultAbility.condition.left, {
    kind: "object-property",
    object: "self",
    property: "designation"
  });
  const kernel = world().unit("fiend", { cardId: CARD_ID, might: 2 }).build();
  const source = kernel.getObject("fiend");
  assert.equal(Object.hasOwn(source, "designation"), false);
  assert.throws(
    () => evaluateExpression(assaultAbility.condition.left, {
      context: kernel,
      host: source.ref,
      linked: () => undefined,
      canLookBack: () => true,
      isIgnored: () => false
    }),
    error => /Unavailable characteristic: designation/.test(error.message)
  );
});
