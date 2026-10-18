// RIFT-803 EG-DAMAGE: non-target sets and divide for effect.damage (CR 355.10.d,
// 355.14, 418.1).
//
// Every case runs the real primitive (dist build) or the real interpreter
// adapter over the published card programs — no hand-resolved damage, no
// rewritten IR. Program cards keep their published judge-required validation
// metadata; the executable view differs only there and is not promotion
// evidence.
import assert from "node:assert/strict";
import test from "node:test";

import { resolveChainBody } from "../../dist/chain/interpreter-adapter.js";
import effectDamage from "../../dist/effects/instructions/effect.damage.js";
import { AwaitChoice, runInstruction, world } from "../../dist/effects/testing/index.js";
import { runCardScenario } from "../../dist/effects/testing/scenario/index.js";
import { ContinuousEffectRegistry } from "../../dist/layers/duration.js";
import { bindResolveContext } from "../../dist/events/action-adapter.js";
import firestorm from "../../../card-dsl/dist/cards/ogs/firestorm.js";
import volibear from "../../../card-dsl/dist/cards/ogn/volibear-furious.js";
import avalanche from "../../../card-dsl/dist/cards/rad/avalanche.js";
import crescent from "../../../card-dsl/dist/cards/unl/crescent-strike.js";
import glowstone from "../../../card-dsl/dist/cards/ven/glowstone.js";

const literal = value => ({ kind: "constant", value });
const executableView = program => ({ ...program, status: "executable", judgeReason: undefined });
const battlefield1 = { type: "battlefield", id: "bf-1" };
const battlefield2 = { type: "battlefield", id: "bf-2" };
const baseA = { type: "base", player: "A" };
const baseB = { type: "base", player: "B" };
const playAndResolve = [
  { type: "play", object: "spell", player: "A" },
  { type: "pass", player: "A" },
  { type: "pass", player: "B" },
];

// ---------------------------------------------------------------------------
// Representative programs through the default production assembly.
// ---------------------------------------------------------------------------

const firestormBoard = [
  { id: "spell", cardId: firestorm.canonicalCardId, types: ["spell"], zone: "hand", energy: 6, power: ["Fury"], might: null },
  { id: "battlefield-1", types: ["battlefield"], zone: "board", location: battlefield1, energy: null, power: null, might: null },
  { id: "battlefield-2", types: ["battlefield"], zone: "board", location: battlefield2, energy: null, power: null, might: null },
  { id: "enemy-here", owner: "B", types: ["unit"], zone: "board", location: battlefield1, might: 7 },
  { id: "enemy-elsewhere", owner: "B", types: ["unit"], zone: "board", location: battlefield2, might: 6 },
  { id: "ally-here", types: ["unit"], zone: "board", location: battlefield1, might: 5 },
  { id: "base-unit", owner: "B", types: ["unit"], zone: "board", location: baseB, might: 5 },
];

test("firestorm resolves its published non-target set through the real play chain (CR 355.10.d)", () => {
  assert.equal(firestorm.status, "judge-required");
  const result = runCardScenario(executableView(firestorm), {
    players: { A: { energy: 6, power: ["Fury"] } },
    objects: firestormBoard,
    answers: { "target:firestorm.battlefield": ["battlefield-1"] },
    operations: playAndResolve,
    expect: {
      objects: {
        spell: { zone: "trash" },
        "enemy-here": { zone: "board", damage: 3 },
        "enemy-elsewhere": { zone: "board", damage: 0 },
        "ally-here": { zone: "board", damage: 0 },
        "base-unit": { zone: "board", damage: 0 },
      },
      players: { A: { energy: 0 } },
      events: { includes: [{ timingPoint: "became-target", target: { ref: "battlefield-1" } }] },
      links: {
        "firestorm.deal-3-to-enemy-units.dealt": 3,
        "firestorm.deal-3-to-enemy-units.dealtCount": 1,
      },
    },
  });
  // The unit set was never a target: only the locked battlefield became one.
  assert.deepEqual(
    result.events.filter(event => event.timingPoint === "became-target").map(event => event.target.ref.id),
    ["battlefield-1"],
  );
});

