import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/jinx-demolitionist.js";
import discard from "../../../../engine-core/dist/effects/instructions/effect.discard.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-ebb7c06b81cac9f92ad088fcd2b809aa1e4f83f98e4ae2bbe3ad591e7259a141";
const DISCARD_ID = "jinx-demolitionist.discard-2";

test("ogn-030-298 Jinx, Demolitionist: program validates and is executable", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
});

test("ogn-030-298 Jinx, Demolitionist: identity, ruleset and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
      "[Assault 2] (+2 :rb_might: while I'm an attacker.)\n" +
      "When you play me, discard 2."
  );
});

test("ogn-030-298 Jinx, Demolitionist: Accelerate and Assault 2 keywords plus a card-played discard trigger", () => {
  assert.equal(program.abilities.length, 3);
  const [accelerate, assault, triggered] = program.abilities;
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });
  assert.deepEqual(assault, { kind: "keyword", keyword: "assault", value: 2 });

  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  assert.equal(triggered.optional, false);

  assert.equal(triggered.body.length, 1);
  const [instruction] = triggered.body;
  assert.equal(instruction.id, DISCARD_ID);
  assert.equal(instruction.op, "effect.discard");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 2 });
  // Discarding 2 is an effect (423), not a cost; the implicit player is the
  // ability controller (190.6.d) and no target is involved.
  assert.equal(instruction.args.player, undefined);
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("ogn-030-298 Jinx, Demolitionist: discard 2 moves two chosen cards from hand to trash", () => {
  const kernel = world().hand("one").hand("two").hand("three").build();
  const instruction = program.abilities[2].body[0];
  const run = runInstruction(discard, instruction.args, {
    world: kernel,
    answers: { "effect.discard:A": [kernel.ref("one"), kernel.ref("three")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.discarded.count, 2);
  assert.deepEqual(run.linked.discarded.objects.map((ref) => ref.id), ["one", "three"]);
  assert.equal(run.events.filter((event) => event.action === "discard").length, 2);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["two"]);
  assert.deepEqual(kernel.zone("A", "trash").map((ref) => ref.id), ["one", "three"]);
});

test("ogn-030-298 Jinx, Demolitionist: renderizable discard of two in a fuller hand does not touch the third card", () => {
  const kernel = world().hand("a").hand("b").hand("c").build();
  const instruction = program.abilities[2].body[0];
  const run = runInstruction(discard, instruction.args, {
    world: kernel,
    answers: { "effect.discard:A": [kernel.ref("b"), kernel.ref("c")] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["a"]);
  assert.deepEqual(kernel.zone("A", "trash").map((ref) => ref.id), ["b", "c"]);
});

test("ogn-030-298 Jinx, Demolitionist: discarding from an empty hand is negated, never faked (CR 423.4)", () => {
  const kernel = world().build();
  const instruction = program.abilities[2].body[0];
  const run = runInstruction(discard, instruction.args, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked.discarded.count, 0);
  assert.equal(run.events.length, 0);
});

test.todo(
  "ogn-030-298 Jinx, Demolitionist: the printed discard trigger firing from the chain " +
    "(card-played timing point -> pending item -> resolve) needs the trigger/chain pipeline wiring" +
    "(RIFT-120 batch4 chain/events); the instruction body itself is executed above."
);
test.todo(
  "ogn-030-298 Jinx, Demolitionist: Accelerate payment and the Assault 2 attacker Might bonus " +
    "end-to-end through the keyword registry, cost pipeline and layers (RIFT-86/RIFT-81/RIFT-89/RIFT-91)."
);
