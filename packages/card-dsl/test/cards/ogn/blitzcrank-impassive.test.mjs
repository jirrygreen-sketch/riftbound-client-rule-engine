import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/blitzcrank-impassive.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";


test("ogn-067-298: identity, exact source text, pure data and explicit blocked status", () => {
  const validation = validateCardProgram(program);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  assert.deepEqual(validation.issues, []);
  assert.equal(program.canonicalCardId, "card.hash-bee1f175cdca184a24a8807736a261b1b06bcc189438914248f9b1fba6eade3b");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Tank|effect.zone/);
  assert.match(program.judgeReason, /RIFT-/);
  assert.equal(program.sourceText, "[Tank] (I must be assigned combat damage first.)\nWhen you play me to a battlefield, you may move an enemy unit to here.\nWhen I hold, return me to my owner's hand.");
  assert.deepEqual(JSON.parse(JSON.stringify(program)), program);
});

const [tank, played, held] = program.abilities;
const mayMove = played.body[0];
const moveEnemy = mayMove.args.body.value[0];
const HERE = { type: "battlefield", id: "blitz-field" };

test("Blitzcrank: Tank, battlefield-only play trigger and correctly nested optional move", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(tank, { kind: "keyword", keyword: "tank" });
  assert.equal(played.kind, "triggered");
  assert.deepEqual(played.trigger, { at: "card-played", filter: { object: "self", zone: "battlefield" } });
  assert.equal(played.optional, false);
  assert.equal(played.body.length, 1);
  assert.equal(mayMove.op, "choice.optional");
  assert.equal(mayMove.args.body.value.length, 1);
  assert.equal(moveEnemy.op, "effect.move");
  assert.deepEqual(moveEnemy.args.objects.value, { target: "enemy-unit" });
  assert.deepEqual(moveEnemy.args.to, { kind: "object-property", object: "source", property: "location" });
  assert.equal(moveEnemy.args.amount.value, 1);
  assert.deepEqual(moveEnemy.targets, [{ id: "enemy-unit", filter: { type: "unit", zone: "board", controller: "opponent" }, min: 1, max: 1, selection: "one" }]);
  assert.equal(mayMove.linkedTo, undefined);
  assert.equal(moveEnemy.linkedTo, undefined);
});

test("Blitzcrank: Hold returns the host to its owner's hand without inventing a target", () => {
  assert.equal(held.kind, "triggered");
  assert.deepEqual(held.trigger, { at: "hold", filter: { object: "self" } });
  assert.equal(held.optional, false);
  assert.equal(held.body.length, 1);
  assert.equal(held.body[0].op, "effect.zone");
  assert.deepEqual(held.body[0].args, { objects: { kind: "constant", value: "self" }, to: { kind: "constant", value: "hand" } });
  assert.equal(held.body[0].targets, undefined);
  assert.equal(held.body[0].picks, undefined);
});

test("Blitzcrank golden subeffect: declining the original optional body performs no move", () => {
  const kernel = world().unit("blitz", { might: 5, location: HERE }).base("enemy", { owner: "B" }).build();
  kernel.setAnswers({ "may-move/optional": false });
  const outcome = runAbilityBody(played.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results.length, 1);
  assert.deepEqual(outcome.results[0].result, { status: "negated", reason: "skipped", events: [] });
  assert.deepEqual(outcome.events, []);
  assert.deepEqual(kernel.getObject("enemy").location, { type: "base", player: "B" });
});

test("Blitzcrank golden subeffect: real Move primitive brings the finalized enemy to the source location", () => {
  const kernel = world().unit("blitz", { might: 5, location: HERE }).base("enemy", { owner: "B", exhausted: true }).build();
  const enemy = kernel.ref("enemy");
  // The primitive's pre-evaluation schema currently requires a runtime-ref Expr.
  // Bind the real source ref only at this runtime boundary; static IR stays symbolic.
  const run = runInstruction(move, {
    ...moveEnemy.args,
    to: { ...moveEnemy.args.to, object: kernel.ref("blitz") }
  }, { world: kernel, targets: { "enemy-unit": [enemy] } });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved.count, 1);
  assert.deepEqual(run.linked.moved.objects, [enemy]);
  assert.deepEqual(kernel.getObject("enemy").location, HERE);
  assert.equal(kernel.getObject("enemy").exhausted, true);
  assert.deepEqual(kernel.ref("enemy"), enemy);
  assert.deepEqual(run.events.map(event => event.action), ["move-location"]);
});

test.todo("Blitzcrank: accept the original optional body after effect.move Expr/evaluated-args and relative-enemy filter binding align (RIFT-1/67/120)");
test.todo("Blitzcrank: Tank lethal-first allocation, including multiple Tank units (CR 815; RIFT-91)");
test.todo("Blitzcrank: real self Hold trigger and non-target self return to OWNER under changed control; effect.zone lacks self selector (RIFT-1/67/120)");
