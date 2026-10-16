import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/friendship.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_ID =
  "card.hash-380c1a7758d95d28f1a1ab46065c44a878dd909f52f43900cdf66c7669153512";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Choose a unit. Give it +1 :rb_might: this turn for each of the following tags " +
  "among your units — Bird, Cat, Dog, and Poro.";

const [keyword, play] = program.abilities;
const [mightInstruction] = play.body;
const [chosenUnit] = mightInstruction.targets;

test("unl-046-219 Friendship: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
});

test("unl-046-219 Friendship: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("unl-046-219 Friendship: [Reaction], printed cost and one printed instruction", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(keyword.value, undefined);
  assert.equal(play.kind, "play");
  // Catalog printing: 1 energy, no printed power.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 1 }
  });
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [["friendship.grant-might", "continuous.might"]]
  );
});

test("unl-046-219 Friendship: 'Choose a unit' is one targeted Board unit", () => {
  // 355.5 / 355.7: "Choose a unit" names one specific game object, so it is a
  // target (min = max = 1, selection "one") — not an each-set.
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.target, {
    kind: "constant",
    value: "friendship.chosen-unit"
  });
  assert.deepEqual(mightInstruction.targets, [
    {
      id: "friendship.chosen-unit",
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(chosenUnit.id, "friendship.chosen-unit");
  assert.equal(mightInstruction.linkedTo, undefined);
  assert.equal(mightInstruction.picks, undefined);
});

test("unl-046-219 Friendship: the +1 Might is temporary (this turn), never a Buff counter", () => {
  // 143.2.a / 317.2.c: "Might" is the layered effective value and "this turn"
  // expires in the end-of-turn cleanup; 702 Buffs are a different game object,
  // which is why the instruction is continuous.might and not effect.buff.
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(mightInstruction.op, "continuous.might");
  assert.notEqual(mightInstruction.op, "effect.buff");
});

test("unl-046-219 Friendship: the amount is the printed per-tag shape, not a unit count", () => {
  // "+1 for each of the following tags among your units — Bird, Cat, Dog, and
  // Poro": the multiplier counts the listed tags that appear among your units
  // (at most 4), not units. The merged IR has no such set predicate, so the
  // description stays explicit and deliberately is not written as a unit count.
  assert.deepEqual(mightInstruction.args.amount, {
    kind: "constant",
    value: {
      kind: "per-matching-tag",
      amountPerTag: 1,
      tags: ["Bird", "Cat", "Dog", "Poro"],
      among: { type: "unit", controller: "controller", zone: "board" }
    }
  });
  const amount = mightInstruction.args.amount.value;
  assert.equal(amount.amountPerTag, 1);
  assert.deepEqual(amount.tags, ["Bird", "Cat", "Dog", "Poro"]);
  // The scope is *your* units: the ability controller's Board units.
  assert.deepEqual(amount.among, { type: "unit", controller: "controller", zone: "board" });
});

test.todo(
  "unl-046-219 Friendship: 'Give it +1 [M] this turn' needs the card-facing continuous.might " +
    "instruction (a resolution-time ctx.addContinuous registration with an end-of-turn duration); " +
    "contract 3.6's closed GameAction set has no Might-modification action and effect.buff only adds " +
    "CR 702/703 Buff counters — RIFT-91 follow-up"
);

test.todo(
  "unl-046-219 Friendship: 'for each of the following tags among your units — Bird, Cat, Dog, and " +
    "Poro' needs a set predicate counting which listed tags occur among your units; the merged count " +
    "expression only counts objects matching an ObjectFilter"
);

test.todo(
  "unl-046-219 Friendship: [Reaction] (CR 813) needs the continuous.timing consumer and chain canAct " +
    "wiring (RIFT-85 / RIFT-91); the keyword is declared only"
);
