// Golden test for Sivir, Mercenary (sfd-143-221).
//
// Layers 1-2 (validation/identity and structure) live here, as does layer 3
// (real execution): the card has no template row that can execute its own gate,
// so every supported half is measured against the merged engine in this file.
// The template golden still carries one row for this card; see
// test/cards/templates/keyword-static-static-673.test.mjs.
//
// Measured 2026-10-18: the printed 4 Energy + 1 Chaos Power play, the merged
// continuous.might primitive and production static binder, a real Power payment
// that no merged expression can read back, and the RIFT-710 keyword re-expansion
// that really produces a battlefield route under its own engine. The printed
// expectations that still cannot run are TODO rows; the current wrong value is
// never asserted as the printed outcome.
//
// Re-measured against the merged harness: RIFT-707 made runCardScenario rethrow
// lifecycle binding errors (attachProgramLifecycle(engine, error => { throw })),
// so the whole-card scenario cannot run while the Accelerate expansion has no
// layer mapping. The real play flow therefore runs through ChainEngine with the
// production error collector, and the harness refusal is asserted separately
// instead of being hidden.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/sivir-mercenary.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import continuousMight from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import grantKeyword from "../../../../engine-core/dist/effects/instructions/continuous.grant-keyword.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createEngineStaticBinder, createProgramBinding, expandProgram, staticCostSources } from "../../../../engine-core/dist/programs/index.js";
import { KeywordGrantLayerEngine } from "../../../../engine-core/dist/programs/keyword-grants.js";
import { translateCost } from "../../../../engine-core/dist/programs/play.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { evaluateExpression } from "../../../../engine-core/dist/effects/interpreter/expr.js";
import { historyCount } from "../../../../engine-core/dist/effects/interpreter/history.js";
import { runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { duelWorld, mainTiming, readinessFor, moveDuelUnitsStandard } from "../../../../engine-core/test/rules/movement/support.mjs";

const CARD_ID = "card.hash-bd07122c30b6cd8a4c4c84c4bcce0070fad8ea471344189ee61fb766cb54e888";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_chaos: as an additional cost to have me enter ready.)\n" +
  "If you've spent at least :rb_rune_rainbow::rb_rune_rainbow: this turn, I have +2 :rb_might: and [Ganking]. (I can move from battlefield to battlefield.)";

const [accelerate, mightStatic, gankingStatic] = program.abilities;
const ALL_POWER = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"];

// The shipped program with only the harness gate lifted. Published status is
// asserted separately; this view never leaves the test file.
const lifted = { ...program, status: "executable", judgeReason: undefined };

function environmentFor(kernel, id) {
  const source = kernel.getObject(id);
  return {
    context: bindResolveContext(kernel, { source, controller: source.controller }),
    host: source.ref,
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false,
  };
}

function accelerationAbility(snapshot) {
  const ability = expandProgram(lifted, snapshot).abilities
    .find(candidate => candidate.kind === "static" && candidate.effect.kind === "accelerate.cost");
  assert.ok(ability, "the merged Accelerate KeywordDef must declare accelerate.cost");
  return ability;
}

test("sfd-143-221 Sivir, Mercenary: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-143-221 Sivir, Mercenary: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The refreshed reason states the measured gaps: the unreadable spent amount,
  // the unassembled keyword re-expansion engine (including its non-fail-closed
  // condition path on this card's own gate), and the missing Accelerate
  // play-cost producer plus the missing 805.2.b payment gate.
  assert.match(program.judgeReason, /135\.2\.e\.5\.a/);
  assert.match(program.judgeReason, /spent/);
  assert.match(program.judgeReason, /powerSpentThisTurn/);
  assert.match(program.judgeReason, /ResolveContext\.history/);
  assert.match(program.judgeReason, /MissingInformation/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /permission\.routes/);
  assert.match(program.judgeReason, /KeywordGrantLayerEngine/);
  assert.match(program.judgeReason, /fail-closed/);
  assert.match(program.judgeReason, /accelerate\.cost/);
  assert.match(program.judgeReason, /translateCost/);
  assert.match(program.judgeReason, /no layer mapping/);
  // 805.2.b: the reason names the measured missing payment gate and the
  // RIFT-707 harness behavior instead of the retired "no pay event" wording.
  assert.match(program.judgeReason, /selectedAdditional/);
  assert.match(program.judgeReason, /805\.2\.b/);
  assert.match(program.judgeReason, /RIFT-707/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-143-221 Sivir, Mercenary: Accelerate keyword declared, never re-expanded in the card", () => {
  assert.equal(program.abilities.length, 3);
  // 805: the optional additional cost and the enter-ready replacement belong to
  // effects/keywords/Accelerate.ts (contract 3.7), not to the card.
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });
});

