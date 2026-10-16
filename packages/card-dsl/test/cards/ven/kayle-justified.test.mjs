import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/kayle-justified.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

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
  assert.match(program.judgeReason, /empoweredCount/);
  assert.match(program.judgeReason, /RIFT-257/);
});

test("ven-134-166 Kayle, Justified: [Empower] plus the printed three-times permission", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  assert.equal(keywordDefinitionsById.get("Empower"), undefined);
  assert.equal(keywordDefinitionsById.get("Empowered"), undefined);

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

  // “[Deflect 3] and [Ganking]” while Empowered three times: a keyword grant with
  // a gate on the Empowered count (no predicate exists yet).
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
    property: "empoweredCount"
  });
  assert.equal(keywordGrant.condition.operator, "gte");
  assert.deepEqual(keywordGrant.condition.right, { kind: "constant", value: 3 });
});

test("ven-134-166 Kayle, Justified: both static effects name merged primitive ops and registered keywords", () => {
  // RIFT-258 merged the two instruction primitives the static abilities name,
  // so the IR is no longer waiting on the primitive layer; the remaining gap is
  // the static -> layers registration path plus the Empowered-count predicate
  // (see judgeReason).
  assert.equal(typeof instructionDefinitionsById.get("continuous.might")?.execute, "function");
  assert.equal(typeof instructionDefinitionsById.get("continuous.grant-keyword")?.execute, "function");
  assert.ok(keywordDefinitionsById.get("Deflect"), "Deflect's KeywordDef is merged (RIFT-84)");
  assert.ok(keywordDefinitionsById.get("Ganking"), "Ganking's KeywordDef is merged (RIFT-264 batch)");
});

test("ven-134-166 Kayle, Justified: the merged keyword binding rejects the missing Empower keyword", () => {
  // 827.1.c.1: the [Empower] keyword has no KeywordDef, so RIFT-257's expansion
  // path fails closed rather than resolving the printed cost to something else.
  const kernel = world()
    .unit("kayle", { zone: "board", keywords: [{ id: "empower" }] })
    .build();
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  assert.throws(
    () => expandProgram(registry.get(CANONICAL_ID), kernel.getObject("kayle")),
    error => error.code === "judge-required" && /Keyword empower has no executable KeywordDef/.test(error.message)
  );
});

test("ven-134-166 Kayle, Justified: the +2 Might per Empowered instance needs the Empowered predicate before it can execute", () => {
  // The static ability is the capability the layers engine does not get: no binder
  // turns the card's static data into a ctx.addContinuous registration, and
  // layers' valueOf does not evaluate `perEmpower` (479), so the card declares a
  // descriptive shape only. This asserts the shape the interpreter parametrises
  // and that a literal arithmetic registration (the merged layer path) does move
  // Might, which isolates the gap to the registration/predicate.
  assert.equal(mightPerEmpower.effect.perEmpower.kind, "constant");
  assert.equal(mightPerEmpower.effect.perEmpower.value, 2);

  const kernel = world().unit("kayle", { zone: "board", might: 3 }).build();
  const layers = createLayerEngine([kernel.getObject("kayle")], [{
    effect: {
      id: "kayle:literal",
      layer: "arithmetic",
      source: kernel.ref("kayle"),
      filter: { objectId: "kayle" },
      effect: { kind: "continuous.might", amount: 2 }
    },
    duration: { type: "permanent" }
  }]);
  assert.equal(layers.evaluate(kernel.ref("kayle")).might, 5);
});

test.todo(
  "ven-134-166 Kayle, Justified: [Empower] expansion (827.1.c.1: 3 Energy, 'empower me') needs " +
    "an Empower KeywordDef — none is merged"
);

test.todo(
  "ven-134-166 Kayle, Justified: '+2 :rb_might: for each time I'm [Empowered]' and the three-times " +
    "[Deflect 3] / [Ganking] grant need the static ability to be registered into the layer " +
    "engine (RIFT-257 static binder) together with an Empowered-count predicate (442.1.c.1, RIFT-87)"
);
