import assert from "node:assert/strict";
import test from "node:test";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/shadow.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import stun from "../../../../engine-core/dist/effects/instructions/effect.stun.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-4c764cb6248ef9337fc1c8769d4b74fc1d4c1fff6a9e8d00ca6753a560b3e74b";
const SOURCE_TEXT =
  "If you play me to a battlefield, I enter ready.\n" +
  "[Action][>] :rb_energy_1::rb_rune_rainbow:, :rb_exhaust:: [Stun] an enemy unit attacking here. " +
  "(It doesn't deal combat damage this turn.)";

const [keyword, enterReady, activated] = program.abilities;
const [stunInstruction] = activated.body;
const [enemyAttacker] = stunInstruction.targets;

test("unl-194-219 Shadow: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-194-219 Shadow: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /143\.4/);
  assert.match(program.judgeReason, /replacement\.enter|替代/);
  assert.match(program.judgeReason, /135\.2\.e\.5\.a/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /RIFT-359/);
});

test("unl-194-219 Shadow: 'I enter ready' is an entry replacement, never a create-then-ready pair", () => {
  assert.equal(enterReady.kind, "replacement");
  // 143.4 / 359.2.c / 369.3: the replacement intercepts the enter-board event
  // while the unit is still exhausted, and its with body readies the source.
  assert.deepEqual(enterReady.replaces, {
    event: "object-enters-board",
    filter: { source: "self", exhausted: true }
  });
  assert.equal(enterReady.with.length, 1);
  assert.equal(enterReady.with[0].id, "shadow.enter-ready");
  assert.equal(enterReady.with[0].op, "effect.ready");
  assert.deepEqual(enterReady.with[0].args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
  // "If you play me to a battlefield" — a retained condition shape: the played
  // location fact has no merged reader, and the placeholder fails closed.
  assert.equal(enterReady.condition.kind, "compare");
  assert.deepEqual(enterReady.condition.left, {
    kind: "object-property",
    object: "self",
    property: "shadow.played-to-battlefield"
  });
  assert.deepEqual(enterReady.condition.right, { kind: "constant", value: true });
});

test("unl-194-219 Shadow: [Action] is declared and [A] is one Power payable with any domain", () => {
  // 806.1: "[Action][>]" is a permissive keyword on an activated ability.
  assert.deepEqual(keyword, { kind: "keyword", keyword: "action" });

  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  // 135.2.e.5.a: one [A] accepts any domain, independently of Shadow's own domains.
  assert.deepEqual(activated.cost, {
    kind: "activated",
    energy: { kind: "constant", value: 1 },
    payments: [
      { kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"] },
      { kind: "exhaust", object: "self" }
    ]
  });
});

test("unl-194-219 Shadow: the stun clause targets one enemy attacker at the source location", () => {
  assert.equal(stunInstruction.op, "effect.stun");
  assert.deepEqual(stunInstruction.args, {
    target: { kind: "constant", value: "shadow.enemy-attacker-here" }
  });
  assert.equal(stunInstruction.linkedTo, undefined);
  assert.equal(enemyAttacker.id, "shadow.enemy-attacker-here");
  assert.deepEqual(enemyAttacker.filter, {
    type: "unit",
    zone: "board",
    controller: "opponent",
    sameLocationAs: "source",
    combatRole: "attacker"
  });
  assert.equal(enemyAttacker.min, 1);
  assert.equal(enemyAttacker.max, 1);
  assert.equal(enemyAttacker.selection, "one");
});

test("unl-194-219 Shadow golden: the entry replacement's with body readies the source unit", () => {
  // 369.3 / 805.6: the replacement readies the entering unit instead of letting
  // it enter exhausted. The with body is the merged effect.ready primitive.
  const base = world().unit("shadow", { exhausted: true }).build();
  // The printed `{ kind: "source" }` selector resolves against the ability's
  // source snapshot (contract 3.6), so the world is cloned with that snapshot.
  const kernel = base.clone({ sourceSnapshot: base.getObject("shadow") });
  const run = runInstruction(
    ready,
    // The interpreter evaluates Exprs before dispatch, so the primitive receives
    // the evaluated selector (the printed IR keeps the constant envelope).
    { objects: { kind: "source" } },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("shadow").exhausted, false);
  assert.equal(run.linked.readied.count, 1);
  assert.deepEqual(run.events.map(event => event.action), ["ready"]);
});

test("unl-194-219 Shadow golden: the printed stun resolves on a locked enemy unit here", () => {
  // 424.1: the stun half is real; the combatRole restriction is a retained shape
  // that still needs the programs/chain filter adapter. This test covers only
  // the stun primitive after a target has been locked.
  const kernel = world()
    .unit("shadow", { location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-here", { owner: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const run = runInstruction(stun, { target: enemyAttacker.id }, {
    world: kernel,
    targets: { [enemyAttacker.id]: [kernel.ref("enemy-here")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy-here").stunned, true);
  assert.deepEqual(run.events.map(event => event.action), ["stun"]);
});

test("unl-194-219 Shadow golden: a stun target that left the board is ignored (359.3.e.5)", () => {
  const kernel = world().unit("shadow").unit("enemy", { owner: "B" }).build();
  const stale = kernel.ref("enemy");
  kernel.perform({ type: "return-to-hand", object: stale });
  const run = runInstruction(stun, { target: enemyAttacker.id }, {
    world: kernel,
    targets: { [enemyAttacker.id]: [stale] }
  });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("enemy").stunned, false);
});

test("unl-194-219 Shadow golden: [A] pays with one Power from any of the six domains (135.2.e.5.a)", () => {
  const domains = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"];
  for (const domain of domains) {
    const base = world()
      .player("A", { energy: 1, power: [domain] })
      .unit("shadow", { power: ["Calm", "Chaos"], exhausted: false })
      .build();
    const kernel = base.clone({ sourceSnapshot: base.getObject("shadow") });
    const plan = buildCostPlan(kernel, { id: "shadow:activate", cost: activated.cost, domains: ["Calm", "Chaos"] });
    assert.equal(plan.total.energy, 1);
    assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: domains }]);
    const receipt = payCostPlan(kernel, plan);
    assert.equal(receipt.paid, true);
    assert.deepEqual(receipt.actions.map(entry => entry.action.type), ["pay", "exhaust"]);
    assert.deepEqual(receipt.actions[0].action.plan.power, [domain]);
    assert.equal(kernel.player("A").energy, 0);
    assert.equal(kernel.getObject("shadow").exhausted, true);
  }
});

test("unl-194-219 Shadow golden: lacking Power prevents payment before exhausting the source", () => {
  const base = world().player("A", { energy: 1 }).unit("shadow", { exhausted: false }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("shadow") });
  const plan = buildCostPlan(kernel, { id: "shadow:activate", cost: activated.cost });
  assert.throws(() => payCostPlan(kernel, plan), error => error?.reason === "cannot-pay-cost");
  assert.equal(kernel.player("A").energy, 1);
  assert.equal(kernel.getObject("shadow").exhausted, false);
});

test.todo(
  "unl-194-219 Shadow: read the chosen play destination and evaluate the conditional entry replacement before the board move (CR 143.4/359.2.c/369.3; RIFT-359)"
);
test.todo(
  "unl-194-219 Shadow: retain sameLocationAs and combatRole through programs target translation and chain layer filtering (CR 355.9/424.1); ObjectSnapshot already carries attacker/defender identity"
);
