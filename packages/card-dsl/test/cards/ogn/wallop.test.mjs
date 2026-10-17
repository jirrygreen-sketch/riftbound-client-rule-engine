import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import wallop from "../../../dist/cards/ogn/wallop.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [speed, costRewrite, play] = wallop.abilities;
const [readyInstruction] = play.body;

test("Wallop program is structurally valid and judge-required", () => {
  const result = validateCardProgram(wallop);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(wallop.status, "judge-required");
  assert.match(wallop.judgeReason, /356\.1\.b\.1/);
  assert.match(wallop.judgeReason, /additional-cost/);
  assert.match(wallop.judgeReason, /play adapter/);
  assert.equal(wallop.rulesetVersion, "core-1.5");
  assert.equal(
    wallop.canonicalCardId,
    "card.hash-d17776003a48b0ee24115e1938482e85fa10ac7c582b993ca9d4b891b3dd1d48"
  );
  assert.equal(
    wallop.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "As you play this, you may spend a buff as an additional cost. If you do, ignore this spell's cost.\n" +
      "Ready a unit."
  );
});

test("Wallop structure: [Action] keyword, cost rewrite, optional spend-buff cost, ready a unit", () => {
  assert.equal(wallop.abilities.length, 3);
  // [Action] (806) is a speed keyword ability expanded by the keyword registry.
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });

  // "If you do, ignore this spell's cost" (356.1.b.1): declared as a static
  // cost modification of this card, the shape the merged corpus uses for cost
  // rewrites (sfd/production-surge.ts), conditional on the optional cost.
  assert.equal(costRewrite.kind, "static");
  assert.equal(costRewrite.effect.kind, "continuous.cost-modification");
  assert.equal(costRewrite.effect.appliesTo, "self");
  assert.deepEqual(costRewrite.effect.amount, { kind: "constant", value: "ignore-base" });
  assert.deepEqual(costRewrite.effect.when, {
    kind: "constant",
    value: { optionalCostPaid: "wallop.buff-payment" }
  });

  assert.equal(play.kind, "play");

  // "you may spend a buff as an additional cost" (355.1.a, 356.2.b): one
  // optional spend-buff payment with a non-target pick over friendly buffs.
  assert.equal(play.cost.kind, "additional");
  assert.equal(play.cost.payments.length, 1);
  const payment = play.cost.payments[0];
  assert.equal(payment.kind, "spend-buff");
  assert.equal(payment.choice.id, "wallop.buff-payment");
  assert.equal(payment.choice.selection, "one");
  assert.equal(payment.choice.min, 1);
  assert.equal(payment.choice.max, 1);

  // The rewrite travels on the static ability (not inside the CostSpec): the
  // frozen cost-plan vocabulary rejects baseModifications there.
  assert.equal(play.cost.baseModifications, undefined);

  // "Ready a unit." targets one unit on the board (355.9.a.1).
  assert.equal(play.body.length, 1);
  assert.equal(readyInstruction.op, "effect.ready");
  assert.equal(readyInstruction.targets.length, 1);
  assert.equal(readyInstruction.targets[0].id, "wallop.unit");
  assert.deepEqual(readyInstruction.targets[0].filter, { type: "unit", zone: "board" });
  assert.equal(readyInstruction.targets[0].min, 1);
  assert.equal(readyInstruction.targets[0].max, 1);
  assert.equal(readyInstruction.targets[0].selection, "one");
  assert.deepEqual(readyInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "wallop.unit" }
  });
  assert.deepEqual(readyInstruction.args.amount, { kind: "constant", value: 1 });
});

test("Wallop golden: the Ready a unit half readies exactly the chosen unit", () => {
  const kernel = world()
    .unit("chosen-unit", { owner: "A", exhausted: true })
    .unit("other-unit", { owner: "A", exhausted: true })
    .unit("enemy-unit", { owner: "B", exhausted: true })
    .build();
  const run = runInstruction(
    ready,
    { objects: readyInstruction.args.objects, amount: readyInstruction.args.amount },
    { world: kernel, targets: { "wallop.unit": [kernel.ref("chosen-unit")] } }
  );
  assert.equal(run.result.status, "executed");
  // CR 416.1: the chosen unit becomes ready; nothing else changes.
  assert.equal(kernel.getObject("chosen-unit").exhausted, false);
  assert.equal(kernel.getObject("other-unit").exhausted, true);
  assert.equal(kernel.getObject("enemy-unit").exhausted, true);
  assert.deepEqual(run.linked.readied, {
    count: 1,
    objects: [{ id: "chosen-unit", zoneEntryId: 1 }]
  });
  assert.deepEqual(run.events.map((event) => event.action), ["ready"]);
});

test("Wallop golden: readies a unit for 0, even though the spell already paid its cost", () => {
  // The printed ready half does not depend on the optional additional cost: a
  // unit that is already ready simply is not readied again (416.1.c), and the
  // instruction still executes.
  const kernel = world().unit("ready-unit", { owner: "A", exhausted: false }).build();
  const run = runInstruction(
    ready,
    { objects: readyInstruction.args.objects, amount: readyInstruction.args.amount },
    { world: kernel, targets: { "wallop.unit": [kernel.ref("ready-unit")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readied.count, 0);
  assert.deepEqual(run.linked.readied.objects, []);
  assert.deepEqual(run.events, []);
});

test("Wallop golden: a unit that left the board makes the ready half ignored", () => {
  const kernel = world().unit("gone-unit", { owner: "A", exhausted: true }).build();
  const stale = kernel.ref("gone-unit");
  kernel.perform({ type: "kill", object: stale });
  const run = runInstruction(
    ready,
    { objects: readyInstruction.args.objects, amount: readyInstruction.args.amount },
    { world: kernel, targets: { "wallop.unit": [stale] } }
  );
  // Contract 3.6 primitive rule 2 / 359.3.e.7: every target invalid -> ignored.
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
});

test.todo(
  "Wallop additional cost: the optional spend-buff decision is made at Finalize and its " +
    "paid receipt drives the base-cost rewrite (356.1.b.1/356.1.b.3, 356.4.f.1) through " +
  "the cost planner; the play adapter still rejects the authored additional-cost shape, " +
  "static cost modifications are not collected into the play CostPlan, and no Condition/Expr " +
  "reads the receipt"
);

test.todo(
  "Wallop cast: pays the printed 2 Energy (or 0 when the buff was spent) and [Action] " +
  "showdown timing is enforced after the additional-cost and cost-modification adapters land"
);

