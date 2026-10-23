import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/lucian-merciless.js";
import longSword from "../../../dist/cards/sfd/long-sword.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { runAbilityBody } = await import(new URL("effects/interpreter.js", engineCore));
const { world } = await import(new URL("effects/testing/index.js", engineCore));
const { ProgramRegistry } = await import(new URL("programs/registry.js", engineCore));
const { triggerRegistrations } = await import(new URL("programs/triggers.js", engineCore));
const { matchesTriggerEvent } = await import(new URL("events/pipeline-match.js", engineCore));
const { createProgramBinding } = await import(new URL("programs/index.js", engineCore));
const { bindResolveContext, createActionPipelineHost } = await import(new URL("events/action-adapter.js", engineCore));
const { TurnFlow } = await import(new URL("turn/flow.js", engineCore));
const { productionPlay } = await import("../../fixtures/production-play.mjs");

const admitted = { ...program, status: "executable", judgeReason: undefined };
const CARD_ID = "card.hash-c403c2d9835df87cc0774a86145ef937226d5e7ebcfe75282053e23df744f5ef";
const SOURCE_TEXT =
  "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)\n" +
  "The first time I conquer each turn, ready me.";
const CORE_RULES_URL =
  "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf";
const RADIANCE_RULINGS_URL =
  "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/";
const SFD_ERRATA_URL =
  "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/";
const LONGSWORD_ID = "card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010";

const PRODUCTION_TEST_NAMES = Object.freeze({
  namedPower:
    "production golden: Weaponmaster pays the chosen equipment's named Equip cost and attaches",
  universalPower:
    "production golden: Weaponmaster commits a Universal `any` Power lot for the remaining [A]",
  reattach:
    "production golden: Weaponmaster may reattach an Equipment already attached to another Unit",
  conquerOnce:
    "production golden: a second real Conquer in the same turn cannot trigger `ready me` again",
  resolveCost:
    "production golden: Weaponmaster resolves its Equip cost before attaching",
  noEquipCostBlocker:
    "production blocker: selecting Equipment without an Equip cost raises judge-required instead of leaving it unattached",
  unpayableEquipBlocker:
    "production blocker: an unpayable selected Equip cost aborts Resolve instead of leaving the Equipment unattached"
});

const equipmentKeywords = (ability) => ({
  id: ability.keyword,
  ...(ability.value === undefined ? {} : { value: ability.value }),
  ...(ability.params === undefined ? {} : { params: structuredClone(ability.params) })
});

