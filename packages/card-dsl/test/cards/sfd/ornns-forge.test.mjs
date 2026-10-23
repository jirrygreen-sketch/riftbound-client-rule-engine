import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/ornns-forge.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import orbOfRegret from "../../../dist/cards/ogn/orb-of-regret.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { staticCostSources } from "../../../../engine-core/dist/programs/static-adapters/index.js";
import { ChainContractBlockedError } from "../../../../engine-core/dist/chain/engine.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { productionPlay } from "../../fixtures/production-play.mjs";

const CANONICAL = "card.hash-44e95dd0a87b7dfcd7565b73a33e204f85c97ac82e004a6127ff7ed649fb41ad";
const SOURCE_TEXT =
  "While you control this battlefield, the first friendly non-token gear played each turn costs :rb_energy_1: less.";
const CORE_RULES_URL =
  "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf";
const RADIANCE_RULINGS_URL =
  "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/";
const SFD_ERRATA_URL =
  "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/";

const PRODUCTION_TEST_NAMES = Object.freeze({
  golden: "sfd-213-221 Ornn's Forge production golden: the first friendly non-token Gear pays one less",
  token: "sfd-213-221 Ornn's Forge production boundary: token Gear does not consume the first-Gear window",
  spell: "sfd-213-221 Ornn's Forge production boundary: a spell between Gear plays does not consume the window",
  enemy: "sfd-213-221 Ornn's Forge production boundary: the controller's Forge does not discount an opponent's Gear",
  uncontrolled: "sfd-213-221 Ornn's Forge production boundary: projected uncontrolled Forge control is dormant",
  nullCost: "sfd-213-221 Ornn's Forge production boundary: a null printed Energy cost never becomes zero"
});

