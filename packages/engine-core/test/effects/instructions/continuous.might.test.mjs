import assert from "node:assert/strict";
import test from "node:test";

import might from "../../../src/effects/instructions/continuous.might.ts";
import { createLayerEngine } from "../../../dist/layers/index.js";
import { runInstruction, world } from "../../../src/effects/testing/index.ts";
import { applyMightMinimums } from "../../../src/layers/ops/index.ts";

const literal = (value) => ({ kind: "constant", value });
const target = (id) => literal({ kind: "target", id });
const sourceSel = literal({ kind: "source" });
const battlefield = { type: "battlefield", id: "battlefield-1" };

const withSource = (kernel, id) => kernel.clone({ sourceSnapshot: kernel.getObject(id) });
const refs = (kernel, ids) => ids.map((id) => kernel.ref(id));

test("continuous.might opcode and args schema are stable", () => {
  assert.equal(might.op, "continuous.might");
  assert.equal(typeof might.argsSchema.parse, "function");
  assert.equal(typeof might.argsSchema.safeParse, "function");
  assert.equal(might.argsSchema.safeParse(7).success, false);
  assert.equal(might.argsSchema.safeParse({ amount: 1, extra: true }).success, false);
});

test("jinx-rebel: +1 Might to self for this turn registers an end-of-turn arithmetic effect", () => {
  const kernel = withSource(world().unit("u1", { might: 2 }).build(), "u1");
  const run = runInstruction(might, {
    amount: literal(1),
    duration: literal("this-turn")
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  const registration = kernel.continuousEffects[0];
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.source.id, "u1");
  assert.equal(registration.effect.filter.objectId, "u1");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 1);
  assert.deepEqual(run.linked.affected, { count: 1, objects: [kernel.ref("u1")] });
  assert.equal(run.linked["affected.count"], 1);
});

