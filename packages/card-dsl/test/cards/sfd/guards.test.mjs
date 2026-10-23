import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/guards.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createEngineStaticBinder, hiddenPermissionFor } from "../../../../engine-core/dist/programs/statics.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-96f6071389124163d72b59b25dca5a642f1cd93402158c5237be9ba305f9dd44";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "Play a 2 :rb_might: Sand Soldier unit token. You may pay :rb_rune_order: to ready it.";
const TOKEN_LOCATION_ID = "guards.token-location";
const LOCATION_CHOICE_KEY = `guards.choose-location/location%3A${TOKEN_LOCATION_ID}`;
const OPTIONAL_KEY = "guards.may-ready/optional";

const [hidden, play] = program.abilities;
const [chooseLocation, tokenInstruction, choiceInstruction] = play.body;
const [payInstruction, readyInstruction] = choiceInstruction.args.body.value;

/** The production chain normalizes `self`/`opponent` player selectors in query. */
const productionContext = (kernel) => new Proxy(kernel, {
  get(target, key) {
    if (key === "query") {
      return (filter) => target.query({}).filter((object) => matchesObjectFilter(
        Object.fromEntries(Object.entries(filter).map(([field, value]) => [
          field,
          field === "controller" && value === "self" ? target.controller : value
        ])),
        object
      ));
    }
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  }
});

function guardsWorld({ answer, location = { type: "base", player: "A" } } = {}) {
  const kernel = world()
    .player("A", { energy: 10, power: ["Order"] })
    .player("B", { energy: 10 })
    .build();
  const answers = { [LOCATION_CHOICE_KEY]: location };
  if (answer !== undefined) answers[OPTIONAL_KEY] = answer;
  kernel.setAnswers(answers);
  return kernel;
}

const playedTokens = (kernel) => kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken);

test("Guards! program is valid EffectIR v2 data and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Guards! judgeReason names the cost.hidden consumer as the only remaining gap", () => {
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.match(program.judgeReason, /Static ability kind cost\.hidden has no layer mapping/);
  assert.match(program.judgeReason, /811\.1\.b/);
  assert.match(program.judgeReason, /811\.6/);
  // The merged halves are no longer recorded as gaps.
  assert.doesNotMatch(program.judgeReason, /dynamic:legal-unit-locations/);
  assert.doesNotMatch(program.judgeReason, /没有 cost\.pay 原语|RIFT-261/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("Guards! structure: Hidden keyword, Finalize location, chain-played Sand Soldier, optional paid ready", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });

  assert.equal(play.kind, "play");
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["guards.choose-location", "condition.value"],
      ["guards.play-sand-soldier", "effect.token"],
      ["guards.may-ready", "choice.optional"]
    ]
  );

  // 355.2.a: the legal locations are chosen at Finalize; the merged provider
  // enumerates the controller's Base and controlled Battlefields.
  assert.deepEqual(chooseLocation.locations, [{
    id: TOKEN_LOCATION_ID,
    type: "any",
    controller: "controller",
    min: 1,
    max: 1,
    selection: "one"
  }]);
  assert.deepEqual(chooseLocation.args.value, {
    kind: "location",
    value: { kind: "target-location", target: TOKEN_LOCATION_ID }
  });
  assert.deepEqual(chooseLocation.args.key, { kind: "constant", value: "location" });

  // "Play a 2 [M] Sand Soldier unit token": the CR 187.3 definition, played
  // through the chain (440.2.c / 185.2.a).
  assert.deepEqual(tokenInstruction.args.token, { kind: "constant", value: "sand-soldier" });
  assert.deepEqual(tokenInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(tokenInstruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(tokenInstruction.args.location, {
    kind: "linked-value",
    instructionId: "guards.choose-location",
    key: "location"
  });
  assert.deepEqual(tokenInstruction.args.linkKey, { kind: "constant", value: "sandSoldier" });
  assert.equal(tokenInstruction.linkedTo, "guards.choose-location");
  assert.equal(tokenInstruction.targets, undefined);
  assert.equal(tokenInstruction.args.locations, undefined);
  assert.equal(tokenInstruction.args.choiceId, undefined);

  // "You may pay :rb_rune_order: to ready it": one optional decision whose
  // chosen instructions live in the body (contract 3.9), linked to the token
  // instruction ("it" = the played Sand Soldier).
  assert.equal(choiceInstruction.linkedTo, "guards.play-sand-soldier");
  assert.equal(choiceInstruction.args.body.kind, "constant");
  assert.equal(payInstruction.id, "guards.pay-order-rune");
  assert.equal(payInstruction.op, "cost.pay");
  assert.deepEqual(payInstruction.args, {
    payments: { kind: "constant", value: { power: ["Order"] } }
  });
  assert.equal(readyInstruction.id, "guards.ready-sand-soldier");
  assert.equal(readyInstruction.op, "effect.ready");
  assert.equal(readyInstruction.linkedTo, "guards.pay-order-rune");
  assert.deepEqual(readyInstruction.args.objects, {
    kind: "linked-value",
    instructionId: "guards.play-sand-soldier",
    key: "sandSoldier.objects"
  });
});