test("avalanche damages every base unit through the real chain with zero targets locked (CR 355.10.d)", () => {
  assert.equal(avalanche.status, "judge-required");
  const result = runCardScenario(executableView(avalanche), {
    players: { A: { energy: 5, power: ["Body", "Body"] } },
    objects: [
      { id: "spell", cardId: avalanche.canonicalCardId, types: ["spell"], zone: "hand", energy: 5, power: ["Body"], might: null },
      { id: "friendly-base-unit", types: ["unit"], zone: "board", location: baseA, might: 5 },
      { id: "enemy-base-unit", owner: "B", types: ["unit"], zone: "board", location: baseB, might: 6 },
      { id: "battlefield-unit", owner: "B", types: ["unit"], zone: "board", location: battlefield1, might: 7 },
    ],
    operations: playAndResolve,
    expect: {
      objects: {
        spell: { zone: "trash" },
        "friendly-base-unit": { zone: "board", damage: 3 },
        "enemy-base-unit": { zone: "board", damage: 3 },
        "battlefield-unit": { zone: "board", damage: 0 },
      },
      players: { A: { energy: 0 } },
      links: { "avalanche.deal-3.dealt": 6, "avalanche.deal-3.dealtCount": 2 },
    },
  });
  assert.equal(result.events.some(event => event.timingPoint === "became-target"), false);
  assert.deepEqual(result.state.chain, []);
});

// Crescent Strike's unit spec keeps the sameLocationAs anchor, which the target
// planner still leaves judge-required (owned by the planner task, not this
// gap). Execute the original play body through the real interpreter with the
// locked battlefield from the real planner and the unit set bound directly.
test("crescent-strike deals 4 to the locked target and 1 to the programmatic others set", () => {
  assert.equal(crescent.status, "judge-required");
  const kernel = world()
    .hand("spell", { types: ["spell"], cardId: crescent.canonicalCardId, energy: 3, power: ["Mind"], might: null })
    .object("battlefield-1", { types: ["battlefield"], zone: "board", location: battlefield1, energy: null, power: null, might: null })
    .unit("main-target", { owner: "B", location: battlefield1, might: 5 })
    .unit("other-1", { owner: "B", location: battlefield1, might: 3 })
    .unit("other-2", { owner: "B", location: battlefield1, might: 3 })
    .unit("enemy-elsewhere", { owner: "B", location: battlefield2, might: 3 })
    .unit("ally", { location: battlefield1, might: 3 })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("spell"), controller: "A" });
  const play = crescent.abilities.find(ability => ability.kind === "play");
  context.setTargets("crescent-strike.battlefield", [kernel.ref("battlefield-1")]);
  context.setTargets("crescent-strike.enemy-unit", [kernel.ref("main-target")]);
  const body = play.body.map(instruction => ({ ...instruction, targets: undefined }));
  const outcome = resolveChainBody(body, context, { answers: {} });
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["crescent-strike.deal-4", "executed"],
    ["crescent-strike.deal-1-to-others", "executed"],
  ]);
  assert.equal(context.getObject("main-target").damage, 4);
  assert.equal(context.getObject("other-1").damage, 1);
  assert.equal(context.getObject("other-2").damage, 1);
  assert.equal(context.getObject("enemy-elsewhere").damage, 0);
  assert.equal(context.getObject("ally").damage, 0);
  assert.equal(outcome.linkedValues["crescent-strike.deal-4.dealt"], 4);
  assert.equal(outcome.linkedValues["crescent-strike.deal-1-to-others.dealt"], 2);
  assert.equal(outcome.linkedValues["crescent-strike.deal-1-to-others.dealtCount"], 2);
});

