import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/progress-day.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-6f5f348b612d7d8afb8d38e3f76ed436a62cd1d5d0abcb5a003c48de2e2741fb";

const play = program.abilities[0];
const [drawFour] = play.body;

test("Progress Day program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Progress Day identity, status and printed text match the catalog", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, "Draw 4.");
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Progress Day structure: one plain play ability with a single Draw 4 instruction", () => {
  // No [Action]/[Reaction] reminder text is printed, and those keywords are
  // intrinsic properties only when printed (159.2.a-b), so no keyword ability.
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [["draw-4", "effect.draw"]]);
  assert.deepEqual(drawFour.args, { amount: { kind: "constant", value: 4 } });
  // No target, pick, choice, link, or condition: the drawer is the ability's
  // controller (190.6.d's implied "you"), which is effect.draw's default.
  assert.equal(drawFour.targets, undefined);
  assert.equal(drawFour.picks, undefined);
  assert.equal(drawFour.linkedTo, undefined);
  assert.equal(drawFour.condition, undefined);
});

test("Progress Day golden: the controller draws four cards through the real primitive", () => {
  const kernel = world().deck(["first", "second", "third", "fourth", "fifth"]).build();
  const run = runInstruction(draw, { amount: drawFour.args.amount }, { world: kernel });

  assert.equal(run.result.status, "executed");
  // One Draw action for the instruction (414.3); the kernel moves four cards
  // out of the Main Deck into the controller's hand.
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
  assert.equal(run.events[0].taskId, "effect:draw:1");
  assert.equal(run.linked.drawn, 4);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 4);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.equal(kernel.player("B").handSize, 0);
});

test("Progress Day golden: a short deck draws as many as possible without failing (CR 414.4.a)", () => {
  const kernel = world().deck(["only-card"]).build();
  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 0);
  assert.equal(outcome.linkedValues["draw-4.drawn"], 1);
});

test("Progress Day golden: a replaced draw negates the instruction instead of drawing (CR 055)", () => {
  const kernel = world().deck(["card"]).build();
  kernel.addReplacement(action => (action.type === "draw" ? "prevented" : null));
  const run = runInstruction(draw, { amount: drawFour.args.amount }, { world: kernel });

  assert.deepEqual(run.result, { status: "negated", reason: "skipped", events: [run.events[0]] });
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("A").deckSize, 1);
});

test.todo(
  "Progress Day: the 414.4.b Burn Out replacement and the 414.4.c remaining draws are " +
    "kernel behaviour for an exhausted Main Deck, not card data (RIFT-89/90 kernel work)."
);
