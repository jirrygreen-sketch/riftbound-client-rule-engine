import assert from "node:assert/strict";
import test from "node:test";

import program from "../../../dist/cards/sfd/laurent-duelist.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { validateCardProgram } from "../../../dist/ir/validation.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { CombatFlow } from "../../../../engine-core/dist/combat/flow.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { TurnFlow } from "../../../../engine-core/dist/turn/flow.js";
import { productionPlay } from "../../fixtures/production-play.mjs";

const CARD_ID = "card.hash-7cbc2a92adfe5cf5c7126a8d72869cf933d006002fe1f46b4804c2040a51c9c6";
const SOURCE_TEXT = "[Assault 2] (+2 :rb_might: while I'm an attacker.)";
const CORE_URL =
  "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf";
const RADIANCE_URL =
  "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/";
const SFD_ERRATA_URL =
  "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/";
const BATTLEFIELD = Object.freeze({ type: "battlefield", id: "bf1" });

const PRODUCTION_TEST_NAMES = Object.freeze({
  playCost: "sfd-156-221 Laurent Duelist productionPlay: 4 Energy is paid with no Power",
  turnFlow: "sfd-156-221 Laurent Duelist production boundary: a real TurnFlow Play opens Laurent's Combat Showdown",
  golden: "sfd-156-221 Laurent Duelist production golden: Play, attacker damage, Cleanup and combat-end",
  defender: "sfd-156-221 Laurent Duelist production boundary: Assault is absent while defending"
});

// Official source and timeline: the file's pinned Core Rules v1.5 URL
// (published 2026-10-09) plus the Radiance patch (effective 2026-10-16).
// For canonical id card.hash-7cbc2a92adfe5cf5c7126a8d72869cf933d006002fe1f46b4804c2040a51c9c6,
// CR 807.1.b-.d grants Assault 2 only while this Unit is an Attacker.  The
// real TurnFlow/CombatFlow tests below cover Play/Finalize, designation,
// Priority, damage at current Might, combat-end expiry, and absence while
// Defending.  The static layer uses live characteristics; no LKI is needed.