// Official evidence is pinned to the repository's reviewed snapshots. Core
// Rules v1.5 is dated 2026-10-09 and effective 2026-10-16. Neither official
// source names Lucian; the Spiritforged errata's Weaponmaster mention is the
// ordinary [A] reminder on Yone, not replacement text for this card.
const OFFICIAL_EFFECT_ORDER_EVIDENCE = Object.freeze({
  contract: "riftbound.official-effect-order-evidence.v1",
  canonicalCardId: CARD_ID,
  rulingStatus: "no-card-specific-ruling",
  catalogPrinting: Object.freeze({
    id: "sfd-113-221",
    textSource: "packages/card-data/data/deck-catalog.json",
    sourceText: SOURCE_TEXT
  }),
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
      sha256: "dfba4f3ecf6956c32c19327330eaca96d317bedbf2c211c80a8fe1f1dccb569f",
      appliesToThisCard: false,
      result: "reviewed: no Lucian, Merciless entry or replacement"
    }),
    spiritforgedErrata: Object.freeze({
      published: "2026-01-14",
      effective: null,
      url: SFD_ERRATA_URL,
      sha256: "dca55c2d013473ffca82fb649a70d16d4b4356c22f74bd5a71b3aa3a9a4c94af",
      mentionsWeaponmaster: true,
      appliesToThisCard: false,
      result: "reviewed: no Lucian correction; Yone repeats the ordinary [A] Weaponmaster reminder"
    })
  }),
  interactions: Object.freeze([
    Object.freeze({
      id: "weaponmaster-play-effect",
      canonicalCardId: CARD_ID,
      clauses: Object.freeze([
        "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)"
      ]),
      ruleRefs: Object.freeze([
        "002", "051", "054.1", "135.2.e.5.a", "163.2.b", "191.4.d", "203",
        "204.3", "204.3.a", "303.2.a", "312.1", "313.2", "329", "337.1",
        "337.1.a", "337.1.b", "338.1", "339.1", "340.1", "355.15", "355.16",
        "356.1", "356.4", "357.1", "358.2", "359.3.e.14", "383.4.a",
        "383.4.a.2", "407.1", "407.4", "430.3", "435.1", "718.5", "821.1.b",
        "821.1.c", "821.1.c.1", "821.1.c.2", "821.1.c.3", "821.1.c.4",
        "821.1.c.5", "821.1.c.6", "821.1.c.7"
      ]),
      timeline: Object.freeze([
        "Play/Pending: A uses ordinary Main-phase Priority to place Lucian on the Chain; the printed Unit cost is selected and paid by card Finalize.",
        "The Unit resolves onto the Board exhausted; the real card-played timing creates Weaponmaster's Pending item after entry (383.4.a.2).",
        "Trigger Finalize locks the controlled Equipment target; malformed or ambiguous authoritative Equip data must fail closed.",
        "Because the Equip payment follows the target selection inside the effect and does not itself grant an effect, CR 204.3.a / 821.1.c.2 treats it as a Cost within Instructions paid during Resolve.",
        "After Finalize, A then B pass in turn order; Resolve computes the discounted cost, pays it, and only then attaches the locked Equipment, including reattachment.",
        "If the selected Equipment has no Equip cost or its cost cannot be paid, CR 821.1.c.4-.5 requires no attachment and leaves the Equipment in place; it does not authorize charging zero or creating a different named-Domain cost."
      ]),
      priorityFocus:
        "The Unit Play is a normal Main-phase action under A's Priority. Trigger Finalize neither passes Priority nor grants Focus. A then B receive the post-Finalize Closed-State Priority window before Resolve; the Weaponmaster target is locked and the Equip payment occurs in that Resolve under CR 204.3.a.",
      responseWindow:
        "The trigger becomes Pending after card-played. After Finalize, Reactions may be added before A and B pass in order. The Resolve-time Weaponmaster payment uses the ordinary final resource-payment opportunity; CR 430.3 remains the narrow Reaction Add permission during payment.",
      choices_and_cost:
        "Selecting zero Equipment omits the optional operation. Selecting one locks that exact controlled Equipment. Resolve reads its authoritative Equip CostSpec, reduces one original [A], and pays the remainder atomically; named Power and Universal Power remain distinct lots.",
      cardTextControl:
        "CR 002 and 051 supply no exception here: the printed keyword and CR 821.1.c's functional text agree. CR 054.1 has no competing prohibition/permission pair.",
      replacementPrevention:
        "No replacement or prevention ability belongs to this card. CR 054.1 has no competing permission branch here; generic payment prevention must not be rewritten as attachment.",
      layers:
        "Attachment does not itself grant Lucian's Conquer ability. A successful attachment updates the live attachment relation so the normal Equipment layer supplies its Might Bonus; the production named-cost test checks Lucian's layered Might changes from 3 to 5 after Long Sword attaches.",
      simultaneousTriggers:
        "CR 303.2.a supplies no universal queue or numeric priority. This card contributes one card-played trigger here; a separate Weaponmaster instance would trigger separately under 821.1.c.7, while no simultaneous instances are created by this production scene.",
      lki:
        "The selected Equipment is locked by exact current incarnation. Neither payment nor attachment moves it to a non-Board Zone, so Resolve reads its current Board snapshot and preserves its controller. No guessed last-known cost is needed.",
      currentBlocker:
        Object.freeze({
          references: Object.freeze([
            "engine-core/src/effects/instructions/cost.pay.ts:192-230",
            "engine-core/src/chain/engine.ts:1612",
            "engine-core/src/effects/instructions/cost.modify.ts:435-443"
          ]),
          effect: "A legal no-Equip-cost or insufficient-cost selection throws instead of resolving to a retained, unattached Equipment."
        }),
      productionTestNames: Object.freeze([
        PRODUCTION_TEST_NAMES.namedPower,
        PRODUCTION_TEST_NAMES.universalPower,
        PRODUCTION_TEST_NAMES.reattach,
        PRODUCTION_TEST_NAMES.resolveCost,
        PRODUCTION_TEST_NAMES.noEquipCostBlocker,
        PRODUCTION_TEST_NAMES.unpayableEquipBlocker
      ])
    }),
    Object.freeze({
      id: "conquer-ready-once-per-turn",
      canonicalCardId: CARD_ID,
      clauses: Object.freeze(["The first time I conquer each turn, ready me."]),
      ruleRefs: Object.freeze([
        "303.2.a", "312.1", "313.2", "329", "337.1.a", "339.1", "340.1",
        "383.3.c", "383.3.d", "383.3.e", "383.3.e.1", "383.4.c",
        "383.4.c.2", "383.4.c.2.a", "383.4.c.2.c", "416.1.b", "416.1.c",
        "468.5.d", "471.1", "473.2.a", "473.2.c"
      ]),
      timeline: Object.freeze([
        "A real Standard Move or effect-controlled entry establishes the contested state; TurnFlow's Score wave captures the exact participating Lucian refs.",
        "Control establishes and the first Conquer is published as one event for Lucian; the self trigger becomes Pending.",
        "The ability Finalizes without passing Priority, both players pass in turn order, and Resolve readies the exact Unit incarnation (416.1). An already-ready Unit remains ready (416.1.b-.c).",
        "A later real Conquer by the same Unit in the same turn still publishes a new Conquer event, but the frequency key is already consumed, so 383.3.e.1 suppresses a second trigger and ready operation.",
        "The test drives the second Conquer with a real Standard Move after an effect Move returns Lucian to Base; therefore the second Standard Move still exhausts him and proves the suppressed ready is observable."
      ]),
      priorityFocus:
        "The trigger enters from the Score event in a Closed State. Finalize does not pass Priority; after Finalize A and B pass in turn order before Resolve. Combat/Showdown Focus is not inferred into a global trigger order.",
      responseWindow:
        "After the Conquer trigger Finalizes, legally timed Reactions may be added before both passes complete. The production test reaches Resolve only after the real A-to-B pass sequence.",
      choices_and_cost:
        "The Conquer ability has no target, mode, optional decision, or cost. It therefore Finalizes without a choice or payment.",
      replacementPrevention:
        "The ability has no replacement or prevention clause. CR 054.1 is not invoked; Conquer still triggers when the one-point gain is replaced under 383.4.c.2.c, though that specific replacement branch is outside this card's production scene.",
      layers:
        "effect.ready changes the Unit's exhausted state; it registers no continuous layer. The one-per-turn limit is an EventPipeline trigger-frequency ledger keyed by the registered ability and turn, not an array-order heuristic.",
      simultaneousTriggers:
        "No generic FIFO/LIFO rule is assumed. CR 383.3.d assigns ordering among simultaneous triggers to their controllers, while TurnFlow publishes one event per participating Unit. This card has one registration and the later Conquer is a separate timing.",
      lki:
        "The Conquer event carries Lucian's exact id and zoneEntryId plus the Battlefield and prior controller. No zone transition occurs before Resolve, so effect.ready reads that same Unit incarnation; the already-ready no-op is separately covered.",
      productionTestNames: Object.freeze([
        PRODUCTION_TEST_NAMES.conquerOnce
      ])
    })
  ])
});