// Reviewed against the official source snapshots named in
// /root/swarm-rift/shared/official-effect-order-policy.json. Neither the
// Radiance rulings nor the Spiritforged errata changes Ornn's Forge. This
// passive cost modification creates no triggered ordering or numeric priority.
const OFFICIAL_EFFECT_ORDER_EVIDENCE = Object.freeze({
  contract: "riftbound.official-effect-order-evidence.v1",
  canonicalCardId: CANONICAL,
  rulingStatus: "no-card-specific-ruling",
  catalogPrinting: Object.freeze({
    id: "sfd-213-221",
    textSource: "packages/card-data/data/deck-catalog.json",
    sourceText: SOURCE_TEXT
  }),
  sources: Object.freeze({
    coreRules: Object.freeze({
      version: "1.5",
      published: "2026-10-09",
      effective: "2026-10-16",
      url: CORE_RULES_URL,
      patchNotesUrl: RADIANCE_RULINGS_URL,
      sha256: "94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec"
    }),
    radianceRulings: Object.freeze({
      published: "2026-10-09",
      effective: "2026-10-16",
      url: RADIANCE_RULINGS_URL,
      sha256: "dfba4f3ecf6956c32c19327330eaca96d317bedbf2c211c80a8fe1f1dccb569f",
      appliesToThisCard: false,
      result: "reviewed: no Ornn's Forge-specific ruling"
    }),
    spiritforgedErrata: Object.freeze({
      published: "2026-01-14",
      effective: null,
      url: SFD_ERRATA_URL,
      sha256: "dca55c2d013473ffca82fb649a70d16d4b4356c22f74bd5a71b3aa3a9a4c94af",
      appliesToThisCard: false,
      result: "reviewed: no Ornn's Forge correction"
    })
  }),
  interactions: Object.freeze([
    Object.freeze({
      id: "controlled-first-friendly-non-token-gear-discount",
      canonicalCardId: CANONICAL,
      sourceIds: Object.freeze(["coreRules", "radianceRulings", "spiritforgedErrata"]),
      clauses: Object.freeze([
        "While you control this battlefield",
        "the first friendly non-token gear played each turn costs :rb_energy_1: less"
      ]),
      ruleRefs: Object.freeze([
        "190.6", "190.6.a", "190.6.d", "303.1", "337.1.a", "337.2",
        "350.1", "356.1", "356.2", "356.3", "356.4", "356.4.a",
        "356.4.b", "356.4.c", "356.4.c.1", "356.4.c.2", "356.4.d",
        "356.4.d.1", "356.6", "357.1", "359.2.d", "420.4.b"
      ]),
      timeline: Object.freeze([
        "The on-Board Battlefield supplies the passive only while the host's live source is controlled; a projected uncontrolled source supplies no implied 'you'.",
        "Playing a Gear moves it to a Pending Chain item. Its controller is the payer and there is no optional additional cost to choose.",
        "Finalize reads the authoritative current-turn card-Finalize history before recording the current card, then applies one Energy discount to a qualifying friendly non-token Gear (for example 3 to 2 or 1 to 0).",
        "Finalize commits the real Pay action and records the successful card Finalize; the resultant cost modification creates no response window.",
        "The Gear item applies 337.2 and resolves immediately ready at its controller's Base. A later qualifying Gear reads the earlier Finalize record and pays its printed cost.",
        "A rolled-back attempt is absent from the transactional history, while 420.4.b's Finalize basis is not inferred from the card's later zone or resolution."
      ]),
      priorityFocus: "This passive consumes no Focus and opens no Chain item. It is evaluated inside the Gear's Finalize without passing Priority (337.1.a).",
      responseWindow: "The static cost modification itself creates no Reaction window. The surrounding play follows its ordinary timing; the production golden finalizes and immediately resolves each Gear under 337.2.",
      lki: "The Battlefield source is read live while controlled. The per-turn history uses the successful Finalize snapshot to identify Gear, controller and token status; it does not infer a prior play from the card's current zone or resolution.",
      nonApplicableOrdering: Object.freeze([
        "303.2.a does not assign a numeric priority: this card creates no simultaneous triggered abilities.",
        "No replacement or prevention effect applies to this discount.",
        "No layer dependency exists in cost.modify; the cost is applied in CR 356's ordered cost steps."
      ]),
      productionTestNames: Object.freeze([
        PRODUCTION_TEST_NAMES.golden,
        PRODUCTION_TEST_NAMES.token,
        PRODUCTION_TEST_NAMES.spell,
        PRODUCTION_TEST_NAMES.enemy,
        PRODUCTION_TEST_NAMES.uncontrolled,
        PRODUCTION_TEST_NAMES.nullCost
      ])
    })
  ])
});

const [ability] = program.abilities;

const exportedProgram = (canonicalCardId) => ({
  canonicalCardId,
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText: `Synthetic RIFT-994 traversal card ${canonicalCardId}.`,
  abilities: []
});

const GEAR = exportedProgram("synthetic:rift-994:gear");
const NULL_COST_GEAR = exportedProgram("synthetic:rift-994:null-cost-gear");
const SPELL = exportedProgram("synthetic:rift-994:spell");

function card(id, cardProgram, { type = "gear", energy = 2, owner = "A", isToken = false } = {}) {
  return {
    id,
    cardId: cardProgram.canonicalCardId,
    owner,
    controller: owner,
    types: [type],
    zone: "hand",
    energy,
    power: null,
    isToken
  };
}

function forgeScene({ forgeController = "A", turnPlayer = "A", cards, programs }) {
  const f = productionPlay({
    programs: [program, ...programs],
    turnPlayer,
    build: (w) => {
      let builder = w.player("A", { energy: 10 }).player("B", { energy: 10 });
      for (const value of cards) builder = builder.object(value.id, value);
      // Exercise the real Battlefield lifecycle entry, not a synthetic static
      // capability installed after the Board object already exists.
      return builder.object("forge", {
        cardId: CANONICAL,
        types: ["battlefield"],
        controller: forgeController,
        owner: "A",
        zone: "chain",
        energy: null,
        power: null,
        location: { type: "battlefield", id: "forge-field" }
      });
    }
  });
  const forge = f.kernel.getObject("forge");
  f.engine.commit({
    type: "move-zone",
    object: forge.ref,
    to: "battlefield",
    location: { type: "battlefield", id: "forge-field" }
  });
  f.engine.advance();
  return f;
}

