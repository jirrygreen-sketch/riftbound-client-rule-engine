import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/curator-of-the-sands.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { deriveAbilityActivatedEmission } from "../../../../engine-core/dist/events/producers/ability-activation.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { createActionPipelineHost, bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { TurnFlow } from "../../../../engine-core/dist/turn/flow.js";

const CANONICAL_ID =
  "card.hash-913749be19f87a0f632bd0690ad0490bb254a346584c09e1b8c3244137f609a7";
const SOURCE_TEXT =
  "When you play a unit, gear, or activated ability with Energy cost :rb_energy_7: or more, " +
  "you may exhaust me to ready up to 2 runes.";

const [ability] = program.abilities;
const [readyRunes] = ability.body;

/** 符文按契约 ZoneId 位于 rune-zone。 */
const runeSnapshot = (id, exhausted) => ({
  ref: { id, zoneEntryId: 1 },
  cardId: "card:" + id,
  name: id,
  types: ["rune"],
  tags: [],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "rune-zone",
  location: null,
  might: null,
  energy: null,
  power: null,
  exhausted,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false
});

test("ven-145-166 Curator of the Sands: validateCardProgram passes and identity is verbatim", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ven-145-166: review evidence — ability-activated now has a producer (RIFT-270)", () => {
  // 旧 judgeReason 说“没有产者发出 ability-activated”；现在 Chain 的合法完成结果经
  // deriveAbilityActivatedEmission 发出该时点。
  const emission = deriveAbilityActivatedEmission({
    status: "committed",
    chainItemId: "item-1",
    playerId: "A",
    sourceId: "curator-of-the-sands",
    abilityId: "ability-0"
  });
  assert.equal(emission.timingPoint, "ability-activated");
  assert.equal(emission.player, "A");
  assert.equal(emission.details.abilityId, "ability-0");
  // cancelled / countered / invalid 不产生时点。
  assert.equal(deriveAbilityActivatedEmission({
    status: "countered",
    chainItemId: "item-1",
    playerId: "A",
    sourceId: "curator-of-the-sands",
    abilityId: "ability-0"
  }), null);
});

test("ven-145-166: up to 2 permits a locked empty target group", () => {
  const kernel = world().build();
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(outcome.events, []);
});

test("ven-145-166: card and activation events have separate optional subscriptions", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities.map(ability => ability.trigger.at), ["card-played", "ability-activated"]);
  for (const ability of program.abilities) {
    assert.equal(ability.kind, "triggered");
    assert.equal(ability.optional, true);
    assert.equal(ability.trigger.filter.event, ability.trigger.at);
    assert.equal(ability.trigger.filter.filter.player, "self");
  }
  assert.deepEqual(ability.trigger.filter.filter.types, ["unit", "gear"]);
  assert.deepEqual(ability.trigger.condition, {
    kind: "event-printed", object: "object", characteristic: "energy",
    operator: "gte", right: { kind: "constant", value: 7 }
  });
  assert.equal(program.abilities[1].trigger.filter.filter.energyCostAtLeast, 7);
});

test("Curator card-played binding: match friendly units/gear but require explicit printed event data", () => {
  const kernel = world().unit("curator", { energy: null })
    .unit("six", { energy: 6 }).unit("seven", { energy: 7 })
    .object("gear", { types: ["gear"], zone: "board", energy: 9 })
    .unit("enemy", { owner: "B", energy: 9 })
    .object("spell", { types: ["spell"], zone: "chain", energy: 9 })
    .unit("unprinted", { energy: null }).build();
  const filter = translateTriggerFilter(ability.trigger.filter, "curator", "card-played");
  for (const [id, expectedMatch] of [
    ["six", true], ["seven", true], ["gear", true], ["enemy", false], ["spell", false]
  ]) {
    const object = kernel.getObject(id);
    const event = { timingPoint: "card-played", object, player: object.controller };
    assert.equal(matchesTriggerEvent(filter, event, "A"), expectedMatch, id);
    // A bare snapshot is insufficient: actual Chain events supply details.printed.
    assert.throws(() => evaluateCondition(ability.trigger.condition, { context: kernel, event }),
      /Event payload has no printed energy characteristic/, id);
  }
  assert.throws(() => evaluateCondition(ability.trigger.condition, {
    context: kernel, event: { object: kernel.getObject("unprinted") }
  }), /Event payload has no printed energy characteristic/);
  assert.equal(kernel.getObject("unprinted").energy, null);
});