// Official sources are the repository's pinned snapshots. The effective
// Radiance patch and the Spiritforged errata contain no Laurent Duelist or
// Assault entry. The card supplies no local exception to the general rules.
const OFFICIAL_EVIDENCE = Object.freeze({
  contract: "riftbound.official-effect-order-evidence.v1",
  canonicalCardId: CARD_ID,
  sources: Object.freeze({
    coreRules: Object.freeze({
      version: "1.5",
      dated: "2026-10-09",
      url: CORE_URL,
      localSha256: "bbc81327eb21242452db3c56348b0725b1e0b6186c1a682dde541f3c7a864ba2"
    }),
    radianceRulings: Object.freeze({
      published: "2026-10-09",
      effective: "2026-10-16",
      url: RADIANCE_URL,
      applicableToThisCard: false,
      result: "reviewed: no Laurent Duelist entry or correction; its Disarm note only recalls ordinary Assault stacking"
    }),
    spiritforgedErrata: Object.freeze({
      published: "2026-01-14",
      effective: null,
      url: SFD_ERRATA_URL,
      applicableToThisCard: false,
      result: "reviewed: no Laurent Duelist or Assault correction"
    })
  }),
  interaction: Object.freeze({
    id: "printed-assault-two",
    canonicalCardId: CARD_ID,
    clauses: Object.freeze([
      "[Assault 2]",
      "(+2 :rb_might: while I'm an attacker.)"
    ]),
    reviewedRules: Object.freeze({
      cardTextControl: "CR 002 and 051 supply no exception here: the literal keyword and its 807.1.c functional text agree.",
      simultaneousEffects: "CR 303.2.a has no ordering decision because Laurent has no triggered abilities and this Play adds one item.",
      prohibitionPermission: "CR 054.1 has no branch because Assault forbids nothing and grants no competing action permission."
    }),
    ruleRefs: Object.freeze([
      "143.4", "303.2.a", "337.1.b", "338.1", "340.1", "350", "354", "355.2",
      "466.2.c.1", "466.2.c.2", "466.2.c.3", "467.2", "468.7.a",
      "478.2", "478.4", "479.4.e.1", "807.1.c", "807.1.d", "807.1.d.1"
    ]),
    priorityFocus:
      "The normal-speed Play occurs under the controller's ordinary Main-phase Priority. A Combat Showdown gives the Attacker Focus at CR 466.2.c.1; Assault is passive and creates neither Focus nor Priority.",
    responseWindow:
      "After Laurent is Finalized, players may add legally timed Reactions under CR 338.1 before A then B pass and the newest finalized item resolves under CR 340.1. Laurent has no activated ability or optional additional cost.",
    costsAndChoices:
      "At Play/Pending the card uses its printed 4 Energy and no Power; no additional or alternative cost exists. Finalize has no target or mode choice, pays the cost atomically, and places the Unit on the Board.",
    replacement:
      "Laurent has no replacement or prevention effect, so CR 054.1 and replacement ordering have no card-specific branch.",
    layers:
      "Assault is a CR 807.1.c passive ability expanded to one arithmetic +2 Might effect gated by the exact Attacker designation. CR 478.2/478.4 applies it once; the damage plan consumes current Might under CR 467.2.",
    lki:
      "The static continuously reads the live incarnation and Combat designation. CR 468.7.a removes the designation at combat end; no left-zone characteristic is cached.",
    simultaneousTriggers:
      "Laurent has no triggered ability. CombatFlow emits the designation wave as attack-declared and defense-declared, but no trigger ordering is created by this card.",
    timeline: Object.freeze([
      "Play/Pending: move the card to Chain, then Finalize with the printed 4 Energy and no Power.",
      "Finalize performs no optional or target choice and atomically records the payment receipt.",
      "Resolve moves the Unit to the selected legal Battlefield exhausted and the lifecycle binds Assault 2 from that Board incarnation.",
      "Combat opens: CR 466.2.c.3 gives Laurent the Attacker designation; the layer evaluates printed Might 3 + Assault 2 = 5 once.",
    "The same production scene is also reached by playing Laurent through TurnFlow's real Main Phase into the uncontested opponent Battlefield; TurnFlow opens the Combat Showdown without an injected role.",
      "After the Attacker and Defender pass the Showdown, CR 467.2 uses current Might 5 and 4 for the two damage budgets.",
      "Special Cleanup recalls the survivable Attacker; CR 468.7.a ends Combat, removes the designation, and the static stops applying."
    ]),
    productionTestNames: Object.freeze([
      PRODUCTION_TEST_NAMES.playCost,
      PRODUCTION_TEST_NAMES.turnFlow,
      PRODUCTION_TEST_NAMES.golden,
      PRODUCTION_TEST_NAMES.defender
    ])
  })
});

const snapshot = (combatRole = null) => ({
  ref: { id: "duelist", zoneEntryId: 1 },
  cardId: CARD_ID,
  name: "Laurent Duelist",
  types: ["unit"],
  tags: ["Demacia"],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "board",
  location: BATTLEFIELD,
  combatRole,
  might: 3,
  energy: 4,
  power: null,
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false
});

function settleChain(chain, budget = 40) {
  for (let guard = 0; guard < budget && chain.items.length > 0; guard++) {
    assert.notEqual(chain.priority, null, "a Pending/Finalized Chain item has a controller with Priority");
    chain.pass(chain.priority);
  }
  assert.equal(chain.items.length, 0, "the production Chain must settle");
}

function actionHost(kernel, choose) {
  return createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (saved) => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    performContract: (action) => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
}

