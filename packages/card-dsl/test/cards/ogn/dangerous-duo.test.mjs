import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/dangerous-duo.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { TurnFlow } from "../../../../engine-core/dist/turn/flow.js";
import { productionPlay, world } from "../../fixtures/production-play.mjs";

const CANONICAL = "card.hash-d4e849d845765608b07bf4af4aa19877f6303dfff539b541d0d070320dd05d91";
const SOURCE_TEXT =
  "[Legion] — When you play me, give a unit +2 :rb_might: this turn. (Get the effect if you've played another card this turn.)";
const BASE = { type: "base", player: "A" };
const constant = value => ({ kind: "constant", value });

// Official interaction evidence:
// - Core Rules v1.5 (last updated 2026-10-09, effective 2026-10-16):
//   https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - Radiance patch notes, effective 2026-10-16:
//   https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
// canonicalCardId: card.hash-d4e849d845765608b07bf4af4aa19877f6303dfff539b541d0d070320dd05d91.
// Legion checks a different card successfully Finalized by this controller this
// turn under 812.1.c. The card's Play Effect is Pending after Board entry
// (383.4.a); Finalize locks one Unit and both players then get Priority under
// 337/338 before 359.3.d Resolve. The +2 this turn is an arithmetic-layer effect
// under 478/479 and survives Ending before Expiration under 317.1.a/317.2.c.
// No Focus or response-window choice is invented outside the ordinary Chain.
// The trigger reads this turn's successful-Finalize history and the locked Unit
// incarnation; it reads no departed object's LKI.

const PRIOR = {
  canonicalCardId: "synthetic:rift-995:dangerous-duo-prior",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText: "Synthetic zero-effect card used to finalize an earlier card this turn.",
  abilities: [{ kind: "play", cost: { kind: "printed" }, body: [] }]
};

// Official and production evidence is deliberately structured beside the tests
// that exercise it. The source snapshots were reviewed on 2026-10-23; these
// values do not silently upgrade legacy profiles or replay data.
const OFFICIAL_EVIDENCE = Object.freeze({
  canonicalCardId: CANONICAL,
  reviewedAt: "2026-10-23",
  coreRules: Object.freeze({
    version: "1.5",
    lastUpdated: "2026-10-09",
    effective: "2026-10-16",
    url: "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf",
    cachedTextSha256: "bbc81327eb21242452db3c56348b0725b1e0b6186c1a682dde541f3c7a864ba2"
  }),
  radianceRulings: Object.freeze({
    published: "2026-10-09",
    effective: "2026-10-16",
    url: "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/",
    cachedSha256: "dfba4f3ecf6956c32c19327330eaca96d317bedbf2c211c80a8fe1f1dccb569f",
    involvesThisCard: false,
    result: "No Dangerous Duo-specific ruling. The official CR 303.2.a ordering paragraph was reviewed; this card's one Play Effect creates no simultaneous-trigger ordering branch."
  }),
  spiritforgedErrata: Object.freeze({
    published: "2026-01-14",
    effective: "not stated in the official article",
    url: "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/",
    cachedSha256: "dca55c2d013473ffca82fb649a70d16d4b4356c22f74bd5a71b3aa3a9a4c94af",
    involvesThisCard: false,
    result: "No Dangerous Duo entry; no card-text correction changes this program."
  }),
  generalInterpretation: Object.freeze({
    rules: Object.freeze(["002", "051", "054.1"]),
    result: "Card text is interpreted under the rules. This card contradicts no rule and creates no conflicting permission/prohibition, so no special override applies."
  }),
  interactions: Object.freeze({
    playAndCost: Object.freeze({
      canonicalCardId: CANONICAL,
      rules: Object.freeze(["310.1.a", "312.1", "352.1", "356.1.c", "357.1", "358"]),
      timeline: Object.freeze([
        "A has Priority in Main Phase",
        "Play Duo as a Pending Chain Item",
        "Finalize; print a single 3-Energy base-cost plan",
        "Pay 3 Energy and no Power (catalog power:null)",
        "Move Duo to A's Base",
        "Continue with card-played and its Play Effect"
      ]),
      regression: "production golden: target lock, paid Energy, and no-Power entry"
    }),
    legionHistory: Object.freeze({
      canonicalCardId: CANONICAL,
      rules: Object.freeze(["383.2.c", "812.1.b.1", "812.1.c", "812.2"]),
      timeline: Object.freeze([
        "Duo Play Finalize is recorded in current-turn history",
        "card-played condition queries successful Finalizes by A",
        "exclude:self removes this physical Duo instance",
        "another earlier card, or another same-name Duo instance, satisfies Legion"
      ]),
      regression: "production golden: positive Legion, absent-prior negative, and same-name different-instance boundary"
    }),
    playEffectAndWindow: Object.freeze({
      canonicalCardId: CANONICAL,
      rules: Object.freeze(["329", "337.1", "339.1", "340.1", "355.5.b", "355.8", "383.4.a.2"]),
      timeline: Object.freeze([
        "Duo enters Board after its Play Finalize",
        "card-played places the Play Effect on the Chain",
        "Trigger Finalize targets one Board Unit",
        "A and B receive legal Priority windows",
        "Newest Finalized trigger resolves"
      ]),
      regression: "production golden: one target request, locked selected target, A then B passes, then Resolve"
    }),
    arithmeticLayer: Object.freeze({
      canonicalCardId: CANONICAL,
      rules: Object.freeze(["143.2.a", "355.7", "355.9.a.1", "479.4.f"]),
      timeline: Object.freeze([
        "Resolve the mandatory Play Effect",
        "Register +2 as an arithmetic-layer continuous Might effect",
        "Re-evaluate the selected Unit's Effective Might"
      ]),
      regression: "production golden: selected ally is 2 -> 4, other units remain unchanged, and no Buff counter is used"
    }),
    durationAndReset: Object.freeze({
      canonicalCardId: CANONICAL,
      rules: Object.freeze(["317.2.c", "812.1.c"]),
      timeline: Object.freeze([
        "The Might effect remains through the turn",
        "Expiration Step removes all this-turn effects",
        "turn-start resets the authoritative Finalize history",
        "a later Duo with no earlier card this turn does not trigger"
      ]),
      regression: "production golden: Might expires 4 -> 2, history resets, and the next Duo has no target prompt"
    }),
    notApplicable: Object.freeze({
      optionalOrAdditionalCost: "The printed card has none; no optional or additional-cost request is created.",
      replacementOrPrevention: "The card has no replacement or prevention instruction; no such behavior is fabricated.",
      layerDependency: "The +2 effect has no value dependency on another layer effect in this scenario.",
      lki: "The effect locks a target and reads no departed object's last-known characteristics.",
      focus: "No Showdown or Combat is opened by this interaction, so Focus does not replace Priority.",
      simultaneousTriggerOrdering: "This scenario creates one Play Effect, so CR 303.2.a does not impose an ordering choice."
    })
  })
});