function playObserved(f, id, player = "A") {
  const eventStart = f.kernel.events.length;
  const traceStart = f.engine.trace.length;
  f.play(id, player);
  return {
    events: f.kernel.events.slice(eventStart),
    trace: f.engine.trace.slice(traceStart),
    payments: f.kernel.events.slice(eventStart).filter((event) => event.action === "pay")
  };
}

function assertFinalizeResolveOrder(trace, id) {
  const item = `play:${id}:`;
  const pending = trace.findIndex((entry) => entry.step === "pending" && entry.item?.startsWith(item));
  const finalized = trace.findIndex((entry) => entry.step === "finalized" && entry.item?.startsWith(item));
  const resolving = trace.findIndex((entry) => entry.step === "resolve-start" && entry.item?.startsWith(item));
  const resolved = trace.findIndex((entry) => entry.step === "resolved" && entry.item?.startsWith(item));
  assert.ok(pending >= 0 && finalized > pending && resolving > finalized && resolved > resolving,
    `${id} follows Pending -> Finalize -> Resolve`);
  assert.equal(
    trace.slice(finalized, resolving).some((entry) => entry.step === "pass"),
    false,
    "CR 337.2 resolves the finalized Gear without a Priority pass"
  );
}

test("sfd-213-221 Ornn's Forge: executable program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(Object.hasOwn(program, "judgeReason"), false);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-213-221 Ornn's Forge: official effect-order evidence binds every production assertion", () => {
  const evidence = OFFICIAL_EFFECT_ORDER_EVIDENCE;
  assert.equal(evidence.contract, "riftbound.official-effect-order-evidence.v1");
  assert.equal(evidence.canonicalCardId, CANONICAL);
  assert.deepEqual(evidence.sources.coreRules, {
    version: "1.5",
    published: "2026-10-09",
    effective: "2026-10-16",
    url: CORE_RULES_URL,
    patchNotesUrl: RADIANCE_RULINGS_URL,
    sha256: "94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec"
  });
  assert.equal(evidence.sources.radianceRulings.effective, "2026-10-16");
  assert.equal(evidence.sources.radianceRulings.appliesToThisCard, false);
  assert.equal(evidence.sources.spiritforgedErrata.appliesToThisCard, false);
  assert.deepEqual(evidence.catalogPrinting, {
    id: "sfd-213-221",
    textSource: "packages/card-data/data/deck-catalog.json",
    sourceText: SOURCE_TEXT
  });
  assert.deepEqual(evidence.interactions.map((interaction) => interaction.id), [
    "controlled-first-friendly-non-token-gear-discount"
  ]);
  const [interaction] = evidence.interactions;
  assert.equal(interaction.canonicalCardId, CANONICAL);
  assert.deepEqual(interaction.productionTestNames, Object.values(PRODUCTION_TEST_NAMES));
  for (const rule of ["190.6.a", "190.6.d", "337.1.a", "356.4.b", "356.6", "357.1", "420.4.b"]) {
    assert.ok(interaction.ruleRefs.includes(rule), `${rule} is pinned to this card's evidence`);
  }
  assert.ok(interaction.timeline.some((line) => /Pending Chain item/u.test(line)));
  assert.ok(interaction.timeline.some((line) => /Finalize history/u.test(line)));
  assert.ok(interaction.timeline.some((line) => /real Pay action/u.test(line)));
  assert.match(interaction.priorityFocus, /without passing Priority/u);
  assert.match(interaction.responseWindow, /no Reaction window/u);
  assert.match(interaction.lki, /Finalize snapshot/u);
});