function productionTable({ laurentController = "A", turnPlayer = "A" } = {}) {
  const otherController = laurentController === "A" ? "B" : "A";
  const builder = world()
    .player("A", { energy: laurentController === "A" ? 4 : 0 })
    .player("B", { energy: laurentController === "B" ? 4 : 0 })
    .object("laurent", {
      owner: laurentController,
      controller: laurentController,
      cardId: CARD_ID,
      name: "Laurent Duelist",
      types: ["unit"],
      tags: ["Demacia"],
      keywords: [],
      zone: "hand",
      location: null,
      energy: 4,
      power: null,
      might: 3
    })
    .unit("other", {
      owner: otherController,
      controller: otherController,
      cardId: "plain:other",
      name: "Other Unit",
      types: ["unit"],
      tags: [],
      keywords: [],
      might: 4,
      energy: null,
      power: null,
      location: BATTLEFIELD
    });
  const kernel = builder.build();
  const requests = [];
  const choose = (request) => {
    requests.push(request);
    if (request.type === "mode" && request.id.startsWith("engagement:")) return request.options[0];
    if (request.type === "order") return [request.options[0]];
    if (request.type === "select-objects" && request.min === request.max &&
        request.options.length === request.min) return [...request.options];
    throw new AwaitChoice(request);
  };
  const host = actionHost(kernel, choose);
  const binding = createProgramBinding({ cardPrograms: [program] });
  const chain = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer,
    phase: "main",
    host,
    cleanup: () => false,
    describePlay: binding.describePlay
  });
  const lifecycleErrors = [];
  const lifecycle = binding.attachLifecycle(chain, (error) => lifecycleErrors.push(error));
  const combat = new CombatFlow(chain, host,
    [
      { id: "bf1", controller: laurentController === "A" ? "B" : laurentController },
      { id: "bf2", controller: null }
    ],
    () => {}, { events: true, lifecycle: true });

  const playLaurent = () => {
    const source = kernel.getObject("laurent");
    const draft = binding.describePlay({
      type: "play", object: source.ref, player: laurentController, location: BATTLEFIELD
    }, source);
    chain.execute(draft);
    settleChain(chain);
    return draft;
  };
  const closeShowdown = () => {
    assert.notEqual(chain.focus, null);
    chain.pass(chain.focus);
    assert.notEqual(chain.focus, null);
    chain.pass(chain.focus);
    assert.equal(chain.turnState, "neutral-open");
  };
  const layerMight = (id = "laurent") => {
    chain.layers.setObjects(chain.hostObjects());
    return chain.layers.snapshot(kernel.ref(id))?.might;
  };
  return {
    kernel, binding, chain, combat, lifecycle, lifecycleErrors, requests, playLaurent,
    closeShowdown, layerMight
  };
}

function productionTurnFlow() {
  const builder = world()
    .player("A")
    .player("B")
    .hand("laurent", {
      owner: "A",
      controller: "A",
      cardId: CARD_ID,
      name: "Laurent Duelist",
      types: ["unit"],
      tags: ["Demacia"],
      keywords: [],
      energy: 4,
      power: null,
      might: 3
    })
    .unit("other", {
      owner: "B",
      controller: "B",
      cardId: "plain:other",
      name: "Other Unit",
      types: ["unit"],
      might: 4,
      energy: null,
      power: null,
      location: BATTLEFIELD
    });
  for (const player of ["A", "B"]) {
    builder.deck(Array.from({ length: 8 }, (_, index) => `${player}:deck:${index}`), { owner: player });
    builder.rune(Array.from({ length: 8 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  const kernel = builder.build();
  const requests = [];
  const choose = (request) => {
    requests.push(request);
    if (request.type === "mode" && request.id.startsWith("engagement:")) return request.options[0];
    if (request.type === "order") return [request.options[0]];
    if (request.type === "select-objects" && request.min === request.max &&
        request.options.length === request.min) return [...request.options];
    throw new AwaitChoice(request);
  };
  const host = actionHost(kernel, choose);
  const binding = createProgramBinding({ cardPrograms: [program] });
  const flow = new TurnFlow({
    host,
    player: (id) => kernel.player(id),
    turnOrder: ["A", "B"],
    battlefields: [{ id: "bf1", controller: "B" }, { id: "bf2", controller: null }],
    describePlay: binding.describePlay,
    victoryScore: 20
  });
  const lifecycleErrors = [];
  const lifecycle = binding.attachLifecycle(flow.chain, (error) => lifecycleErrors.push(error));
  flow.start();
  return { kernel, binding, flow, lifecycle, lifecycleErrors, requests };
}

test("sfd-156-221 Laurent Duelist: program validates and is registered executable", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(Object.hasOwn(program, "judgeReason"), false);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-156-221 Laurent Duelist: exactly one printed Assault 2 declaration", () => {
  assert.equal(program.abilities.length, 1);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "assault", value: 2 });
  const inspected = createProgramBinding({ cardPrograms: [program] }).inspect(snapshot());
  const statics = inspected.abilities.filter((ability) => ability.kind === "static");
  assert.equal(statics.length, 1);
  assert.deepEqual(statics[0].effect, {
    kind: "continuous.might",
    mode: "add",
    layer: "arithmetic",
    appliesTo: "self",
    amount: { kind: "constant", value: 2 }
  });
  assert.deepEqual(statics[0].condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "designation" },
    operator: "eq",
    right: { kind: "constant", value: "attacker" }
  });
});

