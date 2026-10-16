import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/kaisa-survivor.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-6109f0c3bc10309b97f11204acad6c44060c1d502ba47608e1a7e5f37dc4f87f";

test("ogn-039-298 Kai'Sa, Survivor: program validates and is executable", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
});

test("ogn-039-298 Kai'Sa, Survivor: identity, ruleset and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
      "When I conquer, draw 1."
  );
});

test("ogn-039-298 Kai'Sa, Survivor: Accelerate keyword plus a self conquer draw trigger", () => {
  assert.equal(program.abilities.length, 2);
  const [accelerate, triggered] = program.abilities;
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });

  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "conquer");
  assert.deepEqual(triggered.trigger.filter, { source: "self" });
  assert.equal(triggered.trigger.condition, undefined);
  assert.equal(triggered.trigger.once, undefined);
  assert.equal(triggered.optional, false);

  assert.equal(triggered.body.length, 1);
  const [instruction] = triggered.body;
  assert.equal(instruction.id, "kaisa-survivor.draw-1");
  assert.equal(instruction.op, "effect.draw");
  assert.deepEqual(instruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("ogn-039-298 Kai'Sa, Survivor: the conquer trigger body draws the top card of the deck", () => {
  const kernel = world().deck("deep").deck("top").build();
  const instruction = program.abilities[1].body[0];
  const run = runInstruction(draw, instruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top"]);
});

test("ogn-039-298 Kai'Sa, Survivor: the draw instruction with an empty deck reports the actual count", () => {
  const kernel = world().build();
  const instruction = program.abilities[1].body[0];
  const run = runInstruction(draw, instruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.equal(kernel.player("A").handSize, 0);
});

test.todo(
  "ogn-039-298 Kai'Sa, Survivor: the conquer trigger firing from the scoring pipeline and the " +
    "chain delivering it as a pending item (RIFT-31/RIFT-120); the effect body itself is executed above."
);
test.todo(
  "ogn-039-298 Kai'Sa, Survivor: Accelerate payment and enter-ready replacement end-to-end through the " +
    "cost pipeline and layers (RIFT-86/RIFT-89/RIFT-91)."
);
