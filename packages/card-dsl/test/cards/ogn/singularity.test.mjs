import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/singularity.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_CARD_ID = "card.hash-10b7d5be25093a4d318efd8639b6e34583bad10bf38adbf93b4c3733ea54221b";
const executableView = { ...program, status: "executable" };
delete executableView.judgeReason;

const play = program.abilities[0];
const damageInstruction = play.body[0];
const targetSpec = damageInstruction.targets[0];

/** Run the card's damage instruction with the given locked target objects. */
function dealWithLockedTargets(kernel, objectIds) {
  const locked = objectIds.map(id => kernel.ref(id));
  return runInstruction(
    damage,
    { amount: damageInstruction.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: locked } }
  );
}

test("Singularity program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Singularity identity and status match the printing", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-10b7d5be25093a4d318efd8639b6e34583bad10bf38adbf93b4c3733ea54221b"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /p4-spell-services\.ts/);
  assert.match(program.judgeReason, /deal-damage/);
  assert.match(program.judgeReason, /source owner\/actor/);
  assert.equal(program.sourceText, "Deal 6 to each of up to two units.");
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Singularity shipped judge-required status fails closed before production binding", () => {
  const binding = createProgramBinding({ cardPrograms: [program] });
  const kernel = world()
    .hand("singularity", { cardId: CANONICAL_CARD_ID, types: ["spell"] })
    .build();
  assert.throws(
    () => binding.describePlay(
      { type: "play", object: kernel.ref("singularity"), player: "A" },
      kernel.getObject("singularity")
    ),
    error => error.code === "judge-required" && /p4-spell-services\.ts/.test(error.message)
  );
});

test("Singularity has no keywords and one targeted damage instruction", () => {
  // No speed keyword: spells default to Action timing (CR 159.2.a).
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 6 },
    power: { kind: "constant", value: 2 }
  });

  assert.equal(damageInstruction.op, "effect.damage");
  assert.deepEqual(damageInstruction.args.amount, { kind: "constant", value: 6 });
  // Fixed 6 to each target: not split damage (CR 355.14), so no divide flag.
  assert.equal(damageInstruction.args.divide, undefined);
  assert.equal(damageInstruction.linkedTo, undefined);
  assert.equal(damageInstruction.picks, undefined);

  // "up to two units": a single TargetSpec, selection up-to, 0..2 units.
  assert.equal(damageInstruction.targets.length, 1);
  assert.equal(targetSpec.id, "damaged-units");
  assert.deepEqual(targetSpec.filter, { types: "unit" });
  assert.equal(targetSpec.selection, "up-to");
  assert.equal(targetSpec.min, 0);
  assert.equal(targetSpec.max, 2);
});

function productionScenario(overrides = {}) {
  return {
    players: {
      A: { energy: 8, power: ["Mind", "Mind"] },
      B: { energy: 8 }
    },
    objects: [
      {
        id: "singularity",
        cardId: CANONICAL_CARD_ID,
        program: executableView,
        types: ["spell"],
        zone: "hand",
        energy: 6,
        power: ["Mind"],
        might: null
      },
      {
        id: "ally-unit",
        owner: "A",
        types: ["unit"],
        zone: "board",
        location: { type: "battlefield", id: "production-field" },
        might: 9
      },
      {
        id: "enemy-unit",
        owner: "B",
        types: ["unit"],
        zone: "board",
        location: { type: "battlefield", id: "production-field" },
        might: 9
      },
      {
        id: "unselected-unit",
        owner: "B",
        types: ["unit"],
        zone: "board",
        location: { type: "battlefield", id: "production-field" },
        might: 9
      },
      {
        id: "non-unit",
        owner: "B",
        types: ["gear"],
        zone: "board",
        location: { type: "battlefield", id: "production-field" },
        might: 0
      }
    ],
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    priority: "A",
    ...overrides
  };
}

function objectState(result, id) {
  const value = result.state.objects.find(object => object.ref.id === id);
  assert.ok(value, `expected state for ${id}`);
  return value;
}

function damageEvents(result) {
  return result.events.filter(event => event.timingPoint === "damage-dealt");
}

