import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/turn-to-dust.js";
const CANONICAL_ID =
  "card.hash-d499c08d49d46da72e1362f82b24b913abf3b6fbc0e80676cbb858f169d91e75";
const SOURCE_TEXT =
  "Give a gear [Temporary]. (Kill it at the start of its controller's Beginning Phase, before scoring.)";

const [play] = program.abilities;
const [grant] = play.body;

test("unl-070-219 Turn to Dust: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-070-219 Turn to Dust: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.keyword|continuous\.grant-keyword/);
  assert.match(program.judgeReason, /816/);
  assert.match(program.judgeReason, /RIFT-9/);
});

test("unl-070-219 Turn to Dust: one play ability granting Temporary to one gear target", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  // The spell itself prints no cost line for this half; the printed 2 energy
  // comes from the card catalog at Finalize (356.1.c), so no CostSpec is
  // re-stated here.
  assert.equal(play.cost, undefined);
  assert.equal(play.body.length, 1);
  assert.equal(grant.id, "turn-to-dust.grant-temporary");
  assert.equal(grant.op, "continuous.grant-keyword");
  assert.deepEqual(grant.args.keyword, { kind: "constant", value: "Temporary" });
  // 355.9.a.1 / 355.7: "a gear" is a chosen Board object, i.e. a target.
  assert.deepEqual(grant.targets, [
    {
      id: "turn-to-dust.gear",
      filter: { zone: "board", type: "gear" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(grant.picks, undefined);
  assert.equal(grant.linkedTo, undefined);
});

test.todo(
  "unl-070-219 Turn to Dust: execute the [Temporary] keyword grant on a gear (CR 816.3 + contract 3.4 ability-layer " +
    "keyword grants) — no continuous.grant-keyword / continuous.keyword instruction file is merged"
);

test.todo(
  "unl-070-219 Turn to Dust: the granted [Temporary] trigger (CR 816.1.b) killing the gear at the start of its " +
    "controller's Beginning Phase through the keyword expansion and trigger pipeline"
);