test("sfd-156-221 Laurent Duelist: official evidence is pinned and linked to production tests", () => {
  assert.deepEqual(OFFICIAL_EVIDENCE.sources.coreRules, {
    version: "1.5",
    dated: "2026-10-09",
    url: CORE_URL,
    localSha256: "bbc81327eb21242452db3c56348b0725b1e0b6186c1a682dde541f3c7a864ba2"
  });
  assert.equal(OFFICIAL_EVIDENCE.sources.radianceRulings.published, "2026-10-09");
  assert.equal(OFFICIAL_EVIDENCE.sources.radianceRulings.effective, "2026-10-16");
  assert.equal(OFFICIAL_EVIDENCE.sources.radianceRulings.applicableToThisCard, false);
  assert.equal(OFFICIAL_EVIDENCE.sources.spiritforgedErrata.applicableToThisCard, false);
  assert.equal(OFFICIAL_EVIDENCE.interaction.canonicalCardId, program.canonicalCardId);
  assert.deepEqual(OFFICIAL_EVIDENCE.interaction.productionTestNames, Object.values(PRODUCTION_TEST_NAMES));
  for (const rule of [
    "337.1.b", "338.1", "340.1", "466.2.c.3", "467.2", "468.7.a",
    "478.2", "478.4", "807.1.c", "807.1.d.1"
  ]) {
    assert.ok(OFFICIAL_EVIDENCE.interaction.ruleRefs.includes(rule), `${rule} is associated with this card`);
  }
  assert.ok(OFFICIAL_EVIDENCE.interaction.timeline.length >= 6);
});

test(PRODUCTION_TEST_NAMES.playCost, () => {
  const f = productionPlay({
    programs: [program],
    build: (builder) => builder
      .player("A", { energy: 4, power: [] })
      .player("B")
      .object("laurent", {
        owner: "A", controller: "A", cardId: CARD_ID, name: "Laurent Duelist",
        types: ["unit"], tags: ["Demacia"], zone: "hand",
        energy: 4, power: null, might: 3
      })
      .unit("other", {
        owner: "B", controller: "B", types: ["unit"], might: 4,
        energy: null, power: null, location: BATTLEFIELD
      })
  });
  const source = f.kernel.getObject("laurent");
  const draft = f.binding.describePlay({
    type: "play", object: source.ref, player: "A", location: BATTLEFIELD
  }, source);
  assert.equal(draft.kind, "unit");
  assert.equal(draft.speed, "normal");
  f.engine.execute(draft);
  f.settle();

  const entered = f.kernel.getObject("laurent");
  assert.equal(entered.zone, "board");
  assert.deepEqual(entered.location, BATTLEFIELD);
  assert.equal(entered.exhausted, true, "CR 143.4 makes the Unit enter exhausted");
  assert.equal(entered.power, null, "the catalog's null Power remains no printed Power");
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.deepEqual(f.requests, []);
  const timings = f.engine.pipeline.events.map((event) => event.timingPoint);
  const pending = timings.indexOf("chain-item-pending");
  const finalize = timings.indexOf("chain-item-finalize", pending);
  const board = timings.indexOf("object-enters-board", finalize);
  const played = timings.indexOf("card-played", board);
  const resolve = timings.indexOf("chain-item-resolve", played);
  assert.ok(pending >= 0 && pending < finalize && finalize < board && board < played && played < resolve);
  assert.equal(f.engine.pipeline.events.filter((event) =>
    event.timingPoint === "object-enters-board" && event.object?.ref.id === "laurent").length, 1);
  assert.deepEqual(f.engine.items, []);
});

