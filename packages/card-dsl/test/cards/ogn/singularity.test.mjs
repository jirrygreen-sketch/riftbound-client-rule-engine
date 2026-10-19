import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/singularity.js";
import retreat from "../../../dist/cards/ogn/retreat.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { executeGameCommand } from "../../../../engine-core/dist/game/commands/index.js";
import { createMatch } from "../../../../engine-core/dist/game/lifecycle.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import {
  executeBasicRuneResourcePlan,
  planBasicRuneResourceActivation
} from "../../../../engine-core/dist/runes/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_CARD_ID = "card.hash-10b7d5be25093a4d318efd8639b6e34583bad10bf38adbf93b4c3733ea54221b";
const PRINTING_ID = "ogn-105-298";
const RETREAT_CARD_ID = "card.hash-e6e5c4f19dfe34b964bd6348cc46c60d1d565fb1949561f4c5c749101ed39bcf";

const DECK_MANIFEST = JSON.parse(readFileSync(
  new URL("../../../../../docs/plans/m1-decks.json", import.meta.url),
  "utf8"
));
const OFFICIAL_CATALOG = JSON.parse(readFileSync(
  new URL("../../../../card-data/data/deck-catalog.json", import.meta.url),
  "utf8"
));
const PRINTING = OFFICIAL_CATALOG.cards.find(card => card.id === PRINTING_ID);
assert.equal(PRINTING?.canonicalCardId, CANONICAL_CARD_ID);

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
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, "Deal 6 to each of up to two units.");
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Singularity executable status enters the production binding with the original IR", () => {
  const binding = createProgramBinding({ cardPrograms: [program] });
  const kernel = world()
    .hand("singularity", { cardId: CANONICAL_CARD_ID, types: ["spell"] })
    .build();
  assert.doesNotThrow(() => binding.describePlay(
    { type: "play", object: kernel.ref("singularity"), player: "A" },
    kernel.getObject("singularity")
  ));
});

test("Singularity production golden uses the original IR and its official printed cost without an executable view", () => {
  assert.equal(PRINTING.energy, 6);
  assert.equal(PRINTING.power, 2);
  assert.deepEqual(PRINTING.domains, ["Mind"]);
  assert.equal(PRINTING.might, null);
  assert.equal(PRINTING.ability, program.sourceText);
  assert.equal(program.status, "executable");

  const kernel = world()
    .hand("official-singularity", {
      cardId: CANONICAL_CARD_ID,
      types: ["spell"],
      energy: PRINTING.energy,
      power: PRINTING.domains,
      might: PRINTING.might
    })
    .build();
  // The shipped executable program and original IR bind directly.
  const binding = createProgramBinding({ cardPrograms: [program] });
  assert.doesNotThrow(() => binding.describePlay(
    { type: "play", object: kernel.ref("official-singularity"), player: "A" },
    kernel.getObject("official-singularity")
  ));
});

