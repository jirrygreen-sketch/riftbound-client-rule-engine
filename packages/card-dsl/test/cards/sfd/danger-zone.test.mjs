// Template evidence: ../templates/keyword-play-continuous-might-653.test.mjs.
// The real program, ProgramBinding, ChainEngine/Finalize and TurnFlow consume
// the card. Both printed cost choices, the Reaction window, repeated Resolve,
// end-of-turn expiry and atomic payment failure are covered below.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import dangerZone from "../../../dist/cards/sfd/danger-zone.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import {
  executeBasicRuneResourcePlan,
  planBasicRuneResourceActivation
} from "../../../../engine-core/dist/runes/index.js";
import { TurnFlow } from "../../../../engine-core/dist/turn/flow.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { productionPlay } from "../../fixtures/production-play.mjs";

const CARD_ID = "card.hash-3c1c01b405853556e3e1c12bbd758e94d73f5ed474a5643bb068eaa7cb549c6e";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "[Repeat] :rb_energy_1::rb_rune_rainbow: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Give your Mechs +1 :rb_might: this turn.";
const RULES_URL = "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf";
const RADIANCE_URL = "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/";
const SFD_ERRATA_URL = "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/";

const evidence = {
  rules: { version: "1.5", dated: "2026-10-09", effective: "2026-10-16", url: RULES_URL },
  radiance: { effective: "2026-10-16", url: RADIANCE_URL },
  sfdErrata: { checked: true, applicableTo: "Danger Zone", url: SFD_ERRATA_URL, change: false }
};

function assertEvidence(rules, timeline) {
  assert.deepEqual(evidence.rules, {
    version: "1.5", dated: "2026-10-09", effective: "2026-10-16", url: RULES_URL
  });
  assert.deepEqual(evidence.radiance, { effective: "2026-10-16", url: RADIANCE_URL });
  assert.deepEqual(evidence.sfdErrata, {
    checked: true, applicableTo: "Danger Zone", url: SFD_ERRATA_URL, change: false
  });
  assert.equal(CARD_ID, dangerZone.canonicalCardId);
  assert.ok(rules.length > 0);
  assert.deepEqual(timeline, [
    "Play", "Make relevant choices", "Finalize", "Pay Costs",
    "Pending Reactions", "Resolve", "Move to Trash", "Ending cleanup"
  ]);
}

const speed = dangerZone.abilities.find(ability => ability.keyword === "reaction");
const play = dangerZone.abilities.find(ability => ability.kind === "play");
const buff = play.body[0];

/** The resolving effect's own registrations, shaped for the real layer engine. */
const registrations = (kernel) =>
  kernel.continuousEffects.map((entry) => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 }));

const effectiveMight = (kernel, id) =>
  createLayerEngine(kernel.objects, registrations(kernel)).evaluate(kernel.ref(id)).might;

/**
 * The reference kernel compares filter values literally, while the card layer
 * spells "your Mechs" as controller: "self" and the chain's query path
 * (chain/engine.ts) normalizes self/opponent against the ability controller.
 * Reproduce that normalization so the card's own query shape executes (same
 * convention as the merged sfd/on-the-hunt golden).
 */