test("sfd-143-221 Sivir, Mercenary: the +2 Might half is a conditioned arithmetic-layer static ability", () => {
  assert.equal(mightStatic.kind, "static");
  // 143.2.a / 475-477: Might is altered in the arithmetic layer, never through a
  // Buff counter (702-704).
  assert.equal(mightStatic.effect.kind, "continuous.might");
  assert.equal(mightStatic.effect.mode, "add");
  assert.equal(mightStatic.effect.layer, "arithmetic");
  assert.equal(mightStatic.effect.appliesTo, "self");
  assert.deepEqual(mightStatic.effect.amount, { kind: "constant", value: 2 });

  // "If you've spent at least [A][A] this turn" — the recorded read intent for
  // the turn's Power-spent amount, which no merged Expr kind provides.
  assert.equal(mightStatic.condition.kind, "compare");
  assert.equal(mightStatic.condition.operator, "gte");
  assert.deepEqual(mightStatic.condition.right, { kind: "constant", value: 2 });
  assert.deepEqual(mightStatic.condition.left, {
    kind: "object-property", object: "source", property: "powerSpentThisTurn"
  });
});

test("sfd-143-221 Sivir, Mercenary: the Ganking half is declared as a conditional keyword grant", () => {
  assert.equal(gankingStatic.kind, "static");
  // 810.1.b / 810.3: Ganking is a Passive Ability keyword; the grant uses the
  // continuous.grant-keyword shape whose expansion lives in
  // effects/keywords/Ganking.ts (contract 3.7), not restated here.
  assert.equal(gankingStatic.effect.kind, "continuous.grant-keyword");
  assert.equal(gankingStatic.effect.appliesTo, "self");
  assert.deepEqual(gankingStatic.effect.keyword, { id: "Ganking" });
  // A passive grant is live while the source/condition applies, with no own turn expiry.
  assert.equal(gankingStatic.effect.duration, undefined);
  assert.equal(gankingStatic.condition.kind, "compare");
  assert.deepEqual(gankingStatic.condition.left, mightStatic.condition.left);
  assert.deepEqual(gankingStatic.condition.right, { kind: "constant", value: 2 });
});

// ---------------------------------------------------------------------------
// Layer 3: real execution of the merged cases the card depends on.
// ---------------------------------------------------------------------------

