import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/chronobreak.js";
import banish from "../../../../engine-core/dist/effects/instructions/effect.banish.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.match(program.judgeReason, /RIFT-357/);
  assert.match(program.judgeReason, /RIFT-358/);
});

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
    "has no production consumer, while location selection and ordered picks remain RIFT-357 / RIFT-358 work"
);
