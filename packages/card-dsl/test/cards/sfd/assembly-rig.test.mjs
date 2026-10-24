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
const SFD_ERRATA_URL =
  "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/";

// The shipped program is withheld at the binding gate until the token Play is
// represented by a real Chain item. A same-identity, same-IR carrier below
// exercises the supported cost and final-state halves through production.
// Assertions on the gap itself use the carrier, never relabel the shipped card
// as executable.
const executableCarrier = Object.freeze({
  ...program,
  status: "executable",
  judgeReason: undefined
});
const LINK_PREFIX = "create-mech-token.token.";

const PRODUCTION_TEST_NAMES = Object.freeze({
  golden: "sfd-019-221 Assembly Rig production golden: costs settle and the Mech enters exhausted through token Play",
  gap: "sfd-019-221 Assembly Rig production gap: token Play is synchronous and publishes no independent Pending or Finalize item",
  universalPower: "sfd-019-221 Assembly Rig production boundary: Universal Power pays the Fury requirement and recycle keeps existing deck order",
  missingTrash: "sfd-019-221 Assembly Rig production counterexample: no Trash Unit means no activation or partial payment",
  missingEnergy: "sfd-019-221 Assembly Rig production counterexample: insufficient Energy rolls Finalize back",
  missingPower: "sfd-019-221 Assembly Rig production counterexample: insufficient Fury Power rolls Finalize back",
  exhaustedSource: "sfd-019-221 Assembly Rig production counterexample: an exhausted Rig cannot pay its Exhaust cost"
});

// Official evidence is pinned to the reviewed target CR and snapshots in the
// repository policy. The effective Radiance rulings and Spiritforged errata
// name neither this printing nor its canonical id and make no Mech-token rule
// change. This card therefore follows CR v1.5; it adds no numbered priority.
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
      applicableToThisCard: false,
      result: "reviewed: no Assembly Rig, SFD-019, 187.4 or token Play change"
    }),
    spiritforgedErrata: Object.freeze({
      published: "2026-01-14",
      effective: null,
      url: SFD_ERRATA_URL,
      applicableToThisCard: false,
      result: "reviewed: no Assembly Rig or SFD-019 correction"
    })
  }),
  interactions: Object.freeze([
    Object.freeze({
      id: "activation-finalize",
      canonicalCardId: CARD_ID,
      sourceIds: Object.freeze(["coreRules", "radianceRulings", "spiritforgedErrata"]),
      clauses: Object.freeze([
        ":rb_energy_1::rb_rune_fury:",
        "Recycle a unit from your trash",
        ":rb_exhaust:"
      ]),
      ruleRefs: Object.freeze([
        "151.2", "151.2.a", "151.2.a.1", "337.1", "337.1.a", "337.4", "338.1", "338.1.b",
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
      priorityFocus: "Priority belongs to the ordinary Main Phase turn player. CR 337.1.a says Finalize does not pass it; the finalized item grants the Execute window before Resolve.",
      responseWindow: "The Gear activation is limited to its controller's Main Phase in an Open State and never a Showdown under CR 151.2. While the finalized ability is on the Chain, CR 338.1.a.2 permits legally timed Reaction plays. No numeric priority is assigned.",
      replacement: "No replacement or prevention clause applies. The complete cost must be payable at Finalize under CR 357 and 415.4/417.3.",
      layers: "No continuous effect changes the Energy, Power, recycle choice, Exhaust payment or Mech characteristics.",
      lki: "The recycle choice reads the exact selected Trash incarnation and replaces it with a new deck incarnation. The later token body consumes no departed-object LKI.",
      simultaneousTriggers: "This activation supplies one Pending item and no simultaneous trigger. Its Resolve starts the separate token Play described below.",
      productionTestNames: Object.freeze([
        PRODUCTION_TEST_NAMES.golden,
        PRODUCTION_TEST_NAMES.gap,
        PRODUCTION_TEST_NAMES.universalPower,
        PRODUCTION_TEST_NAMES.missingTrash,
        PRODUCTION_TEST_NAMES.missingEnergy,
        PRODUCTION_TEST_NAMES.missingPower,
        PRODUCTION_TEST_NAMES.exhaustedSource
      ])
    }),
    Object.freeze({
      id: "play-mech-token",
      canonicalCardId: CARD_ID,
      sourceIds: Object.freeze(["coreRules", "radianceRulings", "spiritforgedErrata"]),
      clauses: Object.freeze(["Play a 3 :rb_might: Mech unit token to your base."]),
      ruleRefs: Object.freeze([
        "143.4", "185.2.a", "185.2.d", "185.3.a", "187.4", "337.2",
        "350.2", "352.1", "352.2", "354", "355.2", "359.2.c", "440.2.c"
      ]),
      timeline: Object.freeze([
        "The activation Resolve calls effect.token in mode play; the fixed CR 187.4 Mech is created on the Chain.",
        "Required: the created token becomes a new Pending Play item and its own Finalize applies the rule-level zero cost of CR 185.3.a.1.",
        "Current production gap: Play is committed synchronously during the parent Resolve, so the token travels Chain to Board without a Pending or Finalize item.",
        "The Mech nevertheless enters the controller's Base exhausted; the final state is correct while the required chain boundary remains judge-required."
      ]),
      priorityFocus: "Required: CR 337.2 resolves the Unit immediately after its own Play Finalize. Current code has no token Finalize item or Priority boundary; the parent Resolve therefore owns the entry in this build.",
      responseWindow: "The activated ability itself has the ordinary Finalize/Priority response window. The production gap test requires a distinct token Pending event that the current synchronous host does not publish.",
      replacement: "No replacement or prevention is authored. The ordinary exhausted Unit entry is a rule result, not a post-entry Exhaust effect.",
      layers: "Mech has fixed Might 3 and tag Mech under CR 187.4; no layer modifies its characteristics here.",
      lki: "The played token is a new object with no prior zone incarnation. Its null printed costs remain null; only the rule-level Play cost is zero.",
      simultaneousTriggers: "The card has no trigger. The Mech is one token Play started by the resolving instruction, with no array-order priority rule.",
      productionTestNames: Object.freeze([PRODUCTION_TEST_NAMES.golden, PRODUCTION_TEST_NAMES.gap])
    })
  ])
});

