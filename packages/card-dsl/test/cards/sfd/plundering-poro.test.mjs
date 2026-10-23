// Production-path golden for Plundering Poro (sfd-069-221).
//
// The public TurnFlow performs a real Move and Showdown close, publishes the
// exact Conquer payload, and lets ProgramBinding/ChainEngine Finalize and
// Resolve the authored trigger. RIFT-987's canonical Gold program is registered
// alongside it, so the effect really creates and plays Gold on the Chain and the
// resulting token owns its executable Reaction Add ability.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/plundering-poro.js";
import goldProgram from "../../../dist/cards/sfd/gold.js";
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
const BASE_A = { type: "base", player: "A" };
const CORE_RULES_URL =
  "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf";
const RADIANCE_URL =
  "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/";
const SFD_ERRATA_URL =
  "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/";

const PRODUCTION_TEST_NAMES = Object.freeze({
  golden: "sfd-069-221 Plundering Poro production golden: exact Unit Conquer creates and plays bound Gold",
  add: "sfd-069-221 Plundering Poro production boundary: bound Gold Add produces Universal Power",
  wrongUnit: "sfd-069-221 Plundering Poro production counterexample: another friendly Unit Conquer never triggers",
  opponent: "sfd-069-221 Plundering Poro production counterexample: an opponent Unit Conquer never triggers",
  noRepeat: "sfd-069-221 Plundering Poro production boundary: subsequent Conquer without this Unit creates no Gold"
});

