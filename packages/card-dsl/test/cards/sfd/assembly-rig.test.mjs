import assert from "node:assert/strict";
import test from "node:test";
import {
  EFFECT_IR_V2_RULESET,
  validateCardProgram
} from "../../../dist/index.js";
import tokenDefinition from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import program from "../../../dist/cards/sfd/assembly-rig.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { productionPlay } from "../../fixtures/production-play.mjs";

const CARD_ID = "card.hash-d490b51d08bdd7f97b1708aabfa6309995106f10de815b6fd927368e4a630569";
const SOURCE_TEXT =
  ":rb_energy_1::rb_rune_fury:, Recycle a unit from your trash, :rb_exhaust:: " +
  "Play a 3 :rb_might: Mech unit token to your base.";
const CORE_RULES_URL =
  "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf";
const RADIANCE_URL =
  "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/";
const RADIANCE_RULE_303_URL = `${RADIANCE_URL}#:~:text=303.2.a`;
const SFD_ERRATA_URL =
  "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/";
const SFD_PATCH_URL =
  "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-core-rules-spiritforged-patch-notes/";

const LINK_PREFIX = "create-mech-token.token.";

const PRODUCTION_TEST_NAMES = Object.freeze({
  golden: "sfd-019-221 Assembly Rig production golden: costs settle and the Mech enters exhausted through token Play",
  integrationGolden: "sfd-019-221 Assembly Rig integration production golden: Finalize pays Energy, Fury Power, recycle and Exhaust, then Resolve creates one exhausted Mech",
  chainTiming: "sfd-019-221 Assembly Rig production timing: the child token Play stays Pending until the parent Resolve ends, then Finalizes and Resolves",
  universalPower: "sfd-019-221 Assembly Rig production boundary: Universal Power pays the Fury requirement and recycle keeps existing deck order",
  missingTrash: "sfd-019-221 Assembly Rig production counterexample: no Trash Unit means no activation or partial payment",
  trashChoice: "sfd-019-221 Assembly Rig production boundary: the printed cost recycles exactly the chosen Trash Unit",
  missingEnergy: "sfd-019-221 Assembly Rig production counterexample: insufficient Energy rolls Finalize back",
  missingPower: "sfd-019-221 Assembly Rig production counterexample: insufficient Fury Power rolls Finalize back",
  exhaustedSource: "sfd-019-221 Assembly Rig production counterexample: an exhausted Rig cannot pay its Exhaust cost"
});

