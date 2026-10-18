import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/frigid-jewel.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-7f0b19222fb898be4cda4e745fed0f0dccc5d8ef52e41e5d57c48a67ba743618";
const SOURCE_TEXT = "When you draw your second card each turn, give a friendly unit +2 :rb_might: this turn.";

const [ability] = program.abilities;
const [mightInstruction] = ability.body;
const targetSpec = mightInstruction.targets[0];

// The reference kernel compares filter values literally; the production chain
// (chain/engine.ts) resolves the controller/owner placeholders before querying.
// The goldens therefore drive the card bodies through the production chain
// adapter while keeping the reference kernel as the resolver — the merged
// siphon-power / facebreaker convention.
const chainQuery = (kernel, controller) => (value) => {
  const normalized = { ...value };
  for (const key of ["controller", "owner"]) {
    if (normalized[key] === "self" || normalized[key] === "controller") normalized[key] = controller;
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
const registrations = (kernel) => kernel.continuousEffects.map(entry => ({
  effect: entry.effect,
  duration: entry.duration,
  timestamp: 1
}));
const effectiveMight = (kernel, id) => createLayerEngine(kernel.objects, registrations(kernel)).evaluate(kernel.ref(id)).might;
const layerEngine = (kernel) => createLayerEngine(kernel.objects, registrations(kernel));

test("unl-074-219 Frigid Jewel: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  // The Might half is merged; the second-card clause still needs trigger-time
  // condition evaluation (host.testTrigger / event payload).
  assert.match(program.judgeReason, /drawIndexThisTurn/);
  assert.match(program.judgeReason, /testTrigger/);
  assert.match(program.judgeReason, /事件载荷/);
  assert.doesNotMatch(program.judgeReason, /RIFT-/);
});

test("unl-074-219 Frigid Jewel: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("unl-074-219 Frigid Jewel: card-drawn trigger with the second-card clause as trigger condition", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.1: "when you draw your second card each turn" is keyed to the closed
  // card-drawn timing point (payloadFields includes drawIndexThisTurn).
  assert.equal(ability.trigger.at, "card-drawn");
  assert.deepEqual(ability.trigger.filter, { event: "card-drawn", player: "self" });
  // 383.2.a.1: the Nth-card clause follows the condition and belongs to it.
  assert.equal(ability.trigger.condition.kind, "compare");
  assert.equal(ability.trigger.condition.operator, "eq");
  assert.equal(ability.trigger.condition.left.kind, "count");
  assert.equal(ability.trigger.condition.left.subject, "cards-drawn-this-turn");
  assert.deepEqual(ability.trigger.condition.right, { kind: "constant", value: 2 });
  // 383.1.b: an Nth-time trigger fires once per turn.
  assert.equal(ability.trigger.once, "per-turn");
  assert.equal(ability.optional, false);
});

test("unl-074-219 Frigid Jewel: +2 Might this turn in the merged continuous.might shape", () => {
  assert.deepEqual(ability.body.map((step) => [step.id, step.op]), [
    ["frigid-jewel.grant-might", "continuous.might"]
  ]);
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "end-of-turn" });
  // The merged primitive takes the merged objects selector; the
  // authored layer/targets-only shapes are not part of its args schema.
  assert.equal(mightInstruction.args.mode, undefined);
  assert.equal(mightInstruction.args.layer, undefined);
  assert.equal(mightInstruction.args.target, undefined);
  assert.deepEqual(mightInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "frigid-jewel.friendly-unit" }
  });
  assert.equal(mightInstruction.linkedTo, undefined);
  assert.equal(mightInstruction.condition, undefined);
  // 355.10 / 355.9.a.1: "a friendly unit" is a chosen Board object.
  assert.deepEqual(targetSpec, {
    id: "frigid-jewel.friendly-unit",
    filter: { zone: "board", type: "unit", controller: "controller" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(mightInstruction.picks, undefined);
});

test("unl-074-219 Frigid Jewel golden: the +2 lands on the locked friendly unit through the production adapter", () => {
  const kernel = world()
    .unit("beast", { owner: "A", controller: "A", might: 3, location: { type: "base", player: "A" } })
    .unit("enemy", { owner: "B", controller: "B", might: 3, location: { type: "base", player: "B" } })
    .build();
  kernel.setTargets(targetSpec.id, [kernel.ref("beast")]);
  const outcome = resolveChainBody(ability.body, chainContext(kernel, "A"));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["frigid-jewel.grant-might", "executed"]
  ]);
  // One arithmetic-layer registration for the chosen unit only.
  assert.deepEqual(kernel.continuousEffects.map(entry => entry.effect.filter.objectId), ["beast"]);
  assert.equal(kernel.continuousEffects[0].effect.effect.amount, 2);
  // 317.1.a / 468.7.c: "this turn" is an end-of-turn duration.
  assert.deepEqual(kernel.continuousEffects[0].duration, { type: "end-of-turn" });
  assert.equal(effectiveMight(kernel, "beast"), 5);
  assert.equal(effectiveMight(kernel, "enemy"), 3);
  assert.equal(outcome.linkedValues["frigid-jewel.grant-might.affected.count"], 1);
});

test("unl-074-219 Frigid Jewel golden: the modification expires at end of turn (317.1.a / 468.7.c)", () => {
  const kernel = world()
    .unit("beast", { owner: "A", controller: "A", might: 3, location: { type: "base", player: "A" } })
    .build();
  kernel.setTargets(targetSpec.id, [kernel.ref("beast")]);
  resolveChainBody(ability.body, chainContext(kernel, "A"));
  assert.equal(effectiveMight(kernel, "beast"), 5);

  const engine = layerEngine(kernel);
  assert.equal(engine.expireAt("turn-end").length, 1);
  assert.equal(engine.evaluate(kernel.ref("beast")).might, 3);
});

test("unl-074-219 Frigid Jewel golden: a locked unit that left the Board makes the instruction ignored", () => {
  // 359.3.e.6: the only target is gone, so the Might modification is ignored
  // rather than re-aimed at another unit.
  const kernel = world()
    .unit("beast", { owner: "A", controller: "A", might: 3 })
    .unit("other", { owner: "A", controller: "A", might: 3 })
    .build();
  const stale = kernel.ref("beast");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  kernel.setTargets(targetSpec.id, [stale]);
  const outcome = resolveChainBody(ability.body, kernel);

  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
    ["frigid-jewel.grant-might", "ignored", "mistargeted"]
  ]);
  assert.equal(kernel.continuousEffects.length, 0);
  assert.equal(kernel.getObject("beast").zone, "hand");
  assert.equal(effectiveMight(kernel, "other"), 3);
});

test.todo(
  "unl-074-219 Frigid Jewel: evaluate \"your second card each turn\" from the card-drawn payload's " +
    "drawIndexThisTurn at trigger time (CR 383.1.b / 383.2.a.1) — events/pipeline.ts requires a host " +
    "testTrigger adapter for conditioned registrations and no merged host provides one, and " +
    "Condition/Expr cannot read event payloads"
);
