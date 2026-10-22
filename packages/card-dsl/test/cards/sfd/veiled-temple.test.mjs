import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/veiled-temple.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { TurnFlow } from "../../../../engine-core/dist/turn/flow.js";

const CARD_ID = "card.hash-9daf60cdf4c82e4fba1f685af1c9b0d748003f7e9ad9c68f02f429bdd0cf85e5";
const SOURCE_TEXT =
  "When you conquer here, you may ready a friendly gear. If it's an Equipment, you may detach it.";
const CORE_RULES_URL =
  "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf";
const RADIANCE_RULINGS_URL =
  "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/";
const SFD_ERRATA_URL =
  "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/";

const PRODUCTION_TEST_NAMES = Object.freeze({
  golden: "sfd-221-221 Veiled Temple production golden: an Equipment is ready, locked and detached",
  nonEquipment: "sfd-221-221 Veiled Temple production boundary: a non-Equipment is readied and never prompts to detach",
  alreadyReady: "sfd-221-221 Veiled Temple production boundary: an already-ready Equipment keeps the locked \"it\"",
  unattached: "sfd-221-221 Veiled Temple production boundary: an unattached Equipment is legal and detach does nothing",
  declineLeading: "sfd-221-221 Veiled Temple production boundary: declining the leading may skips targets and Resolve",
  declineLater: "sfd-221-221 Veiled Temple production boundary: declining the later may keeps the Equipment attached",
  wrongBattlefield: "sfd-221-221 Veiled Temple production counterexample: a Conquer elsewhere never triggers here",
  noFriendlyGear: "sfd-221-221 Veiled Temple production boundary: no friendly gear removes an unperformable trigger (403.4)",
  friendlyOnly: "sfd-221-221 Veiled Temple production boundary: only the controller's gear is offered as friendly"
});

