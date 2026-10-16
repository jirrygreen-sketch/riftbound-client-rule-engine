import assert from "node:assert/strict";
import test from "node:test";

import effectStun from "../../../src/effects/instructions/effect.stun.ts";
import { AwaitChoice, runInstruction, world } from "../../../src/effects/testing/index.ts";
import { instructionDefinitionsById } from "../../../dist/effects/instructions/registry.generated.js";

const TARGET = "selected";

const literal = value => ({ kind: "literal", value });
const linked = (key, instructionId = "previous") => ({ kind: "linked-value", instructionId, key });

const targetRun = (kernel, args, refs, options = {}) => runInstruction(effectStun, args, {
  world: kernel,
  targets: { [TARGET]: refs },
  ...options
});

const stunnedOf = (kernel, id) => kernel.getObject(id)?.stunned ?? null;

// a battle field unit that is already an attacker is not distinguished by the
// reference kernel; combat role belongs to the engine, so a Board Unit is used.
const boardUnit = (id, extra = {}) => ({
  owner: "B",
  zone: "board",
  location: { type: "battlefield", id: "battlefield-1" },
  ...extra
});

test("stuns a Board unit and links the actual result (CR 424.1/424.1.a)", () => {
  const kernel = world().unit("u1").build();
  const result = targetRun(kernel, { target: TARGET }, [kernel.ref("u1")]);

  assert.equal(result.result?.status, "executed");
  assert.equal(stunnedOf(kernel, "u1"), true);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].action, "stun");
  assert.equal(result.linked.stunned.count, 1);
  assert.equal(result.linked["stunned.count"], 1);
  assert.deepEqual(result.linked["stunned.objects"], [{ id: "u1", zoneEntryId: 1 }]);
  assert.equal(result.linked.stunned.alreadyStunned, 0);
});

test("a unit that is already stunned is not stunned again and adds nothing (CR 424.1.a.1)", () => {
  const kernel = world().unit("u1", { stunned: true }).build();
  const result = targetRun(kernel, { target: TARGET }, [kernel.ref("u1")]);

  assert.equal(result.result?.status, "executed");
  assert.equal(result.events.length, 0);
  assert.equal(result.linked.stunned.count, 0);
  assert.equal(result.linked.stunned.alreadyStunned, 1);
  assert.deepEqual(result.linked.stunned.objects, []);
  assert.equal(stunnedOf(kernel, "u1"), true);
});

test("an already stunned unit does not consume the amount budget (CR 424.1.a.1 + 055)", () => {
  const kernel = world().unit("done", { stunned: true }).unit("fresh").build();
  const result = targetRun(
    kernel,
    { target: TARGET, amount: literal(1) },
    [kernel.ref("done"), kernel.ref("fresh")]
  );

  assert.equal(result.result?.status, "executed");
  assert.equal(result.linked.stunned.count, 1);
  assert.equal(result.linked.stunned.alreadyStunned, 1);
  assert.deepEqual(result.linked.stunned.objects, [{ id: "fresh", zoneEntryId: 1 }]);
  assert.equal(stunnedOf(kernel, "fresh"), true);
});

test("choose does not offer already stunned units as options (CR 424.1.a.1)", () => {
  const kernel = world().unit("done", { stunned: true }).unit("fresh-a").unit("fresh-b").build();
  const asked = runInstruction(effectStun, { choose: { id: "stun-one" } }, { world: kernel });

  assert.ok(asked.asked instanceof AwaitChoice);
  assert.deepEqual(asked.asked.request.options.map(ref => ref.id), ["fresh-a", "fresh-b"]);
  assert.equal(asked.asked.request.min, 1);
  assert.equal(asked.asked.request.max, 1);
});

