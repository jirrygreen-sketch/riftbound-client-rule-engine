import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/hall-of-legends.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const BASE = { type: "base", player: "A" };
const constant = value => ({ kind: "constant", value });
const [ability] = program.abilities;
const [choice] = ability.body;
const [pay, readyLegend] = choice.args.body.value;
const legendSelection = readyLegend.args.objects.value;

test("sfd-210-221 Hall of Legends: validates, is registered and keeps identity/source text", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(
    program.canonicalCardId,
    "card.hash-e4adbb3b6a16047a000e20a54481f947239754cc236a48b06ad0cebcbfd7ed57"
  );
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /383\.3\.b/);
  assert.equal(program.sourceText, "When you conquer here, you may pay :rb_energy_1: to ready your legend.");
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("sfd-210-221 Hall of Legends: conquer trigger and optional pay → ready-your-legend structure", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, { event: "conquer", here: true, player: "self" });
  assert.equal(ability.optional, true);
  assert.equal(choice.op, "choice.optional");
  assert.deepEqual(choice.args.body.value.map(instruction => instruction.id), [
    "hall-of-legends.pay",
    "hall-of-legends.ready"
  ]);

  assert.equal(pay.op, "cost.pay");
  assert.deepEqual(pay.args.energy, constant(1));
  assert.deepEqual(pay.args.power, constant([]));

  // 355.10.g: "your legend" does not target, so it is a resolution-time
  // non-target choose selection, not a TargetSpec.
  assert.equal(readyLegend.op, "effect.ready");
  assert.equal(readyLegend.linkedTo, "hall-of-legends.pay");
  assert.equal(readyLegend.targets, undefined);
  assert.deepEqual(legendSelection, {
    kind: "choose",
    id: "hall-of-legends.legend",
    filter: { type: "legend", controller: "self" },
    min: 1,
    max: 1
  });
});

test("sfd-210-221 Hall of Legends: the ready half resolves an exhausted legend through effect.ready", () => {
  const kernel = world()
    .unit("legend-1", { types: ["legend"], exhausted: true, zone: "board", location: BASE })
    .build();
  // The reference kernel resolves ObjectFilter controller literals directly
  // (test-kernel.ts matchesFilter), so the symbolic "self" is supplied as the
  // concrete controller here; the card keeps the selector spelling.
  const args = {
    objects: constant({ ...legendSelection, filter: { ...legendSelection.filter, controller: "A" } })
  };
  const run = runInstruction(ready, args, {
    world: kernel,
    answers: { "hall-of-legends.legend": [kernel.ref("legend-1")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("legend-1").exhausted, false);
  assert.deepEqual(run.linked.readied, { count: 1, objects: [kernel.ref("legend-1")] });
  assert.deepEqual(run.events.map(event => event.action), ["ready"]);
  // 416.1.a: the legend keeps its printed characteristics and location.
  assert.deepEqual(kernel.getObject("legend-1").location, BASE);
  assert.deepEqual(kernel.getObject("legend-1").types, ["legend"]);
});

test("sfd-210-221 Hall of Legends: an already-ready legend stays ready (416.1.b/416.1.c, no extra event)", () => {
  const kernel = world()
    .unit("legend-1", { types: ["legend"], exhausted: false, zone: "board", location: BASE })
    .build();
  const args = {
    objects: constant({ ...legendSelection, filter: { ...legendSelection.filter, controller: "A" } })
  };
  const run = runInstruction(ready, args, {
    world: kernel,
    answers: { "hall-of-legends.legend": [kernel.ref("legend-1")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("legend-1").exhausted, false);
  assert.deepEqual(run.linked.readied, { count: 0, objects: [] });
  assert.deepEqual(run.events, []);
});

// The 1-energy payment has no merged primitive (RIFT-89 cost.*).
test.todo(
  "sfd-210-221 Hall of Legends: pay 1 energy before readying the legend (cost.pay, RIFT-89)"
);
test.todo(
  "sfd-210-221 Hall of Legends: 383.3.b base-cost handling for the cost within instructions right after 'you may' (cost/trigger Finalize)"
);
