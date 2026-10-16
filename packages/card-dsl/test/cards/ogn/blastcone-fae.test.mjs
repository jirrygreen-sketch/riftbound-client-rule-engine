import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/blastcone-fae.js";

const CANONICAL = "card.hash-5babb90d79192ee6ca892489ae07370b086c015b0a2db49d665b82be90f4fcc9";

test("Blastcone Fae program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /811/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(
    program.sourceText,
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
      "When you play me, give a unit -2 :rb_might: this turn, to a minimum of 1 :rb_might:."
  );
});

test("Blastcone Fae structure: Hidden keyword plus the printed self-play debuff", () => {
  assert.equal(program.abilities.length, 2);
  const [hidden, triggered] = program.abilities;
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });

  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.optional, false);
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { role: "self" }
  });

  // "give a unit -2 [M] this turn, to a minimum of 1 [M]": exactly one unit,
  // the printed -2 and the printed floor of 1 are both recorded.
  assert.equal(triggered.body.length, 1);
  const [instruction] = triggered.body;
  assert.equal(instruction.id, "blastcone-fae.give-minus-2");
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: -2 });
  assert.deepEqual(instruction.args.minimum, { kind: "constant", value: 1 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "end-of-turn" });

  assert.equal(instruction.targets.length, 1);
  assert.deepEqual(instruction.targets[0], {
    id: "blastcone-fae.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test.todo(
  "Blastcone Fae debuff: -2 [M] this turn with the printed floor of 1, expiring at end of turn (478 layer arithmetic, " +
    "317.1.a); needs the continuous.might layers batch (RIFT-91)"
);

test.todo(
  "Blastcone Fae [Hidden] (811): Hide for one rainbow rune, play from facedown for 0, plus the 811.1.d.3 targeting " +
    "restriction that its play effect must choose units at the battlefield it was played to (RIFT-89 / RIFT-90 / RIFT-91)"
);
