import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { TurnFlow } from "../../../../engine-core/dist/turn/flow.js";

const cardId = "card.hash-6bde2e2c542ff8fc1a7a2f9204df7e6c58a05a53ad98c0a31d69927be053b77f";
const program = cardProgramsById.get(cardId);

// Official evidence for the production scenario below:
// - CR v1.5, updated 2026-10-09:
//   https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
//   (383.2.c, 383.4.e.2, 433.1, 466.2.c.3/d.1, 468.7.c, 740.2.a/b)
// - Radiance patch notes, published 2026-10-09 and effective 2026-10-16:
//   https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
// - Card text: SFD-110/221 printing in the shared read-only deck catalog.
// Timeline: one real Move applies Contested; Combat opens and establishes roles;
// the two declaration events are collected as one source batch; EventPipeline
// evaluates one-on-one per captured source; the resolved Chain instruction reads
// current Might, registers the arithmetic delta, preserves it through Combat, and
// removes it from the layer registry on combat-end.

test("fiora-peerless program is registered and validates", () => {
  assert.ok(program, "fiora-peerless must be in the generated card registry");
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("fiora-peerless structure: attack/defend triggers with one-on-one predicate and a real doubling body", () => {
  assert.equal(program.status, "executable");
  assert.equal(Object.hasOwn(program, "judgeReason"), false);
  assert.equal(program.abilities.length, 2);

  const [attack, defend] = program.abilities;
  assert.equal(attack.kind, "triggered");
  assert.equal(attack.trigger.at, "attack-declared");
  assert.equal(attack.trigger.filter.event, "attack-declared");
  assert.equal(attack.trigger.filter.filter.source, "self");
  assert.equal(attack.trigger.once, "per-combat");
  assert.equal(attack.trigger.condition.kind, "all");
  assert.deepEqual(attack.trigger.condition.conditions.map(condition => condition.left.filter), [
    { type: "unit", zone: "board", controller: "self", sameLocationAs: "source" },
    { type: "unit", zone: "board", controller: "opponent", sameLocationAs: "source" }
  ]);
  assert.equal(attack.optional, false);
  // 433.1 / 433.1.a: Doubling reads the attribute's current value at resolution
  // and registers an arithmetic-layer Might modification for this combat.
  assert.deepEqual(attack.body.map((entry) => [entry.id, entry.op]), [
    ["fiora-peerless.attack.read-might", "condition.value"],
    ["fiora-peerless.attack.double-might", "continuous.might"]
  ]);
  assert.deepEqual(attack.body[0].args.value, {
    kind: "object-property",
    object: "source",
    property: "might"
  });
  assert.deepEqual(attack.body[0].args.key, { kind: "constant", value: "might" });
  assert.equal(attack.body[1].linkedTo, "fiora-peerless.attack.read-might");
  assert.deepEqual(attack.body[1].args.amount, {
    kind: "linked-value",
    instructionId: "fiora-peerless.attack.read-might",
    key: "might"
  });
  // 468.7.c: "this combat" expires at combat-end through the merged alias.
  assert.deepEqual(attack.body[1].args.duration, { kind: "constant", value: "this-combat" });
  assert.deepEqual(attack.body[1].args.appliesTo, { kind: "constant", value: "self" });

  assert.equal(defend.kind, "triggered");
  assert.equal(defend.trigger.at, "defense-declared");
  assert.equal(defend.trigger.filter.event, "defense-declared");
  assert.equal(defend.trigger.filter.filter.source, "self");
  assert.equal(defend.trigger.once, "per-combat");
  assert.deepEqual(defend.trigger.condition, attack.trigger.condition);
  assert.deepEqual(defend.body.map((entry) => [entry.id, entry.op]), [
    ["fiora-peerless.defend.read-might", "condition.value"],
    ["fiora-peerless.defend.double-might", "continuous.might"]
  ]);
  assert.equal(defend.body[1].linkedTo, "fiora-peerless.defend.read-might");
});

test("fiora-peerless golden: the declared body really doubles the unit's Might this combat", () => {
  const base = world().unit("fiora", { might: 6, controller: "A" }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("fiora") });
  const [attack] = program.abilities;

  const outcome = resolveChainBody(attack.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["fiora-peerless.attack.read-might", "executed"],
      ["fiora-peerless.attack.double-might", "executed"]
    ]
  );
  // 433.1: the registered delta equals the Might read at resolution (6).
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  // The registration carries the per-target condition closure produced by the
  // layers ops helper; the serializable part is the Might delta itself.
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 6);
  // 468.7.c: "this combat" is the end-of-combat duration.
  assert.deepEqual(registration.duration, { type: "end-of-combat" });
  assert.equal(registration.effect.filter.objectId, "fiora");

  // The constitution of the arithmetic layer really produces 12 Might.
  const layers = createLayerEngine([kernel.getObject("fiora")], [
    { effect: registration.effect, duration: registration.duration, timestamp: 1 }
  ]);
  assert.equal(layers.evaluate(kernel.ref("fiora")).might, 12);
});