function chainKernel(kernel, controller = "A") {
  return new Proxy(kernel, {
    get(target, key) {
      if (key === "query") {
        return (filter) => {
          const normalized = { ...filter };
          const kernelFilter = { ...normalized };
          const opponents = [];
          for (const playerKey of ["controller", "owner"]) {
            if (normalized[playerKey] === "self") kernelFilter[playerKey] = controller;
            else if (normalized[playerKey] === "opponent") {
              delete kernelFilter[playerKey];
              opponents.push(playerKey);
            }
          }
          return target
            .query(kernelFilter)
            .filter((object) => opponents.every((playerKey) => object[playerKey] !== controller));
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

test("sfd-182-221 Danger Zone: program is structurally valid and executable", () => {
  const result = validateCardProgram(dangerZone);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(dangerZone.canonicalCardId, CARD_ID);
  assert.equal(dangerZone.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(dangerZone.status, "executable");
  assert.equal(dangerZone.judgeReason, undefined);
  assert.equal(dangerZone.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), dangerZone);
});

test("sfd-182-221 Danger Zone: the merged keyword contracts remain available", () => {
  assert.equal(keywordDefinitionsById.has("Repeat"), true);
  assert.equal(keywordDefinitionsById.has("Reaction"), true);
});

test("sfd-182-221 Danger Zone ability structure: [Reaction] + play with Repeat additional cost", () => {
  assert.equal(dangerZone.abilities.length, 3);

  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });
  assert.deepEqual(dangerZone.abilities[1], { kind: "keyword", keyword: "repeat" });
  assert.equal(play.kind, "play");

  // [Repeat] 1 energy + 1 rainbow rune: the Play CostSpec is the card's only
  // parameter-bearing Repeat declaration; the binder normalizes it into a
  // real Finalize component.
  assert.equal(play.cost.kind, "additional-cost");
  assert.equal(play.cost.keyword, "repeat");
  assert.equal(play.cost.optional, true);
  assert.deepEqual(play.cost.energy, { kind: "literal", value: 1 });
  assert.deepEqual(play.cost.power, { kind: "literal", value: ["rainbow"] });

  // "Give your Mechs +1 Might this turn" is an each-set, NOT a target
  // (v1.5 355.7 / 355.10.d), so the instruction carries no TargetSpec.
  assert.equal(play.body.length, 1);
  assert.equal(buff.id, "buff-mechs");
  assert.equal(buff.op, "continuous.might");
  assert.equal(instructionDefinitionsById.has("continuous.might"), true);
  assert.equal(buff.targets, undefined);
  assert.equal(buff.picks, undefined);
  assert.deepEqual(buff.args.amount, { kind: "literal", value: 1 });
  assert.deepEqual(buff.args.duration, { kind: "literal", value: "this-turn" });
  assert.deepEqual(buff.args.objects, {
    kind: "literal",
    value: {
      kind: "query",
      filter: { type: "unit", tags: ["Mech"], controller: "self", zone: "board" }
    }
  });
});

test("sfd-182-221 Danger Zone golden: each friendly Mech gets +1 Might this turn", () => {
  const kernel = world()
    .unit("mech-a", { owner: "A", controller: "A", tags: ["Mech"], might: 2 })
    .unit("mech-b", { owner: "A", controller: "A", tags: ["Mech"], might: 4 })
    .unit("enemy-mech", { owner: "B", controller: "B", tags: ["Mech"], might: 2 })
    .unit("grunt", { owner: "A", controller: "A", might: 2 })
    .build();

  const outcome = resolveChainBody(play.body, chainKernel(kernel));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["buff-mechs", "executed"]
  ]);
  // One arithmetic-layer registration per friendly Mech (355.10.d set), with
  // the end-of-turn duration; the enemy Mech and the non-Mech are untouched.
  assert.equal(kernel.continuousEffects.length, 2);
  assert.deepEqual(
    kernel.continuousEffects.map((entry) => entry.effect.filter.objectId).sort(),
    ["mech-a", "mech-b"]
  );
  for (const entry of kernel.continuousEffects) {
    assert.equal(entry.effect.layer, "arithmetic");
    assert.equal(entry.effect.effect.kind, "continuous.might");
    assert.equal(entry.effect.effect.amount, 1);
    assert.deepEqual(entry.duration, { type: "end-of-turn" });
  }
  assert.equal(effectiveMight(kernel, "mech-a"), 3);
  assert.equal(effectiveMight(kernel, "mech-b"), 5);
  assert.equal(effectiveMight(kernel, "enemy-mech"), 2);
  assert.equal(effectiveMight(kernel, "grunt"), 2);
});

test("sfd-182-221 Danger Zone golden: the buff expires at cleanup (317.2.c)", () => {
  const kernel = world()
    .unit("mech-a", { owner: "A", tags: ["Mech"], might: 2 })
    .build();
  resolveChainBody(play.body, chainKernel(kernel));

  const engine = createLayerEngine(kernel.objects, registrations(kernel));
  assert.equal(engine.evaluate(kernel.ref("mech-a")).might, 3);
  const expired = engine.expireAt("turn-end");
  assert.equal(expired.length, 1);
  assert.equal(engine.evaluate(kernel.ref("mech-a")).might, 2);
});

test("sfd-182-221 Danger Zone golden: no friendly Mech produces no registration and a skipped result", () => {
  const kernel = world()
    .unit("grunt", { owner: "A", might: 2 })
    .unit("enemy-mech", { owner: "B", tags: ["Mech"], might: 2 })
    .build();

  const outcome = resolveChainBody(play.body, chainKernel(kernel));
  // The merged primitive documents an empty set as negated/skipped: the set
  // was legal but no object was affected, so nothing is registered.
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "negated", reason: "skipped", events: [] });
  assert.equal(kernel.continuousEffects.length, 0);
});