test("Guards! golden: production adapter creates the Sand Soldier on the Chain, plays it to the chosen Base and pays Order", () => {
  const kernel = guardsWorld({ answer: true });
  const before = kernel.player("A").power;
  const outcome = resolveChainBody(play.body, productionContext(kernel));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["guards.choose-location", "executed"],
    ["guards.play-sand-soldier", "executed"],
    ["guards.pay-order-rune", "executed"],
    ["guards.ready-sand-soldier", "executed"],
    ["guards.may-ready", "executed"]
  ]);
  assert.deepEqual(outcome.results.map((entry) => entry.op), [
    "condition.value",
    "effect.token",
    "cost.pay",
    "effect.ready",
    "choice.optional"
  ]);

  const created = playedTokens(kernel);
  assert.equal(created.length, 1);
  const [soldier] = created;
  assert.equal(soldier.name, "Sand Soldier");
  assert.equal(soldier.might, 2);
  assert.deepEqual(soldier.tags, ["Shurima"]);
  assert.deepEqual(soldier.location, { type: "base", player: "A" });
  // 185.3.a: a token carries null Energy / Power, never zero.
  assert.equal(soldier.energy, null);
  assert.equal(soldier.power, null);
  // The play procedure really moved the token onto the Board.
  assert.equal(soldier.exhausted, false);

  // 204.3 / 204.3.a: the resolving body really paid one Order Power through
  // cost.pay, and the payment receipt links the plan it paid.
  assert.deepEqual(before, ["Order"]);
  assert.equal(outcome.events.filter((event) => event.action === "pay").length, 1);
  assert.equal(
    outcome.linkedValues["guards.may-ready/guards.pay-order-rune.payment"].total.power[0].allowedDomains[0],
    "Order"
  );
  // 415.3 / 416.1.c: the played Sand Soldier enters exhausted. The paid ready
  // branch therefore performs one real ready action rather than fabricating a
  // second state change.
  assert.equal(outcome.events.filter((event) => event.action === "ready").length, 1);
  assert.deepEqual(
    outcome.linkedValues["guards.may-ready/guards.ready-sand-soldier.readied"],
    { count: 1, objects: [soldier.ref] }
  );
});

test("Guards! golden: the paid ready really readies the exhausted Sand Soldier handed over by the token instruction", () => {
  // The reference kernel's play procedure leaves the played token ready, so the
  // printed paid clause is exercised on a genuinely exhausted token. The token
  // and its receipt come from the card's own token instructions run for real;
  // the token is exhausted through the real action; and the receipt is bound
  // under the exact qualified link key the production interpreter writes
  // (`<instructionId>.<linkKey>.objects`). The two resolved instructions are the
  // card's own authored pay + ready pair.
  const kernel = guardsWorld();
  const tokenOutcome = resolveChainBody([chooseLocation, tokenInstruction], productionContext(kernel));
  assert.equal(tokenOutcome.status, "executed");
  const [soldier] = playedTokens(kernel);
  const receipt = tokenOutcome.linkedValues["guards.play-sand-soldier.sandSoldier.objects"];
  assert.deepEqual(receipt, [soldier.ref]);

  assert.equal(kernel.perform({ type: "exhaust", object: soldier.ref }).status, "done");
  assert.equal(kernel.getObject(soldier.ref.id).exhausted, true);
  kernel.link("guards.play-sand-soldier.sandSoldier.objects", receipt);

  const outcome = resolveChainBody(choiceInstruction.args.body.value, productionContext(kernel));
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["guards.pay-order-rune", "executed"],
    ["guards.ready-sand-soldier", "executed"]
  ]);
  assert.equal(kernel.getObject(soldier.ref.id).exhausted, false);
  assert.equal(outcome.events.filter((event) => event.action === "ready").length, 1);
  assert.deepEqual(
    outcome.linkedValues["guards.ready-sand-soldier.readied"],
    { count: 1, objects: [soldier.ref] }
  );
  assert.deepEqual(kernel.player("A").power, []);
  assert.equal(
    outcome.linkedValues["guards.pay-order-rune.payment"].total.power[0].allowedDomains[0],
    "Order"
  );
});