// This evidence block is pinned to the repository's reviewed official-source
// snapshots. Neither official rulings source names this card or changes its
// text. CR v1.5 therefore supplies the procedure, while the catalog supplies
// the card-specific instruction. No numeric or global effect priority exists.
const OFFICIAL_EFFECT_ORDER_EVIDENCE = Object.freeze({
  contract: "riftbound.official-effect-order-evidence.v1",
  canonicalCardId: CARD_ID,
  sources: Object.freeze({
    coreRules: Object.freeze({
      version: "1.5",
      published: "2026-10-09",
      effective: "2026-10-16",
      url: CORE_RULES_URL,
      sha256: "94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec"
    }),
    radianceRulings: Object.freeze({
      published: "2026-10-09",
      effective: "2026-10-16",
      url: RADIANCE_RULINGS_URL,
      appliesToThisCard: false,
      result: "reviewed: no Veiled Temple-specific ruling"
    }),
    spiritforgedErrata: Object.freeze({
      published: "2026-01-14",
      effective: null,
      url: SFD_ERRATA_URL,
      appliesToThisCard: false,
      result: "reviewed: no Veiled Temple correction"
    })
  }),
  interactions: Object.freeze([
    Object.freeze({
      id: "conquer-here-trigger",
      canonicalCardId: CARD_ID,
      sourceIds: Object.freeze(["coreRules", "radianceRulings", "spiritforgedErrata"]),
      clauses: Object.freeze(["When you conquer here"]),
      ruleRefs: Object.freeze([
        "053.3", "190.6", "303.2.a", "312.2.c", "337.1.a", "337.4",
        "338.1", "338.1.b", "339.1", "340.1", "383.3.c", "383.3.d", "407.4",
        "383.3.d.1", "468.5.d", "471.1", "473.2.a", "473.2.c"
      ]),
      timeline: Object.freeze([
        "A real TurnFlow control-establishment wave at this Battlefield creates the Conquer event with details.battlefieldId.",
        "The source-location anchor plus the event Battlefield must match; a Conquer at another Battlefield creates no Pending ability.",
        "The ability becomes Pending; its controller then receives the Finalize decision. Finalizing does not pass Priority.",
        "After Finalize, the Closed State permits legally timed Reactions. Both players pass in Turn Order before Resolve.",
        "If multiple such triggers are simultaneous, 303.2.a plus 383.3.d-.1 require controller selection and Turn Order rather than array order."
      ]),
      priorityFocus: "Finalize itself grants no new Priority; the next controller gains Priority only after Pending items are finalized.",
      responseWindow: "Closed-State Reaction window after Finalize and before Resolve; the card creates no replacement or resource-Add timing exception.",
      lki: "No look-back is needed for the trigger condition: the live Battlefield incarnation remains on the Board.",
      productionTestNames: Object.freeze([
        PRODUCTION_TEST_NAMES.wrongBattlefield,
        PRODUCTION_TEST_NAMES.noFriendlyGear
      ])
    }),
    Object.freeze({
      id: "leading-finalize-may-and-target",
      canonicalCardId: CARD_ID,
      sourceIds: Object.freeze(["coreRules", "radianceRulings", "spiritforgedErrata"]),
      clauses: Object.freeze(["you may ready a friendly gear"]),
      ruleRefs: Object.freeze([
        "204.1.c", "355.7", "355.8", "355.12", "383.3.a", "383.3.a.1",
        "383.3.a.2", "403.4", "403.4.b", "405.2", "406.1"
      ]),
      timeline: Object.freeze([
        "The first 'may' is the decision to perform the triggered ability and is made during Finalize.",
        "The friendly Board gear is a target selected independently of that action decision under 355.12 and locked with the ability.",
        "No printed or optional additional cost exists, so this interaction has no resource payment stage.",
        "Declining removes the Pending ability as not performed; accepting proceeds through legality and the Reaction window to Resolve."
      ]),
      priorityFocus: "The Battlefield ability's controller chooses during Finalize; Priority remains with the applicable player after all Pending items are finalized.",
      responseWindow: "No response exists before Finalize completes. A legally timed Reaction may be played in the Closed State after it.",
      lki: "The selected gear must retain its exact incarnation into Resolve; no left-Board look-back applies while it remains on the Board.",
      productionTestNames: Object.freeze([
        PRODUCTION_TEST_NAMES.golden,
        PRODUCTION_TEST_NAMES.declineLeading,
        PRODUCTION_TEST_NAMES.friendlyOnly,
        PRODUCTION_TEST_NAMES.noFriendlyGear
      ])
    }),
    Object.freeze({
      id: "ready-on-resolve",
      canonicalCardId: CARD_ID,
      sourceIds: Object.freeze(["coreRules", "radianceRulings", "spiritforgedErrata"]),
      clauses: Object.freeze(["ready a friendly gear"]),
      ruleRefs: Object.freeze(["416.1", "416.1.b", "416.1.c"]),
      timeline: Object.freeze([
        "Resolve executes the ready action only after the accepted ability has passed the Reaction window.",
        "An exhausted friendly gear becomes ready and the action emits its real readied event.",
        "A gear that is already ready changes no state under 416.1.c and contributes no object to the ready receipt."
      ]),
      priorityFocus: "Ready is a Limited Action instructed by the resolving ability; it neither creates nor transfers Priority.",
      responseWindow: "No player response window occurs inside a single Resolve; opponents could only react before Resolve began.",
      lki: "No look-back is needed for the readied gear while it remains on the Board.",
      productionTestNames: Object.freeze([
        PRODUCTION_TEST_NAMES.golden,
        PRODUCTION_TEST_NAMES.nonEquipment,
        PRODUCTION_TEST_NAMES.alreadyReady
      ])
    }),
    Object.freeze({
      id: "equipment-conditional-detach-may",
      canonicalCardId: CARD_ID,
      sourceIds: Object.freeze(["coreRules", "radianceRulings", "spiritforgedErrata"]),
      clauses: Object.freeze(["If it's an Equipment, you may detach it."]),
      ruleRefs: Object.freeze([
        "355.12", "359.3.e.14", "359.3.e.14.a", "359.3.e.14.b",
        "383.3.a.3", "436.1", "436.1.a.1", "436.2", "436.3"
      ]),
      timeline: Object.freeze([
        "At Resolve, 'it' is the exact gear selected and locked by the first may action.",
        "The Equipment tag test determines whether the second Resolve-time may is offered; it is not a Finalize question.",
        "If accepted, detach selects that same Equipment and removes it from its host when attached; an unattached card does nothing."
      ]),
      priorityFocus: "The controller makes the later may during its own Resolve, after the Finalize/Priority/Reaction sequence.",
      responseWindow: "No new response window is opened between linked instructions during one Resolve.",
      lki: "The selected object's tags and attachment state are read at Resolve; no object leaves the Board as a prerequisite of this decision.",
      productionTestNames: Object.freeze([
        PRODUCTION_TEST_NAMES.golden,
        PRODUCTION_TEST_NAMES.alreadyReady,
        PRODUCTION_TEST_NAMES.unattached,
        PRODUCTION_TEST_NAMES.declineLater
      ])
    })
  ])
});