// Official evidence is pinned to the reviewed target CR and snapshots in the
// repository policy. The effective Radiance rulings and Spiritforged errata
// name neither this printing nor its canonical id and make no Mech-token rule
// change. This card therefore follows CR v1.5; it adds no numbered priority.
// The Radiance snapshot's 303.2.a reminder concerns simultaneous items; this
// activation creates one child Play during its Resolve, so that rule does not
// supply the ordering. CR 354.3 defers the child until the parent finishes and
// CR 337.1.b then Finalizes the oldest actual Pending item. The Spiritforged
// patch's Repeat and copy clarifications do not alter this path.
const OFFICIAL_EFFECT_ORDER_EVIDENCE = Object.freeze({
  contract: "riftbound.official-effect-order-evidence.v1",
  policyId: "official-effect-order-20261019",
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
      ruleUrl: RADIANCE_RULE_303_URL,
      applicableToThisCard: false,
      result: "reviewed: no Assembly Rig, SFD-019, 187.4 or token Play change"
    }),
    spiritforgedErrata: Object.freeze({
      published: "2026-01-14",
      effective: null,
      url: SFD_ERRATA_URL,
      applicableToThisCard: false,
      result: "reviewed: no Assembly Rig or SFD-019 correction"
    }),
    spiritforgedRulings: Object.freeze({
      published: "2025-12-05",
      effective: "2025-12-12",
      url: SFD_PATCH_URL,
      applicableToThisCard: false,
      result: "reviewed: no Assembly Rig, SFD-019 or token cost-rule change"
    })
  }),
  interactions: Object.freeze([
    Object.freeze({
      id: "activation-finalize",
      canonicalCardId: CARD_ID,
      sourceIds: Object.freeze(["coreRules", "radianceRulings", "spiritforgedErrata", "spiritforgedRulings"]),
      clauses: Object.freeze([
        ":rb_energy_1::rb_rune_fury:",
        "Recycle a unit from your trash",
        ":rb_exhaust:"
      ]),
      ruleRefs: Object.freeze([
        "151.2", "151.2.a", "151.2.a.1", "312", "312.2.a", "337.1", "337.1.a", "337.4", "338.1", "338.1.b",
        "131.2", "131.3", "135.2.e.5", "135.2.e.5.b", "163.2.b",
        "339.1", "355.5", "357.1",
        "357.2", "415.4", "415.5", "417.1", "417.3", "417.5"
      ]),
      timeline: Object.freeze([
        "Activation/Pending: the action-speed Gear ability enters the Chain with its source and controller; Finalize pays without passing Priority.",
        "Finalize target/choice: the controller chooses the exact Unit incarnation in Trash; it is a cost choice, not an effect target.",
        "Finalize payment: one Energy, one Fury Power, recycle that Unit to the bottom of its owner's Main Deck, then exhaust the ready controlled Rig.",
        "Execute: the turn player and opponent pass Priority in sequence while the finalized ability may receive a legally timed Reaction.",
        "Resolve: the independent body executes only after both passes; no replacement or layer effect changes this turn timeline."
      ]),
      priorityFocus: "Priority belongs to the ordinary Main Phase turn player. CR 337.1.a says Finalize does not pass it; CR 338.1.b and 339.1 grant the Execute/pass window before Resolve.",
      responseWindow: "The Gear activation is limited to its controller's Main Phase in an Open State and never a Showdown under CR 151.2. While the finalized ability is on the Chain, CR 338.1.a.2 permits legally timed Reaction plays. No numeric priority is assigned.",
      optionalAdditionalCost: "None. The printed Energy, Fury Power, recycle and Exhaust are all mandatory; no additional-cost choice is authored.",
      replacement: "No replacement or prevention clause applies. The complete cost must be payable at Finalize under CR 357 and 415.4/417.3.",
      layers: "No continuous effect changes the Energy, Power, recycle choice, Exhaust payment or Mech characteristics.",
      lki: "The recycle choice reads the exact selected Trash incarnation and replaces it with a new deck incarnation. The later token body consumes no departed-object LKI.",
      simultaneousTriggers: "This activation supplies one Pending item and no simultaneous trigger. Its Resolve starts the separate token Play described below.",
      orderingBasis: "This is one parent item, then one child Play created during its Resolve. CR 337.1.b orders actual Pending items and CR 354.3 pauses the child; CR 303.2.a is not invoked as a blanket FIFO/LIFO rule.",
      productionTestNames: Object.freeze([
        PRODUCTION_TEST_NAMES.golden,
        PRODUCTION_TEST_NAMES.integrationGolden,
        PRODUCTION_TEST_NAMES.chainTiming,
        PRODUCTION_TEST_NAMES.universalPower,
        PRODUCTION_TEST_NAMES.missingTrash,
        PRODUCTION_TEST_NAMES.trashChoice,
        PRODUCTION_TEST_NAMES.missingEnergy,
        PRODUCTION_TEST_NAMES.missingPower,
        PRODUCTION_TEST_NAMES.exhaustedSource
      ])
    }),
    Object.freeze({
      id: "play-mech-token",
      canonicalCardId: CARD_ID,
      sourceIds: Object.freeze(["coreRules", "radianceRulings", "spiritforgedErrata", "spiritforgedRulings"]),
      clauses: Object.freeze(["Play a 3 :rb_might: Mech unit token to your base."]),
      ruleRefs: Object.freeze([
        "107.1.a", "107.1.b", "107.1.c", "108.1", "108.1.a", "143.4",
        "185.2.a", "185.2.d", "185.3.a", "185.3.a.1", "187.4", "337.2",
        "329", "329.1", "329.2", "329.3", "350.2", "352.1", "352.2", "354", "355.2", "359.2.c",
        "420.3", "420.3.a", "420.3.b", "440.2.c"
      ]),
      timeline: Object.freeze([
        "The activation Resolve calls effect.token in mode play; the fixed CR 187.4 Mech is created on the Chain.",
        "Required: the created token becomes a new Pending Play item and its own Finalize applies the rule-level zero cost of CR 185.3.a.1.",
        "The child remains Pending while the creating activation completes Resolve, then Finalizes after the parent under CR 354.3 and 337.1.b.",
        "The Unit resolves immediately after its own Finalize under CR 337.2 and enters the controller's Base exhausted; no Priority pass occurs between the child Finalize and Resolve."
      ]),
      priorityFocus: "CR 337.2 resolves the Unit immediately after its own Play Finalize. The parent activation has already completed its CR 338-339 Priority sequence; the child Finalize does not grant another pass.",
      responseWindow: "The activated ability itself has the ordinary Finalize/Priority response window. The child Play remains Pending during the parent Resolve under CR 354.3 and then follows the same FEPR process; the test checks its actual Pending/Finalize events.",
      optionalAdditionalCost: "None. A token's rules-level Play cost is zero (CR 185.3.a.1); there is no optional additional cost to choose or pay.",
      replacement: "No replacement or prevention is authored. The ordinary exhausted Unit entry is a rule result, not a post-entry Exhaust effect.",
      layers: "Mech has fixed Might 3 and tag Mech under CR 187.4; no layer modifies its characteristics here.",
      lki: "The played token is a new object with no prior zone incarnation. Its null printed costs remain null; only the rule-level Play cost is zero.",
      simultaneousTriggers: "The card has no trigger. The Mech is one token Play started by the resolving instruction, with no array-order priority rule.",
      orderingBasis: "The parent finishes Resolve before the already-created child leaves Pending under CR 354.3. CR 337.1.b then finalizes the oldest Pending item, and CR 337.2 immediately resolves the Unit. CR 303.2.a does not govern this parent/child procedure because no actions or triggers are simultaneous.",
      productionTestNames: Object.freeze([
        PRODUCTION_TEST_NAMES.golden,
        PRODUCTION_TEST_NAMES.integrationGolden,
        PRODUCTION_TEST_NAMES.chainTiming
      ])
    })
  ])
});