test("Guards! golden: declining leaves the token played and the Order Power unspent", () => {
  const kernel = guardsWorld({ answer: false });
  const outcome = resolveChainBody(play.body, productionContext(kernel));

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]), [
    ["guards.choose-location", "executed", undefined],
    ["guards.play-sand-soldier", "executed", undefined],
    ["guards.may-ready", "negated", "skipped"]
  ]);
  assert.equal(playedTokens(kernel).length, 1);
  assert.deepEqual(kernel.player("A").power, ["Order"]);
  assert.equal(outcome.events.filter((event) => event.action === "pay").length, 0);
});

test("Guards! golden: an unpayable Order rune fails closed instead of readying for free", () => {
  const kernel = world()
    .player("A", { energy: 10 })
    .player("B", { energy: 10 })
    .build();
  kernel.setAnswers({ [LOCATION_CHOICE_KEY]: { type: "base", player: "A" }, [OPTIONAL_KEY]: true });

  // 203.3: the failed payment must abort loudly; no partial ready may commit.
  assert.throws(
    () => resolveChainBody(play.body, productionContext(kernel)),
    (error) => error.name === "CostPlanError" && error.reason === "cannot-pay-cost"
  );
  assert.deepEqual(kernel.player("A").power, []);
  assert.deepEqual(playedTokens(kernel).map((token) => token.exhausted), [true]);
  assert.equal(kernel.events.filter((event) => event.action === "ready").length, 0);
});

test("Guards! golden: the Finalize location provider offers the controlled Battlefield, not the opponent's", () => {
  const kernel = world()
    .player("A", { energy: 10, power: ["Order"] })
    .player("B", { energy: 10 })
    .object("controlled-field", {
      types: ["battlefield"],
      zone: "board",
      location: null,
      owner: "A",
      controller: "A",
      energy: null,
      power: null
    })
    .object("enemy-field", {
      types: ["battlefield"],
      zone: "board",
      location: null,
      owner: "B",
      controller: "B",
      energy: null,
      power: null
    })
    .unit("field-occupant", {
      owner: "A",
      controller: "A",
      location: { type: "battlefield", id: "controlled-field" }
    })
    .build();
  kernel.setAnswers({
    [LOCATION_CHOICE_KEY]: { type: "battlefield", id: "controlled-field" },
    [OPTIONAL_KEY]: false
  });

  const outcome = resolveChainBody(play.body, productionContext(kernel));
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(playedTokens(kernel)[0].location, { type: "battlefield", id: "controlled-field" });
  assert.deepEqual(kernel.player("A").power, ["Order"]);

  // 355.2.a / 359.3.f: the opponent's Battlefield is outside the printed set;
  // the merged provider rejects that answer instead of placing the token there.
  const illegal = world()
    .player("A", { energy: 10, power: ["Order"] })
    .player("B", { energy: 10 })
    .object("enemy-field", {
      types: ["battlefield"],
      zone: "board",
      location: null,
      owner: "B",
      controller: "B",
      energy: null,
      power: null
    })
    .unit("enemy-occupant", {
      owner: "B",
      controller: "B",
      location: { type: "battlefield", id: "enemy-field" }
    })
    .build();
  illegal.setAnswers({
    [LOCATION_CHOICE_KEY]: { type: "battlefield", id: "enemy-field" },
    [OPTIONAL_KEY]: false
  });
  assert.throws(
    () => resolveChainBody(play.body, productionContext(illegal)),
    /Invalid location choice for guards\.token-location/
  );
  assert.equal(playedTokens(illegal).length, 0);
});

test("Guards! boundary: the merged Hidden expansion binds a live production permission", () => {
  // 811.1.b/811.6: the production binder installs the permission capability;
  // Hide/facedown/free-play remain the whole-card consumers in judgeReason.
  const definition = keywordDefinitionsById.get("Hidden");
  assert.ok(definition, "effects/keywords/Hidden.ts must be registered");
  assert.deepEqual(definition.expand({ host: { canonicalCardId: CANONICAL } }), [
    { kind: "static", effect: { kind: "cost.hidden" } }
  ]);

  const kernel = world().unit("guards-source", { types: ["spell"], zone: "chain" }).build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: () => { throw new Error("unexpected choice"); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false
  });
  const binder = createEngineStaticBinder(engine);
  const source = { ...kernel.getObject("guards-source"), cardId: CANONICAL, types: ["spell"] };
  const handle = binder.bindStatic({ kind: "static", effect: { kind: "cost.hidden" } }, source);
  assert.equal(hiddenPermissionFor(engine, source), "present");
  handle.unbind();
  assert.equal(hiddenPermissionFor(engine, source), "absent");
});

test.todo(
  "Guards! full card: run [Hidden]'s 811.1.b Hide action, the facedown storage and the 811.6 free play from facedown once a cost.hidden runtime consumer exists (the Hide action, the facedown zone, the turn-scoped Reaction permission and the 811.1.d.3 original-battlefield target restriction)"
);