test(PRODUCTION_TEST_NAMES.turnFlow, () => {
  const f = productionTurnFlow();
  try {
    assert.equal(f.flow.phase, "main");
    assert.equal(f.flow.chain.turnState, "neutral-open");
    assert.equal(f.flow.chain.priority, "A");
    f.flow.chain.commit({ type: "gain-energy", player: "A", amount: 4 });
    const source = f.kernel.getObject("laurent");
    const draft = f.binding.describePlay({
      type: "play",
      object: source.ref,
      player: "A",
      location: BATTLEFIELD
    }, source);
    f.flow.execute(draft);

    const laurent = f.kernel.getObject("laurent");
    assert.equal(laurent.zone, "board");
    assert.deepEqual(laurent.location, BATTLEFIELD);
    assert.equal(f.kernel.player("A").energy, 0);
    assert.equal(f.flow.chain.items.length, 0);
    assert.equal(f.flow.combat.active, true);
    assert.equal(f.flow.combat.current?.step, "showdown");
    assert.equal(f.flow.combat.current?.attacker, "A");
    assert.equal(f.flow.combat.current?.defender, "B");
    assert.equal(f.flow.combat.snapshot(laurent).combatRole, "attacker");
    assert.equal(f.flow.chain.focus, "A");
    assert.deepEqual(f.requests, []);
    assert.deepEqual(f.lifecycleErrors, []);

    f.flow.chain.layers.setObjects(f.flow.chain.hostObjects());
    assert.equal(f.flow.chain.layers.snapshot(laurent.ref)?.might, 5);
    f.flow.chain.pass(f.flow.chain.focus);
    assert.equal(f.flow.chain.focus, "B");
    f.flow.chain.pass(f.flow.chain.focus);
    const plan = f.flow.combat.prepareDamage();
    assert.equal(plan.attacker.budget, 5);
    assert.equal(plan.defender.budget, 4);
    assert.deepEqual(f.flow.combat.damageView(), {
      combatId: "combat:bf1:1",
      battlefieldId: "bf1",
      attackerPlayerId: "A",
      defenderPlayerId: "B",
      attackerMight: 5,
      defenderMight: 4,
      attackerSubmitted: false
    });
  } finally {
    f.lifecycle.detach();
  }
});

