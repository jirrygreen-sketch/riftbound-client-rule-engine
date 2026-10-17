import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/caitlyn-patrolling.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";


test("ogn-068-298: identity, exact source text, pure data and explicit blocked status", () => {
  const validation = validateCardProgram(program);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  assert.deepEqual(validation.issues, []);
  assert.equal(program.canonicalCardId, "card.hash-46870901290d1c4082f78830943ec1e847b51ec8c511a04a60ad3c97410429df");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Backline|continuous\.combat/);
  assert.match(program.judgeReason, /at-battlefield/);
  assert.equal(program.sourceText, "I must be assigned combat damage last.\n:rb_exhaust:: Deal damage equal to my Might to a unit at a battlefield. Use this ability only while I'm at a battlefield.");
  assert.deepEqual(JSON.parse(JSON.stringify(program)), program);
});

const [backline, activated] = program.abilities;
const hit = activated.body[0];

test("Caitlyn: Backline and an exhaust-cost action restricted to battlefields", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(backline, { kind: "keyword", keyword: "backline" });
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost, { payments: [{ kind: "exhaust", object: "self" }] });
  assert.equal(activated.restriction.kind, "at-battlefield");
  assert.deepEqual(activated.restriction.condition, { kind: "compare", left: { kind: "count", subject: "objects", filter: { object: "self", zone: "battlefield" } }, operator: "gte", right: { kind: "constant", value: 1 } });
});

test("Caitlyn: one unit at any battlefield, with resolution-time source Might", () => {
  assert.equal(activated.body.length, 1);
  assert.equal(hit.op, "effect.damage");
  assert.deepEqual(hit.args.amount, { kind: "object-property", object: "source", property: "might" });
  assert.equal(hit.args.target.value, "battlefield-unit");
  assert.deepEqual(hit.targets, [{ id: "battlefield-unit", filter: { type: "unit", zone: "battlefield" }, min: 1, max: 1, selection: "one" }]);
  assert.equal(hit.linkedTo, undefined);
  assert.equal(hit.condition, undefined);
});

test("Caitlyn golden subeffect: current Might damages friendly or enemy units at a different battlefield", () => {
  for (const owner of ["A", "B"]) {
    const initial = world().unit("caitlyn", { might: 4 }).unit("target", { owner, might: 10, location: { type: "battlefield", id: "remote" } }).build();
    const kernel = initial.clone({ sourceSnapshot: initial.getObject("caitlyn") });
    const target = kernel.ref("target");
    // Pass the printed Expr untouched; only the primitive's scalar target id is unwrapped.
    const run = runInstruction(damage, { amount: hit.args.amount, target: hit.args.target.value }, { world: kernel, targets: { "battlefield-unit": [target] } });
    assert.equal(run.result.status, "executed");
    assert.equal(run.linked.dealt, 4);
    assert.equal(run.linked.dealtCount, 1);
    assert.equal(kernel.getObject("target").damage, 4);
    assert.equal(kernel.getObject("caitlyn").damage, 0);
    assert.deepEqual(run.events.map(event => event.action), ["damage"]);
  }
});

test("Caitlyn golden subeffect: loss of the finalized target is ignored without damage", () => {
  const kernel = world().unit("caitlyn", { might: 3 }).build();
  const run = runInstruction(damage, { amount: hit.args.amount, target: hit.args.target.value }, { world: kernel, targets: { "battlefield-unit": [] } });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.events, []);
});

test.todo("Caitlyn: Backline lethal-last damage allocation through the continuous.combat consumer (CR 826)");
test.todo("Caitlyn: bind the at-battlefield restriction through the activation legality adapter and execute the full ability");