const weaponmasterEquipment = (ability) => ({
  owner: "A", controller: "A", cardId: "test:weaponmaster-equipment", name: "Test Equipment",
  types: ["gear"], tags: ["Equipment"], zone: "board",
  location: { type: "base", player: "A" }, energy: null, power: null, might: null,
  keywords: [equipmentKeywords(ability)]
});

const lucianWorld = ({ exhausted } = {}) => {
  const base = world().unit("lucian", { exhausted, might: 3 }).build();
  return base.clone({ sourceSnapshot: base.getObject("lucian") });
};

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-c403c2d9835df87cc0774a86145ef937226d5e7ebcfe75282053e23df744f5ef"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Weaponmaster/);
  assert.match(program.judgeReason, /Universal Power/);
  assert.match(program.judgeReason, /204\.3\.a/);
  assert.match(program.judgeReason, /can't-pay-cost|cannot-pay-cost/);
  assert.match(program.judgeReason, /cost\.pay\.ts:192-230/);
  assert.match(program.judgeReason, /engine\.ts:1612/);
  assert.match(program.judgeReason, /821\.1\.c\.4\/\.c\.5/);
  assert.match(program.judgeReason, /cost\.modify\.ts:435-443/);
  assert.doesNotMatch(program.judgeReason, /missing authoritative Equip-cost binding/);
  assert.doesNotMatch(program.judgeReason, /resolve-start/);
  assert.doesNotMatch(program.judgeReason, /383\.3\.b\.1 \/ 404\.1\.b\.1 \/ 405\.1/);
  assert.doesNotMatch(program.judgeReason, /Universal Power 资源提交/);
  assert.doesNotMatch(program.judgeReason, /PlayerSnapshot\.power 仍只有六域/);
  assert.doesNotMatch(program.judgeReason, /test-kernel\.ts:572-592/);
  assert.doesNotMatch(program.judgeReason, /host\.ts:760-771/);
  assert.doesNotMatch(program.judgeReason, /ObjectSnapshot 没有权威/);
  assert.ok(program.sourceText.includes("[Weaponmaster]"));
  assert.ok(program.sourceText.includes("The first time I conquer each turn, ready me."));
});

test("official effect-order evidence binds every card production assertion", () => {
  const evidence = OFFICIAL_EFFECT_ORDER_EVIDENCE;
  assert.equal(evidence.contract, "riftbound.official-effect-order-evidence.v1");
  assert.equal(evidence.canonicalCardId, CARD_ID);
  assert.equal(evidence.rulingStatus, "no-card-specific-ruling");
  assert.deepEqual(evidence.sources.coreRules, {
    version: "1.5",
    published: "2026-10-09",
    effective: "2026-10-16",
    url: CORE_RULES_URL,
    sha256: "94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec"
  });
  assert.equal(evidence.sources.radianceRulings.effective, "2026-10-16");
  assert.equal(evidence.sources.radianceRulings.appliesToThisCard, false);
  assert.equal(evidence.sources.spiritforgedErrata.mentionsWeaponmaster, true);
  assert.equal(evidence.sources.spiritforgedErrata.appliesToThisCard, false);
  assert.deepEqual(evidence.catalogPrinting, {
    id: "sfd-113-221",
    textSource: "packages/card-data/data/deck-catalog.json",
    sourceText: SOURCE_TEXT
  });
  assert.deepEqual(evidence.interactions.map((interaction) => interaction.id), [
    "weaponmaster-play-effect",
    "conquer-ready-once-per-turn"
  ]);
  const [weaponmaster, conquer] = evidence.interactions;
  assert.equal(weaponmaster.canonicalCardId, CARD_ID);
  assert.equal(conquer.canonicalCardId, CARD_ID);
  assert.deepEqual(weaponmaster.productionTestNames, [
    PRODUCTION_TEST_NAMES.namedPower,
    PRODUCTION_TEST_NAMES.universalPower,
    PRODUCTION_TEST_NAMES.reattach,
    PRODUCTION_TEST_NAMES.resolveCost,
    PRODUCTION_TEST_NAMES.noEquipCostBlocker,
    PRODUCTION_TEST_NAMES.unpayableEquipBlocker
  ]);
  assert.deepEqual(conquer.productionTestNames, [PRODUCTION_TEST_NAMES.conquerOnce]);
  for (const rule of ["135.2.e.5.a", "163.2.b", "204.3", "204.3.a", "821.1.c.5"]) {
    assert.ok(weaponmaster.ruleRefs.includes(rule), `${rule} is pinned to Weaponmaster evidence`);
  }
  for (const rule of ["383.3.e.1", "383.4.c.2.a", "416.1.b", "416.1.c", "473.2.c"]) {
    assert.ok(conquer.ruleRefs.includes(rule), `${rule} is pinned to Conquer evidence`);
  }
  assert.match(weaponmaster.priorityFocus, /neither passes Priority nor grants Focus/u);
  assert.match(weaponmaster.responseWindow, /430\.3/u);
  assert.match(weaponmaster.cardTextControl, /CR 002 and 051/u);
  assert.match(weaponmaster.currentBlocker.effect, /throws instead/u);
  assert.match(conquer.timeline[3], /frequency key/u);
  assert.match(conquer.lki, /same Unit incarnation/u);
});

