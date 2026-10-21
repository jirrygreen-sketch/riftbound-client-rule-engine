// Production-path golden for Plundering Poro (sfd-069-221).
//
// The public TurnFlow performs a real Move and Showdown close, emits Conquer,
// the production program binding registers the card's original trigger, and
// ChainEngine puts that trigger through Pending/Finalize/Resolve. The Gold
// half stays fail-closed because CR 187.5's canonical token carries a printed
// Universal Power ability that is not executable under the current contract.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/plundering-poro.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { getTokenDefinition } from "../../../../engine-core/dist/effects/tokens/definitions.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { TurnFlow } from "../../../../engine-core/dist/turn/flow.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-569dc9079a6d404c0d850d27b510585b856ab3def5e1e0bbafa30a3bf9d48e82";
const GOLD_ID = "card.hash-6249df4367d0a2e088c8eb1117ef59430f0d7dad4bf0fcf8a01d7f0415f4d511";
const SOURCE_TEXT = "When I conquer, play a Gold gear token exhausted.";
const [ability] = program.abilities;
const [playGold] = ability.body;

// The card itself is judge-required, so this transparent runtime lift lets the
// tests exercise its unchanged authored trigger/body in the production binder.
// The shipped program and registry below remain unmodified and non-executable.
const admitted = { ...program, status: "executable", judgeReason: undefined };

