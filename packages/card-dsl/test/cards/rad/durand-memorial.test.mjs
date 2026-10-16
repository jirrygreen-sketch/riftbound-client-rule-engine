import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/durand-memorial.js";

const CANONICAL =
  "card.hash-97d6652832570169cee7f8ada60deed43c5e7d3c133950eed2de4fe1f0818f76";
const [trigger] = program.abilities;

test("durand-memorial: passes validateCardProgram and carries the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "When you defend here, choose a unit you control here. Give it [Tank] this combat. (It must be assigned combat damage first.)"
  );
});

test("durand-memorial: judgeReason names the continuous keyword grant and the damage assignment gap", () => {
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /815\.1\.c/);
});

test("durand-memorial: defense-declared trigger at this battlefield", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(trigger.kind, "triggered");
  assert.equal(trigger.trigger.at, "defense-declared");
  assert.equal(trigger.trigger.filter.event, "defense-declared");
  assert.equal(trigger.trigger.filter.here, true);
  // "you defend" — the merged PlayerSelector spelling for the ability
  // controller is "self".
  assert.equal(trigger.trigger.filter.player, "self");
  assert.equal(trigger.optional, false);
});

test("durand-memorial: the chosen unit is a target, not a pick", () => {
  // 355.5 / 355.7 / 355.10: "choose a unit you control here" is made during
  // Finalize and is not a cost, trigger condition or replacement effect, so it
  // is Targeted. Using a pick would silently skip became-target triggers.
  assert.equal(trigger.body.length, 1);
  const [instruction] = trigger.body;
  assert.equal(instruction.id, "durand-memorial.grant-tank");
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.targets.length, 1);
  const [target] = instruction.targets;
  assert.equal(target.id, "durand-memorial.chosen-unit");
  assert.equal(target.selection, "one");
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.deepEqual(target.filter, { type: "unit", controller: "self", here: true });
});

test("durand-memorial: the grant is the pending continuous.grant-keyword shape with a combat duration", () => {
  const [instruction] = trigger.body;
  // No merged primitive registers a continuous effect, so the op must stay the
  // pending continuous.grant-keyword shape (815.1.b / 815.2 / 815.3) rather
  // than being approximated with a Buff counter or a static Might change.
  assert.equal(instruction.op, "continuous.grant-keyword");
  assert.deepEqual(instruction.args.keyword, { kind: "constant", value: "Tank" });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "end-of-combat" });
});

test("durand-memorial: the body declares exactly one pending continuous keyword grant", () => {
  // Guards the judgeReason: if a merged primitive starts registering
  // continuous effects, this assertion and the status must be revisited
  // together.
  const ops = program.abilities
    .flatMap((ability) => (ability.kind === "triggered" ? ability.body : []))
    .map((instruction) => instruction.op);
  assert.deepEqual(ops, ["continuous.grant-keyword"]);
});

test.todo(
  "durand-memorial: give the chosen unit [Tank] until end of combat " +
    "(needs a merged continuous keyword grant; RIFT-91 layers-continuous)"
);
test.todo(
  "durand-memorial: Tank assignment priority in the Combat Damage step " +
    "(815.1.c.1 / 815.1.c.2; base-combat-allocation.ts binds no assignment-priority requirement)"
);
test.todo(
  "durand-memorial: defense-declared timing wiring plus the here-scoped target filter " +
    "(323.2 / 383.4.f / 466.2.c)"
);
