import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/chronobreak.js";
import banish from "../../../../engine-core/dist/effects/instructions/effect.banish.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveLocationSelector } from "../../../../engine-core/dist/target/location/index.js";

const [play] = program.abilities;
const [pay, banishInstruction, playBack] = play.body;
const targetId = banishInstruction.targets[0].id;

const banishArgs = (paidPower) => ({
  objects: banishInstruction.args.objects,
  amount: { kind: "constant", value: paidPower },
  linkKey: banishInstruction.args.linkKey
});

test("rad-140-167 Chronobreak: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(
    program.canonicalCardId,
    "card.hash-2875b065844462e761acfeb152cf2feea180924a496740b05903caac24a3d795"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "As an additional cost to play this, pay any amount of Power.\n" +
      "Banish that many units you control, then for each, its owner plays that unit back to the same location " +
      "or to their base, ignoring its cost. (You choose the order.)"
  );
});

test("rad-140-167 Chronobreak: judgeReason names the variable cost, lost location and per-owner play gaps", () => {
  assert.match(program.judgeReason, /204\.2\.a/);
  assert.match(program.judgeReason, /可变/);
  assert.match(program.judgeReason, /428/);
  assert.match(program.judgeReason, /effect\.play/);
  assert.match(program.judgeReason, /356\.1\.b\.1/);
  assert.doesNotMatch(program.judgeReason, /RIFT-357|RIFT-358/);
});

test("rad-140-167 Chronobreak: 'ignoring its cost' is expressible, but the variable Power X is not", () => {
  // 356.1.b.1 / 356.1.b.3: a base-cost rewrite really zeroes the base while later
  // additional costs still apply. That half of the play-back clause is now
  // executable; "pay any amount of Power" is not: the cost pipeline evaluates a
  // payment amount through ctx.evaluate, which requires an Expr, so a chosen
  // amount has no representation (204.2.a / 135.2.b.5).
  const kernel = world().player("A", { energy: 9 }).hand("chronobreak", { types: ["spell"], energy: 2, power: [] }).build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("chronobreak") });
  const ignored = buildCostPlan(ctx, {
    id: "ignored-play",
    cost: { kind: "printed" },
    baseModifications: [{ kind: "ignore-base", id: "chronobreak.ignore", ignore: "resources" }],
    mandatoryAdditional: [{ id: "later-additional", cost: { energy: { kind: "constant", value: 1 } } }]
  });
  assert.deepEqual(ignored.total, { energy: 1, power: [], xp: 0, actions: [] });
  assert.deepEqual(ignored.modifications, [{ kind: "ignore-base", id: "chronobreak.ignore", ignore: "resources" }]);

  assert.throws(
    () => buildCostPlan(ctx, {
      id: "variable",
      cost: { kind: "printed" },
      mandatoryAdditional: [{ id: "x", cost: { payments: [{ kind: "power", amount: { kind: "choose", id: "chronobreak.x" } }] } }]
    }),
    /Power must be a nonnegative safe integer/
  );
});

