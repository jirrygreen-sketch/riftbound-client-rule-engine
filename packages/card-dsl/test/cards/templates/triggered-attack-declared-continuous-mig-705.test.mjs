// RIFT-705 template-level golden for the `triggered|attack-declared|continuous.might`
// group (packages/card-dsl/src/cards/README.md 4.1; test bench from RIFT-592).
//
// The three cards below share one IR signature — one `triggered` ability on the
// closed `attack-declared` timing point (323.2 / 383.4.e / 466.2.c) whose body is
// a single `continuous.might` instruction — and differ in the printed amount,
// the recipient and the trigger clause:
//
//   Dune Drake       ogn-131-298  "When I attack, give me +2 [M] this turn if there is a ready enemy unit here."
//   Nine-Tailed Fox  ogn-255-298  "When an enemy unit attacks a battlefield you control, give it -1 [M] this turn, to a minimum of 1 [M]."
//   Icevale Archer   unl-065-219  "When I attack, you may pay 1 energy to give a unit here -1 [M] this turn."
//
// Method (same shape as RIFT-687's template golden):
// - Every card gets its own parameter row: canonical identity, the card's own
//   board, its own `attack-declared` operation and its own printed expectation
//   (Might numbers, floor, events, links). Rows are independent node:test cases
//   whose names carry the card name and the canonical identity.
// - The scenario harness refuses judge-required programs by design, so each row
//   drives a metadata-only `executable` view. Every ability, target, filter,
//   amount and sourceText stays intact; the published program is asserted to
//   stay judge-required. Nothing here promotes a card.
// - Rows whose printed outcome still cannot happen carry the measured gap as a
//   node:test TODO. Rows whose printed body really resolves (Nine-Tailed Fox
//   -1 with the floor) are real assertions, and the card's remaining gaps are
//   pinned by that card's own tests further down.
// - The supported half of every row — the card's own authored body through the
//   production chain adapter (`resolveChainBody`) plus the layer engine, and its
//   no-eligible-recipient boundary — runs in separate per-card tests, so partial
//   execution is visible without claiming the whole card.
// - The attack timing point has no producer in the merged engine
//   (combat/flow.ts still throws TurnCombatBlockedError for the combat-start
//   role transaction, CR 466.2), so every row emits the real timing point through
//   the harness rather than pretending a combat ran.
import assert from "node:assert/strict";
import test from "node:test";

