import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/whiteflame-protector.js";


test("ogn-082-298: identity, exact source text, pure data and explicit blocked status", () => {
  const validation = validateCardProgram(program);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  assert.deepEqual(validation.issues, []);
  assert.equal(program.canonicalCardId, "card.hash-b9737e97366888566c3b22952ffcbbb0194dfeed8bd919f0e724f6d93433206e");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous.might|RIFT-91/);
  assert.match(program.judgeReason, /RIFT-/);
  assert.equal(program.sourceText, "When you play me, give a unit +8 :rb_might: this turn.");
  assert.deepEqual(JSON.parse(JSON.stringify(program)), program);
});

test("Whiteflame Protector: one mandatory self play trigger", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.deepEqual(ability.trigger, { at: "card-played", filter: { object: "self" } });
  assert.equal(ability.optional, false);
  assert.equal(ability.body.length, 1);
});

test("Whiteflame Protector: give any single unit +8 Might until turn end without adding Buff counters", () => {
  const [instruction] = program.abilities[0].body;
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args, { target: { kind: "constant", value: "unit" }, amount: { kind: "constant", value: 8 }, duration: { kind: "constant", value: "end-of-turn" } });
  assert.deepEqual(instruction.targets, [{ id: "unit", filter: { type: "unit", zone: "board" }, min: 1, max: 1, selection: "one" }]);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.condition, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test.todo("Whiteflame Protector: original body installs a real targeted +8 Might effect, including self/enemy targets and mistargeting (continuous.might instruction/adapter RIFT-1/91/120)");
test.todo("Whiteflame Protector: +8 persists after the source leaves and expires at this turn's actual cleanup; Buff count stays unchanged (RIFT-91 continuous duration bridge)");