// Fury/Mind is a hybrid [C], so either one Fury or one Mind is a legal branch.
// ObjectSnapshot carries that any-of-Domains set while the canonical binder
// supplies the exact numeric printed cost from catalog metadata.
const dangerHand = {
  owner: "A",
  controller: "A",
  cardId: CARD_ID,
  types: ["spell"],
  domain: ["Fury", "Mind"],
  zone: "hand",
  energy: 1,
  power: ["Fury"]
};

const productionTable = ({ repeat, energy = 4, power = ["Fury", "Mind"], answers = {} } = {}) => productionPlay({
  programs: [dangerZone],
  answers: {
    ...(repeat === undefined ? {} : { "cost:": () => repeat }),
    ...answers
  },
  build: (w) => w.player("A", { energy, power }).player("B")
    .object("danger-zone", dangerHand)
    .unit("mech-a", { owner: "A", controller: "A", tags: ["Mech"], might: 2 })
    .unit("mech-b", { owner: "A", controller: "A", tags: ["Mech"], might: 4 })
    .unit("enemy-mech", { owner: "B", controller: "B", tags: ["Mech"], might: 2 })
    .unit("ally-grunt", { owner: "A", controller: "A", might: 2 })
});

test("sfd-182-221 Danger Zone production: paying Repeat buys one additional whole-body Resolve", () => {
  assertEvidence(["350.1", "354", "355.1.a", "356.2.b.1", "359.3.a", "359.3.d", "820.1.b-d", "820.3.a"], [
    "Play", "Make relevant choices", "Finalize", "Pay Costs",
    "Pending Reactions", "Resolve", "Move to Trash", "Ending cleanup"
  ]);
  const f = productionTable({ repeat: true });
  const draft = f.play("danger-zone");

  assert.equal(draft.speed, "reaction");
  assert.equal(draft.cost.optionalAdditional[0].kind, "repeat");
  assert.equal(draft.cost.optionalAdditional[0].cost.energy.value, 1);
  assert.deepEqual(draft.cost.optionalAdditional[0].cost.payments, [{
    kind: "power",
    amount: { kind: "constant", value: 1 },
    allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]
  }]);
  assert.equal(f.requests.filter(request => request.type === "optional").length, 1);
  assert.equal(f.kernel.player("A").energy, 2, "printed 1 + Repeat 1 Energy");
  assert.deepEqual(f.kernel.player("A").power, [], "one Fury|Mind Power plus one universal Power");
  assert.equal(f.kernel.getObject("danger-zone").zone, "trash");
  const registrations = f.engine.layers.registry.list();
  assert.deepEqual(registrations.map(entry => entry.effect.filter.objectId), [
    "mech-a", "mech-b", "mech-a", "mech-b"
  ]);
  assert.deepEqual(registrations.map(entry => entry.duration), [
    { type: "end-of-turn" },
    { type: "end-of-turn" },
    { type: "end-of-turn" },
    { type: "end-of-turn" }
  ]);
  assert.equal(f.might("mech-a"), 4, "+1 twice");
  assert.equal(f.might("mech-b"), 6, "+1 twice");
  assert.equal(f.might("enemy-mech"), 2);
  assert.equal(f.might("ally-grunt"), 2);
  assert.equal(
    f.engine.pipeline.events.filter(event => event.timingPoint === "card-played" && event.object.ref.id === "danger-zone").length,
    1,
    "CR 820.3.a: Repeat does not play the card a second time"
  );
  assert.equal(f.engine.trace.filter(entry => entry.step === "resolved").length, 1);
  assert.deepEqual(f.engine.items, []);
});

test("sfd-182-221 Danger Zone production: declining Repeat pays the hybrid base and Resolves once", () => {
  assertEvidence(["135.2.e.5.a", "135.2.e.6.c", "163.2.b", "355.1.a", "356.2.b.1"], [
    "Play", "Make relevant choices", "Finalize", "Pay Costs",
    "Pending Reactions", "Resolve", "Move to Trash", "Ending cleanup"
  ]);
  const f = productionTable({ repeat: false });
  const draft = f.play("danger-zone");

  assert.equal(draft.speed, "reaction");
  assert.equal(f.requests.filter(request => request.type === "optional").length, 1);
  assert.equal(f.kernel.player("A").energy, 3);
  assert.deepEqual(f.kernel.player("A").power, ["Mind"], "one Fury satisfies [Fury|Mind]");
  assert.equal(f.kernel.getObject("danger-zone").zone, "trash");
  const registrations = f.engine.layers.registry.list();
  assert.deepEqual(registrations.map(entry => entry.effect.filter.objectId), ["mech-a", "mech-b"]);
  assert.deepEqual(registrations.map(entry => entry.duration), [
    { type: "end-of-turn" }, { type: "end-of-turn" }
  ]);
  assert.equal(f.might("mech-a"), 3);
  assert.equal(f.might("mech-b"), 5);
  assert.equal(f.might("enemy-mech"), 2);
  assert.equal(
    f.engine.pipeline.events.filter(event => event.timingPoint === "card-played").length,
    1
  );
});

