import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/upstage-comedy.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-f114e7d87a034d2ab43ead3320c3723924539deedb6f03584549c1f824a5c6c5";
const SOURCE_TEXT =
  "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Ready a unit.";

const [repeatKeyword, play] = program.abilities;
const [readyUnit] = play.body;
const UNIT = "upstage-comedy.unit";

test("unl-009-219 Upstage Comedy: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-009-219 Upstage Comedy: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Repeat/);
  assert.match(program.judgeReason, /820\.1\.d\.1/);
  assert.match(program.judgeReason, /RIFT-86/);
  assert.match(program.judgeReason, /RIFT-89/);
});

test("unl-009-219 Upstage Comedy: the printed [Repeat] keyword is declared, not re-implemented", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(repeatKeyword, { kind: "keyword", keyword: "repeat" });
  assert.equal(repeatKeyword.value, undefined);
  // README section 5: the keyword is declared only; its expansion belongs to
  // effects/keywords/Repeat.ts. No fixed-count repeat instruction carries the
  // unmerged payment hook, and the printed cost is not folded into the base cost.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 }
  });
  assert.equal(Object.hasOwn(play.cost, "power"), false);
  assert.deepEqual(play.body.map(instruction => instruction.op), ["effect.ready"]);
});

test("unl-009-219 Upstage Comedy: 'Ready a unit' is a targeted ready of one Board unit", () => {
  assert.equal(readyUnit.id, "upstage-comedy.ready-unit");
  assert.deepEqual(readyUnit.args.objects, {
    kind: "constant",
    value: { kind: "target", id: UNIT }
  });
  assert.deepEqual(readyUnit.args.amount, { kind: "constant", value: 1 });
  assert.equal(readyUnit.linkedTo, undefined);
  assert.equal(readyUnit.picks, undefined);
  assert.deepEqual(readyUnit.targets, [
    {
      id: UNIT,
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("unl-009-219 Upstage Comedy golden: readying an exhausted unit goes through the interpreter", () => {
  const kernel = world().unit("exhausted-unit", { exhausted: true }).build();
  kernel.setTargets(UNIT, [kernel.ref("exhausted-unit")]);
  const outcome = runAbilityBody(play.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("exhausted-unit").exhausted, false);
  assert.deepEqual(outcome.events.map(event => event.action), ["ready"]);
  assert.equal(outcome.results[0].result.linkedValues.readied.count, 1);
});

test("unl-009-219 Upstage Comedy golden: an already-ready unit is a legal no-op (416.1.b)", () => {
  const kernel = world().unit("ready-unit", { exhausted: false }).build();
  kernel.setTargets(UNIT, [kernel.ref("ready-unit")]);
  const outcome = runAbilityBody(play.body, kernel);
  // 416.1.b: a Unit that is already Ready cannot be Readied again — nothing
  // additional happens and no ready action is submitted, but the instruction
  // still counts as executed with a zero result.
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.events, []);
  assert.equal(kernel.getObject("ready-unit").exhausted, false);
});

test("unl-009-219 Upstage Comedy golden: a stale target is ignored (359.3.e.7)", () => {
  const kernel = world().unit("leaving-unit", { exhausted: true }).build();
  const stale = kernel.ref("leaving-unit");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  kernel.setTargets(UNIT, [stale]);
  const outcome = runAbilityBody(play.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
});

test.todo("unl-009-219 Upstage Comedy: paying the printed Repeat cost (:rb_energy_2:) executes the spell's effect one additional time during resolution (820.1.d.1 / 820.2.a) and re-makes the choice — needs the Repeat additional-cost payment hook and the paid-instance count on the interpreter repeat instruction (RIFT-86 / RIFT-89)");
test.todo("unl-009-219 Upstage Comedy: 820.3.a — repeating the effect must not play the spell a second time (no additional card-played timing point), which the paid-instance pipeline has to guarantee (RIFT-86 / RIFT-89)");