function table({ preceding = true, duplicates = false, energy = 20 } = {}) {
  return w => {
    let builder = w.player("A", { energy, power: [] }).player("B", { energy, power: [] })
      .unit("duo", {
        owner: "A", controller: "A", cardId: CANONICAL, name: "Dangerous Duo",
        types: ["unit"], zone: "hand", location: null, energy: 3, power: null, might: 3
      })
      .unit("ally", { owner: "A", controller: "A", might: 2, location: BASE })
      .unit("enemy", { owner: "B", controller: "B", might: 4, location: { type: "base", player: "B" } });
    if (duplicates) builder = builder.unit("duo-two", {
      owner: "A", controller: "A", cardId: CANONICAL, name: "Dangerous Duo",
      types: ["unit"], zone: "hand", location: null, energy: 3, power: null, might: 3
    });
    if (preceding) builder = builder.hand("prior", {
      owner: "A", controller: "A", cardId: PRIOR.canonicalCardId, name: "Prior Card",
      types: ["gear"], zone: "hand", location: null, energy: 1, power: null, might: null
    });
    return builder;
  };
}

function production(options = {}) {
  return productionPlay({
    programs: [program, PRIOR],
    answers: { "target:dangerous-duo.unit": ["ally"] },
    build: table(options)
  });
}

function executeDuo(f, id = "duo") {
  const draft = f.describe(id);
  f.engine.execute(draft);
  return draft;
}

function mightEffect(f, objectId = "ally") {
  return f.engine.layers.registry.list().find(entry =>
    entry.effect.effect.kind === "continuous.might" && entry.effect.filter.objectId === objectId
  );
}