test("sfd-213-221 Ornn's Forge: static cost-modify structure", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "cost.modify");
  assert.deepEqual(ability.effect.value, { kind: "constant", value: { energy: -1 } });
  assert.equal(ability.effect.duration, "per-turn-first-play");
  assert.equal(ability.effect.appliesTo, "play-cost");
  assert.deepEqual(ability.effect.filter, { type: "gear", controller: "controller", isToken: false });
  assert.deepEqual(ability.condition, {
    kind: "compare",
    left: { kind: "count", subject: "objects", filter: { object: "self", controller: "self" } },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
});

test(PRODUCTION_TEST_NAMES.golden, () => {
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.interactions[0].productionTestNames.includes(PRODUCTION_TEST_NAMES.golden), true);
  const f = forgeScene({
    cards: [
      card("first-gear", orbOfRegret, { energy: 1 }),
      card("second-gear", orbOfRegret, { energy: 1 })
    ],
    programs: [orbOfRegret]
  });
  const [source] = staticCostSources(f.engine);
  assert.ok(source, "the controlled production Battlefield supplies its cost capability");
  assert.equal(source.source.id, "forge");

  const first = playObserved(f, "first-gear");
  assert.deepEqual(first.payments.map((event) => event.energy), [0], "1 printed Energy minus the discount");
  assert.equal(f.kernel.player("A").energy, 10);
  assert.deepEqual(
    f.engine.finalizedCardPlaysThisTurn().map((record) => record.object.ref.id),
    ["first-gear"],
    "the first successful card Finalize enters current-turn history"
  );
  assertFinalizeResolveOrder(first.trace, "first-gear");

  const second = playObserved(f, "second-gear");
  assert.deepEqual(second.payments.map((event) => event.energy), [1], "the later Gear pays full printed cost");
  assert.equal(f.kernel.player("A").energy, 9);
  assert.deepEqual(
    f.engine.finalizedCardPlaysThisTurn().map((record) => record.object.ref.id),
    ["first-gear", "second-gear"]
  );
  assertFinalizeResolveOrder(second.trace, "second-gear");

  for (const id of ["first-gear", "second-gear"]) {
    const entered = f.kernel.getObject(id);
    assert.equal(entered.zone, "board");
    assert.equal(entered.exhausted, false, "359.2.d: Non-Unit Gear enters ready");
    assert.deepEqual(entered.location, { type: "base", player: "A" });
  }
  assert.equal(
    f.engine.pipeline.events.filter((event) => event.timingPoint === "card-played" &&
      ["first-gear", "second-gear"].includes(event.object?.ref.id)).length,
    2
  );
  assert.equal(
    f.engine.pipeline.events.filter((event) => event.timingPoint === "chain-item-finalize" &&
      ["first-gear", "second-gear"].includes(event.object?.ref.id) && event.details?.cardFinalize === true).length,
    2
  );
});

test(PRODUCTION_TEST_NAMES.token, () => {
  const f = forgeScene({
    cards: [
      card("token-gear", GEAR, { isToken: true }),
      card("non-token-gear", GEAR)
    ],
    programs: [GEAR]
  });
  const token = playObserved(f, "token-gear");
  assert.deepEqual(token.payments.map((event) => event.energy), [2], "the printed non-token filter excludes token Gear");
  assert.equal(f.kernel.player("A").energy, 8);

  const gear = playObserved(f, "non-token-gear");
  assert.deepEqual(gear.payments.map((event) => event.energy), [1]);
  assert.equal(f.kernel.player("A").energy, 7);
  assert.deepEqual(
    f.engine.finalizedCardPlaysThisTurn().map((record) => [record.object.ref.id, record.object.isToken]),
    [["token-gear", true], ["non-token-gear", false]]
  );
});

test(PRODUCTION_TEST_NAMES.spell, () => {
  const f = forgeScene({
    cards: [
      card("first-gear", GEAR),
      card("middle-spell", SPELL, { type: "spell" }),
      card("second-gear", GEAR)
    ],
    programs: [GEAR, SPELL]
  });
  assert.deepEqual(playObserved(f, "first-gear").payments.map((event) => event.energy), [1]);
  assert.deepEqual(playObserved(f, "middle-spell").payments.map((event) => event.energy), [2]);
  assert.deepEqual(playObserved(f, "second-gear").payments.map((event) => event.energy), [2]);
  assert.equal(f.kernel.player("A").energy, 5);
  assert.deepEqual(
    f.engine.finalizedCardPlaysThisTurn().map((record) => record.object.ref.id),
    ["first-gear", "middle-spell", "second-gear"]
  );
});