function productionFixture(scenario) {
  let builder = world().player("A").player("B");
  for (const player of ["A", "B"]) {
    builder = builder
      .deck(Array.from({ length: 8 }, (_, index) => `${player}:deck:${index}`), { owner: player })
      .rune(Array.from({ length: 8 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  builder = builder.unit("poro", {
    cardId: CARD_ID,
    owner: "A",
    controller: "A",
    types: ["unit"],
    might: 2,
    location: { type: "base", player: "A" }
  });
  if (scenario === "opponent") {
    builder = builder.unit("enemy", {
      owner: "B",
      controller: "B",
      types: ["unit"],
      might: 5,
      location: { type: "battlefield", id: "bf1" }
    });
  }
  if (scenario === "other-unit") {
    builder = builder.unit("other", {
      owner: "A",
      controller: "A",
      types: ["unit"],
      might: 3,
      location: { type: "base", player: "A" }
    });
  }
  const kernel = builder.build();
  const requests = [];
  const choose = request => {
    requests.push(request);
    if (request.type === "select-objects" && request.min === request.max &&
        request.options.length === request.min) return [...request.options];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const flow = new TurnFlow({
    host,
    player: id => kernel.player(id),
    turnOrder: ["A", "B"],
    battlefields: [{ id: "bf1", controller: null }, { id: "bf2", controller: null }]
  });
  const binding = createProgramBinding({ cardPrograms: [admitted] });
  const errors = [];
  binding.attachLifecycle(flow.chain, (error, source) =>
    errors.push({ error, sourceId: source.ref.id }));
  const registered = binding.registerProgramTriggers(flow.chain, kernel.getObject("poro"));
  const fired = [];
  const appendTrigger = flow.chain.pipeline.onTrigger;
  flow.chain.pipeline.onTrigger = snapshot => {
    fired.push(snapshot);
    appendTrigger(snapshot);
  };
  const passes = [];
  const settle = (budget = 80) => {
    for (let guard = 0; guard < budget; guard++) {
      if (flow.chain.items.length) {
        passes.push({ type: "priority", player: flow.chain.priority });
        flow.pass(flow.chain.priority);
        continue;
      }
      if (flow.chain.focus) {
        passes.push({ type: "focus", player: flow.chain.focus });
        flow.pass(flow.chain.focus);
        continue;
      }
      return;
    }
    throw new Error("production TurnFlow did not settle");
  };
  const move = (id, battlefieldId) => flow.execute({
    id: `${id}-move`,
    controller: "A",
    source: kernel.getObject(id),
    kind: "activated",
    speed: "normal",
    body: [{
      id: `${id}-move-effect`,
      op: "effect.move",
      args: { to: { kind: "constant", value: { type: "battlefield", id: battlefieldId } } }
    }]
  });
  flow.start();
  return { kernel, flow, registered, errors, fired, passes, requests, settle, move };
}

function conquers(f) {
  return f.flow.chain.pipeline.events.filter(event => event.timingPoint === "conquer");
}

test("sfd-069-221 Plundering Poro: program validates and remains judge-required for the real Gold ability", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(program.status, "judge-required");
  assert.equal(cardRegistryById.get(CARD_ID), program);

  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /Universal Power/);
  assert.match(program.judgeReason, /135\.2\.e\.5/);
  assert.match(program.judgeReason, /163\.2\.b/);
  assert.match(program.judgeReason, /definitions\.ts:100/);
  assert.match(program.judgeReason, /effect\.token\.ts:341/);
  assert.match(program.judgeReason, /programs\/lifecycle\.ts:331/);
  assert.match(program.judgeReason, /chain\/engine\.ts:1194-1200/);
  assert.match(program.judgeReason, /exhausted entry/);
  assert.doesNotMatch(program.judgeReason, /carrier identity|no entry override/);

  const gold = getTokenDefinition("gold");
  assert.ok(gold);
  assert.equal(gold.spec.cardId, GOLD_ID);
  assert.equal(gold.abilityBinding, "blocked");
  assert.equal(gold.blockedReason, "token-definition-or-abilities-judge-required");
});

test("sfd-069-221 Plundering Poro structure: self Conquer and exhausted play entry", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, {
    event: "conquer",
    filter: { source: "self" }
  });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.body.length, 1);
  assert.equal(playGold.id, "play-gold");
  assert.equal(playGold.op, "effect.token");
  assert.deepEqual(playGold.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(playGold.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(playGold.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playGold.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  assert.deepEqual(playGold.args.entersExhausted, { kind: "constant", value: true });
  assert.equal(playGold.targets, undefined);
  assert.equal(playGold.picks, undefined);
});

test("sfd-069-221 Plundering Poro production golden: this Unit Conquers, the exact trigger resolves, Gold fails closed", () => {
  const f = productionFixture("self");
  assert.deepEqual(f.registered, ["program:poro:1:0"]);
  assert.deepEqual(f.errors, []);

  f.move("poro", "bf1");
  f.settle();

  const conquerEvents = conquers(f);
  assert.equal(conquerEvents.length, 1);
  const [conquer] = conquerEvents;
  assert.equal(conquer.player, "A");
  assert.equal(conquer.object.ref.id, "poro");
  assert.equal(conquer.source.ref.id, "poro");
  assert.equal(conquer.it.ref.id, "poro");
  assert.deepEqual(conquer.object.location, { type: "battlefield", id: "bf1" });
  assert.deepEqual(conquer.details, {
    battlefieldId: "bf1",
    battlefieldControllerBefore: null,
    objectId: "poro",
    playerId: "A"
  });
  assert.equal(f.kernel.player("A").score, 1);
  assert.equal(f.flow.battlefields[0].controller, "A");

  const translated = translateTriggerFilter(ability.trigger.filter, "poro", "conquer");
  assert.equal(matchesTriggerEvent(translated, conquer, "A"), true);
  assert.equal(f.fired.length, 1, "Poro's one text creates exactly one trigger snapshot");
  assert.equal(f.fired[0].registration.id, "program:poro:1:0");
  assert.equal(f.fired[0].source.ref.id, "poro");
  assert.equal(f.fired[0].registration.optional, false);
  assert.equal(f.fired[0].registration.cost, undefined);
  assert.equal(f.fired[0].registration.mayAtFinalize, undefined);

  // The trigger entered the real Chain and passed through the production
  // response windows before Resolve; no test callback settles its body.
  const timeline = f.flow.chain.pipeline.events.map(event => event.timingPoint);
  const conquerAt = timeline.indexOf("conquer");
  const pendingAt = timeline.indexOf("chain-item-pending", conquerAt);
  const finalizeAt = timeline.indexOf("chain-item-finalize", pendingAt);
  const resolveAt = timeline.indexOf("chain-item-resolve", finalizeAt);
  assert.ok(conquerAt >= 0 && conquerAt < pendingAt && pendingAt < finalizeAt && finalizeAt < resolveAt);
  assert.ok(f.passes.some(entry => entry.type === "priority" && entry.player === "A"));
  assert.ok(f.passes.some(entry => entry.type === "priority" && entry.player === "B"));

  const receipt = f.kernel.linked("play-gold.token");
  assert.equal(receipt.amount, 0);
  assert.equal(receipt.createdAmount, 0);
  assert.deepEqual(receipt.objects, []);
  assert.deepEqual(receipt.createdObjects, []);
  assert.equal(receipt.blockedReason, "token-definition-or-abilities-judge-required");
  assert.equal(f.kernel.linked("play-gold.token.amount"), 0);
  assert.deepEqual(f.kernel.linked("play-gold.token.objects"), []);
  assert.deepEqual(f.kernel.objects.filter(object => object.isToken), []);
  assert.equal(f.requests.length, 0, "this mandatory text asks for no card-specific choice");
});

for (const [name, scenario, battlefieldId] of [
  ["opponent", "opponent", "bf1"],
  ["another A Unit", "other-unit", "bf2"]
]) {
  test(`sfd-069-221 Plundering Poro production counterexample: ${name} Conquers without triggering Poro`, () => {
    const f = productionFixture(scenario);
    assert.deepEqual(f.errors, []);
    if (scenario === "other-unit") f.move("other", battlefieldId);
    f.settle();

    const conquerEvents = conquers(f);
    assert.equal(conquerEvents.length, 1);
    assert.equal(conquerEvents[0].object.ref.id, scenario === "opponent" ? "enemy" : "other");
    assert.equal(conquerEvents[0].details.battlefieldId, battlefieldId);
    assert.equal(f.fired.length, 0);
    assert.equal(f.flow.chain.trace.filter(entry => entry.step === "pending").length, scenario === "other-unit" ? 1 : 0,
      "only the explicit Move item may be pending");
    assert.equal(f.kernel.linked("play-gold.token"), undefined);
    assert.deepEqual(f.kernel.objects.filter(object => object.isToken), []);
  });
}
