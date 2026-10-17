import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/ki-burst.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { default: stun } = await import(new URL("effects/instructions/effect.stun.js", engineCore));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));
const { translateCost } = await import(new URL("programs/play.js", engineCore));
const { buildCostPlan } = await import(new URL("cost/cost-plan.js", engineCore));

const CANONICAL = "card.hash-9b0c4b851a4af3d330a6b22579433d60ad39e8bb85ccc33f1b28ab2189ce2062";
const [keyword, play] = program.abilities;
const stunInstruction = play.body[0];

test("rad-028-167 Ki Burst: program passes validateCardProgram and keeps the printing text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "As an additional cost to play this, exhaust a friendly unit.\n" +
      "[Stun] a unit. (It doesn't deal combat damage this turn.)"
  );
});

test("rad-028-167 Ki Burst: judge-required naming the missing additional-cost path", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /356\.2/);
  assert.match(program.judgeReason, /mandatoryAdditional/);
  // The current gap is the card-facing producer, not the plan type. programs/
  // play.ts rejects additional kinds and folds this clause into the base cost.
  assert.match(program.judgeReason, /translateCost/);
  assert.match(program.judgeReason, /RIFT-358/);
  assert.doesNotMatch(program.judgeReason, /RIFT-89|RIFT-91|RIFT-257|RIFT-261/);
});

test("rad-028-167 Ki Burst: [Action] plus a mandatory exhaust cost and a one-unit stun", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");

  // The printed 1 Energy base cost; no printed Power (the card prints none).
  assert.deepEqual(play.cost.energy, { kind: "constant", value: 1 });
  assert.equal(Object.hasOwn(play.cost, "power"), false);
  // "As an additional cost ... exhaust a friendly unit" is a cost, not a target
  // (355.10.c.1), so it is a payment with a non-targeting pick.
  assert.equal(play.cost.payments.length, 1);
  const [payment] = play.cost.payments;
  assert.equal(payment.kind, "exhaust");
  assert.deepEqual(payment.amount, { kind: "constant", value: 1 });
  assert.deepEqual(payment.choice, {
    id: "ki-burst.exhausted-unit",
    options: ["ready-friendly-unit"],
    min: 1,
    max: 1,
    selection: "one",
    zone: "board",
    type: "unit",
    controller: "self",
    states: "ready"
  });

  // "[Stun] a unit." is a target (355.7 / 355.10).
  assert.equal(play.body.length, 1);
  assert.equal(stunInstruction.op, "effect.stun");
  assert.deepEqual(stunInstruction.args, {
    target: { kind: "constant", value: "ki-burst.unit" }
  });
  assert.deepEqual(stunInstruction.targets, [
    {
      id: "ki-burst.unit",
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(stunInstruction.linkedTo, undefined);
});

test("rad-028-167 Ki Burst golden: the stun half really stuns the chosen unit", () => {
  const kernel = world()
    .unit("enemy-unit", { owner: "B", might: 3 })
    .build();
  const run = runInstruction(
    stun,
    { target: "ki-burst.unit" },
    { world: kernel, targets: { "ki-burst.unit": [kernel.ref("enemy-unit")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.stunned.count, 1);
  assert.deepEqual(run.linked.stunned.objects, [{ id: "enemy-unit", zoneEntryId: 1 }]);
  assert.equal(kernel.getObject("enemy-unit").stunned, true);
  assert.deepEqual(run.events.map((event) => event.action), ["stun"]);
});

test("rad-028-167 Ki Burst boundary: an already-stunned unit takes nothing further (CR 424.1.a.1)", () => {
  const kernel = world()
    .unit("enemy-unit", { owner: "B", stunned: true })
    .build();
  const run = runInstruction(
    stun,
    { target: "ki-burst.unit" },
    { world: kernel, targets: { "ki-burst.unit": [kernel.ref("enemy-unit")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.stunned.count, 0);
  assert.equal(run.linked.stunned.alreadyStunned, 1);
  assert.deepEqual(run.events, []);
});

test("rad-028-167 Ki Burst boundary: a target that left the Board ignores the instruction (359.3.e.7)", () => {
  const kernel = world().unit("enemy-unit", { owner: "B" }).build();
  const stale = kernel.ref("enemy-unit");
  kernel.perform({ type: "kill", object: stale });
  const run = runInstruction(
    stun,
    { target: "ki-burst.unit" },
    { world: kernel, targets: { "ki-burst.unit": [stale] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
});

test("rad-028-167 Ki Burst boundary: the additional exhaust is folded into the base cost today", () => {
  // CR 356.2.a.1 makes this a Mandatory Additional Cost, but the merged card
  // adapter has no additional-cost entry point: it accepts printed/activated/
  // explicit only and rejects an `additional` marker outright, so the clause
  // becomes part of the base cost input instead of mandatoryAdditional.
  assert.throws(
    () => translateCost({ ...play.cost, kind: "cost.additional" }, "ki-burst.cost", "play"),
    /Additional costs are not bound/
  );
  assert.throws(
    () => translateCost({ ...play.cost, additional: { kind: "constant", value: 1 } }, "ki-burst.cost", "play"),
    /Unsupported play cost field additional/
  );
  const translated = translateCost(play.cost, "ki-burst.cost", "play");
  assert.equal(translated.kind, "explicit");
  assert.equal(translated.energy.value, 1);
  assert.equal(translated.payments[0].kind, "exhaust");

  // The exhaust pick is still selection-shaped: cost/plan-values.ts only accepts
  // exact ObjectRefs, so the declared option name cannot build a plan (RIFT-358
  // owns the filter/ordered pick shape and is still unmerged).
  const kernel = world().player("A", { energy: 3 }).unit("caster", { types: ["spell"], energy: 1 }).unit("ready-friendly", { might: 2 }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("caster") });
  assert.throws(
    () => buildCostPlan(context, { id: "ki-burst.plan", cost: translated, domains: ["Calm"] }),
    /exact object reference/i
  );
  assert.equal(context.getObject("ready-friendly").exhausted, false);
});

test.todo(
  "rad-028-167 Ki Burst: CR 356.2 charges 'As an additional cost to play this, exhaust a " +
    "friendly unit' as a Mandatory Additional Cost during the Finalize cost plan; programs/play.ts " +
    "still folds the clause into the base cost and rejects additional markers, so no card-facing " +
    "producer fills CostPlanInput.mandatoryAdditional"
);