test("choose never asks when only already stunned units match, and links zero executed stuns", () => {
  const kernel = world().unit("done", { stunned: true }).build();
  const result = runInstruction(effectStun, { choose: { id: "stun-one" } }, { world: kernel });

  assert.equal(result.asked, null);
  assert.equal(result.result?.status, "executed");
  assert.equal(result.events.length, 0);
  assert.equal(result.linked.stunned.count, 0);
  assert.equal(result.linked.stunned.alreadyStunned, 1);
});

test("stun does not exhaust the unit: Stunned and Exhausted are separate statuses (CR 124.2/415/424)", () => {
  const kernel = world().unit("u1").build();
  const result = targetRun(kernel, { target: TARGET }, [kernel.ref("u1")]);

  assert.equal(result.result?.status, "executed");
  assert.equal(stunnedOf(kernel, "u1"), true);
  assert.equal(kernel.getObject("u1").exhausted, false);
  assert.deepEqual(result.events.map(event => event.action), ["stun"]);
});

test("a replacement hook replacing the Stun action negates the instruction", () => {
  const kernel = world().unit("u1").build();
  kernel.addReplacement(action => (action.type === "stun" ? "replaced" : null));
  const result = targetRun(kernel, { target: TARGET }, [kernel.ref("u1")]);

  assert.equal(result.result?.status, "negated");
  assert.equal(result.result?.reason, "replaced");
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].outcome, "replaced");
  assert.equal(stunnedOf(kernel, "u1"), false);
  assert.equal(result.linked.stunned.count, 0);
});

test("prevention of one target negates the instruction while the other stun still stands (CR 055/359.3.e.11)", () => {
  const kernel = world().unit("u1").unit("u2").build();
  kernel.addReplacement(action =>
    action.type === "stun" && action.object.id === "u2" ? "prevented" : null);
  const result = targetRun(kernel, { target: TARGET }, [kernel.ref("u1"), kernel.ref("u2")]);

  assert.equal(result.result?.status, "negated");
  assert.equal(result.result?.reason, "impossible");
  assert.equal(stunnedOf(kernel, "u1"), true);
  assert.equal(stunnedOf(kernel, "u2"), false);
  assert.equal(result.linked.stunned.count, 1);
  assert.deepEqual(result.linked.stunned.objects, [{ id: "u1", zoneEntryId: 1 }]);
});

