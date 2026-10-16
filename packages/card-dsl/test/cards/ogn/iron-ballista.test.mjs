import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/iron-ballista.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";

const CANONICAL = "card.hash-d434f43890dfb7e3149efa46b08c5871f835e6526d2eeb6493d14f5157f3251e";

const [enterReplacement, activated] = program.abilities;
const damageInstruction = activated.body[0];
const targetSpec = damageInstruction.targets[0];

test("ogn-017-298 Iron Ballista: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // The replacement primitive is merged; the remaining gap is CardProgram
  // registration of replacement and activated abilities.
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /143\.4|359\.2\.d/);
  assert.equal(
    program.sourceText,
    "This enters exhausted.\n:rb_exhaust:: Deal 2 to a unit at a battlefield."
  );
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Iron Ballista structure: enter-exhausted replacement, then the exhaust-cost damage ability", () => {
  assert.equal(program.abilities.length, 2);

  // “This enters exhausted.” — an entry state rewrite, not an exhaust action.
  assert.equal(enterReplacement.kind, "replacement");
  assert.deepEqual(enterReplacement.replaces, {
    event: "object-enters-board",
    filter: { source: "self" }
  });
  assert.equal(enterReplacement.with.length, 1);
  const [enter] = enterReplacement.with;
  assert.equal(enter.id, "iron-ballista.enter-exhausted");
  assert.equal(enter.op, "replacement.enter");
  assert.deepEqual(enter.args.state, { kind: "constant", value: "exhausted" });
  assert.deepEqual(enter.args.zone, { kind: "constant", value: "board" });

  // “:rb_exhaust:: Deal 2 …” — Gear activated ability (CR 151/151.2), exhaust cost.
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.equal(activated.cost.kind, "activated");
  assert.deepEqual(activated.cost.payments, [{ kind: "exhaust" }]);

  assert.equal(activated.body.length, 1);
  assert.equal(damageInstruction.id, "iron-ballista.deal-2");
  assert.equal(damageInstruction.op, "effect.damage");
  assert.deepEqual(damageInstruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(damageInstruction.args.target, { kind: "constant", value: "unit-at-battlefield" });
  assert.equal(damageInstruction.linkedTo, undefined);
  assert.equal(damageInstruction.picks, undefined);

  // “a unit at a battlefield”: exactly one unit pinned to a battlefield location.
  assert.equal(damageInstruction.targets.length, 1);
  assert.equal(targetSpec.id, "unit-at-battlefield");
  assert.deepEqual(targetSpec.filter, { type: "unit", location: { type: "battlefield" } });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");
});

test("Iron Ballista golden: effect.exhaust pays the activation cost by exhausting the Gear itself", () => {
  const base = world()
    .unit("iron-ballista", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("iron-ballista") });
  const plan = buildCostPlan(kernel, {
    id: "cost:iron-ballista",
    cost: { kind: "activated", payments: [{ kind: "exhaust" }] }
  });
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, []);
  assert.equal(plan.total.actions.length, 1);
  assert.equal(plan.total.actions[0].action.type, "exhaust");

  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust"]);
  assert.equal(kernel.getObject("iron-ballista").exhausted, true);
  assert.deepEqual(
    receipt.events.filter(event => event.action === "exhaust").map(event => event.action),
    ["exhaust"]
  );
});

test("Iron Ballista golden: the damage half deals exactly 2 to a battlefield unit", () => {
  const kernel = world()
    .unit("battlefield-unit", { zone: "board", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const locked = kernel.ref("battlefield-unit");
  const run = runInstruction(
    damage,
    { amount: damageInstruction.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [locked] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("battlefield-unit").damage, 2);
  assert.deepEqual(run.events.map(event => event.action), ["damage"]);
  assert.equal(run.result.linkedValues.dealt, 2);
  assert.equal(run.result.linkedValues.dealtCount, 1);
});

test("Iron Ballista golden: a unit that left the battlefield is ignored, not redirected", () => {
  const kernel = world().unit("battlefield-unit").build();
  const stale = kernel.ref("battlefield-unit");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  const run = runInstruction(
    damage,
    { amount: damageInstruction.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [stale] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

test("Iron Ballista golden: replacement.enter rewrites the board entry before it commits", () => {
  const kernel = world()
    .unit("iron-ballista", {
      zone: "hand",
      types: ["gear"],
      owner: "A",
      controller: "A"
    })
    .build();
  const hostRef = kernel.ref("iron-ballista");
  const registrations = [];
  const host = {
    object: (ref) => kernel.object(ref),
    objects: () => kernel.objects,
    context: () => kernel
  };

  bindReplacement(enterReplacement, hostRef, {
    host,
    pipeline: {
      clock: { turn: 1 },
      registerReplacement: (registration) => registrations.push(registration)
    }
  });

  assert.equal(kernel.perform({ type: "move-zone", object: hostRef, to: "chain" }).status, "done");
  const enteringObject = kernel.ref("iron-ballista");
  const entering = {
    type: "move-zone",
    object: enteringObject,
    to: "base",
    location: { type: "base", player: "A" }
  };
  const [registration] = registrations;
  assert.equal(registration.matches(entering, entering), true);

  const replacement = registration.apply(entering, entering);
  assert.equal(replacement.status, "replace");
  assert.deepEqual(replacement.actions.map((action) => action.type), ["exhaust", "move-zone"]);
  assert.deepEqual(replacement.actions[0].object, enteringObject);
  assert.deepEqual(replacement.actions[1], entering);

  for (const action of replacement.actions) {
    assert.equal(kernel.perform(action).status, "done");
  }
  const entered = kernel.getObject("iron-ballista");
  assert.equal(entered.zone, "board");
  assert.deepEqual(entered.location, { type: "base", player: "A" });
  assert.equal(entered.exhausted, true);
  assert.deepEqual(kernel.events.map((event) => event.action), ["move-zone", "exhaust", "move-zone"]);
});