// Official evidence is pinned to the reviewed snapshots named by the repository
// policy. Neither the effective Radiance rulings nor the Spiritforged errata
// names this card, Gold, CR 187.5, 135.2.e.5 or 163.2.b. The card text therefore
// uses CR v1.5 plus the canonical catalog entry, with no numeric priority.
const OFFICIAL_EFFECT_ORDER_EVIDENCE = Object.freeze({
  contract: "riftbound.official-effect-order-evidence.v1",
  canonicalCardId: CARD_ID,
  sources: Object.freeze({
    coreRules: Object.freeze({
      version: "1.5",
      dated: "2026-10-09",
      effective: "2026-10-16",
      url: CORE_RULES_URL,
      localSha256: "bbc81327eb21242452db3c56348b0725b1e0b6186c1a682dde541f3c7a864ba2"
    }),
    radianceRulings: Object.freeze({
      published: "2026-10-09",
      effective: "2026-10-16",
      url: RADIANCE_URL,
      applicableToThisCard: false,
      result: "reviewed: no Plundering Poro, Gold token, 187.5, 135.2.e.5 or 163.2.b ruling"
    }),
    spiritforgedErrata: Object.freeze({
      published: "2026-01-14",
      effective: null,
      url: SFD_ERRATA_URL,
      applicableToThisCard: false,
      result: "reviewed: no Plundering Poro or Gold token correction"
    })
  }),
  interactions: Object.freeze([
    Object.freeze({
      id: "self-conquer-trigger",
      canonicalCardId: CARD_ID,
      sourceIds: Object.freeze(["coreRules", "radianceRulings", "spiritforgedErrata"]),
      clauses: Object.freeze(["When I conquer"]),
      ruleRefs: Object.freeze([
        "303.2.a", "338.1", "338.1.a.2", "339.1", "383.3.c", "383.3.d",
        "383.4.c", "383.4.c.1", "383.4.c.2", "383.4.c.2.a", "471.1", "473.2.a"
      ]),
      timeline: Object.freeze([
        "Play/Pending: the real TurnFlow control task establishes battlefield control, gains one point and emits Conquer with the exact conquering Unit as object/source/it and details.objectId.",
        "Trigger: the self-only program registration matches that exact Unit incarnation; another friendly Unit or an opponent Unit creates no Pending item.",
        "Finalize: this ability is mandatory and has no target, printed cost or optional additional cost, so Finalize locks no choice and pays nothing.",
        "Execute: Priority starts with the turn player and both players must pass in sequence before Resolve under the ordinary Chain window.",
        "Resolve: the effect executes once; simultaneous Conquer abilities follow 383.3.d/303.2.a rather than array order, while this card adds no replacement or layer effect."
      ]),
      priorityFocus: "No numeric priority exists. Conquer creates ordinary Pending items; Priority/Focus remains owned by TurnFlow and this card grants no new opportunity.",
      responseWindow: "Reaction cards or abilities may be played while the finalized trigger is on the Chain before both Priority passes complete.",
      replacement: "No replacement effect is supplied. CR 383.4.c.2.c only preserves the trigger if the point gain itself is replaced; this test does not invent that event.",
      layers: "The trigger uses the Conquer payload identity, not a continuous-effect layer.",
      lki: "No leaving-zone look-back is needed; the exact current Unit incarnation is present at the Conquered Battlefield.",
      productionTestNames: Object.freeze([
        PRODUCTION_TEST_NAMES.golden,
        PRODUCTION_TEST_NAMES.wrongUnit,
        PRODUCTION_TEST_NAMES.opponent,
        PRODUCTION_TEST_NAMES.noRepeat
      ])
    }),
    Object.freeze({
      id: "play-gold-exhausted",
      canonicalCardId: CARD_ID,
      goldCanonicalCardId: GOLD_ID,
      sourceIds: Object.freeze(["coreRules", "radianceRulings", "spiritforgedErrata"]),
      clauses: Object.freeze(["play a Gold gear token exhausted"]),
      ruleRefs: Object.freeze([
        "135.2.e.5", "135.2.e.5.a", "135.2.e.5.b", "163.2.b", "184.1",
        "149.1", "184.1", "185.2.a", "185.2.d", "185.3.a", "185.3.a.1", "187.5", "350.2",
        "354", "359.2.d", "359.3.c", "420.3", "420.3.b", "420.3.b.1",
        "430.2", "430.2.a", "430.3", "440.2.c", "813.1.c.2"
      ]),
      timeline: Object.freeze([
        "Resolve starts the Limited Play: effect.token creates the canonical CR 187.5 Gold token on the Chain at zero rule-level cost.",
        "The created Gold enters the ordinary Finalize path, but current ChainEngine Resolve applies generic Gear-ready entry instead of the creating effect's exhausted stipulation. The production test pins this fail-closed mismatch.",
        "The played Gear reaches its controller's Base on the Board and is bound to Gold's executable canonical card program; its catalog energy/power/might remain null.",
        "The production probe confirms the token's [Reaction][>] Kill this, [E] Add is executable and yields one Universal Power source. The current ready-entry mismatch makes that ability reachable too early and therefore keeps the card judge-required.",
        "CR 135.2.e.5.a/b and 163.2.b allow that Universal source to pay a later named-Domain or [A] requirement; no named Domain is fabricated into the token itself."
      ]),
      priorityFocus: "The Conquer trigger's Resolve starts a Limited Play. Gold's Add is an immediate Add ability whose own Finalize/Resolve neither passes Priority nor Focus (430.2.a).",
      responseWindow: "Players may respond to the Conquer trigger before its Resolve. After the Limited Play is created, its ordinary Play Finalize precedes Resolve; the later Gold Add has no reaction window of its own.",
      replacement: "No replacement or prevention is authored for this clause. Current generic Gear-ready entry is the identified engine gap; a later Exhaust action would not be equivalent.",
      layers: "The exhausted entry state is a Play entry stipulation, not a later Exhaust action or a continuous layer.",
      lki: "Gold is a new token incarnation bound on Board entry. Its Kill cost later moves that exact token to Trash; no unrelated carrier or stale incarnation is reused.",
      productionTestNames: Object.freeze([PRODUCTION_TEST_NAMES.golden, PRODUCTION_TEST_NAMES.add])
    })
  ])
});

const [ability] = program.abilities;
const [playGold] = ability.body;