test("Assembly Rig card program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /effect\.token\.ts:380-408/);
  assert.match(program.judgeReason, /chain\/engine\.ts:955-958/);
  assert.match(program.judgeReason, /action-adapter\.ts:373-381/);
  assert.match(program.judgeReason, /pipeline\.ts:608-629/);
  assert.match(program.judgeReason, /bridge\.ts:283-289/);
  assert.match(program.judgeReason, /chain-item-pending/);
  assert.match(program.judgeReason, /350\.2/);
  assert.match(program.judgeReason, /440\.2\.c/);
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
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.radianceRulings.applicableToThisCard, false);
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.spiritforgedErrata.applicableToThisCard, false);
  assert.deepEqual(OFFICIAL_EFFECT_ORDER_EVIDENCE.interactions.map(interaction => interaction.id), [
    "activation-finalize", "play-mech-token"
  ]);
  const productionNames = new Set(Object.values(PRODUCTION_TEST_NAMES));
  for (const interaction of OFFICIAL_EFFECT_ORDER_EVIDENCE.interactions) {
    assert.equal(interaction.canonicalCardId, CARD_ID);
    assert.deepEqual(interaction.sourceIds, ["coreRules", "radianceRulings", "spiritforgedErrata"]);
    assert.ok(interaction.clauses.length > 0);
    assert.ok(interaction.ruleRefs.length > 0);
    assert.ok(interaction.timeline.length >= 3);
    assert.match(interaction.priorityFocus, /Priority/);
    assert.match(interaction.responseWindow, /Reaction|Resolve|response/i);
    assert.match(interaction.replacement, /No replacement|not a post-entry/i);
    assert.match(interaction.layers, /No continuous|no layer/i);
    assert.ok(interaction.productionTestNames.every(name => productionNames.has(name)));
  }
  assert.deepEqual(OFFICIAL_EFFECT_ORDER_EVIDENCE.interactions[1].ruleRefs.filter(rule => [
    "143.4", "185.2.a", "185.2.d", "185.3.a", "187.4", "337.2", "350.2",
    "352.1", "352.2", "354", "355.2", "359.2.c", "440.2.c"
  ].includes(rule)), [
    "143.4", "185.2.a", "185.2.d", "185.3.a", "187.4", "337.2", "350.2",
    "352.1", "352.2", "354", "355.2", "359.2.c", "440.2.c"
  ]);
});