test("fiora-peerless golden: doubling reads the current Might, not a fixed amount", () => {
  const base = world().unit("fiora", { might: 2, controller: "A" }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("fiora") });
  const [, defend] = program.abilities;

  const outcome = resolveChainBody(defend.body, kernel);

  assert.equal(outcome.status, "executed");
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 2);
  const layers = createLayerEngine([kernel.getObject("fiora")], [
    { effect: registration.effect, duration: registration.duration, timestamp: 1 }
  ]);
  assert.equal(layers.evaluate(kernel.ref("fiora")).might, 4);
});

test("fiora-peerless: attack and defense trigger registrations are structurally bindable before combat emits them", () => {
  const source = world()
    .unit("fiora", {
      cardId,
      owner: "A",
      controller: "A",
      location: { type: "battlefield", id: "duel" },
      might: 6
    })
    .build()
    .getObject("fiora");
  const registrations = triggerRegistrations(
    new ProgramRegistry([program]),
    source
  );
  assert.deepEqual(registrations.map(registration => registration.spec.at), ["attack-declared", "defense-declared"]);
  assert.deepEqual(registrations.map(registration => registration.spec.once), ["per-combat", "per-combat"]);
});

// Run the authored trigger condition through the real condition interpreter.
// This is predicate evidence, not a fabricated combat declaration event.
function controllerContext(kernel) {
  return new Proxy(kernel, {
    get(target, key) {
      if (key === "query") return filter => {
        const normalized = translateObjectFilter(filter);
        if (normalized.controller === "self") normalized.controller = target.controller;
        const opponent = normalized.controller === "opponent";
        if (opponent) delete normalized.controller;
        return target.query(normalized).filter(object => !opponent || object.controller !== target.controller);
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

const field = { type: "battlefield", id: "duel" };
for (const controller of ["A", "B"]) {
  const opponent = controller === "A" ? "B" : "A";
  for (const scenario of [
    { name: "two opposing units alone", units: [[opponent, field]], expected: true },
    { name: "no enemy", units: [], expected: false },
    { name: "another friendly unit", units: [[opponent, field], [controller, field]], expected: false },
    { name: "another enemy unit", units: [[opponent, field], [opponent, field]], expected: false },
    { name: "enemy at another battlefield", units: [[opponent, { type: "battlefield", id: "other" }]], expected: false },
    { name: "other locations do not break alone", units: [[opponent, field], [controller, { type: "base", player: controller }], [opponent, { type: "battlefield", id: "other" }]], expected: true }
  ]) {
    test(`fiora-peerless condition golden (${controller}): ${scenario.name}`, () => {
      const builder = world().unit("fiora", { controller, location: field });
      scenario.units.forEach(([unitController, location], index) => builder.unit(`unit-${index}`, { controller: unitController, location }));
      // Gear and off-board units at the same location are not combat units.
      builder.unit("gear", { types: ["gear"], controller, location: field });
      builder.card("discarded", { controller, types: ["unit"], zone: "trash", location: field });
      const base = builder.build();
      const kernel = base.clone({ sourceSnapshot: base.getObject("fiora"), controller });
      for (const ability of program.abilities) {
        const outcome = resolveChainBody([{
          id: "fiora-gate", op: "condition.predicate",
          args: { condition: { kind: "constant", value: ability.trigger.condition } }
        }], controllerContext(kernel));
        assert.equal(outcome.status, "executed");
        assert.equal(outcome.linkedValues["fiora-gate.value"], scenario.expected);
        assert.deepEqual(outcome.events, []);
      }
    });
  }
}

const combatField = () => ({ type: "battlefield", id: "bf1" });

function productionFixture({
  fioraController = "A",
  battlefieldController = "B",
  fioraLocation = { type: "base", player: fioraController },
  enemyLocation = combatField(),
  extraFriendly = false,
  extraEnemy = false,
  enemyMight = 5
} = {}) {
  const opponent = fioraController === "A" ? "B" : "A";
  const builder = world().player("A").player("B")
    .unit("fiora", { cardId, owner: fioraController, controller: fioraController, might: 3, location: fioraLocation })
    .unit("enemy", { owner: opponent, controller: opponent, might: enemyMight, location: enemyLocation });
  if (extraFriendly) builder.unit("friendly", {
    owner: fioraController,
    controller: fioraController,
    might: 1,
    location: { type: "base", player: fioraController }
  });
  if (extraEnemy) builder.unit("enemy-2", { owner: opponent, controller: opponent, might: 1, location: combatField() });
  for (const player of ["A", "B"]) {
    builder.deck(Array.from({ length: 8 }, (_, index) => `${player}:deck:${index}`), { owner: player });
    builder.rune(Array.from({ length: 8 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  const kernel = builder.build();
  let fallbackCalls = 0;
  const choose = request => {
    if (request.id === "move-pair/move-pair.objects") {
      return request.options.filter(option => ["fiora", "friendly"].includes(option.id));
    }
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new Error(`Unexpected choice ${JSON.stringify(request)}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => {
      fallbackCalls++;
      return kernel.test(registration.spec.condition);
    }
  });
  const flow = new TurnFlow({
    host,
    player: id => kernel.player(id),
    turnOrder: ["A", "B"],
    battlefields: [{ id: "bf1", controller: battlefieldController }, { id: "bf2", controller: null }]
  });
  const registered = createProgramBinding({ cardPrograms: [program] })
    .registerProgramTriggers(flow.chain, kernel.getObject("fiora"));
  const firedTriggers = [];
  const appendTrigger = flow.chain.pipeline.onTrigger;
  flow.chain.pipeline.onTrigger = snapshot => {
    firedTriggers.push(snapshot.registration.id);
    appendTrigger(snapshot);
  };
  flow.start();
  return { kernel, flow, registered, firedTriggers, fallbackCalls: () => fallbackCalls };
}

function moveIntoCombat(f, objectId, controller = f.flow.turnPlayer) {
  f.flow.execute({
    id: `${objectId}-attack-move`,
    controller,
    source: f.kernel.getObject(objectId),
    kind: "activated",
    speed: "normal",
    body: [{ id: "move", op: "effect.move", args: { to: { kind: "constant", value: combatField() } } }]
  });
  while (f.flow.chain.items.length) f.flow.pass(f.flow.chain.priority);
  f.flow.chain.layers.setObjects(f.kernel.objects);
}

function moveFioraAndFriendlyIntoCombat(f) {
  f.flow.execute({
    id: "friendly-pair-attack-move",
    controller: f.flow.turnPlayer,
    source: f.kernel.getObject("fiora"),
    kind: "activated",
    speed: "normal",
    body: [{
      id: "move-pair",
      op: "effect.move",
      args: {
        objects: { kind: "constant", value: {
          kind: "choose",
          id: "move-pair.objects",
          filter: { type: "unit", zone: "board" },
          min: 2
        } },
        amount: { kind: "constant", value: 2 },
        to: { kind: "constant", value: combatField() }
      }
    }]
  });
  while (f.flow.chain.items.length) f.flow.pass(f.flow.chain.priority);
  f.flow.chain.layers.setObjects(f.kernel.objects);
}

function evaluated(f, id) {
  f.flow.chain.layers.setObjects(f.kernel.objects);
  return f.flow.chain.layers.evaluate(f.kernel.ref(id));
}

function eventCounts(flow) {
  return flow.chain.pipeline.events.reduce((counts, event) => {
    counts[event.timingPoint] = (counts[event.timingPoint] ?? 0) + 1;
    return counts;
  }, {});
}

function triggerMightRegistrations(f) {
  return f.flow.chain.layers.registry.list().filter(entry =>
    entry.effect.effect.kind === "continuous.might" && entry.effect.filter.objectId === "fiora"
  );
}

test("sfd-110-221 Fiora, Peerless: attacks one-on-one through default CombatFlow and really doubles Might", () => {
  const f = productionFixture();

  moveIntoCombat(f, "fiora");

  const events = f.flow.chain.pipeline.events;
  const declarations = events.filter(event => ["attack-declared", "defense-declared"].includes(event.timingPoint));
  assert.deepEqual(declarations.map(event => [event.timingPoint, event.object.ref.id, event.player]), [
    ["attack-declared", "fiora", "A"],
    ["defense-declared", "enemy", "B"]
  ]);
  assert.equal(declarations[0].batchId, declarations[1].batchId);
  assert.deepEqual(f.registered, ["program:fiora:1:0", "program:fiora:1:1"]);
  assert.deepEqual(f.firedTriggers, ["program:fiora:1:0"]);
  assert.equal(f.fallbackCalls(), 0);
  assert.equal(triggerMightRegistrations(f).length, 1);
  assert.equal(evaluated(f, "fiora").might, 6);
  assert.equal(evaluated(f, "enemy").might, 5);
});

test("sfd-110-221 Fiora, Peerless: defends one-on-one through default CombatFlow and really doubles Might", () => {
  const f = productionFixture({
    battlefieldController: "A",
    fioraLocation: combatField(),
    enemyLocation: { type: "base", player: "B" }
  });
  while (f.flow.chain.items.length) f.flow.pass(f.flow.chain.priority);
  f.flow.pass("A");

  moveIntoCombat(f, "enemy", "B");

  const declarations = f.flow.chain.pipeline.events
    .filter(event => ["attack-declared", "defense-declared"].includes(event.timingPoint));
  assert.deepEqual(declarations.map(event => [event.timingPoint, event.object.ref.id, event.player]).sort(), [
    ["attack-declared", "enemy", "B"],
    ["defense-declared", "fiora", "A"]
  ]);
  assert.deepEqual(f.firedTriggers, ["program:fiora:1:1"]);
  assert.equal(f.fallbackCalls(), 0);
  assert.equal(triggerMightRegistrations(f).length, 1);
  assert.equal(evaluated(f, "fiora").might, 6);
});

for (const scenario of [
  { name: "another friendly Unit is at the location", extraFriendly: true },
  { name: "a second enemy Unit is at the location", extraEnemy: true }
]) {
  test(`sfd-110-221 Fiora, Peerless: does not double when ${scenario.name}`, () => {
    const f = productionFixture(scenario);

    if (scenario.extraFriendly) moveFioraAndFriendlyIntoCombat(f);
    else moveIntoCombat(f, "fiora");

    const events = f.flow.chain.pipeline.events;
    assert.equal(events.filter(event => ["attack-declared", "defense-declared"].includes(event.timingPoint)).length, 3);
    assert.deepEqual(f.firedTriggers, []);
    assert.equal(f.fallbackCalls(), 0);
    assert.equal(triggerMightRegistrations(f).length, 0);
    assert.equal(evaluated(f, "fiora").might, 3);
  });
}

test("sfd-110-221 Fiora, Peerless: doubling lasts through Combat and expires at combat-end", () => {
  const f = productionFixture({ enemyMight: 1 });
  moveIntoCombat(f, "fiora");
  assert.equal(evaluated(f, "fiora").might, 6);

  f.flow.pass("A");
  f.flow.pass("B");
  f.flow.combat.prepareDamage();
  const damage = f.flow.combat.damageView();
  f.flow.combat.submitAttackerDamage("A", [{ uid: "enemy", amount: damage.attackerMight }]);
  f.flow.combat.submitDefenderDamage("B", [{ uid: "fiora", amount: damage.defenderMight }]);
  assert.equal(f.flow.chain.layers.registry.list().length, 1);
  assert.equal(evaluated(f, "fiora").might, 6);

  f.flow.advance();
  f.flow.advance();
  f.flow.advance();

  assert.equal(f.flow.combat.active, false);
  assert.equal(eventCounts(f.flow)["combat-end"], 1);
  assert.equal(f.flow.chain.layers.registry.list().length, 0);
  assert.equal(evaluated(f, "fiora").might, 3);
});

test("sfd-110-221 Fiora, Peerless: ships through the default ProgramRegistry with two once-per-combat triggers", () => {
  const source = world().unit("fiora", {
    cardId,
    owner: "A",
    controller: "A",
    location: combatField()
  }).build().getObject("fiora");
  const registry = new ProgramRegistry([program]);
  const registrations = triggerRegistrations(registry, source);
  assert.deepEqual(registrations.map(entry => [entry.spec.at, entry.spec.once]), [
    ["attack-declared", "per-combat"],
    ["defense-declared", "per-combat"]
  ]);
});
