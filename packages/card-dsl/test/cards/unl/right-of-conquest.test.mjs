import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/right-of-conquest.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-ac792fa285c45d86be2109bf1f688aa066f3a5d5e837443e35ddfd35df6c6392";
const SOURCE_TEXT = "Draw 1, then draw 1 for each battlefield you or allies control.";

const [play] = program.abilities;
const [drawOne, drawPerBattlefield] = play.body;

test("unl-015-219 Right of Conquest: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-015-219 Right of Conquest: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /491\.8\.e/);
  assert.match(program.judgeReason, /allies/);
  assert.match(program.judgeReason, /190\.4/);
  // Second-sweep refresh proof: name the merged-object-space fact, that
  // battlefield state never reaches host.objects().
  assert.match(program.judgeReason, /host\.objects/);
});

test("unl-015-219 Right of Conquest: two independent draws, the second counted per controlled battlefield", () => {
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 },
    power: { kind: "constant", value: 1 }
  });
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
    ["right-of-conquest.draw-1", "effect.draw"],
    ["right-of-conquest.draw-per-battlefield", "effect.draw"]
  ]);

  // 414.1 / 414.3: the first draw is one unconditional card for the controller (190.6.d).
  assert.deepEqual(drawOne.args, { amount: { kind: "constant", value: 1 } });
  // The second draw's amount is the size of the controlled-battlefield set; the ally and

  // battlefield readings are the unmerged part (see judgeReason).
  assert.deepEqual(drawPerBattlefield.args.amount, {
    kind: "count",
    subject: "battlefields-you-or-allies-control",
    filter: { type: "battlefield", controller: "controller" }
  });
  // "then" does not link the instructions (055 / 359.3.e.11).
  assert.equal(drawOne.linkedTo, undefined);
  assert.equal(drawPerBattlefield.linkedTo, undefined);
  assert.equal(drawOne.targets, undefined);
  assert.equal(drawPerBattlefield.targets, undefined);
  assert.equal(drawPerBattlefield.picks, undefined);
});

test("unl-015-219 Right of Conquest golden: the unconditional Draw 1 draws one card", () => {
  const kernel = world().deck(["top", "second"]).build();
  const run = runInstruction(draw, drawOne.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
});

test("unl-015-219 Right of Conquest golden: the counted draw draws exactly the count the kernel evaluates", () => {
  const kernel = world()
    .deck(["top", "second", "third"])
    .unit("field-a", { types: ["battlefield"], owner: "A", controller: "A", zone: "board" })
    .unit("field-b", { types: ["battlefield"], owner: "B", controller: "B", zone: "board" })
    .build();
  // The reference kernel matches the controller placeholder literally, so the golden pins the

  // count -> draw evaluation shape with the controller's own id; the ally dimension stays with

  // the judgeReason (CR 491.8.e).
  const amount = {
    ...drawPerBattlefield.args.amount,
    filter: { type: "battlefield", controller: "A" }
  };
  assert.equal(kernel.evaluate(amount), 1);
  const run = runInstruction(draw, { amount }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
});

test("unl-015-219 Right of Conquest golden: a zero-sized battlefield set draws zero", () => {
  const kernel = world().deck(["top"]).build();
  const amount = {
    ...drawPerBattlefield.args.amount,
    filter: { type: "battlefield", controller: "A" }
  };
  assert.equal(kernel.evaluate(amount), 0);
  const run = runInstruction(draw, { amount }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.equal(kernel.player("A").handSize, 0);
  assert.deepEqual(run.events, []);
});

test.todo("unl-015-219 Right of Conquest: evaluate 'battlefield you or allies control' (CR 190.2 / 190.4 / 190.4.a and 491.8.e) — needs a battlefield control reading exposed as an ObjectSnapshot/filter type and an ally/teammate controller selector; omitting either would under-count in team modes (RIFT-87 / RIFT-90)");
test.todo("unl-015-219 Right of Conquest: connect the printed play cost and the two draw instructions to the production chain/cost pipeline (RIFT-89 / P2 wiring)");

