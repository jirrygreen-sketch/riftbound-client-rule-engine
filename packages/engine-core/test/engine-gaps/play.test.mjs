import assert from "node:assert/strict";
import test from "node:test";

import theHarrowing from "../../../card-dsl/dist/cards/ogn/the-harrowing.js";
import blindFury from "../../../card-dsl/dist/cards/ogn/blind-fury.js";
import hereToHelp from "../../../card-dsl/dist/cards/sfd/here-to-help.js";
import royalGuard from "../../../card-dsl/dist/cards/sfd/royal-guard.js";
import akaliBrash from "../../../card-dsl/dist/cards/rad/akali-brash.js";
import supernova from "../../../card-dsl/dist/cards/rad/supernova.js";
import playfulPhantom from "../../../card-dsl/dist/cards/ogn/playful-phantom.js";
import { AwaitChoice } from "../../dist/effects/contract.js";
import { world } from "../../dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../dist/events/action-adapter.js";
import { ChainEngine } from "../../dist/chain/engine.js";
import { createProgramBinding } from "../../dist/programs/index.js";
import { instructionDefinitionsById } from "../../dist/effects/instructions/registry.generated.js";
import { CostPlanError } from "../../dist/cost/plan-types.js";
import { ProgramBindingError } from "../../dist/programs/errors.js";
import { playPermissions } from "../../dist/programs/play-permissions.js";
import { ContinuousEffectRegistry } from "../../dist/layers/duration.js";
import { resolveChainBody } from "../../dist/chain/interpreter-adapter.js";

const HARROWING_ID = theHarrowing.canonicalCardId;
const HERE_TO_HELP_ID = hereToHelp.canonicalCardId;
const BLIND_FURY_ID = blindFury.canonicalCardId;
const ROYAL_GUARD_ID = royalGuard.canonicalCardId;
const AKALI_ID = akaliBrash.canonicalCardId;
const field = id => ({ type: "battlefield", id });
const base = player => ({ type: "base", player });

// Only admission metadata changes in this test registry. The imported
// abilities, bodies, targets and cost descriptors remain the shipped IR.
const admitted = program => ({ ...program, status: "executable", judgeReason: undefined });

function runtime(programs, setup, { answers = {}, transaction = false, power = ["Chaos", "Chaos", "Order", "Order"] } = {}) {
  const builder = world().player("A", { energy: 30, power }).player("B", { energy: 30, power: ["Order", "Order"] });
  setup(builder);
  const kernel = builder.build();
  const answerMap = new Map(Object.entries(answers));
  const asked = [];
  const choose = request => {
    asked.push(request);
    if (answerMap.has(request.id)) return answerMap.get(request.id);
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) return [...request.options];
    if (request.type === "select-objects" && request.min === 0) return [];
    throw new AwaitChoice(request);
  };
  const transactionBoundary = transaction ? run => {
    const state = kernel.snapshot();
    const links = kernel.clone();
    try {
      const result = run();
      if (result.status === "negated") {
        kernel.restore(state);
        kernel.copyLinkedFrom(links);
      }
      return result;
    } catch (error) {
      kernel.restore(state);
      kernel.copyLinkedFrom(links);
      throw error;
    }
  } : undefined;
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
      ...(transactionBoundary === undefined ? {} : { transaction: transactionBoundary }),
    }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const binding = createProgramBinding({ cardPrograms: programs.map(admitted) });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host,
    describePlay: binding.describePlay, cleanup: () => false,
  });
  return { kernel, engine, binding, answers: answerMap, asked };
}

function settle(engine, budget = 100) {
  let guard = 0;
  while (true) {
    engine.advance();
    if (!engine.items.length) return;
    assert.ok(++guard < budget, "the real chain must settle without synchronous recursion");
    engine.pass(engine.priority);
  }
}

function playFromHand(runtimeState, id, options = {}) {
  const source = runtimeState.kernel.getObject(id);
  const draft = runtimeState.binding.describePlay({ type: "play", player: "A", object: runtimeState.kernel.ref(id), ...(options.location === undefined ? {} : { location: options.location }) }, source);
  runtimeState.engine.execute(draft);
  return draft;
}

function effectPlay(program) {
  const play = program.abilities.find(ability => ability.kind === "play");
  return play?.body.find(instruction => instruction.op === "effect.play");
}

