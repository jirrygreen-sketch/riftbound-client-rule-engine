import assert from "node:assert/strict";
import test from "node:test";

import combat from "../../../src/effects/instructions/continuous.combat.ts";
import { createLayerEngine } from "../../../dist/layers/index.js";
import { runInstruction, world } from "../../../src/effects/testing/index.ts";

const literal = (value) => ({ kind: "constant", value });

const withSource = (kernel, id) => kernel.clone({ sourceSnapshot: kernel.getObject(id) });
const refs = (kernel, ids) => ids.map((id) => kernel.ref(id));
const keywordIds = (snapshot) => snapshot.keywords.map((keyword) => keyword.id);

function createEngine(objects, entries) {
  return createLayerEngine(
    objects,
    entries.map((entry) => ({
      effect: entry.effect,
      duration: entry.duration ?? { type: "permanent" },
      timestamp: entry.timestamp ?? 1
    }))
  );
}

test("continuous.combat opcode and args schema are stable", () => {
  assert.equal(combat.op, "continuous.combat");
  assert.equal(typeof combat.argsSchema.parse, "function");
  assert.equal(combat.argsSchema.safeParse(7).success, false);
  assert.equal(combat.argsSchema.safeParse({ flags: "tank" }).success, false);
  assert.equal(combat.argsSchema.safeParse({ flags: [{}] }).success, false);
  // flags 缺省合法（空数组），duration 缺省 end-of-combat。
  assert.equal(combat.argsSchema.safeParse({}).success, true);
});

