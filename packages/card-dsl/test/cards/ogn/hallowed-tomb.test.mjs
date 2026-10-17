import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/hallowed-tomb.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const [ability] = program.abilities;
const [choice] = ability.body;
const [instruction] = choice.args.body.value;

test("ogn-281-298 Hallowed Tomb: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("ogn-281-298 Hallowed Tomb: identity, ruleset, status and printed text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-92c11a0988b326e10a408e7574612b504d23ae5df1697436070ec33c5d1e6a70"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // deck-catalog.json (ogn-281-298) carries this text verbatim.
  assert.equal(
    program.sourceText,
    "When you hold here, you may return your Chosen Champion from your trash to your Champion Zone if it is empty."
  );
  assert.match(program.judgeReason, /Champion Zone/);
  assert.match(program.judgeReason, /count\/compare/);
  assert.match(program.judgeReason, /here/);
});

test("ogn-281-298 Hallowed Tomb: optional hold trigger wrapping the return instruction", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // CR 383.4.d.1 / 383.4.d.2.b: "When you hold here" is this battlefield's
  // controller holding here (timing point "hold", CR 315.2.b.2 / 471.2 / 473.2.b).
  assert.equal(ability.trigger.at, "hold");
  assert.deepEqual(ability.trigger.filter, { event: "hold", here: true, player: "controller" });
  // "you may …" (contract 3.1 `optional`).
  assert.equal(ability.optional, true);

  // Contract 3.9: the selected instructions live inside the optional body;
  // there is no choice-plus-linkedTo shape.
  assert.equal(ability.body.length, 1);
  assert.equal(choice.id, "hallowed-tomb.opt-in");
  assert.equal(choice.op, "choice.optional");
  assert.equal(choice.args.body.kind, "constant");
  assert.equal(choice.linkedTo, undefined);
  assert.deepEqual(choice.args.body.value.map(entry => entry.id), ["hallowed-tomb.return-champion"]);
});

test("ogn-281-298 Hallowed Tomb: the return targets the Chosen Champion in the controller's trash", () => {
  assert.equal(instruction.op, "effect.zone");
  assert.deepEqual(instruction.args.target, { kind: "constant", value: "chosen-champion-in-trash" });
  // CR 108.3.c.1 requires the Champion Zone to be empty for the return; the
  // condition belongs to this instruction (contract 3.4: a condition clause
  // only scopes the instruction that owns it).
  assert.equal(instruction.condition.kind, "compare");
  assert.equal(instruction.condition.operator, "eq");
  assert.equal(instruction.condition.left.kind, "count");
  assert.deepEqual(instruction.condition.left.filter, { zone: "champion-zone", owner: "controller" });
  assert.deepEqual(instruction.condition.right, { kind: "constant", value: 0 });

  assert.equal(instruction.targets.length, 1);
  const [target] = instruction.targets;
  assert.equal(target.id, "chosen-champion-in-trash");
  // CR 108.2.d / 108.3.e: both zones are public, so the card is a target
  // (355.10.a/355.10.a.1) and is revalidated when the ability resolves.
  assert.deepEqual(target.filter, {
    type: "unit",
    zone: "trash",
    owner: "controller",
    chosenChampion: true
  });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
  assert.equal(instruction.picks, undefined);
});

test("ogn-281-298 Hallowed Tomb: unresolved contract pieces remain explicit in the IR", () => {
  // Keep each unsupported rule element visible in the card data so it can be
  // wired to the corresponding engine contract without changing the printing.
  assert.equal(instruction.args.to.value, "champion-zone");
  assert.equal(instruction.targets[0].filter.chosenChampion, true);
  assert.equal(instruction.condition.left.filter.zone, "champion-zone");
  assert.match(program.judgeReason, /Champion Zone/);
});

test.todo(
  "ogn-281-298 Hallowed Tomb: the return needs champion-zone in ZoneId/ZoneDestination (contract " +
    "change request; effect.exhaust.ts records the same gap for legend-zone/champion-zone)"
);

test.todo(
  "ogn-281-298 Hallowed Tomb: restricting the target to the Chosen Champion needs a chosen-champion " +
    "object predicate (CR 103.3.a.3), which ObjectFilter lacks"
);

test.todo(
  "ogn-281-298 Hallowed Tomb: 'if it is empty' (CR 108.3.c.1) needs Champion Zone support for the existing count/compare query; the " +
    "hold event's `here` relation also needs an adapter that binds the scoring event's battlefield identity " +
    "to this source"
);