const [ability] = program.abilities;
const [readyChoice] = ability.body;
const [readyGear, detachChoice] = readyChoice.args.body.value;
const [detach] = detachChoice.args.body.value;

test("sfd-221-221 Veiled Temple: executable program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(Object.hasOwn(program, "judgeReason"), false);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-221-221 Veiled Temple: official evidence records source dates, interactions and production assertions", () => {
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.canonicalCardId, CARD_ID);
  assert.deepEqual(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.coreRules, {
    version: "1.5",
    published: "2026-10-09",
    effective: "2026-10-16",
    url: CORE_RULES_URL,
    sha256: "94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec"
  });
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.radianceRulings.effective, "2026-10-16");
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.radianceRulings.appliesToThisCard, false);
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.spiritforgedErrata.appliesToThisCard, false);
  assert.deepEqual(
    OFFICIAL_EFFECT_ORDER_EVIDENCE.interactions.map(interaction => interaction.id),
    ["conquer-here-trigger", "leading-finalize-may-and-target", "ready-on-resolve", "equipment-conditional-detach-may"]
  );
  for (const interaction of OFFICIAL_EFFECT_ORDER_EVIDENCE.interactions) {
    assert.equal(interaction.canonicalCardId, CARD_ID);
    assert.deepEqual(interaction.sourceIds, ["coreRules", "radianceRulings", "spiritforgedErrata"]);
    assert.ok(interaction.clauses.length > 0);
    assert.ok(interaction.ruleRefs.length > 0);
    assert.ok(interaction.timeline.length >= 3);
    assert.match(interaction.priorityFocus, /Priority/);
    assert.match(interaction.responseWindow, /Reaction|Resolve|response/i);
    assert.ok(interaction.productionTestNames.length > 0);
  }
  const evidenceRules = new Set(
    OFFICIAL_EFFECT_ORDER_EVIDENCE.interactions.flatMap(interaction => interaction.ruleRefs)
  );
  for (const rule of ["303.2.a", "337.1.a", "355.12", "383.3.a.3", "407.4", "416.1.c", "436.3"]) {
    assert.ok(evidenceRules.has(rule), `${rule} is pinned to this card's evidence`);
  }
});