test(PRODUCTION_TEST_NAMES.enemy, () => {
  const f = forgeScene({
    forgeController: "A",
    turnPlayer: "B",
    cards: [card("enemy-gear", GEAR, { owner: "B" })],
    programs: [GEAR]
  });
  assert.equal(staticCostSources(f.engine).length, 1, "A still controls the Battlefield");
  const played = playObserved(f, "enemy-gear", "B");
  assert.deepEqual(played.payments.map((event) => event.energy), [2]);
  assert.equal(f.kernel.player("B").energy, 8);
  assert.equal(f.kernel.player("A").energy, 10);
});

test(PRODUCTION_TEST_NAMES.uncontrolled, () => {
  const kernel = world()
    .player("A", { energy: 10 })
    .player("B", { energy: 10 })
    .object("forge", {
      cardId: CANONICAL,
      types: ["battlefield"],
      zone: "chain",
      controller: "A",
      energy: null,
      power: null
    })
    .object("friendly-gear", { cardId: GEAR.canonicalCardId, types: ["gear"], zone: "hand", energy: 2, power: null })
    .build();
  let projectUncontrolled = false;
  const objects = () => kernel.objects.map((object) =>
    projectUncontrolled && object.ref.id === "forge" ? { ...object, controller: null } : object);
  const choose = (request) => {
    if (request.type === "select-objects" && request.options.length === request.min) return [...request.options];
    throw new Error(`Unexpected projected-control choice ${request.type} ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (saved) => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects,
    perform: (action) => kernel.perform(action),
    performContract: (action) => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const binding = createProgramBinding({ cardPrograms: [program, GEAR] });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host,
    cleanup: () => false, describePlay: binding.describePlay
  });
  binding.attachLifecycle(engine, (error) => { throw error; });
  const forge = kernel.getObject("forge");
  engine.commit({ type: "move-zone", object: forge.ref, to: "battlefield", location: { type: "battlefield", id: "forge-field" } });
  engine.advance();
  assert.equal(staticCostSources(engine).length, 1, "the controlled static is first bound through the real entry");

  // CR 190.6.d: the host now reports the same Battlefield incarnation with no
  // controller. This is an authority projection, not a hand-written cost plan;
  // Finalize, the cost collector, payment and Resolve still run on ChainEngine.
  projectUncontrolled = true;
  engine.layers.setObjects(objects());
  assert.equal(staticCostSources(engine).length, 0, "an uncontrolled projected source supplies no implied 'you'");
  const source = kernel.getObject("friendly-gear");
  const draft = binding.describePlay({ type: "play", object: source.ref, player: "A" }, source);
  const before = kernel.player("A").energy;
  engine.execute(draft);
  for (let guard = 0; engine.items.length && guard < 20; guard++) engine.pass(engine.priority);
  assert.deepEqual(kernel.events.filter((event) => event.action === "pay").map((event) => event.energy), [2]);
  assert.equal(before - kernel.player("A").energy, 2);
  assert.equal(kernel.getObject("friendly-gear").zone, "board");
});

test(PRODUCTION_TEST_NAMES.nullCost, () => {
  const f = forgeScene({
    cards: [card("null-cost-gear", NULL_COST_GEAR, { energy: null })],
    programs: [NULL_COST_GEAR]
  });
  const before = f.kernel.player("A").energy;
  assert.throws(
    () => f.play("null-cost-gear"),
    (error) => error instanceof ChainContractBlockedError && /source has no printed Energy cost/u.test(error.message)
  );
  assert.equal(f.kernel.getObject("null-cost-gear").zone, "hand");
  assert.equal(f.kernel.player("A").energy, before);
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.finalizedCardPlaysThisTurn().length, 0);
});