// Integration audit cross-check retained alongside the structured evidence:
// - Core Rules v1.5 (last updated 2026-10-09, effective 2026-10-16):
//   https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - Radiance patch notes, effective 2026-10-16:
//   https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
// canonicalCardId: card.hash-d490b51d08bdd7f97b1708aabfa6309995106f10de815b6fd927368e4a630569.
// The activated ability is Pending. Its printed cost combines 151.2/357.1 resources, the 417.3 recycle
// cost, and the 415.4 source Exhaust. Finalize locks the trash Unit, computes
// and pays the total, then the permanent is a Finalized Chain Item; 337.1.a
// does not pass Priority, 337.4/338.1 grants the response window, and 359.3.d
// resolves the body only after both passes. The printed body requires the
// 187.4 Mech token to be played, which creates it on the Chain under 440.2.c
// before normal Play and eventual exhausted entry under 143.4/185.2.d. This
// production test now asserts the complete parent/child timing and the shipped
// executable program itself is the bound source.
// The activation creates no Focus outside a Showdown, and its recycle cost reads
// the exact selected trash incarnation. The resolved token is a new object;
// the body consumes no departed-object LKI.

test("Assembly Rig card program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(Object.hasOwn(program, "judgeReason"), false);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("Assembly Rig official CR, Radiance, SFD errata and production timelines are pinned", () => {
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.contract, "riftbound.official-effect-order-evidence.v1");
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.policyId, "official-effect-order-20261019");
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.canonicalCardId, CARD_ID);
  assert.deepEqual(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.coreRules, {
    version: "1.5",
    dated: "2026-10-09",
    effective: "2026-10-16",
    url: CORE_RULES_URL,
    localSha256: "bbc81327eb21242452db3c56348b0725b1e0b6186c1a682dde541f3c7a864ba2"
  });
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.radianceRulings.effective, "2026-10-16");
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.radianceRulings.url, RADIANCE_URL);
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.radianceRulings.ruleUrl, RADIANCE_RULE_303_URL);
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.radianceRulings.applicableToThisCard, false);
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.spiritforgedErrata.applicableToThisCard, false);
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.spiritforgedRulings.published, "2025-12-05");
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.spiritforgedRulings.effective, "2025-12-12");
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.spiritforgedRulings.applicableToThisCard, false);
  assert.match(
    OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.radianceRulings.result,
    /no Assembly Rig.*token Play change/
  );
  assert.match(
    OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.spiritforgedErrata.result,
    /no Assembly Rig/
  );
  assert.deepEqual(OFFICIAL_EFFECT_ORDER_EVIDENCE.interactions.map(interaction => interaction.id), [
    "activation-finalize", "play-mech-token"
  ]);
  const productionNames = new Set(Object.values(PRODUCTION_TEST_NAMES));
  for (const interaction of OFFICIAL_EFFECT_ORDER_EVIDENCE.interactions) {
    assert.equal(interaction.canonicalCardId, CARD_ID);
    assert.deepEqual(interaction.sourceIds, [
      "coreRules", "radianceRulings", "spiritforgedErrata", "spiritforgedRulings"
    ]);
    assert.ok(interaction.clauses.length > 0);
    assert.ok(interaction.ruleRefs.length > 0);
    assert.ok(interaction.timeline.length >= 3);
    assert.match(interaction.priorityFocus, /Priority/);
    assert.match(interaction.responseWindow, /Reaction|Resolve|response/i);
    assert.match(interaction.optionalAdditionalCost, /None/);
    assert.match(interaction.replacement, /No replacement|not a post-entry/i);
    assert.match(interaction.layers, /No continuous|no layer/i);
    assert.match(interaction.orderingBasis, /303\.2\.a|simultaneous/);
    assert.ok(interaction.productionTestNames.every(name => productionNames.has(name)));
  }
  assert.deepEqual(OFFICIAL_EFFECT_ORDER_EVIDENCE.interactions[1].ruleRefs.filter(rule => [
    "143.4", "185.2.a", "185.2.d", "185.3.a", "187.4", "337.2", "350.2",
    "352.1", "352.2", "354", "355.2", "359.2.c", "440.2.c"
  ].includes(rule)), [
    "143.4", "185.2.a", "185.2.d", "185.3.a", "187.4", "337.2", "350.2",
    "352.1", "352.2", "354", "355.2", "359.2.c", "440.2.c"
  ]);
  assert.deepEqual(OFFICIAL_EFFECT_ORDER_EVIDENCE.interactions[1].ruleRefs.filter(rule => [
    "420.3", "420.3.a", "420.3.b"
  ].includes(rule)), [
    "420.3", "420.3.a", "420.3.b"
  ]);
  assert.deepEqual(OFFICIAL_EFFECT_ORDER_EVIDENCE.interactions[1].ruleRefs.filter(rule => [
    "329", "329.1", "329.2", "329.3"
  ].includes(rule)), ["329", "329.1", "329.2", "329.3"]);
});

