import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/moonlight-affliction.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_ID =
  "card.hash-3dfe95c2b5760342ff53da5b907465cf7b0aa40a27553cfdfa36e7a449d7530b";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Give a unit -10 :rb_might: this turn.";

const [keyword, play] = program.abilities;
const [mightInstruction] = play.body;

test("unl-066-219 Moonlight Affliction: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
});

test("unl-066-219 Moonlight Affliction: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /143\.2\.a/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("unl-066-219 Moonlight Affliction: [Reaction], printed cost and one printed instruction", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(keyword.value, undefined);
  assert.equal(play.kind, "play");
  // Catalog printing: 7 energy, no printed power.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 7 }
  });
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [["moonlight-affliction.give-minus-10-might", "continuous.might"]]
  );
});

test("unl-066-219 Moonlight Affliction: 'Give a unit -10 Might this turn' targets one Board unit", () => {
  // 355.5 / 355.5.a: "a unit" is an explicit choice of one game object, so it
  // is a target; 424.1-style Board restriction is carried by the filter.
  assert.deepEqual(mightInstruction.args.target, {
    kind: "constant",
    value: "moonlight-affliction.chosen-unit"
  });
  assert.deepEqual(mightInstruction.targets, [
    {
      id: "moonlight-affliction.chosen-unit",
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(mightInstruction.linkedTo, undefined);
  assert.equal(mightInstruction.picks, undefined);
  assert.equal(mightInstruction.condition, undefined);
});

test("unl-066-219 Moonlight Affliction: the -10 is temporary, never reduced or substituted by a Buff", () => {
  // 143.2.a: the card's "Might" is the layered effective value; 143.2.c keeps a
  // Might below 0 as 0 only when referenced (and 143.2.c.1 keeps the real value
  // for later calculations); 317.2.c expires it in the end-of-turn cleanup.
  // effect.buff only adds CR 702/703 counters, so it is never used here.
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: -10 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  // The floor is a layers evaluation rule, not a card-side clamp: the printed
  // -10 stays exactly as printed, and the instruction is never effect.buff.
  assert.notEqual(mightInstruction.op, "effect.buff");
});

test("unl-066-219 Moonlight Affliction: the program carries no executable body instruction today", () => {
  // The only body op is the unmerged continuous.might instruction, so there is
  // no merged primitive to execute in the golden test — the card must not fake
  // one. This keeps the judge-required status honest rather than papering over
  // it with, say, a Buff placement.
  assert.equal(play.body.length, 1);
  assert.equal(mightInstruction.op, "continuous.might");
});

test.todo(
  "unl-066-219 Moonlight Affliction: 'Give a unit -10 [M] this turn' needs the card-facing " +
    "continuous.might instruction (resolution-time ctx.addContinuous with an end-of-turn duration); " +
    "contract 3.6's closed GameAction set has no Might-modification action — RIFT-91 follow-up"
);

test.todo(
  "unl-066-219 Moonlight Affliction: the Might floor of 143.2.c ('treated as 0 when referenced, but not 0', " +
    "143.2.c.1) belongs to the layers arithmetic evaluation, not to this card's data"
);

test.todo(
  "unl-066-219 Moonlight Affliction: [Reaction] (CR 813) needs the continuous.timing consumer and " +
    "chain canAct wiring (RIFT-85 / RIFT-91) — declared only"
);