// Glowstone Illunimator's triggered ability kills itself with effect.kill and
// then damages the controller's units through a programmatic set. The kill
// happens first, so the set resolution reads the post-kill board state.
test("glowstone's triggered body executes kill-then-damage with the original linked values", () => {
  assert.equal(glowstone.status, "judge-required");
  const kernel = world()
    .player("A", {})
    .object("glowstone", { types: ["gear"], zone: "board", location: baseA, energy: null, power: null, might: null })
    .unit("ally-1", { location: baseA, might: 3, damage: 1 })
    .unit("ally-2", { location: baseA, might: 2 })
    .unit("enemy", { owner: "B", location: baseB, might: 3 })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("glowstone"), controller: "A" });
  const triggered = glowstone.abilities.find(ability => ability.kind === "triggered");
  const outcome = resolveChainBody(triggered.body, context, { answers: {} });
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["glowstone.kill-this", "executed"],
    ["glowstone.deal-5-to-your-units", "executed"],
  ]);
  assert.equal(context.getObject("glowstone").zone, "trash");
  assert.equal(context.getObject("ally-1").damage, 6); // 1 marked + 5 dealt
  assert.equal(context.getObject("ally-2").damage, 5);
  assert.equal(context.getObject("enemy").damage, 0);
  assert.deepEqual(outcome.linkedValues["glowstone.kill-this.killed"], [{ id: "glowstone", zoneEntryId: 1 }]);
  assert.equal(outcome.linkedValues["glowstone.deal-5-to-your-units.dealt"], 10);
  assert.equal(outcome.linkedValues["glowstone.deal-5-to-your-units.dealtCount"], 2);
});

// ---------------------------------------------------------------------------
// Primitive-level shapes: choose/pick/source selectors, choose bounds, and
// divide over the locked target set (CR 355.10.e–f, 355.14).
// ---------------------------------------------------------------------------

const damageSetup = () => {
  const kernel = world()
    .unit("ally", { location: battlefield1, might: 5 })
    .unit("enemy-1", { owner: "B", location: battlefield1, might: 5 })
    .unit("enemy-2", { owner: "B", location: battlefield1, might: 4 })
    .unit("enemy-3", { owner: "B", location: battlefield1, might: 3 })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("ally"), controller: "A" });
};

const chooseSet = (id, filter, bounds = {}) => literal({ kind: "choose", id, filter, ...bounds });
const querySet = filter => literal({ kind: "query", filter });
const targetSet = id => literal({ kind: "target", id });

for (const status of ["prevented", "replaced", "impossible"]) {
  test("a " + status + " deal inside the set negates without rolling back committed damage", () => {
    const kernel = damageSetup();
    kernel.addReplacement(action =>
      action.type === "damage" && action.target.id === "enemy-1" ? status : null);
    const run = runInstruction(effectDamage, {
      amount: literal(2),
      objects: querySet({ type: "unit", owner: "B" }),
    }, { world: kernel });
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, status === "prevented" ? "impossible" : status);
    assert.equal(kernel.getObject("enemy-1").damage, 0);
    assert.equal(kernel.getObject("enemy-2").damage, 2); // already committed
    assert.equal(kernel.getObject("enemy-3").damage, 2);
    assert.deepEqual(run.linked, {});
    assert.equal(run.linked.dealt, undefined);
  });
}

test("a choose set suspends without mutation, then replays only the chosen members", () => {
  const kernel = damageSetup();
  const args = { amount: literal(2), objects: chooseSet("pick-victims", { owner: "B" }) };
  const before = kernel.stateForTest();
  const asked = runInstruction(effectDamage, args, { world: kernel });
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.equal(asked.result, null);
  assert.deepEqual(asked.asked.request, {
    id: "pick-victims", type: "select-objects", chooser: "A", visibility: "public",
    options: [kernel.ref("enemy-1"), kernel.ref("enemy-2"), kernel.ref("enemy-3")],
    min: 1, max: 1,
  });
  assert.deepEqual(kernel.stateForTest(), before);
  const replayed = runInstruction(effectDamage, args, {
    world: kernel, answers: { "pick-victims": [kernel.ref("enemy-2")] },
  });
  assert.equal(replayed.result.status, "executed");
  assert.equal(kernel.getObject("enemy-1").damage, 0);
  assert.equal(kernel.getObject("enemy-2").damage, 2);
  assert.equal(kernel.getObject("enemy-3").damage, 0);
  assert.deepEqual(replayed.linked.dealtTo, [{ target: { id: "enemy-2", zoneEntryId: 1 }, amount: 2 }]);
});

