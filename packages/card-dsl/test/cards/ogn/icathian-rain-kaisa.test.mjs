import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/icathian-rain-kaisa.js";
// Same production path as Salvage: the card body runs through the chain's
// interpreter adapter so the merged effect.damage primitive validates and
// evaluates the card's own Expr arguments.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-e103f9d62c928837475ed870767d97957ffd5cf5908be18d0d74fa19fef131ff";

const play = program.abilities[0];
const sentences = play.body.map((instruction, index) => ({ instruction, index }));

/** Load one locked target per sentence, as Finalize does for the whole spell. */
function castWith(kernel, refsById) {
  for (const [index, refs] of refsById.entries()) {
    kernel.setTargets(`icathian-rain-unit-${index + 1}`, refs);
  }
  return resolveChainBody(play.body, kernel);
}

test("ogn-248-298 Icathian Rain: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(
    program.sourceText,
    "Deal 2 to a unit.\nDeal 2 to a unit.\nDeal 2 to a unit.\n" +
      "Deal 2 to a unit.\nDeal 2 to a unit.\nDeal 2 to a unit."
  );
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-248-298 Icathian Rain structure: six independent targeted 2-damage sentences", () => {
  // No speed keyword is printed: the spell has only its intrinsic properties.
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.equal(play.body.length, 6);

  assert.deepEqual(
    sentences.map(({ instruction }) => instruction.id),
    [
      "icathian-rain-1",
      "icathian-rain-2",
      "icathian-rain-3",
      "icathian-rain-4",
      "icathian-rain-5",
      "icathian-rain-6"
    ]
  );

  for (const { instruction, index } of sentences) {
    const position = index + 1;
    assert.equal(instruction.op, "effect.damage");
    assert.deepEqual(instruction.args.amount, { kind: "literal", value: 2 });
    assert.deepEqual(instruction.args.target, {
      kind: "literal",
      value: `icathian-rain-unit-${position}`
    });
    // Six separate printed sentences: never chained together for convenience.
    assert.equal(instruction.linkedTo, undefined);
    assert.equal(instruction.condition, undefined);

    assert.equal(instruction.targets.length, 1);
    const [target] = instruction.targets;
    assert.equal(target.id, `icathian-rain-unit-${position}`);
    assert.deepEqual(target.filter, { type: "unit" });
    assert.equal(target.min, 1);
    assert.equal(target.max, 1);
    assert.equal(target.selection, "one");
    assert.equal(instruction.picks, undefined);
  }
});

test("ogn-248-298 Icathian Rain golden: six sentences deal 2 each, the same unit may be chosen again", () => {
  const kernel = world().unit("target-unit", { might: 20 }).unit("untouched", { might: 20 }).build();
  const unit = kernel.ref("target-unit");

  const outcome = castWith(kernel, [[unit], [unit], [unit], [unit], [unit], [unit]]);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => result.id), [
    "icathian-rain-1",
    "icathian-rain-2",
    "icathian-rain-3",
    "icathian-rain-4",
    "icathian-rain-5",
    "icathian-rain-6"
  ]);
  assert.ok(outcome.results.every(result => result.result.status === "executed"));
  // Each sentence marks its own 2 damage (418.1.c).
  assert.equal(kernel.getObject("target-unit").damage, 12);
  assert.equal(kernel.getObject("untouched").damage, 0);
  assert.equal(outcome.events.filter(event => event.action === "damage").length, 6);
});

test("ogn-248-298 Icathian Rain golden: a different unit per sentence is legal and independent", () => {
  const kernel = world()
    .unit("first-unit", { might: 20 })
    .unit("second-unit", { might: 20 })
    .build();
  const first = kernel.ref("first-unit");
  const second = kernel.ref("second-unit");

  const outcome = castWith(kernel, [[first], [second], [first], [second], [first], [second]]);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("first-unit").damage, 6);
  assert.equal(kernel.getObject("second-unit").damage, 6);
  assert.equal(outcome.events.filter(event => event.action === "damage").length, 6);
});

test("ogn-248-298 Icathian Rain golden: one lost target ignores only its own sentence", () => {
  const kernel = world().unit("staying", { might: 20 }).unit("leaving", { might: 20 }).build();
  const staying = kernel.ref("staying");
  const stale = kernel.ref("leaving");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });

  const outcome = castWith(kernel, [[staying], [stale], [staying], [staying], [staying], [staying]]);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[1].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(outcome.results[2].result.status, "executed");
  // Five surviving sentences deal 2 each; the sentences are not linked.
  assert.equal(kernel.getObject("staying").damage, 10);
  assert.equal(outcome.events.filter(event => event.action === "damage").length, 5);
});

test.todo(
  "Icathian Rain: Finalize-time locking of the six separate unit choices plus the six " +
    "became-target emissions belong to the target/chain integration workstreams " +
    "(RIFT-90 / RIFT-120)."
);