test("Singularity public Match: the shipped program, after real Basic Rune funding, starts from its original IR and lets Finalize pay", () => {
  const harness = publicMatch({ programs: [program] });
  const beforeEvents = structuredClone(harness.match.events());
  playThroughPublicCommand(harness);
  assert.equal(harness.kernel.player("A").energy, 2);
  assert.deepEqual(harness.kernel.player("A").power, []);
  assert.equal(harness.match.flow.chain.items.length, 1);
  assert.equal(harness.match.flow.chain.items[0].payment.paid, true);
  assert.notDeepEqual(harness.match.events(), beforeEvents);
  assert.deepEqual(harness.asked.map(request => request.id), ["target:damaged-units"]);
  assert.equal(harness.stateVersion(), 1);
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
        program,
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
  const binding = createProgramBinding({ cardPrograms: [program] });
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
  const result = runCardScenario(program, productionScenario({
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
  const zero = runCardScenario(program, productionScenario({
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

  const one = runCardScenario(program, productionScenario({
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
    assert.throws(() => runCardScenario(program, scenario), expected, label);
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
      () => runCardScenario(program, productionScenario({
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
    () => runCardScenario(program, productionScenario({
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
  const run = runCardScenario(program, productionScenario({
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

test("Singularity executable-view primitive slice: a replacement can prevent the first damage action while the other locked target still receives 6", () => {
  // This reproduces the production primitive's ordered per-target transaction.
  // The scenario harness does not expose replacement installation, so use its
  // same TestWorld reference kernel here only to prove the replacement outcome.
  const kernel = world()
    .player("A", { energy: 8, power: ["Mind", "Mind"] })
    .unit("source", { owner: "A", zone: "chain", might: null })
    .unit("first", { owner: "B", might: 10 })
    .unit("second", { owner: "B", might: 10 })
    .build();
  kernel.addReplacement(action => action.type === "damage" && action.target.id === "first"
    ? { status: "prevent" }
    : null);
  const run = runInstruction(
    damage,
    { amount: damageInstruction.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [kernel.ref("first"), kernel.ref("second")] } }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.getObject("first").damage, 0);
  assert.equal(kernel.getObject("second").damage, 6);
  assert.deepEqual(run.events.map(event => event.action), ["damage", "damage"]);
});

function realM1Deck() {
  const candidate = DECK_MANIFEST.candidates.find(entry => entry.id === "rumble-sfd");
  assert.ok(candidate, "RIFT-857 M1 manifest contains the Rumble precon");
  assert.ok(candidate.officialCardList.some(entry =>
    entry.canonicalCardId === CANONICAL_CARD_ID && entry.quantity === 1),
  "the source manifest contains the requested Singularity identity exactly once");
  const printingByCanonical = new Map(OFFICIAL_CATALOG.cards.map(card => [card.canonicalCardId, card]));
  const expand = (entries, zone) => entries.flatMap(entry => {
    const printing = printingByCanonical.get(entry.canonicalCardId);
    assert.ok(printing, `catalog printing for ${entry.canonicalCardId}`);
    return Array.from({ length: entry.quantity }, (_, index) => ({
      id: `${candidate.id}:${zone}:${index}:${entry.canonicalCardId}`,
      cardId: entry.canonicalCardId,
      name: entry.name,
      types: [entry.cardType.toLowerCase()],
      tags: [...printing.tags],
      domains: [...printing.domains],
      energy: zone === "rune" ? null : printing.energy,
      power: zone === "rune" ? null : printing.power,
      might: printing.might
    }));
  });
  const legend = candidate.officialCardList.find(entry => entry.zone === "legend");
  const champion = candidate.officialCardList.find(entry => entry.zone === "champion" &&
    entry.name === candidate.chosenChampion);
  assert.ok(legend && champion);
  const mainDeck = expand(candidate.officialCardList.filter(entry => entry.zone === "mainDeck"), "main");
  const championIndex = mainDeck.findIndex(card => card.cardId === champion.canonicalCardId);
  if (championIndex >= 0) mainDeck.splice(championIndex, 1);
  return {
    mainDeck,
    runeDeck: expand(candidate.officialCardList.filter(entry => entry.zone === "runes"), "rune"),
    championLegend: expand([legend], "legend")[0],
    chosenChampion: expand([champion], "champion")[0],
    battlefields: expand(candidate.officialCardList.filter(entry => entry.zone === "battlefields"), "battlefield")
  };
}

function fundFromBasicRunes(kernel, match, energy, power, player = "A") {
  const before = kernel.player(player);
  assert.deepEqual([before.energy, before.power], [0, []]);
  const initialRuneCount = before.runePool.length;
  const channeled = kernel.perform({ type: "channel-rune", player, amount: 8 });
  assert.equal(channeled.status, "done");
  const runes = kernel.objectsInZone(player, "rune-zone").map(ref => kernel.getObject(ref.id));
  assert.equal(runes.length, initialRuneCount + 8, "opening-phase Runes plus eight explicitly channeled Runes");
  assert.ok(runes.every(rune => rune.tags.includes("Basic")));
  const catalogByCanonical = new Map(OFFICIAL_CATALOG.cards.map(card => [card.canonicalCardId, card]));
  const resolveIdentity = cardId => {
    const card = catalogByCanonical.get(cardId);
    assert.ok(card && card.domains.length === 1);
    return { cardId, canonicalCardId: cardId, domain: card.domains[0] };
  };
  const spend = (rune, type, activationId) => {
    const plan = planBasicRuneResourceActivation({
      chain: match.flow.chain,
      state: { objects: () => kernel.objects, player: id => kernel.player(id) },
      resolveIdentity,
      request: {
        actor: player,
        activationId,
        intent: { type, runeObjectId: rune.ref.id, zoneEntryId: rune.ref.zoneEntryId },
        window: { kind: "priority" }
      }
    });
    return executeBasicRuneResourcePlan(plan);
  };
  const spentRefs = new Set();
  let powerAdded = 0;
  for (const [index, domain] of power.entries()) {
    const rune = kernel.objectsInZone(player, "rune-zone")
      .map(ref => kernel.getObject(ref.id))
      .find(candidate => catalogByCanonical.get(candidate.cardId).domains[0] === domain);
    if (!rune) break;
    assert.equal(spend(rune, "rune-power", `${player}-singularity-power-${index}`).powerAdded[0], domain);
    spentRefs.add(rune.ref.id);
    powerAdded++;
  }
  const energyRunes = kernel.objectsInZone(player, "rune-zone")
    .map(ref => kernel.getObject(ref.id))
    .filter(rune => !rune.exhausted && !spentRefs.has(rune.ref.id));
  const energyAdded = Math.min(energy, energyRunes.length);
  for (const [index, rune] of energyRunes.slice(0, energyAdded).entries()) {
    assert.equal(spend(rune, "rune-energy", `${player}-singularity-energy-${index}`).energyAdded, 1);
  }
  assert.deepEqual(
    [kernel.player(player).energy, kernel.player(player).power],
    [energyAdded, power.slice(0, powerAdded)]
  );
}

function publicMatch({
  /** Target resources are produced from real Basic Rune rules actions. */
  energy = 8,
  power = ["Mind", "Mind"],
  targets = ["ally-unit", "enemy-unit"],
  programs = [program]
} = {}) {
  const kernel = world()
    .player("A")
    .player("B")
    .unit("ally-unit", { owner: "A", controller: "A", might: 10 })
    .unit("enemy-unit", { owner: "B", controller: "B", might: 10 })
    .unit("unselected-unit", { owner: "B", controller: "B", might: 10 })
    .hand("non-unit", { owner: "B", controller: "B", types: ["gear"], might: 0 })
    .build();
  const asked = [];
  const choose = request => {
    asked.push(request);
    if (request.id === "target:damaged-units") return targets.map(id => kernel.ref(id));
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
  // Seed 3 is a fixed, reproducible opening hand in the official Rumble list.
  // setup.ts openingHands proves it contains exactly one Singularity.
  const match = createMatch({
    host: { ...host, player: player => kernel.player(player) },
    decks: [realM1Deck(), realM1Deck()],
    seed: 3,
    battlefieldChoice: [0, 1],
    mulligans: [[], []],
    firstPlayer: 0
  });
  // Every positive public-chain case uses the shipped program itself.
  const binding = createProgramBinding({ cardPrograms: programs });
  binding.attachLifecycle(match.flow.chain);
  const sources = kernel.objectsInZone("A", "hand")
    .map(ref => kernel.getObject(ref.id))
    .filter(object => object.cardId === CANONICAL_CARD_ID);
  assert.equal(sources.length, 1, "selection target is A-owned and hidden from B");
  const [source] = sources;
  fundFromBasicRunes(kernel, match, energy, power);
  let stateVersion = 0;
  const send = (actor, command, contextVersion = stateVersion) => {
    const result = executeGameCommand(
      { match, binding, stateVersion: contextVersion },
      actor,
      { ...command, stateVersion: contextVersion }
    );
    if (contextVersion === stateVersion) stateVersion += 1;
    return result;
  };
  return { kernel, match, binding, source, asked, send, stateVersion: () => stateVersion };
}

function playThroughPublicCommand(harness) {
  return harness.send("A", {
    type: "play",
    commandId: "singularity-play",
    cardObjectId: harness.source.ref.id
  });
}

test("Singularity public Match: Finalize pays 6 Energy + 2 Mind, closes to Priority, and resolves exactly two selected units for 6 each", () => {
  const harness = publicMatch();
  assert.deepEqual(harness.match.setup.openingHands.A.filter(id => id === CANONICAL_CARD_ID), [CANONICAL_CARD_ID]);
  const before = harness.match.events().length;
  playThroughPublicCommand(harness);
  const [item] = harness.match.flow.chain.items;

  assert.equal(item.status, "finalized");
  assert.deepEqual(item.targetPlans[0].selected, [harness.kernel.ref("ally-unit"), harness.kernel.ref("enemy-unit")]);
  assert.deepEqual(item.costPlan.total, {
    energy: 6,
    power: [{ amount: 2, allowedDomains: ["Mind"] }],
    xp: 0,
    actions: []
  });
  assert.equal(item.payment.paid, true);
  assert.equal(harness.kernel.player("A").energy, 2);
  assert.deepEqual(harness.kernel.player("A").power, []);
  assert.equal(harness.kernel.getObject("ally-unit").damage, 0);
  assert.equal(harness.kernel.getObject("enemy-unit").damage, 0);
  assert.equal(harness.match.flow.chain.turnState, "neutral-closed");
  assert.equal(harness.match.flow.chain.priority, "A");
  assert.equal(harness.match.flow.chain.focus, null);
  assert.equal(harness.match.flow.chain.canAct("A", "action"), false);
  assert.equal(harness.match.flow.chain.canAct("A", "reaction"), true);
  assert.equal(harness.match.flow.chain.canAct("B", "reaction"), false);

  harness.send("A", { type: "pass", commandId: "singularity-pass-a" });
  assert.equal(harness.match.flow.chain.priority, "B");
  assert.equal(harness.kernel.getObject("ally-unit").damage, 0);
  assert.equal(harness.kernel.getObject("enemy-unit").damage, 0);
  harness.send("B", { type: "pass", commandId: "singularity-pass-b" });

  const events = harness.match.events().slice(before);
  assert.deepEqual(
    events.filter(event => event.timingPoint === "became-target").map(event => event.target.ref.id),
    ["ally-unit", "enemy-unit"]
  );
  const damageFacts = events.filter(event => event.timingPoint === "damage-dealt");
  assert.deepEqual(damageFacts.map(event => [event.target.ref.id, event.amount]),
    [["ally-unit", 6], ["enemy-unit", 6]]);
  assert.equal(new Set(damageFacts.map(event => event.actionId)).size, 2);
  const finalize = events.findIndex(event => event.timingPoint === "chain-item-finalize");
  const damage = events.findIndex(event => event.timingPoint === "damage-dealt");
  const cardPlayed = events.findIndex(event => event.timingPoint === "card-played");
  const resolved = events.findIndex(event => event.timingPoint === "chain-item-resolve");
  assert.ok(finalize >= 0 && damage > finalize && cardPlayed > damage && resolved > cardPlayed);
  assert.equal(harness.kernel.getObject("ally-unit").damage, 6);
  assert.equal(harness.kernel.getObject("enemy-unit").damage, 6);
  assert.equal(harness.kernel.getObject("unselected-unit").damage, 0);
  assert.equal(harness.kernel.getObject("non-unit").damage, 0);
  assert.equal(harness.kernel.getObject(harness.source.ref.id).zone, "trash");
  assert.equal(harness.match.flow.chain.items.length, 0);
  assert.equal(harness.match.flow.chain.turnState, "neutral-open");
  assert.equal(harness.match.flow.chain.priority, "A");
});

test("Singularity public Match: up-to accepts zero and one target; each pays once, resolves normally and ignores non-unit candidates", () => {
  const zero = publicMatch({ targets: [] });
  playThroughPublicCommand(zero);
  zero.send("A", { type: "pass", commandId: "zero-pass-a" });
  zero.send("B", { type: "pass", commandId: "zero-pass-b" });
  assert.deepEqual(zero.match.flow.chain.items, []);
  assert.equal(zero.kernel.player("A").energy, 2);
  assert.deepEqual(zero.kernel.player("A").power, []);
  assert.equal(zero.kernel.getObject(zero.source.ref.id).zone, "trash");
  assert.equal(zero.match.events().some(event => event.timingPoint === "became-target"), false);
  assert.equal(zero.match.events().some(event => event.timingPoint === "damage-dealt"), false);
  for (const id of ["ally-unit", "enemy-unit", "unselected-unit", "non-unit"]) {
    assert.equal(zero.kernel.getObject(id).damage, 0);
  }

  const one = publicMatch({ targets: ["ally-unit"] });
  playThroughPublicCommand(one);
  one.send("A", { type: "pass", commandId: "one-pass-a" });
  one.send("B", { type: "pass", commandId: "one-pass-b" });
  assert.equal(one.kernel.getObject("ally-unit").damage, 6);
  assert.equal(one.kernel.getObject("enemy-unit").damage, 0);
  assert.equal(one.kernel.getObject("unselected-unit").damage, 0);
  assert.deepEqual(
    one.match.events().filter(event => event.timingPoint === "damage-dealt")
      .map(event => [event.target.ref.id, event.amount]),
    [["ally-unit", 6]]
  );
  assert.equal(one.kernel.player("A").energy, 2);
  assert.deepEqual(one.kernel.player("A").power, []);
});

test("Singularity public Match boundaries: target cap, duplicate/non-unit target, insufficient or wrong-domain Power and foreign actor roll back", () => {
  const cases = [
    { options: { targets: ["ally-unit", "enemy-unit", "unselected-unit"] }, error: /outside its required count/ },
    { options: { targets: ["enemy-unit", "enemy-unit"] }, error: /duplicate or illegal target/ },
    { options: { targets: ["non-unit"] }, error: /duplicate or illegal target/ },
    { options: { energy: 5 }, error: /insufficient Energy/ },
    { options: { power: ["Mind"] }, error: /insufficient matching Power/ },
    { options: { power: ["Fury", "Fury"] }, error: /insufficient matching Power/ }
  ];
  for (const { options, error } of cases) {
    const harness = publicMatch(options);
    const before = harness.kernel.snapshot();
    assert.throws(() => playThroughPublicCommand(harness), error);
    assert.deepEqual(harness.kernel.snapshot(), before);
    assert.deepEqual(harness.match.flow.chain.items, []);
    assert.equal(harness.match.flow.chain.priority, "A");
    assert.equal(harness.kernel.getObject(harness.source.ref.id).zone, "hand");
  }

  const foreign = publicMatch();
  const before = foreign.kernel.snapshot();
  assert.throws(
    () => foreign.send("B", {
      type: "play",
      commandId: "singularity-foreign",
      cardObjectId: foreign.source.ref.id
    }),
    error => error.name === "GameCommandError" && error.code === "unavailable-object"
  );
  assert.deepEqual(foreign.kernel.snapshot(), before);
  assert.deepEqual(foreign.match.flow.chain.items, []);
});

test("Singularity public Match: invalid or duplicate Pass and stale stateVersion do not advance Priority or resolve the spell", () => {
  const invalid = publicMatch();
  playThroughPublicCommand(invalid);
  assert.throws(
    () => invalid.send("B", { type: "pass", commandId: "bad-priority-pass" }),
    /Player cannot pass now/
  );
  assert.equal(invalid.match.flow.chain.priority, "A");
  assert.equal(invalid.match.flow.chain.items[0].status, "finalized");
  assert.equal(invalid.match.events().some(event => event.timingPoint === "damage-dealt"), false);

  const duplicate = publicMatch();
  playThroughPublicCommand(duplicate);
  duplicate.send("A", { type: "pass", commandId: "duplicate-pass" });
  const beforePriority = duplicate.match.flow.chain.priority;
  const beforeItems = structuredClone(duplicate.match.flow.chain.items);
  assert.throws(
    () => duplicate.send("A", { type: "pass", commandId: "duplicate-pass" }),
    /Player cannot pass now/
  );
  assert.equal(duplicate.match.flow.chain.priority, beforePriority);
  assert.deepEqual(duplicate.match.flow.chain.items, beforeItems);

  const stale = publicMatch();
  playThroughPublicCommand(stale);
  const before = stale.kernel.snapshot();
  assert.throws(
    () => executeGameCommand(
      { match: stale.match, binding: stale.binding, stateVersion: 1 },
      "A",
      { type: "pass", commandId: "stale-pass", stateVersion: 0 }
    ),
    error => error.code === "stale-version"
  );
  assert.deepEqual(stale.kernel.snapshot(), before);
  assert.equal(stale.match.flow.chain.priority, "A");
  assert.equal(stale.match.flow.chain.items[0].status, "finalized");
});

test("Singularity public Match: a unit changed after Priority passes is mistargeted while the remaining locked target still takes 6 (359.3.e.8)", () => {
  const harness = publicMatch();
  playThroughPublicCommand(harness);
  const [item] = harness.match.flow.chain.items;
  const locked = structuredClone(item.targetPlans[0].selected);
  assert.deepEqual(locked, [harness.kernel.ref("ally-unit"), harness.kernel.ref("enemy-unit")]);

  harness.send("A", { type: "pass", commandId: "loss-pass-a" });
  assert.equal(harness.match.flow.chain.priority, "B");
  const movedFrom = harness.kernel.ref("enemy-unit");
  harness.kernel.perform({ type: "move-zone", object: movedFrom, to: "hand" });
  assert.notEqual(harness.kernel.ref("enemy-unit").zoneEntryId, movedFrom.zoneEntryId);
  harness.send("B", { type: "pass", commandId: "loss-pass-b" });

  assert.deepEqual(item.targetPlans[0].selected, locked);
  assert.equal(harness.kernel.getObject("ally-unit").damage, 6);
  assert.equal(harness.kernel.getObject("enemy-unit").damage, 0);
  assert.deepEqual(
    harness.match.events().filter(event => event.timingPoint === "damage-dealt")
      .map(event => [event.target.ref.id, event.amount]),
    [["ally-unit", 6]]
  );
  assert.equal(harness.kernel.getObject(harness.source.ref.id).zone, "trash");
  assert.deepEqual(harness.match.flow.chain.items, []);
});

test("Singularity public Match: a real B-owned Retreat removes one locked target in reaction and only the remaining target takes 6", () => {
  const kernel = world()
    .player("A")
    .player("B")
    .unit("ally-unit", { owner: "A", controller: "A", might: 10 })
    .unit("enemy-unit", { owner: "B", controller: "B", might: 10 })
    .unit("unselected-unit", { owner: "B", controller: "B", might: 10 })
    .build();
  kernel.addObject({
    ref: { id: "retreat", zoneEntryId: 1 },
    owner: "B",
    controller: "B",
    cardId: RETREAT_CARD_ID,
    name: "Retreat",
    types: ["spell"],
    tags: [],
    keywords: [],
    domains: ["Mind"],
    energy: 1,
    power: null,
    might: null,
    zone: "hand",
    location: null,
    combatRole: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: true,
    counters: {},
    empowered: 0
  }, "hand");
  const retreatSource = kernel.getObject("retreat");
  const chooseRetreatTarget = request => {
    if (request.id === "target:damaged-units") return [kernel.ref("ally-unit"), kernel.ref("enemy-unit")];
    if (request.id === "target:friendly-unit") return [kernel.ref("enemy-unit")];
    throw new Error(`Unexpected Retreat choice ${request.id}`);
  };
  const retreatHost = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: chooseRetreatTarget,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source,
      controller,
      timingPoint,
      choose: chooseRetreatTarget
    }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const match = createMatch({
    host: { ...retreatHost, player: player => kernel.player(player) },
    decks: [realM1Deck(), realM1Deck()],
    seed: 3,
    battlefieldChoice: [0, 1],
    mulligans: [[], []],
    firstPlayer: 0
  });
  const retreatBinding = createProgramBinding({ cardPrograms: [program, retreat] });
  retreatBinding.attachLifecycle(match.flow.chain);
  const singularity = kernel.objectsInZone("A", "hand")
    .map(ref => kernel.getObject(ref.id))
    .find(object => object.cardId === CANONICAL_CARD_ID);
  assert.ok(singularity);
  let version = 0;
  const send = (actor, command) => {
    const result = executeGameCommand(
      { match, binding: retreatBinding, stateVersion: version },
      actor,
      { ...command, stateVersion: version }
    );
    version += 1;
    return result;
  };
  fundFromBasicRunes(kernel, match, 8, ["Mind", "Mind"], "A");
  send("A", { type: "play", commandId: "response-singularity", cardObjectId: singularity.ref.id });
  send("A", { type: "pass", commandId: "response-play-pass-a" });
  // TEST SETUP ONLY: B has the real three Rune objects, but the current public
  // Closed-State resource interface is payment-oriented and would add a Chain
  // item before Retreat can be selected. Seed its one Energy; Retreat's public
  // Finalize still validates and deducts it.
  kernel.perform({ type: "gain-energy", player: "B", amount: 1 });
  send("B", {
    type: "play",
    commandId: "retreat-response",
    cardObjectId: retreatSource.ref.id
  });
  assert.deepEqual(match.flow.chain.items.map(item => [item.controller, item.status]),
    [["A", "finalized"], ["B", "finalized"]]);
  assert.equal(kernel.getObject(retreatSource.ref.id).zone, "chain");
  send("B", { type: "pass", commandId: "response-pass-b" });
  assert.deepEqual(match.flow.chain.items.map(item => [item.controller, item.status]),
    [["A", "finalized"], ["B", "finalized"]]);
  assert.equal(kernel.getObject("enemy-unit").zone, "board");
  assert.equal(kernel.getObject("enemy-unit").damage, 0);

  // A's next Pass is the current runtime's damaged Reaction continuation. It
  // resolves Retreat from the newest item and leaves Singularity finalized.
  send("A", { type: "pass", commandId: "response-pass-a2" });
  assert.equal(kernel.getObject(retreatSource.ref.id).zone, "trash");
  assert.equal(kernel.getObject("enemy-unit").zone, "hand");
  assert.equal(kernel.getObject("enemy-unit").damage, 0);
  assert.deepEqual(match.events().filter(event => event.timingPoint === "damage-dealt"), []);
  assert.deepEqual(match.flow.chain.items.map(item => [item.controller, item.status]),
    [["A", "finalized"]]);
  send("A", { type: "pass", commandId: "response-pass-a3" });
  assert.deepEqual(match.flow.chain.items.map(item => [item.controller, item.status]),
    [["A", "finalized"]]);
  assert.equal(match.flow.chain.priority, "B");
  send("B", { type: "pass", commandId: "response-pass-b2" });
  assert.deepEqual(match.events().filter(event => event.timingPoint === "damage-dealt")
    .map(event => [event.target.ref.id, event.amount]), [["ally-unit", 6]]);
  assert.equal(kernel.getObject("ally-unit").damage, 6);
  assert.equal(kernel.getObject("enemy-unit").damage, 0);
  assert.equal(kernel.getObject(singularity.ref.id).zone, "trash");
  assert.deepEqual(match.flow.chain.items, []);
});

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
