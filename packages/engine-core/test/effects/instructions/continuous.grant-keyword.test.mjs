import assert from "node:assert/strict";
import test from "node:test";

import grantKeyword from "../../../src/effects/instructions/continuous.grant-keyword.ts";
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

test("continuous.grant-keyword opcode and args schema are stable", () => {
  assert.equal(grantKeyword.op, "continuous.grant-keyword");
  assert.equal(typeof grantKeyword.argsSchema.parse, "function");
  assert.equal(grantKeyword.argsSchema.safeParse(7).success, false);
  assert.equal(grantKeyword.argsSchema.safeParse({ keyword: "assault", extra: true }).success, false);
  assert.equal(grantKeyword.argsSchema.safeParse({}).success, true);
  assert.equal(grantKeyword.argsSchema.safeParse({ keywords: [] }).success, false);
});

test("self grant registers an ability-layer keyword effect with keywordValue", () => {
  const kernel = withSource(world().unit("hero").build(), "hero");
  const run = runInstruction(grantKeyword, {
    keyword: literal("assault"),
    appliesTo: literal("self"),
    duration: literal("this-turn")
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  const registration = kernel.continuousEffects[0];
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.equal(registration.effect.layer, "ability");
  assert.equal(registration.effect.source.id, "hero");
  assert.equal(registration.effect.filter.objectId, "hero");
  assert.equal(registration.effect.effect.kind, "continuous.grant-keyword");
  assert.equal(registration.effect.effect.keyword, "assault");
  assert.equal(registration.effect.effect.keywordValue, undefined);
  assert.equal(registration.effect.effect.value, undefined);
  assert.deepEqual(run.linked.granted, { count: 1, objects: refs(kernel, ["hero"]) });
  assert.equal(run.linked["granted.count"], 1);
});

test("keyword plus value carries the value only through keywordValue", () => {
  const kernel = withSource(world().unit("hero").build(), "hero");
  const run = runInstruction(grantKeyword, {
    keyword: literal("burn"),
    value: literal(2),
    objects: literal({ kind: "source" })
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  const effect = kernel.continuousEffects[0].effect.effect;
  assert.equal(effect.keyword, "burn");
  assert.equal(effect.keywordValue, 2);
  assert.equal(effect.value, undefined);
});

test("valued keyword grants add to an existing value and expire independently", () => {
  const kernel = withSource(world().unit("u1", { keywords: [{ id: "Assault", value: 1 }] }).build(), "u1");
  runInstruction(grantKeyword, {
    keyword: literal("Assault"),
    value: literal(3),
    duration: literal("this-turn"),
    appliesTo: literal("self")
  }, { world: kernel });
  const engine = createEngine([kernel.getObject("u1")], kernel.continuousEffects);
  assert.deepEqual(engine.evaluate({ id: "u1", zoneEntryId: 1 }).keywords, [{ id: "Assault", value: 4 }]);
  engine.advance({ id: "turn-end" });
  assert.deepEqual(engine.evaluate({ id: "u1", zoneEntryId: 1 }).keywords, [{ id: "Assault", value: 1 }]);
});

test("an unvalued Assault also contributes its base value when granted a value", () => {
  const kernel = withSource(world().unit("u1", { keywords: [{ id: "Assault" }] }).build(), "u1");
  runInstruction(grantKeyword, { keyword: literal("Assault"), value: literal(3), appliesTo: literal("self") }, { world: kernel });
  const engine = createEngine([kernel.getObject("u1")], kernel.continuousEffects);
  assert.deepEqual(engine.evaluate({ id: "u1", zoneEntryId: 1 }).keywords, [{ id: "Assault", value: 4 }]);
});

test("numeric grants in a keyword list keep their base value after the ability recheck", () => {
  const kernel = withSource(world().unit("u1", {
    keywords: [{ id: "Assault" }, { id: "Shield", value: 1 }]
  }).build(), "u1");
  runInstruction(grantKeyword, {
    keywords: literal([{ id: "Assault", value: 3 }, { id: "Shield", value: 2 }]),
    appliesTo: literal("self")
  }, { world: kernel });
  const engine = createEngine([kernel.getObject("u1")], kernel.continuousEffects);
  assert.deepEqual(engine.evaluate({ id: "u1", zoneEntryId: 1 }).keywords, [
    { id: "Assault", value: 4 },
    { id: "Shield", value: 3 }
  ]);
});

test("keywords list becomes one registration per object with paired grants", () => {
  const kernel = withSource(world().unit("u1").unit("u2").build(), "u1");
  const run = runInstruction(grantKeyword, {
    keywords: literal([{ id: "assault", value: 1 }, { id: "elusive" }]),
    objects: refs(kernel, ["u1", "u2"])
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 2);
  for (const registration of kernel.continuousEffects) {
    assert.equal(registration.effect.layer, "ability");
    assert.deepEqual(registration.effect.effect.keywords, [{ id: "assault", value: 1 }, { id: "elusive" }]);
    assert.equal(registration.effect.effect.keyword, undefined);
    assert.equal(registration.effect.effect.keywordValue, undefined);
  }
  assert.deepEqual(run.linked.granted.objects.map((ref) => ref.id), ["u1", "u2"]);
});

test("missing keyword and keywords is negated impossible (no fallback)", () => {
  const kernel = withSource(world().unit("hero").build(), "hero");
  const run = runInstruction(grantKeyword, { appliesTo: literal("self") }, { world: kernel });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.continuousEffects.length, 0);
  assert.deepEqual(run.linked.granted, { count: 0, objects: [] });
});

test("a fully stale target ref makes the instruction ignored mistargeted", () => {
  const kernel = world().unit("gone").build();
  const staleRef = kernel.ref("gone");
  kernel.perform({ type: "kill", object: staleRef });
  const run = runInstruction(grantKeyword, {
    keyword: literal("assault"),
    objects: [staleRef]
  }, { world: kernel });

  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.continuousEffects.length, 0);
});

test("a partially stale ref list only grants survivors (CR 359.3.e.8)", () => {
  const kernel = world().unit("gone").unit("kept").build();
  const staleRef = kernel.ref("gone");
  kernel.perform({ type: "kill", object: staleRef });
  const run = runInstruction(grantKeyword, {
    keyword: literal("elusive"),
    objects: [staleRef, kernel.ref("kept")]
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.deepEqual(run.linked.granted.objects, refs(kernel, ["kept"]));
});

test("a must-choose with no legal options is negated impossible (CR 359.3.e.9)", () => {
  const kernel = withSource(world().unit("u1").build(), "u1");
  const run = runInstruction(grantKeyword, {
    keyword: literal("assault"),
    objects: literal({ kind: "choose", id: "pick-one", filter: { type: "gear" }, min: 1, max: 1 })
  }, { world: kernel });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.continuousEffects.length, 0);
});

test("a single-option must-choose still asks through ctx.choose (contract 3.3)", () => {
  const kernel = withSource(world().unit("only").build(), "only");
  const asked = runInstruction(grantKeyword, {
    keyword: literal("assault"),
    objects: literal({ kind: "choose", id: "pick-one", filter: { type: "unit" }, min: 1, max: 1 })
  }, { world: kernel });

  assert.ok(asked.asked);
  assert.equal(asked.asked.request.id, "pick-one");

  const run = runInstruction(grantKeyword, {
    keyword: literal("assault"),
    objects: literal({ kind: "choose", id: "pick-one", filter: { type: "unit" }, min: 1, max: 1 })
  }, { world: kernel, answers: { "pick-one": refs(kernel, ["only"]) } });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.granted.objects, refs(kernel, ["only"]));
});

test("an up-to-one choose asks through ctx.choose and consumes the answer", () => {
  const kernel = withSource(world().unit("a1").unit("a2").build(), "a1");
  const descriptor = { kind: "choose", id: "pick-up-to-one", filter: { type: "unit" }, min: 0, max: 1 };
  const asked = runInstruction(grantKeyword, {
    keyword: literal("assault"),
    objects: literal(descriptor)
  }, { world: kernel });
  assert.ok(asked.asked);
  assert.equal(asked.asked.request.id, "pick-up-to-one");

  const answered = runInstruction(grantKeyword, {
    keyword: literal("assault"),
    objects: literal(descriptor)
  }, { world: kernel, answers: { "pick-up-to-one": refs(kernel, ["a2"]) } });
  assert.equal(answered.result.status, "executed");
  assert.deepEqual(answered.linked.granted.objects, refs(kernel, ["a2"]));
});

test("end-of-turn grants expire at turn-end and not at combat-end", () => {
  const kernel = withSource(world().unit("u1").build(), "u1");
  runInstruction(grantKeyword, {
    keyword: literal("assault"),
    duration: literal("end-of-turn")
  }, { world: kernel });
  const engine = createEngine([kernel.getObject("u1")], kernel.continuousEffects);
  assert.deepEqual(engine.evaluate({ id: "u1", zoneEntryId: 1 }).keywords.map((keyword) => keyword.id), ["assault"]);
  assert.deepEqual(engine.advance({ id: "combat-end" }), []);
  assert.deepEqual(engine.evaluate({ id: "u1", zoneEntryId: 1 }).keywords.map((keyword) => keyword.id), ["assault"]);
  assert.deepEqual(engine.advance({ id: "turn-end" }), [kernel.continuousEffects[0].effect.id]);
  assert.deepEqual(engine.evaluate({ id: "u1", zoneEntryId: 1 }).keywords.map((keyword) => keyword.id), []);
});

test("end-of-combat grants expire at combat-end", () => {
  const kernel = withSource(world().unit("u1").build(), "u1");
  runInstruction(grantKeyword, {
    keyword: literal("elusive"),
    duration: literal("this-combat")
  }, { world: kernel });
  const engine = createEngine([kernel.getObject("u1")], kernel.continuousEffects);
  assert.deepEqual(engine.evaluate({ id: "u1", zoneEntryId: 1 }).keywords.map((keyword) => keyword.id), ["elusive"]);
  engine.advance({ id: "combat-end" });
  assert.deepEqual(engine.evaluate({ id: "u1", zoneEntryId: 1 }).keywords.map((keyword) => keyword.id), []);
});

test("while-source-in-zone ends when the source leaves its zone", () => {
  const kernel = withSource(world().unit("aura-source").unit("u1").build(), "aura-source");
  runInstruction(grantKeyword, {
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

test("duration aliases and unknown aliases behave like the might primitive", () => {
  const build = (kernel, value) => {
    const clean = kernel.clone();
    const result = runInstruction(grantKeyword, {
      keyword: literal("assault"),
      duration: literal(value)
    }, { world: clean });
    assert.equal(result.result.status, "executed");
    return clean.continuousEffects[0].duration;
  };
  const kernel = withSource(world().unit("u1").build(), "u1");
  assert.deepEqual(build(kernel, "this-turn"), build(kernel, "end-of-turn"));
  assert.deepEqual(build(kernel, "this-combat"), { type: "end-of-combat" });
  assert.deepEqual(build(kernel, "permanent"), { type: "permanent" });
  const bad = grantKeyword.argsSchema.safeParse({ keyword: "assault", duration: "not-an-alias" });
  assert.equal(bad.success, false);
});

test("until duration objects reach the duration adapter", () => {
  const kernel = withSource(world().unit("u1").build(), "u1");
  const run = runInstruction(grantKeyword, {
    keyword: literal("assault"),
    duration: literal({ type: "until", at: "turn-end" })
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.continuousEffects[0].duration, { type: "until", at: "turn-end" });
});