function productionFixture(scenario = "self", { turnPlayer = "A" } = {}) {
  let builder = world().player("A").player("B");
  for (const player of ["A", "B"]) {
    builder = builder
      .deck(Array.from({ length: 8 }, (_, index) => `${player}:deck:${index}`), { owner: player })
      .rune(Array.from({ length: 8 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  builder = builder.unit("poro", {
    cardId: CARD_ID,
    name: "Plundering Poro",
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
      name: "Enemy",
      types: ["unit"],
      might: 5,
      location: { type: "battlefield", id: "bf1" }
    });
  }
  if (scenario === "other-unit") {
    builder = builder.unit("other", {
      owner: "A",
      controller: "A",
      name: "Another Unit",
      types: ["unit"],
      might: 3,
      location: { type: "base", player: "A" }
    });
  }
  const kernel = builder.build();
  const requests = [];
  const choose = request => {
    requests.push(structuredClone(request));
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
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const binding = createProgramBinding({ cardPrograms: admittedGoldPrograms() });
  const flow = new TurnFlow({
    host,
    player: id => kernel.player(id),
    turnOrder: turnPlayer === "A" ? ["A", "B"] : ["B", "A"],
    battlefields: [
      { id: "bf1", controller: scenario === "opponent" ? "B" : null },
      { id: "bf2", controller: null }
    ],
    describePlay: binding.describePlay
  });
  const errors = [];
  const lifecycle = binding.attachLifecycle(flow.chain, (error, source) =>
    errors.push({ error, sourceId: source.ref.id }));
  const registered = binding.registerProgramTriggers(flow.chain, kernel.getObject("poro"));
  const fired = [];
  const onTrigger = flow.chain.pipeline.onTrigger;
  flow.chain.pipeline.onTrigger = snapshot => {
    fired.push(snapshot);
    onTrigger(snapshot);
  };
  flow.start();
  const move = (id, battlefieldId, controller = "A") => flow.execute({
    id: `${turnPlayer}-${id}-move-${requests.length}`,
    controller,
    source: kernel.getObject(id),
    kind: "activated",
    speed: "normal",
    body: [{
      id: `${id}-move-effect`,
      op: "effect.move",
      args: { to: { kind: "constant", value: { type: "battlefield", id: battlefieldId } } }
    }]
  });
  const settle = (budget = 100) => {
    for (let guard = 0; guard < budget; guard++) {
      if (flow.chain.items.length) {
        if (flow.chain.priority === null) flow.chain.advance();
        else flow.pass(flow.chain.priority);
        continue;
      }
      if (flow.chain.focus !== null) {
        flow.pass(flow.chain.focus);
        continue;
      }
      return;
    }
    throw new Error("production TurnFlow did not settle");
  };
  return { kernel, flow, binding, lifecycle, registered, errors, fired, requests, move, settle };
}

function conquers(f) {
  return f.flow.chain.pipeline.events.filter(event => event.timingPoint === "conquer");
}

function goldTokens(kernel) {
  return kernel.objects.filter(object => object.isToken && object.cardId === GOLD_ID);
}

// ProgramRegistry intentionally rejects judge-required cards. This lift changes
// only the admission gate; the authored trigger and token instruction remain
// byte-for-byte unchanged and every test still enters through productionPlay's
// or TurnFlow's Create ProgramBinding + ChainEngine + lifecycle path.
const admitted = { ...program, status: "executable", judgeReason: undefined };

function admittedGoldPrograms() {
  return [admitted, goldProgram];
}

test("sfd-069-221 Plundering Poro: validates, is registered and names the current entry-state gap", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /engine\.ts:423-442 \/ 1578-1600/);
  assert.match(program.judgeReason, /carried entersExhausted/);
  assert.match(program.judgeReason, /CR 184\.1 and 185\.2\.a/);
  assert.match(program.judgeReason, /149\.1 \/ 359\.2\.d/);
  assert.match(program.judgeReason, /Universal Power source/);
  assert.doesNotMatch(program.judgeReason, /effect\.resources\.ts:126-170|unverified Add shape/);
  assert.equal(cardRegistryById.get(CARD_ID), program);
  assert.equal(goldProgram.status, "executable");
  assert.equal(getTokenDefinition("gold")?.abilityBinding, "canonical-card-program");
});

test("sfd-069-221 Plundering Poro: official sources and production timelines are pinned", () => {
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.contract, "riftbound.official-effect-order-evidence.v1");
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.canonicalCardId, CARD_ID);
  assert.deepEqual(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.coreRules, {
    version: "1.5",
    dated: "2026-10-09",
    effective: "2026-10-16",
    url: CORE_RULES_URL,
    localSha256: "bbc81327eb21242452db3c56348b0725b1e0b6186c1a682dde541f3c7a864ba2"
  });
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.radianceRulings.effective, "2026-10-16");
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.radianceRulings.applicableToThisCard, false);
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.spiritforgedErrata.applicableToThisCard, false);
  assert.deepEqual(program.abilities.map(value => value.kind), ["triggered"]);
  assert.deepEqual(
    OFFICIAL_EFFECT_ORDER_EVIDENCE.interactions.map(interaction => interaction.id),
    ["self-conquer-trigger", "play-gold-exhausted"]
  );
  const productionNames = new Set(Object.values(PRODUCTION_TEST_NAMES));
  for (const interaction of OFFICIAL_EFFECT_ORDER_EVIDENCE.interactions) {
    assert.equal(interaction.canonicalCardId, CARD_ID);
    assert.deepEqual(interaction.sourceIds, ["coreRules", "radianceRulings", "spiritforgedErrata"]);
    assert.ok(interaction.clauses.length > 0);
    assert.ok(interaction.ruleRefs.length > 0);
    assert.ok(interaction.timeline.length >= 3);
    assert.match(interaction.priorityFocus, /Priority/);
    assert.match(interaction.responseWindow, /Reaction|Resolve|response/i);
    assert.ok(interaction.productionTestNames.every(name => productionNames.has(name)));
  }
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.interactions[1].goldCanonicalCardId, GOLD_ID);
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.radianceRulings.published, "2026-10-09");
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.spiritforgedErrata.published, "2026-01-14");
  assert.deepEqual(OFFICIAL_EFFECT_ORDER_EVIDENCE.interactions[1].ruleRefs.filter(rule => [
    "135.2.e.5.a", "135.2.e.5.b", "149.1", "163.2.b", "185.2.a", "185.2.d", "187.5",
    "359.2.d", "420.3", "430.2.a", "430.3", "440.2.c"
  ].includes(rule)), [
    "135.2.e.5.a", "135.2.e.5.b", "163.2.b", "149.1", "185.2.a", "185.2.d", "187.5",
    "359.2.d", "420.3", "430.2.a", "430.3", "440.2.c"
  ]);
});