test("Assembly Rig production registry binds the shipped executable program and exposes its real activation", () => {
  const binding = createProgramBinding({ cardPrograms: [program] });
  const kernel = world()
    .object("rig", {
      owner: "A",
      controller: "A",
      cardId: CARD_ID,
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .build();
  const draft = binding.describeActivate(kernel.getObject("rig"), "A", 0);
  assert.equal(draft.speed, "action");
  assert.deepEqual(draft.body.map(instruction => instruction.op), ["effect.token"]);
});

test("Assembly Rig has one action-speed activated ability with the printed three-part cost", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost.energy, { kind: "constant", value: 1 });
  assert.deepEqual(ability.cost.power, { kind: "constant", value: ["Fury"] });
  const payments = ability.cost.payments;
  assert.equal(payments.length, 2);
  const [recyclePayment, exhaustPayment] = payments;
  assert.equal(recyclePayment.kind, "recycle");
  assert.equal(exhaustPayment.kind, "exhaust");
  assert.deepEqual(recyclePayment.choice, {
    id: "recycled-unit",
    options: ["unit-in-controller-trash"],
    min: 1,
    max: 1,
    selection: "one",
    zone: "trash",
    type: "unit",
    owner: "controller"
  });
});

test("Assembly Rig body is one effect.token instruction playing a Mech at the controller base", () => {
  const [ability] = program.abilities;
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "create-mech-token");
  assert.equal(instruction.op, "effect.token");
  assert.equal(instruction.args.token.value, "mech");
  assert.equal(instruction.args.amount.value, 1);
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(instruction.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  assert.equal(instruction.args.locations, undefined);
  assert.equal(instruction.args.choiceId, undefined);
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
  assert.equal(instruction.condition, undefined);
});