test("self registration persists the kind and default end-of-combat duration", () => {
  const kernel = withSource(world().unit("front").build(), "front");
  const run = runInstruction(combat, { appliesTo: literal("self") }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  const registration = kernel.continuousEffects[0];
  assert.deepEqual(registration.duration, { type: "end-of-combat" });
  assert.equal(registration.effect.layer, "ability");
  assert.equal(registration.effect.source.id, "front");
  assert.equal(registration.effect.filter.objectId, "front");
  assert.equal(registration.effect.effect.kind, "continuous.combat");
  assert.deepEqual(registration.effect.effect.keywords, []);
  assert.equal(registration.effect.effect.keyword, undefined);
  assert.deepEqual(run.linked.affected, { count: 1, objects: refs(kernel, ["front"]) });
  assert.equal(run.linked["affected.count"], 1);
});

test("flags register as keyword-grant rows for the combat workflow to consume", () => {
  const kernel = withSource(world().unit("front").build(), "front");
  const run = runInstruction(combat, {
    flags: literal(["tank"]),
    appliesTo: literal("self")
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  const effect = kernel.continuousEffects[0].effect.effect;
  assert.equal(effect.kind, "continuous.combat");
  assert.deepEqual(effect.keywords, [{ id: "tank" }]);
  assert.equal(effect.keyword, undefined);
  assert.equal(effect.value, undefined);
});

test("flags apply to each resolved object with one registration per object", () => {
  const kernel = withSource(world().unit("u1").unit("u2").build(), "u1");
  const run = runInstruction(combat, {
    flags: literal(["first-strike"]),
    objects: refs(kernel, ["u1", "u2"])
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 2);
  for (const registration of kernel.continuousEffects) {
    assert.equal(registration.effect.layer, "ability");
    assert.deepEqual(registration.effect.effect.keywords, [{ id: "first-strike" }]);
  }
  assert.deepEqual(run.linked.affected.objects.map((ref) => ref.id), ["u1", "u2"]);
});

test("a fully stale target ref makes the instruction ignored mistargeted", () => {
  const kernel = world().unit("gone").build();
  const staleRef = kernel.ref("gone");
  kernel.perform({ type: "kill", object: staleRef });
  const run = runInstruction(combat, { objects: [staleRef] }, { world: kernel });

  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.continuousEffects.length, 0);
});

test("a must-choose with no legal options is negated impossible (CR 359.3.e.9)", () => {
  const kernel = withSource(world().unit("u1").build(), "u1");
  const run = runInstruction(combat, {
    objects: literal({ kind: "choose", id: "pick-one", filter: { type: "gear" }, min: 1, max: 1 })
  }, { world: kernel });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.continuousEffects.length, 0);
});

test("an up-to-one choose asks through ctx.choose and consumes the answer", () => {
  const kernel = withSource(world().unit("a1").unit("a2").build(), "a1");
  const descriptor = { kind: "choose", id: "pick-up-to-one", filter: { type: "unit" }, min: 0, max: 1 };
  const asked = runInstruction(combat, { objects: literal(descriptor) }, { world: kernel });
  assert.ok(asked.asked);
  assert.equal(asked.asked.request.id, "pick-up-to-one");

  const answered = runInstruction(combat, { objects: literal(descriptor) }, {
    world: kernel,
    answers: { "pick-up-to-one": refs(kernel, ["a2"]) }
  });
  assert.equal(answered.result.status, "executed");
  assert.deepEqual(answered.linked.affected.objects, refs(kernel, ["a2"]));
});

test("explicit this-turn duration is honored and expires at turn-end", () => {
  const kernel = withSource(world().unit("u1").build(), "u1");
  runInstruction(combat, {
    flags: literal(["rally"]),
    duration: literal("this-turn")
  }, { world: kernel });
  const entry = kernel.continuousEffects[0];
  // A consumer-side ability grant proves the persisted row is grant-shaped; the
  // kind itself is inert in the layer engine (contract change request below).
  const engine = createEngine([kernel.getObject("u1")], [{ ...entry, effect: { ...entry.effect, effect: { ...entry.effect.effect, kind: "continuous.grant-keyword" } } }]);
  assert.deepEqual(keywordIds(engine.evaluate({ id: "u1", zoneEntryId: 1 })), ["rally"]);
  assert.deepEqual(engine.advance({ id: "combat-end" }), []);
  assert.deepEqual(engine.advance({ id: "turn-end" }), [entry.effect.id]);
  assert.deepEqual(keywordIds(engine.evaluate({ id: "u1", zoneEntryId: 1 })), []);
});

test("default duration expires at combat-end and not at turn-end", () => {
  const kernel = withSource(world().unit("u1").build(), "u1");
  runInstruction(combat, { flags: literal(["tank"]) }, { world: kernel });
  const entry = kernel.continuousEffects[0];
  const engine = createEngine([kernel.getObject("u1")], [{ ...entry, effect: { ...entry.effect, effect: { ...entry.effect.effect, kind: "continuous.grant-keyword" } } }]);
  assert.deepEqual(keywordIds(engine.evaluate({ id: "u1", zoneEntryId: 1 })), ["tank"]);
  assert.deepEqual(engine.advance({ id: "turn-end" }), []);
  assert.deepEqual(keywordIds(engine.evaluate({ id: "u1", zoneEntryId: 1 })), ["tank"]);
  assert.deepEqual(engine.advance({ id: "combat-end" }), [entry.effect.id]);
  assert.deepEqual(keywordIds(engine.evaluate({ id: "u1", zoneEntryId: 1 })), []);
});

test("while-source-in-zone ends when the source leaves its zone", () => {
  const kernel = withSource(world().unit("aura-source").unit("u1").build(), "aura-source");
  runInstruction(combat, {
    flags: literal(["lifelink"]),
    duration: literal("while-source-in-zone"),
    objects: literal({ kind: "query", filter: { type: "unit", controller: "A" } })
  }, { world: kernel });
  const all = [kernel.getObject("aura-source"), kernel.getObject("u1")];
  const engine = createEngine(all, kernel.continuousEffects.map((entry) => ({ ...entry, effect: { ...entry.effect, effect: { ...entry.effect.effect, kind: "continuous.grant-keyword" } } })));
  assert.deepEqual(keywordIds(engine.evaluate({ id: "u1", zoneEntryId: 1 })), ["lifelink"]);
  engine.setObjects([kernel.getObject("u1")]);
  engine.advance({ id: "object-leaves-zone" });
  assert.deepEqual(keywordIds(engine.evaluate({ id: "u1", zoneEntryId: 1 })), []);
});