test("sfd-069-221 Plundering Poro structure: mandatory self Conquer and exhausted Gold play", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, { event: "conquer", filter: { source: "self" } });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.body.length, 1);
  assert.equal(playGold.id, "play-gold");
  assert.equal(playGold.op, "effect.token");
  assert.deepEqual(playGold.args, {
    token: { kind: "constant", value: "gold" },
    amount: { kind: "constant", value: 1 },
    mode: { kind: "constant", value: "play" },
    location: { kind: "constant", value: { type: "base", player: "controller" } },
    entersExhausted: { kind: "constant", value: true }
  });
  assert.equal(playGold.targets, undefined);
  assert.equal(playGold.picks, undefined);
});

test(PRODUCTION_TEST_NAMES.golden, () => {
  const f = productionFixture();
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.registered, ["program:poro:1:0"]);

  f.move("poro", "bf1");
  f.settle();

  const [gold] = goldTokens(f.kernel);
  assert.ok(gold);
  const enteredGold = f.kernel.getObject(gold.ref.id);
  assert.ok(enteredGold);
  assert.equal(enteredGold.name, "Gold");
  assert.equal(enteredGold.isToken, true);
  assert.deepEqual(enteredGold.types, ["gear"]);
  assert.equal(enteredGold.zone, "board");
  // The reference state host currently lets ChainEngine apply its generic
  // Gear-ready entry (359.2.d) after Play rather than the token instruction's
  // exhausted stipulation. Reachability below proves this remains a production
  // blocker under the current engine.
  assert.equal(enteredGold.exhausted, false);
  assert.deepEqual(enteredGold.location, BASE_A);
  assert.equal(enteredGold.energy, null);
  assert.equal(enteredGold.power, null);
  assert.equal(getTokenDefinition("gold").spec.might, null, "the card definition keeps the catalog's null Might");
  assert.deepEqual(f.errors, []);
  assert.equal(f.fired.filter(value => value.registration.id === "program:poro:1:0").length, 1);
  assert.equal(f.requests.length, 0, "the mandatory trigger has no Finalize choice or target");
  assert.deepEqual(
    f.kernel.linked("play-gold.token").createdObjects.map(ref => ref.id),
    [enteredGold.ref.id]
  );

  const [conquer] = conquers(f);
  assert.equal(conquer.player, "A");
  assert.equal(conquer.object.ref.id, "poro");
  assert.equal(conquer.source.ref.id, "poro");
  assert.equal(conquer.it.ref.id, "poro");
  assert.deepEqual(conquer.details, {
    battlefieldId: "bf1",
    battlefieldControllerBefore: null,
    objectId: "poro",
    playerId: "A"
  });
  assert.equal(f.kernel.player("A").score, 1);
  assert.equal(f.flow.battlefields[0].controller, "A");
  const goldRef = enteredGold.ref;

  const timeline = f.flow.chain.pipeline.events.map(event => event.timingPoint);
  const conquerAt = timeline.indexOf("conquer");
  const triggerPendingAt = timeline.indexOf("chain-item-pending", conquerAt);
  const tokenPendingAt = timeline.indexOf("chain-item-pending", triggerPendingAt + 1);
  const triggerFinalizeAt = timeline.indexOf("chain-item-finalize", triggerPendingAt);
  const tokenFinalizeAt = timeline.indexOf("chain-item-finalize", tokenPendingAt);
  const tokenPlayAt = timeline.indexOf("card-played", tokenFinalizeAt);
  const triggerResolveAt = timeline.indexOf("chain-item-resolve", tokenPlayAt);
  assert.ok(conquerAt >= 0 && conquerAt < triggerPendingAt);
  assert.ok(triggerPendingAt < triggerFinalizeAt && triggerPendingAt < tokenPendingAt);
  assert.ok(tokenPendingAt < tokenFinalizeAt && tokenFinalizeAt < tokenPlayAt);
  assert.ok(tokenPlayAt < triggerResolveAt);
  const playedAtId = f.flow.chain.pipeline.events.find(event =>
    event.timingPoint === "card-played" && event.object?.ref.id === goldRef.id && event.object.ref.zoneEntryId === goldRef.zoneEntryId);
  assert.ok(playedAtId, "the actual Play is attributed to the entered Gold incarnation");
  assert.ok(f.flow.chain.trace.some(entry => entry.step === "resolved"));
  assert.equal(f.flow.chain.items.length, 0);
  assert.equal(f.kernel.pendingItems.length, 0);
});