test("Assembly Rig body executes through the reference kernel: create-on-Chain then Play enters the 3 Might Mech exhausted", () => {
  const kernel = world()
    .hand("assembly-rig", { name: "Assembly Rig", types: ["gear"], tags: ["Equipment"], energy: null, power: null })
    .build();
  const scoped = kernel.clone({
    sourceSnapshot: kernel.getObject("assembly-rig"),
    controller: "A"
  });
  const base = { type: "base", player: "A" };
  const [instruction] = program.abilities[0].body;
  // The reference kernel evaluates Expr args itself; substitute the printed
  // controller-base placeholder with the concrete player base.
  const args = {
    ...instruction.args,
    location: { kind: "constant", value: base }
  };
  const run = runInstruction(tokenDefinition, args, { world: scoped });
  assert.equal(run.result.status, "executed");
  const created = scoped.query({ zone: "board", type: "unit" }).filter(object => object.isToken);
  assert.equal(created.length, 1);
  const [tokenRef] = run.linked["token.objects"];
  assert.deepEqual(tokenRef, created[0].ref);
  assert.equal(created[0].name, "Mech");
  assert.equal(created[0].might, 3);
  assert.deepEqual(created[0].tags, ["Mech"]);
  assert.deepEqual(created[0].location, base);
  assert.equal(created[0].owner, "A");
  assert.equal(created[0].energy, null);
  assert.equal(created[0].power, null);
  assert.equal(created[0].exhausted, true);
  assert.deepEqual(run.events.map(event => event.action), ["create-token", "play"]);
  assert.equal(run.linked["token.createdAmount"], 1);
});

function assemblyRigScene({
  energy = 1,
  power = ["Fury"],
  trash = true,
  exhausted = false,
  deck = []
} = {}) {
  return productionPlay({
    programs: [program],
    answers: { "recycled-unit": ["fodder"] },
    build: builder => builder
      .player("A", { energy, power })
      .player("B")
      .deck(deck, { owner: "A" })
      .object("rig", {
        owner: "A",
        controller: "A",
        cardId: CARD_ID,
        name: "Assembly Rig",
        types: ["gear"],
        zone: "board",
        location: { type: "base", player: "A" },
        energy: 4,
        power: null,
        might: null,
        exhausted
      })
      .card("fodder", {
        owner: "A",
        types: ["unit"],
        tags: ["Mech"],
        zone: trash ? "trash" : "deck",
        energy: 2,
        power: null,
        might: 2
      })
  });
}

function activate(f) {
  const draft = f.binding.describeActivate(f.kernel.getObject("rig"), "A", 0);
  f.engine.execute(draft);
  return draft;
}