test("a stale target reference is ignored after the object left its zone (CR 359.3.e.5/e.6/e.7)", () => {
  const kernel = world().unit("u1").build();
  const stale = kernel.ref("u1");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  assert.equal(kernel.object(stale), null);

  const result = targetRun(kernel, { target: TARGET }, [stale]);

  assert.deepEqual(result.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(result.events.length, 0);
  assert.equal(result.linked.stunned, undefined);
});

test("an empty target set is ignored and a non-target pick is impossible instead", () => {
  const kernel = world().unit("u1").build();
  const missing = targetRun(kernel, { target: TARGET }, []);
  const stalePick = runInstruction(effectStun, { pick: "chosen" }, {
    world: kernel,
    picks: { chosen: [{ id: "u1", zoneEntryId: 99 }] }
  });

  assert.deepEqual(missing.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(stalePick.result?.status, "negated");
  assert.equal(stalePick.result?.reason, "impossible");
  assert.equal(stunnedOf(kernel, "u1"), false);
});

test("surviving targets are stunned while one stale target is dropped (CR 359.3.e.8)", () => {
  const kernel = world().unit("u1").unit("u2").build();
  const stale = kernel.ref("u1");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");

  const result = targetRun(kernel, { target: TARGET }, [stale, kernel.ref("u2")]);

  assert.equal(result.result?.status, "executed");
  assert.equal(result.result.linkedValues.stunned.count, 1);
  assert.deepEqual(result.result.linkedValues["stunned.objects"], [{ id: "u2", zoneEntryId: 1 }]);
  assert.equal(kernel.getObject("u1").zone, "trash");
  assert.equal(stunnedOf(kernel, "u2"), true);
});

test("amount 0 executes without an action and amount above the available set caps (CR 055/355.13)", () => {
  const kernel = world().unit("u1").unit("u2").build();
  const zero = targetRun(kernel, { target: TARGET, amount: literal(0) }, [
    kernel.ref("u1"), kernel.ref("u2")
  ]);

  assert.equal(zero.result?.status, "executed");
  assert.equal(zero.events.length, 0);
  assert.equal(zero.linked.stunned.count, 0);
  assert.equal(stunnedOf(kernel, "u1"), false);

  const capped = targetRun(kernel, { target: TARGET, amount: literal(5) }, [
    kernel.ref("u1"), kernel.ref("u2")
  ]);
  assert.equal(capped.result?.status, "executed");
  assert.equal(capped.linked.stunned.count, 2);
  assert.equal(stunnedOf(kernel, "u1"), true);
  assert.equal(stunnedOf(kernel, "u2"), true);
});

test("an invalid evaluated amount is impossible and performs nothing", () => {
  const kernel = world().unit("u1").build();
  const negative = targetRun(kernel, { target: TARGET, amount: literal(-1) }, [kernel.ref("u1")]);
  const fractional = targetRun(kernel, { target: TARGET, amount: literal(1.5) }, [kernel.ref("u1")]);

  assert.equal(negative.result?.status, "negated");
  assert.equal(negative.result?.reason, "impossible");
  assert.equal(fractional.result?.status, "negated");
  assert.equal(fractional.result?.reason, "impossible");
  assert.equal(stunnedOf(kernel, "u1"), false);
});

test("an amount that references unavailable information is ignored, not treated as 0 (CR 359.3.e.12)", () => {
  const kernel = world().unit("u1").build();
  const result = targetRun(kernel, { target: TARGET, amount: linked("missing") }, [kernel.ref("u1")]);

  assert.deepEqual(result.result, { status: "ignored", reason: "linked-ignored" });
  assert.equal(stunnedOf(kernel, "u1"), false);
  assert.equal(result.linked.stunned, undefined);
});

test("a linked amount resolves against linked values and a custom linkKey is written", () => {
  const kernel = world().unit("u1").unit("u2").build();
  const result = targetRun(
    kernel,
    { target: TARGET, amount: linked("count", "previous"), linkKey: literal("set-stunned") },
    [kernel.ref("u1"), kernel.ref("u2")],
    { linked: { count: 1 } }
  );

  assert.equal(result.result?.status, "executed");
  assert.equal(result.linked["set-stunned"].count, 1);
  assert.equal(result.linked["set-stunned.count"], 1);
  assert.equal(stunnedOf(kernel, "u1"), true);
  assert.equal(stunnedOf(kernel, "u2"), false);

  const unusable = targetRun(kernel, { target: TARGET, linkKey: linked("missing") }, [kernel.ref("u2")]);
  assert.equal(unusable.result?.status, "negated");
  assert.equal(unusable.result?.reason, "impossible");
  assert.equal(stunnedOf(kernel, "u2"), false);
});

test("choose suspends without an answer, leaves the world untouched, and replays with the answer", () => {
  const kernel = world().unit("u2").unit("u1").build();
  const suspended = runInstruction(effectStun, { choose: { id: "stun-one" } }, { world: kernel });

  assert.ok(suspended.asked instanceof AwaitChoice);
  assert.equal(suspended.asked.request.type, "select-objects");
  assert.equal(suspended.asked.request.id, "stun-one");
  assert.equal(suspended.asked.request.min, 1);
  assert.equal(suspended.asked.request.max, 1);
  assert.deepEqual(suspended.asked.request.options.map(ref => ref.id), ["u1", "u2"]);
  assert.equal(suspended.result, null);
  assert.equal(stunnedOf(kernel, "u1"), false);
  assert.equal(stunnedOf(kernel, "u2"), false);

  const answered = runInstruction(effectStun, { choose: { id: "stun-one" } }, {
    world: kernel,
    answers: { "stun-one": [kernel.ref("u1")] }
  });

  assert.equal(answered.asked, null);
  assert.equal(answered.result?.status, "executed");
  assert.equal(answered.linked.stunned.count, 1);
  assert.equal(stunnedOf(kernel, "u1"), true);
  assert.equal(stunnedOf(kernel, "u2"), false);
});

test("choose does not ask when the choice is already determined, and a forged answer is impossible", () => {
  const single = world().unit("only").build();
  const determined = runInstruction(effectStun, { choose: { id: "stun-one" } }, { world: single });

  assert.equal(determined.asked, null);
  assert.equal(determined.result?.status, "executed");
  assert.equal(determined.linked.stunned.count, 1);
  assert.equal(stunnedOf(single, "only"), true);

  const kernel = world().unit("u1").unit("u2").build();
  const forged = runInstruction(effectStun, { choose: { id: "stun-one" } }, {
    world: kernel,
    answers: { "stun-one": [{ id: "missing", zoneEntryId: 1 }] }
  });

  assert.equal(forged.result?.status, "negated");
  assert.equal(forged.result?.reason, "impossible");
  assert.equal(forged.events.length, 0);
  assert.equal(stunnedOf(kernel, "u1"), false);
  assert.equal(stunnedOf(kernel, "u2"), false);
});

test("choose uses its own filter and rearranged option order for deterministic selection", () => {
  const kernel = world().unit("zeta").unit("alpha").build();
  const asked = runInstruction(effectStun, { choose: { id: "stun-one", filter: { type: "unit" } } }, {
    world: kernel
  });

  assert.ok(asked.asked instanceof AwaitChoice);
  assert.deepEqual(asked.asked.request.options.map(ref => ref.id), ["alpha", "zeta"]);
});

test("only Board Units can be stunned; gears and units off the board are not candidates (CR 424.1)", () => {
  const kernel = world()
    .object("gear", { owner: "A", zone: "board", types: ["gear"], location: { type: "base", player: "A" } })
    .unit("in-hand", { owner: "A", zone: "hand" })
    .build();
  const result = targetRun(kernel, { target: TARGET }, [kernel.ref("gear"), kernel.ref("in-hand")]);

  assert.deepEqual(result.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("gear").stunned, false);
  assert.equal(kernel.getObject("in-hand").stunned, false);
});

test("ogn-262-298 Zenith Blade: 'Stun an enemy unit at a battlefield.' stuns the chosen enemy unit", () => {
  const kernel = world()
    .unit("zenith-blade", { owner: "A", zone: "chain", types: ["spell"] })
    .unit("enemy-unit", boardUnit("enemy-unit"))
    .build();
  const result = targetRun(kernel, { target: TARGET }, [kernel.ref("enemy-unit")]);

  assert.equal(result.result?.status, "executed");
  assert.equal(stunnedOf(kernel, "enemy-unit"), true);
  assert.deepEqual(result.events.map(event => event.action), ["stun"]);
});

test("unl-134-219 Existential Dread: '[Stun] an attacking enemy unit. If it's already stunned, return it to its owner's hand instead.'", () => {
  const kernel = world().unit("attacker", boardUnit("attacker", { owner: "B" })).build();
  const first = targetRun(kernel, { target: TARGET }, [kernel.ref("attacker")]);

  assert.equal(first.result?.status, "executed");
  assert.equal(first.linked.stunned.count, 1);
  assert.equal(stunnedOf(kernel, "attacker"), true);

  const second = targetRun(kernel, { target: TARGET }, [kernel.ref("attacker")]);

  // 424.1.a.1: nothing additional happens on a unit that is already stunned, so
  // the "if it's already stunned" branch is told count 0 / alreadyStunned 1.
  assert.equal(second.result?.status, "executed");
  assert.equal(second.events.length, 0);
  assert.equal(second.linked.stunned.count, 0);
  assert.equal(second.linked.stunned.alreadyStunned, 1);
});

test("ogn-220-298 Facebreaker: 'Stun a friendly unit and an enemy unit at the same battlefield.' keeps legal members (CR 359.3.e.8)", () => {
  const kernel = world()
    .unit("friendly", { owner: "A", zone: "board", location: { type: "battlefield", id: "battlefield-1" } })
    .unit("enemy", boardUnit("enemy"))
    .build();
  const stale = kernel.ref("friendly");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");

  const result = targetRun(kernel, { target: TARGET }, [stale, kernel.ref("enemy")]);

  assert.equal(result.result?.status, "executed");
  assert.equal(stunnedOf(kernel, "enemy"), true);
  assert.equal(stunnedOf(kernel, "friendly"), false);
  assert.deepEqual(result.linked.stunned.objects, [{ id: "enemy", zoneEntryId: 1 }]);
});

test("ven-120-166 Masa, Crashing Thunder: 'When you play me, if you paid the additional cost, [Stun] an enemy unit at a battlefield.'", () => {
  const kernel = world()
    .unit("masa", { owner: "A", zone: "board", location: { type: "base", player: "A" } })
    .unit("enemy-unit", boardUnit("enemy-unit"))
    .build();
  const result = targetRun(kernel, { target: TARGET }, [kernel.ref("enemy-unit")]);

  assert.equal(result.result?.status, "executed");
  assert.equal(stunnedOf(kernel, "enemy-unit"), true);
  assert.equal(result.linked.stunned.count, 1);
  assert.equal(kernel.getObject("masa").stunned, false);
});

test("rad-121-167 One-Two Punch: '[Buff] a friendly unit and [Stun] an enemy unit.' stuns through a pick", () => {
  const kernel = world()
    .unit("one-two-punch", { owner: "A", zone: "chain", types: ["spell"] })
    .unit("enemy-unit", boardUnit("enemy-unit"))
    .build();
  const result = runInstruction(effectStun, { pick: "chosen-unit" }, {
    world: kernel,
    picks: { "chosen-unit": [kernel.ref("enemy-unit")] }
  });

  assert.equal(result.result?.status, "executed");
  assert.equal(stunnedOf(kernel, "enemy-unit"), true);
  assert.equal(result.linked.stunned.count, 1);
});

test("effect.stun rejects malformed arguments without touching the world", () => {
  const kernel = world().unit("u1").build();

  assert.throws(() => runInstruction(effectStun, {}, { world: kernel }), /exactly one of target, pick, or choose/);
  assert.throws(
    () => runInstruction(effectStun, { target: TARGET, pick: "also" }, { world: kernel }),
    /exactly one of target, pick, or choose/
  );
  assert.throws(() => runInstruction(effectStun, { target: TARGET, amount: 2 }, { world: kernel }), /Expr/);
  assert.throws(() => runInstruction(effectStun, { target: TARGET, extra: true }, { world: kernel }), /Invalid effect\.stun argument/);
  assert.throws(() => runInstruction(effectStun, { choose: {} }, { world: kernel }), /stable non-empty choice id/);
  assert.throws(
    () => runInstruction(effectStun, { choose: { id: "c", visibility: "nobody" } }, { world: kernel }),
    /visibility/
  );
  assert.equal(stunnedOf(kernel, "u1"), false);
});

test("the generated instruction registry exposes effect.stun for EffectIR lookup", () => {
  const registered = instructionDefinitionsById.get("effect.stun");

  assert.ok(registered, "effect.stun must be registered");
  assert.equal(registered.op, "effect.stun");
  // The registry imports the built definition from dist/, so compare behaviour
  // (the source and dist module instances are distinct).
  assert.equal(registered.argsSchema.parse({ target: TARGET }).target, TARGET);
  const kernel = world().unit("u1").build();
  const run = runInstruction(registered, { target: TARGET }, {
    world: kernel,
    targets: { [TARGET]: [kernel.ref("u1")] }
  });
  assert.equal(run.result?.status, "executed");
  assert.equal(stunnedOf(kernel, "u1"), true);
});
