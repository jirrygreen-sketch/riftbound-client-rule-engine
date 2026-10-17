import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/deserts-call.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-13dac6e5e0aae54e0dba3935b0e7416d5e1cfe13a2c7817a155c406b27f0e5bf";
const SOURCE_TEXT =
  "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Play a 2 :rb_might: Sand Soldier unit token.";

const [play] = program.abilities;
const [chooseLocation, playToken] = play.body;

test("sfd-031-221 Desert's Call: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-031-221 Desert's Call: judge-required only for the Repeat wiring", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /target\.location/);
  assert.match(program.judgeReason, /820\.1\.c\.1/);
  assert.match(program.judgeReason, /Additional costs are not bound/);
  assert.doesNotMatch(program.judgeReason, /RIFT-9/);
});

test("sfd-031-221 Desert's Call structure: no speed keyword, the Repeat payment and the Sand Soldier play", () => {
  // The printed ability line has no [Action]/[Reaction]/[Hidden] keyword, so no
  // speed keyword is declared; the spell keeps its default timing (159.2).
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");

  // [Repeat] :rb_energy_2: (820.1.c): the printed additional cost with the
  // explicit pay/decline decision 820.1.b requires.
  assert.equal(play.cost.kind, "additional");
  assert.equal(play.cost.payments.length, 1);
  const [payment] = play.cost.payments;
  assert.equal(payment.kind, "energy");
  assert.deepEqual(payment.amount, { kind: "constant", value: 2 });
  assert.equal(payment.choice.id, "deserts-call.repeat-payment");
  assert.deepEqual(payment.choice.options, ["pay", "decline"]);
  assert.equal(payment.choice.selection, "one");

  // "Play a 2 :rb_might: Sand Soldier unit token": the merged CR 187.3 frozen
  // definition and the 440.2.c / 185.2.a chain-create + play path.
  assert.equal(play.body.length, 2);
  assert.equal(playToken.id, "deserts-call.play-sand-soldier-token");
  assert.equal(playToken.op, "effect.token");
  assert.deepEqual(playToken.args.token, { kind: "constant", value: "sand-soldier" });
  assert.deepEqual(playToken.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(playToken.args.mode, { kind: "constant", value: "play" });
  assert.equal(chooseLocation.op, "condition.value");
  assert.deepEqual(chooseLocation.args.value, {
    kind: "location",
    value: { kind: "target-location", target: "deserts-call.token-location" }
  });
  assert.deepEqual(chooseLocation.locations, [{
    id: "deserts-call.token-location",
    type: "any",
    controller: "controller",
    min: 1,
    max: 1,
    selection: "one"
  }]);
  assert.equal(playToken.linkedTo, "deserts-call.choose-location");
  assert.deepEqual(playToken.args.location, {
    kind: "linked-value",
    instructionId: "deserts-call.choose-location",
    key: "location"
  });
  assert.equal(playToken.targets, undefined);
  assert.equal(playToken.args.target, undefined);
  assert.equal(playToken.args.pick, undefined);
  assert.equal(playToken.args.locations, undefined);
});

for (const [label, chosenLocation] of [
  ["the controller's Base", { type: "base", player: "A" }],
  ["a controlled Battlefield", { type: "battlefield", id: "battlefield-1" }]
]) {
  test(`sfd-031-221 Desert's Call golden: the Sand Soldier token lands at ${label}`, () => {
    const builder = world().player("A");
    if (chosenLocation.type === "battlefield") {
      builder.object("battlefield-1", {
        types: ["battlefield"],
        zone: "board",
        location: null,
        owner: "A",
        controller: "A",
        energy: null,
        power: null
      });
      builder.unit("battlefield-occupant", {
        location: { type: "battlefield", id: "battlefield-1" },
        owner: "A",
        controller: "A"
      });
    }
    const kernel = builder.build();
    kernel.setAnswers({
      "deserts-call.choose-location/location%3Adeserts-call.token-location": chosenLocation
    });
    const outcome = resolveChainBody(program.abilities[0].body, kernel);

    assert.equal(outcome.status, "executed");
    assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
      ["deserts-call.choose-location", "executed"],
      ["deserts-call.play-sand-soldier-token", "executed"]
    ]);
    assert.deepEqual(outcome.results[1].result.events.map((event) => event.timingPoint), ["chain-item-pending", "card-played"]);
    const soldiers = kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken);
    assert.equal(soldiers.length, 1);
    const [soldier] = soldiers;
    assert.equal(soldier.name, "Sand Soldier");
    // 185.2.b / 187.3: the token unit has 2 Might; 185.3.a keeps its printed
    // Energy and Power null (never rewritten as 0).
    assert.equal(soldier.might, 2);
    assert.deepEqual(soldier.tags, ["Shurima"]);
    assert.equal(soldier.energy, null);
    assert.equal(soldier.power, null);
    assert.deepEqual(soldier.location, chosenLocation);
    assert.equal(soldier.controller, "A");
    assert.equal(outcome.results[1].result.linkedValues["sandSoldierToken.amount"], 1);
  });
}

test.todo(
  "sfd-031-221 Desert's Call: collecting the optional 2-energy Repeat cost at Finalize, exposing the " +
    "paid count to the effect execution, and re-making choices for the additional execution " +
    "(820.1.c.1 / 820.1.d.1 / 820.2) need the play additional-cost translateCost/plan wiring."
);