test("the shipped Harrowing IR turns a selected trash Unit into a finalized ignore-Energy plan that keeps Power", () => {
  const instruction = effectPlay(theHarrowing);
  assert.equal(instruction.id, "the-harrowing.play-unit");
  assert.deepEqual(instruction.args.cost.value, { kind: "cost.modify", ignore: "energy" });

  const f = runtime([theHarrowing, supernova], builder => {
    builder.card("unit", { cardId: supernova.canonicalCardId, types: ["unit"], zone: "trash", energy: 9, power: ["Order"], owner: "A" });
    builder.unit("victim", { owner: "B", controller: "B", types: ["unit"], might: 20 });
    builder.hand("spell", { cardId: HARROWING_ID, types: ["spell"], energy: 6, power: ["Chaos"] });
  });
  f.kernel.addReplacement(() => null);
  playFromHand(f, "spell");
  settle(f.engine);

  assert.equal(f.kernel.getObject("unit").zone, "board");
  assert.equal(f.kernel.player("A").energy, 24, "only the outer spell's Energy was paid; the selected card ignored its 9 Energy");
  assert.deepEqual(f.kernel.player("A").power, ["Order"], "printed Order Power was actually paid");
  const pending = f.engine.trace.filter(entry => entry.step === "pending").map(entry => entry.item);
  assert.equal(pending.length, 2, "outer spell plus a separate nested Play chain item");
  assert.notEqual(pending[0], pending[1]);
  const costPlan = f.kernel.linked("the-harrowing.play-unit.playedCostPlans");
  assert.equal(Array.isArray(costPlan), true);
  assert.equal(costPlan[0].energy, 0);
  assert.deepEqual(costPlan[0].power, ["Order"]);
  assert.equal(costPlan[0].parameters.costPlan.modifications[0].ignore, "energy");
});

test("the Harrowing's selected-object Power requirement rejects a player who only has another Domain", () => {
  const f = runtime([theHarrowing, supernova], builder => {
    builder.card("unit", { cardId: supernova.canonicalCardId, types: ["unit"], zone: "trash", energy: 9, power: ["Order"], owner: "A" });
    builder.unit("victim", { owner: "B", controller: "B", types: ["unit"], might: 20 });
    builder.hand("spell", { cardId: HARROWING_ID, types: ["spell"], energy: 6, power: ["Chaos"] });
  }, { power: ["Chaos", "Chaos"] });
  // The outer spell pays two Chaos Power; the nested Unit then has none and
  // must fail rather than borrowing an allowed Domain from the plan.
  playFromHand(f, "spell");
  settle(f.engine);
  assert.equal(f.kernel.getObject("unit").zone, "trash");
  assert.equal(f.kernel.player("A").energy, 24);
  assert.deepEqual(f.kernel.player("A").power, []);
});

test("Power-only ignore keeps the selected card's printed Energy and pays its actual Power", () => {
  const instruction = {
    ...effectPlay(theHarrowing),
    id: "test.play-power-ignored",
    args: {
      target: { kind: "constant", value: "unit-in-trash" },
      cost: { kind: "constant", value: { kind: "cost.modify", ignore: "power" } },
    },
    targets: [{ id: "unit-in-trash", filter: { zone: "trash", type: "unit", owner: "controller" }, min: 1, max: 1, selection: "one" }],
  };
  const f = runtime([supernova], builder => {
    builder.card("unit", { cardId: supernova.canonicalCardId, types: ["unit"], zone: "trash", energy: 9, power: ["Order"], owner: "A" });
    builder.unit("victim", { owner: "B", controller: "B", types: ["unit"], might: 20 });
  });
  const context = bindResolveContext(f.kernel, {
    source: f.kernel.getObject("unit"), controller: "A", timingPoint: "chain-item-resolve",
    targets: id => id === "unit-in-trash" ? [f.kernel.ref("unit")] : [],
    perform: action => f.kernel.perform(action),
  });
  const result = resolveChainBody([instruction], context).results[0].result;
  assert.equal(result.status, "executed");
  assert.equal(f.kernel.player("A").energy, 21, "the selected card's 9 Energy remains payable");
  assert.deepEqual(f.kernel.player("A").power, ["Chaos", "Chaos", "Order", "Order"], "Power is ignored");
  const plan = f.kernel.linked("test.play-power-ignored.playedCostPlans")[0];
  assert.equal(plan.energy, 9);
  assert.deepEqual(plan.power, []);
  assert.deepEqual(plan.parameters.costPlan.modifications, [{ kind: "ignore-base", ignore: "power" }]);
});

