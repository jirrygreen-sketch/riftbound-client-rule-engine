import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const cardId = "card.hash-6bde2e2c542ff8fc1a7a2f9204df7e6c58a05a53ad98c0a31d69927be053b77f";
const program = cardProgramsById.get(cardId);

test("fiora-peerless program is registered and validates", () => {
  assert.ok(program, "fiora-peerless must be in the generated card registry");
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("fiora-peerless structure: attack/defend triggers with one-on-one predicate and a real doubling body", () => {
  assert.equal(program.status, "judge-required");
  assert.ok(program.judgeReason.includes("one-on-one"), "judgeReason must explain the supported one-on-one gate");
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
      controller: "A",
      location: { type: "battlefield", id: "duel" },
      might: 6
    })
    .build()
    .getObject("fiora");
  const registrations = triggerRegistrations(
    new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]),
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

test.todo(
  "fiora-peerless: produce attack-declared/defense-declared from CR 466.2's atomic combat-start role " +
    "transaction and evaluate the authored condition at trigger collection via the production testTrigger adapter"
);