function turnTable() {
  return w => w.player("A", { energy: 0, power: [] }).player("B", { energy: 0, power: [] })
    .unit("duo", {
      owner: "A", controller: "A", cardId: CANONICAL, name: "Dangerous Duo",
      types: ["unit"], zone: "hand", location: null, energy: 3, power: null, might: 3
    })
    .hand("prior", {
      owner: "A", controller: "A", cardId: PRIOR.canonicalCardId, name: "Prior Card",
      types: ["gear"], zone: "hand", location: null, energy: 1, power: null, might: null
    })
    .unit("ally", { owner: "A", controller: "A", might: 2, location: BASE })
    .deck(Array.from({ length: 40 }, (_, index) => `A:deck:${index}`), { owner: "A" })
    .deck(Array.from({ length: 40 }, (_, index) => `B:deck:${index}`), { owner: "B" })
    .rune(Array.from({ length: 12 }, (_, index) => `A:rune:${index}`), { owner: "A" })
    .rune(Array.from({ length: 12 }, (_, index) => `B:rune:${index}`), { owner: "B" });
}

test("ogn-016-298 program validates, is registered, and is executable", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(Object.hasOwn(program, "judgeReason"), false);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogn-016-298 structure: Legion gates one card-played Play Effect", () => {
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { event: "card-played", filter: { role: "self" } });
  assert.deepEqual(ability.trigger.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "cards-finalized-this-turn",
      filter: { player: "controller", exclude: "self" }
    },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
});

test("ogn-016-298 structure: exactly one unit receives +2 Might for this turn", () => {
  const [instruction] = program.abilities[0].body;
  assert.equal(instruction.id, "dangerous-duo.grant-might");
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.amount, constant(2));
  assert.deepEqual(instruction.args.duration, constant("end-of-turn"));
  assert.deepEqual(instruction.args.target, constant("dangerous-duo.unit"));
  assert.deepEqual(instruction.targets, [{
    id: "dangerous-duo.unit",
    filter: { zone: "board", type: "unit" },
    min: 1,
    max: 1,
    selection: "one"
  }]);
});

test("ogn-016-298 primitive body registers an arithmetic end-of-turn Might effect", () => {
  const kernel = world()
    .unit("duo", { owner: "A", controller: "A" })
    .unit("chosen", { owner: "A", controller: "A", might: 4 })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("duo") });
  scoped.setTargets("dangerous-duo.unit", [scoped.ref("chosen")]);

  const outcome = runAbilityBody(program.abilities[0].body, scoped);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.continuousEffects.length, 1);
  assert.equal(scoped.continuousEffects[0].effect.layer, "arithmetic");
  assert.equal(scoped.continuousEffects[0].effect.filter.objectId, "chosen");
  assert.equal(scoped.continuousEffects[0].effect.effect.kind, "continuous.might");
  assert.equal(scoped.continuousEffects[0].effect.effect.amount, 2);
  assert.deepEqual(scoped.continuousEffects[0].duration, { type: "end-of-turn" });
  const layers = createLayerEngine(scoped.objects, scoped.continuousEffects);
  assert.equal(layers.evaluate(scoped.ref("chosen")).might, 6);
  assert.equal(layers.evaluate(scoped.ref("duo")).might, scoped.getObject("duo").might);
  layers.advance({ id: "turn-end" });
  assert.equal(layers.evaluate(scoped.ref("chosen")).might, 4);
});

test("ogn-016-298 official evidence pins sources, scope, and processing timelines", () => {
  assert.equal(OFFICIAL_EVIDENCE.canonicalCardId, program.canonicalCardId);
  assert.deepEqual(OFFICIAL_EVIDENCE.coreRules, {
    version: "1.5",
    lastUpdated: "2026-10-09",
    effective: "2026-10-16",
    url: "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf",
    cachedTextSha256: "bbc81327eb21242452db3c56348b0725b1e0b6186c1a682dde541f3c7a864ba2"
  });
  assert.equal(OFFICIAL_EVIDENCE.radianceRulings.involvesThisCard, false);
  assert.equal(OFFICIAL_EVIDENCE.radianceRulings.effective, "2026-10-16");
  assert.equal(OFFICIAL_EVIDENCE.spiritforgedErrata.involvesThisCard, false);
  assert.deepEqual(OFFICIAL_EVIDENCE.generalInterpretation.rules, ["002", "051", "054.1"]);
  for (const name of ["playAndCost", "legionHistory", "playEffectAndWindow", "arithmeticLayer", "durationAndReset"]) {
    const entry = OFFICIAL_EVIDENCE.interactions[name];
    assert.equal(entry.canonicalCardId, CANONICAL);
    assert.ok(entry.rules.length > 0, `${name} must cite rules`);
    assert.ok(entry.timeline.length > 0, `${name} must record a timeline`);
    assert.ok(entry.regression.length > 0, `${name} must name its production regression`);
  }
  assert.match(OFFICIAL_EVIDENCE.interactions.notApplicable.simultaneousTriggerOrdering, /one Play Effect/);
});