test(PRODUCTION_TEST_NAMES.golden, () => {
  const f = assemblyRigScene();
  const draft = activate(f);
  const [item] = f.engine.items;
  assert.equal(draft.speed, "action");
  assert.equal(item.status, "finalized");
  assert.equal(f.engine.priority, "A");
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  const recycled = f.kernel.getObject("fodder");
  assert.equal(recycled.zone, "deck");
  assert.equal(recycled.location, null);
  assert.equal(f.kernel.getObject("rig").exhausted, true);
  assert.deepEqual(f.kernel.events.slice(-3).map(event => event.action), ["pay", "recycle", "exhaust"]);
  assert.equal(f.kernel.objects.filter(object => object.isToken).length, 0,
    "all costs are paid during Finalize before the activated body resolves");

  f.engine.pass("A");
  assert.equal(f.engine.priority, "B");
  assert.equal(f.kernel.objects.filter(object => object.isToken).length, 0);
  f.engine.pass("B");
  assert.deepEqual(f.engine.items, []);

  const tokens = f.kernel.objects.filter(object => object.isToken);
  assert.equal(tokens.length, 1);
  const [mech] = tokens;
  assert.equal(mech.name, "Mech");
  assert.equal(mech.might, 3);
  assert.deepEqual(mech.tags, ["Mech"]);
  assert.equal(mech.controller, "A");
  assert.deepEqual(mech.location, { type: "base", player: "A" });
  assert.equal(mech.exhausted, true, "CR 143.4: the played Unit enters exhausted");
  assert.equal(mech.energy, null, "CR 185.3.a: absence is preserved rather than rewritten to zero");
  assert.equal(mech.power, null, "CR 185.3.a: absence is preserved rather than rewritten to zero");

  const timeline = f.engine.pipeline.events;
  const activationPendingAt = timeline.findIndex(event =>
    event.timingPoint === "chain-item-pending" && event.details?.item === draft.id);
  const activationFinalizeAt = timeline.findIndex((event, index) => index > activationPendingAt &&
    event.timingPoint === "chain-item-finalize" && event.details?.item === draft.id);
  const tokenEntersChainAt = timeline.findIndex((event, index) => index > activationFinalizeAt &&
    event.timingPoint === "object-enters-chain" && event.object?.ref.id === mech.ref.id);
  const tokenItemId = f.engine.trace.find(entry => entry.item?.startsWith(`play:${mech.ref.id}:`))?.item;
  assert.ok(tokenItemId, "the played token receives its own deterministic Play item");
  const tokenPendingAt = timeline.findIndex((event, index) => index > tokenEntersChainAt &&
    event.timingPoint === "chain-item-pending" && event.details?.item === tokenItemId);
  const activationResolveAt = timeline.findIndex((event, index) => index > tokenPendingAt &&
    event.timingPoint === "chain-item-resolve" && event.details?.item === draft.id);
  const tokenFinalizeAt = timeline.findIndex((event, index) => index > activationResolveAt &&
    event.timingPoint === "chain-item-finalize" && event.details?.item === tokenItemId);
  const tokenEntersAt = timeline.findIndex((event, index) => index > tokenFinalizeAt &&
    event.timingPoint === "object-enters-board" && event.object?.ref.id === mech.ref.id);
  // The event adapter emits the Resolve start after entering the permanent as
  // part of the same Resolve transaction. Trace order remains pending ->
  // Finalize -> Resolve; this event is not a boundary after Board entry.
  const tokenResolveAt = timeline.findIndex((event, index) => index > tokenEntersAt &&
    event.timingPoint === "chain-item-resolve" && event.details?.item === tokenItemId);
  assert.ok(activationPendingAt >= 0 && activationPendingAt < activationFinalizeAt);
  assert.ok(activationFinalizeAt < tokenEntersChainAt && tokenEntersChainAt < tokenPendingAt &&
    tokenPendingAt < activationResolveAt,
  "CR 354.2-354.3: the child Play becomes Pending during the parent Resolve and waits for that Resolve");
  assert.ok(activationResolveAt < tokenFinalizeAt && tokenFinalizeAt < tokenEntersAt &&
    tokenEntersAt < tokenResolveAt,
  "CR 337.1.b-337.2: the child Finalizes after the parent Resolve, then its Unit Resolve enters the Board");
  assert.equal(timeline.filter(event => event.timingPoint === "card-played" &&
    event.object?.ref.id === mech.ref.id).length, 1,
  "the child is observable as a completed Play, not a bare zone jump");
  assert.equal(timeline.filter(event => event.timingPoint === "chain-item-pending" &&
    event.details?.item === tokenItemId).length, 1);
  assert.equal(timeline.filter(event => event.timingPoint === "object-enters-board" &&
    event.object?.ref.id === mech.ref.id).length, 1);
  assert.equal(f.kernel.linked(`${LINK_PREFIX}createdAmount`), 1);
  assert.equal(f.kernel.linked(`${LINK_PREFIX}amount`), 1);
  assert.equal(f.kernel.linked(`${LINK_PREFIX}blockedReason`), undefined);
  assert.deepEqual(f.engine.trace.filter(entry => entry.item === draft.id &&
    ["pending", "finalized", "resolved"].includes(entry.step)).map(entry => entry.step),
  ["pending", "finalized", "resolved"]);
  assert.deepEqual(f.engine.trace.filter(entry => entry.item === tokenItemId)
    .map(entry => entry.step),
  ["pending", "finalize-start", "finalized", "resolve-start", "resolved", "removed"],
  "the token Play receives its own Pending, Finalize and Resolve trace");
  const traceFinalizeAt = f.engine.trace.findIndex(entry => entry.item === tokenItemId && entry.step === "finalized");
  const traceResolveAt = f.engine.trace.findIndex(entry => entry.item === tokenItemId && entry.step === "resolve-start");
  assert.ok(traceFinalizeAt >= 0 && traceFinalizeAt < traceResolveAt);
  assert.equal(f.engine.trace.slice(traceFinalizeAt, traceResolveAt)
    .some(entry => entry.step === "pass"), false,
  "CR 337.2 has no Priority pass between the Unit token's Finalize and Resolve");
});