test("choose-set answers outside the offered options or bounds are rejected before any commit", () => {
  const kernel = damageSetup();
  const args = { amount: literal(2), objects: chooseSet("pick-victims", { owner: "B" }, { min: 1, max: 2 }) };
  const before = kernel.stateForTest();
  for (const answer of [[], [kernel.ref("enemy-1"), kernel.ref("enemy-2"), kernel.ref("enemy-3")],
    [kernel.ref("enemy-1"), kernel.ref("enemy-1")], [{ id: "missing", zoneEntryId: 1 }],
    [kernel.ref("enemy-1"), null], "A", null]) {
    assert.throws(() => runInstruction(effectDamage, args, {
      world: kernel, answers: { "pick-victims": answer },
    }), /Invalid effect.damage choice answer|choice answer/);
    assert.deepEqual(kernel.stateForTest(), before);
  }
});

test("a choose set with no candidates and min > 0 is negated, min = 0 is a zero-damage no-op", () => {
  const emptyKernel = damageSetup();
  const negated = runInstruction(effectDamage, {
    amount: literal(2),
    objects: chooseSet("none-available", { controller: "missing" }),
  }, { world: emptyKernel });
  assert.equal(negated.result.status, "negated");
  assert.equal(negated.result.reason, "impossible");
  assert.equal(negated.asked, null);

  const optionalKernel = damageSetup();
  const optional = runInstruction(effectDamage, {
    amount: literal(2),
    objects: chooseSet("optional", { controller: "missing" }, { min: 0, max: 1 }),
  }, { world: optionalKernel, answers: { optional: [] } });
  assert.equal(optional.result.status, "executed");
  assert.deepEqual(optional.linked, { dealt: 0, dealtTo: [], dealtCount: 0 });
  assert.equal(optionalKernel.history({ action: "damage" }), 0);
});

test("target and pick sets keep using the locked sets without extra choice requests", () => {
  const kernel = damageSetup();
  const locked = runInstruction(effectDamage, {
    amount: literal(2), objects: targetSet("enemies"),
  }, { world: kernel, targets: { enemies: [kernel.ref("enemy-1"), kernel.ref("enemy-2")] } });
  assert.equal(locked.result.status, "executed");
  assert.equal(locked.linked.dealt, 4);
  assert.equal(kernel.history({ action: "damage" }), 2);

  const pickKernel = damageSetup();
  const picked = runInstruction(effectDamage, {
    amount: literal(1), objects: literal({ kind: "pick", id: "victims" }),
  }, { world: pickKernel, picks: { victims: [pickKernel.ref("enemy-3")] } });
  assert.equal(picked.result.status, "executed");
  assert.equal(pickKernel.getObject("enemy-3").damage, 1);

  const sourceKernel = damageSetup();
  const source = runInstruction(effectDamage, {
    amount: literal(1), objects: literal({ kind: "source" }),
  }, { world: sourceKernel });
  assert.equal(source.result.status, "executed");
  assert.equal(sourceKernel.getObject("ally").damage, 1);
});