import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { defineTemplateSuite, runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { ProgramBindingError } from "../../../../engine-core/dist/programs/errors.js";
import { createProgramBinding, translateObjectFilter, translateTriggerFilter } from "../../../../engine-core/dist/programs/index.js";
import duneDrake from "../../../dist/cards/ogn/dune-drake.js";
import nineTailedFox from "../../../dist/cards/ogn/nine-tailed-fox.js";
import icevaleArcher from "../../../dist/cards/unl/icevale-archer.js";

const BF1 = { type: "battlefield", id: "bf-1" };
const BF2 = { type: "battlefield", id: "bf-2" };

const drakeId = duneDrake.canonicalCardId;
const foxId = nineTailedFox.canonicalCardId;
const archerId = icevaleArcher.canonicalCardId;

/**
 * The scenario harness refuses judge-required programs by design. This view
 * keeps every published ability, target, filter and sourceText, and asserts the
 * published program really is still judge-required.
 */
function executableView(program) {
  assert.equal(program.status, "judge-required", program.canonicalCardId + " must stay judge-required");
  assert.ok(program.judgeReason?.trim(), program.canonicalCardId + " keeps an explicit judge reason");
  return { ...program, status: "executable", judgeReason: undefined };
}

const drakeView = executableView(duneDrake);
const foxView = executableView(nineTailedFox);
const archerView = executableView(icevaleArcher);

/**
 * Bind one card's abilities through the real CardProgram binding and the real
 * EventPipeline, exactly like the production lifecycle does. Returns the
 * registered trigger ids, the pipeline and the (fail-closed) error, if any.
 */
function productionRegistration(program) {
  const binding = createProgramBinding({ cardPrograms: [program] });
  const kernel = world()
    .player("A")
    .player("B")
    .unit("host", { owner: "A", controller: "A", might: 5, location: BF1 })
    .unit("foe", { owner: "B", controller: "B", might: 3, location: BF1 })
    .build();
  const pipeline = new EventPipeline({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    execute: action => ({ outcome: kernel.perform(action), emissions: [] }),
    context: () => kernel,
    choose: () => { throw new Error("unexpected choice during trigger registration"); },
  }, ["A", "B"], "A");
  const source = { ...kernel.getObject("host"), cardId: program.canonicalCardId };
  let ids;
  let error;
  try {
    ids = binding.registerProgramTriggers({ pipeline }, source);
  } catch (caught) {
    error = caught;
  }
  return { error, ids, pipeline, kernel };
}

const registrations = kernel => kernel.continuousEffects.map((entry, index) => ({
  effect: entry.effect,
  duration: entry.duration,
  timestamp: index + 1,
}));

/**
 * The reference kernel compares player selectors literally, while the merged
 * ChainEngine query wrapper resolves the card's relative `controller` spelling
 * against the ability controller before the layer matcher sees it
 * (chain/engine.ts context().query). This proxy reproduces exactly that one
 * normalization for a card's own body query and nothing else, so the
 * supported-half tests measure the same body the production chain resolves.
 */
function relativeControllerContext(kernel, controller) {
  return new Proxy(kernel, {
    get(target, key) {
      if (key === "query") {
        return filter => {
          const { controller: selector, ...rest } = filter ?? {};
          if (selector === "opponent" || selector === "their") {
            return target.query(rest).filter(object => object.controller !== controller);
          }
          if (selector === "self" || selector === "controller" || selector === "you") {
            return target.query(rest).filter(object => object.controller === controller);
          }
          return target.query(rest);
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const attackDeclared = (object, player, details) => ({
  type: "trigger",
  timingPoint: "attack-declared",
  object,
  player,
  ...(details === undefined ? {} : { details }),
});

const pass = player => ({ type: "pass", player });

// ---------------------------------------------------------------------------
// One row per card: that card's own board, its own attack-declared emission and
// its own printed expectation. A row carries `todo` when the printed outcome
// still cannot happen; the string is the measured gap.
// ---------------------------------------------------------------------------
const rows = [
  {
    name: "Dune Drake · give me +2 Might this turn when I attack with a ready enemy unit here",
    canonicalCardId: drakeId,
    program: drakeView,
    declared(program) {
      assert.match(program.judgeReason, /383\.2\.a\.1/);
      assert.match(program.judgeReason, /sameLocationAs/);
      assert.match(program.judgeReason, /466\.2\.c/);
    },
    scenario: {
      objects: [
        { id: "drake", cardId: drakeId, program: drakeView, types: ["unit"], zone: "board", location: BF1, might: 5 },
        { id: "raider", owner: "B", types: ["unit"], zone: "board", location: BF1, might: 3 },
      ],
      operations: [
        attackDeclared("drake", "A"),
        pass("A"),
      ],
      expect: {
        objects: {
          // The printed outcome: "give me +2 Might this turn".
          drake: { zone: "board", might: 7, buffs: 0, damage: 0 },
          raider: { zone: "board", might: 3 },
        },
        events: { includes: [{ timingPoint: "attack-declared", object: { ref: "drake" } }] },
      },
    },
    todo:
      "RIFT-705 Dune Drake stays judge-required (the RIFT-705 template layer is its execution evidence): " +
      "the +2 Might body itself runs (see the supported-half test), but the printed 383.2.a.1 trigger condition " +
      "\"if there is a ready enemy unit here\" never evaluates true, so the printed +2 never happens. Measured on this " +
      "exact board: the relative player anchor controller:\"opponent\" is compared as a literal by " +
      "interpreter/selectors.ts queryObjects and by the layer matcher (matchesObjectFilter compares it to the " +
      "candidate's own controller), and the 053.3 location anchor sameLocationAs:\"source\" is dropped by " +
      "layers/filter.ts matchesObjectFilter; programs/filters.ts translateObjectFilter rejects the anchor outright " +
      "(\"Unsupported filter field sameLocationAs\"). The same condition with the absolute id controller:\"B\" is true, " +
      "which isolates the gap to the relative-player plus location anchors. Needs relative-player anchor resolution " +
      "on the chain query/condition path and the sameLocationAs anchor in the condition evaluator.",
    supported: {
      makeWorld: () => world()
        .unit("drake", { owner: "A", controller: "A", might: 5, location: BF1 })
        .unit("foe", { owner: "B", controller: "B", might: 3, location: BF1 })
        .build(),
      source: "drake",
      affected: "drake",
      affectedMight: 7,
      others: { foe: 3 },
      expired: { drake: 5, foe: 3 },
      makeBare: () => world().unit("drake", { owner: "A", controller: "A", might: 5, location: BF1 }).build(),
      bareSource: "drake",
      bareLeftBoard: true,
    },
  },
  {
    name: "Nine-Tailed Fox · give the attacking enemy unit -1 Might this turn, to a minimum of 1",
    canonicalCardId: foxId,
    program: foxView,
    declared(program) {
      assert.match(program.judgeReason, /attack-declared/);
      assert.match(program.judgeReason, /478\.1\.c/);
      // 2026-10-17: the authored body uses the merged objects selection, so the
      // -1 and the printed floor really resolve through the chain.
      assert.match(program.judgeReason, /triggered-attack-declared-continuous-mig-705\.test\.mjs/);
    },
    scenario: {
      players: { A: { energy: 3 }, B: { energy: 3 } },
      objects: [
        // A Legend prints no energy/power; those stay null, never 0.
        { id: "fox", cardId: foxId, program: foxView, types: ["legend"], zone: "board", location: BF1, might: 3, energy: null, power: null },
        { id: "raider", owner: "B", types: ["unit"], zone: "board", location: BF1, might: 4 },
        { id: "bystander", owner: "B", types: ["unit"], zone: "board", location: BF2, might: 4 },
      ],
      answers: { "target:attacking-unit": ["raider"] },
      operations: [
        attackDeclared("raider", "B", { battlefieldId: "bf-1" }),
        pass("A"),
        pass("B"),
      ],
      expect: {
        objects: {
          fox: { zone: "board", might: 3, buffs: 0, energy: null, power: null },
          // 478.1.c: -1 with the printed floor of 1; 4 -> 3.
          raider: { zone: "board", might: 3, buffs: 0, damage: 0 },
          bystander: { zone: "board", might: 4 },
        },
        players: { A: { energy: 3 } },
        links: {
          "nine-tailed-fox.debuff-attacker.affected": { count: 1, objects: ["raider"] },
          "nine-tailed-fox.debuff-attacker.affected.count": 1,
          "nine-tailed-fox.debuff-attacker.affected.objects": ["raider"],
        },
        events: {
          includes: [
            { timingPoint: "attack-declared", object: { ref: "raider" } },
            { timingPoint: "became-target", object: { ref: "raider" } },
            { timingPoint: "chain-item-resolve", object: { ref: "fox" } },
          ],
        },
      },
    },
    supported: {
      makeWorld: () => world()
        .unit("fox", { owner: "A", controller: "A", types: ["legend"], might: 3, location: BF1 })
        .unit("raider", { owner: "B", controller: "B", might: 4, location: BF1 })
        .unit("far", { owner: "B", controller: "B", might: 4, location: BF2 })
        .build(),
      source: "fox",
      bind: (kernel, bound) => bound.setTargets("attacking-unit", [kernel.ref("raider")]),
      affected: "raider",
      affectedMight: 3,
      others: { fox: 3, far: 4 },
      expired: { fox: 3, raider: 4, far: 4 },
      makeBare: () => world()
        .unit("fox", { owner: "A", controller: "A", types: ["legend"], might: 3, location: BF1 })
        .unit("raider", { owner: "B", controller: "B", might: 4, location: BF1 })
        .build(),
      bareSource: "fox",
      bareTargetLeftBoard: "raider",
    },
  },
  {
    name: "Icevale Archer · after attacking, give a unit here -1 Might this turn",
    canonicalCardId: archerId,
    program: archerView,
    declared(program) {
      assert.match(program.judgeReason, /sameLocationAs/);
      // 2026-10-17: the merged chain cost plan is no longer a gap; the live gap
      // is the missing leading-cost adapter (no TriggerRegistration.cost /
      // mayAtFinalize on this trigger declaration).
      assert.match(program.judgeReason, /TriggerRegistration\.cost/);
      assert.match(program.judgeReason, /mayAtFinalize/);
      assert.match(program.judgeReason, /triggered-attack-declared-continuous-mig-705\.test\.mjs/);
    },
    scenario: {
      players: { A: { energy: 5 } },
      objects: [
        { id: "archer", cardId: archerId, program: archerView, types: ["unit"], zone: "board", location: BF1, might: 2, energy: null, power: null },
        { id: "foe", owner: "B", types: ["unit"], zone: "board", location: BF1, might: 4 },
      ],
      answers: { "target:icevale-archer.unit-here": ["foe"] },
      operations: [
        attackDeclared("archer", "A"),
        pass("A"),
      ],
      expect: {
        objects: {
          archer: { zone: "board", might: 2 },
          // The printed outcome: -1 Might this turn, after paying 1 energy.
          foe: { zone: "board", might: 3, buffs: 0 },
        },
        players: { A: { energy: 4 } },
      },
    },
    todo:
      "RIFT-705 Icevale Archer stays judge-required (the RIFT-705 template layer is its execution evidence): " +
      "the -1 Might body itself runs (see the supported-half test), but the ability can never resolve on the real path. " +
      "Measured: registerProgramTriggers throws ProgramBindingError (code judge-required, " +
      "\"Unsupported filter field sameLocationAs\") while translating the body target's \"a unit here\" anchor, so the " +
      "pipeline registers 0 triggers and the printed effect, cost and target lock never happen. Attack timing also has " +
      "no producer (combat/flow.ts throws TurnCombatBlockedError for the combat-start role transaction, CR 466.2), and " +
      "the leading optional 1-energy cost (383.3.b) has no carrier in the frozen triggered-ability IR and " +
      "programs/triggers.ts does not lift it into TriggerRegistration.cost / mayAtFinalize.",
    supported: {
      makeWorld: () => world()
        .unit("archer", { owner: "A", controller: "A", might: 2, location: BF1 })
        .unit("foe", { owner: "B", controller: "B", might: 4, location: BF1 })
        .unit("far", { owner: "B", controller: "B", might: 4, location: BF2 })
        .build(),
      source: "archer",
      bind: (kernel, bound) => bound.setTargets("icevale-archer.unit-here", [kernel.ref("foe")]),
      affected: "foe",
      affectedMight: 3,
      others: { archer: 2, far: 4 },
      expired: { archer: 2, foe: 4, far: 4 },
      makeBare: () => world()
        .unit("archer", { owner: "A", controller: "A", might: 2, location: BF1 })
        .unit("foe", { owner: "B", controller: "B", might: 4, location: BF1 })
        .build(),
      bareSource: "archer",
      bareTargetLeftBoard: "foe",
    },
  },
];

// ---------------------------------------------------------------------------
// Boundary group: printed cases that must NOT change anything, plus the printed
// floor. Every row passes with a rule-correct "no change" (or floor) outcome and
// pins the declared filter's behaviour.
// ---------------------------------------------------------------------------
const boundaries = [
  {
    name: "boundary (no legal target) · Nine-Tailed Fox ignores an attack-declared emission whose object is not a Board unit",
    canonicalCardId: foxId,
    program: foxView,
    scenario: {
      players: { A: { energy: 3 }, B: { energy: 3 } },
      objects: [
        { id: "fox", cardId: foxId, program: foxView, types: ["legend"], zone: "board", location: BF1, might: 3, energy: null, power: null },
        // 355.9.a.1: "unit" means a Board object. A unit card in hand is not a
        // legal attacker and not a legal recipient of "it".
        { id: "hand-raider", owner: "B", types: ["unit"], zone: "hand", might: 4 },
      ],
      operations: [
        attackDeclared("hand-raider", "B"),
        pass("A"),
      ],
      expect: {
        objects: {
          fox: { zone: "board", might: 3 },
          "hand-raider": { zone: "hand", might: 4 },
        },
        events: { includes: [{ timingPoint: "attack-declared", object: { ref: "hand-raider" } }] },
      },
    },
    verify(result) {
      // The declared filter carries the 355.9.a.1 Board restriction and the
      // production translation keeps it; the chain stays empty and no link is
      // written, so nothing was approximated into a legal target.
      assert.deepEqual(translateTriggerFilter(nineTailedFox.abilities[0].trigger.filter, "fox-1", "attack-declared"), {
        event: "attack-declared",
        object: { type: "unit", controller: "opponent", zone: "board" },
      });
      assert.deepEqual(result.state.chain, []);
      assert.deepEqual(result.links, {});
      assert.equal(result.events.some(event => event.timingPoint === "became-target"), false);
    },
  },
  {
    name: "boundary (not an enemy unit) · Nine-Tailed Fox ignores my own unit attacking",
    canonicalCardId: foxId,
    program: foxView,
    scenario: {
      players: { A: { energy: 3 }, B: { energy: 3 } },
      objects: [
        { id: "fox", cardId: foxId, program: foxView, types: ["legend"], zone: "board", location: BF1, might: 3, energy: null, power: null },
        { id: "mine", owner: "A", types: ["unit"], zone: "board", location: BF1, might: 4 },
      ],
      operations: [
        attackDeclared("mine", "A"),
        pass("A"),
      ],
      expect: {
        objects: {
          fox: { zone: "board", might: 3 },
          mine: { zone: "board", might: 4, buffs: 0 },
        },
        events: { includes: [{ timingPoint: "attack-declared", object: { ref: "mine" } }] },
      },
    },
    verify(result) {
      // 383.4.e: "When an enemy unit attacks" — a friendly attacker never fires
      // this trigger. The merged scan resolves the relative selector against the
      // registration's controller, which is why this genuine boundary passes.
      assert.deepEqual(result.links, {});
      assert.equal(result.state.chain.length, 0);
      assert.equal(result.events.some(event => event.timingPoint === "chain-item-pending"), false);
    },
  },
  {
    name: "boundary (printed floor) · Nine-Tailed Fox cannot take a 1-Might unit below 1",
    canonicalCardId: foxId,
    program: foxView,
    scenario: {
      players: { A: { energy: 3 }, B: { energy: 3 } },
      objects: [
        { id: "fox", cardId: foxId, program: foxView, types: ["legend"], zone: "board", location: BF1, might: 3, energy: null, power: null },
        { id: "weakest", owner: "B", types: ["unit"], zone: "board", location: BF1, might: 1 },
      ],
      answers: { "target:attacking-unit": ["weakest"] },
      operations: [
        attackDeclared("weakest", "B"),
        pass("A"),
        pass("B"),
      ],
      expect: {
        objects: {
          fox: { zone: "board", might: 3 },
          weakest: { zone: "board", might: 1, buffs: 0, damage: 0 },
        },
        links: {
          "nine-tailed-fox.debuff-attacker.affected": { count: 1, objects: ["weakest"] },
          "nine-tailed-fox.debuff-attacker.affected.count": 1,
        },
        events: { includes: [{ timingPoint: "chain-item-resolve", object: { ref: "fox" } }] },
      },
    },
    verify(result) {
      // 478.1.c: the registered effect carries the floor, so the 1-Might unit
      // stays at 1 while the modifier is still recorded as applied.
      const settlement = Object.keys(result.links).filter(key => key.includes("__continuous.settlement.continuous.might."));
      assert.equal(settlement.length, 1);
      assert.equal(result.state.objects.find(object => object.ref.id === "weakest").might, 1);
    },
  },
  {
    name: "boundary (trigger condition unmet) · Dune Drake does not fire without a ready enemy unit here",
    canonicalCardId: drakeId,
    program: drakeView,
    scenario: {
      objects: [
        { id: "drake", cardId: drakeId, program: drakeView, types: ["unit"], zone: "board", location: BF1, might: 5 },
        { id: "ally", owner: "A", types: ["unit"], zone: "board", location: BF1, might: 2 },
        { id: "foe-elsewhere", owner: "B", types: ["unit"], zone: "board", location: BF2, might: 3 },
      ],
      operations: [
        attackDeclared("drake", "A"),
        pass("A"),
      ],
      expect: {
        objects: {
          drake: { zone: "board", might: 5, buffs: 0, damage: 0 },
          ally: { zone: "board", might: 2 },
          "foe-elsewhere": { zone: "board", might: 3 },
        },
        events: { includes: [{ timingPoint: "attack-declared", object: { ref: "drake" } }] },
      },
    },
    verify(result) {
      // Rule-correct outcome (no ready enemy here) plus the measured gap: the
      // merged condition evaluation makes the clause false in every arrangement,
      // so this boundary currently holds for the wrong reason as well. Both are
      // pinned so the card cannot be promoted on the boundary alone.
      assert.deepEqual(result.links, {});
      assert.equal(result.events.some(event => event.timingPoint === "chain-item-pending"), false);
      const grid = world()
        .unit("drake", { owner: "A", controller: "A", might: 5, location: BF1 })
        .unit("ready-enemy-here", { owner: "B", controller: "B", might: 3, location: BF1, exhausted: false })
        .build();
      assert.equal(grid.test(duneDrake.abilities[0].trigger.condition), false, "the declared condition never holds today");
    },
  },
  {
    name: "boundary (not registrable) · Icevale Archer's attack emission leaves Might, energy and the Chain untouched",
    canonicalCardId: archerId,
    program: archerView,
    scenario: {
      players: { A: { energy: 5 } },
      objects: [
        { id: "archer", cardId: archerId, program: archerView, types: ["unit"], zone: "board", location: BF1, might: 2, energy: null, power: null },
        { id: "foe", owner: "B", types: ["unit"], zone: "board", location: BF1, might: 4 },
      ],
      answers: { "target:icevale-archer.unit-here": ["foe"] },
      operations: [
        attackDeclared("archer", "A"),
        pass("A"),
      ],
      expect: {
        objects: {
          archer: { zone: "board", might: 2, buffs: 0, exhausted: false },
          foe: { zone: "board", might: 4, buffs: 0, damage: 0 },
        },
        players: { A: { energy: 5 } },
        events: { includes: [{ timingPoint: "attack-declared", object: { ref: "archer" } }] },
      },
    },
    verify(result) {
      // The ability is rejected at registration, so the printed cost is not paid
      // and the printed -1 never lands; the scenario must not substitute a
      // hand-written settlement for either.
      assert.deepEqual(result.state.chain, []);
      assert.deepEqual(result.links, {});
    },
  },
];

/**
 * Register every row as its own test. Each row first proves the published
 * program is still judge-required with an explicit reason, then binds the
 * ability through the real CardProgram binding to pin the exact production
 * behaviour, then runs the row's scenario through the real pipeline. `todo`
 * rows carry the printed rule outcome and are reported pending.
 */
function runSuite(templateName, suiteRows) {
  const cases = defineTemplateSuite(templateName, suiteRows);
  for (const [index, golden] of cases.entries()) {
    const row = suiteRows[index];
    const options = row.todo === undefined ? undefined : { todo: row.todo };
    test(golden.name, options, () => {
      const published = [duneDrake, nineTailedFox, icevaleArcher].find(program => program.canonicalCardId === row.canonicalCardId);
      assert.equal(published.status, "judge-required", row.canonicalCardId + " stays judge-required");
      assert.ok(published.judgeReason?.trim(), row.canonicalCardId + " keeps an explicit judge reason");
      assert.equal(published.abilities.length, 1, row.canonicalCardId + " keeps the triggered|| signature");
      assert.equal(published.abilities[0].kind, "triggered");
      assert.equal(published.abilities[0].trigger.at, "attack-declared");
      row.declared?.(published);
      const result = golden.run();
      assert.deepEqual(result.state.chain, []);
      row.verify?.(result);
    });
  }
}

runSuite("RIFT-705 triggered|attack-declared|continuous.might", rows);
runSuite("RIFT-705 triggered|attack-declared|continuous.might boundary", boundaries);

// ---------------------------------------------------------------------------
// Supported half of each parameter row: the part that really executes through
// merged production code today, plus that card's own no-eligible-recipient
// boundary.
// ---------------------------------------------------------------------------
for (const row of rows) {
  const [ability] = row.program.abilities;
  test("RIFT-705 " + row.name + " [" + row.canonicalCardId + "]: the authored continuous.might body registers on its own recipient and expires at turn-end", () => {
    const kernel = row.supported.makeWorld();
    const source = kernel.getObject(row.supported.source);
    const raw = kernel.clone({ source: source.ref, sourceSnapshot: source, controller: "A" });
    row.supported.bind?.(kernel, raw);
    const outcome = resolveChainBody(ability.body, relativeControllerContext(raw, "A"));

    assert.equal(outcome.status, "executed");
    assert.deepEqual(outcome.results.map(entry => entry.result.status), ["executed"]);
    // 143.2.a / 478: an arithmetic-layer registration carrying the end-of-turn
    // duration. Never a Buff counter (702-704).
    assert.equal(raw.continuousEffects.length, 1);
    assert.deepEqual(raw.continuousEffects.map(entry => entry.effect.filter.objectId), [row.supported.affected]);
    assert.deepEqual(raw.continuousEffects[0].duration, { type: "end-of-turn" });
    assert.equal(raw.continuousEffects[0].effect.layer, "arithmetic");
    assert.equal(raw.continuousEffects[0].effect.effect.kind, "continuous.might");

    const layers = createLayerEngine(raw.objects, registrations(raw));
    assert.equal(layers.evaluate(kernel.ref(row.supported.affected)).might, row.supported.affectedMight, "affected Might");
    assert.equal(layers.evaluate(kernel.ref(row.supported.affected)).buffs, 0, "affected Buff counters");
    for (const [id, might] of Object.entries(row.supported.others)) {
      assert.equal(layers.evaluate(kernel.ref(id)).might, might, id + ": unaffected Might");
      assert.equal(layers.evaluate(kernel.ref(id)).buffs, 0, id + ": unaffected Buff counters");
    }
    // 317.1.a / 468.7.c: the Might modification expires at the end of the turn.
    assert.equal(layers.expireAt("turn-end").length, 1);
    for (const [id, might] of Object.entries(row.supported.expired)) {
      assert.equal(layers.evaluate(kernel.ref(id)).might, might, id + ": after turn-end");
    }
  });

  test("RIFT-705 " + row.name + " [" + row.canonicalCardId + "]: no eligible recipient negates the authored body", () => {
    const bare = row.supported.makeBare();
    let raw;
    if (row.supported.bareLeftBoard === true) {
      // The host itself is gone: an "appliesTo self" instruction cannot find a
      // Board object, so the modification is ignored rather than rebound.
      const ref = bare.ref(row.supported.bareSource);
      const snapshot = bare.getObject(row.supported.bareSource);
      assert.equal(bare.perform({ type: "kill", object: ref }).status, "done");
      raw = bare.clone({ source: ref, sourceSnapshot: snapshot, controller: "A" });
    } else {
      // The locked recipient already left the Board (359.3.e.6) while the host
      // stays; the stale reference must not be re-bound to a different object.
      const ref = bare.ref(row.supported.bareTargetLeftBoard);
      assert.equal(bare.perform({ type: "kill", object: ref }).status, "done");
      raw = bare.clone({ source: bare.ref(row.supported.bareSource), sourceSnapshot: bare.getObject(row.supported.bareSource), controller: "A" });
      raw.setTargets(ability.body[0].targets[0].id, [ref]);
    }
    const outcome = resolveChainBody(ability.body, relativeControllerContext(raw, "A"));
    assert.equal(outcome.status, "partial");
    assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
    assert.deepEqual(raw.continuousEffects, []);
  });
}

// ---------------------------------------------------------------------------
// Card-specific evidence and gaps that do not fit the shared parameter rows.
// ---------------------------------------------------------------------------
test("RIFT-705 Dune Drake [" + drakeId + "]: the printed trigger condition is registered but cannot be satisfied on the merged evaluation paths", () => {
  // 383.2.a.1 keeps the conditional clause in the Trigger Condition; the program
  // declares it on the trigger and the real binding carries it onto the trigger
  // spec, so the open work is the anchor evaluation, not the wiring.
  const { error, ids, pipeline } = productionRegistration(drakeView);
  assert.equal(error, undefined, String(error));
  assert.deepEqual(ids, ["program:host:1:0"]);
  assert.equal(pipeline.triggers.size, 1, "the attack trigger registers");
  assert.deepEqual(pipeline.triggers.get(ids[0]).spec.condition, duneDrake.abilities[0].trigger.condition);

  const condition = duneDrake.abilities[0].trigger.condition;
  assert.equal(condition.left.filter.controller, "opponent");
  assert.equal(condition.left.filter.sameLocationAs, "source");
  // The production object-filter translator rejects the 053.3 location anchor
  // outright, so the card's own filter cannot be bound as written.
  assert.throws(
    () => translateObjectFilter(condition.left.filter),
    error => error instanceof ProgramBindingError
      && error.code === "judge-required"
      && /Unsupported filter field sameLocationAs/.test(error.message),
  );

  const grid = world()
    .unit("drake", { owner: "A", controller: "A", might: 5, location: BF1 })
    .unit("ready-enemy-here", { owner: "B", controller: "B", might: 3, location: BF1, exhausted: false })
    .unit("ready-enemy-elsewhere", { owner: "B", controller: "B", might: 3, location: BF2, exhausted: false })
    .build();
  // Measured: the relative player spelling is compared as a literal by the
  // interpreter query path and by the layer matcher, so the condition is false
  // even though a ready enemy unit sits at the source's location.
  assert.equal(grid.test(condition), false);
  assert.equal(grid.query({ type: "unit", controller: "opponent", states: "ready" }).length, 0);
  // The layer matcher drops the sameLocationAs anchor entirely: with an absolute
  // id it matches the far enemy as well.
  assert.equal(matchesObjectFilter({ type: "unit", controller: "B", states: "ready" }, grid.getObject("ready-enemy-here")), true);
  assert.equal(matchesObjectFilter({ type: "unit", controller: "B", states: "ready" }, grid.getObject("ready-enemy-elsewhere")), true, "the location anchor is dropped by the layer matcher");
  // Control: switching only the player anchor to the absolute id makes the same
  // arrangement satisfy the condition, which isolates the gap to the relative
  // player plus location anchors rather than to ready/states handling.
  const absolute = {
    ...condition,
    left: { ...condition.left, filter: { ...condition.left.filter, controller: "B" } },
  };
  assert.equal(grid.test(absolute), true);
});

test("RIFT-705 Nine-Tailed Fox [" + foxId + "]: the trigger registers with the 355.9.a.1 Board restriction and no battlefield-control clause", () => {
  const { error, ids, pipeline } = productionRegistration(foxView);
  assert.equal(error, undefined, String(error));
  assert.deepEqual(ids, ["program:host:1:0"]);
  assert.deepEqual(pipeline.triggers.get(ids[0]).spec.filter, {
    event: "attack-declared",
    object: { type: "unit", controller: "opponent", zone: "board" },
  });
  // The printed "a battlefield you control" clause has no carrier yet: the
  // trigger keeps no condition, and the attack payload's details are not
  // consumed by the filter. This is the measured gap, not a rule decision.
  assert.equal(pipeline.triggers.get(ids[0]).spec.condition, undefined);
  assert.equal("details" in pipeline.triggers.get(ids[0]).spec.filter, false);
});

test("RIFT-705 Nine-Tailed Fox [" + foxId + "]: the printed -1 is a Might layer effect bound through the merged objects convention, never a Buff counter", () => {
  const [ability] = nineTailedFox.abilities;
  const [instruction] = ability.body;
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: -1 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(instruction.args.minimum, { kind: "constant", value: 1 });
  assert.deepEqual(instruction.args.objects, { kind: "constant", value: { kind: "target", id: "attacking-unit" } });
  assert.equal(instruction.args.target, undefined, "the authored selection uses the merged objects convention");
  assert.equal(instruction.args.appliesTo, undefined);
  assert.deepEqual(instruction.targets, [{
    id: "attacking-unit",
    filter: { type: "unit", controller: "opponent", zone: "board" },
    min: 1,
    max: 1,
    selection: "one",
  }]);
});

test("RIFT-705 Nine-Tailed Fox [" + foxId + "]: a non-attacking opponent unit can still be locked as 'it' (measured gap, 383.2.c.3.b / 359.3.f.3)", () => {
  // The trigger filter accepts any opponent Board unit, and the body target has
  // no binding to the event object. Answering with the bystander instead of the
  // declared attacker is accepted and the -1 lands on the wrong unit; that is
  // the printed gap this template layer must not paper over.
  const result = runCardScenario(foxView, {
    players: { A: { energy: 3 }, B: { energy: 3 } },
    objects: [
      { id: "fox", cardId: foxId, program: foxView, types: ["legend"], zone: "board", location: BF1, might: 3, energy: null, power: null },
      { id: "raider", owner: "B", types: ["unit"], zone: "board", location: BF1, might: 4 },
      { id: "bystander", owner: "B", types: ["unit"], zone: "board", location: BF1, might: 4 },
    ],
    answers: { "target:attacking-unit": ["bystander"] },
    operations: [
      attackDeclared("raider", "B"),
      pass("A"),
      pass("B"),
    ],
  });
  assert.equal(result.state.objects.find(object => object.ref.id === "raider").might, 4, "the actual attacker is untouched");
  assert.equal(result.state.objects.find(object => object.ref.id === "bystander").might, 3, "the non-attacking unit took the -1");
});

test("RIFT-705 Icevale Archer [" + archerId + "]: production registration fails closed on the sameLocationAs body target", () => {
  const { error, ids, pipeline } = productionRegistration(archerView);
  assert.equal(ids, undefined);
  assert.ok(error instanceof ProgramBindingError, String(error));
  assert.equal(error.code, "judge-required");
  assert.equal(error.message, "Unsupported filter field sameLocationAs");
  assert.equal(pipeline.triggers.size, 0, "a rejected ability must register no trigger");
  assert.throws(
    () => translateObjectFilter(icevaleArcher.abilities[0].body[0].targets[0].filter),
    error => error instanceof ProgramBindingError && error.code === "judge-required",
  );
});

test("RIFT-705 Icevale Archer [" + archerId + "]: 'a unit here' is any Board unit at the source's location, with no controller restriction", () => {
  const [instruction] = icevaleArcher.abilities[0].body;
  assert.deepEqual(instruction.targets, [{
    id: "icevale-archer.unit-here",
    filter: { type: "unit", zone: "board", sameLocationAs: "source" },
    min: 1,
    max: 1,
    selection: "one",
  }]);
  assert.equal(instruction.targets[0].filter.controller, undefined);
  assert.deepEqual(instruction.args.objects, { kind: "constant", value: { kind: "target", id: "icevale-archer.unit-here" } });
  assert.equal(instruction.args.target, undefined);
});

// ---------------------------------------------------------------------------
// Group gaps that every row above depends on. These stay TODOs: the template
// layer proves the Might body and the declared trigger shapes, not the printed
// trigger clauses.
// ---------------------------------------------------------------------------
test.todo(
  "RIFT-705 group: attack-declared has no producer — combat/flow.ts still throws " +
    "TurnCombatBlockedError('combat-start-transaction') before the Attacker/Defender roles are assigned " +
    "(CR 466.2 / 383.4.e), so no real combat can ever fire these three triggers",
);

test.todo(
  "RIFT-705 Nine-Tailed Fox: 'a battlefield you control' needs the battlefield-control state in the " +
    "attack-declared payload (details currently carry only battlefieldId) and 'it' needs the printed " +
    "event-object selector (383.2.c.3.b / 359.3.f.3) — measured: the -1 lands on a non-attacking opponent " +
    "unit when that answer is supplied",
);

test.todo(
  "RIFT-705 Icevale Archer: the leading optional 1-energy cost (383.3.b) has no carrier in the frozen " +
    "triggered-ability IR, and programs/triggers.ts does not lift it into TriggerRegistration.cost / " +
    "mayAtFinalize; the ability expresses the Finalize decision through optional: true only",
);

test.todo(
  "RIFT-705 Dune Drake: 'if there is a ready enemy unit here' needs relative-player anchor resolution on the " +
    "chain query/condition path plus the 053.3 sameLocationAs anchor in the condition evaluator (383.2.a.1); " +
    "measured: the clause is false even with a ready enemy unit at the source's location",
);
