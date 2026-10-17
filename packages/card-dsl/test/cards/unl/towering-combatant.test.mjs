import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/towering-combatant.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { requirements, restrictions } from "../../../../engine-core/dist/layers/rules/query.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-954548f2a1317ac2bc2954489da0730ecf613acc22887c0dc6c46d250c025391";
const SOURCE_TEXT =
  "[Shield 2] (+2 :rb_might: while I'm a defender.)\n" +
  "[Tank] (I must be assigned combat damage first.)";

const [shield, tank] = program.abilities;

/**
 * Build a real board unit through the merged test kernel. combatRole is the
 * contract 3.8 characteristic (ObjectSnapshot); "designation" deliberately does
 * not exist on the snapshot, which is exactly what the golden pins.
 */
function boardUnit(f, { combatRole }) {
  const ref = f.kernel.addObject({
    ref: { id: "towering-combatant", zoneEntryId: 1 },
    cardId: CANONICAL_ID,
    name: "Towering Combatant",
    types: ["unit"],
    tags: ["Shurima"],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "battlefield-1" },
    combatRole,
    might: 3,
    energy: 4,
    power: ["Body"],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  });
  f.engine.layers.setObjects(f.kernel.objects);
  return ref;
}

test("unl-099-219 Towering Combatant: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-099-219 Towering Combatant: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /814/);
  assert.match(program.judgeReason, /815/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /base-combat-allocation/);
  // RIFT-349 merged the CardProgram -> layers binder, so the reason no longer
  // lists a missing registration path as the blocker; the current gap must be
  // the designation predicate and the absent combat consumer.
  assert.match(program.judgeReason, /RIFT-349/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257\b/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /continuous\.combat/);
});

test("unl-099-219 Towering Combatant: both printed lines are keyword declarations only", () => {
  assert.equal(program.abilities.length, 2);
  // 814.1.b.1 / 814.1.b.2: Shield 2 carries its printed Shield Value.
  assert.deepEqual(shield, { kind: "keyword", keyword: "shield", value: 2 });
  // 815.1: Tank carries no value (815.2: multiple instances are redundant).
  assert.deepEqual(tank, { kind: "keyword", keyword: "tank" });
});

test("unl-099-219 Towering Combatant: the reminders are not re-authored as instructions", () => {
  // README §5: the bracketed keyword plus its reminder is one keyword entry;
  // no effect.* instruction, target or static numeric bonus is invented here.
  for (const ability of program.abilities) {
    assert.equal(ability.body, undefined);
    assert.equal(ability.effect, undefined);
    assert.equal(ability.trigger, undefined);
  }
});

test("unl-099-219 Towering Combatant: both keyword expansions are registered", () => {
  const shieldDefinition = keywordDefinitionsById.get("Shield");
  const tankDefinition = keywordDefinitionsById.get("Tank");
  assert.ok(shieldDefinition, "the merged Shield KeywordDef must be registered");
  assert.ok(tankDefinition, "the merged Tank KeywordDef must be registered");
  // 814.2 / 815.2: Shield sums, Tank is redundant.
  assert.equal(shieldDefinition.stacking, "sum");
  assert.equal(tankDefinition.stacking, "single");
});

test("unl-099-219 Towering Combatant: [Tank] expands to a continuous.combat requirement with no combat consumer", () => {
  // 815.1.b / 815.1.c.1-.2: Tank is a passive combat-damage assignment
  // requirement; the merged expansion declares it but no combat step reads it.
  const definitions = keywordDefinitionsById.get("Tank");
  const [expansion] = definitions.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "continuous.combat");
  assert.equal(expansion.effect.mode, "damage-assignment");
  assert.equal(expansion.effect.priority, "first");
  assert.equal(expansion.effect.damage, "lethal");
});

