import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/confront.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-08362922ac97bb87d5bd7e14df1a5563c1526f85f472aaa9fb8d8cf6803d8fca";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Units you play this turn enter ready. Draw 1.";

const speed = program.abilities[0];
const play = program.abilities[1];
const [enterReady, drawOne] = play.body;

test("Confront program is structurally valid and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "judge-required");
  // The judgeReason must name the actual gap (contract 3.1 / README §2).
  assert.match(program.judgeReason, /359\.2\.c/);
  assert.match(program.judgeReason, /805\.6\.a/);
  assert.match(program.judgeReason, /replacement\.enter/);
  // The reason must not claim the whole card is impossible: the draw is named.
  assert.match(program.judgeReason, /effect\.draw/);
});

test("Confront identity and printed text match the catalog", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Confront structure: [Action], the described entry replacement, and Draw 1", () => {
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
    ["enter-ready-this-turn", "replacement.enter"],
    ["draw-1", "effect.draw"]
  ]);

  // "Units you play this turn enter ready" is an entry replacement limited to
  // the rest of this turn, applying to the controller's units played afterwards
  // — a programmatic set, not a target (355.10.d).
  assert.deepEqual(enterReady.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(enterReady.args.exhausts, { kind: "constant", value: false });
  assert.deepEqual(enterReady.args.appliesTo, {
    kind: "constant",
    value: { type: "unit", controller: "self" }
  });
  assert.equal(enterReady.targets, undefined);
  assert.equal(enterReady.picks, undefined);

  // "Draw 1." is a separate sentence, so the unmerged half does not gate it
  // (359.3.e.14 links references; this is not one).
  assert.deepEqual(drawOne.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawOne.linkedTo, undefined);
  assert.equal(drawOne.targets, undefined);
});

test("Confront golden: the Draw 1 half draws one card through the real primitive", () => {
  const kernel = world().deck(["top-card", "second-card"]).build();
  const run = runInstruction(draw, { amount: drawOne.args.amount }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
});

test.todo(
  "Confront: 'Units you play this turn enter ready' needs the entry replacement " +
    "(replacement.enter) registered for the rest of the turn — 359.2.c units enter " +
    "exhausted, and 805.6.a is explicit that the replacement means the unit does not " +
    "enter exhausted and then become ready, so effect.ready cannot stand in " +
    "(effect.ready's own documentation says the same)."
);

test.todo(
  "Confront: [Action] admission and the turn-scoped lifetime of the granted entry " +
    "replacement (continuous.duration expiry at 317.2.c) are chain and layer work."
);
