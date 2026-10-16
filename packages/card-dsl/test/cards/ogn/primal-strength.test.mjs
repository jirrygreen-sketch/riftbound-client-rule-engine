import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import primalStrength from "../../../dist/cards/ogn/primal-strength.js";

const [speed, play] = primalStrength.abilities;
const [mightInstruction] = play.body;

test("Primal Strength program is structurally valid and judge-required", () => {
  const result = validateCardProgram(primalStrength);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(primalStrength.status, "judge-required");
  assert.match(primalStrength.judgeReason, /continuous\.might/);
  assert.match(primalStrength.judgeReason, /effect\.buff/);
  assert.equal(primalStrength.rulesetVersion, "core-1.5");
  assert.equal(
    primalStrength.canonicalCardId,
    "card.hash-973d0d5d514cd0b81080d51a93fd58adb4be5b542b6ac111f49c4202d30e1abf"
  );
  assert.equal(
    primalStrength.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Give a unit +7 :rb_might: this turn."
  );
});

test("Primal Strength structure: [Action] keyword + one-unit +7 Might target", () => {
  assert.equal(primalStrength.abilities.length, 2);
  // [Action] (806) is a speed keyword ability expanded by the keyword registry.
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);

  // "Give a unit +7 [M] this turn": printed amount and duration.
  assert.equal(mightInstruction.id, "primal-strength.give-plus-7");
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: 7 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });

  // "a unit" is a target on the board (355.9.a.1), so the instruction carries
  // exactly one one-unit TargetSpec.
  assert.equal(mightInstruction.targets.length, 1);
  assert.equal(mightInstruction.targets[0].id, "primal-strength.unit");
  assert.deepEqual(mightInstruction.targets[0].filter, { type: "unit", zone: "board" });
  assert.equal(mightInstruction.targets[0].selection, "one");
  // Exactly one unit: min = max = 1.
  assert.equal(mightInstruction.targets[0].min, 1);
  assert.equal(mightInstruction.targets[0].max, 1);
  assert.equal(mightInstruction.picks, undefined);
  // The instruction is not linkedTo anything: it is the whole effect.
  assert.equal(mightInstruction.linkedTo, undefined);
  assert.equal(mightInstruction.condition, undefined);
});

test("Primal Strength: the printed +7 is not approximated with Buff counters", () => {
  // CR 702/703: a Buff is a +1 Might COUNTER, not a temporary Might
  // modification. The program must not use the merged effect.buff to stand in
  // for the printed +7, and must not use the "effect.might-modify" spelling
  // that has no registered instruction file.
  assert.equal(mightInstruction.op, "continuous.might");
  assert.notEqual(mightInstruction.op, "effect.buff");
  assert.notEqual(mightInstruction.op, "effect.might-modify");
  assert.equal(mightInstruction.args.mode, undefined);
});

test.todo(
  "Primal Strength execution: a continuous.might instruction primitive must register " +
    "the +7 Might through ctx.addContinuous for the layers arithmetic pass, expiring at " +
    "cleanup for 'this turn' (CR 703/706-708, RIFT-91 layers are merged; the " +
    "instruction primitive is missing)"
);

test.todo(
  "Primal Strength cast: pays 4 Energy + 1 Body power and [Action] showdown timing " +
    "(依赖 RIFT-89 费用管线与 continuous.timing 生产接线)"
);