test("unl-099-219 Towering Combatant: the production binder registers both expansions, and the defending +2 still never applies", () => {
  // RIFT-349 landed the CardProgram -> layers binder, so both keyword
  // expansions really do get registered. The golden pins what still fails:
  // Shield 2 is gated on object-property "designation", the merged snapshot
  // exposes only combatRole, the binder wrapper swallows MissingInformation as
  // false, and a genuine Defender therefore keeps its printed Might.
  const f = fixture();
  const ref = boardUnit(f, { combatRole: "defender" });
  const source = f.kernel.getObject("towering-combatant");
  assert.equal(source.combatRole, "defender");
  assert.equal(Object.hasOwn(source, "designation"), false);
  const binder = createEngineStaticBinder(f.engine);
  const [shieldExpansion] = keywordDefinitionsById.get("Shield").expand({ value: shield.value, host: { canonicalCardId: CANONICAL_ID } });
  // 814.1.c / 814.1.d.1: the expansion is +2 Might gated on the Defender designation.
  assert.equal(shieldExpansion.kind, "static");
  assert.equal(shieldExpansion.effect.kind, "continuous.might");
  assert.deepEqual(shieldExpansion.effect.amount, { kind: "constant", value: 2 });
  assert.equal(shieldExpansion.condition.kind, "compare");
  assert.equal(shieldExpansion.condition.operator, "eq");
  assert.deepEqual(shieldExpansion.condition.left, {
    kind: "object-property",
    object: "self",
    property: "designation"
  });
  assert.deepEqual(shieldExpansion.condition.right, { kind: "constant", value: "defender" });
  const shieldHandle = binder.bindStatic(shieldExpansion, source);
  f.engine.layers.setObjects(f.kernel.objects);
  const [shieldRegistration] = f.engine.layers.registry.list();
  assert.equal(shieldRegistration.effect.layer, "arithmetic");
  assert.equal(shieldRegistration.effect.effect.kind, "continuous.might");
  assert.equal(shieldRegistration.effect.effect.amount, 2);
  assert.equal(typeof shieldRegistration.effect.effect.condition, "function");
  // 814.1.c / 814.1.d.1: as a defender the Might should be 5; it stays 3.
  assert.equal(f.engine.layers.snapshot(ref).might, 3);
  assert.equal(f.engine.layers.snapshot(ref).keywords.length, 0);
  shieldHandle.unbind();
});

test("unl-099-219 Towering Combatant: the registered [Tank] ability is inert for damage assignment", () => {
  // The production binder accepts the Tank expansion (ability layer), but no
  // merged consumer turns it into an assignment-priority requirement, and no
  // rule query reports one.
  const f = fixture();
  const ref = boardUnit(f, { combatRole: null });
  const source = f.kernel.getObject("towering-combatant");
  const [tankExpansion] = keywordDefinitionsById.get("Tank").expand({ host: { canonicalCardId: CANONICAL_ID } });
  const handle = createEngineStaticBinder(f.engine).bindStatic(tankExpansion, source);
  f.engine.layers.setObjects(f.kernel.objects);
  const [registration] = f.engine.layers.registry.list();
  assert.equal(registration.effect.layer, "ability");
  assert.equal(registration.effect.effect.kind, "continuous.combat");
  assert.equal(registration.effect.effect.mode, "damage-assignment");
  assert.equal(registration.effect.effect.priority, "first");
  assert.equal(registration.effect.effect.damage, "lethal");
  // 815.1.b / 815.1.c.1-.2: registering the requirement must not silently
  // change the unit; the layers evaluation ignores the unknown ability kind.
  const snapshot = f.engine.layers.snapshot(ref);
  assert.equal(snapshot.might, 3);
  assert.deepEqual(snapshot.keywords, []);
  assert.deepEqual(snapshot.actionTimings, []);
  // and no merged rule query exposes the printed requirement to combat.
  assert.deepEqual(restrictions(f.engine.layers.registry, "damage", ref, snapshot, "A"), []);
  assert.deepEqual(requirements(f.engine.layers.registry, "damage", ref, snapshot, "A"), []);
  handle.unbind();
});

test("unl-099-219 Towering Combatant: registration-path claims in the old golden are gone", () => {
  // The previous golden asserted "no merged path registers a CardProgram static
  // ability into layers" by hand-building a raw ContinuousEffectSpec and pinning
  // the un-gated +2. RIFT-349 merged that path, so the replacement assertions
  // above go through the real binder instead.
  const binding = createEngineStaticBinder(fixture().engine);
  assert.equal(typeof binding.bindStatic, "function");
  assert.equal(program.judgeReason.includes("createEngineStaticBinder"), true);
});

test.todo(
  "unl-099-219 Towering Combatant: honour Shield 2's 'I'm a defender' condition (CR 814.1.c/814.1.d.1) - " +
    "keywords/Shield.ts reads object-property designation while the merged ObjectSnapshot exposes only " +
    "combatRole, so the +2 never applies (engine-core keywords fix + designation producer, RIFT-359)"
);
test.todo(
  "unl-099-219 Towering Combatant: execute [Tank] by binding the 815.1.b / 815.1.c.1-.2 combat-damage " +
    "assignment requirement - the Tank KeywordDef is merged (RIFT-264) and its continuous.combat " +
    "registration is accepted, but combat/base-combat-allocation.ts binds no assignment priority " +
    "and no merged consumer reads it (RIFT-258 follow-up / combat workstream)"
);