test("Here to Help's shipped -3 Energy descriptor derives the selected unit's plan through the production Chain", () => {
  const optional = hereToHelp.abilities.find(ability => ability.kind === "play").body[0];
  const battlefieldChoice = optional.args.body.value[0];
  const play = optional.args.body.value[1];
  assert.equal(play.args.cost.value.amount, -3);
  const program = {
    ...hereToHelp,
    canonicalCardId: "test:eg-play-here-to-help",
    abilities: [{
      kind: "play",
      cost: hereToHelp.abilities.find(ability => ability.kind === "play").cost,
      body: [battlefieldChoice, {
        ...play,
        args: { ...play.args, pick: { kind: "constant", value: "unit" } },
        picks: [{ id: "unit", options: ["dynamic:unit-card-in-controller-hand"], filter: { zone: "hand", type: "unit", owner: "self" }, min: 1, max: 1, selection: "one" }],
      }],
    }],
  };
  const f = runtime([program, supernova], builder => {
    builder.unit("field-1", { owner: "A", controller: "A", types: ["battlefield"], location: { type: "battlefield", id: "field-1" } });
    builder.hand("unit", { cardId: supernova.canonicalCardId, types: ["unit"], energy: 9, power: ["Order"], owner: "A" });
    builder.unit("victim", { owner: "B", controller: "B", types: ["unit"], might: 20 });
    builder.hand("spell", { cardId: program.canonicalCardId, types: ["spell"], energy: 2, power: ["Chaos"] });
  });
  f.answers.set("here-to-help.choose-battlefield/here-to-help.battlefield", { type: "battlefield", id: "field-1" });
  f.kernel.setPicks("here-to-help.unit", [f.kernel.ref("unit")]);
  playFromHand(f, "spell");
  settle(f.engine);
  assert.equal(f.kernel.getObject("unit").zone, "board");
  assert.equal(f.kernel.player("A").energy, 22, "outer 2 plus selected card's 9-3 discounted Energy");
  assert.deepEqual(f.kernel.player("A").power, ["Chaos", "Order"]);
  const plan = f.kernel.linked("here-to-help.play-unit.playedCostPlans");
  assert.equal(plan[0].energy, 6);
  assert.deepEqual(plan[0].power, ["Order"]);
  assert.equal(plan[0].parameters.discounts[0].before, 9);
  assert.equal(plan[0].parameters.discounts[0].after, 6);
});

test("an exact catalog cost preserves later mandatory additions and increases in the nested Play", () => {
  const program = {
    ...theHarrowing,
    canonicalCardId: "test:eg-play-additions",
    abilities: [{
      kind: "play",
      cost: { kind: "printed", energy: { kind: "constant", value: 2 }, power: { kind: "constant", value: 1 } },
      body: [{
        id: "eg-play-additions.play-unit",
        op: "effect.play",
        args: {
          target: { kind: "constant", value: "unit-in-trash" },
          cost: { kind: "constant", value: { kind: "cost.modify", ignore: "energy", mandatoryAdditional: [{ id: "tax", cost: { energy: { kind: "constant", value: 1 } } }], increases: [{ id: "increase", cost: { energy: { kind: "constant", value: 2 } } }] } },
        },
        targets: [{ id: "unit-in-trash", filter: { zone: "trash", type: "unit", owner: "controller" }, min: 1, max: 1, selection: "one" }],
      }],
    }],
  };
  const f = runtime([program, supernova], builder => {
    builder.card("unit", { cardId: supernova.canonicalCardId, types: ["unit"], zone: "trash", energy: 9, power: ["Order"], owner: "A" });
    builder.unit("victim", { owner: "B", controller: "B", types: ["unit"], might: 20 });
    builder.hand("spell", { cardId: program.canonicalCardId, types: ["spell"], energy: 2, power: ["Chaos"] });
  });
  playFromHand(f, "spell");
  settle(f.engine);
  assert.equal(f.kernel.getObject("unit").zone, "board");
  assert.equal(f.kernel.player("A").energy, 25, "outer 2 + retained 1 + retained 2");
  assert.deepEqual(f.kernel.player("A").power, ["Chaos", "Order"]);
  const plan = f.kernel.linked("eg-play-additions.play-unit.playedCostPlans")[0];
  assert.equal(plan.energy, 3);
  assert.deepEqual(plan.power, ["Order"]);
  assert.deepEqual(plan.parameters.selectedAdditional, []);
});