test("abilities: Weaponmaster keyword plus a per-turn conquer trigger that readies self", () => {
  assert.equal(program.abilities.length, 2);

  const keyword = program.abilities[0];
  assert.equal(keyword.kind, "keyword");
  assert.equal(keyword.keyword, "weaponmaster");
  assert.equal(keyword.value, undefined);

  const triggered = program.abilities[1];
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "conquer");
  assert.deepEqual(triggered.trigger.filter, { event: "conquered", role: "self" });
  assert.equal(triggered.trigger.once, "per-turn");
  assert.equal(triggered.optional, false);

  assert.equal(triggered.body.length, 1);
  const instruction = triggered.body[0];
  assert.equal(instruction.id, "ready-self");
  assert.equal(instruction.op, "effect.ready");
  assert.deepEqual(instruction.args, {});
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("conquer trigger body executes through the interpreter and reference kernel: 'ready me'", () => {
  // effect.ready with no args defaults to { kind: "source" } ("ready me").
  const kernel = lucianWorld({ exhausted: true });
  const ability = program.abilities[1];
  const outcome = runAbilityBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("lucian").exhausted, false);
  assert.equal(outcome.results.length, 1);
  assert.equal(outcome.results[0].op, "effect.ready");
  assert.equal(outcome.results[0].result.status, "executed");
});

test("conquer trigger body on an already-ready source is a no-op (CR 416.1.b-.c)", () => {
  const kernel = lucianWorld({ exhausted: false });
  const ability = program.abilities[1];
  const outcome = runAbilityBody(ability.body, kernel);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("lucian").exhausted, false);
});

test("conquer trigger binds the real per-Unit conquer payload", () => {
  const { judgeReason, ...binding } = program;
  const registry = new ProgramRegistry([{ ...binding, status: "executable" }]);
  const base = world().unit("lucian", { cardId: program.canonicalCardId }).build();
  const registrations = triggerRegistrations(registry, base.getObject("lucian"));
  const conquer = registrations.find((entry) => entry.spec.at === "conquer");
  assert.ok(conquer, "the merged adapter must register the conquer trigger");
  assert.deepEqual(conquer.spec.filter.object, { objectId: "lucian" });
  assert.equal(conquer.spec.once, "per-turn");
  assert.deepEqual(conquer.activeZones, ["board"]);

  assert.equal(
    matchesTriggerEvent(conquer.spec.filter, {
      kind: "conquer", timingPoint: "conquer", object: base.getObject("lucian"),
      source: base.getObject("lucian"), it: base.getObject("lucian"), player: "A",
      details: { battlefieldId: "bf1", objectId: "lucian", playerId: "A" }
    }, "A"),
    true
  );
});

