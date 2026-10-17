import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/smite.js";
import banish from "../../../../engine-core/dist/effects/instructions/effect.banish.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-f2df74bd99eb5d2087462817264a1b9f0becc96353a67b98a7401ca7e5a5109a";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Deal 3 to a unit at a battlefield. If it would die this turn, banish it instead.";

const [speed, play] = program.abilities;
const [dealThree, banishInstead] = play.body;
const banishInstruction = banishInstead.args.instead.value[0];
const UNIT = "smite.unit";

test("unl-007-219 Smite: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-007-219 Smite: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /replacement\.event/);
  assert.match(program.judgeReason, /369\.1/);
  assert.match(program.judgeReason, /能力级|replacement registry/);
});

test("unl-007-219 Smite: [Action] plus a battlefield-restricted damage target", () => {
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
    ["smite.deal-3", "effect.damage"],
    ["smite.banish-instead", "replacement.event"]
  ]);

  // 418.1 / 355.10.b: the unit is the target; "at a battlefield" only restricts it.
  assert.deepEqual(dealThree.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(dealThree.args.target, { kind: "constant", value: UNIT });
  assert.deepEqual(dealThree.targets, [
    {
      id: UNIT,
      filter: { type: "unit", zone: "board", location: { type: "battlefield" } },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // 369.1 / 370.1.b: the death-replacement shape references the same TargetSpec,
  // and its instead-body banishes that unit (428.1).
  assert.deepEqual(banishInstead.args.event, { kind: "constant", value: "object-killed" });
  assert.deepEqual(banishInstead.args.window, { kind: "constant", value: "this-turn" });
  assert.deepEqual(banishInstead.args.object, { kind: "constant", value: { target: UNIT } });
  assert.equal(banishInstead.linkedTo, undefined);
  assert.equal(banishInstruction.op, "effect.banish");
  assert.deepEqual(banishInstruction.args.objects, {
    kind: "constant",
    value: { target: UNIT }
  });
});

test("unl-007-219 Smite golden: Deal 3 marks 3 damage on the locked battlefield unit", () => {
  const kernel = world()
    .unit("battlefield-unit", { might: 4, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const run = runInstruction(
    damage,
    { amount: dealThree.args.amount, target: UNIT },
    { world: kernel, targets: { [UNIT]: [kernel.ref("battlefield-unit")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("battlefield-unit").damage, 3);
  assert.equal(run.linked.dealt, 3);
  assert.deepEqual(run.events.map(event => event.action), ["damage"]);
});

test("unl-007-219 Smite golden: a stale battlefield target is ignored, so no damage is dealt", () => {
  const kernel = world().unit("battlefield-unit", { might: 4 }).build();
  const stale = kernel.ref("battlefield-unit");
  assert.equal(kernel.perform({ type: "move-zone", object: stale, to: "hand" }).status, "done");
  const run = runInstruction(
    damage,
    { amount: dealThree.args.amount, target: UNIT },
    { world: kernel, targets: { [UNIT]: [stale] } }
  );
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

test("unl-007-219 Smite golden: the instead-body banishes the unit through the real primitive", () => {
  const kernel = world().unit("doomed-unit", { might: 2 }).build();
  const run = runInstruction(
    banish,
    { objects: banishInstruction.args.objects },
    { world: kernel, targets: { [UNIT]: [kernel.ref("doomed-unit")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("doomed-unit").zone, "banishment");
  assert.equal(run.linked.banishedCount, 1);
  assert.deepEqual(run.events.map(event => event.action), ["banish"]);
});

test.todo("unl-007-219 Smite: install the for-this-turn death replacement (CR 369.1 / 370.1.b) so the chosen unit is banished instead of dying — move the declaration into the ability-level replacement lifecycle, bind the chosen unit, and plan effect.banish");