test("an unknown or malformed cost descriptor remains judge-required through the default Chain", () => {
  const program = {
    ...hereToHelp,
    canonicalCardId: "test:eg-play-unknown",
    abilities: [{
      kind: "play",
      cost: { kind: "printed", energy: { kind: "constant", value: 1 }, power: { kind: "constant", value: 1 } },
      body: [{
        id: "unknown.play",
        op: "effect.play",
        args: { target: { kind: "constant", value: "card" }, cost: { kind: "constant", value: { kind: "cost.modify", mystery: true } } },
        targets: [{ id: "card", filter: { zone: "hand", type: "unit", owner: "controller" }, min: 1, max: 1, selection: "one" }],
      }],
    }],
  };
  const selectedProgram = {
    ...playfulPhantom,
    canonicalCardId: "test:eg-play-unknown-selected",
    status: "executable",
    judgeReason: undefined,
  };
  const f = runtime([program, selectedProgram], builder => {
    builder.hand("card", { cardId: selectedProgram.canonicalCardId, types: ["unit"], energy: 1, power: ["Chaos"] });
    builder.hand("spell", { cardId: program.canonicalCardId, types: ["spell"], energy: 1, power: ["Chaos"] });
  });
  const direct = bindResolveContext(f.kernel, {
    source: f.kernel.getObject("spell"), controller: "A", timingPoint: "chain-item-resolve",
    targets: id => id === "card" ? [f.kernel.ref("card")] : [],
    perform: action => f.kernel.perform(action),
  });
  assert.throws(() => instructionDefinitionsById.get("effect.play").execute(direct, {
    target: "card", cost: { kind: "constant", value: { kind: "cost.modify", mystery: true } },
  }), error => error instanceof CostPlanError && error.reason === "judge-required");
  playFromHand(f, "spell");
  assert.throws(() => settle(f.engine), error =>
    (error instanceof ProgramBindingError && error.code === "judge-required") ||
    (error instanceof CostPlanError && error.reason === "judge-required"));
  assert.equal(f.kernel.getObject("card").zone, "hand");
});

test("the shipped Blind Fury IR does not infer an ignore-cost rule from source text", () => {
  const instruction = effectPlay(blindFury);
  assert.equal(instruction.args.cost, undefined);
  const f = runtime([blindFury, supernova], builder => {
    builder.card("unit", { cardId: supernova.canonicalCardId, types: ["unit"], zone: "banishment", energy: 9, power: ["Order"] });
    builder.hand("spell", { cardId: BLIND_FURY_ID, types: ["spell"], energy: 4, power: ["Fury"] });
  });
  const context = bindResolveContext(f.kernel, {
    source: f.kernel.getObject("spell"), controller: "A", timingPoint: "chain-item-resolve",
    linked: key => key === "blind-fury.banish-chosen.banishedObject" ? f.kernel.ref("unit") : undefined,
    perform: action => f.kernel.perform(action),
  });
  const result = resolveChainBody([{
    ...instruction,
    linkedTo: undefined,
    args: { object: { kind: "constant", value: f.kernel.ref("unit") } },
  }], context).results[0].result;
  assert.equal(result.status, "executed");
  assert.equal(f.kernel.getObject("unit").zone, "board");
  assert.equal(f.kernel.player("A").energy, 21, "the 9 printed Energy is still paid");
  assert.deepEqual(f.kernel.player("A").power, ["Chaos", "Chaos", "Order"], "the printed Power is still paid");
});

test("a replaced nested Play is negated and the enclosing transaction rolls back earlier commits", () => {
  const f = runtime([theHarrowing, supernova], builder => {
    builder.card("first", { cardId: supernova.canonicalCardId, types: ["unit"], zone: "trash", energy: 9, power: ["Order"] });
    builder.card("second", { cardId: supernova.canonicalCardId, types: ["unit"], zone: "trash", energy: 9, power: ["Order"] });
    builder.hand("spell", { cardId: HARROWING_ID, types: ["spell"], energy: 6, power: ["Chaos"] });
  }, { transaction: true });
  f.binding = createProgramBinding({ cardPrograms: [admitted(theHarrowing), admitted(supernova)] });
  f.kernel.addReplacement(action => action.type === "play" && action.object.id === "second" ? "prevented" : null);
  // Use the effect primitive's outer transaction seam directly so both selected
  // cards are one instruction, without rewriting the card program.
  const context = bindResolveContext(f.kernel, {
    source: f.kernel.getObject("spell"), controller: "A", timingPoint: "chain-item-resolve",
    targets: id => id === "units" ? [f.kernel.ref("first"), f.kernel.ref("second")] : [],
    perform: action => f.kernel.perform(action),
    transaction: run => {
      const before = f.kernel.snapshot();
      const result = run();
      if (result.status === "negated") f.kernel.restore(before);
      return result;
    },
  });
  const result = instructionDefinitionsById.get("effect.play").execute(context, { target: "units", amount: { kind: "constant", value: 2 } });
  assert.equal(result.status, "negated");
  assert.equal(f.kernel.getObject("first").zone, "trash");
  assert.equal(f.kernel.getObject("second").zone, "trash");
});

