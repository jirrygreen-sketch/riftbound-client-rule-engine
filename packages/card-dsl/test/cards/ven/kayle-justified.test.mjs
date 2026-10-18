import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/kayle-justified.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-bc9496bbf6f7cd918c02c302dd1a30bdc473b07744028532891c56fa80672908";
const SOURCE_TEXT =
  "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me.)\n" +
  "I can be [Empowered] up to three times.\n" +
  "I have +2 :rb_might: for each time I'm [Empowered].\n" +
  "While I'm [Empowered] three times, I have [Deflect 3] and [Ganking].";

const [empower, empowerLimit, mightPerEmpower, keywordGrant] = program.abilities;

test("ven-134-166 Kayle, Justified: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ven-134-166 Kayle, Justified: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /442\.1\.c\.1/);
  assert.match(program.judgeReason, /object-property \"empowered\"|per-object 许可/);
  // Merged since the last sweep: the Empower KeywordDef now exists; the cost
  // carrier and the per-Empower layer consumer are the remaining gaps.
  assert.match(program.judgeReason, /Unsupported cost kind empower/);
  assert.match(program.judgeReason, /perEmpower/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
  assert.doesNotMatch(program.judgeReason, /没有 Empower \/ Empowered 的 KeywordDef/);
  // Merged capabilities must no longer be cited as gaps (RIFT-87/257/258):
  // the static -> layers registration path is merged.
  assert.ok(!/RIFT-(87|257|258)/.test(program.judgeReason),
    "the reason names only current gaps: " + program.judgeReason);
  // Remaining gaps are recorded for the TODO below; this test keeps only
  // positive structure and the merged static registration evidence.
  assert.match(program.judgeReason, /perEmpower/);
});

test("ven-134-166 Kayle, Justified: [Empower] plus the printed three-times permission", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });

  // 442.1.c.1: this object may be Empowered up to three times (effect.empower's
  // multiple/limit parameters exist for exactly this printed permission).
  assert.equal(empowerLimit.kind, "static");
  assert.deepEqual(empowerLimit.effect, {
    kind: "empower-limit",
    limit: { kind: "constant", value: 3 },
    appliesTo: "self"
  });
});

test("ven-134-166 Kayle, Justified: +2 Might per Empowered instance and the three-times keyword grant", () => {
  assert.equal(mightPerEmpower.kind, "static");
  assert.equal(mightPerEmpower.effect.kind, "continuous.might");
  assert.equal(mightPerEmpower.effect.layer, "arithmetic");
  assert.deepEqual(mightPerEmpower.effect.perEmpower, { kind: "constant", value: 2 });
  assert.equal(mightPerEmpower.effect.appliesTo, "self");

  // "[Deflect 3] and [Ganking]" while Empowered three times: a keyword grant with
  // a gate on the Empowered count (the production snapshot still lacks the field).
  assert.equal(keywordGrant.kind, "static");
  assert.equal(keywordGrant.effect.kind, "continuous.grant-keyword");
  assert.deepEqual(keywordGrant.effect.keywords, [
    { id: "Deflect", value: 3 },
    { id: "Ganking" }
  ]);
  assert.equal(keywordGrant.condition.kind, "compare");
  assert.deepEqual(keywordGrant.condition.left, {
    kind: "object-property",
    object: "self",
    property: "empowered"
  });
  assert.equal(keywordGrant.condition.operator, "gte");
  assert.deepEqual(keywordGrant.condition.right, { kind: "constant", value: 3 });
});

test("ven-134-166 Kayle, Justified: the static effects name merged primitive ops and registered keywords", () => {
  assert.equal(typeof instructionDefinitionsById.get("continuous.might")?.execute, "function");
  assert.equal(typeof instructionDefinitionsById.get("continuous.grant-keyword")?.execute, "function");
  assert.ok(keywordDefinitionsById.get("Deflect"), "Deflect's KeywordDef is merged (RIFT-84)");
  assert.ok(keywordDefinitionsById.get("Ganking"), "Ganking's KeywordDef is merged (RIFT-264 batch)");
});

test("ven-134-166 Kayle, Justified: the printed Empower declaration remains a valid CardProgram keyword node", () => {
  const probe = {
    ...program,
    abilities: [empower],
    status: "judge-required"
  };
  const result = validateCardProgram(probe);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(probe.abilities, [{ kind: "keyword", keyword: "empower" }]);
});

function probeProgram(abilities) {
  return { ...program, status: "executable", judgeReason: undefined, abilities };
}

/** A controlled Kayle on player A's base; the layer target resolves to it. */
const kayleWorld = () => world()
  .unit("kayle", {
    types: ["unit"],
    might: 3,
    zone: "board",
    location: { type: "base", player: "A" }
  })
  .build();