test(PRODUCTION_TEST_NAMES.add, () => {
  const f = productionFixture();
  f.move("poro", "bf1");
  f.settle();
  assert.equal(goldTokens(f.kernel).length, 1);
  const [gold] = goldTokens(f.kernel);
  const playedGold = f.kernel.getObject(gold.ref.id);
  assert.equal(playedGold.zone, "board");
  assert.equal(playedGold.exhausted, false, "current ChainEngine does not carry the token's exhausted entry stipulation");
  assert.equal(f.binding.activationAbilities(playedGold).length, 1, "the created carrier is bound to canonical Gold");
  const draft = f.binding.describeActivate(f.kernel.getObject(gold.ref.id), "A", 0);
  assert.equal(draft.kind, "add");
  assert.equal(draft.speed, "reaction");
  f.flow.chain.execute(draft);
  f.settle();
  assert.deepEqual(f.kernel.player("A").power, ["universal"]);
  assert.equal(f.kernel.getObject(gold.ref.id).zone, "trash");
  const actions = f.kernel.events.map(event => event.action).filter(Boolean);
  assert.deepEqual(actions.slice(-3), ["exhaust", "kill", "gain-power"]);
  const timeline = f.flow.chain.pipeline.events.map(event => event.timingPoint);
  const addPendingAt = timeline.lastIndexOf("chain-item-pending");
  const addResolveAt = timeline.indexOf("chain-item-resolve", addPendingAt);
  assert.ok(addPendingAt >= 0 && addPendingAt < addResolveAt);
  assert.deepEqual(f.errors, []);
});

for (const [name, scenario] of [
  [PRODUCTION_TEST_NAMES.wrongUnit, "other-unit"],
  [PRODUCTION_TEST_NAMES.opponent, "turn-b"]
]) {
  test(name, () => {
    const f = scenario === "turn-b" ? productionFixture("self", { turnPlayer: "B" }) : productionFixture(scenario);
    assert.deepEqual(f.errors, []);
    if (scenario === "other-unit") f.move("other", "bf2");
    f.settle();

    const events = conquers(f);
    assert.equal(events.length, scenario === "turn-b" ? 0 : 1);
    if (scenario === "other-unit") assert.equal(events[0].object.ref.id, "other");
    assert.equal(f.fired.filter(value => value.registration.id === "program:poro:1:0").length, 0);
    assert.equal(f.requests.length, 0);
    assert.deepEqual(goldTokens(f.kernel), []);
    assert.equal(f.kernel.linked("play-gold.token"), undefined);
  });
}

test(PRODUCTION_TEST_NAMES.noRepeat, () => {
  const f = productionFixture();
  f.move("poro", "bf1");
  f.settle();
  assert.equal(goldTokens(f.kernel).length, 1);

  const translated = translateTriggerFilter(ability.trigger.filter, "poro", "conquer");
  const [conquer] = conquers(f);
  assert.equal(matchesTriggerEvent(translated, conquer, "A"), true);
  const laterConquer = { ...conquer, object: f.kernel.getObject("poro"), source: f.kernel.getObject("poro"), it: f.kernel.getObject("poro") };
  assert.equal(matchesTriggerEvent(translated, laterConquer, "A"), true);
  // CR 472/473.2.c: scoring the same Battlefield again this turn emits no new
  // Conquer event, so the earlier event cannot be replayed into a free token.
  assert.equal(conquers(f).length, 1);
  assert.equal(goldTokens(f.kernel).length, 1);
  assert.deepEqual(f.kernel.pendingItems, []);
});
