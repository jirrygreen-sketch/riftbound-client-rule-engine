import assert from "node:assert/strict";
import test from "node:test";

import program from "../../../dist/cards/ogn/vengeance.js";
import retreat from "../../../dist/cards/ogn/retreat.js";
import { validateCardProgram } from "../../../dist/ir/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { finalizeTargetPlan, queryTargetCandidates } from "../../../../engine-core/dist/target/target-plan.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

const CARD_ID = "card.hash-f67321dac096b3ad1e49b55231663e26f3f9d96efafe79d75719a6eb72fc5caa";
const TARGET_ID = "chosen-unit";
const BATTLEFIELD = { type: "battlefield", id: "bf-870" };

const vengeance = (overrides = {}) => ({
  id: "vengeance",
  cardId: CARD_ID,
  program,
  owner: "A",
  types: ["spell"],
  zone: "hand",
  energy: 4,
  power: ["Order"],
  might: null,
  ...overrides
});

const boardUnit = (id, owner, location = BATTLEFIELD, overrides = {}) => ({
  id,
  owner,
  types: ["unit"],
  zone: "board",
  location,
  might: 4,
  energy: null,
  power: null,
  ...overrides
});

const RESOLVE_VENGEANCE = [
  { type: "play", object: "vengeance", player: "A" },
  { type: "pass", player: "A" },
  { type: "pass", player: "B" }
];

const eventRows = (result, timingPoint) => result.events.filter(event => event.timingPoint === timingPoint);

// Official evidence used by the production assertions:
// - Core Rules v1.5 (published 2026-10-09, effective 2026-10-16):
//   https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - CR 308.1.a/309-312: Action timing, Open/Closed State and exclusive Priority.
// - CR 327-340 and 354-359.3.e: Pending -> Finalize -> priority/pass -> Resolve,
//   target choices at Finalize, cost payment and stale-incarnation rechecks.
// - CR 355.7/355.9.a.1/355.10: a chosen Base or Battlefield unit is a target;
//   "unit" excludes Gear and Chain spells.
// - CR 429.1-429.6: Kill is a Limited Action from Board to owner's Trash, with
//   responsibility attributed to the spell containing the Kill instruction.
// Manifest identity and exact "Kill a unit." text:
// /root/swarm-rift/shared/m1-card-groups.json (spell-3, ogn-229-298).

function assertNoKillEvidence(result) {
  assert.equal(eventRows(result, "object-killed").length, 0);
  assert.equal(Object.hasOwn(result.links, "kill-chosen-unit.killed"), false);
  assert.deepEqual(result.state.chain, []);
}

function assertStateEqual(left, right, message) {
  assert.deepEqual(
    JSON.parse(JSON.stringify(left)),
    JSON.parse(JSON.stringify(right)),
    message
  );
}

function assertEventIndexOrder(events, earlier, later) {
  const first = events.findIndex(event => earlier(event));
  const second = events.findIndex(event => later(event));
  assert.ok(first >= 0, `missing earlier event: ${earlier}`);
  assert.ok(second >= 0, `missing later event: ${later}`);
  assert.ok(first < second, `event ordering failed: ${first} !< ${second}`);
}