test("rad-140-167 Chronobreak: the pre-Banish location is kept as last-known but no merged selector can read it", () => {
  // 428 / 124: Banish gives the card a new object identity, so "the same
  // location" must come from the pre-move snapshot. The kernel keeps it, but the
  // banish receipt publishes only post-move refs and the merged location
  // selectors resolve through ctx.object(...) (the current location).
  const kernel = world().player("A", { energy: 9 }).unit("u1", { location: { type: "battlefield", id: "bf-1" } }).build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("u1") });
  const original = ctx.ref("u1");
  const run = runInstruction(banish, banishArgs(1), {
    world: ctx,
    targets: { [targetId]: [original] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(ctx.getObject("u1").zone, "banishment");
  assert.deepEqual(ctx.lastKnown(original).location, { type: "battlefield", id: "bf-1" });
  const [banishedRef] = run.linked["chronobreak.banishedObjects"];
  assert.equal(banishedRef.zoneEntryId, original.zoneEntryId + 1, "124: the banished card is a new object");
  assert.throws(
    () => resolveLocationSelector(
      { kind: "linked-location", instructionId: "chronobreak.banish", key: "chronobreak.banishedObjects" },
      { context: ctx, host: original, linked: key => run.linked[key] }
    ),
    /Linked value has no runtime location/
  );
});

test.todo(
  "rad-140-167 Chronobreak: a per-object owner chooser and an effect.play-back producer/consumer " +
    "(420.3 / 420.4) — the ignored-cost rewrite itself is expressible (baseModifications ignore-base), " +
    "but effect.play takes one player plus one location for the whole selection and effect.play-back is not a registered opcode"
);

test("rad-140-167 Chronobreak: structure — mandatory variable Power cost plus banish and play-back", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.body.map(instruction => instruction.id), [
    "chronobreak.pay-power",
    "chronobreak.banish",
    "chronobreak.play-back"
  ]);

  // "As an additional cost to play this, pay any amount of Power" (204.2.a):
  // the cost lives on the play ability's CostSpec so the intent is reviewable;
  // no merged CostSpec field can carry the variable X (see judgeReason).
  assert.equal(play.cost.kind, "cost.additional");
  assert.deepEqual(play.cost.payments, [{ kind: "power.any-amount" }]);

  assert.equal(pay.op, "cost.pay-any-power");
  assert.equal(pay.linkedTo, undefined);
  assert.deepEqual(pay.args.linkKey, { kind: "constant", value: "paidPower" });

  // "Banish that many units you control": amount = the paid X, set = self units.
  assert.equal(banishInstruction.op, "effect.banish");
  assert.deepEqual(banishInstruction.args.objects, {
    kind: "constant",
    value: { target: targetId }
  });
  assert.deepEqual(banishInstruction.args.amount, {
    kind: "linked-value",
    instructionId: "chronobreak.pay-power",
    key: "paidPower"
  });
  assert.equal(banishInstruction.targets.length, 1);
  assert.deepEqual(banishInstruction.targets[0].filter, { type: "unit", controller: "self" });
  assert.equal(banishInstruction.targets[0].min, 0);
  assert.equal(banishInstruction.targets[0].max, null);
  assert.equal(banishInstruction.targets[0].selection, "up-to");

  // "then for each, its owner plays that unit back ... ignoring its cost.
  // (You choose the order.)" — per-object owner chooser, per-object destination
  // choice and an ignore-cost play rewrite; pending (see judgeReason).
  assert.equal(playBack.op, "effect.play-back");
  assert.equal(playBack.linkedTo, "chronobreak.banish");
  assert.deepEqual(playBack.args.objects, {
    kind: "linked-value",
    instructionId: "chronobreak.banish",
    key: "chronobreak.banishedObjects"
  });
  assert.deepEqual(playBack.args.chooser, { kind: "constant", value: "owner" });
  assert.deepEqual(playBack.args.destinations, {
    kind: "constant",
    value: ["same-location", "owner-base"]
  });
  assert.deepEqual(playBack.args.orderChooser, { kind: "constant", value: "controller" });
  assert.deepEqual(playBack.args.ignoreCost, { kind: "constant", value: true });
});

test("rad-140-167 Chronobreak: 'Banish that many units you control' banishes exactly the paid amount", () => {
  const kernel = world()
    .player("A")
    .unit("u1")
    .unit("u2")
    .unit("u3")
    .unit("enemy", { owner: "B" })
    .build();
  const run = runInstruction(banish, banishArgs(2), {
    world: kernel,
    targets: { [targetId]: [kernel.ref("u1"), kernel.ref("u2"), kernel.ref("u3")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked["chronobreak.banishedCount"], 2);
  assert.deepEqual(run.events.map(event => event.action), ["banish", "banish"]);
  assert.equal(kernel.getObject("u1").zone, "banishment");
  assert.equal(kernel.getObject("u2").zone, "banishment");
  assert.equal(kernel.getObject("u3").zone, "board");
  assert.equal(kernel.getObject("enemy").zone, "board");
});

test("rad-140-167 Chronobreak: paying 0 Power banishes no units and executes", () => {
  const kernel = world().player("A").unit("u1").build();
  const run = runInstruction(banish, banishArgs(0), {
    world: kernel,
    targets: { [targetId]: [kernel.ref("u1")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked["chronobreak.banishedCount"], 0);
  assert.deepEqual(run.events, []);
  assert.equal(kernel.getObject("u1").zone, "board");
});

test("rad-140-167 Chronobreak: a reference that already left the board is not revived (124)", () => {
  const kernel = world().player("A").unit("u1").unit("u2").build();
  const stale = kernel.ref("u1");
  kernel.perform({ type: "kill", object: stale });
  const run = runInstruction(banish, banishArgs(2), {
    world: kernel,
    targets: { [targetId]: [stale] }
  });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("u1").zone, "trash");
  assert.equal(kernel.getObject("u2").zone, "board");
});

test.todo(
  "rad-140-167 Chronobreak: 'pay any amount of Power' as a mandatory variable additional cost " +
    "(CR 204.2.a) — the merged cost planner still has no X binding into the resolving instructions"
);

test.todo(
  "rad-140-167 Chronobreak: 'its owner plays that unit back to the same location or to their base, " +
    "ignoring its cost' — needs the pre-banish location, a per-object owner chooser with a per-object " +
    "destination choice, and an ignore-cost play rewrite (CR 420.3 / 356.1.b.1); effect.play-back " +
    "has no production consumer"
);