test("sfd-182-221 Danger Zone production: insufficient Energy or wrong base Domain rolls back atomically", () => {
  for (const scene of [
    { energy: 1, power: ["Fury", "Mind"], message: /insufficient Energy/ },
    { energy: 4, power: ["Order"], message: /insufficient matching Power/ }
  ]) {
    const f = productionTable({ repeat: true, energy: scene.energy, power: scene.power });
    const before = f.kernel.stateForTest();
    const trace = structuredClone(f.engine.trace);
    const draft = f.describe("danger-zone");

    assert.throws(() => f.engine.execute(draft), (error) => {
      assert.equal(error.name, "CostPlanError");
      assert.equal(error.reason, "cannot-pay-cost");
      assert.match(error.message, scene.message);
      return true;
    });
    assert.deepEqual(f.kernel.stateForTest(), before);
    assert.deepEqual(f.engine.trace, trace);
    assert.deepEqual(f.engine.items, []);
    assert.equal(f.requests.filter(request => request.type === "optional").length, 1);
    assert.equal(f.might("mech-a"), 2);
  }
});

test("sfd-182-221 Danger Zone production: Reaction responds after Priority passes in a Closed State", () => {
  assertEvidence(["354.1", "355", "359.3.c", "813.1.c.1", "820.1.c.1"], [
    "Play", "Make relevant choices", "Finalize", "Pay Costs",
    "Pending Reactions", "Resolve", "Move to Trash", "Ending cleanup"
  ]);
  const opener = {
    canonicalCardId: "synthetic:rift-935-reaction-opener",
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    sourceText: "[Reaction]\nDo nothing.",
    abilities: [
      { kind: "keyword", keyword: "reaction" },
      { kind: "play", cost: { kind: "printed", energy: { kind: "constant", value: 1 } }, body: [] }
    ]
  };
  const f = productionPlay({
    programs: [dangerZone, opener],
    turnPlayer: "B",
    answers: { "cost:": () => true },
    build: (w) => w.player("A", { energy: 4, power: ["Fury", "Mind"] })
      .player("B", { energy: 4, power: [] })
      .hand("opener", {
        owner: "B", controller: "B", cardId: opener.canonicalCardId,
        types: ["spell"], energy: 1, power: null
      })
      .object("danger-zone", dangerHand)
      .unit("mech-a", { owner: "A", controller: "A", tags: ["Mech"], might: 2 })
  });

  const opening = f.describe("opener", "B");
  f.engine.execute(opening);
  assert.equal(f.engine.items.length, 1);
  assert.equal(f.engine.priority, "B");
  const response = f.describe("danger-zone", "A");
  assert.equal(response.speed, "reaction");
  assert.equal(f.engine.canAct("A", response.speed, response.source.ref, response.source), false,
    "the turn player still holds Priority");
  f.engine.pass("B");
  assert.equal(f.engine.priority, "A");
  assert.equal(f.engine.canAct("A", response.speed, response.source.ref, response.source), true);

  f.engine.execute(response);
  assert.equal(f.engine.items.length, 2);
  f.settle();
  assert.equal(f.kernel.player("A").energy, 2);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.equal(f.kernel.getObject("danger-zone").zone, "trash");
  assert.equal(f.might("mech-a"), 4);
  assert.equal(f.engine.trace.filter(entry => entry.step === "resolved").length, 2,
    "the opener and Danger Zone each Resolve once");
  assert.deepEqual(f.engine.items, []);
});