test("sfd-143-221 Sivir, Mercenary: the merged continuous.might primitive registers the arithmetic effect this card declares", () => {
  // Running the card's declared amount/mode through the real primitive records
  // one arithmetic-layer registration on the source unit, and the layers engine
  // then evaluates the printed +2. The "spent [A][A]" gate itself has no merged
  // reader, so this run registers the effect the way a met condition would.
  const kernel = world().unit("sivir", { might: 4, location: { type: "battlefield", id: "bf-1" } }).build();
  const scoped = kernel.clone({
    source: kernel.ref("sivir"),
    sourceSnapshot: kernel.getObject("sivir")
  });

  const run = runInstruction(
    continuousMight,
    {
      amount: { kind: "constant", value: 2 },
      mode: { kind: "constant", value: "add" },
      appliesTo: { kind: "constant", value: "self" }
    },
    { world: scoped }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(scoped.continuousEffects.map(entry => entry.effect.filter.objectId), ["sivir"]);
  assert.equal(scoped.continuousEffects[0].effect.effect.amount, 2);

  const engine = createLayerEngine(kernel.objects, scoped.continuousEffects.map((entry, index) => ({
    ...entry,
    timestamp: 1,
    sequence: index + 1
  })));
  assert.equal(engine.evaluate(kernel.ref("sivir")).might, 6);
  // 702-704: the +2 is a Might modification, never a Buff counter.
  assert.equal(kernel.getObject("sivir").buffs, 0);
});

// The real play flow: ChainEngine + the program's own describePlay, with the
// production lifecycle error collector that the game server installs.
function playThroughEngine({ staticBinder, accelerate = false } = {}) {
  const binding = createProgramBinding({ cardPrograms: [lifted], ...(staticBinder ? { staticBinder } : {}) });
  const requests = [];
  const board = fixture({
    cards: [{ id: "sivir", cardId: CARD_ID, types: ["unit"], energy: 4, power: ["Chaos"], might: 4 }],
    describePlay: binding.describePlay,
    choose: request => {
      requests.push({ id: request.id, type: request.type });
      return request.type === "optional" ? accelerate : undefined;
    }
  });
  board.kernel.addPlayer("A", { energy: 20, power: ["Chaos", "Chaos", "Order"] });
  const errors = [];
  binding.attachLifecycle(board.engine, error => errors.push(String(error.message)));
  // The host closes over the kernel, so an own property records the actions the
  // real Finalize commits (the reference kernel does not deduct Power, so the
  // paid plan — not the pool — is the authoritative measurement).
  const committed = [];
  const perform = board.kernel.perform.bind(board.kernel);
  board.kernel.perform = action => { committed.push(action); return perform(action); };
  const outcome = board.engine.commit({ type: "play", object: board.kernel.ref("sivir"), player: "A" });
  let guard = 0;
  while (board.engine.items.length && guard++ < 20) board.engine.advance();
  return { board, binding, committed, errors, outcome, requests, accelerate };
}

test("sfd-143-221 Sivir, Mercenary: the printed 4 Energy + 1 Chaos Power play really pays through the card-program path", () => {
  const { board, binding, committed, errors, outcome, requests } = playThroughEngine();
  assert.equal(outcome.status, "done");
  // 805.1.b/805.2: the printed base cost is 4 Energy plus one Chaos Power. The
  // declined Accelerate option stays out of the final cost; the player decision
  // is requested at Finalize instead of being silently assumed.
  const payments = committed.filter(action => action.type === "pay");
  assert.equal(payments.length, 1);
  assert.deepEqual(payments[0].plan, { finalized: true, energy: 4, power: ["Chaos"] });
  assert.equal(board.kernel.player("A").energy, 16);
  assert.equal(requests.length, 1);
  assert.match(requests[0].id, /accelerate\.cost/);
  assert.equal(requests[0].type, "optional");
  const draft = binding.describePlay(
    { type: "play", object: board.kernel.ref("sivir"), player: "A" },
    board.kernel.getObject("sivir")
  );
  assert.deepEqual(draft.cost, {
    id: "cost:play:sivir:3:A",
    cost: { kind: "printed" },
    domains: ["Chaos"],
    optionalAdditional: [{
      id: `${CARD_ID}:accelerate.cost:3`,
      kind: "accelerate",
      cost: {
        payments: [
          { kind: "energy", amount: { kind: "constant", value: 1 } },
          { kind: "power", amount: { kind: "constant", value: 1 } }
        ]
      },
      selected: undefined
    }]
  });
  assert.deepEqual(draft.body, []);
  // The lifecycle installs the Accelerate capability and reports no binder error.
  assert.deepEqual(errors, []);
  assert.equal(board.engine.pipeline.events.some(event => event.timingPoint === "card-played"), true);
  assert.equal(board.engine.pipeline.events.some(event => event.timingPoint === "object-enters-base"), true);
});

test("sfd-143-221 Sivir, Mercenary: Accelerate paid and declined decision controls entry orientation", () => {
  const declined = playThroughEngine({ accelerate: false });
  assert.equal(declined.outcome.status, "done");
  assert.deepEqual(declined.errors, []);
  assert.equal(declined.board.kernel.getObject("sivir").exhausted, true);
  assert.equal(declined.board.kernel.player("A").energy, 16);
  assert.deepEqual(declined.board.kernel.player("A").power, ["Chaos", "Order"]);

  const paid = playThroughEngine({ accelerate: true });
  assert.equal(paid.outcome.status, "done");
  assert.deepEqual(paid.errors, []);
  const played = paid.board.kernel.getObject("sivir");
  assert.equal(played.zone, "board");
  assert.deepEqual(played.location, { type: "base", player: "A" });
  assert.equal(played.might, 4);
  assert.equal(played.buffs, 0);
  assert.deepEqual(played.keywords, []);
  assert.equal(played.exhausted, false);
  assert.equal(paid.board.kernel.player("A").energy, 15);
  assert.deepEqual(paid.board.kernel.player("A").power, ["Order"]);
  // 805.6.a: the replacement rewrites the entry orientation, so the permanent
  // never passes through a separate becomes-ready event.
  assert.equal(paid.board.engine.pipeline.events.some(event => event.timingPoint === "object-readied"), false);
});

test("sfd-143-221 Sivir, Mercenary: the scenario harness surfaces the Accelerate decision", () => {
  // The Accelerate cost now binds and is requested by Finalize. The generic
  // harness requires the scenario author to supply that public decision.
  assert.throws(
    () => runCardScenario(lifted, {
      players: { A: { energy: 20, power: [...ALL_POWER] }, B: {} },
      objects: [
        { id: "card", program: lifted, types: ["unit"], zone: "hand", energy: 4, power: ["Chaos"], might: 4 },
      ],
      operations: [{ type: "play", object: "card", player: "A" }],
    }),
    error => {
      assert.equal(error.name, "Error");
      assert.match(error.message, /Scenario ended while waiting for choice in play/);
      return true;
    }
  );
});

test("sfd-143-221 Sivir, Mercenary: the merged cost pipeline really charges the printed optional [1]+[C] Accelerate cost", () => {
  // The Accelerate payment itself is executable: 1 Energy plus one Power of the
  // unit's own domain (805.1.b.1). What is missing is only the card-side
  // producer that would hand this component to the play's cost plan.
  const kernel = world()
    .player("A", { energy: 10, power: ["Chaos", "Chaos", "Order"] })
    .unit("sivir", { might: 4, energy: 4, power: ["Chaos"] })
    .build();
  const context = bindResolveContext(kernel, {
    source: kernel.getObject("sivir"), controller: "A", timingPoint: "chain-item-finalize"
  });
  const plan = buildCostPlan(context, {
    id: "sivir-mercenary.accelerate",
    printed: { energy: 4, power: ["Chaos"] },
    cost: {
      energy: { kind: "constant", value: 1 },
      payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Chaos"] }],
    },
  });
  assert.deepEqual(plan.total, {
    energy: 1,
    power: [{ amount: 1, allowedDomains: ["Chaos"] }],
    xp: 0,
    actions: [],
  });
  const receipt = payCostPlan(context, plan);
  assert.equal(receipt.paid, true);
  // 805.1.b.1: the Power portion is paid with the unit's own Chaos domain.
  assert.deepEqual(receipt.power.power, [{ requirementIndex: 0, from: "Chaos", amount: 1 }]);
  assert.equal(kernel.player("A").energy, 9);
});

// ---------------------------------------------------------------------------
// The recorded "if you've spent at least [A][A] this turn" gate.
// ---------------------------------------------------------------------------

test("sfd-143-221 Sivir, Mercenary: production static binding keeps the unresolved spend gate closed on a populated Board", () => {
  const { engine, kernel } = fixture({ cards: [
    { id: "sivir", cardId: CARD_ID, types: ["unit"], might: 4 },
    { id: "ally", types: ["unit"], might: 3 }
  ] });
  for (const id of ["sivir", "ally"]) {
    engine.commit({ type: "move-zone", object: kernel.ref(id), to: "battlefield", location: { type: "battlefield", id: "battlefield-1" } });
  }
  // Exercise the production adapter with the original static declarations.
  // Extra objects must never stand in for Power-spent amounts.
  const binder = createEngineStaticBinder(engine);
  binder.bindStatic(mightStatic, kernel.getObject("sivir"));
  binder.bindStatic(gankingStatic, kernel.getObject("sivir"));
  const snapshot = engine.layers.snapshot(kernel.ref("sivir"));
  assert.equal(snapshot.might, 4);
  assert.equal(snapshot.keywords.some(keyword => keyword.id.toLowerCase() === "ganking"), false);
  assert.equal(snapshot.buffs, 0);
  // The reference kernel records the action name as a string; both spellings are
  // checked so an accidental Power payment cannot slip through.
  assert.equal(kernel.events.some(event => event.action === "pay" || event.action?.type === "pay"), false);
});

test("sfd-143-221 Sivir, Mercenary: the production binder re-evaluates a supported compare against live source state", () => {
  const { engine, kernel } = fixture({ cards: [{ id: "sivir", cardId: CARD_ID, types: ["unit"], might: 4 }] });
  engine.commit({ type: "move-zone", object: kernel.ref("sivir"), to: "battlefield", location: { type: "battlefield", id: "battlefield-1" } });
  // A consumer control for compare support, using this card's Might effect on an
  // existing characteristic. This does not implement the printed spend gate.
  createEngineStaticBinder(engine).bindStatic({
    ...mightStatic,
    condition: {
      kind: "compare",
      left: { kind: "object-property", object: "self", property: "exhausted" },
      operator: "eq",
      right: { kind: "constant", value: true }
    }
  }, kernel.getObject("sivir"));
  assert.equal(engine.layers.snapshot(kernel.ref("sivir")).might, 4);
  engine.commit({ type: "exhaust", object: kernel.ref("sivir") });
  assert.equal(engine.layers.snapshot(kernel.ref("sivir")).might, 6);
  engine.commit({ type: "ready", object: kernel.ref("sivir") });
  assert.equal(engine.layers.snapshot(kernel.ref("sivir")).might, 4);
  assert.equal(kernel.getObject("sivir").buffs, 0);
});

test("sfd-143-221 Sivir, Mercenary: the declared spend read is not a live characteristic, so the gate fails closed", () => {
  // The card's own left-hand side, evaluated by the merged interpreter.
  const kernel = world().player("A", { energy: 10, power: ["Chaos", "Chaos"] }).unit("sivir", { might: 4 }).build();
  assert.throws(
    () => evaluateExpression(mightStatic.condition.left, environmentFor(kernel, "sivir")),
    error => error.constructor.name === "MissingInformation" && /powerSpentThisTurn/.test(error.message)
  );
  // The production condition wrapper therefore reports "not met" instead of a value.
  const { engine, kernel: bound } = fixture({ cards: [{ id: "sivir", cardId: CARD_ID, types: ["unit"], might: 4 }] });
  engine.commit({ type: "move-zone", object: bound.ref("sivir"), to: "battlefield", location: { type: "battlefield", id: "battlefield-1" } });
  createEngineStaticBinder(engine).bindStatic(mightStatic, bound.getObject("sivir"));
  assert.equal(engine.layers.snapshot(bound.ref("sivir")).might, 4);
  assert.throws(
    () => evaluateCondition(mightStatic.condition, environmentFor(bound, "sivir")),
    error => error.constructor.name === "MissingInformation" && /powerSpentThisTurn/.test(error.message)
  );
});

test("sfd-143-221 Sivir, Mercenary: the merged history reader counts real pay actions but exposes no spent amount", () => {
  // A "if you've spent" clause needs the paid amount. The merged history query
  // counts committed actions and rejects an amount dimension, so an action count
  // can never stand in for the printed [A][A].
  const kernel = world()
    .player("A", { energy: 10, power: ["Chaos", "Chaos"] })
    .unit("sivir", { might: 4, energy: 4, power: ["Chaos"] })
    .build();
  const context = bindResolveContext(kernel, {
    source: kernel.getObject("sivir"), controller: "A", timingPoint: "chain-item-finalize"
  });
  assert.equal(historyCount({ scope: "turn", action: "pay" }, context), 0);
  const plan = buildCostPlan(context, {
    id: "sivir-mercenary.spent-probe",
    printed: { energy: 4, power: ["Chaos"] },
    cost: {
      energy: { kind: "constant", value: 0 },
      payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Chaos"] }],
    },
  });
  assert.equal(payCostPlan(context, plan).paid, true);
  assert.equal(historyCount({ scope: "turn", action: "pay" }, context), 1);
  // The amount of that payment is not part of the query surface.
  assert.throws(
    () => historyCount({ scope: "turn", action: "pay", amount: 1 }, context),
    /Unsupported history query field/
  );
  // And the card's own read still has no value even though a real Power was paid.
  assert.throws(
    () => evaluateExpression(mightStatic.condition.left, environmentFor(kernel, "sivir")),
    error => error.constructor.name === "MissingInformation" && /powerSpentThisTurn/.test(error.message)
  );
});

test.todo(
  "sfd-143-221 Sivir, Mercenary: evaluate \"you've spent at least [A][A] this turn\" — no merged Expr reads " +
    "spent amounts this turn (ResolveContext exposes no spend receipt); source.powerSpentThisTurn is " +
    "an unresolved read position, and a missing read closes the bound condition (tests above)"
);

test("sfd-143-221 Sivir, Mercenary: the shipped program remains judge-gated before lifecycle binding", () => {
  const binding = createProgramBinding({ cardPrograms: [program] });
  assert.throws(() => binding.registry.get(CARD_ID), error => error.code === "judge-required" && /spent/.test(error.message));
});

// ---------------------------------------------------------------------------
// The Ganking half. RIFT-710's re-expansion engine really produces the route;
// the production engines still install the plain layer engine.
// ---------------------------------------------------------------------------

test("sfd-143-221 Sivir, Mercenary: the merged keyword re-expansion turns a granted Ganking into a real battlefield route", () => {
  const kernel = world().unit("sivir", { might: 4, location: { type: "battlefield", id: "bf-1" } }).build();
  const scoped = kernel.clone({ source: kernel.ref("sivir"), sourceSnapshot: kernel.getObject("sivir") });
  const run = runInstruction(grantKeyword, {
    keyword: { kind: "constant", value: "Ganking" },
    appliesTo: { kind: "constant", value: "self" },
    duration: { kind: "constant", value: "this-turn" }
  }, { world: scoped });
  assert.equal(run.result.status, "executed");

  const registry = new ContinuousEffectRegistry();
  for (const [index, entry] of scoped.continuousEffects.entries()) {
    registry.register(entry.effect, entry.duration ?? { type: "permanent" }, index + 1);
  }
  const context = source => bindResolveContext(kernel, { source, controller: source.controller });
  const layers = new KeywordGrantLayerEngine(kernel.objects, { context, registry });
  const snapshot = layers.evaluate(kernel.ref("sivir"));
  // 478 / 810.3: the granted keyword really is on the object...
  assert.equal(snapshot.keywords.some(keyword => keyword.id.toLowerCase() === "ganking"), true);
  // ...and the re-expansion expands it into the merged movement permission (810.1.b).
  assert.deepEqual(layers.keywordAbilities(kernel.ref("sivir")).map(ability => ability.effect.kind),
    ["continuous.movement"]);
  const query = movement(registry, kernel.ref("sivir"), snapshot, "A");
  assert.equal(query.canGank, true);
  assert.deepEqual(query.permissions.map(entry => entry.routes), [["battlefield-to-battlefield"]]);
});

test("sfd-143-221 Sivir, Mercenary: the granted Ganking really permits a Standard Move through the merged zones kernel", () => {
  // 144.4.c.1: the granted keyword, re-expanded into a movement permission, is
  // consumed by the real Standard Move entry point rather than by a pre-seeded
  // readiness flag.
  const given = duelWorld();
  const board = given.place(given.board, "sivir", "A", given.bf1);
  const kernel = world().unit("sivir", { might: 4, location: { type: "battlefield", id: given.bf1 } }).build();
  const scoped = kernel.clone({ source: kernel.ref("sivir"), sourceSnapshot: kernel.getObject("sivir") });
  runInstruction(grantKeyword, {
    keyword: { kind: "constant", value: "Ganking" },
    appliesTo: { kind: "constant", value: "self" },
    duration: { kind: "constant", value: "this-turn" }
  }, { world: scoped });
  const registry = new ContinuousEffectRegistry();
  for (const [index, entry] of scoped.continuousEffects.entries()) {
    registry.register(entry.effect, entry.duration ?? { type: "permanent" }, index + 1);
  }
  const context = source => bindResolveContext(kernel, { source, controller: source.controller });
  const layers = new KeywordGrantLayerEngine(kernel.objects, { context, registry });
  layers.evaluate(kernel.ref("sivir"));
  const rules = {
    registry,
    refForUnit: unit => kernel.ref(unit.objectId),
    objectForUnit: unit => layers.snapshot(kernel.ref(unit.objectId)),
  };
  const request = { actor: "A", unitUIDs: ["sivir"], destinationLocationId: given.bf2, timing: mainTiming("A") };
  // The readiness record deliberately reports no Ganking keyword: the route must
  // come from the re-expanded permission, not from the caller's boolean.
  const readiness = readinessFor(board, { ganking: [] });
  assert.throws(() => moveDuelUnitsStandard(board, readiness, request), /needs Ganking/);
  const moved = moveDuelUnitsStandard(board, readiness, request, rules);
  assert.equal(moved.board.units[0].locationId, given.bf2);
  assert.equal(moved.group.exhaustedCount, 1);
});

test.todo(
  "sfd-143-221 Sivir, Mercenary: grant [Ganking] for the turn in the production assembly — RIFT-710's " +
    "KeywordGrantLayerEngine really produces permission.routes and permits a Standard Move, but no " +
    "production wiring installs it (ChainEngine/TurnFlow use the plain LayerEngine) and its " +
    "unevaluable-condition path throws instead of failing closed, so the spent-read condition from " +
    "the first TODO must be readable before the printed grant can be live"
);

test("sfd-143-221 Sivir, Mercenary: the re-expansion engine cannot evaluate this card's own spent gate and throws", () => {
  // The merged re-expander evaluates a grant's condition through the plain
  // interpreter, which has no reader for "spent at least [A][A] this turn".
  // Feeding this card's real declaration in therefore throws instead of failing
  // closed the way programs/statics.ts does, so the printed grant cannot be
  // attached to the engine as-is.
  const kernel = world().unit("sivir", { might: 4, location: { type: "battlefield", id: "bf-1" } }).build();
  const context = source => bindResolveContext(kernel, { source, controller: source.controller });
  const layers = new KeywordGrantLayerEngine(kernel.objects, { context });
  layers.addContinuous({
    id: "sivir-mercenary.ganking-grant",
    layer: "ability",
    source: kernel.ref("sivir"),
    filter: { objectId: "sivir", zoneEntryId: kernel.ref("sivir").zoneEntryId, zone: "board" },
    effect: {
      kind: "continuous.grant-keyword",
      appliesTo: "self",
      keyword: { id: "Ganking" },
      condition: gankingStatic.condition
    }
  }, { type: "permanent" });
  assert.throws(
    () => layers.evaluate(kernel.ref("sivir")),
    error => error.constructor.name === "MissingInformation" && /powerSpentThisTurn/.test(error.message)
  );

  // Control: the same engine really does grant (and re-expand) Ganking when the
  // condition is one the merged interpreter can evaluate.
  const second = world().unit("sivir", { might: 4, location: { type: "battlefield", id: "bf-1" } }).build();
  const secondLayers = new KeywordGrantLayerEngine(second.objects, {
    context: source => bindResolveContext(second, { source, controller: source.controller })
  });
  secondLayers.addContinuous({
    id: "sivir-mercenary.ganking-grant",
    layer: "ability",
    source: second.ref("sivir"),
    filter: { objectId: "sivir", zoneEntryId: second.ref("sivir").zoneEntryId, zone: "board" },
    effect: {
      kind: "continuous.grant-keyword",
      appliesTo: "self",
      keyword: { id: "Ganking" },
      condition: {
        kind: "compare",
        left: { kind: "object-property", object: "self", property: "exhausted" },
        operator: "eq",
        right: { kind: "constant", value: false }
      }
    }
  }, { type: "permanent" });
  const granted = secondLayers.evaluate(second.ref("sivir"));
  assert.equal(granted.keywords.some(keyword => keyword.id.toLowerCase() === "ganking"), true);
  assert.deepEqual(secondLayers.keywordAbilities(second.ref("sivir")).map(ability => ability.effect.kind),
    ["continuous.movement"]);
});

test("sfd-143-221 Sivir, Mercenary: the production layer engine writes the keyword but produces no movement route (810.1.b/810.1.c)", () => {
  const kernel = world().unit("sivir", { might: 4, location: { type: "battlefield", id: "bf-1" } }).build();
  const scoped = kernel.clone({ source: kernel.ref("sivir"), sourceSnapshot: kernel.getObject("sivir") });
  const run = runInstruction(grantKeyword, {
    keyword: { kind: "constant", value: "Ganking" },
    appliesTo: { kind: "constant", value: "self" },
    duration: { kind: "constant", value: "this-turn" }
  }, { world: scoped });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(scoped.continuousEffects.map(entry => entry.effect.effect.kind), ["continuous.grant-keyword"]);

  // The production engine class: ChainEngine's default and TurnFlow both build a
  // plain LayerEngine, never the re-expanding subclass.
  const engine = createLayerEngine(kernel.objects, scoped.continuousEffects.map((entry, index) => ({
    ...entry,
    timestamp: 1,
    sequence: index + 1
  })));
  const snapshot = engine.evaluate(kernel.ref("sivir"));
  // The keyword really is on the object...
  assert.equal(snapshot.keywords.some(keyword => keyword.id.toLowerCase() === "ganking"), true);
  // ...but a plain LayerEngine never re-expands it, so movement() reads no route.
  assert.equal(movement(engine.registry, kernel.ref("sivir"), snapshot, "A").canGank, false);
  assert.equal(movement(engine.registry, kernel.ref("sivir"), snapshot, "A").battlefieldToBattlefield, false);
});

// ---------------------------------------------------------------------------
// The Accelerate half: the keyword expansion exists, the card-side producer does not.
// ---------------------------------------------------------------------------

test("sfd-143-221 Sivir, Mercenary: the merged Accelerate expansion declares the printed [1]+[C] cost and the 805.6 replacement", () => {
  const snapshot = {
    ref: { id: "sivir", zoneEntryId: 1 },
    cardId: CARD_ID,
    name: "Sivir, Mercenary",
    types: ["unit"],
    tags: ["Sivir", "Shurima", "Champion"],
    keywords: [{ id: "Accelerate" }],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "base", player: "A" },
    might: 4,
    energy: 4,
    power: ["Chaos"],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const acceleration = accelerationAbility(snapshot);
  assert.equal(acceleration.effect.cost.kind, "additional-cost");
  assert.equal(acceleration.effect.cost.optional, true);
  assert.deepEqual(acceleration.effect.cost.payments.map(payment => payment.kind), ["energy", "power"]);
  const replacement = expandProgram(lifted, snapshot).abilities.find(ability => ability.kind === "replacement");
  assert.ok(replacement, "the merged Accelerate KeywordDef emits the 805.6 enter-ready replacement");
  assert.equal(replacement.replaces.event, "object-enters-board");
  assert.equal(replacement.replaces.filter.exhausted, true);
  assert.equal(replacement.with[0].op, "effect.ready");
});

test("sfd-143-221 Sivir, Mercenary: the production lifecycle binder exposes the accelerate.cost declaration (805.1.b)", () => {
  const { engine, kernel } = fixture({ cards: [{ id: "sivir", cardId: CARD_ID, types: ["unit"], might: 4, keywords: [{ id: "Accelerate" }] }] });
  engine.commit({ type: "move-zone", object: kernel.ref("sivir"), to: "base", location: { type: "base", player: "A" } });
  const acceleration = accelerationAbility({ ...kernel.getObject("sivir"), keywords: [{ id: "Accelerate" }] });
  const handle = createEngineStaticBinder(engine).bindStatic(acceleration, kernel.getObject("sivir"));
  engine.layers.setObjects(kernel.objects);
  const exactSource = kernel.ref("sivir");
  assert.deepEqual(staticCostSources(engine).map(source => ({
    source: source.source,
    effect: source.ability.effect
  })), [{
    source: exactSource,
    effect: {
      kind: "cost.additional",
      id: `program:accelerate:program-cost:sivir:${exactSource.zoneEntryId}:0`,
      appliesTo: "self",
      optional: true,
      stage: "optional-additional",
      payments: [
        { kind: "energy", amount: { kind: "constant", value: 1 } },
        { kind: "power", amount: { kind: "constant", value: 1 } }
      ]
    }
  }]);
  handle.unbind();
  assert.deepEqual(staticCostSources(engine), []);
  // The lifecycle path installs the capability and reports no binding error.
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const errors = [];
  binding.attachLifecycle(engine, error => errors.push(error.message));
  engine.commit({ type: "move-zone", object: kernel.ref("sivir"), to: "battlefield", location: { type: "battlefield", id: "battlefield-1" } });
  assert.deepEqual(errors, []);
});

test.todo(
  "sfd-143-221 Sivir, Mercenary: resolve the still-unreadable 'spent at least [A][A] this turn' gate before " +
    "granting the conditional +2 Might and Ganking (135.2.e.5.a / 810.6.a)"
);
test("sfd-143-221 Sivir, Mercenary: the base-cost translator delegates Accelerate to the program binder (805.2)", () => {
  const acceleration = accelerationAbility({
    ...world().unit("sivir", { might: 4 }).build().getObject("sivir"),
    cardId: CARD_ID, keywords: [], energy: 4, power: ["Chaos"], zone: "hand", location: null
  });
  // Unit cost is not a base cost: the program binder owns it and the direct
  // translator fails closed instead of mistaking it for the base plan.
  assert.throws(
    () => translateCost(acceleration.effect.cost, "sivir-mercenary", "play"),
    error => error.code === "judge-required" && /Additional costs require the program cost adapter/.test(error.message)
  );
});
