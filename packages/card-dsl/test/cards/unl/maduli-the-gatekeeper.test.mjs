import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/maduli-the-gatekeeper.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runInstruction } from "../../../../engine-core/dist/effects/testing/index.js";
import { createContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { restrictions } from "../../../../engine-core/dist/layers/rules/query.js";
import restrict from "../../../../engine-core/dist/effects/instructions/continuous.restrict.js";

const CARD_ID =
  "card.hash-9f4e7daa818aadec972e97c3f25f231c123fa7f6c5d2b58750be9027cbca870c";
const SOURCE_TEXT =
  "I can't be readied.\n" +
  ":rb_rune_chaos:: Move me to an occupied enemy battlefield if my Might is greater than the total " +
  "Might of enemy units there.";

const [cannotBeReadied, activated] = program.abilities;
const [moveMe] = activated.body;

function maduliWorld({ power = ["Chaos"] } = {}) {
  const base = world()
    .player("A", { power })
    .unit("maduli", {
      might: 6,
      energy: 7,
      power: 1,
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("maduli") });
}

test("unl-144-219 Maduli the Gatekeeper: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-144-219 Maduli the Gatekeeper: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /170\.11\.a/);
  assert.match(program.judgeReason, /143\.2\.a/);
});

test("unl-144-219 Maduli the Gatekeeper: 'I can't be readied' is a static prohibition on this card", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(cannotBeReadied.kind, "static");
  // 364.1/364.2: a statement of fact; 416 Ready plus 315.1.b.1's awaken readies only what it can.
  assert.deepEqual(cannotBeReadied.effect, {
    kind: "continuous.restrict",
    mode: "prohibit",
    action: "ready",
    appliesTo: "self"
  });
  assert.equal(cannotBeReadied.condition, undefined);
});

test("unl-144-219 Maduli the Gatekeeper: 1 Chaos Power base cost with a descriptive destination", () => {
  assert.equal(activated.kind, "activated");
  // 204.1.b: the resource before the ":" is the ability's Base Cost; no [Action]/[Reaction] is printed.
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost, {
    kind: "activated",
    power: { kind: "constant", value: ["Chaos"] }
  });
  assert.equal(activated.restriction, undefined);

  assert.equal(moveMe.id, "maduli-the-gatekeeper.move-me");
  assert.equal(moveMe.op, "effect.move");
  // "me" is the host, programmatically selected (355.10.d), so no target declaration.
  assert.deepEqual(moveMe.args.objects, { kind: "constant", value: "self" });
  assert.deepEqual(moveMe.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(moveMe.args.linkKey, { kind: "constant", value: "moved" });
  assert.equal(moveMe.targets, undefined);
  assert.equal(moveMe.picks, undefined);

  // "to an occupied enemy battlefield if …": a descriptive destination marker, never an executable
  // LocationRef — effect.move rejects it rather than moving the unit somewhere wrong.
  assert.deepEqual(moveMe.args.to, {
    kind: "constant",
    value: {
      kind: "destination-selector",
      filter: { type: "battlefield", occupied: true, controller: "opponent" },
      condition: "my-might-greater-than-total-enemy-might-there"
    }
  });
});

test("unl-144-219 Maduli the Gatekeeper golden: the printed Chaos Power cost is payable through the merged cost pipeline", () => {
  const kernel = maduliWorld({ power: ["Chaos"] });
  const plan = buildCostPlan(kernel, { id: "maduli-the-gatekeeper", cost: activated.cost });
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ["Chaos"] }]);

  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  // CR 805.1.b.1-style domain matching for Power: the allocation is the exact Chaos Power paid.
  assert.deepEqual(receipt.power, { power: [{ requirementIndex: 0, from: "Chaos", amount: 1 }] });
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay"]);
});

test("unl-144-219 Maduli the Gatekeeper golden: a pool without Chaos Power cannot pay the cost", () => {
  const kernel = maduliWorld({ power: ["Mind"] });
  const plan = buildCostPlan(kernel, { id: "maduli-the-gatekeeper", cost: activated.cost });
  assert.throws(() => payCostPlan(kernel, plan), /insufficient matching Power/);
  assert.deepEqual(kernel.player("A").power, ["Mind"]);
});

test("unl-144-219 Maduli the Gatekeeper golden: a concrete locked destination does move the unit (merged Move evidence)", () => {
  // Caller-supplied Finalize destination: the merged effect.move half is executable once the runtime
  // Location selector exists; this golden proves the Move itself, never the missing selection step.
  const kernel = maduliWorld();
  const body = [
    { ...moveMe, args: { ...moveMe.args, to: { kind: "constant", value: { type: "battlefield", id: "bf-2" } } } }
  ];
  const outcome = resolveChainBody(body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.getObject("maduli").location, { type: "battlefield", id: "bf-2" });
  assert.deepEqual(outcome.events.map(event => event.action), ["move-location"]);
});

test("unl-144-219 Maduli the Gatekeeper golden: the merged restriction primitive records the ready prohibition", () => {
  const kernel = world().unit("maduli", { might: 6 }).build();
  const run = runInstruction(
    restrict,
    {
      mode: { kind: "constant", value: "prohibit" },
      action: { kind: "constant", value: "ready" },
      appliesTo: { kind: "constant", value: { objectId: "maduli" } }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  const registry = createContinuousEffectRegistry();
  for (const entry of kernel.continuousEffects) registry.register(entry.effect, entry.duration);
  assert.deepEqual(restrictions(registry, "ready").map(entry => entry.actions), [["ready"]]);
});

test.todo(
  "unl-144-219 Maduli the Gatekeeper: make Ready and Awaken consult the registered ready restriction (CR 364.2 / 416)"
);
test.todo(
  "unl-144-219 Maduli the Gatekeeper: choose an occupied enemy battlefield at resolution and require my Might to " +
    "exceed the total Might of enemy units there (CR 170.11.a / 355.4.a / 451.1 / 143.2.a) — the frozen IR has no " +
    "runtime Location selector and effect.move accepts only static destinations"
);