test(PRODUCTION_TEST_NAMES.integrationGolden, () => {
  const f = assemblyRigScene();
  const draft = activate(f);
  const [item] = f.engine.items;
  assert.equal(draft.speed, "action");
  assert.equal(item.status, "finalized");
  assert.equal(f.engine.priority, "A");
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  const recycled = f.kernel.getObject("fodder");
  assert.equal(recycled.zone, "deck");
  assert.equal(recycled.location, null);
  assert.equal(f.kernel.getObject("rig").exhausted, true);
  assert.deepEqual(f.kernel.events.slice(-3).map(event => event.action), ["pay", "recycle", "exhaust"]);
  assert.deepEqual(f.kernel.events.map(event => event.action), ["pay", "recycle", "exhaust"]);
  assert.equal(f.kernel.objects.filter(object => object.isToken).length, 0,
    "all costs are paid during Finalize before the activated body resolves");

  f.engine.pass("A");
  assert.equal(f.engine.priority, "B");
  assert.equal(f.kernel.objects.filter(object => object.isToken).length, 0);
  f.engine.pass("B");
  assert.deepEqual(f.engine.items, []);

  const tokens = f.kernel.objects.filter(object => object.isToken);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].name, "Mech");
  assert.equal(tokens[0].might, 3);
  assert.deepEqual(tokens[0].tags, ["Mech"]);
  assert.equal(tokens[0].controller, "A");
  assert.deepEqual(tokens[0].location, { type: "base", player: "A" });
  assert.equal(tokens[0].exhausted, true);
  assert.equal(tokens[0].energy, null);
  assert.equal(tokens[0].power, null);
  assert.equal(f.engine.trace.filter(entry => entry.item === item.id &&
    ["pending", "finalized", "resolved"].includes(entry.step)).map(entry => entry.step).join(","),
  "pending,finalized,resolved");
});

test(PRODUCTION_TEST_NAMES.chainTiming, () => {
  const f = assemblyRigScene();
  const draft = activate(f);
  f.engine.pass("A");
  assert.equal(f.kernel.objects.filter(object => object.isToken).length, 0,
    "the child Play remains Pending and off-Board during Priority");
  f.engine.pass("B");
  const [mech] = f.kernel.objects.filter(object => object.isToken);
  assert.ok(mech);
  const tokenItem = f.engine.trace.find(entry => entry.item?.startsWith(`play:${mech.ref.id}:`))?.item;
  assert.ok(tokenItem);
  const steps = f.engine.trace.filter(entry => entry.item === tokenItem).map(entry => entry.step);
  assert.deepEqual(steps, ["pending", "finalize-start", "finalized", "resolve-start", "resolved", "removed"]);
  const events = f.engine.pipeline.events.filter(event =>
    ["chain-item-pending", "chain-item-finalize", "chain-item-resolve",
      "object-enters-chain", "object-enters-board", "card-played"].includes(event.timingPoint) &&
    (event.details?.item === draft.id || event.details?.item === tokenItem || event.object?.ref.id === mech.ref.id));
  assert.deepEqual(events.map(event =>
    `${event.timingPoint}:${event.details?.item ?? event.object?.ref.id}`), [
    `chain-item-pending:${draft.id}`,
    `chain-item-finalize:${draft.id}`,
    `object-enters-chain:${mech.ref.id}`,
    `chain-item-pending:${tokenItem}`,
    `chain-item-resolve:${draft.id}`,
    `chain-item-finalize:${tokenItem}`,
    `object-enters-board:${mech.ref.id}`,
    `card-played:${mech.ref.id}`,
    `chain-item-resolve:${tokenItem}`
  ]);
});

