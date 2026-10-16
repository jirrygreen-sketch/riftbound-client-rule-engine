import assert from "node:assert/strict";
import test from "node:test";

import keyword from "../../../src/effects/instructions/continuous.keyword.ts";
import { createLayerEngine } from "../../../dist/layers/index.js";
import { runInstruction, world } from "../../../src/effects/testing/index.ts";

const literal = (value) => ({ kind: "constant", value });

const withSource = (kernel, id) => kernel.clone({ sourceSnapshot: kernel.getObject(id) });
const refs = (kernel, ids) => ids.map((id) => kernel.ref(id));

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

test("continuous.keyword opcode and args schema are stable", () => {
  assert.equal(keyword.op, "continuous.keyword");
  assert.equal(typeof keyword.argsSchema.parse, "function");
  assert.equal(keyword.argsSchema.safeParse(7).success, false);
  assert.equal(keyword.argsSchema.safeParse({ extra: true }).success, false);
  assert.equal(keyword.argsSchema.safeParse({}).success, true);
});

test("missing keyword args remain blocked", () => {
  const kernel = withSource(world().unit("hero").build(), "hero");
  const run = runInstruction(keyword, { appliesTo: literal("self") }, { world: kernel });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.continuousEffects.length, 0);
});

test("an explicit keyword is granted with keywordValue and no arithmetic value", () => {
  const kernel = withSource(world().unit("hero").build(), "hero");
  const run = runInstruction(keyword, {
    keyword: literal("burn"),
    value: literal(1),
    duration: literal("this-turn")
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  const effect = kernel.continuousEffects[0].effect.effect;
  assert.equal(effect.keyword, "burn");
  assert.equal(effect.keywordValue, 1);
  assert.equal(effect.value, undefined);
  assert.deepEqual(kernel.continuousEffects[0].duration, { type: "end-of-turn" });
});

test("keywords list becomes one registration per object", () => {
  const kernel = withSource(world().unit("u1").unit("u2").build(), "u1");
  const run = runInstruction(keyword, {
    keywords: literal(["assault", { id: "flying", value: 2 }]),
    objects: refs(kernel, ["u1", "u2"])
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 2);
  for (const registration of kernel.continuousEffects) {
    assert.deepEqual(registration.effect.effect.keywords, [{ id: "assault" }, { id: "flying", value: 2 }]);
    assert.equal(registration.effect.effect.keyword, undefined);
  }
  assert.deepEqual(run.linked.granted.objects.map((ref) => ref.id), ["u1", "u2"]);
});

test("a fully stale target ref makes the instruction ignored mistargeted", () => {
  const kernel = world().unit("gone").build();
  const staleRef = kernel.ref("gone");
  kernel.perform({ type: "kill", object: staleRef });
  const run = runInstruction(keyword, { keyword: literal("burn"), objects: [staleRef] }, { world: kernel });

  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.continuousEffects.length, 0);
});

test("a must-choose with no legal options is negated impossible (CR 359.3.e.9)", () => {
  const kernel = withSource(world().unit("u1").build(), "u1");
  const run = runInstruction(keyword, {
    objects: literal({ kind: "choose", id: "pick-one", filter: { type: "gear" }, min: 1, max: 1 })
  }, { world: kernel });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.continuousEffects.length, 0);
});

test("an up-to-one choose asks through ctx.choose and consumes the answer", () => {
  const kernel = withSource(world().unit("a1").unit("a2").build(), "a1");
  const descriptor = { kind: "choose", id: "pick-up-to-one", filter: { type: "unit" }, min: 0, max: 1 };
  const asked = runInstruction(keyword, { keyword: literal("burn"), objects: literal(descriptor) }, { world: kernel });
  assert.ok(asked.asked);
  assert.equal(asked.asked.request.id, "pick-up-to-one");

  const answered = runInstruction(keyword, { keyword: literal("burn"), objects: literal(descriptor) }, {
    world: kernel,
    answers: { "pick-up-to-one": refs(kernel, ["a2"]) }
  });
  assert.equal(answered.result.status, "executed");
  assert.deepEqual(answered.linked.granted.objects, refs(kernel, ["a2"]));
});

test("end-of-turn registrations expire at turn-end", () => {
  const kernel = withSource(world().unit("u1").build(), "u1");
  runInstruction(keyword, {
    keyword: literal("assault"),
    duration: literal("end-of-turn")
  }, { world: kernel });
  const engine = createEngine([kernel.getObject("u1")], kernel.continuousEffects);
  assert.deepEqual(engine.evaluate({ id: "u1", zoneEntryId: 1 }).keywords.map((keyword) => keyword.id), ["assault"]);
  assert.deepEqual(engine.advance({ id: "combat-end" }), []);
  assert.deepEqual(engine.advance({ id: "turn-end" }), [kernel.continuousEffects[0].effect.id]);
  assert.deepEqual(engine.evaluate({ id: "u1", zoneEntryId: 1 }).keywords.map((keyword) => keyword.id), []);
});

test("end-of-combat registrations expire at combat-end", () => {
  const kernel = withSource(world().unit("u1").build(), "u1");
  runInstruction(keyword, {
    keyword: literal("assault"),
    duration: literal("this-combat")
  }, { world: kernel });
  const engine = createEngine([kernel.getObject("u1")], kernel.continuousEffects);
  assert.deepEqual(engine.evaluate({ id: "u1", zoneEntryId: 1 }).keywords.map((keyword) => keyword.id), ["assault"]);
  engine.advance({ id: "combat-end" });
  assert.deepEqual(engine.evaluate({ id: "u1", zoneEntryId: 1 }).keywords.map((keyword) => keyword.id), []);
});

test("while-source-in-zone ends when the source leaves its zone", () => {
  const kernel = withSource(world().unit("aura-source").unit("u1").build(), "aura-source");
  runInstruction(keyword, {
    keyword: literal("assault"),
    duration: literal("while-source-in-zone"),
    objects: literal({ kind: "query", filter: { type: "unit", controller: "A" } })
  }, { world: kernel });
  const all = [kernel.getObject("aura-source"), kernel.getObject("u1")];
  const engine = createEngine(all, kernel.continuousEffects);
  assert.deepEqual(engine.evaluate({ id: "u1", zoneEntryId: 1 }).keywords.map((keyword) => keyword.id), ["assault"]);
  engine.setObjects([kernel.getObject("u1")]);
  engine.advance({ id: "object-leaves-zone" });
  assert.deepEqual(engine.evaluate({ id: "u1", zoneEntryId: 1 }).keywords.map((keyword) => keyword.id), []);
});

test("until duration objects reach the duration adapter", () => {
  const kernel = withSource(world().unit("u1").build(), "u1");
  const run = runInstruction(keyword, {
    keyword: literal("assault"),
    duration: literal({ type: "until", at: "turn-end" })
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.continuousEffects[0].duration, { type: "until", at: "turn-end" });
});