test("sfd-221-221 Veiled Temple: optional conquer structure with ready, Equipment gate and detach", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  assert.equal(ability.optional, true);
  // The battlefield-relative "here" stays in the printed trigger filter and
  // is consumed by the production pipeline matcher.
  assert.deepEqual(ability.trigger.filter, { event: "conquer", here: true, player: "controller" });
  assert.deepEqual(ability.body.map((instruction) => instruction.id), ["veiled-temple.ready-opt"]);

  // 403.1 / 355.12: the may-action picks its gear when the action is locked, so
  // the target lives on the choice node.
  assert.equal(readyChoice.op, "choice.optional");
  assert.deepEqual(readyChoice.targets, [
    {
      id: "veiled-temple.gear",
      filter: { type: "gear", zone: "board", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(readyChoice.args.body.kind, "constant");
  assert.equal(readyGear.op, "effect.ready");
  assert.deepEqual(readyGear.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "veiled-temple.gear" }
  });

  // "If it's an Equipment": a real tag membership test on the selected gear.
  assert.equal(detachChoice.op, "choice.optional");
  assert.equal(detachChoice.linkedTo, "veiled-temple.ready-gear");
  assert.deepEqual(detachChoice.condition, {
    kind: "compare",
    left: { kind: "constant", value: "Equipment" },
    operator: "in",
    right: {
      kind: "object-property",
      object: { target: "veiled-temple.gear" },
      property: "tags"
    }
  });

  // 355.12 / 436.3: "it" is the exact Finalize target. A target-backed pick
  // keeps that identity when readying an already-Ready gear changes nothing.
  assert.equal(detach.op, "effect.detach");
  assert.equal(detach.args.pick.kind, "constant");
  assert.deepEqual(detach.picks[0].options, [
    { kind: "target", id: "veiled-temple.gear" }
  ]);
  assert.deepEqual(detach.picks[0].filter, { type: "gear", zone: "board" });
});


function productionScene({ sourceField = "bf1", tag = "Equipment", exhausted = true, attached = true, setAnswers = {} } = {}) {
  const builder = world()
    .player("A")
    .player("B")
    .battlefield("veiled", {
      cardId: CARD_ID,
      types: ["battlefield"],
      controller: null,
      owner: "A",
      isToken: true,
      zone: "board",
      location: { type: "battlefield", id: sourceField },
      energy: null,
      power: null,
      might: null
    })
    .base("mover", { controller: "A", might: 3 })
    .unit("host", { controller: "A", owner: "A", location: { type: "base", player: "A" } })
    .unit("gear", {
      types: ["gear"],
      tags: tag === null ? [] : [tag],
      controller: "A",
      owner: "A",
      exhausted,
      location: { type: "base", player: "A" },
      attachedTo: attached ? { id: "host", zoneEntryId: 1 } : null,
      energy: null,
      power: null,
      might: null
    });
  for (const player of ["A", "B"]) {
    builder.deck(Array.from({ length: 8 }, (_, index) => `${player}:deck:${index}`), { owner: player });
    builder.rune(Array.from({ length: 8 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  const kernel = builder.build();
  const requests = [];
  const choose = request => {
    requests.push(structuredClone(request));
    if (request.type === "optional" && request.id.startsWith("finalize:")) return setAnswers.finalize ?? true;
    if (request.type === "optional") return setAnswers.resolve ?? true;
    if (request.type === "select-objects" && request.id === "target:veiled-temple.gear") {
      return request.options.filter(ref => ref.id === "gear");
    }
    if (request.type === "select-objects" && request.id.includes(":pick:veiled-temple.detached-gear")) {
      return request.options.filter(ref => ref.id === "gear");
    }
    if (request.type === "select-objects" && request.options.length === request.min) return [...request.options];
    if (request.type === "select-objects" && request.min === 0) return [];
    if (request.type === "mode" && request.id.includes(":order:")) return request.options[0];
    if (request.type === "mode" && request.id.startsWith("engagement:")) return request.options[0];
    throw new Error(`Unexpected production choice ${request.type} ${request.id}`);
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
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source,
      controller,
      timingPoint,
      choose
    }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const binding = createProgramBinding({ cardPrograms: [program] });
  const flow = new TurnFlow({
    host,
    player: id => kernel.player(id),
    turnOrder: ["A", "B"],
    battlefields: [{ id: "bf1", controller: null }, { id: "bf2", controller: null }]
  });
  const lifecycleErrors = [];
  const lifecycle = binding.attachLifecycle(flow.chain, error => lifecycleErrors.push(error));
  flow.start();
  const conquer = destination => flow.execute({
    id: `conquer-${destination}-${requests.length}`,
    controller: "A",
    source: kernel.getObject("mover"),
    kind: "activated",
    speed: "normal",
    body: [{
      id: `move-to-${destination}`,
      op: "effect.move",
      args: { to: { kind: "constant", value: { type: "battlefield", id: destination } } }
    }]
  });
  const settle = () => {
    for (let guard = 0; flow.chain.items.length || flow.chain.focus !== null; guard++) {
      assert.ok(guard < 100, "production chain must settle");
      flow.pass(flow.chain.items.length ? flow.chain.priority : flow.chain.focus);
    }
  };
  return { kernel, flow, binding, lifecycle, lifecycleErrors, requests, conquer, settle };
}

test(PRODUCTION_TEST_NAMES.golden, () => {
  const f = productionScene();
  f.conquer("bf1");
  f.settle();

  assert.deepEqual(f.lifecycleErrors, []);
  assert.equal(f.kernel.player("A").score, 1);
  assert.deepEqual(f.requests.map(request => request.id), [
    "finalize:trigger:1:optional",
    "target:veiled-temple.gear",
    "veiled-temple.detach-opt/optional",
    "veiled-temple.detach-opt/veiled-temple.detach/pick%3Aveiled-temple.detached-gear"
  ]);
  assert.ok(f.requests[0].id.startsWith("finalize:"));
  assert.ok(f.requests.slice(2).every(request => !request.id.startsWith("finalize:")),
    "the nested may is asked only during Resolve");
  assert.deepEqual(f.requests[1].options, [f.kernel.ref("gear")]);
  assert.deepEqual(f.requests[3].options, [f.kernel.ref("gear")],
    "the pick reads the exact target locked during Finalize");
  assert.equal(
    f.flow.chain.pipeline.events.filter(event => event.timingPoint === "object-readied" &&
      event.object?.ref.id === "gear").length,
    1
  );
  assert.equal(f.kernel.getObject("gear").exhausted, false);
  assert.equal(f.kernel.getObject("gear").attachedTo, null);
  const trace = f.flow.chain.trace;
  assert.ok(trace.some(entry => entry.step === "targets-finalized" && entry.item === "trigger:1"));
  assert.ok(trace.some(entry => entry.step === "resolved" && entry.item === "trigger:1"));
  f.lifecycle.detach();
});

test(PRODUCTION_TEST_NAMES.nonEquipment, () => {
  const f = productionScene({ tag: null });
  f.conquer("bf1");
  f.settle();

  assert.deepEqual(f.lifecycleErrors, []);
  assert.deepEqual(f.requests.map(request => request.id), [
    "finalize:trigger:1:optional",
    "target:veiled-temple.gear"
  ]);
  assert.equal(f.kernel.getObject("gear").exhausted, false);
  assert.deepEqual(f.kernel.getObject("gear").attachedTo, f.kernel.ref("host"));
  assert.equal(f.kernel.events.some(event => event.action === "detach"), false);
  f.lifecycle.detach();
});

test(PRODUCTION_TEST_NAMES.alreadyReady, () => {
  const f = productionScene({ exhausted: false });
  f.conquer("bf1");
  f.settle();

  assert.deepEqual(f.lifecycleErrors, []);
  // Later Awakening may ready the Gear after the card has resolved. The card's
  // own Resolve must not link a readied receipt when 416.1.c changes nothing.
  assert.equal(f.kernel.linked("readied"), undefined);
  assert.equal(f.requests.some(request => request.id === "target:veiled-temple.gear"), true);
  assert.equal(f.kernel.getObject("gear").exhausted, false);
  assert.equal(f.kernel.getObject("gear").attachedTo, null);
  f.lifecycle.detach();
});

test(PRODUCTION_TEST_NAMES.unattached, () => {
  const f = productionScene({ attached: false });
  f.conquer("bf1");
  f.settle();

  assert.deepEqual(f.lifecycleErrors, []);
  assert.equal(f.kernel.getObject("gear").exhausted, false);
  assert.equal(f.kernel.getObject("gear").attachedTo, null);
  assert.equal(f.kernel.events.some(event => event.action === "detach"), false);
  assert.ok(f.flow.chain.trace.some(entry => entry.step === "resolved" && entry.item === "trigger:1"));
  f.lifecycle.detach();
});

test(PRODUCTION_TEST_NAMES.declineLater, () => {
  const f = productionScene({ setAnswers: { resolve: false } });
  f.conquer("bf1");
  f.settle();

  assert.deepEqual(f.lifecycleErrors, []);
  assert.equal(f.requests.some(request => request.id === "veiled-temple.detach-opt/optional"), true);
  assert.equal(f.requests.some(request => request.id.includes(":pick:veiled-temple.detached-gear")), false);
  assert.equal(f.kernel.getObject("gear").exhausted, false);
  assert.deepEqual(f.kernel.getObject("gear").attachedTo, f.kernel.ref("host"));
  assert.equal(f.kernel.events.some(event => event.action === "detach"), false);
  f.lifecycle.detach();
});

test(PRODUCTION_TEST_NAMES.declineLeading, () => {
  const f = productionScene({ setAnswers: { finalize: false } });
  f.conquer("bf1");
  f.settle();

  assert.deepEqual(f.lifecycleErrors, []);
  assert.deepEqual(f.requests.map(request => request.id), ["finalize:trigger:1:optional"]);
  assert.deepEqual(f.kernel.getObject("gear").attachedTo, f.kernel.ref("host"));
  assert.ok(f.flow.chain.trace.some(entry => entry.step === "removed" && entry.item === "trigger:1"));
  assert.equal(f.flow.chain.trace.some(entry => entry.step === "resolved" && entry.item === "trigger:1"), false);
  f.lifecycle.detach();
});

test(PRODUCTION_TEST_NAMES.wrongBattlefield, () => {
  const f = productionScene({ sourceField: "bf2" });
  f.conquer("bf1");
  f.settle();

  assert.deepEqual(f.lifecycleErrors, []);
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.kernel.getObject("gear").attachedTo, f.kernel.ref("host"));
  assert.equal(f.flow.chain.pipeline.events.some(event => event.timingPoint === "conquer" &&
    event.details?.battlefieldId === "bf1"), true);
  assert.equal(f.flow.chain.trace.some(entry => entry.step === "pending" &&
    String(entry.item).startsWith("trigger:")), false);
  f.lifecycle.detach();
});

test(PRODUCTION_TEST_NAMES.noFriendlyGear, () => {
  const f = productionScene();
  f.kernel.perform({ type: "return-to-hand", object: f.kernel.ref("gear") });
  f.conquer("bf1");
  f.settle();

  assert.deepEqual(f.lifecycleErrors, []);
  assert.deepEqual(f.requests.map(request => request.id), ["finalize:trigger:1:optional"]);
  assert.ok(f.flow.chain.trace.some(entry => entry.step === "removed" && entry.item === "trigger:1" &&
    entry.reason === "unperformable-trigger"));
  assert.equal(f.flow.chain.trace.some(entry => entry.step === "resolved" && entry.item === "trigger:1"), false);
  f.lifecycle.detach();
});

test(PRODUCTION_TEST_NAMES.friendlyOnly, () => {
  const f = productionScene();
  f.kernel.perform({
    type: "take-control",
    object: f.kernel.ref("gear"),
    player: "B"
  });
  f.conquer("bf1");
  f.settle();

  assert.deepEqual(f.lifecycleErrors, []);
  assert.deepEqual(f.requests.map(request => request.id), ["finalize:trigger:1:optional"]);
  assert.ok(f.flow.chain.trace.some(entry => entry.step === "removed" && entry.item === "trigger:1" &&
    entry.reason === "unperformable-trigger"));
  assert.equal(f.kernel.getObject("gear").controller, "B");
  f.lifecycle.detach();
});
