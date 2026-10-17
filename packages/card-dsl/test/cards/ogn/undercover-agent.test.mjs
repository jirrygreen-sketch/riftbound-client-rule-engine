import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/undercover-agent.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-1838f6a22b76ababa713378ed2b4096f3e39f6b61a01bcf17bb8610b0ac08347";
const [deathknell, triggered] = program.abilities;
const [discard, draw] = triggered.body;

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /trigger\.leave/);
  assert.match(program.judgeReason, /RIFT-82/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(
    program.sourceText,
    "[Deathknell] — Discard 2, then draw 2. (When I die, get the effect.)"
  );
});

test("[Deathknell] is declared as a keyword ability (808.1)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(deathknell, { kind: "keyword", keyword: "deathknell" });
  assert.equal(deathknell.value, undefined);
});

test("the effect body is an object-killed trigger with discard 2 then draw 2 (808.1.c)", () => {
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "object-killed");
  // The engine validator rejects the older { self: true } spelling; the dying
  // unit identifies itself through object:{objectId:"self"} (translated to the
  // source id by the program binding).
  assert.deepEqual(triggered.trigger.filter, {
    event: "object-killed",
    object: { objectId: "self" }
  });
  assert.equal(triggered.optional, false);
  assert.deepEqual(
    triggered.body.map(entry => [entry.id, entry.op]),
    [
      ["undercover-agent.discard-2", "effect.discard"],
      ["undercover-agent.draw-2", "effect.draw"]
    ]
  );
  assert.deepEqual(discard.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(draw.args.amount, { kind: "constant", value: 2 });
  // "then draw 2" references neither the discarded objects nor the discard
  // action (359.3.e.14.c), so the instructions are not linked; the draw still
  // resolves when the discard is negated (359.3.e.14.b).
  assert.equal(draw.linkedTo, undefined);
  assert.equal(discard.linkedTo, undefined);
  assert.equal(discard.targets, undefined);
  assert.equal(draw.targets, undefined);
});

test("golden: with two cards in hand the body discards 2 and draws 2 (423.1/414.3)", () => {
  const kernel = world().hand("old-one").hand("old-two").deck(["new-one", "new-two"]).build();
  const outcome = resolveChainBody(triggered.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => entry.result.status), ["executed", "executed"]);
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["old-one", "old-two"]);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["new-one", "new-two"]);
  // Discard submits one action per card (423.1); the single Draw 2 instruction
  // submits one draw action carrying amount 2 (414.3).
  assert.deepEqual(outcome.events.map(event => event.action), ["discard", "discard", "draw"]);
});

test("golden: with one card in hand the discard does as much as possible and the draw still resolves (423.4, 359.3.e.14.b)", () => {
  const kernel = world().hand("only").deck(["new-one", "new-two"]).build();
  const outcome = resolveChainBody(triggered.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[1].result.status, "executed");
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["only"]);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["new-one", "new-two"]);
});

test.todo(
  "Deathknell keyword expansion: subscribe at object-killed, capture last-known info before the trash move, " +
    "and drop the trigger when the death is replaced (808.1.d). The expansion body still references the " +
    "trigger.leave primitive that RIFT-82/RIFT-120 must register, and the card-program → " +
    "TriggerRegistration expansion path (RIFT-257) is the other half."
);
