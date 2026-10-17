import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/get-excited.js";
import discard from "../../../../engine-core/dist/effects/instructions/effect.discard.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [speed, play] = program.abilities;
const discardInstruction = play.body[0];
const damageInstruction = play.body[1];
const targetSpec = damageInstruction.targets[0];

test("Get Excited! program is valid EffectIR v2 data and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "judge-required");
  // The reason must name the real gap: the linked characteristic read cannot
  // resolve the discarded card from the producer's nested result binding.
  assert.match(program.judgeReason, /linked/);
  assert.match(program.judgeReason, /discard/);
  assert.match(program.judgeReason, /discarded/);
  assert.match(program.judgeReason, /ObjectRef/);
});

test("Get Excited! identity and sourceText match the printing", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-79956e42a3d826b547522f15e3706e341605f6f98ef9d9aad5caf3d03248a826"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Discard 1. Deal its Energy cost as damage to a unit at a battlefield. " +
      "(Ignore its Power cost.)"
  );
});

test("Get Excited! structure: [Action], Discard 1, linked Energy-cost damage at a battlefield", () => {
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  // Printed cost (2 Energy + 1 Fury power) comes from the catalog (206).
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });
  assert.deepEqual(
    play.body.map(instruction => [instruction.id, instruction.op]),
    [
      ["get-excited.discard-1", "effect.discard"],
      ["get-excited.deal-energy-cost", "effect.damage"]
    ]
  );

  // "Discard 1." — amount is the printed constant 1; the discarding player
  // chooses which card (423.1.a) and the primitive discards as much as possible
  // (423.4).
  assert.deepEqual(discardInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(discardInstruction.targets, undefined);
  assert.equal(discardInstruction.picks, undefined);

  // "Deal its Energy cost as damage": linked to the discard instruction, and
  // the amount reads the discarded card's printed Energy characteristic. The
  // Power cost is never read (the printed reminder says to ignore it).
  assert.equal(damageInstruction.linkedTo, "get-excited.discard-1");
  assert.deepEqual(damageInstruction.args.amount, {
    kind: "object-property",
    object: { linked: "get-excited.discard-1" },
    property: "energy"
  });
  assert.deepEqual(damageInstruction.args.target, {
    kind: "constant",
    value: "get-excited.unit-at-battlefield"
  });
  assert.equal(damageInstruction.targets.length, 1);
  assert.equal(targetSpec.id, "get-excited.unit-at-battlefield");
  assert.deepEqual(targetSpec.filter, { type: "unit", zone: "board" });
  assert.deepEqual(targetSpec.location, { type: "battlefield" });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");
  // "(Ignore its Power cost.)": the only Power in the program is the *spell's
  // own printed cost*; no characteristic read looks at the discarded card's
  // Power, so the damage amount can never be sized by it.
  const readsPower = [];
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value === null || typeof value !== "object") return;
    if (value.kind === "object-property" && value.property === "power") readsPower.push(value);
    Object.values(value).forEach(visit);
  };
  visit(program);
  assert.deepEqual(readsPower, []);
  assert.deepEqual(play.cost.power, { kind: "constant", value: 1 });
});

test("Get Excited! golden execution: Discard 1 moves the chosen card to the trash and links it", () => {
  const kernel = world()
    .hand("chosen-card", { types: ["spell"], energy: 2, power: ["Fury"] })
    .hand("kept-card", { types: ["spell"], energy: 4 })
    .build();
  const chosen = kernel.ref("chosen-card");

  const run = runInstruction(
    discard,
    { amount: discardInstruction.args.amount },
    { world: kernel, answers: { "effect.discard:A": [chosen] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.discarded.count, 1);
  assert.deepEqual(run.linked.discarded.objects, [chosen]);
  assert.equal(kernel.getObject("chosen-card").zone, "trash");
  assert.equal(kernel.getObject("kept-card").zone, "hand");
});

test("Get Excited! golden execution: the linked Energy read fails closed at the nested discard binding", () => {
  const kernel = world()
    .hand("chosen-card", { types: ["spell"], energy: 2, power: ["Fury"] })
    .hand("kept-card", { types: ["spell"], energy: 4 })
    .unit("victim", { owner: "B", location: { type: "battlefield" }, damage: 0 })
    .build();
  const chosen = kernel.ref("chosen-card");
  kernel.setAnswers({ "get-excited.discard-1/effect.discard%3AA": [chosen] });
  kernel.setTargets(targetSpec.id, [kernel.ref("victim")]);

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status, result.result.reason]),
    [
      ["get-excited.discard-1", "executed", undefined],
      ["get-excited.deal-energy-cost", "ignored", "mistargeted"]
    ]
  );
  assert.deepEqual(outcome.linkedValues["get-excited.discard-1.discarded"], {
    count: 1,
    player: "A",
    objects: [chosen]
  });
  assert.equal(kernel.getObject("victim").damage, 0);
  assert.deepEqual(outcome.events.map(event => event.action), ["discard"]);
});
