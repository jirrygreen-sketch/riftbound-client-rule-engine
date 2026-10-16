import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import spoilsOfWar from "../../../dist/cards/ogn/spoils-of-war.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [speed, costModification, play] = spoilsOfWar.abilities;
const [drawInstruction] = play.body;

test("Spoils of War program is structurally valid and judge-required", () => {
  const result = validateCardProgram(spoilsOfWar);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(spoilsOfWar.status, "judge-required");
  assert.match(spoilsOfWar.judgeReason, /cost\.modify/);
  assert.match(spoilsOfWar.judgeReason, /HistoryQuery/);
  assert.equal(spoilsOfWar.rulesetVersion, "core-1.5");
  assert.equal(
    spoilsOfWar.canonicalCardId,
    "card.hash-f1f8b1ffd2a9dcbd2d052a21cda44bb88a2c34a60045e4a5b5059be0dfb97f83"
  );
  assert.equal(
    spoilsOfWar.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "If an enemy unit has died this turn, this costs :rb_energy_2: less.\n" +
      "Draw 2."
  );
});

test("Spoils of War structure: [Reaction] + Energy discount declaration + draw 2", () => {
  assert.equal(spoilsOfWar.abilities.length, 3);
  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });

  // "this costs [2] less": a -2 Energy modification of this card's own cost,
  // floored at 0 (356.4.e/356.6).
  assert.equal(costModification.kind, "static");
  assert.equal(costModification.effect.kind, "continuous.cost-modification");
  assert.equal(costModification.effect.resource, "energy");
  assert.deepEqual(costModification.effect.amount, { kind: "constant", value: -2 });
  assert.deepEqual(costModification.effect.minimum, { kind: "constant", value: 0 });
  assert.equal(costModification.effect.appliesTo, "self");
  // "If an enemy unit has died this turn": the intended Finalize-time history
  // predicate, in the contract 3.8 HistoryQuery shape (objectFilter).
  assert.deepEqual(costModification.effect.when, {
    kind: "constant",
    value: {
      history: {
        scope: "turn",
        action: "kill",
        objectFilter: { type: "unit", controller: "opponent" }
      }
    }
  });

  // "Draw 2." is the merged effect.draw: a separate sentence with no link to
  // the discount, so it resolves whenever the spell resolves.
  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 2 });
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.condition, undefined);
});

test("Spoils of War golden: Draw 2 moves the top two cards to hand", () => {
  const kernel = world().deck(["top-card", "middle-card", "bottom-card"]).build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  // CR 414.1.a: drawn from the top of the Main Deck, in order.
  assert.deepEqual(
    kernel.zone("A", "hand").map((ref) => ref.id),
    ["top-card", "middle-card"]
  );
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(run.linked, { drawn: 2, drawnTo: "A" });
  assert.deepEqual(run.events.map((event) => event.action), ["draw"]);
});

test("Spoils of War golden: a short deck draws as many as possible (CR 414.4)", () => {
  const kernel = world().deck(["only-card"]).build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 0);
});

test("Spoils of War golden: an empty deck draws nothing but still resolves", () => {
  const kernel = world().build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.equal(kernel.player("A").handSize, 0);
  // CR 414.4: the draw action still commits with an actual count of 0.
  assert.deepEqual(run.events.map((event) => event.action), ["draw"]);
});

test.todo(
  "Spoils of War discount: the -2 Energy discount must be consumed at Finalize when an " +
    "enemy unit died this turn (356.4.b/356.4.d), needing a history predicate over enemy " +
    "unit deaths (contract 3.8 objectFilter HistoryQuery) and a cost-plan consumer for the " +
    "static continuous.cost-modification ability (依赖 RIFT-89 费用消费方 + 契约 3.8 历史查询)"
);

test.todo(
  "Spoils of War cast: pays the discounted 4-or-2 Energy plus 1 Body power and [Reaction] " +
    "closed-state timing is enforced (依赖 RIFT-89 / RIFT-91 continuous.timing 生产接线)"
);