test(PRODUCTION_TEST_NAMES.universalPower, () => {
  const f = assemblyRigScene({ power: ["universal"], deck: ["top", "middle"] });
  const actions = [];
  const perform = f.kernel.perform.bind(f.kernel);
  f.kernel.perform = action => {
    actions.push(structuredClone(action));
    return perform(action);
  };
  activate(f);
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  const payment = actions.find(action => action.type === "pay");
  assert.deepEqual(payment.plan, {
    finalized: true,
    energy: 1,
    power: [],
    universalPower: 1,
    powerSources: [{ source: "any", amount: 1 }]
  });
  assert.deepEqual(f.kernel.zone("A", "deck").map(ref => ref.id), ["top", "middle", "fodder"],
    "CR 417.1/417.5 place the recycled card at the existing Main Deck bottom");
  f.engine.pass("A");
  f.engine.pass("B");
  const [mech] = f.kernel.objects.filter(object => object.isToken);
  assert.equal(mech.exhausted, true);
});

function assertUnchangedActivationFailure(f, pattern) {
  const before = f.kernel.snapshot();
  const beforeEvents = structuredClone(f.kernel.events);
  const draft = f.binding.describeActivate(f.kernel.getObject("rig"), "A", 0);
  assert.throws(() => f.engine.execute(draft), pattern);
  assert.deepEqual(f.kernel.snapshot(), before);
  assert.deepEqual(f.kernel.events, beforeEvents);
  assert.deepEqual(f.engine.items, []);
  assert.equal(f.kernel.objects.filter(object => object.isToken).length, 0);
}

test(PRODUCTION_TEST_NAMES.missingTrash, () => {
  const f = assemblyRigScene({ trash: false });
  assertUnchangedActivationFailure(f, error =>
    error.name === "CostPlanError" && error.reason === "invalid-cost-plan" &&
    /Cost choice cannot be completed/.test(error.message));
});

test(PRODUCTION_TEST_NAMES.trashChoice, () => {
  const f = productionPlay({
    programs: [program],
    answers: { "cost:activate:rig": ["chosen-fodder"] },
    build: builder => {
      builder = builder
        .player("A", { energy: 1, power: ["Fury"] })
        .player("B")
        .deck(["top"], { owner: "A" })
        .object("rig", {
          owner: "A",
          controller: "A",
          cardId: CARD_ID,
          name: "Assembly Rig",
          types: ["gear"],
          zone: "board",
          location: { type: "base", player: "A" },
          energy: 4,
          power: null,
          might: null,
          exhausted: false
        });
      for (const id of ["left-fodder", "chosen-fodder"]) {
        builder = builder.card(id, {
          owner: "A",
          types: ["unit"],
          tags: ["Mech"],
          zone: "trash",
          energy: 2,
          power: null,
          might: 2
        });
      }
      return builder;
    }
  });
  activate(f);
  assert.equal(f.requests.some(request => request.id.endsWith("pick:recycled-unit")), true);
  assert.equal(f.kernel.getObject("chosen-fodder").zone, "deck");
  assert.equal(f.kernel.getObject("left-fodder").zone, "trash");
  assert.deepEqual(f.kernel.zone("A", "deck").map(ref => ref.id),
    ["top", "chosen-fodder"]);
  f.engine.pass("A");
  f.engine.pass("B");
  const [mech] = f.kernel.objects.filter(object => object.isToken);
  assert.equal(mech.location.player, "A");
  assert.equal(mech.exhausted, true);
});

test(PRODUCTION_TEST_NAMES.missingEnergy, () => {
  const f = assemblyRigScene({ energy: 0 });
  assertUnchangedActivationFailure(f, error =>
    error.name === "CostPlanError" && error.reason === "cannot-pay-cost" &&
    /insufficient Energy/.test(error.message));
});

test(PRODUCTION_TEST_NAMES.missingPower, () => {
  const f = assemblyRigScene({ power: [] });
  assertUnchangedActivationFailure(f, error =>
    error.name === "CostPlanError" && error.reason === "cannot-pay-cost" &&
    /insufficient matching Power/.test(error.message));
});

test(PRODUCTION_TEST_NAMES.exhaustedSource, () => {
  const f = assemblyRigScene({ exhausted: true });
  assertUnchangedActivationFailure(f, error =>
    error.name === "CostPlanError" && error.reason === "cannot-pay-cost" &&
    /requires a ready controlled object/.test(error.message));
});
