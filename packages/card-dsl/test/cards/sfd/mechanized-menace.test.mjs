import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import mechanizedMenace from "../../../dist/cards/sfd/mechanized-menace.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { CombatFlow } from "../../../../engine-core/dist/combat/flow.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { getTokenDefinition } from "../../../../engine-core/dist/effects/tokens/definitions.js";

const CARD_ID = "card.hash-fadaa09c681d3d967954f99504cd9d3d749242dc99dbc40d60adfa60bf53cca7";
const CORE_URL = "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf";
const RADIANCE_URL = "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/";
const SFD_ERRATA_URL = "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/";
const SOURCE_TEXT = "Your Mechs have [Shield]. (+1 :rb_might: while they're defenders.)";

// Evidence is pinned to the repository's official source snapshots. The
// Radiance and Spiritforged errata snapshots contain no Mechanized Menace entry
// or correction, so their only effect here is the governing CR v1.5 basis.
const OFFICIAL_EVIDENCE = Object.freeze({
  contract: "riftbound.official-effect-order-evidence.v1",
  canonicalCardId: CARD_ID,
  sources: Object.freeze({
    coreRules: Object.freeze({
      version: "1.5",
      dated: "2026-10-09",
      url: CORE_URL,
      localSha256: "94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec"
    }),
    radianceRulings: Object.freeze({
      published: "2026-10-09",
      effective: "2026-10-16",
      url: RADIANCE_URL,
      applicableToThisCard: false,
      result: "reviewed: no Mechanized Menace-specific ruling changes CR v1.5"
    }),
    spiritforgedErrata: Object.freeze({
      published: "2026-01-14",
      effective: null,
      url: SFD_ERRATA_URL,
      applicableToThisCard: false,
      result: "reviewed: no Mechanized Menace correction"
    })
  })
});

const PRODUCTION_EVIDENCE = Object.freeze({
  grant: Object.freeze({
    canonicalCardId: CARD_ID,
    clauses: Object.freeze([
      "Your Mechs have [Shield].",
      "(+1 :rb_might: while they're defenders.)"
    ]),
    ruleRefs: Object.freeze(["187.4", "466.2.c", "466.2.c.2", "466.2.c.3", "801.3.a", "801.3.a.3", "814.1", "814.1.b.3", "814.1.c", "814.1.d", "814.1.d.1", "814.2"]),
    timeline: Object.freeze([
      "Legend resolves into the public Legend Zone and attachLifecycle binds its static from that exact incarnation.",
      "The continuous ability layer grants Shield 1 to each controlled Board Unit tagged Mech; an opposing Mech and a friendly non-Mech do not match.",
      "At combat start, CR 466.2.c.2-.3 gives the defending controller's Units the Defender designation.",
      "The Shield-aware keyword view re-expands Defender's Shield 1 and the arithmetic layer must add +1 Might while the designation remains.",
      "No Chain item is created by this passive grant. During the Combat Showdown, ordinary Focus/Priority still governs legally timed actions."
    ]),
    priorityFocus: "The static grant and its layer evaluation create no Focus or Priority. A begins the Combat Showdown with Focus/Priority under CR 466.2.c.1.a; closing the Showdown follows CR 347/348.",
    responseWindow: "A legal sideline reaction window is the ordinary Combat Showdown: Focus holder A may act, then B in Turn Order, and both must pass before combat damage. The static grant itself opens no separate response.",
    lki: "Not applicable to this static grant: CR 814.1.d.1 ends the Shield Might bonus as soon as the Unit loses Defender. No left-board value is cached.",
    productionAssertions: Object.freeze([
      "legend lifecycle grants Shield 1 only to controlled Mechs",
      "CombatFlow assigns the real Defender role and sends it through the damage runtime",
      "the production keyword registry omits Shield's derived arithmetic effect, so the defender budget remains 3 instead of 4"
    ])
  })
});

// The published program stays gated. This view admits only the status gate so
// the real binding, lifecycle, LayerEngine and CombatFlow can be exercised.
const admitted = Object.freeze({ ...mechanizedMenace, status: "executable", judgeReason: undefined });
const battlefield = Object.freeze({ type: "battlefield", id: "bf1" });

function shieldKeywords(keywords) {
  return keywords.filter(keyword => keyword.id.toLowerCase() === "shield");
}