test("Curator card-played predicate: actual Chain events preserve printed Energy independently of payment", () => {
  for (const [energy, expected] of [[6, false], [7, true], [9, true]]) {
    const kernel = world().base("curator", { types: ["legend"], energy: null })
      .hand("played-unit", { types: ["unit"], energy, power: null, might: 3 })
      .deck(["a-top", "a-next"]).deck(["b-top", "b-next"], { owner: "B" })
      .rune(["a-rune"]).rune(["b-rune"], { owner: "B" }).build();
    const host = createActionPipelineHost({
      checkpoint: () => kernel.snapshot(), restore: state => kernel.restore(state),
      objects: () => kernel.objects, perform: action => kernel.perform(action),
      choose: request => kernel.choose(request),
      context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
    });
    const flow = new TurnFlow({ host, player: id => kernel.player(id), turnOrder: ["A", "B"],
      battlefields: [{ id: "bf1", controller: null }, { id: "bf2", controller: null }] });
    flow.start();
    assert.equal(flow.phase, "main");
    assert.equal(flow.chain.commit({ type: "gain-energy", player: "A", amount: 10 }).status, "done");
    // A vanilla unit has no body; its entry, payment and event still use the real Chain.
    flow.execute({ id: `play-${energy}`, source: kernel.getObject("played-unit"), controller: "A", kind: "unit",
      speed: "normal", body: [], cost: {
        id: `discounted-${energy}`, cost: { energy: { kind: "constant", value: energy } },
        discounts: [{ id: "energy-discount", resource: "energy", amount: { kind: "constant", value: energy - 1 } }]
      } });
    while (flow.chain.items.length) flow.pass(flow.chain.priority);
    const [event] = flow.chain.pipeline.events.filter(event => event.timingPoint === "card-played");
    assert.equal(event.details.printed.energy, energy);
    assert.equal(event.details.printed.power, null);
    assert.equal(kernel.player("A").energy, 9);
    assert.equal(evaluateCondition(ability.trigger.condition, { context: kernel, event }), expected);
    assert.equal(kernel.getObject("played-unit").zone, "board");
  }
});

test("ven-145-166: both subscriptions carry the same ready effect with distinct instruction ids", () => {
  const [fromCard, fromActivation] = program.abilities.map(ability => ability.body[0]);
  assert.notEqual(fromCard.id, fromActivation.id);
  assert.deepEqual(fromCard.args, fromActivation.args);
  assert.deepEqual(fromCard.targets, fromActivation.targets);
  assert.deepEqual(fromCard.condition, fromActivation.condition);
});

test("ven-145-166: the resolution body readies up to 2 runes; exhaust-self belongs to the Finalize cost", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(readyRunes.op, "effect.ready");
  assert.deepEqual(readyRunes.args, {
    objects: { kind: "constant", value: { kind: "target", id: "curator-of-the-sands.runes" } },
    amount: { kind: "constant", value: 2 }
  });
  assert.deepEqual(readyRunes.targets, [{
    id: "curator-of-the-sands.runes", filter: { type: "rune", zone: "rune-zone" },
    min: 0, max: 2, selection: "up-to"
  }]);
  assert.equal(readyRunes.linkedTo, undefined);
});

// Execute the supported ready sub-effect with Finalize-locked references.
const runeKernel = () =>
  world().unit("curator-of-the-sands", { types: ["legend"], zone: "board" }).build();

