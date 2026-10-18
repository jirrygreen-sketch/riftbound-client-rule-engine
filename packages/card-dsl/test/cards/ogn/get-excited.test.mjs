import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/get-excited.js";
import discard from "../../../../engine-core/dist/effects/instructions/effect.discard.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const [speed, play] = program.abilities;
const discardInstruction = play.body[0];
const damageInstruction = play.body[1];
const targetSpec = damageInstruction.targets[0];

test("Get Excited! program is valid executable EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
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

test("Get Excited! golden execution: the linked discarded card's Energy cost deals damage after it changes zones", () => {
  const kernel = world()
    .hand("chosen-card", { types: ["spell"], energy: 2, power: ["Fury"] })
    .hand("kept-card", { types: ["spell"], energy: 4 })
    .unit("victim", { owner: "B", location: { type: "battlefield", id: "bf-1" }, damage: 0 })
    .build();
  const chosen = kernel.ref("chosen-card");
  kernel.setAnswers({ "get-excited.discard-1/effect.discard%3AA": [chosen] });
  kernel.setTargets(targetSpec.id, [kernel.ref("victim")]);

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status, result.result.reason]),
    [
      ["get-excited.discard-1", "executed", undefined],
      ["get-excited.deal-energy-cost", "executed", undefined]
    ]
  );
  assert.deepEqual(outcome.linkedValues["get-excited.discard-1.discarded"], {
    count: 1,
    player: "A",
    objects: [chosen]
  });
  assert.equal(kernel.getObject("chosen-card").zone, "trash");
  assert.equal(kernel.getObject("kept-card").zone, "hand");
  assert.equal(kernel.object(chosen), null, "the characteristic read uses the pre-discard incarnation");
  assert.equal(kernel.getObject("victim").damage, 2, "Power is excluded from the damage amount");
  assert.deepEqual(outcome.events.map(event => event.action), ["discard", "damage"]);
});

test("Get Excited! does not damage a locked unit at a base", () => {
  const kernel = world()
    .hand("discarded", { energy: 4, power: ["Fury"] })
    .base("victim", { owner: "B", damage: 0 })
    .build();
  kernel.setAnswers({ "get-excited.discard-1/effect.discard%3AA": [kernel.ref("discarded")] });
  kernel.setTargets(targetSpec.id, [kernel.ref("victim")]);
  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.results[1].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("discarded").zone, "trash");
  assert.equal(kernel.getObject("victim").damage, 0);
  assert.deepEqual(outcome.events.map(event => event.action), ["discard"]);
});

test("Get Excited! with no card to discard does not invent an Energy cost", () => {
  const kernel = world().unit("victim", { owner: "B", damage: 0 }).build();
  kernel.setTargets(targetSpec.id, [kernel.ref("victim")]);
  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[1].result.status, "ignored");
  assert.equal(kernel.getObject("victim").damage, 0);
  assert.deepEqual(outcome.events, []);
});

test("Get Excited! golden: the executable program pays its cost, locks a battlefield target, discards and deals the chosen card's Energy", () => {
  const kernel = world()
    .player("A", { energy: 20, power: ["Fury"] })
    .hand("get-excited", { cardId: program.canonicalCardId, types: ["spell"], energy: 2, power: ["Fury"], might: null })
    .hand("discarded", { types: ["unit"], energy: 4, power: ["Order", "Body"] })
    .hand("kept", { types: ["spell"], energy: 7 })
    .unit("victim", { owner: "B", might: 6, location: { type: "battlefield", id: "bf-1" } })
    .base("base-unit", { owner: "B", might: 6 })
    .build();
  const discarded = kernel.ref("discarded");
  const choose = request => {
    if (request.id === `target:${targetSpec.id}`) {
      assert.deepEqual(request.options, [kernel.ref("victim")]);
      return [kernel.ref("victim")];
    }
    if (request.id === "get-excited.discard-1/effect.discard%3AA") return [discarded];
    throw new AwaitChoice(request);
  };
  const binding = createProgramBinding({ cardPrograms: [program] });
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host,
    describePlay: binding.describePlay,
    cleanup: chain => {
      let changed = false;
      for (const object of kernel.objects) {
        if (object.zone === "board" && object.types.includes("unit") && object.might !== null &&
            (object.might <= 0 || object.damage >= object.might)) {
          changed = chain.commit({ type: "kill", object: object.ref }).status === "done" || changed;
        }
      }
      return changed;
    }
  });
  engine.execute(binding.describePlay({ type: "play", player: "A", object: kernel.ref("get-excited") }, kernel.getObject("get-excited")));
  assert.equal(kernel.player("A").energy, 18);
  assert.equal(kernel.getObject("discarded").zone, "hand", "discard happens at Resolve");
  resolveAll(engine);
  assert.equal(kernel.getObject("get-excited").zone, "trash");
  assert.equal(kernel.getObject("discarded").zone, "trash");
  assert.equal(kernel.getObject("kept").zone, "hand");
  assert.equal(kernel.getObject("victim").damage, 4);
  assert.equal(kernel.getObject("base-unit").damage, 0);
  assert.deepEqual(kernel.linked("get-excited.discard-1.discarded"), { count: 1, player: "A", objects: [discarded] });
  assert.equal(engine.pipeline.events.filter(event => event.timingPoint === "became-target").length, 1);
});
