import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/twilight-step.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";

const CARD_ID = "card.hash-f8d896c2ca5339609e26be4f09c5f2b54a57e4cae02b10efbb3319f94414f084";
const SOURCE_TEXT =
  "Move a unit with 3 :rb_might: or less.\n" +
  "[Flow] :rb_energy_4::rb_rune_chaos: (You may play this from your trash for its Flow cost. Then banish it.)";

const [flowKeyword, play] = program.abilities;
const [moveUnit] = play.body;
const [unitSpec] = moveUnit.targets;

test("ven-105-166 Twilight Step: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-105-166 Twilight Step: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-105-166 Twilight Step: judgeReason names the Might predicate, destination and Flow gaps", () => {
  assert.match(program.judgeReason, /mightLte/);
  assert.match(program.judgeReason, /143\.2\.a/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.match(program.judgeReason, /355\.4/);
  assert.match(program.judgeReason, /RIFT-357/);
  assert.match(program.judgeReason, /Flow/);
  assert.doesNotMatch(program.judgeReason, /RIFT-83|RIFT-90|RIFT-260|RIFT-261/);
  assert.match(program.judgeReason, /不近似实现/);
});

test("ven-105-166 Twilight Step: [Flow] keyword, printed cost and one Move instruction", () => {
  assert.equal(program.abilities.length, 2);
  // 829.1.a / 829.1.c.1: Flow is a passive keyword on Spells; only the identity
  // is declared (README section 5, the printed cost belongs to Flow.ts).
  assert.deepEqual(flowKeyword, { kind: "keyword", keyword: "flow" });

  assert.equal(play.kind, "play");
  // Printed 2 Energy + 1 Chaos Power (catalog energy=2, power=1, domains ["Chaos"]).
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
    ["twilight-step.move-unit", "effect.move"]
  ]);

  // 448.1 / 355.4: one Board unit is moved by the effect; the destination is a
  // valid Location chosen at Finalize, which no merged reader produces today.
  assert.deepEqual(moveUnit.args.objects, {
    kind: "constant",
    value: { target: "twilight-step.unit" }
  });
  assert.deepEqual(moveUnit.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(moveUnit.args.linkKey, { kind: "constant", value: "moved" });
  assert.equal(moveUnit.linkedTo, undefined);
  assert.equal(moveUnit.picks, undefined);
  // The destination is the legal-destination descriptor no merged reader can
  // materialize (judgeReason), not a concrete base or battlefield LocationRef.
  assert.deepEqual(moveUnit.args.to, {
    kind: "constant",
    value: { kind: "query", id: "twilight-step.valid-destinations" }
  });

  // 355.7 / 355.9.a.1 / 355.9.b: "a unit with 3 Might or less" is one target
  // whose Might ceiling is a targeting restriction; the descriptive mightLte key
  // has no consumer yet (judgeReason).
  assert.deepEqual(unitSpec, {
    id: "twilight-step.unit",
    filter: { type: "unit", zone: "board", mightLte: 3 },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("ven-105-166 Twilight Step: the merged Move instruction is what the card calls for", () => {
  // The instruction names the merged effect.move primitive; what the card still
  // needs is the legal-destination reader named in judgeReason, not a different
  // primitive.
  assert.equal(instructionDefinitionsById.has("effect.move"), true);
  assert.deepEqual(moveUnit.args.objects.value, { target: "twilight-step.unit" });
});

test.todo(
  "ven-105-166 Twilight Step: enforce the 'Might 3 or less' targeting restriction with effective Might " +
    "(CR 143.2.a / 355.9.b) — needs the effective-Might predicate and condition wiring (RIFT-359); unknown filter keys are " +
    "silently ignored today, which would make every unit a legal target"
);

test.todo(
  "ven-105-166 Twilight Step: choose a valid destination for the moved unit at Finalize (CR 355.4 / " +
    "355.4.a) — needs the legal-destination set reader wired into the target plan (RIFT-357); effect.move's " +
    "choose form requires concrete LocationRefs that static IR cannot write"
);

test.todo(
  "ven-105-166 Twilight Step: play this from Trash for its printed Flow cost (:rb_energy_4::rb_rune_chaos:) " +
    "and banish it afterwards (CR 829.1 / 829.1.b / 829.1.c.1) — needs the Flow alternate-cost consumer " +
    "and replacement/banish path"
);
