import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/traveling-merchant.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-b826486bfded0550969d823bf5dedeaa623f413f4ff7c55486520f3b812c6a43";
const [ability] = program.abilities;
const [discard, draw] = ability.body;

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, "When I move, discard 1, then draw 1.");
});

test("'When I move' subscribes to the object-moved timing point scoped to this card (421.1/449.1)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, { event: "object-moved", filter: { source: "self" } });
  assert.equal(ability.optional, false);
});

test("body discards 1 then draws 1 as separate unlinked instructions (359.3.e.14.c)", () => {
  assert.deepEqual(
    ability.body.map(entry => [entry.id, entry.op]),
    [
      ["traveling-merchant.discard-1", "effect.discard"],
      ["traveling-merchant.draw-1", "effect.draw"]
    ]
  );
  assert.deepEqual(discard.args, { amount: { kind: "constant", value: 1 } });
  assert.deepEqual(draw.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(draw.linkedTo, undefined);
  assert.equal(draw.targets, undefined);
});

test("golden: with exactly one card in hand the body discards it and draws 1", () => {
  const kernel = world().hand("only").deck("top").build();
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => entry.result.status), ["executed", "executed"]);
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["only"]);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top"]);
  assert.deepEqual(outcome.events.map(event => event.action), ["discard", "draw"]);
});

test("golden: the discarding player chooses which card to discard (423.1.a)", () => {
  const kernel = world().hand("first").hand("second").deck("top").build();
  kernel.setAnswers({ "traveling-merchant.discard-1/effect.discard%3AA": [kernel.ref("second")] });
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["second"]);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["first", "top"]);
});

test.todo(
  "trigger end-to-end: the object-moved event must carry from/to location payload and only genuine Moves " +
    "(not Recall or entry) must fire the ability (449.1/458; RIFT-90 chain/event batch)"
);