function conquerFixture({ includeLucian = true, extraParticipant = false, lucianAtBase = false } = {}) {
  const builder = world()
    .player("A")
    .player("B")
    .deck(Array.from({ length: 8 }, (_, index) => `A:deck:${index}`), { owner: "A" })
    .deck(Array.from({ length: 8 }, (_, index) => `B:deck:${index}`), { owner: "B" })
    .rune(Array.from({ length: 8 }, (_, index) => `A:rune:${index}`), { owner: "A" })
    .rune(Array.from({ length: 8 }, (_, index) => `B:rune:${index}`), { owner: "B" })
    .base("source", { owner: "A", controller: "A", might: 1 });
  if (includeLucian) {
    builder.unit("lucian", {
      owner: "A",
      controller: "A",
      cardId: program.canonicalCardId,
      tags: ["Lucian", "Demacia", "Sentinel", "Champion"],
      might: 3,
      exhausted: true,
      location: lucianAtBase ? { type: "base", player: "A" } : { type: "battlefield", id: "bf1" }
    });
  }
  if (extraParticipant) {
    builder.unit("ally", {
      owner: "A",
      controller: "A",
      cardId: null,
      might: 1,
      location: { type: "battlefield", id: "bf1" }
    });
  }
  const kernel = builder.build();
  const choose = (request) => {
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new Error(`Unexpected production choice ${request.type} ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (saved) => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    performContract: (action) => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const flow = new TurnFlow({
    host,
    player: (id) => kernel.player(id),
    turnOrder: ["A", "B"],
    battlefields: [{ id: "bf1", controller: null }, { id: "bf2", controller: null }],
    victoryScore: 20
  });
  const admitted = { ...program, status: "executable", judgeReason: undefined };
  const binding = createProgramBinding({ cardPrograms: [admitted] });
  const registrations = binding.registerProgramTriggers(flow.chain, kernel.getObject("lucian"));
  const fired = [];
  const append = flow.chain.pipeline.onTrigger;
  flow.chain.pipeline.onTrigger = (snapshot) => {
    fired.push(snapshot);
    append(snapshot);
  };
  const settle = (budget = 100) => {
    for (let index = 0; index < budget; index++) {
      if (flow.chain.items.length) { flow.chain.pass(flow.chain.priority); continue; }
      if (flow.chain.focus) { flow.pass(flow.chain.focus); continue; }
      return;
    }
    throw new Error("TurnFlow did not settle");
  };
  flow.start();
  settle();
  return { flow, kernel, binding, registrations, fired, settle };
}

test("production golden: a real Conquer by Lucian readies him once and keeps resources unchanged", () => {
  const f = conquerFixture();
  const conquer = f.flow.chain.pipeline.events.filter((event) => event.timingPoint === "conquer");
  assert.equal(conquer.length, 1);
  assert.deepEqual(conquer[0].object.ref, f.kernel.ref("lucian"));
  assert.deepEqual(conquer[0].source.ref, f.kernel.ref("lucian"));
  assert.deepEqual(conquer[0].it.ref, f.kernel.ref("lucian"));
  assert.deepEqual(conquer[0].details, {
    battlefieldId: "bf1",
    battlefieldControllerBefore: null,
    objectId: "lucian",
    playerId: "A"
  });
  assert.equal(f.fired.filter((entry) => entry.registration.spec.at === "conquer").length, 1);
  assert.equal(f.kernel.getObject("lucian").exhausted, false);
  assert.equal(f.kernel.getObject("lucian").location.id, "bf1");
  assert.equal(f.flow.battlefields[0].controller, "A");
  assert.equal(f.kernel.player("A").score, 1);
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.deepEqual(f.flow.chain.items, []);
});

test("production boundary: each participating Unit has its own event, while a nonparticipant has none", () => {
  const withAlly = conquerFixture({ extraParticipant: true });
  const events = withAlly.flow.chain.pipeline.events.filter((event) => event.timingPoint === "conquer");
  assert.deepEqual(new Set(events.map((event) => event.object.ref.id)), new Set(["lucian", "ally"]));
  assert.equal(withAlly.fired.filter((entry) => entry.registration.spec.at === "conquer").length, 1);
  assert.equal(withAlly.kernel.getObject("lucian").exhausted, false);

  const nonparticipant = conquerFixture({ extraParticipant: true, lucianAtBase: true });
  const nonparticipantEvents = nonparticipant.flow.chain.pipeline.events.filter((event) => event.timingPoint === "conquer");
  assert.deepEqual(nonparticipantEvents.map((event) => event.object.ref.id), ["ally"]);
  assert.equal(nonparticipant.fired.filter((entry) => entry.registration.spec.at === "conquer").length, 0);
  assert.equal(nonparticipant.kernel.getObject("ally").exhausted, false, "only the participating Unit is readied");
});

test(PRODUCTION_TEST_NAMES.conquerOnce, () => {
  const constant = (value) => ({ kind: "constant", value });
  const kernel = world()
    .player("A")
    .player("B")
    .deck(Array.from({ length: 8 }, (_, index) => `A:deck:${index}`), { owner: "A" })
    .deck(Array.from({ length: 8 }, (_, index) => `B:deck:${index}`), { owner: "B" })
    .rune(Array.from({ length: 8 }, (_, index) => `A:rune:${index}`), { owner: "A" })
    .rune(Array.from({ length: 8 }, (_, index) => `B:rune:${index}`), { owner: "B" })
    .base("source", { owner: "A", controller: "A", might: 1 })
    .base("enemy", { owner: "B", controller: "B", might: 1 })
    .unit("lucian", {
      owner: "A", controller: "A", cardId: program.canonicalCardId,
      tags: ["Lucian", "Demacia", "Sentinel", "Champion"], might: 3,
      exhausted: false, location: { type: "base", player: "A" }
    })
    .build();
  const choose = (request) => {
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    if (request.type === "mode" && request.id.includes(":order:")) return request.options[0];
    throw new Error(`Unexpected production choice ${request.type} ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (saved) => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    performContract: (action) => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    testTrigger: (registration) => kernel.test(registration.spec.condition),
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose
    })
  });
  const flow = new TurnFlow({
    host,
    player: (id) => kernel.player(id),
    turnOrder: ["A", "B"],
    battlefields: [{ id: "bf1", controller: null }, { id: "bf2", controller: null }],
    victoryScore: 20
  });
  const binding = createProgramBinding({ cardPrograms: [admitted] });
  binding.attachLifecycle(flow.chain, (error) => { throw error; });
  binding.registerProgramTriggers(flow.chain, kernel.getObject("lucian"));
  const fired = [];
  const append = flow.chain.pipeline.onTrigger;
  flow.chain.pipeline.onTrigger = (snapshot) => {
    fired.push(snapshot);
    append(snapshot);
  };
  const settle = () => {
    for (let guard = 0; guard < 100; guard++) {
      if (flow.chain.items.length) { flow.pass(flow.chain.priority); continue; }
      if (flow.chain.focus) { flow.pass(flow.chain.focus); continue; }
      return;
    }
    throw new Error("TurnFlow did not settle");
  };
  const returnToBase = {
    id: "return-lucian",
    controller: "A",
    source: kernel.getObject("source"),
    kind: "activated",
    speed: "action",
    body: [{
      id: "return-lucian.move",
      op: "effect.move",
      targets: [{
        id: "return-lucian.unit",
        filter: { objectId: "lucian", zone: "board", controller: "A" },
        min: 1,
        max: 1
      }],
      args: {
        objects: constant({ target: "return-lucian.unit" }),
        to: constant({ type: "base", player: "A" })
      }
    }]
  };

  flow.start();
  settle();
  flow.move("A", kernel.ref("lucian"), "bf1");
  settle();
  assert.equal(kernel.getObject("lucian").exhausted, false, "the first real Conquer readies Lucian");
  assert.equal(kernel.player("A").score, 1);

  flow.execute(returnToBase);
  settle();
  assert.deepEqual(kernel.getObject("lucian").location, { type: "base", player: "A" });
  assert.equal(kernel.getObject("lucian").exhausted, false, "effect.move does not pay a Standard Move Exhaust cost");

  flow.move("A", kernel.ref("lucian"), "bf2");
  settle();
  const conquer = flow.chain.pipeline.events.filter((event) => event.timingPoint === "conquer");
  assert.equal(conquer.length, 2, "the second real Conquer is still an event");
  assert.deepEqual(conquer.map((event) => event.object.ref), [kernel.ref("lucian"), kernel.ref("lucian")]);
  assert.deepEqual(conquer.map((event) => event.details.battlefieldId), ["bf1", "bf2"]);
  assert.equal(fired.filter((entry) => entry.registration.spec.at === "conquer").length, 1,
    "383.3.e.1 consumes the per-turn trigger at most once");
  assert.equal(kernel.player("A").score, 2);
  assert.equal(kernel.getObject("lucian").exhausted, true,
    "the second Standard Move proves no second ready operation ran");
});