function productionScene({ includeAttacker = true, includeDefender = true } = {}) {
  const builder = world().player("A").player("B")
    .base("friendly-mech", { controller: "A", might: 3, tags: ["Mech", "Yordle"] })
    .base("friendly-plain", { controller: "A", might: 3, tags: ["Yordle"] })
    .unit("enemy-mech", {
      owner: "B", controller: "B", might: 3, tags: ["Mech"],
      location: { type: "base", player: "B" }
    });
  if (includeAttacker) builder.unit("attacker", {
    owner: "A", controller: "A", might: 3, power: null, keywords: [], location: battlefield
  });
  if (includeDefender) builder.unit("defender", {
    owner: "B", controller: "B", might: 3, power: null, tags: ["Mech"], keywords: [], location: battlefield
  });
  for (const player of ["A", "B"]) {
    builder.deck(`${player}:deck:0`, { owner: player });
    builder.rune(`${player}:rune:0`, { owner: player });
  }
  const kernel = builder.build();
  const requests = [];
  const choose = request => {
    requests.push(request);
    if (request.type === "mode" && request.id.startsWith("engagement:")) return request.options[0];
    if (request.type === "select-objects" && request.min === request.max &&
        request.options.length === request.min) return [...request.options];
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
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const chain = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  const flow = new CombatFlow(chain, host,
    [{ id: "bf1", controller: "B" }, { id: "bf2", controller: null }], () => {},
    { events: true, lifecycle: true });
  const binding = createProgramBinding({ cardPrograms: [admitted] });
  binding.attachLifecycle(chain, error => { throw error; });
  const created = chain.commit({ type: "create-token", player: "A", to: "legend", token: {
    cardId: CARD_ID, name: "Mechanized Menace", types: ["legend"], tags: ["Rumble"],
    championLegend: true, keywords: [], might: null, energy: null, power: null
  } });
  assert.equal(created.status, "done");
  const legendEvent = created.events.find(event => event.objectId !== undefined && event.cardId === CARD_ID);
  assert.ok(legendEvent, "create-token emits the exact Legend incarnation");
  const legend = kernel.getObject(legendEvent.objectId);
  assert.ok(legend, "the production create-token result names the live Legend");
  assert.equal(legend.zone, "legend");
  const legendRef = legend.ref;
  return scene(kernel, chain, flow, binding, legendRef, requests);
}

function scene(kernel, chain, flow, binding, legendRef, requests) {
  const setObjects = objects => chain.layers.setObjects(objects);
  const evaluate = id => chain.layers.evaluate(kernel.ref(id));
  const freshLayers = () => { setObjects(kernel.objects); };
  freshLayers();
  const settleChain = () => {
    for (let guard = 0; guard < 40 && chain.items.length > 0; guard++) chain.pass(chain.priority);
    assert.equal(chain.items.length, 0, "the Combat Showdown chain must settle");
  };
  const closeShowdown = () => {
    assert.equal(chain.focus, "A");
    chain.pass("A");
    assert.equal(chain.focus, "B");
    chain.pass("B");
    assert.equal(chain.turnState, "neutral-open");
  };
  return { kernel, chain, flow, binding, legendRef, requests, setObjects, evaluate, freshLayers, settleChain, closeShowdown };
}

test("sfd-181-221 Mechanized Menace: program passes validateCardProgram", () => {
  const result = validateCardProgram(mechanizedMenace);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("sfd-181-221 Mechanized Menace: identity, status and current production blocker", () => {
  assert.equal(mechanizedMenace.canonicalCardId, CARD_ID);
  assert.equal(mechanizedMenace.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(mechanizedMenace.status, "judge-required");
  assert.match(mechanizedMenace.judgeReason, /Legend 区/);
  assert.match(mechanizedMenace.judgeReason, /combat\/transactions\/damage\.ts:162-171/);
  assert.match(mechanizedMenace.judgeReason, /programs\/statics\.ts:244-260/);
  assert.match(mechanizedMenace.judgeReason, /Defender 角色已进入/);
  assert.match(mechanizedMenace.judgeReason, /防守方预算仍为印刷 3 而非 4/);
  assert.match(mechanizedMenace.judgeReason, /814\.1\.c/);
  assert.doesNotMatch(mechanizedMenace.judgeReason, /尚缺真实战斗验证/);
});

test("sfd-181-221 Mechanized Menace: single static Shield 1 grant scoped to controlled Board Mechs", () => {
  assert.equal(mechanizedMenace.abilities.length, 1);
  const ability = mechanizedMenace.abilities[0];
  assert.equal(ability.kind, "static");
  assert.deepEqual(ability.effect, {
    kind: "grant-keyword",
    keyword: "shield",
    value: { kind: "constant", value: 1 },
    filter: { type: "unit", tag: "Mech", controller: "controller", zone: "board" }
  });
  assert.equal(ability.condition, undefined);
  assert.equal(mechanizedMenace.sourceText, SOURCE_TEXT);
});

test("sfd-181-221 Mechanized Menace: official effect-order evidence is pinned to CR v1.5", () => {
  assert.equal(OFFICIAL_EVIDENCE.canonicalCardId, mechanizedMenace.canonicalCardId);
  assert.deepEqual(OFFICIAL_EVIDENCE.sources.coreRules, {
    version: "1.5",
    dated: "2026-10-09",
    url: CORE_URL,
    localSha256: "94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec"
  });
  assert.equal(OFFICIAL_EVIDENCE.sources.radianceRulings.effective, "2026-10-16");
  assert.equal(OFFICIAL_EVIDENCE.sources.radianceRulings.applicableToThisCard, false);
  assert.equal(OFFICIAL_EVIDENCE.sources.spiritforgedErrata.applicableToThisCard, false);
  assert.equal(PRODUCTION_EVIDENCE.grant.canonicalCardId, mechanizedMenace.canonicalCardId);
  for (const rule of ["466.2.c.3", "801.3.a", "814.1.b.3", "814.1.c", "814.1.d.1"]) {
    assert.ok(PRODUCTION_EVIDENCE.grant.ruleRefs.includes(rule), `${rule} is pinned`);
  }
  assert.equal(PRODUCTION_EVIDENCE.grant.timeline.length, 5);
  assert.match(PRODUCTION_EVIDENCE.grant.priorityFocus, /Focus/);
  assert.match(PRODUCTION_EVIDENCE.grant.responseWindow, /Combat Showdown/);
  assert.match(PRODUCTION_EVIDENCE.grant.lki, /814\.1\.d\.1/);
  assert.equal(PRODUCTION_EVIDENCE.grant.productionAssertions.length, 3);
});

test("sfd-181-221 Mechanized Menace production: lifecycle grants Shield 1 only to its controller's Mechs", () => {
  const f = productionScene();
  assert.deepEqual(shieldKeywords(f.evaluate("friendly-mech").keywords).map(keyword => keyword.value), [1]);
  assert.deepEqual(shieldKeywords(f.evaluate("friendly-plain").keywords), [], "a friendly non-Mech is unaffected");
  assert.deepEqual(shieldKeywords(f.evaluate("enemy-mech").keywords), [], "an opposing Mech is unaffected");
  assert.equal(f.kernel.getObject(f.legendRef.id).zone, "legend");
});

test("sfd-181-221 Mechanized Menace reaches the CR 187.4 Mech token's real tag", () => {
  const mechToken = getTokenDefinition("mech");
  assert.ok(mechToken, "the frozen Mech token definition exists");
  assert.ok(mechToken.spec.tags.includes(mechanizedMenace.abilities[0].effect.filter.tag));
});

test("sfd-181-221 Mechanized Menace keeps a Champion Legend and its Shield grant in Legend", () => {
  const f = productionScene();
  assert.equal(shieldKeywords(f.evaluate("friendly-mech").keywords).length, 1);
  assert.equal(f.chain.commit({ type: "move-zone", object: f.legendRef, to: "banishment" }).status, "prevented");
  f.freshLayers();
  assert.equal(shieldKeywords(f.evaluate("friendly-mech").keywords).length, 1);
  assert.equal(f.kernel.getObject(f.legendRef.id).zone, "legend");
});

test("sfd-181-221 Mechanized Menace production: the damage runtime supplies Defender, while granted Shield has no derived arithmetic effect", () => {
  const f = productionScene();
  f.flow.entered(f.kernel.getObject("attacker"));
  f.flow.cleanup();
  f.chain.advance();
  const started = f.flow.startCombat("bf1");
  assert.deepEqual(started, {
    field: "bf1", combatId: "combat:bf1:1", attacker: "A", defender: "B", focus: "A"
  });
  assert.equal(f.chain.focus, "A");
  assert.equal(f.chain.priority, "A");
  assert.equal(f.chain.canAct("A", "action"), true);
  assert.equal(f.chain.canAct("B", "action"), false);
  assert.deepEqual(
    f.chain.pipeline.events
      .filter(event => ["combat-start", "attack-declared", "defense-declared"].includes(event.timingPoint))
      .map(event => event.timingPoint),
    ["combat-start", "attack-declared", "defense-declared"]
  );
  assert.equal(f.flow.snapshot(f.kernel.getObject("defender")).combatRole, "defender");
  assert.equal(f.kernel.getObject("defender").combatRole, null,
    "CombatFlow keeps its rolled roles private and does not write the host incarnation");

  f.settleChain();
  f.closeShowdown();
  // This is the exact object set and role projection the real damage planner
  // sends to its LayerEngine (combat/transactions/damage.ts:162-171).
  const runtime = f.flow.runtime();
  assert.deepEqual(runtime.units.map(unit => [unit.object.ref.id, unit.object.combatRole]), [
    ["attacker", "attacker"], ["defender", "defender"]
  ]);
  assert.equal(
    f.chain.layers.registry.list().some(entry => entry.effect.id.startsWith("program-keyword:") &&
      entry.effect.layer === "arithmetic"),
    false,
    "no production arithmetic registration is generated from the Shield grant"
  );

  assert.deepEqual(f.requests, []);
});

test("sfd-181-221 Mechanized Menace production boundary: a combat without the defending Mech does not obtain Shield", () => {
  const f = productionScene({ includeDefender: false });
  f.freshLayers();
  assert.equal(f.kernel.getObject("defender"), null);
  assert.deepEqual(shieldKeywords(f.evaluate("enemy-mech").keywords), [],
    "the other player's Mech remains unaffected while the Legend's opponent is acting");
});