test("ven-134-166 probe: the static binder registers empower-limit, might and the gated keyword grant", () => {
  // The keyword declaration is probed separately below: expandProgram rejects it
  // inside the play action (describePlay), which would abort the board entry.
  const binding = createProgramBinding({
    cardPrograms: [probeProgram([empowerLimit, mightPerEmpower, keywordGrant])]
  });
  const errors = [];
  const f = fixture({
    cards: [{ id: "kayle", cardId: CANONICAL_ID, types: ["unit"], energy: 3, might: 3 }],
    describePlay: binding.describePlay
  });
  binding.attachLifecycle(f.engine, error => errors.push(error));
  f.engine.commit({ type: "play", object: f.kernel.ref("kayle"), player: "A" });
  f.engine.advance();
  resolveAll(f.engine);

  // The empower-limit static has no layer mapping and is rejected on its own;
  // the per-instance might and the (dormant) keyword grant register cleanly.
  const messages = errors.map(error => String(error.message));
  assert.equal(messages.length, 1, "exactly one binding error: " + JSON.stringify(messages));
  assert.match(messages[0], /Static ability kind empower-limit has no layer mapping/);

  // The arithmetic-layer might entry exists but adds 0: the layer engine reads
  // amount/value/delta and has no perEmpower consumer (see judgeReason 3).
  const active = f.engine.layers.registry.active(undefined, () => null);
  const kinds = active.map(entry => String(entry.effect.effect?.kind)).sort();
  assert.deepEqual(kinds, ["continuous.grant-keyword", "continuous.might"],
    "both supported statics registered: " + JSON.stringify(kinds));

  const evaluated = f.engine.layers.evaluate(f.kernel.ref("kayle"));
  assert.equal(evaluated.might, 3, "perEmpower has no consumer, so might is unchanged");

  // The keyword grant registered too, but its Empowered-count gate cannot read
  // the production snapshot field, so no Deflect/Ganking keyword is exposed.
  assert.deepEqual(evaluated.keywords, []);
});

test("ven-134-166 Kayle probe: the merged Empower expansion loses the printed 3 Energy cost", () => {
  const kernel = kayleWorld();
  const binding = createProgramBinding({ cardPrograms: [probeProgram(program.abilities)] });
  const source = { ...kernel.getObject("kayle"), cardId: CANONICAL_ID };
  const expanded = binding.inspect(source).abilities;
  const empowerActivation = expanded.find(ability => ability.kind === "activated");
  assert.ok(empowerActivation, "the merged Empower KeywordDef expands to an activated ability");
  // 827.1.c: the printed cost is 3 Energy, but KeywordAbility carries no params
  // and expandProgram forwards only value/host, so the expansion has none.
  assert.deepEqual(empowerActivation.cost, { kind: "empower" });
  assert.throws(
    () => binding.describeActivate(source, "A", 0),
    error => error.code === "judge-required" && /Unsupported cost kind empower/.test(error.message)
  );
});

test("ven-134-166 Kayle probe: the arithmetic layer ignores perEmpower, so +2/instance never applies", () => {
  const f = fixture({
    cards: [{ id: "kayle", cardId: CANONICAL_ID, types: ["unit"], energy: 3, might: 3 }],
    describePlay: createProgramBinding({ cardPrograms: [probeProgram([mightPerEmpower, keywordGrant])] }).describePlay
  });
  const binding = createProgramBinding({ cardPrograms: [probeProgram([mightPerEmpower, keywordGrant])] });
  binding.attachLifecycle(f.engine);
  f.engine.commit({ type: "play", object: f.kernel.ref("kayle"), player: "A" });
  f.engine.advance();
  resolveAll(f.engine);
  // perEmpower is not read by applyArithmetic (it reads amount/value/delta).
  const evaluated = f.engine.layers.evaluate(f.kernel.ref("kayle"));
  assert.equal(evaluated.might, 3);
  assert.deepEqual(evaluated.keywords, []);
  const statics = binding.inspect(f.kernel.getObject("kayle")).abilities.filter(a => a.kind === "static");
  assert.deepEqual(statics.map(a => a.effect.kind).sort(), ["continuous.grant-keyword", "continuous.might"]);
  assert.deepEqual(mightPerEmpower.effect.perEmpower, { kind: "constant", value: 2 });
});

test("ven-134-166 Kayle probe: the three-times Empowered gate reads a field the snapshot does not expose", () => {
  const kernel = kayleWorld();
  const fullSnapshot = kernel.getObject("kayle");
  const productionSnapshot = Object.fromEntries(
    Object.entries(fullSnapshot).filter(([key]) => key !== "empowered")
  );
  const context = bindResolveContext(kernel, {
    source: productionSnapshot,
    object: ref => ref.id === "kayle" ? productionSnapshot : kernel.object(ref),
    lastKnown: ref => ref.id === "kayle" ? productionSnapshot : kernel.lastKnown(ref)
  });
  const environment = {
    context,
    host: kernel.ref("kayle"),
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false,
    query: filter => context.query(filter)
  };
  assert.throws(
    () => evaluateCondition(keywordGrant.condition, environment),
    error => /Unavailable characteristic: empowered/.test(error.message)
  );
});
