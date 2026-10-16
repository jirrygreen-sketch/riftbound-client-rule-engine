import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/fading-memories.js";

const CARD_ID = "card.hash-14d6255fe1976a488bb687562e989583b5f23cc0d020651042bf3573f790809b";
const play = program.abilities[0];
const [grantInstruction] = play.body;
const [targetSpec] = grantInstruction.targets;

test("ogn-180-298 Fading Memories: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Temporary/);
  assert.match(program.judgeReason, /816\.1\.b/);
  assert.equal(
    program.sourceText,
    "Give a unit at a battlefield or a gear [Temporary]. (Kill it at the start " +
      "of its controller's Beginning Phase, before scoring.)"
  );
});

test("ogn-180-298 Fading Memories: one Temporary grant over the printed unit-or-gear choice", () => {
  // No speed keyword: the printing has no [Action]/[Reaction] line.
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);

  assert.equal(grantInstruction.id, "fading-memories.grant-temporary");
  assert.equal(grantInstruction.op, "continuous.grant-keyword");
  assert.deepEqual(grantInstruction.args, {
    keyword: { kind: "constant", value: "Temporary" }
  });
  assert.equal(grantInstruction.linkedTo, undefined);
  assert.equal(grantInstruction.picks, undefined);

  // "a unit at a battlefield or a gear": a single object choice admitting both
  // shapes (the unit's Location restriction stays descriptive, see judgeReason).
  assert.deepEqual(targetSpec, {
    id: "fading-memories.unit-or-gear",
    filter: { zone: "board", type: ["unit", "gear"] },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test.todo(
  "ogn-180-298 Fading Memories: granting [Temporary] to the chosen permanent, and its 816.1.b " +
    "kill at the start of that permanent's controller's Beginning Phase before scoring, need a " +
    "merged Temporary KeywordDef plus the continuous-effect layer consumer (RIFT-91) and a " +
    "delayed-trigger registration at the beginning-start timing point"
);
