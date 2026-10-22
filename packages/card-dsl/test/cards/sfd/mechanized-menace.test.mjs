import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import mechanizedMenace from "../../../dist/cards/sfd/mechanized-menace.js";
import { CombatFlow } from "../../../../engine-core/dist/combat/flow.js";
import { getTokenDefinition } from "../../../../engine-core/dist/effects/tokens/definitions.js";
import { productionPlay } from "../../fixtures/production-play.mjs";

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
    ruleRefs: Object.freeze(["187.4", "323.2", "466.2.c", "466.2.c.1.a", "466.2.c.2", "466.2.c.3", "467.2", "467.2.a", "467.2.b", "478.1", "478.2", "478.3", "478.4", "801.3.a", "801.3.a.3", "814.1", "814.1.b.3", "814.1.c", "814.1.d", "814.1.d.1", "814.2"]),
    timeline: Object.freeze([
      "Legend resolves into the public Legend Zone and attachLifecycle binds its static from that exact incarnation.",
      "The continuous ability layer grants Shield 1 to each controlled Board Unit tagged Mech; an opposing Mech and a friendly non-Mech do not match.",
      "At combat start, CR 466.2.c.1.a gives the Attacker Focus and CR 466.2.c.2-.3 gives each participant's Units the matching designation.",
      "While the Showdown closes, the Shield-aware keyword view re-expands Defender's Shield 1; CR 478 requires the arithmetic layer to apply it once and recalculate after dependencies.",
      "CR 467.2 sums current Might when damage starts: the Attacker budgets 3 and the Shielded Mech Defender budgets 4. CR 814.1.d.1 removes the bonus when Defender designation ends."
    ]),
    priorityFocus: "The static grant and its layer evaluation create no Focus or Priority. The Attacker B begins the Combat Showdown with Focus/Priority under CR 466.2.c.1.a; closing the Showdown follows CR 347/348.",
    responseWindow: "A legal reaction window is the ordinary Combat Showdown: Attacker B may act with Focus, control passes to A in Turn Order, and both must pass before combat damage. The static grant opens no separate response.",
    lki: "Not applicable to this static grant: CR 814.1.d.1 ends the Shield Might bonus as soon as the Unit loses Defender, and the effect caches no left-board value.",
    productionAssertions: Object.freeze([
      "legend lifecycle grants Shield 1 only to controlled Mechs",
      "CombatFlow assigns the real Defender role and sends it through the damage runtime",
      "the production Shield re-expansion creates exactly one +1 arithmetic rule",
      "prepareDamage budgets the Mech Defender at 4 and its non-Mech control case at 3"
    ])
  })
});

const battlefield = Object.freeze({ type: "battlefield", id: "bf1" });

function shieldKeywords(keywords) {
  return keywords.filter(keyword => keyword.id.toLowerCase() === "shield");
}