test(PRODUCTION_TEST_NAMES.golden, () => {
  const f = productionTable();
  try {
    assert.equal(f.layerMight(), 3, "printed Might outside Combat");
    f.playLaurent();
    const laurent = f.kernel.getObject("laurent");
    assert.equal(laurent.zone, "board");
    assert.deepEqual(laurent.location, BATTLEFIELD);
    assert.equal(laurent.exhausted, true);
    assert.equal(f.kernel.player("A").energy, 0);
    assert.deepEqual(f.kernel.player("A").power, []);
    assert.deepEqual(f.requests, []);
    assert.deepEqual(f.lifecycleErrors, []);
    assert.equal(f.layerMight(), 3, "Assault is inactive before the Attacker designation");

    assert.deepEqual(f.combat.entered(laurent), [{
      timingPoint: "contested-applied",
      player: "A",
      object: laurent,
      details: { battlefieldId: "bf1" }
    }]);
    assert.equal(f.combat.cleanup(), true);
    f.chain.advance();
    assert.deepEqual(f.combat.startCombat("bf1"), {
      field: "bf1", combatId: "combat:bf1:1", attacker: "A", defender: "B", focus: "A"
    });
    assert.equal(f.combat.snapshot(laurent).combatRole, "attacker");
    assert.equal(f.chain.focus, "A");
    assert.equal(f.chain.priority, "A");
    assert.equal(f.layerMight(), 5);
    assert.equal(f.kernel.getObject("laurent").combatRole, null,
      "CombatFlow projects the designation without mutating the host snapshot");
    assert.deepEqual(
      f.chain.pipeline.events.filter((event) =>
        ["combat-start", "attack-declared", "defense-declared"].includes(event.timingPoint)
      ).map((event) => event.timingPoint),
      ["combat-start", "attack-declared", "defense-declared"]
    );

    f.closeShowdown();
    const plan = f.combat.prepareDamage();
    const view = f.combat.damageView();
    assert.equal(plan.attacker.budget, 5, "CR 467.2 uses current Might once");
    assert.equal(plan.defender.budget, 4);
    assert.equal(plan.defender.targets.find((target) => target.uid === "laurent")?.currentMight, 5);
    assert.deepEqual(view, {
      combatId: "combat:bf1:1",
      battlefieldId: "bf1",
      attackerPlayerId: "A",
      defenderPlayerId: "B",
      attackerMight: 5,
      defenderMight: 4,
      attackerSubmitted: false
    });

    f.combat.submitAttackerDamage("A", [{ uid: "other", amount: view.attackerMight }]);
    const result = f.combat.submitDefenderDamage("B", [{ uid: "laurent", amount: view.defenderMight }]);
    assert.equal(result.batchId, "combat:bf1:1:damage");
    assert.equal(f.kernel.getObject("laurent").damage, 4);
    assert.equal(f.kernel.getObject("other").damage, 5);
    const damageEvents = f.chain.pipeline.events.filter((event) => event.timingPoint === "damage-dealt");
    assert.deepEqual(damageEvents.map((event) => [event.source.ref.id, event.object.ref.id, event.amount]), [
      ["laurent", "other", 5],
      ["other", "laurent", 4]
    ]);

    for (let guard = 0; guard < 8 && f.combat.active; guard++) f.combat.advance();
    assert.equal(f.combat.active, false);
    assert.equal(f.chain.pipeline.events.filter((event) => event.timingPoint === "combat-end").length, 1);
    const after = f.kernel.getObject("laurent");
    assert.deepEqual(after.location, { type: "base", player: "A" });
    assert.equal(after.damage, 0, "Combat Special Cleanup heals the surviving Attacker");
    assert.equal(f.combat.snapshot(after).combatRole, null);
    assert.equal(f.layerMight(), 3, "CR 468.7.a removes the Attacker designation and the bonus");
  } finally {
    f.lifecycle.detach();
  }
});

test(PRODUCTION_TEST_NAMES.defender, () => {
  const f = productionTable({ laurentController: "B", turnPlayer: "B" });
  try {
    f.playLaurent();
    const laurent = f.kernel.getObject("laurent");
    const other = f.kernel.getObject("other");
    assert.deepEqual(laurent.location, BATTLEFIELD);
    assert.equal(f.kernel.player("B").energy, 0);
    assert.deepEqual(f.lifecycleErrors, []);
    assert.equal(f.layerMight(), 3);
    assert.equal(f.combat.entered(other).length, 1);
    assert.equal(f.combat.cleanup(), true);
    f.chain.advance();
    assert.deepEqual(f.combat.startCombat("bf1"), {
      field: "bf1", combatId: "combat:bf1:1", attacker: "A", defender: "B", focus: "A"
    });
    assert.equal(f.combat.snapshot(laurent).combatRole, "defender");
    assert.equal(f.combat.snapshot(other).combatRole, "attacker");
    assert.equal(f.layerMight(), 3, "Assault ignores the Defender designation");
    f.closeShowdown();
    const plan = f.combat.prepareDamage();
    assert.equal(plan.attacker.budget, 4);
    assert.equal(plan.defender.budget, 3);
    assert.deepEqual(f.requests, []);
    assert.deepEqual(f.lifecycleErrors, []);
  } finally {
    f.lifecycle.detach();
  }
});
