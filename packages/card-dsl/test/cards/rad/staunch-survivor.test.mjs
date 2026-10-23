// Golden test for Staunch Survivor (rad-088-167).
//
// The printed ability is two keywords in one block. The merged KeywordDefs
// (Assault / Shield) own their expansions into static continuous.might, the
// merged continuous.might instruction registers the +2 with the real layer
// engine, and the production binders (programs/keywords.ts -> lifecycle -> statics)
// resolve card keyword abilities. What is still missing is the designation
// predicate in the keyword expansions: it reads object-property "designation",
// the merged ObjectSnapshot exposes only combatRole, and the binder's catch makes
// the condition permanently false, so the card stays judge-required.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/staunch-survivor.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import assault from "../../../../engine-core/dist/effects/keywords/Assault.js";
import shield from "../../../../engine-core/dist/effects/keywords/Shield.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { bindStaticAbility, createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";

const CANONICAL_ID =
  "card.hash-ef096ceda83997abf3d3e76dcd5774b08b5953e2f94e648a0d5942172d6eac39";
const SOURCE_TEXT =
  "[Assault 2], [Shield 2] (+2 :rb_might: while I'm an attacker or defender.)";
const HOST = { canonicalCardId: CANONICAL_ID };

test("rad-088-167 Staunch Survivor: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-088-167 Staunch Survivor: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // README section 2: the reason must name the missing semantics and the
  // dependent tasks, not just "needs support".
  assert.match(program.judgeReason, /Assault/);
  assert.match(program.judgeReason, /Shield/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /designation/);
  // README section 2: the reason must name the merged code that fails, never a task id.
  assert.equal(/RIFT-\d+/.test(program.judgeReason), false);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-088-167 Staunch Survivor: exactly two valued keyword abilities, Assault 2 then Shield 2", () => {
  // The printed "[Assault 2], [Shield 2]" is two keywords, in printed order,
  // each carrying its own Assault Value / Shield Value of 2 (CR 807.1.b.1-2,
  // 814.1.b.1-2).
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities, [
    { kind: "keyword", keyword: "assault", value: 2 },
    { kind: "keyword", keyword: "shield", value: 2 }
  ]);
});

test("rad-088-167 Staunch Survivor: both declared keywords resolve to the merged KeywordDefs", () => {
  const registeredAssault = keywordDefinitionsById.get("Assault");
  const registeredShield = keywordDefinitionsById.get("Shield");
  assert.ok(registeredAssault, "effects/keywords/Assault.ts must be in the generated registry");
  assert.ok(registeredShield, "effects/keywords/Shield.ts must be in the generated registry");
  assert.equal(registeredAssault, assault);
  assert.equal(registeredShield, shield);
  // Card IR uses the lowercase keyword ids; the registry is keyed by printed names.
  assert.equal(program.abilities[0].keyword, registeredAssault.keyword.toLowerCase());
  assert.equal(program.abilities[1].keyword, registeredShield.keyword.toLowerCase());
  // CR 807.2 / 814.2: same-named keywords from several sources sum into one value.
  assert.equal(registeredAssault.stacking, "sum");
  assert.equal(registeredShield.stacking, "sum");
  assert.ok(registeredAssault.ruleRefs.includes("807.1.c"));
  assert.ok(registeredShield.ruleRefs.includes("814.1.c"));
});

test("rad-088-167 Staunch Survivor: Assault 2 expands to a +2 Might static effect gated on the attacker role", () => {
  const expansion = assault.expand({ value: program.abilities[0].value, host: HOST });
  assert.equal(expansion.length, 1);
  const [ability] = expansion;
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.equal(ability.effect.appliesTo, "self");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 2 });
  // CR 807.1.c / 807.1.d.1: applies only while the Unit holds the Attacker designation.
  assert.equal(ability.condition.kind, "compare");
  assert.equal(ability.condition.left.kind, "object-property");
  assert.equal(ability.condition.left.object, "self");
  assert.equal(ability.condition.left.property, "designation");
  assert.equal(ability.condition.operator, "eq");
  assert.deepEqual(ability.condition.right, { kind: "constant", value: "attacker" });
});

test("rad-088-167 Staunch Survivor: Shield 2 expands to a +2 Might static effect gated on the defender role", () => {
  const expansion = shield.expand({ value: program.abilities[1].value, host: HOST });
  assert.equal(expansion.length, 1);
  const [ability] = expansion;
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.equal(ability.effect.appliesTo, "self");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 2 });
  // CR 814.1.c / 814.1.d.1: applies only while the Unit holds the Defender designation.
  assert.equal(ability.condition.kind, "compare");
  assert.equal(ability.condition.left.property, "designation");
  assert.equal(ability.condition.operator, "eq");
  assert.deepEqual(ability.condition.right, { kind: "constant", value: "defender" });
});

test("rad-088-167 Staunch Survivor: the combined reminder maps to one role per keyword, never one merged +2", () => {
  // The single printed reminder "(+2 :rb_might: while I'm an attacker or
  // defender.)" is the reminder text for BOTH keywords, not a third ability:
  // Assault 2 answers for the attacker role (CR 807.1.c) and Shield 2 for the
  // defender role (CR 814.1.c). A Unit holds its controller's designation and
  // loses the opposite one (CR 323.2.a/323.2.b), so the two +2s are never both
  // applicable to the same Unit in one Combat.
  const attackerAbility = assault.expand({ value: program.abilities[0].value, host: HOST })[0];
  const defenderAbility = shield.expand({ value: program.abilities[1].value, host: HOST })[0];
  assert.equal(attackerAbility.condition.right.value, "attacker");
  assert.equal(defenderAbility.condition.right.value, "defender");
  assert.notEqual(attackerAbility.condition.right.value, defenderAbility.condition.right.value);
  assert.equal(attackerAbility.effect.amount.value, defenderAbility.effect.amount.value);
});