test("sfd-182-221 Danger Zone production: Basic Rune funding, Repeat, and TurnFlow expiry end to end", () => {
  assertEvidence(["135.2.e.5.a", "135.2.e.6.c", "317.2.c", "355.10.d", "356.2.b.1", "820.1.d.1"], [
    "Play", "Make relevant choices", "Finalize", "Pay Costs",
    "Pending Reactions", "Resolve", "Move to Trash", "Ending cleanup"
  ]);
  const runes = [
    { id: "fury-rune-a", domain: "Fury" },
    { id: "mind-rune", domain: "Mind" },
    { id: "fury-rune-b", domain: "Fury" },
    { id: "fury-rune-c", domain: "Fury" }
  ];
  let builder = world()
    .player("A")
    .player("B")
    .deck(Array.from({ length: 8 }, (_, index) => `A:deck:${index}`), { owner: "A" })
    .deck(Array.from({ length: 8 }, (_, index) => `B:deck:${index}`), { owner: "B" })
    .object("danger-zone", dangerHand)
    .unit("mech-a", { owner: "A", controller: "A", tags: ["Mech"], might: 2 })
    .unit("enemy-mech", { owner: "B", controller: "B", tags: ["Mech"], might: 2 });
  for (const rune of runes) {
    builder = builder.object(rune.id, {
      owner: "A", controller: "A", cardId: `card:${rune.id}`, types: ["rune"],
      tags: ["Basic"], zone: "rune-zone", energy: null, power: null
    });
  }
  const kernel = builder.build();
  const requests = [];
  const choose = (request) => {
    requests.push(request);
    if (request.type === "optional") return true;
    if (request.type === "select-objects" && request.options.length === request.min) return [...request.options];
    throw new Error(`Unexpected TurnFlow choice ${request.type} ${request.id}`);
  };
  const host = createActionPipelineHost({
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
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose
    }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  const flow = new TurnFlow({
    host,
    player: (player) => kernel.player(player),
    turnOrder: ["A", "B"],
    battlefields: [{ id: "bf1", controller: null }, { id: "bf2", controller: null }],
    victoryScore: 20
  });
  const binding = createProgramBinding({ cardPrograms: [dangerZone] });
  binding.attachLifecycle(flow.chain, (error) => { throw error; });
  flow.start();
  assert.equal(flow.phase, "main");
  assert.deepEqual([kernel.player("A").energy, kernel.player("A").power], [0, []]);

  const domainByRune = new Map(runes.map(rune => [rune.id, rune.domain]));
  const resolveIdentity = (cardId) => {
    const rune = kernel.objects.find(object => object.cardId === cardId);
    if (rune === undefined) return null;
    const domain = domainByRune.get(rune.ref.id);
    return domain === undefined ? null : { cardId, canonicalCardId: cardId, domain };
  };
  const activateRune = (rune, type, index) => {
    const object = kernel.getObject(rune.id);
    const plan = planBasicRuneResourceActivation({
      chain: flow.chain,
      state: { objects: () => kernel.objects, player: (player) => kernel.player(player) },
      resolveIdentity,
      request: {
        actor: "A",
        activationId: `danger-zone-fund-${index}`,
        intent: { type, runeObjectId: rune.id, zoneEntryId: object.ref.zoneEntryId },
        window: { kind: "priority" }
      }
    });
    return executeBasicRuneResourcePlan(plan);
  };

  assert.deepEqual(activateRune(runes[0], "rune-power", 0).powerAdded, ["Fury"]);
  assert.deepEqual(activateRune(runes[1], "rune-power", 1).powerAdded, ["Mind"]);
  assert.equal(activateRune(runes[2], "rune-energy", 2).energyAdded, 1);
  assert.equal(activateRune(runes[3], "rune-energy", 3).energyAdded, 1);
  assert.deepEqual([kernel.player("A").energy, kernel.player("A").power], [2, ["Fury", "Mind"]]);

  const source = kernel.getObject("danger-zone");
  const draft = binding.describePlay({ type: "play", player: "A", object: source.ref }, source);
  flow.chain.execute(draft);
  for (let guard = 0; guard < 30 && flow.chain.items.length; guard++) {
    flow.chain.pass(flow.chain.priority);
  }
  flow.layers.setObjects(kernel.objects);
  assert.equal(requests.filter(request => request.type === "optional").length, 1);
  assert.deepEqual([kernel.player("A").energy, kernel.player("A").power], [0, []]);
  assert.equal(kernel.getObject("danger-zone").zone, "trash");
  assert.equal(flow.layers.evaluate(kernel.ref("mech-a")).might, 4);
  assert.equal(flow.layers.evaluate(kernel.ref("enemy-mech")).might, 2);
  assert.equal(flow.layers.registry.list().length, 2);

  flow.endTurn("A");
  flow.layers.setObjects(kernel.objects);
  assert.equal(flow.turnPlayer, "B");
  assert.equal(flow.phase, "main");
  assert.equal(flow.layers.registry.list().length, 0);
  assert.equal(flow.layers.evaluate(kernel.ref("mech-a")).might, 2);
  assert.equal(flow.layers.evaluate(kernel.ref("enemy-mech")).might, 2);
  const events = flow.chain.pipeline.events.map(event => event.timingPoint);
  assert.ok(events.indexOf("main-end") < events.indexOf("turn-end"));
});
