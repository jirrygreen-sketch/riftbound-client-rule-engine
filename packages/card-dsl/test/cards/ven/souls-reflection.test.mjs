import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/souls-reflection.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import mightDefinition from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL_ID =
  "card.hash-96a4d656fe980065c6206e2b07389b146cc4347f8396756aeeb3b2ef9c30a281";
const SOURCE_TEXT =
  "When you empower something else, empower me. (I become Empowered if I'm not already.)\n" +
  "Disempower me, :rb_exhaust:: Give a unit at a battlefield -2 :rb_might: this turn.";

const [triggered, activated] = program.abilities;
const [debuff] = activated.body;

test("ven-151-166 Soul's Reflection: validateCardProgram passes and identity is verbatim", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /empowered-changed/);
  assert.match(program.judgeReason, /disempower/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
});

test("ven-151-166: 'When you empower something else' trigger shape and empower-me body", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.optional, false);
  // 442.2.a: becoming Empowered is a referenced event; the closed timing point
  // is "empowered-changed" (payloadType empowerment).
  assert.equal(triggered.trigger.at, "empowered-changed");
  assert.deepEqual(triggered.trigger.filter, {
    event: "empowered-changed",
    filter: { player: "self", other: true, direction: "increase" }
  });
  assert.equal(triggered.trigger.once, undefined);
  assert.equal(triggered.body.length, 1);
  const [empowerSelf] = triggered.body;
  assert.equal(empowerSelf.id, "souls-reflection.empower-self");
  assert.equal(empowerSelf.op, "effect.empower");
  // 827.1.b.1: the source itself is empowered and is not a target.
  assert.deepEqual(empowerSelf.args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
  assert.equal(empowerSelf.targets, undefined);
  assert.equal(empowerSelf.picks, undefined);
});

test("ven-151-166: Disempower + Exhaust cost and the temporary -2 Might effect", () => {
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  // 404.1.a / 415.5: both printed symbols before ":" are costs; 443.2.a makes
  // the Disempower Limited Action an effect-driven cost.
  assert.deepEqual(activated.cost.payments, [
    { kind: "disempower", object: "self" },
    { kind: "exhaust", object: "self" }
  ]);
  assert.equal(activated.body.length, 1);
  assert.equal(debuff.id, "souls-reflection.debuff-unit");
  assert.equal(debuff.op, "continuous.might");
  assert.deepEqual(debuff.args.amount, { kind: "constant", value: -2 });
  assert.deepEqual(debuff.args.duration, { kind: "constant", value: "this-turn" });
  // "a unit at a battlefield": ordinary targeting, pinned to battlefield locations.
  assert.deepEqual(debuff.targets[0].filter, {
    type: "unit",
    zone: "board",
    location: { type: "battlefield" }
  });
  assert.equal(debuff.targets[0].min, 1);
  assert.equal(debuff.targets[0].max, 1);
  assert.equal(debuff.targets[0].selection, "one");
});

test("ven-151-166 golden: 'empower me' empowers the legend source through the interpreter", () => {
  const kernel = world()
    .unit("souls-reflection", { types: ["legend"], zone: "board" })
    .build();
  // "empower me" binds the ability source (827.1.b.1: not a target), so the
  // interpreter context carries the legend as its source snapshot.
  const context = kernel.clone({
    sourceSnapshot: kernel.getObject("souls-reflection")
  });

  const outcome = runAbilityBody(triggered.body, context);
  assert.equal(outcome.status, "executed");
  assert.equal(context.getObject("souls-reflection").empowered, 1);
  assert.deepEqual(context.events.map(event => event.action), ["empower"]);
  assert.deepEqual(
    outcome.linkedValues["souls-reflection.empower-self.empowered"],
    {
      mode: "empower",
      count: 1,
      objects: [context.ref("souls-reflection")]
    }
  );
});

test.todo(
  "ven-151-166: an already-Empowered legend is left unchanged (442.1.b/442.1.c) — the reference " +
    "kernel applies the state change directly; the boundary is owned by the action layer " +
    "(effect.empower header, RIFT-114)"
);

test.todo(
  "ven-151-166: trigger only on the increase direction and only for " +
    "\"something else\" — empowered-changed fires for empower and disempower alike (443.1) and its " +
    "payload (previousCount/currentCount/direction) is not filled by events/action-adapter.ts; " +
    "EventPattern has no host-exclusion key (contract change request, RIFT-120)"
);

test.todo(
  "ven-151-166: pay the printed 'Disempower me' cost — the in-flight RIFT-261 cost kinds still do not " +
    "include disempower (cost/plan-values.ts supports exhaust/discard/recycle/kill/reveal/spend-buff)"
);

/**
 * The card's own `continuous.might` instruction args (the reference kernel
 * compares filter fields literally, so the target is locked through
 * runInstruction's `targets` binding — the same convention as sky-crusier /
 * smoke-screen). Nothing about the printed effect is substituted.
 */
const MIGHT_ARGS = {
  amount: debuff.args.amount,
  duration: debuff.args.duration,
  target: debuff.args.target.value
};

const debuffWorld = () => {
  const kernel = world()
    .unit("souls-reflection", { types: ["legend"], zone: "board" })
    .unit("victim", { owner: "B", controller: "B", might: 5, location: { type: "battlefield", id: "bf-1" } })
    .build();
  return kernel;
};

const registrations = kernel =>
  kernel.continuousEffects.map(entry => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 }));

test("ven-151-166 golden: 'give -2 Might this turn' registers a real end-of-turn arithmetic effect", () => {
  const kernel = debuffWorld();
  const source = kernel.clone({ sourceSnapshot: kernel.getObject("souls-reflection") });
  const run = runInstruction(mightDefinition, MIGHT_ARGS, {
    world: source,
    targets: { "souls-reflection.unit-at-battlefield": [kernel.ref("victim")] }
  });

  // 478 / 478.1.a: the merged RIFT-258 continuous.might primitive is the
  // card-facing entry point; it never touches Buff counters (702/703).
  assert.equal(run.result.status, "executed");
  assert.equal(source.continuousEffects.length, 1);
  const [registration] = source.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, -2);
  assert.deepEqual(registration.effect.filter.objectId, "victim");
  // 317.1.a / 317.2.c: "this turn" expires at the turn-end timing point.
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  const engine = createLayerEngine(source.objects, registrations(source));
  assert.equal(engine.evaluate(kernel.ref("victim")).might, 3);
  assert.deepEqual(engine.expireAt("turn-end"), [registration.effect.id]);
  assert.equal(engine.evaluate(kernel.ref("victim")).might, 5);
  assert.equal(source.getObject("victim").buffs, 0);
});

test("ven-151-166 golden: a stale battlefield target is ignored and registers nothing (359.3.e.7)", () => {
  const kernel = debuffWorld();
  const stale = kernel.ref("victim");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  const source = kernel.clone({ sourceSnapshot: kernel.getObject("souls-reflection") });
  const run = runInstruction(mightDefinition, MIGHT_ARGS, {
    world: source,
    targets: { "souls-reflection.unit-at-battlefield": [stale] }
  });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(source.continuousEffects.length, 0);
});
