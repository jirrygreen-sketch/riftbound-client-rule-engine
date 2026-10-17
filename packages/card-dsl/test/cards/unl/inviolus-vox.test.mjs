import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/inviolus-vox.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { translateTriggerFilter, translateInstructionTargets } from "../../../../engine-core/dist/programs/filters.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";

const CANONICAL_ID =
  "card.hash-f11b51df9013e0151586a2443eb2342dba8ad5f6aa01ea4e5f5bb83f35e722df";
const SOURCE_TEXT = "When I conquer, give a friendly unit +8 :rb_might: this turn.";

const [conquerTrigger] = program.abilities;
const [grantMight] = conquerTrigger.body;
const targetSpec = grantMight.targets[0];

/**
 * chain/engine.ts resolves the static controller/owner spellings before it
 * calls the production matcher: "self" becomes the ability controller and
 * "opponent" excludes that player's objects. The reference kernel's own query
 * compares filter values literally, so the goldens go through the same
 * normalization the production chain applies (the merged siphon-power /
 * switcheroo goldens use this exact helper).
 */
const chainQuery = (kernel, controller) => (value) => {
  const normalized = { ...value };
  for (const key of ["controller", "owner"]) {
    if (normalized[key] === "self") normalized[key] = controller;
  }
  return kernel.query({}).filter((object) => {
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "opponent" && object[key] === controller) return false;
    }
    return matchesObjectFilter({
      ...normalized,
      ...(normalized.controller === "opponent" ? { controller: "any" } : {}),
      ...(normalized.owner === "opponent" ? { owner: "any" } : {})
    }, object);
  });
};

const chainContext = (kernel, controller) => new Proxy(kernel, {
  get(target, key) {
    if (key === "query") return chainQuery(target, controller);
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  }
});

const CONQUER_WORLD = () => world()
  .unit("vox", { owner: "A", controller: "A", might: 8, location: { type: "battlefield", id: "bf-1" } })
  .unit("friend", { owner: "A", controller: "A", might: 2, location: { type: "battlefield", id: "bf-1" } })
  .unit("other-friend", { owner: "A", controller: "A", might: 4, location: { type: "battlefield", id: "bf-1" } })
  .unit("enemy", { owner: "B", controller: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
  .build();

/** The registered arithmetic-layer entries, as the layer engine consumes them. */
const registrations = (kernel) => kernel.continuousEffects.map(entry => ({
  effect: entry.effect,
  duration: entry.duration,
  timestamp: 1
}));

test("unl-027-219 Inviolus Vox: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-027-219 Inviolus Vox: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.equal(grantMight.op, "continuous.might");
  assert.equal(grantMight.args.amount.value, 8);
  assert.equal(grantMight.op === "effect.buff", false);
  // The gap is now the conquer event subscription, not the Might primitive or
  // the friendly-unit controller binding.
  assert.match(program.judgeReason, /conquer/);
  assert.match(program.judgeReason, /objectId|征服单位对象/);
  assert.match(program.judgeReason, /battlefieldId/);
  assert.doesNotMatch(program.judgeReason, /RIFT-90|RIFT-120|RIFT-257|RIFT-258/);
});

test("unl-027-219 Inviolus Vox: the conquer trigger is a Conquer Effect on self", () => {
  assert.equal(program.abilities.length, 1);
  // 383.4.c / 383.4.c.1 / 383.4.c.2.a: "When I conquer" is a Conquer Effect put
  // on the chain after this unit conquers a battlefield; 383.4.c.2.c keeps it
  // independent of whether the point gain was replaced.
  assert.equal(conquerTrigger.kind, "triggered");
  assert.equal(conquerTrigger.trigger.at, "conquer");
  assert.deepEqual(conquerTrigger.trigger.filter, {
    event: "conquered",
    filter: { source: "self" }
  });
  assert.equal(conquerTrigger.trigger.condition, undefined);
  assert.equal(conquerTrigger.trigger.once, undefined);
  assert.equal(conquerTrigger.optional, false);
  assert.equal(conquerTrigger.body.length, 1);
});

test("unl-027-219 Inviolus Vox: +8 Might for the turn is authored in the merged continuous.might shape", () => {
  assert.equal(grantMight.id, "inviolus-vox.grant-might-8");
  // continuous.might is merged: it registers the arithmetic-layer
  // modification through ctx.addContinuous and must not be approximated with
  // effect.buff (702 Buff counters are a different thing).
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 8 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(grantMight.args.mode, { kind: "constant", value: "add" });
  // The merged primitive's schema rejects the old descriptive layer argument
  // (Invalid continuous.might argument: layer); the arithmetic layer is fixed
  // by layers/ops buildMightSpec.
  assert.equal(grantMight.args.layer, undefined);
  // The chosen friendly unit is handed over as an evaluated selection
  // descriptor: a bare target string is not a contract 3.2 Expr.
  assert.deepEqual(grantMight.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "inviolus-vox.friendly-unit" }
  });
  // 355.9 / 355.9.a.1: "a friendly unit" is one chosen Board unit controlled by
  // the ability's controller.
  assert.deepEqual(targetSpec, {
    id: "inviolus-vox.friendly-unit",
    filter: { type: "unit", controller: "self", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(grantMight.picks, undefined);
  assert.equal(grantMight.linkedTo, undefined);
  assert.equal(grantMight.condition, undefined);
});

test("unl-027-219 Inviolus Vox: the +8 amount is a literal, not a read of some other value", () => {
  // The modifier is a fixed +8 (the printed amount), unlike a Doubling effect
  // which reads the current value at resolution. The reference kernel resolves
  // the program's own expression to confirm the authored value.
  const kernel = world().unit("vox", { might: 8 }).build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("vox") });
  assert.equal(ctx.evaluate(grantMight.args.amount), 8);
  assert.equal(grantMight.args.amount.kind, "constant");
  assert.equal(grantMight.args.amount.value, 8);
});

