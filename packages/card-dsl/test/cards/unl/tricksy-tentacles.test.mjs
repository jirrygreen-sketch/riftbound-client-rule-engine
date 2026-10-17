import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/tricksy-tentacles.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-a7dc7d29f0a8ac49b8977b2261f476c440c7c3025285bd5e6a7250b52981b37d";
const SOURCE_TEXT =
  "Move any number of enemy units with the same controller and a total Might of 8 " +
  "or less to a single location.";

const [play] = program.abilities;
const [moveInstruction] = play.body;
const [groupTarget] = moveInstruction.targets;

// The reference kernel compares filter values literally (see the existing
// card golden tests), so resolve this symbolic opponent placeholder only in
// the execution copy. The CardProgram keeps `controller: "opponent"` for the
// production target pipeline.
const concretizeOpponent = (body, opponent) => JSON.parse(JSON.stringify(body, (_key, value) =>
  value && typeof value === "object" && value.controller === "opponent"
    ? { ...value, controller: opponent }
    : value));

test("unl-054-219 Tricksy Tentacles: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
});

test("unl-054-219 Tricksy Tentacles: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /355\.11/);
  assert.match(program.judgeReason, /total Might/i);
  assert.doesNotMatch(program.judgeReason, /RIFT-(90|91)/);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("unl-054-219 Tricksy Tentacles: printed cost and one effect.move instruction", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  // Catalog printing: 4 energy + 1 Calm power.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 4 },
    power: { kind: "constant", value: 1 }
  });
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [["tricksy-tentacles.move-group", "effect.move"]]
  );
  assert.equal(moveInstruction.args.objects.kind, "constant");
  assert.deepEqual(moveInstruction.args.objects.value, {
    target: "tricksy-tentacles.enemy-unit-group"
  });
});

test("unl-054-219 Tricksy Tentacles: 'any number of enemy units' is a group target with a 0 minimum (355.11 / 355.13)", () => {
  assert.equal(groupTarget.id, "tricksy-tentacles.enemy-unit-group");
  // "any number" may be zero (355.13), so the group target's minimum is 0 and
  // it is selected as an "up-to" set; the group is a single target group
  // (355.11) rather than one target per unit.
  assert.equal(groupTarget.min, 0);
  assert.equal(groupTarget.max, null);
  assert.equal(groupTarget.selection, "up-to");
  assert.equal(groupTarget.filter.type, "unit");
  assert.equal(groupTarget.filter.controller, "opponent");
  assert.equal(groupTarget.filter.zone, "board");
});

test("unl-054-219 Tricksy Tentacles: both group-wide requirements stay recorded, and neither is approximated away", () => {
  // 355.11: "with the same controller" is a targeting requirement on the group
  // as a whole; 355.11.a/b make the "total Might of 8 or less" bound part of
  // group legality, including the resolution-time legal-subset reselection.
  // No merged filter evaluates either key, which is exactly why the card is
  // judge-required: dropping them would silently allow an over-Might or
  // mixed-controller group.
  assert.equal(groupTarget.filter.sameController, true);
  assert.equal(groupTarget.filter.totalMightAtMost, 8);
});

test("unl-054-219 Tricksy Tentacles: 'to a single location' is a runtime location choice (355.4)", () => {
  assert.deepEqual(moveInstruction.locations, [{
    id: "tricksy-tentacles.destination",
    type: "any",
    min: 1,
    max: 1,
    selection: "one"
  }]);
  assert.deepEqual(moveInstruction.args.to, {
    kind: "location",
    value: { kind: "target-location", target: "tricksy-tentacles.destination" }
  });
});

test("unl-054-219 Tricksy Tentacles: the whole group moves with one amount read off the locked group", () => {
  // "any number of enemy units … to a single location": one Move Effect covers
  // the whole locked group, so the amount is the group's own size (count over
  // the locked TargetSpec selector) and every unit shares the one destination.
  assert.deepEqual(moveInstruction.args.amount, {
    kind: "count",
    subject: "unit",
    filter: { target: { target: "tricksy-tentacles.enemy-unit-group" } }
  });
  assert.equal(moveInstruction.args.amount.filter.target.target, groupTarget.id);
  assert.equal(moveInstruction.targets.length, 1);
});

test.todo(
  "unl-054-219 Tricksy Tentacles: the group targeting requirement — 'with the same controller' and " +
    "'a total Might of 8 or less' (CR 355.11 / 355.11.a / 355.11.b, including the resolution-time legal " +
    "subset) — needs group-level target constraints in the target system; no merged filter " +
    "evaluates them"
);

test("unl-054-219 Tricksy Tentacles golden: a selected location is consumed by the move instruction", () => {
  const kernel = world()
    .unit("enemy", {
      owner: "B",
      controller: "B",
      location: { type: "base", player: "B" },
      might: 3
    })
    .object("battlefield-1", {
      types: ["battlefield"],
      zone: "board",
      location: null,
      owner: "A",
      controller: "A"
    })
    .unit("battlefield-occupant", { location: { type: "battlefield", id: "battlefield-1" }, owner: "A", controller: "A" })
    .build();
  kernel.setTargets(groupTarget.id, [kernel.ref("enemy")]);
  kernel.setAnswers({
    "tricksy-tentacles.move-group/location%3Atricksy-tentacles.destination": {
      type: "battlefield",
      id: "battlefield-1"
    }
  });
  const outcome = resolveChainBody(concretizeOpponent(play.body, "B"), kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.getObject("enemy").location, {
    type: "battlefield",
    id: "battlefield-1"
  });
});
