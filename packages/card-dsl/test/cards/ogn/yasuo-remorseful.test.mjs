import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/yasuo-remorseful.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";


test("ogn-076-298: identity, exact source text, pure data and explicit blocked status", () => {
  const validation = validateCardProgram(program);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  assert.deepEqual(validation.issues, []);
  assert.equal(program.canonicalCardId, "card.hash-751e2b1c16ab2529b3d0bf37e5309cfde9a7b41589d08799cf53a9a8ef42e5e8");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /amount|here/);
  assert.match(program.judgeReason, /RIFT-/);
  assert.equal(program.sourceText, "When I attack, deal damage equal to my Might to an enemy unit here.");
  assert.deepEqual(JSON.parse(JSON.stringify(program)), program);
});

const [attack] = program.abilities;
const hit = attack.body[0];

test("Yasuo: mandatory attack trigger fires only on the host's first attacker designation each combat", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(attack.kind, "triggered");
  assert.deepEqual(attack.trigger, { at: "attack-declared", filter: { object: "self" }, once: "per-combat" });
  assert.equal(attack.optional, false);
  assert.equal(attack.body.length, 1);
});

test("Yasuo: dynamic source Might damages exactly one enemy here, without artificial linking", () => {
  assert.equal(hit.op, "effect.damage");
  assert.deepEqual(hit.args.amount, { kind: "object-property", object: "source", property: "might" });
  assert.equal(hit.args.target.value, "enemy-here");
  assert.deepEqual(hit.targets, [{ id: "enemy-here", filter: { type: "unit", zone: "board", controller: "opponent", sameLocationAs: "source" }, min: 1, max: 1, selection: "one" }]);
  assert.equal(hit.linkedTo, undefined);
  assert.equal(hit.condition, undefined);
});

test("Yasuo golden subeffect: damage uses current Might, not the printed six", () => {
  const initial = world().unit("yasuo", { might: 7 }).unit("enemy", { owner: "B", might: 10 }).build();
  const kernel = initial.clone({ sourceSnapshot: initial.getObject("yasuo") });
  const enemy = kernel.ref("enemy");
  const run = runInstruction(damage, { amount: hit.args.amount, target: hit.args.target.value }, { world: kernel, targets: { "enemy-here": [enemy] } });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 7);
  assert.deepEqual(run.linked.dealtTo, [{ target: enemy, amount: 7 }]);
  assert.equal(kernel.getObject("enemy").damage, 7);
  assert.equal(kernel.getObject("yasuo").damage, 0);
  assert.deepEqual(run.events.map(event => event.action), ["damage"]);
});

test("Yasuo golden subeffect: an unavailable finalized target causes ignored, not damage to another unit", () => {
  const kernel = world().unit("yasuo", { might: 6 }).unit("other-enemy", { owner: "B", might: 10 }).build();
  const run = runInstruction(damage, { amount: hit.args.amount, target: hit.args.target.value }, { world: kernel, targets: { "enemy-here": [] } });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("other-enemy").damage, 0);
  assert.deepEqual(run.events, []);
});

test.todo("Yasuo: original body and actual attack -> Pending -> Finalize -> Resolve with opponent/here binding, lost targets and once-per-combat reattack guard (CR 383.4.e; RIFT-1/120)");