test("unl-027-219 Inviolus Vox golden: the merged primitive registers the +8 arithmetic-layer modification", () => {
  const kernel = CONQUER_WORLD();
  // The production program-binding translator normalises the card's target
  // filter ("controller" -> the ability controller) before the interpreter
  // runs; the golden drives the translated body through the chain adapter.
  const body = translateInstructionTargets(conquerTrigger.body);
  const ctx = chainContext(kernel.clone({ sourceSnapshot: kernel.getObject("vox"), controller: "A" }), "A");
  ctx.setTargets(targetSpec.id, [kernel.ref("friend")]);

  const outcome = resolveChainBody(body, ctx);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status]),
    [["inviolus-vox.grant-might-8", "executed"]]
  );
  // One registration for exactly the chosen friendly unit, in the arithmetic
  // layer, with the printed +8 and the end-of-turn duration (317.1.a/468.7.c).
  assert.deepEqual(
    ctx.continuousEffects.map(entry => [entry.effect.filter.objectId, entry.effect.layer, entry.effect.effect.amount]),
    [["friend", "arithmetic", 8]]
  );
  assert.deepEqual(ctx.continuousEffects.map(entry => entry.duration), [{ type: "end-of-turn" }]);
});

test("unl-027-219 Inviolus Vox golden: only the chosen friendly unit's Effective Might rises by 8", () => {
  const kernel = CONQUER_WORLD();
  const ctx = chainContext(kernel.clone({ sourceSnapshot: kernel.getObject("vox"), controller: "A" }), "A");
  ctx.setTargets(targetSpec.id, [kernel.ref("friend")]);
  resolveChainBody(translateInstructionTargets(conquerTrigger.body), ctx);

  const engine = createLayerEngine(kernel.objects, registrations(ctx));
  // 143.2.a: Might references the Effective Might after the arithmetic layer.
  assert.equal(engine.evaluate(kernel.ref("friend")).might, 10);
  // The other friendly unit, the enemy unit and the source itself are untouched.
  assert.equal(engine.evaluate(kernel.ref("other-friend")).might, 4);
  assert.equal(engine.evaluate(kernel.ref("enemy")).might, 3);
  assert.equal(engine.evaluate(kernel.ref("vox")).might, 8);
});

test("unl-027-219 Inviolus Vox golden: the modification expires at the end of the turn (CR 317.1.a / 468.7.c)", () => {
  const kernel = CONQUER_WORLD();
  const ctx = chainContext(kernel.clone({ sourceSnapshot: kernel.getObject("vox"), controller: "A" }), "A");
  ctx.setTargets(targetSpec.id, [kernel.ref("friend")]);
  resolveChainBody(translateInstructionTargets(conquerTrigger.body), ctx);

  const engine = createLayerEngine(kernel.objects, registrations(ctx));
  assert.equal(engine.evaluate(kernel.ref("friend")).might, 10);
  assert.equal(engine.expireAt("turn-end").length, 1);
  assert.equal(engine.evaluate(kernel.ref("friend")).might, 2);
});

test("unl-027-219 Inviolus Vox golden: a locked friendly unit that left the Board makes the grant ignored", () => {
  const kernel = CONQUER_WORLD();
  const ctx = chainContext(kernel.clone({ sourceSnapshot: kernel.getObject("vox"), controller: "A" }), "A");
  const stale = kernel.ref("friend");
  ctx.perform({ type: "kill", object: stale });
  ctx.setTargets(targetSpec.id, [stale]);

  const outcome = resolveChainBody(translateInstructionTargets(conquerTrigger.body), ctx);
  // 359.3.e.2/e.6: every selected reference is stale, so the instruction is
  // ignored and nothing is retargeted at "other-friend".
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(ctx.continuousEffects.length, 0);
});

test("unl-027-219 Inviolus Vox: the program registers its conquer subscription but the Score wave never carries the unit", () => {
  // 383.4.c.2.a: the Conquer Effect fires for the unit that conquered, so the
  // translated {event: "conquered", object: {objectId}} filter needs an event
  // object. turn/flow.ts publishes the Score wave with player/details only, so the
  // production registration is accepted but never matches; the same registration
  // fires as soon as an event carries the object, which isolates the missing
  // payload instead of the trigger spelling.
  const kernel = world()
    .unit("vox", { cardId: CANONICAL_ID, types: ["unit"], might: 8, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => kernel.choose(request),
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  const source = kernel.getObject("vox");
  // The registry guard keeps judge-required programs out of production; the
  // executable copy only drives the same trigger registration code path.
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const ids = binding.registerProgramTriggers(engine, source);
  assert.equal(ids.length, 1);

  const fired = [];
  engine.pipeline.onTrigger = snapshot => fired.push(snapshot);
  engine.pipeline.emit({ timingPoint: "conquer", player: "A", details: { battlefieldId: "bf-1" } });
  assert.equal(fired.length, 0);

  // The subscription itself is correct: the same wave with the conquering unit
  // attached matches it.
  engine.pipeline.emit({ timingPoint: "conquer", player: "A", object: source, details: { battlefieldId: "bf-1" } });
  assert.equal(fired.length, 1);
});

test("unl-027-219 Inviolus Vox: the conquered alias passes the production trigger schema", () => {
  const translated = translateTriggerFilter(conquerTrigger.trigger.filter, "vox", conquerTrigger.trigger.at);
  const result = validateTriggerSpec({ ...conquerTrigger.trigger, filter: translated });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.deepEqual(translated, { event: "conquered", object: { objectId: "vox" } });
});
