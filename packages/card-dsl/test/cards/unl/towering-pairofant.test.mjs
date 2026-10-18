// Template execution evidence: ../templates/keyword-replacement-effect-ready-700.test.mjs.
// A real spell/cleanup supplies death history; no-death entry remains blocked.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/towering-pairofant.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import assault, { ASSAULT_DEFAULT_VALUE } from "../../../../engine-core/dist/effects/keywords/Assault.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import hextechRay from "../../../dist/cards/ogn/hextech-ray.js";

const CANONICAL_ID =
  "card.hash-236b348b03423e44bd4951c615315452d5da4f0e0be98b47ebafeddb51fe1f8a";
const SOURCE_TEXT =
  "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
  "If a unit died this turn, I enter ready.";

const [keyword, enterReady] = program.abilities;
const enterReadyInstruction = enterReady.with[0];

test("unl-008-219 Towering Pairofant: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-008-219 Towering Pairofant: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /369\.3/);
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.match(program.judgeReason, /RIFT-257/);
});

test("unl-008-219 Towering Pairofant: unvalued Assault (Assault Value defaults to 1)", () => {
  assert.equal(program.abilities.length, 2);
  // 807.1.b / 807.1.b.3: "Assault" without X presumes an Assault Value of 1, so
  // the program declares the keyword without a value instead of inventing one.
  assert.deepEqual(keyword, { kind: "keyword", keyword: "assault" });
  assert.equal(keyword.value, undefined);
  assert.equal(keyword.keyword, "assault");
});

test("unl-008-219 Towering Pairofant: the default Assault Value expands to +1 Might while attacking", () => {
  const [ability] = assault.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(ASSAULT_DEFAULT_VALUE, 1);
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: ASSAULT_DEFAULT_VALUE });
  assert.equal(ability.effect.layer, "arithmetic");
  assert.equal(ability.condition.left.property, "designation");
  assert.deepEqual(ability.condition.right, { kind: "constant", value: "attacker" });
  assert.equal(keywordDefinitionsById.get("Assault"), assault);
});

test("unl-008-219 Towering Pairofant: 'I enter ready' is an entry replacement gated on a unit dying this turn", () => {
  // 359.2.c / 369.3: the replacement is identified by describing how the unit
  // enters; units normally enter exhausted (143.4) and this replaces that.
  assert.equal(enterReady.kind, "replacement");
  assert.deepEqual(enterReady.replaces, {
    event: "object-enters-board",
    filter: { self: true, exhausted: true }
  });
  // 364.3.a: the leading "If …" clause conditions the replacement itself; the
  // retained shape names the death history window that has no merged evaluation.
  assert.equal(enterReady.condition.kind, "compare");
  assert.equal(enterReady.condition.operator, "gte");
  assert.deepEqual(enterReady.condition.right, { kind: "constant", value: 1 });
  assert.equal(enterReady.condition.left.kind, "count");
  assert.equal(enterReady.condition.left.subject, "units-died-this-turn");
  assert.deepEqual(enterReady.condition.left.filter, { type: "unit" });

  assert.equal(enterReady.with.length, 1);
  assert.equal(enterReadyInstruction.id, "towering-pairofant.enter-ready");
  assert.equal(enterReadyInstruction.op, "effect.ready");
  assert.deepEqual(enterReadyInstruction.args.objects, {
    kind: "constant",
    value: { kind: "source" }
  });
});

test("unl-008-219 Towering Pairofant: the merged replacement binder accepts the entry rewrite", () => {
  // RIFT-260's bindReplacement consumes the 369.3 entry-state spelling: the
  // body's effect.ready on "source" is planned as the ready action that lands on
  // the chain-zone permanent, so this half of the ability is really bindable.
  // Only metadata changes in the probe: the original keyword, condition and
  // replacement body all reach the production lifecycle and pipeline.
  const result = runCardScenario({ ...program, status: "executable", judgeReason: undefined }, {
    players: { A: { energy: 7, power: ["Fury"] } },
    objects: [
      { id: "pairofant", cardId: CANONICAL_ID, types: ["unit"], zone: "hand", energy: 6, power: null, might: 6 },
      { id: "ray", program: hextechRay, types: ["spell"], zone: "hand", energy: 1, power: ["Fury"] },
      { id: "victim", owner: "B", types: ["unit"], zone: "board", might: 3 }
    ],
    answers: { "target:hextech-ray.unit-at-battlefield": ["victim"] },
    operations: [
      { type: "play", object: "ray", player: "A" },
      { type: "pass", player: "A" },
      { type: "pass", player: "B" },
      { type: "play", object: "pairofant", player: "A" }
    ],
    expect: {
      objects: { pairofant: { zone: "board", exhausted: false, energy: 6, power: null, might: 6 }, victim: { zone: "trash" } },
      players: { A: { energy: 0 } },
      events: { sequence: [{ timingPoint: "object-killed", object: { ref: "victim" } }, { timingPoint: "object-enters-board", object: { ref: "pairofant", exhausted: false } }] }
    }
  });
  result.asserts();
  assert.ok(result.events.some(event => event.timingPoint === "object-enters-board"));
  assert.equal(result.events.some(event => event.timingPoint === "object-readied"), false);
});

test("unl-008-219 Towering Pairofant: the replacement body's effect.ready readies the source", () => {
  const kernel = world()
    .unit("pairofant", { zone: "board", controller: "A", exhausted: true })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("pairofant")) });
  const outcome = resolveChainBody(enterReady.with, scoped);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["towering-pairofant.enter-ready", "executed"]
  ]);
  assert.deepEqual(scoped.events.map(event => event.action), ["ready"]);
  assert.equal(scoped.object(scoped.ref("pairofant")).exhausted, false);
});

test("unl-008-219 Towering Pairofant: the generated card registry exposes the program under its canonical id", () => {
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test.todo(
  "unl-008-219 Towering Pairofant: apply Assault's default +1 Might exactly while the unit holds the Attacker designation " +
    "(CR 807.1.b.3 / 807.1.c / 807.1.d.1) — the KeywordDef (RIFT-81) and the lifecycle static binder (RIFT-257) are merged, " +
    "but the compare(designation) gate is silently false: evaluateCondition throws MissingInformation on the designation " +
    "characteristic and bindStaticToLayers swallows it, so the +1 never applies"
);

test.todo(
  "unl-008-219 Towering Pairofant: register 'If a unit died this turn, I enter ready' as a board-entry replacement " +
    "(CR 143.4 / 359.2.c / 369.3) — the RIFT-260 binder consumes the entry rewrite and the lifecycle registers it, " +
    "but the condition needs a history predicate: compare(count) silently counts the live board (expr.ts ignores the " +
    "subject), so entering ready would fire without any death this turn; engine-runtime attaches supplied programs, " +
    "while the default room does not inject this CardProgram"
);