function productionScene({
  legendController = "A",
  attackerController = "A",
  defenderController = "B",
  attackerTags = [],
  defenderTags = ["Mech"]
} = {}) {
  const production = productionPlay({
    programs: [mechanizedMenace],
    build: builder => builder.player("A").player("B")
      .base("friendly-mech", { controller: "A", might: 3, tags: ["Mech", "Yordle"] })
      .base("friendly-plain", { controller: "A", might: 3, tags: ["Yordle"] })
      .unit("enemy-mech", {
        owner: "B", controller: "B", might: 3, tags: ["Mech"],
        location: { type: "base", player: "B" }
      })
      .unit("attacker", {
        owner: attackerController, controller: attackerController, might: 3, power: null, tags: attackerTags,
        keywords: [], location: battlefield
      })
      .unit("defender", {
        owner: defenderController, controller: defenderController, might: 3, power: null, tags: defenderTags,
        keywords: [], location: battlefield
      })
      .deck("A:deck:0", { owner: "A" }).deck("B:deck:0", { owner: "B" })
      .rune("A:rune:0", { owner: "A" }).rune("B:rune:0", { owner: "B" })
  });
  const { kernel, engine: chain, binding, requests } = production;
  const flow = new CombatFlow(chain, chain.pipeline.host,
    [{ id: "bf1", controller: defenderController }, { id: "bf2", controller: null }], () => {},
    { events: true, lifecycle: true });
  const created = chain.commit({ type: "create-token", player: legendController, to: "legend", token: {
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
  const closeShowdown = attacker => {
    assert.equal(chain.focus, attacker);
    chain.pass(attacker);
    const next = chain.pipeline.turnOrder[
      (chain.pipeline.turnOrder.indexOf(attacker) + 1) % chain.pipeline.turnOrder.length
    ];
    assert.equal(chain.focus, next);
    chain.pass(chain.focus);
    assert.equal(chain.turnState, "neutral-open");
  };
  return {
    kernel, chain, flow, binding, legendRef, requests, setObjects, evaluate, freshLayers,
    settleChain, closeShowdown
  };
}

test("sfd-181-221 Mechanized Menace: program passes validateCardProgram", () => {
  const result = validateCardProgram(mechanizedMenace);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("sfd-181-221 Mechanized Menace: identity, status and executable IR", () => {
  assert.equal(mechanizedMenace.canonicalCardId, CARD_ID);
  assert.equal(mechanizedMenace.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(mechanizedMenace.status, "executable");
  assert.equal(mechanizedMenace.judgeReason, undefined);
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
  for (const rule of ["466.2.c.1.a", "466.2.c.3", "467.2.a", "467.2.b", "478.1", "478.4", "801.3.a", "814.1.b.3", "814.1.c", "814.1.d.1"]) {
    assert.ok(PRODUCTION_EVIDENCE.grant.ruleRefs.includes(rule), `${rule} is pinned`);
  }
  assert.equal(PRODUCTION_EVIDENCE.grant.timeline.length, 5);
  assert.match(PRODUCTION_EVIDENCE.grant.priorityFocus, /Focus/);
  assert.match(PRODUCTION_EVIDENCE.grant.responseWindow, /Combat Showdown/);
  assert.match(PRODUCTION_EVIDENCE.grant.lki, /814\.1\.d\.1/);
  assert.equal(PRODUCTION_EVIDENCE.grant.productionAssertions.length, 4);
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

test("sfd-181-221 Mechanized Menace production: granted Shield adds one Might to the real Defender damage budget", () => {
  const f = productionScene({
    legendController: "A", attackerController: "B", defenderController: "A",
    attackerTags: ["Mech"]
  });
  f.flow.entered(f.kernel.getObject("attacker"));
  f.flow.cleanup();
  f.chain.advance();
  const started = f.flow.startCombat("bf1");
  assert.deepEqual(started, {
    field: "bf1", combatId: "combat:bf1:1", attacker: "B", defender: "A", focus: "B"
  });
  assert.equal(f.chain.focus, "B");
  assert.equal(f.chain.priority, "B");
  assert.equal(f.chain.canAct("B", "action"), true);
  assert.equal(f.chain.canAct("A", "action"), false);
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
  f.closeShowdown("B");
  const plan = f.flow.prepareDamage();
  const shieldRules = f.chain.layers.registry.lifecycleRuleEffects().filter(entry =>
    entry.effect.source?.id === "defender" &&
    entry.effect.effect.kind === "continuous.might" &&
    entry.effect.id.startsWith("program-keyword:"));
  assert.equal(shieldRules.length, 1, "the lifecycle publishes exactly one derived Shield Might rule");
  assert.equal(shieldRules[0].effect.effect.amount, 1);
  assert.equal(shieldRules[0].effect.effect.condition(f.flow.snapshot(f.kernel.getObject("defender"))), true);
  assert.equal(plan.attacker.budget, 3, "the opposing Attacker does not receive the grant");
  assert.equal(plan.defender.budget, 4, "the Shielded Mech Defender resolves damage using Might 4");
  assert.deepEqual(f.flow.damageView(), {
    combatId: "combat:bf1:1", battlefieldId: "bf1", attackerPlayerId: "B", defenderPlayerId: "A",
    attackerMight: 3, defenderMight: 4, attackerSubmitted: false
  });

  assert.deepEqual(f.requests, []);
});

test("sfd-181-221 Mechanized Menace production boundary: a non-Mech Defender keeps its printed Might", () => {
  const f = productionScene({
    legendController: "A", attackerController: "B", defenderController: "A",
    attackerTags: ["Mech"], defenderTags: []
  });
  f.flow.entered(f.kernel.getObject("attacker"));
  f.flow.cleanup();
  f.chain.advance();
  f.flow.startCombat("bf1");
  f.settleChain();
  f.closeShowdown("B");
  const plan = f.flow.prepareDamage();
  assert.deepEqual(shieldKeywords(f.evaluate("defender").keywords), [],
    "a friendly-to-its-controller non-Mech does not gain Shield");
  assert.equal(plan.attacker.budget, 3);
  assert.equal(plan.defender.budget, 3, "without Shield, the Defender damage budget remains 3");
  assert.deepEqual(f.requests, []);
});

test("sfd-181-221 Mechanized Menace production boundary: Shield does not add Might to an Attacker", () => {
  const f = productionScene({
    legendController: "A", attackerController: "A", defenderController: "B",
    attackerTags: ["Mech"], defenderTags: []
  });
  f.flow.entered(f.kernel.getObject("attacker"));
  f.flow.cleanup();
  f.chain.advance();
  f.flow.startCombat("bf1");
  f.settleChain();
  f.closeShowdown("A");
  const plan = f.flow.prepareDamage();
  assert.equal(shieldKeywords(f.evaluate("attacker").keywords).length, 1,
    "the controlled Mech Attacker has Shield");
  assert.equal(plan.attacker.budget, 3, "CR 814.1.c adds this Shield bonus only while defending");
  assert.equal(plan.defender.budget, 3);
  assert.deepEqual(f.requests, []);
});
