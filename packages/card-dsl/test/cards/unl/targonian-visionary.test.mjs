import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/targonian-visionary.js";

const CANONICAL_ID =
  "card.hash-7a28733b1d7d68a60f53e6b2afcce546b7e3c138e103f63079734f2d3809e08f";
const SOURCE_TEXT =
  "[Level 11][>] I have +4 :rb_might:. (While you have 11+ XP, get the effect.)";

const [levelEleven] = program.abilities;

test("unl-098-219 Targonian Visionary: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-098-219 Targonian Visionary: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /824\.1/);
  assert.match(program.judgeReason, /Level/);
  assert.match(program.judgeReason, /XP|xP/);
  assert.match(program.judgeReason, /continuous\.might/);
});

test("unl-098-219 Targonian Visionary: [Level 11][>] is one static +4 Might ability for the host", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(levelEleven.kind, "static");
  // 824.1.b.2: the Dependent Ability here is "I have +4 :rb_might:" — an
  // arithmetic-layer Might change (143.2.a), not a Buff counter (702).
  assert.equal(levelEleven.effect.kind, "continuous.might");
  assert.equal(levelEleven.effect.mode, "add");
  assert.equal(levelEleven.effect.layer, "arithmetic");
  assert.deepEqual(levelEleven.effect.amount, { kind: "constant", value: 4 });
  // 053.1: "I" is the ability host.
  assert.deepEqual(levelEleven.effect.filter, { object: "self" });
});

test("unl-098-219 Targonian Visionary: the 11-XP gate keeps the 824.1.b.1 shape", () => {
  const condition = levelEleven.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 11 });
  // 824.1.c: the gate is the controller's XP (824.1.c.1 / 824.1.d re-evaluate on
  // a controller change or a drop below 11). PlayerSnapshot.xp has no Expr path
  // yet — the shape is retained, not evaluated (see judgeReason).
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "controller-xp");
  assert.deepEqual(condition.left.filter, { player: "controller" });
});

test("unl-098-219 Targonian Visionary: the merged [Level 11] KeywordDef expands the 11-XP predicate", async () => {
  const { keywordDefinitionsById } = await import(
    "../../../../engine-core/dist/effects/keywords/registry.generated.js"
  );
  // RIFT-268 landed effects/keywords/Level.ts; 824.1.a–b turn the printed
  // "[Level 11][>]" into the predicate that makes the dependent ability active.
  const definition = keywordDefinitionsById.get("Level");
  assert.ok(definition, "the merged Level KeywordDef must be registered");
  assert.equal(definition.valued, true);
  assert.equal(definition.stacking, "separate");
  const [predicate] = definition.expand({ value: 11, host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(predicate.kind, "static");
  assert.equal(predicate.effect.kind, "condition.predicate");
  assert.equal(predicate.effect.predicate, "level-active");
  assert.equal(predicate.effect.query, "controller-xp");
  assert.equal(predicate.effect.characteristic, "xp");
  assert.equal(predicate.effect.operator, "gte");
  assert.deepEqual(predicate.effect.threshold, { kind: "constant", value: 11 });
  assert.equal(predicate.effect.id, "level:" + CANONICAL_ID + ":11:predicate");
});

test("unl-098-219 Targonian Visionary: the program's declared keyword matches the merged definition", async () => {
  const { keywordDefinitionsById } = await import(
    "../../../../engine-core/dist/effects/keywords/registry.generated.js"
  );
  // The declaration half of 824.1.a is expressible today; only the predicate
  // consumers (XP evaluation plus the static-ability binder) are missing.
  const { createProgramBinding } = await import("../../../../engine-core/dist/programs/index.js");
  const { cardRegistryById } = await import("../../../dist/cards/registry.generated.js");
  const binding = createProgramBinding({ cardPrograms: cardRegistryById });
  const source = {
    ref: { id: "visionary", zoneEntryId: 1 },
    cardId: CANONICAL_ID,
    name: "Targonian Visionary",
    types: ["unit"],
    tags: ["Mount Targon"],
    keywords: [{ id: "Level", value: 11 }],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "battlefield-1" },
    combatRole: null,
    might: 6,
    energy: 6,
    power: ["Body"],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const expanded = binding.inspect(source).abilities;
  assert.equal(keywordDefinitionsById.has("Level"), true);
  assert.deepEqual(expanded.map(ability => [ability.kind, ability.effect.kind]), [
    ["static", "continuous.might"],
    ["static", "condition.predicate"]
  ]);
});

test.todo(
  "unl-098-219 Targonian Visionary: evaluate the level-active predicate against the controller's live XP " +
    "(CR 824.1.c, 824.1.c.1, 824.1.d) — condition.predicate/value consumers must read PlayerSnapshot.xp"
);
test.todo(
  "unl-098-219 Targonian Visionary: attach the dependent +4 Might text to the predicate and register it as an " +
    "arithmetic-layer ContinuousEffectSpec — no merged binder turns a CardProgram static ability into a layer " +
    "registration, and layers/engine.ts conditionMatches does not evaluate compare (RIFT-91 follow-up / RIFT-257)"
);