test("lux-illuminated: appliesTo self resolves to the ability source", () => {
  const kernel = withSource(world().unit("lux", { might: 3 }).build(), "lux");
  const run = runInstruction(might, {
    amount: literal(3),
    appliesTo: literal("self"),
    duration: literal("end-of-turn")
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects[0].effect.filter.objectId, "lux");
  assert.deepEqual(run.linked.affected.objects, [kernel.ref("lux")]);
});

test("independent settlements receive distinct deterministic effect ids", () => {
  const kernel = withSource(world().unit("u1", { might: 2 }).build(), "u1");
  runInstruction(might, { amount: literal(1), appliesTo: literal("self") }, { world: kernel });
  runInstruction(might, { amount: literal(1), appliesTo: literal("self") }, { world: kernel });
  assert.equal(kernel.continuousEffects.length, 2);
  assert.notEqual(kernel.continuousEffects[0].effect.id, kernel.continuousEffects[1].effect.id);
  assert.match(kernel.continuousEffects[0].effect.id, /settlement-1/);
  assert.match(kernel.continuousEffects[1].effect.id, /settlement-2/);
});

test("a new zone entry does not receive an old registration", () => {
  const kernel = withSource(world().unit("u1", { might: 2 }).build(), "u1");
  runInstruction(might, { amount: literal(2), appliesTo: literal("self") }, { world: kernel });
  const engine = createEngine([kernel.getObject("u1")], kernel.continuousEffects);
  assert.equal(engine.evaluate({ id: "u1", zoneEntryId: 1 }).might, 4);
  kernel.perform({ type: "return-to-hand", object: { id: "u1", zoneEntryId: 1 } });
  kernel.addObject({ ...kernel.getObject("u1"), ref: { id: "u1", zoneEntryId: 2 }, zone: "board" }, "board");
  engine.setObjects([kernel.getObject("u1")]);
  assert.equal(engine.evaluate({ id: "u1", zoneEntryId: 2 }).might, 2);
});

test("undertitan-style query: several objects each get their own registration", () => {
  const kernel = withSource(world().unit("u1", { might: 1 }).unit("u2", { might: 2 }).unit("other", { might: 5, owner: "B" }).build(), "u1");
  const run = runInstruction(might, {
    amount: literal(2),
    duration: literal("this-turn"),
    objects: literal({ kind: "query", filter: { type: "unit", controller: "A" } })
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 2);
  assert.deepEqual(run.linked.affected.objects, refs(kernel, ["other", "u1", "u2"]).slice(1));
});

test("explicit refs and linked results resolve", () => {
  const kernel = withSource(world().unit("u1").unit("u2").build(), "u1");
  const run = runInstruction(might, {
    amount: literal(-1),
    objects: refs(kernel, ["u1", "u2"])
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 2);
  assert.deepEqual(run.linked.affected.objects.map((ref) => ref.id), ["u1", "u2"]);
});

test("set mode writes a set-might effect", () => {
  const kernel = withSource(world().unit("u1", { might: 5 }).build(), "u1");
  const run = runInstruction(might, {
    mode: literal("set"),
    amount: literal(3),
    duration: literal("end-of-turn")
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  const effect = kernel.continuousEffects[0].effect.effect;
  assert.equal(effect.kind, "set-might");
  assert.equal(effect.value, 3);
});

test("amount zero in add mode is a skipped negation with no registration", () => {
  const kernel = withSource(world().unit("u1").build(), "u1");
  const run = runInstruction(might, { amount: literal(0) }, { world: kernel });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.equal(kernel.continuousEffects.length, 0);
  assert.deepEqual(run.linked.affected, { count: 0, objects: [] });
});

test("a fully stale target ref makes the instruction ignored mistargeted", () => {
  const kernel = world().unit("u1", { might: 2 }).build();
  const staleRef = kernel.ref("u1");
  kernel.perform({ type: "kill", object: staleRef });
  const run = runInstruction(might, {
    amount: literal(-2),
    objects: [staleRef]
  }, { world: kernel });

  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.continuousEffects.length, 0);
});

test("a partially stale ref list only registers survivors (CR 359.3.e.8)", () => {
  const kernel = world().unit("gone").unit("kept", { might: 4 }).build();
  const staleRef = kernel.ref("gone");
  kernel.perform({ type: "kill", object: staleRef });
  const run = runInstruction(might, {
    amount: literal(1),
    objects: [staleRef, kernel.ref("kept")]
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.deepEqual(run.linked.affected.objects, [kernel.ref("kept")]);
});

test("a must-choose with no legal options is negated impossible (CR 359.3.e.9)", () => {
  const kernel = withSource(world().unit("u1").build(), "u1");
  const run = runInstruction(might, {
    amount: literal(2),
    objects: literal({ kind: "choose", id: "pick-one", filter: { type: "gear" }, min: 1, max: 1 })
  }, { world: kernel });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.continuousEffects.length, 0);
});

test("a single-option must-choose still asks through ctx.choose (contract 3.3)", () => {
  const kernel = withSource(world().unit("only", { might: 2 }).build(), "only");
  const asked = runInstruction(might, {
    amount: literal(2),
    objects: literal({ kind: "choose", id: "pick-one", filter: { type: "unit" }, min: 1, max: 1 })
  }, { world: kernel });

  assert.ok(asked.asked);
  assert.equal(asked.asked.request.id, "pick-one");

  const run = runInstruction(might, {
    amount: literal(2),
    objects: literal({ kind: "choose", id: "pick-one", filter: { type: "unit" }, min: 1, max: 1 })
  }, { world: kernel, answers: { "pick-one": refs(kernel, ["only"]) } });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.deepEqual(run.linked.affected.objects, [kernel.ref("only")]);
});

test("an up-to-one choose asks through ctx.choose and consumes the answer", () => {
  const kernel = withSource(world().unit("a1", { might: 2 }).unit("a2", { might: 2 }).build(), "a1");
  const descriptor = { kind: "choose", id: "pick-up-to-one", filter: { type: "unit" }, min: 0, max: 1 };
  const asked = runInstruction(might, {
    amount: literal(2),
    objects: literal(descriptor)
  }, { world: kernel });
  assert.ok(asked.asked);
  assert.equal(asked.asked.request.id, "pick-up-to-one");

  const answered = runInstruction(might, {
    amount: literal(2),
    objects: literal(descriptor)
  }, { world: kernel, answers: { "pick-up-to-one": [kernel.ref("a2")] } });
  assert.equal(answered.result.status, "executed");
  assert.deepEqual(answered.linked.affected.objects, [kernel.ref("a2")]);
});

test("end-of-turn effects expire at turn-end and not at combat-end", () => {
  const kernel = withSource(world().unit("u1", { might: 2 }).build(), "u1");
  runInstruction(might, {
    amount: literal(2),
    duration: literal("end-of-turn")
  }, { world: kernel });
  const entries = kernel.continuousEffects;
  const engine = createEngine([{ ...kernel.getObject("u1"), location: battlefield }], entries);
  assert.equal(engine.evaluate({ id: "u1", zoneEntryId: 1 }).might, 4);
  assert.deepEqual(engine.advance({ id: "combat-end" }), []);
  assert.equal(engine.evaluate({ id: "u1", zoneEntryId: 1 }).might, 4);
  assert.deepEqual(engine.advance({ id: "turn-end" }), [kernel.continuousEffects[0].effect.id]);
  assert.equal(engine.evaluate({ id: "u1", zoneEntryId: 1 }).might, 2);
});

test("end-of-combat effects expire at combat-end", () => {
  const kernel = withSource(world().unit("u1", { might: 3 }).build(), "u1");
  runInstruction(might, {
    amount: literal(2),
    duration: literal("this-combat")
  }, { world: kernel });
  const engine = createEngine([kernel.getObject("u1")], kernel.continuousEffects);
  assert.equal(engine.evaluate({ id: "u1", zoneEntryId: 1 }).might, 5);
  engine.advance({ id: "combat-end" });
  assert.equal(engine.evaluate({ id: "u1", zoneEntryId: 1 }).might, 3);
});

test("while-source-in-zone ends when the source leaves its zone", () => {
  const kernel = withSource(world().unit("aura-source").unit("u1", { might: 2 }).build(), "aura-source");
  runInstruction(might, {
    amount: literal(1),
    duration: literal("while-source-in-zone"),
    objects: literal({ kind: "query", filter: { type: "unit", controller: "A" } })
  }, { world: kernel });
  const all = [kernel.getObject("aura-source"), kernel.getObject("u1")];
  const engine = createEngine(all, kernel.continuousEffects);
  assert.equal(engine.evaluate({ id: "u1", zoneEntryId: 1 }).might, 3);
  engine.setObjects([kernel.getObject("u1")]);
  engine.advance({ id: "object-leaves-zone" });
  assert.equal(engine.evaluate({ id: "u1", zoneEntryId: 1 }).might, 2);
});

test("duration aliases this-turn and end-of-turn produce the same registration", () => {
  const build = (kernel, value) => {
    const clean = kernel.clone();
    const result = runInstruction(might, {
      amount: literal(1),
      duration: literal(value)
    }, { world: clean });
    assert.equal(result.result.status, "executed");
    return clean.continuousEffects[0].duration;
  };
  const kernel = withSource(world().unit("u1").build(), "u1");
  assert.deepEqual(build(kernel, "this-turn"), build(kernel, "end-of-turn"));
  assert.deepEqual(build(kernel, "this-combat"), { type: "end-of-combat" });
  assert.deepEqual(build(kernel, "permanent"), { type: "permanent" });
});

test("an until duration requires a real timing point", () => {
  const kernel = withSource(world().unit("u1").build(), "u1");
  const run = runInstruction(might, {
    amount: literal(1),
    duration: literal({ type: "until", at: "turn-end", player: "A" })
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.continuousEffects[0].duration, { type: "until", at: "turn-end", player: "A" });

  const bad = might.argsSchema.safeParse({
    amount: 1,
    duration: { type: "until", at: "not-a-timing-point" }
  });
  assert.equal(bad.success, false);
});

test("an unknown duration string fails schema validation", () => {
  const bad = might.argsSchema.safeParse({ amount: 1, duration: "until-you-choose-another-gear-with-me" });
  assert.equal(bad.success, false);
});

test("negative might clamps at zero through the layer engine (CR 143.2.c)", () => {
  const kernel = withSource(world().unit("u1", { might: 1 }).build(), "u1");
  runInstruction(might, { amount: literal(-3), duration: literal("end-of-turn") }, { world: kernel });
  const engine = createEngine([kernel.getObject("u1")], kernel.continuousEffects);
  assert.equal(engine.evaluate({ id: "u1", zoneEntryId: 1 }).might, 0);
});

test("per-effect printed minimum follows CR 478.1.c step ordering", () => {
  const snapshot = { might: 6, zone: "board", ref: { id: "u1", zoneEntryId: 1 } };
  const entries = [
    { effect: { id: "a", layer: "arithmetic", filter: {}, effect: { kind: "continuous.might", amount: -1, minimum: 1 } }, minimum: 1 },
    { effect: { id: "b", layer: "arithmetic", filter: {}, effect: { kind: "continuous.might", amount: -1, minimum: 1 } }, minimum: 1 }
  ];
  assert.equal(applyMightMinimums(snapshot, entries), 4);
});

test("a per-effect floor lifts a step above the engine's final zero clamp", () => {
  const snapshot = { might: 2, zone: "board", ref: { id: "u1", zoneEntryId: 1 } };
  const entries = [
    { effect: { id: "a", layer: "arithmetic", filter: {}, effect: { kind: "continuous.might", amount: -3, minimum: 1 } }, minimum: 1 }
  ];
  assert.equal(applyMightMinimums(snapshot, entries), 1);
});

test("minimum snapshots the limited delta before later arithmetic changes", () => {
  const kernel = withSource(world().unit("u1", { might: 2 }).build(), "u1");
  runInstruction(might, { amount: literal(-3), minimum: literal(1), appliesTo: literal("self") }, { world: kernel });
  const first = kernel.continuousEffects[0];
  const later = permanentEntry("later", { kind: "continuous.might", amount: 5 });
  const engine = createEngine([kernel.getObject("u1")], [first, later]);
  assert.equal(engine.evaluate({ id: "u1", zoneEntryId: 1 }).might, 6);
});

test("the engine's generic path clamps only at zero, which is why the helper exists", () => {
  const unit = { ...snapshotOf("u1", 6) };
  const engine = createEngine([unit], [
    permanentEntry("a", { kind: "continuous.might", amount: -1, minimum: 1 }),
    permanentEntry("b", { kind: "continuous.might", amount: -1, minimum: 1 })
  ]);
  assert.equal(engine.evaluate({ id: "u1", zoneEntryId: 1 }).might, 4);
});

function createEngine(objects, entries) {
  return createLayerEngine(objects, entries.map(toRegistered));
}

function toRegistered(entry) {
  return { effect: entry.effect, duration: entry.duration ?? { type: "permanent" }, timestamp: entry.timestamp ?? 1 };
}

function permanentEntry(id, effect) {
  return { effect: { id, layer: "arithmetic", filter: { objectId: "u1" }, effect }, duration: { type: "permanent" }, timestamp: 1 };
}

function snapshotOf(id, might) {
  return { ref: { id, zoneEntryId: 1 }, name: id, types: ["unit"], tags: [], keywords: [], owner: "A", controller: "A", zone: "board", location: battlefield, might, energy: 1, power: ["Fury"], exhausted: false, damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false };
}