test("ogn-016-298 production golden: Legion pays 3 Energy, locks a target, waits for Priority, and grants +2 Might", () => {
  const f = production();
  f.play("prior");
  const draft = executeDuo(f);

  assert.equal(draft.speed, "normal");
  assert.equal(draft.cost.cost.kind, "printed");
  assert.equal(f.kernel.player("A").energy, 16);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.equal(f.kernel.getObject("duo").zone, "board");
  assert.deepEqual(f.kernel.getObject("duo").location, BASE);

  assert.equal(f.targetRequests().length, 1);
  const [targetRequest] = f.targetRequests();
  assert.equal(targetRequest.id, "target:dangerous-duo.unit");
  assert.equal(targetRequest.min, 1);
  assert.equal(targetRequest.max, 1);
  assert.deepEqual(new Set(targetRequest.options.map(ref => ref.id)), new Set(["duo", "ally", "enemy"]));

  const [trigger] = f.engine.items.filter(item => item.trigger?.registration.source.ref.id === "duo");
  assert.ok(trigger);
  assert.equal(trigger.status, "finalized");
  assert.deepEqual(trigger.targetPlans[0].selected, [f.kernel.ref("ally")]);
  assert.equal(trigger.targetPlans[0].lockedAt, "finalize");
  assert.equal(trigger.trigger.registration.spec.conditionHistory.exclude, "self");
  assert.equal(trigger.trigger.registration.spec.conditionHistory.player, "A");

  f.settle();
  assert.equal(f.might("ally"), 4);
  assert.equal(f.might("enemy"), 4);
  assert.equal(f.kernel.getObject("ally").buffs, 0);
  const effect = mightEffect(f);
  assert.ok(effect);
  assert.equal(effect.effect.layer, "arithmetic");
  assert.deepEqual(effect.duration, { type: "end-of-turn" });

  const trace = f.engine.trace;
  const triggerFinalized = trace.findIndex(entry => entry.step === "finalized" && entry.item === trigger.id);
  const passes = trace.slice(triggerFinalized + 1).filter(entry => entry.step === "pass").map(entry => entry.player);
  assert.deepEqual(passes, ["A", "B"], "both players receive the legal Priority window before Resolve");
  assert.ok(trace.some((entry, index) => index > triggerFinalized && entry.step === "resolved" && entry.item === trigger.id));
  assert.ok(f.engine.pipeline.events.some(event => event.timingPoint === "card-played" && event.object.ref.id === "duo"));
  assert.ok(f.engine.pipeline.events.some(event => event.timingPoint === "became-target" && event.object.ref.id === "ally"));
  assert.ok(f.engine.pipeline.events.some(event => event.timingPoint === "might-changed" && event.object.ref.id === "ally"));
  assert.deepEqual(f.requests.map(request => request.type), ["select-objects"], "there is no optional or additional-cost prompt");
});

test("ogn-016-298 production negative: Duo itself is excluded and cannot satisfy Legion", () => {
  const f = production({ preceding: false });
  f.play("duo");

  assert.equal(f.kernel.player("A").energy, 17);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.equal(f.kernel.getObject("duo").zone, "board");
  assert.equal(f.targetRequests().length, 0);
  assert.equal(f.might("ally"), 2);
  assert.equal(f.engine.layers.registry.list().length, 0);
  assert.deepEqual(f.engine.finalizedCardPlaysThisTurn().map(record => record.object.ref.id), ["duo"]);
});

test("ogn-016-298 production boundary: exclude:self retains a different physical same-name Duo", () => {
  const f = production({ duplicates: true });
  f.play("prior");
  f.play("duo");
  assert.equal(f.might("ally"), 4);

  f.play("duo-two");

  assert.equal(f.targetRequests().length, 2);
  assert.equal(f.might("ally"), 6);
  assert.equal(f.engine.layers.registry.list().filter(entry => entry.effect.effect.kind === "continuous.might").length, 2);
  assert.deepEqual(f.engine.finalizedCardPlaysThisTurn().map(record => record.object.ref.id), ["prior", "duo", "duo-two"]);
});

