import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

import stupefy from "../../../dist/cards/ogn/stupefy.js";

const [speed, play] = stupefy.abilities;

test("Stupefy program is structurally valid and judge-required", () => {
  const result = validateCardProgram(stupefy);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(stupefy.status, "judge-required");
  assert.match(stupefy.judgeReason, /might/i);
  assert.equal(
    stupefy.canonicalCardId,
    "card.hash-5b08b5b8648e8c5c057d15279d1b4e677457eb0b43fcf2810e2ec4f4c4d1b7cf"
  );
  assert.match(stupefy.sourceText, /minimum of 1/);
});

test("Stupefy ability structure: [Reaction] keyword + debuff target + unlinked draw", () => {
  assert.equal(stupefy.abilities.length, 2);

  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });

  assert.equal(play.kind, "play");
  assert.deepEqual(
    play.body.map((instruction) => instruction.id),
    ["debuff", "draw"]
  );

  // "Give a unit -1 Might this turn": exactly one target (any one unit).
  const debuff = play.body[0];
  assert.equal(debuff.targets.length, 1);
  assert.equal(debuff.targets[0].id, "unit");
  assert.equal(debuff.targets[0].selection, "one");
  assert.equal(debuff.targets[0].filter.type, "unit");
  // The printed -1 with the "minimum of 1" clamp (CR 122.5.b) is described
  // in the args for the pending might-modification primitive.
  assert.deepEqual(debuff.args.amount, { kind: "literal", value: -1 });
  assert.deepEqual(debuff.args.minimum, { kind: "literal", value: 1 });

  // "Draw 1." is NOT linked to the debuff: under 359.2.c ("as much as
  // possible") the draw still happens when the debuff cannot (e.g. the only
  // unit already has 1 Might).
  const drawInstruction = play.body[1];
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.deepEqual(drawInstruction.args.amount, { kind: "literal", value: 1 });
});

test("Stupefy golden: the independent Draw 1 half draws one card", () => {
  const kernel = world().deck("top-card").deck("next-card").build();
  const drawInstruction = play.body[1];

  const run = runInstruction(
    draw,
    { amount: drawInstruction.args.amount },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
});

test.todo(
  "Stupefy debuff: -1 Might this turn with the printed minimum of 1 clamp (CR 122.5.b), " +
    "clamped when the target has 1 Might, expiring at cleanup " +
    "(依赖 RIFT-83/84 layers / continuous.might 原语)"
);

test.todo(
  "Stupefy 359.2.c: debuff impossible but the unlinked Draw 1 still resolves " +
    "(依赖 RIFT-83/84 临时 Might 原语落地后由解释器验证)"
);
