import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/sunken-temple.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { TurnFlow } from "../../../../engine-core/dist/turn/flow.js";

const field = (id = "bf1") => ({ type: "battlefield", id });
const constant = value => ({ kind: "constant", value });
const admitted = () => ({ ...program, status: "executable", judgeReason: undefined });

function runtime({ units = {}, give = true, enterThroughLifecycle = true, fields } = {}) {
  const builder = world().player("A", { energy: 2 }).player("B")
    .deck(Array.from({ length: 8 }, (_, index) => `A:deck:${index}`), { owner: "A" })
    .deck(Array.from({ length: 8 }, (_, index) => `B:deck:${index}`), { owner: "B" })
    .rune(Array.from({ length: 8 }, (_, index) => `A:rune:${index}`), { owner: "A" })
    .rune(Array.from({ length: 8 }, (_, index) => `B:rune:${index}`), { owner: "B" })
    .object("temple", {
      cardId: program.canonicalCardId,
      types: ["battlefield"],
      zone: enterThroughLifecycle ? "hand" : "board",
      location: enterThroughLifecycle ? null : field(),
      owner: "A",
      controller: "A",
      energy: null,
      power: null,
      might: null
    });
  for (const [id, values] of Object.entries(units)) {
    builder.unit(id, {
      owner: "A",
      controller: "A",
      power: [],
      location: field(),
      ...values
    });
  }
  const kernel = builder.build();
  const requests = [];
  const choose = request => {
    requests.push(request);
    if (request.type === "optional") return give;
    if (request.type === "mode") return request.options[0];
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new Error(`Unexpected production choice ${request.type} ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const binding = createProgramBinding({ cardPrograms: [admitted()] });
  const flow = new TurnFlow({
    host,
    player: id => kernel.player(id),
    turnOrder: ["A", "B"],
    battlefields: fields ?? [{ id: "bf1", controller: null }, { id: "bf2", controller: null }],
    victoryScore: 20
  });
  const errors = [];
  binding.attachLifecycle(flow.chain, error => { errors.push(error); throw error; });
  if (enterThroughLifecycle) {
    const entered = flow.chain.commit({ type: "move-zone", object: kernel.ref("temple"), to: "battlefield", location: field() });
    assert.equal(entered.status, "done");
  }
  const registrations = [...flow.chain.pipeline.checkpoint().triggers.keys()];
  const fired = [];
  const append = flow.chain.pipeline.onTrigger;
  flow.chain.pipeline.onTrigger = snapshot => { fired.push(snapshot); append(snapshot); };
  flow.start();
  for (let guard = 0; guard < 100; guard++) {
    if (flow.chain.items.length) { flow.chain.pass(flow.chain.priority); continue; }
    if (flow.chain.focus) { flow.pass(flow.chain.focus); continue; }
    break;
  }
  return { kernel, flow, binding, registrations, fired, requests, errors };
}

test("sunken-temple: validates with current judge-required reasons and exact IR", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /turn\/flow\.ts:153-170/);
  assert.match(program.judgeReason, /473\.2\.c/);
  assert.match(program.judgeReason, /events\/pipeline\.ts:61-74/);
  assert.match(program.judgeReason, /708\/710/);
  assert.match(program.judgeReason, /details\.participatingUnits/);
  assert.match(program.judgeReason, /game\/lifecycle\.ts:374/);
  assert.match(program.judgeReason, /effects\/contract\.ts:30/);
  assert.match(program.judgeReason, /apps\/game-server\/src\/room\.ts:236-246/);
  assert.doesNotMatch(program.judgeReason, /Unsupported filter field here/);
  assert.doesNotMatch(program.judgeReason, /Might 阈值/);

  const [ability] = program.abilities;
  assert.deepEqual(ability.trigger.filter, { event: "conquered", here: true, player: "controller" });
  assert.deepEqual(ability.trigger.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "conquering-mighty-units-at-this-battlefield",
      filter: { type: "unit", controller: "controller", mightGte: 5, sameLocationAs: "source" }
    },
    operator: "gte",
    right: constant(1)
  });
  assert.equal(ability.optional, true);
  assert.deepEqual(ability.body.map(instruction => instruction.id), ["sunken-temple.opt-in"]);
});

test("sunken-temple: production binding preserves here, Mighty and leading Finalize cost", () => {
  const source = world()
    .object("temple", { cardId: program.canonicalCardId, types: ["battlefield"], zone: "board",
      location: field(), owner: "A", controller: "A", energy: null, power: null, might: null })
    .build()
    .getObject("temple");
  const binding = createProgramBinding({ cardPrograms: [admitted()] });
  const [registration] = triggerRegistrations(binding.registry, source);
  assert.deepEqual(registration.spec.filter, { event: "conquered", here: true, player: "self" });
  assert.deepEqual(registration.cost, {
    id: "cost:temple:1:sunken-temple.opt-in",
    cost: { energy: constant(1) }
  });
  assert.equal(registration.mayAtFinalize, true);
  assert.deepEqual(registration.body.map(instruction => instruction.op), ["effect.draw"]);
});

test("sunken-temple: event here matches only this battlefield and its controller", () => {
  const sourceWorld = world()
    .object("temple", { types: ["battlefield"], zone: "board", location: field(), owner: "A", controller: "A" })
    .unit("conqueror", { owner: "A", controller: "A", might: 6, location: field() })
    .build();
  const source = sourceWorld.getObject("temple");
  const unit = sourceWorld.getObject("conqueror");
  const filter = translateTriggerFilter(program.abilities[0].trigger.filter, "temple", "conquer");
  const event = battlefield => ({
    type: "task-resolved", seq: 1, eventId: 1, turnNumber: 1, activePlayerId: "A",
    taskId: "conquer", sourceCardId: "", reason: "conquer", autoResolved: true,
    timingPoint: "conquer", kind: "conquer", player: "A", object: unit, source: unit, it: unit,
    details: { battlefieldId: battlefield, objectId: "conqueror", playerId: "A" }
  });
  assert.equal(matchesTriggerEvent(filter, event("bf1"), "A", source), true);
  assert.equal(matchesTriggerEvent(filter, event("bf2"), "A", source), false);
  assert.equal(matchesTriggerEvent(filter, event("bf1"), "B", source), false);
});

test("sunken-temple: lifecycle-bound single-Mighty golden pays then draws after the real Score wave", () => {
  const f = runtime({ units: { mighty: { might: 6 } } });
  assert.deepEqual(f.registrations, ["program:temple:2:0"]);
  assert.deepEqual(f.errors, []);
  assert.equal(f.fired.length, 1);
  assert.deepEqual(f.requests.map(request => request.id), ["finalize:trigger:1:optional"]);
  assert.equal(f.kernel.player("A").energy, 1);
  assert.deepEqual(f.kernel.zone("A", "hand").map(ref => ref.id), ["A:deck:0"]);
  assert.equal(f.kernel.player("A").score, 1);
  assert.equal(f.flow.battlefields.find(battlefield => battlefield.id === "bf1").controller, "A");
  assert.deepEqual(f.flow.chain.items, []);

  const events = f.flow.chain.pipeline.events;
  const conquer = events.findIndex(event => event.timingPoint === "conquer");
  const score = events.findIndex(event => event.timingPoint === "score");
  const finalized = events.findIndex(event => event.timingPoint === "chain-item-finalize" && event.details?.item === "trigger:1");
  const drawn = events.findIndex(event => event.timingPoint === "card-drawn");
  assert.ok(conquer < score && score < finalized && finalized < drawn);
});

test("sunken-temple: condition boundary and optional decline pay and draw nothing", () => {
  const weak = runtime({ units: { weak: { might: 4 } } });
  assert.deepEqual(weak.registrations, ["program:temple:2:0"]);
  assert.equal(weak.fired.length, 0);
  assert.equal(weak.kernel.player("A").energy, 0);
  assert.equal(weak.kernel.zone("A", "hand").length, 1, "only the turn's built-in draw is present");

  const declined = runtime({ units: { mighty: { might: 6 } }, give: false });
  assert.deepEqual(declined.requests.map(request => request.id), ["finalize:trigger:1:optional"]);
  assert.equal(declined.kernel.player("A").energy, 0);
  assert.equal(declined.kernel.zone("A", "hand").length, 1, "declining adds no card beyond the turn's built-in draw");
});

test("sunken-temple: authored body pays one Energy then draws one through the interpreter adapter", () => {
  const kernel = world().player("A", { energy: 2 }).deck("top-card").build();
  kernel.setAnswers({ "sunken-temple.opt-in/optional": true });
  const outcome = resolveChainBody(program.abilities[0].body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").energy, 1);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-card"]);
  assert.deepEqual(kernel.events.map(event => event.action), ["pay", "draw"]);
});

test("sunken-temple: current per-Unit collection prompts once for each Mighty conqueror", () => {
  const f = runtime({ units: { first: { might: 6 }, second: { might: 5 } } });
  assert.equal(f.fired.length, 2, "TurnFlow emits one conquer event per participating Unit");
  assert.equal(f.requests.filter(request => request.type === "optional").length, 2, "the battlefield registration is collected twice");
  assert.equal(f.kernel.player("A").energy, 0, "accepting both prompts pays twice");
  assert.ok(f.kernel.zone("A", "hand").length > 1, "the current path can add more than the turn's built-in draw");
});

test("sunken-temple: one Mighty Unit satisfies the condition even when weaker Units also conquer", () => {
  const f = runtime({ units: { mighty: { might: 6 }, weakOne: { might: 4 }, weakTwo: { might: 1 } } });
  assert.deepEqual(new Set(f.fired.map(snapshot => snapshot.event.object.ref.id)), new Set(["mighty", "weakOne", "weakTwo"]));
  assert.equal(f.requests.filter(request => request.type === "optional").length, 3, "the global Mighty condition evaluates independently for each event");
});

test("sunken-temple: current trigger evaluation ignores a Buff's effective Might", () => {
  const f = runtime({ units: { buffed: { might: 4, buffs: 1 } } });
  assert.equal(f.kernel.getObject("buffed").might, 4);
  f.flow.chain.layers.setObjects(f.kernel.objects);
  assert.equal(f.flow.chain.layers.snapshot(f.kernel.ref("buffed")).might, 5);
  assert.equal(f.fired.length, 0, "the raw host snapshot still reports Might 4 to the event condition");
  assert.equal(f.kernel.zone("A", "hand").length, 1, "only the turn's built-in draw is present");
});

test("sunken-temple: event here rejects a Mighty conqueror at the other battlefield", () => {
  const f = runtime({
    units: { weak: { might: 4 }, mightyElsewhere: { might: 6, location: field("bf2") } },
    fields: [{ id: "bf1", controller: null }, { id: "bf2", controller: "A" }]
  });
  assert.equal(f.fired.length, 0, "both event here and the query's sameLocationAs exclude the other battlefield");
  assert.deepEqual(f.requests, []);
});

test("sunken-temple: ChainEngine consumes mightGte while the event condition still reads raw snapshots", () => {
  const kernel = world().unit("mighty", { might: 6 }).unit("weak", { might: 1 }).build();
  assert.equal(kernel.evaluate({ kind: "count", subject: "conquering-units", filter: { type: "unit" } }), 2);
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("mighty") });
  assert.equal(context.test({
    kind: "compare",
    left: { kind: "count", subject: "units", filter: { type: "unit", mightGte: 5 } },
    operator: "gte",
    right: constant(1)
  }), true);
});