test("rad-088-167 Staunch Survivor: both expansions validate as EffectIR for this card identity", () => {
  const expanded = validateCardProgram({
    canonicalCardId: CANONICAL_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: [
      ...assault.expand({ value: program.abilities[0].value, host: HOST }),
      ...shield.expand({ value: program.abilities[1].value, host: HOST })
    ],
    sourceText: program.sourceText
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true);
});

test("rad-088-167 Staunch Survivor: the merged continuous.might instruction really adds +2 in the arithmetic layer", () => {
  // The KeywordDef expansion's effect runs through the registered
  // continuous.might instruction: +2 is registered for the resolved unit and
  // the real LayerEngine applies it to the arithmetic result.
  const kernel = world().unit("survivor", { might: 2 }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("survivor") });
  scoped.setTargets("staunch-survivor.self", [scoped.ref("survivor")]);
  const run = runInstruction(
    might,
    {
      amount: { kind: "constant", value: 2 },
      duration: { kind: "constant", value: "this-turn" },
      target: "staunch-survivor.self"
    },
    { world: scoped }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(scoped.continuousEffects.length, 1);
  const registration = scoped.continuousEffects[0];
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 2);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  const engine = createLayerEngine(
    scoped.listObjects(),
    scoped.continuousEffects.map(entry => ({ effect: entry.effect, duration: entry.duration }))
  );
  assert.equal(engine.evaluate(scoped.ref("survivor")).might, 4);
});

test("rad-088-167 Staunch Survivor: the generated card registry exposes the program under its canonical id", () => {
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("rad-088-167 Staunch Survivor: the production binder applies both attacker and defender keywords", () => {
  // 807.1.c / 814.1.c: the expansions bind as continuous.might registrations,
  // but their conditions read object-property "designation" while the merged
  // ObjectSnapshot's designation resolves through the live combat role.
  const kernel = world().player("A").player("B")
    .unit("survivor", {
      controller: "A", owner: "A", might: 2, combatRole: "defender", zone: "board",
      location: { type: "battlefield", id: "bf-1" }, keywords: [{ id: "Assault", value: 2 }, { id: "Shield", value: 2 }]
    })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error("Unexpected choice: " + request.id); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  const binder = createEngineStaticBinder(engine);
  const snapshot = { ...kernel.getObject("survivor"), cardId: CANONICAL_ID };
  const handles = [
    bindStaticAbility(binder, assault.expand({ value: 2, host: HOST })[0], snapshot),
    bindStaticAbility(binder, shield.expand({ value: 2, host: HOST })[0], snapshot)
  ];
  engine.layers.setObjects(kernel.objects);
  assert.deepEqual(
    engine.layers.registry.list().map(entry => entry.effect.effect.kind),
    ["continuous.might", "continuous.might"]
  );
  assert.equal(engine.layers.evaluate(snapshot.ref).might, 4);
  for (const handle of handles) handle.unbind();
});

test("rad-088-167 Staunch Survivor: the designation predicate follows the combatRole equivalent", () => {
  // The production characteristic resolves to the attacker's live role.
  const kernel = world().player("A").player("B")
    .unit("survivor", { controller: "A", owner: "A", might: 2, combatRole: "attacker", zone: "board" })
    .build();
  const snapshot = kernel.getObject("survivor");
  const context = bindResolveContext(kernel, { source: snapshot, controller: "A", timingPoint: "chain-item-resolve" });
  const environment = {
    context,
    host: snapshot.ref,
    linked: key => context.linked(key),
    canLookBack: () => true,
    isIgnored: () => false
  };
  const [assaultExpansion] = assault.expand({ value: 2, host: HOST });
  assert.equal(evaluateCondition(assaultExpansion.condition, environment), true);
  assert.equal(
    evaluateCondition({
      kind: "compare",
      left: { kind: "object-property", object: "self", property: "combatRole" },
      operator: "eq",
      right: { kind: "constant", value: "attacker" }
    }, environment),
    true
  );
});

test.todo(
  "Staunch Survivor: +2 Might exactly while the 2 Might unit holds the Attacker designation and +2 while it " +
    "holds the Defender designation (CR 807.1.c / 814.1.c) - the production binders are merged, but the " +
    "keyword expansion predicates read object-property 'designation' while ObjectSnapshot exposes only " +
    "combatRole (the combatRole comparison itself evaluates true); interpreter evaluation throws " +
    "MissingInformation and bindStaticToLayers' catch makes " +
    "the condition permanently false (keywords/Assault.ts + keywords/Shield.ts)"
);

test.todo(
  "Staunch Survivor: CR 807.2 / 814.2 (with CR 466.2.c.3) - a second Assault or Shield source sums per keyword, " +
    "and role exclusivity keeps the two +2s from stacking in one Combat; keywords already declare " +
    "stacking \"sum\"; execution also depends on the designation predicate fix"
);