function productionFixture({ energy = 6, power = ["Order", "Order"], choose, objects = [] } = {}) {
  let kernel = world()
    .player("A", { energy, power })
    .player("B", { energy: 3 })
    .hand("vengeance", { cardId: CARD_ID, types: ["spell"], energy: 4, power: ["Order"], might: null })
    .unit("enemy-unit", { owner: "B", zone: "board", location: BATTLEFIELD, might: 4, energy: null, power: null });
  for (const object of objects) {
    if (object.type === "base") kernel.base(object.id, { owner: object.owner });
    else if (object.type === "gear") kernel.unit(object.id, { owner: object.owner, types: ["gear"], might: null, energy: null, power: null });
    else kernel.unit(object.id, { owner: object.owner, might: 4, energy: null, power: null });
  }
  kernel = kernel.build();
  const decide = request => {
    if (choose !== undefined) {
      const answer = choose(request);
      if (answer !== undefined) return answer;
    }
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new Error(`Unexpected Vengeance choice ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const binding = createProgramBinding({ cardPrograms: [program] });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host,
    cleanup: () => false,
    describePlay: binding.describePlay
  });
  return { kernel, binding, engine };
}

test("ogn-229-298 Vengeance: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(result.value.canonicalCardId, CARD_ID);
  assert.equal(result.value.rulesetVersion, "core-1.5");
  assert.equal(result.value.status, "executable");
});

test("ogn-229-298 Vengeance: structure — one play ability, printed cost, single kill target", () => {
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "play");
  assert.deepEqual(ability.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 4 },
    power: { kind: "constant", value: 2 }
  });
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.op, "effect.kill");
  assert.deepEqual(instruction.args, { target: { kind: "constant", value: "chosen-unit" } });
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.targets.length, 1);
  const [target] = instruction.targets;
  assert.equal(target.id, "chosen-unit");
  assert.deepEqual(target.filter, { type: "unit" });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
  assert.equal(program.sourceText, "Kill a unit.");
});

test("ogn-229-298 Vengeance: kill clause executes against a board unit (reference kernel)", () => {
  const testWorld = world()
    .unit("vengeance-source", { owner: "A", zone: "chain" })
    .unit("enemy-unit", { owner: "B", zone: "board", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const target = testWorld.ref("enemy-unit");
  const [instruction] = program.abilities[0].body;
  const run = runInstruction(kill, { target: "chosen-unit" }, {
    world: testWorld,
    targets: { "chosen-unit": [target] }
  });
  assert.equal(run.result?.status, "executed");
  assert.equal(testWorld.getObject("enemy-unit")?.zone, "trash");
  assert.deepEqual(run.linked?.killed, [target]);
  assert.equal(run.events.length, 1);
  assert.equal(run.events[0].action, "kill");
  assert.equal(instruction.op, kill.op);
});

test("ogn-229-298 Vengeance: a stale target leaves the unit alive (359.3.e recheck)", () => {
  const testWorld = world()
    .unit("vengeance-source", { owner: "A", zone: "chain" })
    .unit("fleeing-unit", { owner: "B", zone: "board", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const stale = testWorld.ref("fleeing-unit");
  testWorld.perform({ type: "return-to-hand", object: stale });
  const run = runInstruction(kill, { target: "chosen-unit" }, {
    world: testWorld,
    targets: { "chosen-unit": [stale] }
  });
  assert.equal(run.result?.status, "ignored");
  assert.equal(run.result?.reason, "mistargeted");
  assert.equal(run.events.length, 0);
  assert.equal(testWorld.getObject("fleeing-unit")?.zone, "hand");
});

test("ogn-229-298 Vengeance production: pays 4 Energy + 2 Order Power, targets one Board unit, then kills it", () => {
  const result = runCardScenario(program, {
    players: {
      A: { energy: 6, power: ["Order", "Order"] },
      B: { energy: 3, power: ["Body"] }
    },
    objects: [
      vengeance(),
      boardUnit("enemy-battlefield", "B"),
      boardUnit("enemy-base", "B", { type: "base", player: "B" }),
      boardUnit("friendly-unit", "A", { type: "base", player: "A" }),
      {
        id: "enemy-gear",
        owner: "B",
        types: ["gear"],
        zone: "board",
        location: { type: "base", player: "B" },
        might: null,
        energy: null,
        power: null
      }
    ],
    answers: { [`target:${TARGET_ID}`]: ["enemy-battlefield"] },
    operations: RESOLVE_VENGEANCE,
    expect: {
      objects: {
        vengeance: { zone: "trash", energy: 4, power: ["Order"], might: null },
        "enemy-battlefield": { zone: "trash" },
        "enemy-base": { zone: "board" },
        "friendly-unit": { zone: "board" },
        "enemy-gear": { zone: "board", energy: null, power: null }
      },
      players: {
        A: { energy: 2, power: [] },
        B: { energy: 3, power: ["Body"] }
      },
      links: { "kill-chosen-unit.killed": [{ id: "enemy-battlefield", zoneEntryId: 1 }] },
      events: { sequence: [
        { timingPoint: "object-enters-chain", object: { ref: "vengeance" } },
        { timingPoint: "chain-item-pending", object: { ref: "vengeance" }, player: "A" },
        { timingPoint: "became-target", object: { ref: "enemy-battlefield" }, target: { ref: "enemy-battlefield" }, player: "A" },
        { timingPoint: "chain-item-finalize", object: { ref: "vengeance" }, player: "A" },
        { timingPoint: "object-killed", object: { ref: "enemy-battlefield" }, player: "A", action: { type: "kill", object: "enemy-battlefield" } },
        { timingPoint: "card-played", object: { ref: "vengeance" }, player: "A" },
        { timingPoint: "object-enters-trash", object: { ref: "vengeance" } },
        { timingPoint: "chain-item-resolve", object: { ref: "vengeance" }, player: "A" }
      ] }
    }
  });

  const fixture = productionFixture({
    objects: [
      { id: "enemy-battlefield", owner: "B" },
      { id: "enemy-base", owner: "B", type: "base" },
      { id: "friendly-unit", owner: "A" },
      { id: "enemy-gear", owner: "B", type: "gear" }
    ],
    choose: request => request.id === `target:${TARGET_ID}` ? [fixture.kernel.ref("enemy-battlefield")] : undefined
  });
  const production = fixture.engine.commit({
    type: "play", object: fixture.kernel.ref("vengeance"), player: "A"
  });
  assert.equal(production.status, "done");
  fixture.engine.advance();
  fixture.engine.pass(fixture.engine.priority);
  fixture.engine.pass(fixture.engine.priority);
  const history = fixture.kernel.stateForTest().history;
  const payment = history.find(entry => entry.action.type === "pay");
  assert.deepEqual(payment.action.plan, {
    finalized: true,
    energy: 4,
    power: ["Order", "Order"]
  });

  result.asserts();
  const killed = eventRows(result, "object-killed");
  assert.equal(killed.length, 1);
  assert.equal(killed[0].details.responsiblePlayerId, "A");
  assert.equal(killed[0].details.sourceId, "vengeance");
  assert.equal(killed[0].object.ref.zoneEntryId, 1);
  assert.notEqual(killed[0].object.ref.zoneEntryId,
    result.state.objects.find(object => object.ref.id === "enemy-battlefield").ref.zoneEntryId);
  assert.equal(eventRows(result, "became-target").length, 1);
  assert.equal(eventRows(result, "chain-item-finalize").length, 1);
  assert.equal(eventRows(result, "chain-item-resolve").length, 1);
  assert.equal(result.state.priority, "A");
  assertEventIndexOrder(
    result.events,
    event => event.timingPoint === "chain-item-finalize" && event.object?.ref.id === "vengeance",
    event => event.timingPoint === "object-killed" && event.object?.ref.id === "enemy-battlefield"
  );
  assertEventIndexOrder(
    result.events,
    event => event.timingPoint === "object-killed" && event.object?.ref.id === "enemy-battlefield",
    event => event.timingPoint === "chain-item-resolve" && event.object?.ref.id === "vengeance"
  );
  assert.equal(result.events.find(event => event.timingPoint === "became-target").object.ref.zoneEntryId, 1);
});

test("ogn-229-298 Vengeance production: a board target survives a real Retreat Reaction in hand but becomes an ignored stale incarnation", () => {
  const result = runCardScenario(program, {
    players: {
      A: { energy: 6, power: ["Order", "Order"] },
      B: { energy: 1, power: [] }
    },
    objects: [
      vengeance(),
      boardUnit("enemy-unit", "B"),
      {
        id: "retreat",
        program: retreat,
        owner: "B",
        types: ["spell"],
        zone: "hand",
        energy: 1,
        power: null,
        might: null
      }
    ],
    answers: {
      [`target:${TARGET_ID}`]: ["enemy-unit"],
      "target:friendly-unit": ["enemy-unit"]
    },
    operations: [
      { type: "play", object: "vengeance", player: "A" },
      { type: "pass", player: "A" },
      { type: "play", object: "retreat", player: "B" },
      { type: "pass", player: "B" },
      { type: "pass", player: "A" },
      { type: "pass", player: "A" },
      { type: "pass", player: "B" }
    ],
    expect: {
      objects: {
        vengeance: { zone: "trash" },
        retreat: { zone: "trash" },
        "enemy-unit": { zone: "hand" }
      },
      players: {
        A: { energy: 2, power: [] },
        B: { energy: 0, power: [] }
      },
      events: { sequence: [
        { timingPoint: "became-target", target: { ref: "enemy-unit" }, player: "A" },
        { timingPoint: "became-target", target: { ref: "enemy-unit" }, player: "B" },
        { timingPoint: "card-played", object: { ref: "retreat" }, player: "B" },
        { timingPoint: "chain-item-resolve", object: { ref: "retreat" }, player: "B" },
        { timingPoint: "card-played", object: { ref: "vengeance" }, player: "A" },
        { timingPoint: "chain-item-resolve", object: { ref: "vengeance" }, player: "A" }
      ] }
    }
  });

  result.asserts();
  assertNoKillEvidence(result);
  assert.equal(result.state.objects.find(object => object.ref.id === "enemy-unit").zone, "hand");
  assert.equal(eventRows(result, "became-target").filter(event => event.player === "A").length, 1);
  assert.equal(eventRows(result, "became-target").filter(event => event.player === "B").length, 1);
  const originalTarget = eventRows(result, "became-target").find(event => event.player === "A").target;
  assert.equal(originalTarget.ref.zoneEntryId, 1);
  assert.equal(result.state.objects.find(object => object.ref.id === "enemy-unit").ref.zoneEntryId, 2);
  const vengeanceFinalize = result.events.findIndex(event =>
    event.timingPoint === "chain-item-finalize" && event.object?.ref.id === "vengeance");
  const retreatPending = result.events.findIndex(event =>
    event.timingPoint === "chain-item-pending" && event.object?.ref.id === "retreat");
  const vengeanceResolve = result.events.findIndex(event =>
    event.timingPoint === "chain-item-resolve" && event.object?.ref.id === "vengeance");
  assert.ok(vengeanceFinalize >= 0);
  assert.ok(vengeanceFinalize < retreatPending);
  assert.ok(retreatPending < vengeanceResolve);
  assert.equal(result.events.filter(event =>
    event.timingPoint === "chain-item-pending" && event.object?.ref.id === "vengeance").length, 1);
});

test("ogn-229-298 Vengeance production: one Energy short fails at Finalize without payment, target notification, movement, or events", () => {
  const fixture = productionFixture({ energy: 3, choose: request =>
    request.id === `target:${TARGET_ID}` ? [fixture.kernel.ref("enemy-unit")] : undefined });
  const played = fixture.engine.commit({
    type: "play",
    object: fixture.kernel.ref("vengeance"),
    player: "A"
  });
  assert.equal(played.status, "done");
  assert.equal(fixture.kernel.getObject("vengeance").zone, "chain");
  assert.equal(fixture.kernel.player("A").energy, 3, "admission itself must not pay the printed cost");
  assert.deepEqual(fixture.kernel.player("A").power, ["Order", "Order"]);
  const beforeFinalize = fixture.kernel.stateForTest();
  const linksBeforeFinalize = fixture.kernel.linkedSnapshot();
  const chainBeforeFinalize = fixture.engine.items;
  let caught;
  try {
    fixture.engine.advance();
  } catch (error) {
    caught = error;
  }
  assert.equal(caught?.name, "CostPlanError");
  assert.equal(caught?.reason, "cannot-pay-cost");
  assertStateEqual(fixture.kernel.stateForTest(), beforeFinalize, "Finalize payment failure must restore the complete kernel state");
  assertStateEqual(fixture.kernel.linkedSnapshot(), linksBeforeFinalize, "Finalize payment failure must restore links");
  assertStateEqual(fixture.engine.items, chainBeforeFinalize, "Finalize payment failure must restore the pending Chain item");
  const events = fixture.engine.pipeline.events;
  assert.equal(events.some(event => event.timingPoint === "became-target"), false);
  assert.equal(events.some(event => event.timingPoint === "object-killed"), false);
  assert.equal(events.some(event => event.timingPoint === "chain-item-finalize"), false);
  assert.equal(events.some(event => event.action?.type === "pay"), false);
  assert.equal(events.some(event => event.action?.type === "pay" &&
    event.details?.playerId === "A"), false);
  assert.equal(chainBeforeFinalize.length, 1);
  assert.equal(chainBeforeFinalize[0].status, "pending");
  assert.equal(fixture.kernel.getObject("enemy-unit").zone, "board");
  assert.match(caught.message, /insufficient Energy/);
});

test("ogn-229-298 Vengeance production: wrong Power domain fails atomically without resource or zone mutation", () => {
  assert.throws(
    () => runCardScenario(program, {
      players: { A: { energy: 6, power: ["Calm", "Calm"] } },
      objects: [vengeance(), boardUnit("enemy-unit", "B")],
      answers: { [`target:${TARGET_ID}`]: ["enemy-unit"] },
      operations: RESOLVE_VENGEANCE
    }),
    error => error?.name === "CostPlanError" && error?.reason === "cannot-pay-cost"
  );
});

test("ogn-229-298 Vengeance production: a Board Gear is not a legal unit choice and causes a Finalize rollback", () => {
  assert.throws(
    () => runCardScenario(program, {
      players: { A: { energy: 6, power: ["Order", "Order"] } },
      objects: [
        vengeance(),
        boardUnit("legal-unit", "B"),
        { id: "board-gear", owner: "B", types: ["gear"], zone: "board", location: BATTLEFIELD, might: null, energy: null, power: null }
      ],
      answers: { [`target:${TARGET_ID}`]: ["board-gear"] },
      operations: RESOLVE_VENGEANCE
    }),
    error => error?.code === "invalid-target-choice"
  );
});

test("ogn-229-298 Vengeance production: no Board unit is a no-legal-targets Finalize failure", () => {
  const kernel = world()
    .player("A", { energy: 6, power: ["Order", "Order"] })
    .unit("vengeance-source", { zone: "chain" })
    .unit("board-gear", { owner: "B", types: ["gear"], might: null, energy: null, power: null })
    .build();
  const context = bindResolveContext(kernel, {
    source: kernel.getObject("vengeance-source"),
    controller: "A",
    timingPoint: "chain-item-finalize"
  });
  const [targetSpec] = program.abilities[0].body[0].targets;
  assert.deepEqual(queryTargetCandidates(context, targetSpec), []);
  assert.throws(
    () => finalizeTargetPlan(context, targetSpec),
    error => error?.code === "no-legal-targets"
  );
  assert.equal(kernel.player("A").energy, 6);
  assert.deepEqual(kernel.player("A").power, ["Order", "Order"]);
  assert.equal(kernel.getObject("board-gear").zone, "board");
});

test("ogn-229-298 Vengeance production: the target chooser sees every Board unit, including Base units, and excludes Gear and Chain spells", () => {
  const result = runCardScenario(program, {
    players: {
      A: { energy: 6, power: ["Order", "Order"] },
      B: { energy: 1 }
    },
    objects: [
      vengeance(),
      boardUnit("enemy-unit", "B"),
      boardUnit("friendly-unit", "A"),
      boardUnit("base-unit", "B", { type: "base", player: "B" }),
      { id: "gear", owner: "B", types: ["gear"], zone: "board", location: BATTLEFIELD, might: null, energy: null, power: null },
      { id: "chained-spell", owner: "B", types: ["spell"], zone: "chain", might: null, energy: 1, power: null }
    ],
    choose: request => {
      throw new Error(`unexpected choice ${request.id}`);
    },
    answers: { [`target:${TARGET_ID}`]: ["enemy-unit"] },
    operations: [
      { type: "play", object: "vengeance", player: "A" },
      { type: "pass", player: "A" },
      { type: "pass", player: "B" }
    ]
  });
  const candidates = eventRows(result, "became-target").map(event => event.target.ref.id);
  assert.deepEqual(candidates, ["enemy-unit"]);

  const kernel = world()
    .unit("vengeance-source", { zone: "chain" })
    .unit("enemy-unit", { owner: "B" })
    .unit("friendly-unit", { owner: "A" })
    .base("base-unit", { owner: "B" })
    .unit("gear", { owner: "B", types: ["gear"], might: null, energy: null, power: null })
    .card("chained-spell", { owner: "B", types: ["spell"], zone: "chain" })
    .build();
  const context = bindResolveContext(kernel, {
    source: kernel.getObject("vengeance-source"),
    controller: "A",
    timingPoint: "chain-item-finalize"
  });
  const [targetSpec] = program.abilities[0].body[0].targets;
  assert.deepEqual(
    queryTargetCandidates(context, targetSpec).map(ref => ref.id).sort(),
    ["base-unit", "enemy-unit", "friendly-unit"]
  );
});

test("ogn-229-298 Vengeance production: a wrong player cannot take the Action-timed play or later Priority", () => {
  const fixture = productionFixture({ choose: request =>
    request.id === `target:${TARGET_ID}` ? [fixture.kernel.ref("enemy-unit")] : undefined });
  const source = fixture.kernel.getObject("vengeance");
  const draft = fixture.binding.describePlay({
    type: "play",
    object: source.ref,
    player: "B"
  }, source);
  assert.throws(() => fixture.engine.execute(draft), /Action is not legally timed/);
  assert.equal(fixture.kernel.getObject("vengeance").zone, "hand");
  assert.equal(fixture.kernel.player("A").energy, 6);
  assert.deepEqual(fixture.kernel.player("A").power, ["Order", "Order"]);
  assert.deepEqual(fixture.engine.items, []);
});

test("ogn-229-298 Vengeance production: retrying the same Finalize after target selection resumes the original payment once", () => {
  const result = runCardScenario(program, {
    players: { A: { energy: 6, power: ["Order", "Order"] } },
    objects: [vengeance(), boardUnit("enemy-unit", "B")],
    operations: [
      { type: "play", object: "vengeance", player: "A" },
      { type: "choose", id: `target:${TARGET_ID}`, value: ["enemy-unit"] },
      { type: "pass", player: "A" },
      { type: "pass", player: "B" }
    ]
  });

  assert.equal(result.state.players.A.energy, 2);
  assert.deepEqual(result.state.players.A.power, []);
  assert.equal(result.state.objects.find(object => object.ref.id === "enemy-unit").zone, "trash");
  assert.equal(eventRows(result, "became-target").length, 1);
  assert.equal(eventRows(result, "object-killed").length, 1);
  assert.equal(eventRows(result, "chain-item-resolve").filter(event => event.object?.ref.id === "vengeance").length, 1);
  assert.deepEqual(result.state.chain, []);
});

test("ogn-229-298 Vengeance production: a second discretionary play in the same state is rejected without paying again", () => {
  let targetAnswer;
  const fixture = productionFixture({ choose: request => {
    if (request.id === `target:${TARGET_ID}`) return [targetAnswer];
    return undefined;
  } });
  targetAnswer = fixture.kernel.ref("enemy-unit");
  const first = fixture.binding.describePlay({
    type: "play", object: fixture.kernel.ref("vengeance"), player: "A"
  }, fixture.kernel.getObject("vengeance"));
  fixture.engine.execute(first);
  assert.equal(fixture.kernel.player("A").energy, 2);
  assert.equal(fixture.kernel.getObject("vengeance").zone, "chain");

  const secondSource = fixture.kernel.getObject("vengeance");
  const second = fixture.binding.describePlay({
    type: "play", object: secondSource.ref, player: "A"
  }, secondSource);
  assert.throws(() => fixture.engine.execute(second), /Action is not legally timed/);
  assert.equal(fixture.kernel.player("A").energy, 2);
  assert.deepEqual(fixture.kernel.player("A").power, []);
  assert.equal(fixture.kernel.getObject("enemy-unit").zone, "board");
  assert.equal(fixture.engine.pipeline.events.filter(event =>
    event.timingPoint === "chain-item-finalize").length, 1);
});

test("ogn-229-298 Vengeance production: a stale resolved target remains a legal completed play with no Kill action", () => {
  let target;
  const fixture = productionFixture({ choose: request => {
    if (request.id !== `target:${TARGET_ID}`) return undefined;
    target = fixture.kernel.ref("enemy-unit");
    return [target];
  } });
  fixture.engine.execute(fixture.binding.describePlay({
    type: "play", object: fixture.kernel.ref("vengeance"), player: "A"
  }, fixture.kernel.getObject("vengeance")));
  assert.ok(target);
  assert.equal(target.zoneEntryId, 1);
  assert.equal(fixture.engine.items[0].status, "finalized");
  assert.equal(fixture.engine.priority, "A");
  fixture.engine.pass("A");
  assert.equal(fixture.engine.priority, "B");
  const returned = fixture.engine.commit({
    type: "return-to-hand",
    object: fixture.kernel.ref("enemy-unit")
  });
  assert.equal(returned.status, "done");
  fixture.engine.advance();
  assert.equal(fixture.engine.priority, "A");
  fixture.engine.pass("A");

  assert.equal(fixture.kernel.getObject("enemy-unit").zone, "hand");
  assert.equal(fixture.kernel.getObject("vengeance").zone, "trash");
  assert.equal(fixture.kernel.linkedSnapshot()["kill-chosen-unit.killed"], undefined);
  const semantic = fixture.engine.pipeline.events.filter(event =>
    ["became-target", "object-killed", "card-played", "chain-item-resolve"].includes(event.timingPoint));
  assert.deepEqual(semantic.map(event => event.timingPoint), [
    "became-target", "card-played", "chain-item-resolve"
  ]);
  assert.equal(semantic[0].target.ref.zoneEntryId, 1);
  assert.deepEqual(fixture.engine.items, []);
});

test("ogn-229-298 Vengeance production: Priority passes A -> B before Resolve; only the second pass kills and Trashes the spell", () => {
  const fixture = productionFixture({ choose: request =>
    request.id === `target:${TARGET_ID}` ? [fixture.kernel.ref("enemy-unit")] : undefined });
  fixture.engine.execute(fixture.binding.describePlay({
    type: "play", object: fixture.kernel.ref("vengeance"), player: "A"
  }, fixture.kernel.getObject("vengeance")));

  assert.equal(fixture.engine.priority, "A");
  assert.equal(fixture.engine.items.at(0).status, "finalized");
  assert.equal(fixture.kernel.getObject("enemy-unit").zone, "board");
  assert.equal(fixture.kernel.getObject("vengeance").zone, "chain");
  assert.equal(eventRows({ events: fixture.engine.pipeline.events }, "object-killed").length, 0);

  fixture.engine.pass("A");
  assert.equal(fixture.engine.priority, "B");
  assert.equal(fixture.engine.items.length, 1);
  assert.equal(fixture.kernel.getObject("enemy-unit").zone, "board");
  assert.equal(fixture.kernel.getObject("vengeance").zone, "chain");
  assert.equal(eventRows({ events: fixture.engine.pipeline.events }, "object-killed").length, 0);

  fixture.engine.pass("B");
  assert.equal(fixture.engine.items.length, 0);
  assert.equal(fixture.kernel.getObject("enemy-unit").zone, "trash");
  assert.equal(fixture.kernel.getObject("vengeance").zone, "trash");
  assert.equal(eventRows({ events: fixture.engine.pipeline.events }, "object-killed").length, 1);
  assert.equal(eventRows({ events: fixture.engine.pipeline.events }, "chain-item-resolve").length, 1);
  assertEventIndexOrder(
    fixture.engine.pipeline.events,
    event => event.timingPoint === "object-killed" && event.object?.ref.id === "enemy-unit",
    event => event.timingPoint === "chain-item-resolve" && event.object?.ref.id === "vengeance"
  );
});

test("ogn-229-298 Vengeance production: B's Reaction enters only after A's Vengeance Finalize; Resolution then rechecks the moved target", () => {
  const result = runCardScenario(program, {
    players: {
      A: { energy: 6, power: ["Order", "Order"] },
      B: { energy: 1 }
    },
    objects: [
      vengeance(),
      boardUnit("enemy-unit", "B"),
      {
        id: "retreat",
        program: retreat,
        owner: "B",
        types: ["spell"],
        zone: "hand",
        energy: 1,
        power: null,
        might: null
      }
    ],
    answers: {
      [`target:${TARGET_ID}`]: ["enemy-unit"],
      "target:friendly-unit": ["enemy-unit"]
    },
    operations: [
      { type: "play", object: "vengeance", player: "A" },
      { type: "pass", player: "A" },
      { type: "play", object: "retreat", player: "B" },
      { type: "pass", player: "B" },
      { type: "pass", player: "A" },
      { type: "pass", player: "A" },
      { type: "pass", player: "B" }
    ]
  });
  const semantic = result.events.filter(event =>
    ["became-target", "chain-item-finalize", "chain-item-pending", "object-killed", "return-to-hand", "card-played", "chain-item-resolve"]
      .includes(event.timingPoint));
  const vengeanceFinalize = semantic.findIndex(event =>
    event.timingPoint === "chain-item-finalize" && event.object?.ref.id === "vengeance");
  const vengeancePending = semantic.findIndex(event =>
    event.timingPoint === "chain-item-pending" && event.object?.ref.id === "vengeance");
  const retreatPending = semantic.findIndex(event =>
    event.timingPoint === "chain-item-pending" && event.object?.ref.id === "retreat");
  const retreatResolve = semantic.findIndex(event =>
    event.timingPoint === "chain-item-resolve" && event.object?.ref.id === "retreat");
  const vengeanceResolve = semantic.findIndex(event =>
    event.timingPoint === "chain-item-resolve" && event.object?.ref.id === "vengeance");
  assert.ok(vengeanceFinalize >= 0);
  assert.ok(vengeancePending >= 0);
  assert.ok(vengeancePending < vengeanceFinalize);
  assert.ok(vengeanceFinalize < retreatPending);
  assert.ok(retreatPending < retreatResolve);
  assert.ok(retreatResolve < vengeanceResolve);
  assert.equal(semantic.some(event => event.timingPoint === "object-killed"), false);
  assert.equal(result.state.objects.find(object => object.ref.id === "enemy-unit").zone, "hand");
  assert.deepEqual(result.state.players.A.power, []);
  assert.equal(result.state.players.A.energy, 2);
});

// Official sources: Core Rules v1.5 (2026-10-09),
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// and Radiance patch notes (effective 2026-10-16),
// https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/.
// canonicalCardId card.hash-f67321dac096b3ad1e49b55231663e26f3f9d96efafe79d75719a6eb72fc5caa:
// "Kill a unit" is one target under 355.5/.7; 337.1 Finalize pays 4 Energy +
// 2 Order and locks it; 338-340 require Priority passes before Resolve;
// 429.1 enters the source's Kill into the real object-killed event; 359.3.e
// rechecks the incarnation.  A is the caster.  The production tests above
// include the complete paid path, both Priority passes, stale targets and a
// real B Reaction; no LKI is used to revive a departed target.