function productionHarness({ energy = 8, power = ["Mind", "Mind"] } = {}) {
  const kernel = world()
    .player("A", { energy, power })
    .player("B", { energy: 8, power: [] })
    .hand("singularity", {
      cardId: CANONICAL_CARD_ID,
      types: ["spell"],
      energy: 6,
      power: ["Mind"],
      might: null
    })
    .unit("ally-unit", { owner: "A", might: 9 })
    .unit("enemy-unit", { owner: "B", might: 9 })
    .unit("unselected-unit", { owner: "B", might: 9 })
    .unit("non-unit", { owner: "B", types: ["gear"], might: 0 })
    .build();
  // WorldBuilder defaults null Might to 1, so seed this card's printed absence
  // before any Chain lifetime exists.
  const initial = kernel.snapshot();
  initial.objects.get("singularity").might = null;
  kernel.restore(initial);

  const asked = [];
  let selectedTargets = [];
  const choose = request => {
    asked.push(request);
    if (request.id === "target:damaged-units") return selectedTargets;
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new Error(`Unexpected choice ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source,
      controller,
      timingPoint,
      choose
    }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const binding = createProgramBinding({ cardPrograms: [executableView] });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false,
    describePlay: binding.describePlay
  });
  binding.attachLifecycle(engine);
  return {
    kernel,
    engine,
    binding,
    asked,
    selectTargets(targets) { selectedTargets = targets.map(id => kernel.ref(id)); }
  };
}

function playThroughBinding(harness, targets) {
  harness.selectTargets(targets);
  const source = harness.kernel.getObject("singularity");
  const action = { type: "play", object: harness.kernel.ref("singularity"), player: "A" };
  const draft = harness.binding.describePlay(action, source);
  assert.deepEqual(draft.cost.cost, {
    kind: "explicit",
    energy: { kind: "constant", value: 6 },
    power: { kind: "constant", value: 2 }
  });
  assert.deepEqual(draft.cost.domains, ["Mind"]);
  harness.engine.execute(draft);
  return harness.engine.items[0];
}

function assertRolledBack(harness, run) {
  const before = harness.kernel.snapshot();
  const links = harness.kernel.linkedSnapshot();
  const trace = harness.engine.trace;
  assert.throws(run);
  assert.deepEqual(harness.kernel.snapshot(), before);
  assert.deepEqual(harness.kernel.linkedSnapshot(), links);
  assert.deepEqual(harness.engine.trace, trace);
  assert.equal(harness.engine.items.length, 0);
  assert.equal(harness.engine.priority, "A");
  assert.equal(harness.kernel.getObject("singularity").zone, "hand");
}

test("Singularity executable-view production slice: 6 Energy + 2 Mind is paid before both priority passes, then exactly two units take 6", () => {
  const result = runCardScenario(executableView, productionScenario({
    answers: { "target:damaged-units": ["ally-unit", "enemy-unit"] },
    operations: [
      { type: "play", object: "singularity", player: "A" },
      { type: "pass", player: "A" },
      { type: "pass", player: "B" }
    ]
  }));

  assert.equal(result.state.players.A.energy, 2);
  assert.deepEqual(result.state.players.A.power, []);
  assert.equal(objectState(result, "singularity").zone, "trash");
  assert.equal(objectState(result, "ally-unit").damage, 6);
  assert.equal(objectState(result, "enemy-unit").damage, 6);
  assert.equal(objectState(result, "unselected-unit").damage, 0);
  assert.equal(objectState(result, "non-unit").damage, 0);
  assert.equal(result.state.priority, "A");
  assert.equal(result.state.chain.length, 0);

  const timings = result.events.map(event => event.timingPoint);
  const finalize = timings.indexOf("chain-item-finalize");
  const firstDamage = timings.indexOf("damage-dealt");
  assert.ok(finalize >= 0 && firstDamage > finalize);
  assert.deepEqual(
    result.events.filter(event => event.timingPoint === "became-target").map(event => event.target.ref.id),
    ["ally-unit", "enemy-unit"]
  );
  assert.deepEqual(
    damageEvents(result).map(event => [event.target.ref.id, event.amount, event.action.source.id]),
    [["ally-unit", 6, "singularity"], ["enemy-unit", 6, "singularity"]]
  );
  assert.equal(damageEvents(result).some(event => event.target.ref.id === "non-unit"), false);
  assert.deepEqual(result.links, {
    "deal-6-each.dealt": 12,
    "deal-6-each.dealtTo": [
      { target: { id: "ally-unit", zoneEntryId: 1 }, amount: 6 },
      { target: { id: "enemy-unit", zoneEntryId: 1 }, amount: 6 }
    ],
    "deal-6-each.dealtCount": 2
  });
  result.asserts();
});

test("Singularity executable-view production slice: up-to includes zero and one real target, and each pays once", () => {
  const zero = runCardScenario(executableView, productionScenario({
    answers: { "target:damaged-units": [] },
    operations: [
      { type: "play", object: "singularity", player: "A" },
      { type: "pass", player: "A" },
      { type: "pass", player: "B" }
    ]
  }));
  assert.equal(zero.state.players.A.energy, 2);
  assert.deepEqual(zero.state.players.A.power, []);
  assert.equal(objectState(zero, "singularity").zone, "trash");
  assert.deepEqual(zero.events.filter(event => event.timingPoint === "became-target"), []);
  assert.deepEqual(damageEvents(zero), []);
  // Observable play/choice/payment/resolution is complete. The host does not
  // currently propagate a zero-target instruction's linkedValues, so its exact
  // link receipt remains a separate core follow-up rather than false evidence.
  assert.deepEqual(zero.links, {});
  zero.asserts();

  const one = runCardScenario(executableView, productionScenario({
    answers: { "target:damaged-units": ["ally-unit"] },
    operations: [
      { type: "play", object: "singularity", player: "A" },
      { type: "pass", player: "A" },
      { type: "pass", player: "B" }
    ]
  }));
  assert.equal(one.state.players.A.energy, 2);
  assert.deepEqual(one.state.players.A.power, []);
  assert.equal(objectState(one, "ally-unit").damage, 6);
  assert.equal(objectState(one, "enemy-unit").damage, 0);
  assert.deepEqual(
    one.events.filter(event => event.timingPoint === "became-target").map(event => event.target.ref.id),
    ["ally-unit"]
  );
  assert.deepEqual(
    damageEvents(one).map(event => [event.target.ref.id, event.amount]),
    [["ally-unit", 6]]
  );
  assert.equal(one.links["deal-6-each.dealt"], 6);
  assert.equal(one.links["deal-6-each.dealtCount"], 1);
  one.asserts();
});

test("Singularity executable-view production slice: capacity, duplicate and non-unit choices fail atomically before finalization", () => {
  const cases = [
    {
      label: "three choices exceed the two-target cap",
      scenario: productionScenario({
        answers: { "target:damaged-units": ["ally-unit", "enemy-unit", "unselected-unit"] },
        operations: [{ type: "play", object: "singularity", player: "A" }]
      }),
      expected: /outside its required count/
    },
    {
      label: "the same unit cannot occupy two target slots",
      scenario: productionScenario({
        answers: { "target:damaged-units": ["enemy-unit", "enemy-unit"] },
        operations: [{ type: "play", object: "singularity", player: "A" }]
      }),
      expected: /duplicate or illegal target/
    },
    {
      label: "a gear is not a unit",
      scenario: productionScenario({
        answers: { "target:damaged-units": ["non-unit"] },
        operations: [{ type: "play", object: "singularity", player: "A" }]
      }),
      expected: /duplicate or illegal target/
    }
  ];

  for (const { label, scenario, expected } of cases) {
    assert.throws(() => runCardScenario(executableView, scenario), expected, label);
  }
});

test("Singularity executable-view production slice: insufficient Energy or matching Power cannot partially pay or resolve", () => {
  const cases = [
    {
      label: "Energy",
      players: { A: { energy: 5, power: ["Mind", "Mind"] }, B: { energy: 8 } },
      reason: /insufficient Energy/
    },
    {
      label: "Power",
      players: { A: { energy: 8, power: ["Mind"] }, B: { energy: 8 } },
      reason: /insufficient matching Power/
    },
    {
      label: "wrong Domain",
      players: { A: { energy: 8, power: ["Fury", "Fury"] }, B: { energy: 8 } },
      reason: /insufficient matching Power/
    }
  ];

  for (const { label, players, reason } of cases) {
    assert.throws(
      () => runCardScenario(executableView, productionScenario({
        players,
        answers: { "target:damaged-units": ["enemy-unit"] },
        operations: [
          { type: "play", object: "singularity", player: "A" },
          { type: "pass", player: "A" }
        ]
      })),
      reason,
      label
    );
  }
});

test("Singularity executable-view production slice: invalid pass actor cannot steal priority or resolve a finalized spell", () => {
  assert.throws(
    () => runCardScenario(executableView, productionScenario({
      answers: { "target:damaged-units": ["enemy-unit"] },
      operations: [
        { type: "play", object: "singularity", player: "A" },
        { type: "pass", player: "B" }
      ]
    })),
    /Player cannot pass now/
  );
});

test("Singularity executable-view production slice: Binding -> Chain Finalize pays before Priority, and Resolve waits for both passes", () => {
  const harness = productionHarness();
  const item = playThroughBinding(harness, ["ally-unit", "enemy-unit"]);

  assert.equal(item.status, "finalized");
  assert.deepEqual(item.targetPlans[0].selected, [
    harness.kernel.ref("ally-unit"),
    harness.kernel.ref("enemy-unit")
  ]);
  assert.deepEqual(item.costPlan.total, {
    energy: 6,
    power: [{ amount: 2, allowedDomains: ["Mind"] }],
    xp: 0,
    actions: []
  });
  assert.equal(item.payment.paid, true);
  assert.deepEqual(harness.kernel.player("A").power, []);
  assert.equal(harness.kernel.player("A").energy, 2);
  assert.equal(harness.kernel.getObject("ally-unit").damage, 0);
  assert.equal(harness.kernel.getObject("enemy-unit").damage, 0);
  assert.equal(harness.engine.turnState, "neutral-closed");
  assert.equal(harness.engine.priority, "A");
  assert.equal(harness.engine.focus, null);
  assert.equal(harness.engine.canAct("A", "action"), false);
  assert.equal(harness.engine.canAct("A", "reaction"), true);
  assert.equal(harness.engine.canAct("B", "reaction"), false);
  assert.ok(harness.engine.trace.some(entry => entry.step === "finalized" && entry.item === item.id));
  assert.ok(harness.engine.trace.some(entry => entry.step === "priority-granted" && entry.player === "A"));

  harness.engine.pass("A");
  assert.equal(harness.engine.priority, "B");
  assert.equal(harness.kernel.getObject("ally-unit").damage, 0);
  assert.equal(harness.kernel.getObject("enemy-unit").damage, 0);

  harness.engine.pass("B");
  assert.equal(harness.engine.priority, "A");
  assert.equal(harness.engine.turnState, "neutral-open");
  assert.equal(harness.engine.items.length, 0);
  assert.deepEqual(harness.engine.trace.filter(entry =>
    entry.item === item.id && ["pending", "finalized", "resolved", "removed"].includes(entry.step)
  ).map(entry => entry.step), ["pending", "finalized", "resolved", "removed"]);
  assert.equal(harness.kernel.getObject("ally-unit").damage, 6);
  assert.equal(harness.kernel.getObject("enemy-unit").damage, 6);
  assert.equal(harness.kernel.getObject("unselected-unit").damage, 0);
  assert.equal(harness.kernel.getObject("non-unit").damage, 0);
  assert.equal(harness.kernel.getObject("singularity").zone, "trash");
});

test("Singularity executable-view production slice: over-cap, duplicate and insufficient-payment Finalize failures roll back atomically", () => {
  const over = productionHarness();
  over.selectTargets(["ally-unit", "enemy-unit", "unselected-unit"]);
  assertRolledBack(over, () => {
    const source = over.kernel.getObject("singularity");
    const draft = over.binding.describePlay(
      { type: "play", object: over.kernel.ref("singularity"), player: "A" },
      source
    );
    over.engine.execute(draft);
  });

  const duplicate = productionHarness();
  duplicate.selectTargets(["enemy-unit", "enemy-unit"]);
  assertRolledBack(duplicate, () => {
    const source = duplicate.kernel.getObject("singularity");
    const draft = duplicate.binding.describePlay(
      { type: "play", object: duplicate.kernel.ref("singularity"), player: "A" },
      source
    );
    duplicate.engine.execute(draft);
  });

  const payment = productionHarness({ energy: 5 });
  payment.selectTargets(["enemy-unit"]);
  assertRolledBack(payment, () => {
    const source = payment.kernel.getObject("singularity");
    const draft = payment.binding.describePlay(
      { type: "play", object: payment.kernel.ref("singularity"), player: "A" },
      source
    );
    payment.engine.execute(draft);
  });
});

test("Singularity executable-view production slice: a Finalize-locked target moved through the host is mistargeted and the other target still takes 6", () => {
  const harness = productionHarness();
  const item = playThroughBinding(harness, ["ally-unit", "enemy-unit"]);
  const movedFrom = harness.kernel.ref("enemy-unit");
  const moved = harness.engine.commit({
    type: "move-zone",
    object: movedFrom,
    to: "hand"
  });
  assert.equal(moved.status, "done");
  assert.notEqual(harness.kernel.ref("enemy-unit").zoneEntryId, movedFrom.zoneEntryId);
  assert.deepEqual(item.targetPlans[0].selected, [
    harness.kernel.ref("ally-unit"),
    movedFrom
  ]);
  const available = item.targetPlans[0].selected.filter(ref => harness.kernel.object(ref) !== null);
  assert.deepEqual(available, [harness.kernel.ref("ally-unit")]);

  // A response-induced zone action creates a Cleanup task. HOT FEPR requires
  // completing it before Priority can pass (CR 319.6 / 319.8 / 334).
  harness.engine.advance();
  while (harness.engine.items.length > 0) harness.engine.pass(harness.engine.priority);
  assert.equal(harness.kernel.getObject("ally-unit").damage, 6);
  assert.equal(harness.kernel.getObject("enemy-unit").zone, "hand");
  assert.equal(harness.kernel.getObject("enemy-unit").damage, 0);
  assert.deepEqual(
    harness.engine.pipeline.events.filter(event => event.timingPoint === "damage-dealt")
      .map(event => event.target.ref.id),
    ["ally-unit"]
  );
  assert.equal(harness.kernel.linked("deal-6-each.dealt"), 6);
  assert.equal(harness.kernel.linked("deal-6-each.dealtCount"), 1);
  assert.equal(harness.kernel.getObject("singularity").zone, "trash");
});

test.todo(
  "Singularity: wrong/external actor source-ownership rejection on the default CardProgram -> ChainEngine path — showForeignPlay currently accepts a funded non-owner's play action because describePlay does not validate the source owner or actor; owner: engine-core ChainEngine/program-binding contract."
);

test("Singularity executable-view production slice: Finalize-locked target incarnations are retained through response and Resolve", () => {
  const run = runCardScenario(executableView, productionScenario({
    answers: { "target:damaged-units": ["ally-unit", "enemy-unit"] },
    operations: [
      { type: "play", object: "singularity", player: "A" },
      { type: "pass", player: "A" },
      { type: "pass", player: "B" }
    ]
  }));

  const targetEvents = run.events.filter(event => event.timingPoint === "became-target");
  assert.deepEqual(targetEvents.map(event => event.target.ref), [
    { id: "ally-unit", zoneEntryId: 1 },
    { id: "enemy-unit", zoneEntryId: 1 }
  ]);
  assert.equal(run.links["deal-6-each.dealt"], 12);
  assert.equal(run.state.chain.length, 0);
});

test.todo(
  "Singularity: no-target default-path linkedValues receipt (dealt/dealtTo/dealtCount = 0) — ChainEngine/host currently exposes {} while the primitive completed a no-damage resolution; owner: engine-core ChainEngine scenario adapter/integration contract."
);

test("Singularity golden execution: two locked units each take 6 (CR 418.1.c)", () => {
  const kernel = world().unit("first-unit").unit("second-unit").build();
  const run = dealWithLockedTargets(kernel, ["first-unit", "second-unit"]);

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("first-unit").damage, 6);
  assert.equal(kernel.getObject("second-unit").damage, 6);
  assert.deepEqual(run.events.map(event => event.action), ["damage", "damage"]);
  assert.equal(run.result.linkedValues.dealt, 12);
  assert.equal(run.result.linkedValues.dealtCount, 2);
});

test("Singularity golden execution: up-to allows choosing a single unit", () => {
  const kernel = world().unit("only-unit").unit("untouched-unit").build();
  const run = dealWithLockedTargets(kernel, ["only-unit"]);

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("only-unit").damage, 6);
  assert.equal(kernel.getObject("untouched-unit").damage, 0);
  assert.equal(run.result.linkedValues.dealt, 6);
  assert.equal(run.result.linkedValues.dealtCount, 1);
});

test("Singularity golden execution: only still-legal targets are damaged at resolution", () => {
  const kernel = world().unit("staying").unit("leaving").build();
  const stale = kernel.ref("leaving");
  // The second target leaves its zone before resolution; its reference dies.
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  const run = runInstruction(
    damage,
    { amount: damageInstruction.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [kernel.ref("staying"), stale] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("staying").damage, 6);
  assert.equal(run.result.linkedValues.dealt, 6);
  assert.equal(run.result.linkedValues.dealtCount, 1);
});

test.todo(
  "Singularity: Finalize-time target selection, the 0..2 cap enforcement, became-target " +
    "triggers, and target legality re-verification belong to the target system (RIFT-90)."
);
