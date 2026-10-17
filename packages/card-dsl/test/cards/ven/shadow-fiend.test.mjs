// RIFT-672 execution evidence: ../templates/keyword-static-672.test.mjs (supported paths only).
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/shadow-fiend.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// The production static binder installs card static abilities into
// the merged layer engine; the chain fixture provides that engine.
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
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