test("Assembly Rig production registry refuses the shipped judge-required program before activation", () => {
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
  const inspected = binding.inspect(kernel.getObject("rig"));
  assert.equal(inspected.program, program);
  assert.equal(inspected.abilities.length, 1);
  assert.throws(
    () => binding.describeActivate(kernel.getObject("rig"), "A", 0),
    error => error.name === "ProgramBindingError" &&
      error.code === "judge-required" &&
      error.message === program.judgeReason
  );
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
  const base = { type: "base", player: "A" };
  const [instruction] = program.abilities[0].body;
  // The reference kernel evaluates Expr args itself; substitute the printed
  // controller-base placeholder with the concrete player base.
  const args = {
    ...instruction.args,
    location: { kind: "constant", value: base }
  };
  const run = runInstruction(tokenDefinition, args, { world: kernel });
  assert.equal(run.result.status, "executed");
  const created = kernel.query({ zone: "board", type: "unit" }).filter(object => object.isToken);
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
    programs: [executableCarrier],
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
  // The contract action bridge records the create/play leaves, but the event
  // adapter only derives kill/move emissions from contract steps. It therefore
  // emits the zone transitions without a card-played event for the token.
  const tokenEntersAt = timeline.findIndex((event, index) => index > tokenEntersChainAt &&
    event.timingPoint === "object-enters-board" && event.object?.ref.id === mech.ref.id);
  const activationResolveAt = timeline.findIndex((event, index) => index > tokenEntersAt &&
    event.timingPoint === "chain-item-resolve" && event.details?.item === draft.id);
  assert.ok(activationPendingAt >= 0 && activationPendingAt < activationFinalizeAt);
  assert.ok(activationFinalizeAt < tokenEntersChainAt && tokenEntersChainAt < tokenEntersAt &&
    tokenEntersAt < activationResolveAt,
  "the token action occurs synchronously inside the activated ability's final Resolve");
  assert.equal(timeline.some(event => event.timingPoint === "card-played" &&
    event.object?.ref.id === mech.ref.id), false,
  "the same production gap also omits the token's card-played event");
  assert.equal(timeline.some(event => event.timingPoint === "chain-item-pending" &&
    event.object?.ref.id === mech.ref.id), false,
  "the synthetic chain zone transition is not a Pending Chain item event");
  assert.equal(timeline.filter(event => event.timingPoint === "object-enters-board" &&
    event.object?.ref.id === mech.ref.id).length, 1);
  assert.equal(f.kernel.linked(`${LINK_PREFIX}createdAmount`), 1);
  assert.equal(f.kernel.linked(`${LINK_PREFIX}amount`), 1);
  assert.equal(f.kernel.linked(`${LINK_PREFIX}blockedReason`), undefined);
  assert.deepEqual(f.engine.trace.filter(entry => entry.item === draft.id &&
    ["pending", "finalized", "resolved"].includes(entry.step)).map(entry => entry.step),
  ["pending", "finalized", "resolved"]);
  assert.equal(f.engine.trace.filter(entry => String(entry.item).startsWith(`play:${mech.ref.id}:`) &&
    entry.step === "finalized").length, 0,
  "the production gap: the token does not receive its own Finalize trace");
  assert.equal(f.engine.trace.filter(entry => String(entry.item).startsWith(`play:${mech.ref.id}:`) &&
    entry.step === "resolved").length, 0,
  "the production gap: the token does not receive its own Resolve trace");
});

test(PRODUCTION_TEST_NAMES.gap, () => {
  const f = assemblyRigScene();
  activate(f);
  f.engine.pass("A");
  f.engine.pass("B");
  const [mech] = f.kernel.objects.filter(object => object.isToken);
  assert.ok(mech);
  const tokenPending = f.engine.pipeline.events.filter(event =>
    event.timingPoint === "chain-item-pending" &&
    event.details?.item?.startsWith(`play:${mech.ref.id}:`));
  const tokenFinalize = f.engine.pipeline.events.filter(event =>
    event.timingPoint === "chain-item-finalize" &&
    event.details?.item?.startsWith(`play:${mech.ref.id}:`));
  assert.deepEqual(tokenPending, [],
    "CR 350.2/352.1/440.2.c require the played token to become a Pending Chain item");
  assert.deepEqual(tokenFinalize, [],
    "the same token must pass its own Finalize before entering the Board");
  assert.equal(f.engine.pipeline.events.some(event =>
    event.timingPoint === "object-enters-chain" && event.object?.ref.id === mech.ref.id), true,
  "the creation half is observable; only the deferred Chain Play boundary is missing");
  assert.equal(f.engine.pipeline.events.some(event =>
    event.timingPoint === "chain-item-pending" && event.object?.ref.id === mech.ref.id), false,
  "a chain-zone transition alone does not satisfy the Pending Chain item requirement");
  assert.equal(f.engine.pipeline.events.some(event =>
    event.timingPoint === "object-enters-board" && event.object?.ref.id === mech.ref.id), true);
});

test(PRODUCTION_TEST_NAMES.universalPower, () => {
  const f = assemblyRigScene({ power: ["universal"], deck: ["top", "middle"] });
  activate(f);
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
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
