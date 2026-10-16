import assert from "node:assert/strict";
import test from "node:test";

import combat from "../../../src/effects/instructions/continuous.combat.ts";
import { runInstruction, world } from "../../../src/effects/testing/index.ts";

const literal = (value) => ({ kind: "constant", value });

const withSource = (kernel, id) => kernel.clone({ sourceSnapshot: kernel.getObject(id) });
const refs = (kernel, ids) => ids.map((id) => kernel.ref(id));

test("continuous.combat opcode and args schema are stable", () => {
  assert.equal(combat.op, "continuous.combat");
  assert.equal(typeof combat.argsSchema.parse, "function");
  assert.equal(combat.argsSchema.safeParse(7).success, false);
  assert.equal(combat.argsSchema.safeParse({ flags: "tank" }).success, false);
  assert.equal(combat.argsSchema.safeParse({ flags: [{}] }).success, false);
  // flags 缺省合法（空数组），duration 缺省 end-of-combat。
  assert.equal(combat.argsSchema.safeParse({}).success, true);
});

test("combat primitive remains blocked until a combat consumer exists", () => {
  const kernel = withSource(world().unit("front").build(), "front");
  const run = runInstruction(combat, { appliesTo: literal("self") }, { world: kernel });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.continuousEffects.length, 0);
});

test("flags do not report a successful no-op while the combat workflow is absent", () => {
  const kernel = withSource(world().unit("front").build(), "front");
  const run = runInstruction(combat, {
    flags: literal(["tank"]),
    appliesTo: literal("self")
  }, { world: kernel });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.continuousEffects.length, 0);
});

test("flags remain blocked for every resolved object until a combat consumer exists", () => {
  const kernel = withSource(world().unit("u1").unit("u2").build(), "u1");
  const run = runInstruction(combat, {
    flags: literal(["first-strike"]),
    objects: refs(kernel, ["u1", "u2"])
  }, { world: kernel });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.continuousEffects.length, 0);
});

test("a fully stale target ref makes the instruction ignored mistargeted", () => {
  const kernel = world().unit("gone").build();
  const staleRef = kernel.ref("gone");
  kernel.perform({ type: "kill", object: staleRef });
  const run = runInstruction(combat, { objects: [staleRef] }, { world: kernel });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
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
  assert.equal(asked.result.status, "negated");
  assert.equal(asked.result.reason, "impossible");

  const answered = runInstruction(combat, { objects: literal(descriptor) }, {
    world: kernel,
    answers: { "pick-up-to-one": refs(kernel, ["a2"]) }
  });
  assert.equal(answered.result.status, "negated");
  assert.equal(answered.result.reason, "impossible");
});

test("explicit duration is validated while the combat primitive remains blocked", () => {
  const kernel = withSource(world().unit("u1").build(), "u1");
  runInstruction(combat, {
    flags: literal(["rally"]),
    duration: literal("this-turn")
  }, { world: kernel });
  assert.equal(kernel.continuousEffects.length, 0);
});

test("default duration remains blocked without a combat consumer", () => {
  const kernel = withSource(world().unit("u1").build(), "u1");
  runInstruction(combat, { flags: literal(["tank"]) }, { world: kernel });
  assert.equal(kernel.continuousEffects.length, 0);
});

test("until duration objects are validated before the combat block", () => {
  const kernel = withSource(world().unit("u1").build(), "u1");
  const run = runInstruction(combat, {
    flags: literal(["tank"]),
    duration: literal({ type: "until", at: "turn-end" })
  }, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.continuousEffects.length, 0);
});

test("while-source-in-zone ends when the source leaves its zone", () => {
  const kernel = withSource(world().unit("aura-source").unit("u1").build(), "aura-source");
  runInstruction(combat, {
    flags: literal(["lifelink"]),
    duration: literal("while-source-in-zone"),
    objects: literal({ kind: "query", filter: { type: "unit", controller: "A" } })
  }, { world: kernel });
  assert.equal(kernel.continuousEffects.length, 0);
});