test("ven-145-166 golden: 'ready up to 2 runes' readies the locked runes", () => {
  const kernel = runeKernel();
  kernel.addObject(runeSnapshot("r1", true), "rune-zone");
  kernel.addObject(runeSnapshot("r2", true), "rune-zone");
  kernel.addObject(runeSnapshot("r3", true), "rune-zone");

  const run = runInstruction(
    ready,
    { objects: readyRunes.args.objects, amount: readyRunes.args.amount },
    {
      world: kernel,
      targets: {
        "curator-of-the-sands.runes": [kernel.ref("r1"), kernel.ref("r2")]
      }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("r1").exhausted, false);
  assert.equal(kernel.getObject("r2").exhausted, false);
  // 未被选中的第三枚符文不受影响（up-to 的锁定量是上限）。
  assert.equal(kernel.getObject("r3").exhausted, true);
  assert.deepEqual(kernel.events.map(event => event.action), ["ready", "ready"]);
  assert.deepEqual(run.linked.readied, {
    count: 2,
    objects: [kernel.ref("r1"), kernel.ref("r2")]
  });
});

test("ven-145-166 golden: a rune that is already ready is not readied again (416.1.b)", () => {
  const kernel = runeKernel();
  kernel.addObject(runeSnapshot("r1", false), "rune-zone");
  kernel.addObject(runeSnapshot("r2", true), "rune-zone");

  const run = runInstruction(
    ready,
    { objects: readyRunes.args.objects, amount: readyRunes.args.amount },
    {
      world: kernel,
      targets: {
        "curator-of-the-sands.runes": [kernel.ref("r1"), kernel.ref("r2")]
      }
    }
  );

  assert.equal(run.result.status, "executed");
  // 只有真正从横置变成就绪的那一枚计入 count 与事件。
  assert.deepEqual(kernel.events.map(event => event.action), ["ready"]);
  assert.deepEqual(run.linked.readied, { count: 1, objects: [kernel.ref("r2")] });
});

test("ven-145-166 golden: a stale rune target is ignored (359.3.e.7)", () => {
  const kernel = runeKernel();
  kernel.addObject(runeSnapshot("r1", true), "rune-zone");
  const stale = kernel.ref("r1");
  kernel.perform({ type: "banish", object: stale });

  const run = runInstruction(
    ready,
    { objects: readyRunes.args.objects, amount: readyRunes.args.amount },
    { world: kernel, targets: { "curator-of-the-sands.runes": [stale] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(kernel.events.map(event => event.action), ["banish"]);
});


test("curator-of-the-sands: the review records the current blockers", () => {
  assert.match(program.judgeReason, /206\/206\.1/);
  assert.match(program.judgeReason, /383\.3\.b/);
  assert.match(program.judgeReason, /Finalize/);
});

test.todo("curator-of-the-sands: 206.1: supply activated ability base Energy separately; card-played printed Energy is covered through actual Chain events");

test.todo("curator-of-the-sands: 383.3.b: pay exhaust-self as the triggered ability base cost during Finalize");

test("Curator supported body: unqualified runes includes either player's runes (355.9.b / 416.3.b)", () => {
  const kernel = world()
    .object("own-rune", { types: ["rune"], zone: "rune-zone", owner: "A", exhausted: true })
    .object("enemy-rune", { types: ["rune"], zone: "rune-zone", owner: "B", exhausted: true })
    .build();
  kernel.setTargets("curator-of-the-sands.runes", [kernel.ref("own-rune"), kernel.ref("enemy-rune")]);
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("own-rune").exhausted, false);
  assert.equal(kernel.getObject("enemy-rune").exhausted, false);
  assert.deepEqual(outcome.events.map(event => event.action), ["ready", "ready"]);
  assert.equal(outcome.linkedValues["curator-of-the-sands.ready-runes.readied"].count, 2);
});