test("ogn-016-298 production lifetime: this-turn Might expires and a turn-start window excludes old Finalizes", () => {
  const f = production({ duplicates: true });
  f.play("prior");
  f.play("duo");
  assert.equal(f.might("ally"), 4);
  const effect = mightEffect(f);
  assert.ok(effect);

  f.engine.pipeline.emit({ timingPoint: "turn-start", player: "A" });
  assert.deepEqual(f.engine.finalizedCardPlaysThisTurn(), []);
  const requestsBefore = f.targetRequests().length;
  f.play("duo-two");
  assert.equal(f.engine.finalizedCardPlaysThisTurn().map(record => record.object.ref.id).join(","), "duo-two");
  assert.equal(f.might("ally"), 4);
  assert.deepEqual(f.engine.layers.expireAt("turn-end"), [effect.effect.id]);
  assert.equal(f.targetRequests().length, requestsBefore, "the reset history cannot activate the next Duo's Legion");
  assert.equal(f.might("ally"), 2);
});

test("ogn-016-298 TurnFlow golden: End trigger resolves before Expiration Step, then the next turn starts clean", () => {
  const kernel = turnTable()(world()).build();
  const requests = [];
  const choose = request => {
    requests.push(request);
    if (request.id === "target:dangerous-duo.unit") return [kernel.ref("ally")];
    if (request.type === "select-objects" && request.options.length === request.min) return [...request.options];
    if (request.type === "order") return [...request.options];
    if (request.type === "mode") return request.options[0];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const binding = createProgramBinding({ cardPrograms: [program, PRIOR] });
  const flow = new TurnFlow({
    host,
    player: id => kernel.player(id),
    turnOrder: ["A", "B"],
    battlefields: [{ id: "bf1", controller: null }, { id: "bf2", controller: null }],
    describePlay: binding.describePlay
  });
  const errors = [];
  binding.attachLifecycle(flow.chain, error => errors.push(error));
  // The ending probe deliberately gives TurnFlow a real FEPR item so the
  // test can inspect the window before the Expiration Step. It is a test-only
  // synthetic effect, not part of Dangerous Duo's program.
  flow.chain.pipeline.registerTrigger({
    id: "rift-995:turn-end-probe",
    source: kernel.getObject("ally"),
    controller: "A",
    spec: { at: "turn-end", filter: {} },
    body: [{ id: "rift-995:draw-at-end", op: "effect.draw", args: { amount: constant(1) } }]
  });
  flow.start();
  assert.deepEqual(errors, []);
  assert.equal(flow.phase, "main");
  assert.equal(flow.turnPlayer, "A");
  assert.equal(flow.chain.priority, "A");

  kernel.perform({ type: "gain-energy", player: "A", amount: 4 });
  const prior = binding.describePlay({ type: "play", object: kernel.ref("prior"), player: "A" }, kernel.getObject("prior"));
  flow.execute(prior);
  while (flow.chain.items.length) flow.pass(flow.chain.priority);
  flow.advance();
  const draft = binding.describePlay({ type: "play", object: kernel.ref("duo"), player: "A" }, kernel.getObject("duo"));
  flow.execute(draft);
  while (flow.chain.items.length) flow.pass(flow.chain.priority);
  flow.advance();
  flow.chain.layers.setObjects(kernel.objects);
  assert.equal(flow.chain.layers.evaluate(kernel.ref("ally")).might, 4);
  assert.equal(kernel.player("A").energy, 0, "the real TurnFlow payment charged the printed 3 Energy");
  assert.deepEqual(flow.chain.finalizedCardPlaysThisTurn().map(record => record.object.ref.id), ["prior", "duo"]);

  flow.endTurn("A");
  assert.equal(flow.phase, "ending");
  assert.equal(flow.chain.turnState, "neutral-closed");
  flow.chain.layers.setObjects(kernel.objects);
  assert.equal(flow.chain.layers.evaluate(kernel.ref("ally")).might, 4, "Ending Step effects see this-turn Might before Expiration");
  while (flow.chain.items.length) flow.pass(flow.chain.priority);
  flow.advance();

  assert.equal(flow.phase, "main");
  assert.equal(flow.turn, 2);
  assert.equal(flow.turnPlayer, "B");
  assert.equal(flow.chain.priority, "B");
  flow.chain.layers.setObjects(kernel.objects);
  assert.equal(flow.chain.layers.evaluate(kernel.ref("ally")).might, 2, "the Might effect expired by the Expiration Step");
  assert.deepEqual(flow.chain.finalizedCardPlaysThisTurn(), [], "turn-start reset the Finalize history");
  assert.deepEqual(requests.map(request => request.type), ["select-objects"]);
  const events = flow.chain.pipeline.events.map(event => event.timingPoint);
  const turnEnd = events.indexOf("turn-end");
  const nextTurnStart = events.indexOf("turn-start", turnEnd + 1);
  assert.ok(turnEnd >= 0);
  assert.ok(nextTurnStart > turnEnd, "Expiration completes before the next turn starts");
});