test("an empty query set is an executed zero-damage no-op with zero links (CR 359.3.e.6)", () => {
  const kernel = damageSetup();
  const run = runInstruction(effectDamage, {
    amount: literal(3), objects: querySet({ type: "unit", owner: "missing" }),
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked, { dealt: 0, dealtTo: [], dealtCount: 0 });
  assert.equal(run.events.length, 0);
  assert.equal(kernel.history({ action: "damage" }), 0);
});

test("invalid set shapes are rejected by the args schema before execution", () => {
  const kernel = damageSetup();
  const cases = [
    [() => runInstruction(effectDamage, {
      amount: literal(1), target: "enemies", objects: querySet({ type: "unit", owner: "B" }),
    }, { world: kernel, targets: { enemies: [kernel.ref("enemy-1")] } }),
    /args\.target and args\.objects are mutually exclusive/],
    [() => runInstruction(effectDamage, {
      amount: literal(1), objects: querySet({ type: "unit", owner: "B" }), divide: true,
    }, { world: kernel }), /args\.objects cannot be divided/],
    [() => runInstruction(effectDamage, { amount: literal(1), target: "" }, { world: kernel }),
    /args\.target must be a TargetSpec id string/],
    [() => runInstruction(effectDamage, { amount: literal(1) }, { world: kernel }),
    /args\.target must be a TargetSpec id string/],
    [() => runInstruction(effectDamage, {
      amount: literal(1), objects: literal({ kind: "nonsense" }),
    }, { world: kernel }), /args\.objects must select source, target, pick, query, or choose/],
  ];
  const before = kernel.stateForTest();
  for (const [attempt, pattern] of cases) assert.throws(attempt, pattern);
  assert.deepEqual(kernel.stateForTest(), before);
});

// ---------------------------------------------------------------------------
// Divide over the locked target set (CR 355.14): the per-target amounts are
// chosen at resolution, every target must receive at least 1, and the total
// must equal the base amount exactly. Illegal answers negate without dealing.
// ---------------------------------------------------------------------------

const divideArgs = { amount: literal(5), target: "enemies", divide: true };
const divideTrial = (answers) => {
  const kernel = damageSetup();
  const refs = [kernel.ref("enemy-1"), kernel.ref("enemy-2"), kernel.ref("enemy-3")];
  const run = runInstruction(effectDamage, divideArgs, {
    world: kernel, targets: { enemies: refs }, answers,
  });
  return { kernel, run };
};

test("divide asks for a positive amount per locked target and replays a legal split", () => {
  const kernel = damageSetup();
  const asked = runInstruction(effectDamage, divideArgs, {
    world: kernel, targets: { enemies: [kernel.ref("enemy-1"), kernel.ref("enemy-2"), kernel.ref("enemy-3")] },
  });
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.deepEqual(asked.asked.request, {
    id: "effect.damage:divide:0", type: "number", chooser: "A", visibility: "public",
    min: 1, max: 3, prompt: "Divide damage among targets",
  });
  assert.equal(asked.result, null);
  const { kernel: replayKernel, run } = divideTrial({
    "effect.damage:divide:0": 3, "effect.damage:divide:1": 1, "effect.damage:divide:2": 1,
  });
  assert.equal(run.result.status, "executed");
  assert.equal(replayKernel.getObject("enemy-1").damage, 3);
  assert.equal(replayKernel.getObject("enemy-2").damage, 1);
  assert.equal(replayKernel.getObject("enemy-3").damage, 1);
  assert.equal(run.linked.dealt, 5);
  assert.equal(run.linked.dealtCount, 3);
  assert.deepEqual(run.linked.dealtTo.map(entry => [entry.target.id, entry.amount]), [
    ["enemy-1", 3], ["enemy-2", 1], ["enemy-3", 1],
  ]);
});

test("divide answers of 0, over-limit splits, and missing targets negate before any deal", () => {
  for (const answers of [
    { "effect.damage:divide:0": 5, "effect.damage:divide:1": 0, "effect.damage:divide:2": 0 },
    { "effect.damage:divide:0": 3, "effect.damage:divide:1": 3, "effect.damage:divide:2": 0 },
    { "effect.damage:divide:0": 3, "effect.damage:divide:1": 2 },
    { "effect.damage:divide:0": 0 },
  ]) {
    const { kernel, run } = divideTrial(answers);
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, "impossible");
    assert.equal(kernel.getObject("enemy-1").damage, 0);
    assert.equal(kernel.getObject("enemy-2").damage, 0);
    assert.equal(kernel.getObject("enemy-3").damage, 0);
    assert.deepEqual(run.linked, {});
  }
});