test("the shipped Royal Guard token handoff creates a zero-cost Play chain item without recursing its trigger", () => {
  const tokenInstruction = royalGuard.abilities[0].body[0];
  const playInstruction = royalGuard.abilities[0].body[1];
  assert.equal(tokenInstruction.args.mode.value, "play");
  assert.equal(playInstruction.args.cost, undefined);
  const f = runtime([royalGuard], builder => {
    builder.unit("guard", { cardId: ROYAL_GUARD_ID, types: ["unit"], energy: 4, power: null, location: field("one") });
  });
  f.kernel.setAnswers({});
  const context = bindResolveContext(f.kernel, {
    source: f.kernel.getObject("guard"), controller: "A", timingPoint: "chain-item-resolve",
    perform: action => f.kernel.perform(action),
  });
  const token = instructionDefinitionsById.get("effect.token").execute(context, {
    token: { kind: "constant", value: "sand-soldier" }, amount: { kind: "constant", value: 1 },
    mode: { kind: "constant", value: "play" }, location: { kind: "constant", value: field("one") },
    linkKey: { kind: "constant", value: "sandSoldier" },
  });
  assert.equal(token.status, "executed");
  const tokenRef = token.linkedValues["sandSoldier.objects"][0];
  assert.equal(f.kernel.getObject(tokenRef.id).zone, "board");
  assert.equal(f.kernel.history({ action: "create-token" }), 1);
  assert.equal(f.kernel.history({ action: "play" }), 1);
});

test("a source permission remains a distinct registration and is consumed without turning ignored costs into free costs", () => {
  const f = runtime([akaliBrash], builder => {
    builder.card("banished", { cardId: "card:permission", types: ["unit"], zone: "banishment", energy: 2, power: ["Fury"], owner: "A" });
    builder.unit("source", { cardId: AKALI_ID, energy: 4, power: ["Chaos", "Chaos"] });
  });
  const context = bindResolveContext(f.kernel, {
    source: f.kernel.getObject("source"), controller: "A", timingPoint: "chain-item-resolve",
    linked: key => key === "akaliBanish.objects" ? [f.kernel.ref("banished")] : undefined,
    addContinuous: (effect, duration) => f.kernel.addContinuous(effect, duration),
    perform: action => f.kernel.perform(action),
  });
  const grant = akaliBrash.abilities[1].body[1];
  const result = instructionDefinitionsById.get("effect.play-permission").execute(context, {
    objects: grant.args.objects,
    zone: grant.args.zone,
    payCosts: grant.args.payCosts,
    until: grant.args.until,
  });
  assert.equal(result.status, "executed");
  const registry = new ContinuousEffectRegistry();
  for (const entry of f.kernel.continuousEffects) registry.register(entry.effect, entry.duration);
  const permissions = playPermissions(registry, f.kernel.getObject("banished"));
  assert.equal(permissions.length, 1);
  assert.equal(permissions[0].payCosts, true);
  assert.equal(f.kernel.getObject("banished").zone, "banishment", "permission alone does not move or play the object");
});

test("a known no-ability program uses the exact runtime catalog cost instead of a guessed free Play", () => {
  const f = runtime([playfulPhantom], builder => {
    builder.hand("unit", { cardId: playfulPhantom.canonicalCardId, types: ["unit"], energy: 5, power: null });
  });
  const context = bindResolveContext(f.kernel, {
    source: f.kernel.getObject("unit"), controller: "A", timingPoint: "chain-item-resolve",
    targets: id => id === "card" ? [f.kernel.ref("unit")] : [],
    perform: action => f.kernel.perform(action),
  });
  const result = instructionDefinitionsById.get("effect.play").execute(context, { target: "card" });
  assert.equal(result.status, "executed");
  assert.equal(f.kernel.getObject("unit").zone, "board");
  assert.equal(f.kernel.player("A").energy, 25);
  assert.deepEqual(f.kernel.player("A").power, ["Chaos", "Chaos", "Order", "Order"]);
});
