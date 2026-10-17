import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/lee-sin-ascetic.js";


test("ogn-078-298: identity, exact source text, pure data and explicit blocked status", () => {
  const validation = validateCardProgram(program);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  assert.deepEqual(validation.issues, []);
  assert.equal(program.canonicalCardId, "card.hash-cc6ad3795219f298711ebf12535a88b5542ad11cc99575a77634de551464784e");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /effect.buff|427.1.b.2/);
  assert.match(program.judgeReason, /ObjectSnapshot|combatRole/);
  assert.equal(program.sourceText, "[Shield] (+1 :rb_might: while I'm a defender.)\n:rb_exhaust:: Buff me. (I get a +1 :rb_might: buff.)\nI can have any number of buffs.");
  assert.deepEqual(JSON.parse(JSON.stringify(program)), program);
});

test("Lee Sin: Shield declaration and action-speed self Buff with exhaust as a cost", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "shield" });
  const activated = program.abilities[1];
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost, { payments: [{ kind: "exhaust", object: "self" }] });
  assert.equal(activated.body.length, 1);
  assert.equal(activated.body[0].op, "effect.buff");
  assert.deepEqual(activated.body[0].args, { mode: { kind: "constant", value: "buff" }, objects: { kind: "constant", value: "self" } });
  // "Me" is not a target or a made-up pick (CR 355.10.d).
  assert.equal(activated.body[0].targets, undefined);
  assert.equal(activated.body[0].picks, undefined);
});

test("Lee Sin: explicitly declare an unlimited self Buff capacity, rather than a large finite amount", () => {
  const permission = program.abilities[2];
  assert.equal(permission.kind, "static");
  assert.deepEqual(permission.effect, { kind: "continuous.restrict", action: "buff", filter: { object: "self" }, maximum: null });
  assert.equal(permission.condition, undefined);
  assert.match(program.judgeReason, /已有 Buff|702\.3\.a/);
});

test.todo("Lee Sin: first self Buff via a non-target ObjectSelector, with real exhaust payment; effect.buff currently requires a TargetSpec id");
test.todo("Lee Sin: second and subsequent Buffs through the same primitive after consuming unlimited-Buff permission; current unconditional skip must be removed upstream (CR 427.1.b.2)");
test.todo("Lee Sin: Shield defender Might using the ObjectSnapshot combatRole predicate (CR 814)");