test("the published Volibear divide literal reaches the default production adapter", () => {
  assert.equal(volibear.status, "judge-required");
  const triggered = volibear.abilities.find(ability => ability.kind === "triggered");
  const [instruction] = triggered.body;
  assert.deepEqual(instruction.args.divide, { kind: "literal", value: true });
  const kernel = damageSetup();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("ally"), controller: "A" });
  const refs = [kernel.ref("enemy-1"), kernel.ref("enemy-2"), kernel.ref("enemy-3")];
  context.setTargets("volibear.enemy-units-here", refs);
  context.setAnswers({
    "volibear.split-damage/effect.damage%3Adivide%3A0": 3,
    "volibear.split-damage/effect.damage%3Adivide%3A1": 1,
    "volibear.split-damage/effect.damage%3Adivide%3A2": 1,
  });
  const outcome = resolveChainBody([instruction], context);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => entry.result.status), ["executed"]);
  assert.equal(context.getObject("enemy-1").damage, 3);
  assert.equal(context.getObject("enemy-2").damage, 1);
  assert.equal(context.getObject("enemy-3").damage, 1);
  assert.deepEqual(instruction.args.divide, { kind: "literal", value: true });
});

test("divide negates before asking when fewer damage than locked targets cannot be allocated", () => {
  const kernel = damageSetup();
  const run = runInstruction(effectDamage, {
    amount: literal(2), target: "enemies", divide: true,
  }, {
    world: kernel,
    targets: { enemies: [kernel.ref("enemy-1"), kernel.ref("enemy-2"), kernel.ref("enemy-3")] },
  });
  assert.equal(run.asked, null);
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.history({ action: "damage" }), 0);
});

// ---------------------------------------------------------------------------
// Linked reference sets (the effect.recycle convention): the damage consumer
// accepts refs written by a previous instruction, filters stale duplicates,
// and stays non-targeted.
// ---------------------------------------------------------------------------