test("production golden: Weaponmaster pays the chosen equipment's named Equip cost and attaches", () => {
  const f = productionPlay({
    programs: [admitted, longSword],
    answers: { "target:weaponmaster-equipment": ["sword"] },
    build: (w) => w.player("A", { energy: 3, power: ["Fury"] }).player("B")
      .object("lucian", {
        owner: "A", controller: "A", cardId: program.canonicalCardId, types: ["unit"],
        tags: ["Lucian", "Demacia", "Sentinel", "Champion"], zone: "hand",
        energy: 3, power: null, might: 3
      })
      .object("sword", {
        owner: "A", controller: "A", cardId: LONGSWORD_ID, types: ["gear"],
        tags: ["Equipment"], zone: "board", location: { type: "base", player: "A" },
        energy: 2, power: ["Fury"], might: 2,
        keywords: longSword.abilities
          .filter((ability) => ability.kind === "keyword")
          .map(equipmentKeywords)
      })
  });
  const payments = [];
  const perform = f.kernel.perform.bind(f.kernel);
  f.kernel.perform = (action) => {
    if (action.type === "pay") payments.push(structuredClone(action.plan));
    return perform(action);
  };
  f.play("lucian");
  assert.equal(f.requests[0].id, "target:weaponmaster-equipment");
  assert.deepEqual(f.requests[0].options.map((ref) => ref.id), ["sword"]);
  assert.deepEqual(f.kernel.getObject("sword").attachedTo, f.kernel.getObject("lucian").ref);
  assert.equal(f.kernel.player("A").energy, 0, "the Unit play cost was paid; Equip has no Energy cost");
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.deepEqual(payments, [
    { finalized: true, energy: 3, power: [] },
    { finalized: true, energy: 0, power: ["Fury"] }
  ]);
  assert.equal(f.engine.pipeline.events.filter((event) => event.timingPoint === "object-attached").length, 1);
  assert.deepEqual(f.engine.items, []);
});

test("production golden: Weaponmaster reduces one original [A], then pays the remainder with any named Power", () => {
  const equip = {
    keyword: "equip", value: 2, costDomain: "rainbow",
    params: { cost: {
      kind: "activated",
      payments: [{ kind: "power", amount: { kind: "constant", value: 2 }, allowedDomains: ["any"] }]
    } }
  };
  const f = productionPlay({
    programs: [admitted],
    answers: { "target:weaponmaster-equipment": ["sword"] },
    build: (w) => w.player("A", { energy: 3, power: ["Body"] }).player("B")
      .object("lucian", {
        owner: "A", controller: "A", cardId: program.canonicalCardId, types: ["unit"],
        tags: ["Lucian", "Demacia", "Sentinel", "Champion"], zone: "hand",
        energy: 3, power: null, might: 3
      })
      .object("sword", weaponmasterEquipment(equip))
  });
  const payments = [];
  const perform = f.kernel.perform.bind(f.kernel);
  f.kernel.perform = (action) => {
    if (action.type === "pay") payments.push(structuredClone(action.plan));
    return perform(action);
  };
  f.play("lucian");
  assert.deepEqual(payments.at(-1), { finalized: true, energy: 0, power: ["Body"] },
    "two [A] minus one leaves one Power payable by Body (CR 821.1.c.3 / 135.2.e.5.a)");
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.deepEqual(f.kernel.getObject("sword").attachedTo, f.kernel.getObject("lucian").ref);
});