test("a linked reference set damages the live members and filters stale or duplicate refs", () => {
  const kernel = damageSetup();
  const stale = { id: "enemy-1", zoneEntryId: 999 };
  const run = runInstruction(effectDamage, {
    amount: literal(2), objects: { kind: "linked-value", instructionId: "prev" },
  }, {
    world: kernel,
    linked: { prev: [kernel.ref("enemy-2"), stale, kernel.ref("enemy-3"), kernel.ref("enemy-3")] },
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy-1").damage, 0);
  assert.equal(kernel.getObject("enemy-2").damage, 2);
  assert.equal(kernel.getObject("enemy-3").damage, 2);
  assert.deepEqual(run.linked.dealtTo.map(entry => entry.target.id), ["enemy-2", "enemy-3"]);
});

test("a fully stale linked set is ignored as mistargeted", () => {
  const kernel = damageSetup();
  const run = runInstruction(effectDamage, {
    amount: literal(2), objects: { kind: "linked-value", instructionId: "prev" },
  }, { world: kernel, linked: { prev: [{ id: "enemy-1", zoneEntryId: 999 }] } });
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.history({ action: "damage" }), 0);
});

// ---------------------------------------------------------------------------
// Published identity: this gap unlocks execution, but the generated programs
// stay judge-required until phase 2 rewrites the card programs.
// ---------------------------------------------------------------------------

test("representative programs keep their published judge-required validation", () => {
  for (const program of [firestorm, avalanche, crescent, glowstone]) {
    assert.equal(program.status, "judge-required");
    assert.ok(program.judgeReason?.trim());
  }
  const [firestormDeal] = firestorm.abilities.find(ability => ability.kind === "play").body;
  assert.equal(firestormDeal.args.objects.value.kind, "query");
  const [avalancheDeal] = avalanche.abilities.find(ability => ability.kind === "play").body;
  assert.equal(avalancheDeal.args.objects.value.kind, "query");
  const [glowstoneDeal] = glowstone.abilities.find(ability => ability.kind === "triggered").body.slice(-1);
  assert.equal(glowstoneDeal.args.objects.value.kind, "query");
});

test("zero damage over a non-empty set commits no action and negates as impossible", () => {
  const kernel = damageSetup();
  const run = runInstruction(effectDamage, {
    amount: literal(0), objects: querySet({ type: "unit", owner: "B" }),
  }, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("enemy-1").damage, 0);
  assert.equal(kernel.history({ action: "damage" }), 0);
});

test("production modifier registry adds Bonus Damage per target and before a divide", () => {
  const kernel = damageSetup();
  const registry = new ContinuousEffectRegistry();
  registry.register({
    id: "fixture-bonus",
    layer: "ability",
    source: kernel.ref("ally"),
    filter: {},
    effect: {
      kind: "continuous.bonus-damage",
      amount: 1,
      appliesTo: "deal-actions",
      sourcePlayer: "A",
    },
  }, { type: "permanent" });
  const base = kernel.clone({ sourceSnapshot: kernel.getObject("ally"), controller: "A" });
  base.setTargets("enemies", [kernel.ref("enemy-1"), kernel.ref("enemy-2")]);
  const context = bindResolveContext(base, { continuousEffects: registry });
  const outcome = effectDamage.execute(context, effectDamage.argsSchema.parse({
    amount: literal(2), target: "enemies",
  }));
  assert.equal(outcome.status, "executed");
  assert.equal(context.getObject("enemy-1").damage, 3);
  assert.equal(context.getObject("enemy-2").damage, 3);

  const splitBase = kernel.clone({ sourceSnapshot: kernel.getObject("ally"), controller: "A" });
  splitBase.setTargets("enemies", [kernel.ref("enemy-1"), kernel.ref("enemy-2")]);
  splitBase.setAnswers({ "effect.damage:divide:0": 2, "effect.damage:divide:1": 1 });
  const split = bindResolveContext(splitBase, { continuousEffects: registry });
  const divided = effectDamage.execute(split, effectDamage.argsSchema.parse({
    amount: literal(2), target: "enemies", divide: true,
  }));
  assert.equal(divided.status, "executed");
  assert.equal(split.getObject("enemy-1").damage, 2);
  assert.equal(split.getObject("enemy-2").damage, 1);
});

test("explicit bonus and a production registry grant are summed exactly once", () => {
  const kernel = damageSetup();
  const registry = new ContinuousEffectRegistry();
  registry.register({
    id: "fixture-registry-bonus",
    layer: "ability",
    source: kernel.ref("ally"),
    filter: {},
    effect: { kind: "continuous.bonus-damage", amount: 2, appliesTo: "deal-actions", sourcePlayer: "A" },
  }, { type: "permanent" });
  const base = kernel.clone({ sourceSnapshot: kernel.getObject("ally"), controller: "A" });
  base.setTargets("enemies", [kernel.ref("enemy-1")]);
  const context = bindResolveContext(base, { continuousEffects: registry });
  const outcome = effectDamage.execute(context, effectDamage.argsSchema.parse({
    amount: literal(1), bonus: literal(3), target: "enemies",
  }));
  assert.equal(outcome.status, "executed");
  assert.equal(context.getObject("enemy-1").damage, 6);
  assert.equal(outcome.linkedValues.dealt, 6);
});

test("Bonus Damage does not turn a zero-base Deal into an actual Deal (CR 715.4)", () => {
  const kernel = damageSetup();
  const registry = new ContinuousEffectRegistry();
  registry.register({
    id: "fixture-zero-base-bonus",
    layer: "ability",
    source: kernel.ref("ally"),
    filter: {},
    effect: { kind: "continuous.bonus-damage", amount: 1, appliesTo: "deal-actions", sourcePlayer: "A" },
  }, { type: "permanent" });
  const base = kernel.clone({ sourceSnapshot: kernel.getObject("ally"), controller: "A" });
  base.setTargets("enemies", [kernel.ref("enemy-1")]);
  const context = bindResolveContext(base, { continuousEffects: registry });
  const outcome = effectDamage.execute(context, effectDamage.argsSchema.parse({
    amount: literal(0), target: "enemies",
  }));
  assert.equal(outcome.status, "negated");
  assert.equal(context.getObject("enemy-1").damage, 0);
  assert.equal(context.history({ action: "damage" }), 0);
});

test("a scoped grant still applies to the Deal source it names", () => {
  const kernel = damageSetup();
  const registry = new ContinuousEffectRegistry();
  registry.register({
    id: "self-scoped-bonus",
    layer: "ability",
    source: kernel.ref("enemy-1"),
    filter: {},
    effect: { kind: "continuous.bonus-damage", amount: 1, appliesTo: "deal-actions", sourcePlayer: "A", scope: { source: "self" } },
  }, { type: "permanent" });
  const base = kernel.clone({ sourceSnapshot: kernel.getObject("ally"), controller: "A" });
  base.setTargets("enemies", [kernel.ref("enemy-2")]);
  const context = bindResolveContext(base, { continuousEffects: registry });
  const outcome = effectDamage.execute(context, effectDamage.argsSchema.parse({
    amount: literal(2), target: "enemies",
  }));
  assert.equal(outcome.status, "executed");
  assert.equal(context.getObject("enemy-2").damage, 3);
});

test("controller spell/ability scope is consumed once and wildcard scope is not double counted", () => {
  const kernel = damageSetup();
  const registry = new ContinuousEffectRegistry();
  registry.register({
    id: "controller-scoped-bonus",
    layer: "ability",
    source: kernel.ref("ally"),
    filter: {},
    effect: { kind: "continuous.bonus-damage", amount: 1, appliesTo: "controller-spells-and-abilities", sourcePlayer: "A" },
  }, { type: "permanent" });
  registry.register({
    id: "wildcard-bonus",
    layer: "ability",
    source: kernel.ref("ally"),
    filter: {},
    effect: { kind: "continuous.bonus-damage", amount: 2, appliesTo: "any", sourcePlayer: "A" },
  }, { type: "permanent" });
  const base = kernel.clone({ sourceSnapshot: kernel.getObject("ally"), controller: "A" });
  base.setTargets("enemies", [kernel.ref("enemy-1")]);
  const context = bindResolveContext(base, { continuousEffects: registry });
  const outcome = effectDamage.execute(context, effectDamage.argsSchema.parse({
    amount: literal(1), target: "enemies",
  }));
  assert.equal(outcome.status, "executed");
  assert.equal(context.getObject("enemy-1").damage, 4);
});

test("a source-scoped generic grant does not leak to another Deal source", () => {
  const kernel = damageSetup();
  const registry = new ContinuousEffectRegistry();
  registry.register({
    id: "other-source-only",
    layer: "ability",
    source: kernel.ref("enemy-1"),
    filter: {},
    effect: {
      kind: "continuous.bonus-damage", amount: 1, appliesTo: "deal-actions",
      sourcePlayer: "A", scope: { source: kernel.ref("enemy-1") },
    },
  }, { type: "permanent" });
  const base = kernel.clone({ sourceSnapshot: kernel.getObject("ally"), controller: "A" });
  base.setTargets("enemies", [kernel.ref("enemy-2")]);
  const context = bindResolveContext(base, { continuousEffects: registry });
  const outcome = effectDamage.execute(context, effectDamage.argsSchema.parse({
    amount: literal(2), target: "enemies",
  }));
  assert.equal(outcome.status, "executed");
  assert.equal(context.getObject("enemy-2").damage, 2);
});

test("the production bonus-damage primitive registers a grant consumed by a real Deal", async () => {
  const { instructionDefinitionsById } = await import("../../dist/effects/instructions/registry.generated.js");
  const bonus = instructionDefinitionsById.get("continuous.bonus-damage");
  const kernel = damageSetup();
  const registered = runInstruction(bonus, {
    amount: literal(1), appliesTo: literal("deal-actions"), duration: literal("permanent"),
  }, { world: kernel });
  assert.equal(registered.result.status, "executed");
  const registry = new ContinuousEffectRegistry();
  for (const entry of kernel.continuousEffects) registry.register(entry.effect, entry.duration);
  const base = kernel.clone({ sourceSnapshot: kernel.getObject("ally"), controller: "A" });
  base.setTargets("enemies", [kernel.ref("enemy-1")]);
  const context = bindResolveContext(base, { continuousEffects: registry });
  const dealt = effectDamage.execute(context, effectDamage.argsSchema.parse({
    amount: literal(2), target: "enemies",
  }));
  assert.equal(dealt.status, "executed");
  assert.equal(base.getObject("enemy-1").damage, 3);
});