test("production golden: one original [A] is reduced to zero with no payment prompt", () => {
  const equip = {
    keyword: "equip", value: 1, costDomain: "rainbow",
    params: { cost: {
      kind: "activated",
      payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["any"] }]
    } }
  };
  const f = productionPlay({
    programs: [admitted],
    answers: { "target:weaponmaster-equipment": ["sword"] },
    build: (w) => w.player("A", { energy: 3 }).player("B")
      .object("lucian", {
        owner: "A", controller: "A", cardId: program.canonicalCardId, types: ["unit"],
        tags: ["Lucian", "Demacia", "Sentinel", "Champion"], zone: "hand",
        energy: 3, power: null, might: 3
      })
      .object("sword", weaponmasterEquipment(equip))
  });
  const payments = [];
  const perform = f.kernel.perform.bind(f.kernel);
  f.kernel.perform = (action) => {
    if (action.type === "pay") payments.push(structuredClone(action.plan));
    return perform(action);
  };
  f.play("lucian");
  assert.deepEqual(payments, [
    { finalized: true, energy: 3, power: [] },
    { finalized: true, energy: 0, power: [] }
  ], "the Equip cost is reduced to zero and still follows the real payment path");
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.deepEqual(f.kernel.getObject("sword").attachedTo, f.kernel.getObject("lucian").ref);
});

test(PRODUCTION_TEST_NAMES.universalPower, () => {
  const equip = {
    keyword: "equip", value: 2, costDomain: "rainbow",
    params: { cost: {
      kind: "activated",
      payments: [{ kind: "power", amount: { kind: "constant", value: 2 }, allowedDomains: ["any"] }]
    } }
  };
  const f = productionPlay({
    programs: [admitted],
    answers: { "target:weaponmaster-equipment": ["sword"] },
    build: (w) => w.player("A", { energy: 3, power: ["any"] }).player("B")
      .object("lucian", {
        owner: "A", controller: "A", cardId: program.canonicalCardId, types: ["unit"],
        tags: ["Lucian", "Demacia", "Sentinel", "Champion"], zone: "hand",
        energy: 3, power: null, might: 3
      })
      .object("sword", weaponmasterEquipment(equip))
  });
  const payments = [];
  const perform = f.kernel.perform.bind(f.kernel);
  f.kernel.perform = (action) => {
    if (action.type === "pay") payments.push(structuredClone(action.plan));
    return perform(action);
  };
  f.play("lucian");
  assert.deepEqual(payments.at(-1), {
    finalized: true, energy: 0, power: [], universalPower: 1,
    powerSources: [{ source: "any", amount: 1 }]
  });
  assert.deepEqual(f.kernel.player("A").power, [], "the Universal lot is really consumed");
  assert.deepEqual(f.kernel.getObject("sword").attachedTo, f.kernel.getObject("lucian").ref);
  assert.equal(f.engine.pipeline.events.filter((event) => event.timingPoint === "object-attached").length, 1);
  assert.deepEqual(f.engine.items, []);
});

test(PRODUCTION_TEST_NAMES.reattach, () => {
  const f = productionPlay({
    programs: [admitted, longSword],
    answers: { "target:weaponmaster-equipment": ["sword"] },
    build: (w) => w.player("A", { energy: 3, power: ["Fury"] }).player("B")
      .unit("old-host", {
        owner: "A", controller: "A", cardId: "test:old-host", types: ["unit"], tags: [],
        zone: "board", location: { type: "base", player: "A" }, energy: null, power: null, might: 2
      })
      .object("lucian", {
        owner: "A", controller: "A", cardId: program.canonicalCardId, types: ["unit"],
        tags: ["Lucian", "Demacia", "Sentinel", "Champion"], zone: "hand",
        energy: 3, power: null, might: 3
      })
      .object("sword", {
        owner: "A", controller: "A", cardId: LONGSWORD_ID, types: ["gear"],
        tags: ["Equipment"], zone: "board", location: { type: "base", player: "A" },
        energy: 2, power: ["Fury"], might: 2,
        keywords: longSword.abilities.filter((ability) => ability.kind === "keyword").map(equipmentKeywords)
      })
  });
  assert.equal(f.kernel.perform({
    type: "attach", object: f.kernel.ref("sword"), host: f.kernel.ref("old-host")
  }).status, "done");
  assert.deepEqual(f.kernel.getObject("sword").attachedTo, f.kernel.ref("old-host"));

  f.play("lucian");
  assert.deepEqual(f.kernel.getObject("sword").ref, f.kernel.ref("sword"), "reattachment preserves the Equipment incarnation");
  assert.deepEqual(f.kernel.getObject("sword").attachedTo, f.kernel.getObject("lucian").ref);
  assert.notDeepEqual(f.kernel.getObject("sword").attachedTo, f.kernel.ref("old-host"));
  assert.equal(f.might("lucian"), 5, "the live Equipment layer follows the new attachment");
  assert.equal(
    f.engine.pipeline.events.filter((event) =>
      event.timingPoint === "object-attached" && event.object.ref.id === "sword").length,
    1
  );
});

test(PRODUCTION_TEST_NAMES.resolveCost, () => {
  const f = productionPlay({
    programs: [admitted, longSword],
    answers: { "target:weaponmaster-equipment": ["sword"] },
    build: (w) => w.player("A", { energy: 3, power: ["Fury"] }).player("B")
      .object("lucian", {
        owner: "A", controller: "A", cardId: program.canonicalCardId, types: ["unit"],
        tags: ["Lucian", "Demacia", "Sentinel", "Champion"], zone: "hand",
        energy: 3, power: null, might: 3
      })
      .object("sword", {
        owner: "A", controller: "A", cardId: LONGSWORD_ID, types: ["gear"],
        tags: ["Equipment"], zone: "board", location: { type: "base", player: "A" },
        energy: 2, power: ["Fury"], might: 2,
        keywords: longSword.abilities.filter((ability) => ability.kind === "keyword").map(equipmentKeywords)
      })
  });
  const timing = [];
  const perform = f.kernel.perform.bind(f.kernel);
  f.kernel.perform = (action) => {
    if (action.type === "pay") timing.push({
      plan: structuredClone(action.plan),
      trace: f.engine.trace.slice(),
      attachedBeforePayment: f.kernel.getObject("sword").attachedTo
    });
    return perform(action);
  };
  f.play("lucian");
  const equipPayment = timing.at(-1);
  assert.deepEqual(equipPayment.plan, { finalized: true, energy: 0, power: ["Fury"] });
  const lastResolveStart = equipPayment.trace.findLastIndex((entry) => entry.step === "resolve-start");
  assert.ok(lastResolveStart >= 0, "CR 204.3.a pays the Cost within Instructions during Resolve");
  assert.deepEqual(equipPayment.trace.at(-1), { step: "resolve-start", item: "trigger:1" });
  assert.equal(equipPayment.attachedBeforePayment, null, "attachment has not happened when the cost is paid");
  assert.deepEqual(f.kernel.getObject("sword").attachedTo, f.kernel.getObject("lucian").ref,
    "the real implementation still performs the successful mutation atomically");
});

test("production boundary: no selected Equipment skips payment and attachment", () => {
  const equip = {
    keyword: "equip", value: 1, costDomain: "Fury",
    params: { cost: {
      kind: "activated",
      payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Fury"] }]
    } }
  };
  const declined = productionPlay({
    programs: [admitted],
    answers: { "target:weaponmaster-equipment": [] },
    build: (w) => w.player("A", { energy: 3, power: ["Fury"] }).player("B")
      .object("lucian", {
        owner: "A", controller: "A", cardId: program.canonicalCardId, types: ["unit"],
        tags: ["Lucian", "Demacia", "Sentinel", "Champion"], zone: "hand",
        energy: 3, power: null, might: 3
      })
      .object("sword", weaponmasterEquipment(equip))
  });
  declined.play("lucian");
  assert.equal(declined.kernel.player("A").energy, 0);
  assert.deepEqual(declined.kernel.player("A").power, ["Fury"], "declining Weaponmaster pays no Equip cost");
  assert.equal(declined.kernel.getObject("lucian").zone, "board");
  assert.equal(declined.kernel.getObject("sword").attachedTo, null);
  assert.deepEqual(declined.targetRequests().map((request) => [request.id, request.options]), [
    ["target:weaponmaster-equipment", [declined.kernel.ref("sword")]]
  ]);
  assert.equal(declined.engine.pipeline.events.some((event) => event.timingPoint === "object-attached"), false);
});

test(PRODUCTION_TEST_NAMES.unpayableEquipBlocker, () => {
  const equip = {
    keyword: "equip", value: 1, costDomain: "Fury",
    params: { cost: {
      kind: "activated",
      payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Fury"] }]
    } }
  };
  const payable = productionPlay({
    programs: [admitted],
    answers: { "target:weaponmaster-equipment": ["sword"] },
    build: (w) => w.player("A", { energy: 3 }).player("B")
      .object("lucian", {
        owner: "A", controller: "A", cardId: program.canonicalCardId, types: ["unit"],
        tags: ["Lucian", "Demacia", "Sentinel", "Champion"], zone: "hand",
        energy: 3, power: null, might: 3
      })
      .object("sword", weaponmasterEquipment(equip))
  });
  let triggerResolveStarted = false;
  const resolve = payable.engine.resolve;
  payable.engine.resolve = function (item) {
    if (item.id === "trigger:1") triggerResolveStarted = true;
    return resolve.call(this, item);
  };
  assert.throws(() => payable.play("lucian"), /insufficient matching Power/);
  assert.equal(triggerResolveStarted, true,
    "the unpayable selected Equip cost is reached only after the trigger Resolve begins");
  assert.equal(payable.kernel.player("A").energy, 0, "the successful Unit play remains paid");
  assert.equal(payable.kernel.getObject("sword").attachedTo, null);
  assert.equal(payable.engine.pipeline.events.some((event) => event.timingPoint === "object-attached"), false);
});

test(PRODUCTION_TEST_NAMES.noEquipCostBlocker, () => {
  const f = productionPlay({
    programs: [admitted],
    answers: { "target:weaponmaster-equipment": ["sword"] },
    build: (w) => w.player("A", { energy: 3, power: ["Fury"] }).player("B")
      .object("lucian", {
        owner: "A", controller: "A", cardId: program.canonicalCardId, types: ["unit"],
        tags: ["Lucian", "Demacia", "Sentinel", "Champion"], zone: "hand",
        energy: 3, power: null, might: 3
      })
      .object("sword", {
        owner: "A", controller: "A", cardId: "test:no-equip-cost", types: ["gear"],
        tags: ["Equipment"], zone: "board", location: { type: "base", player: "A" },
        energy: null, power: null, might: null,
        keywords: []
      })
  });
  assert.throws(
    () => f.play("lucian"),
    /821\.1\.c\.2: missing authoritative Equip-cost binding for sword/
  );
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, ["Fury"], "missing Equip cost never becomes a free attachment");
  assert.equal(f.kernel.getObject("sword").attachedTo, null);
  assert.equal(f.engine.pipeline.events.some((event) => event.timingPoint === "object-attached"), false);
});
