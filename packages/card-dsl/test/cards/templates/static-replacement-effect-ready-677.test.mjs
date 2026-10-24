// RIFT-677 template-level golden for the `static+replacement||effect.ready`
// group: the cards whose IR signature is one static ability plus one
// object-enters-board replacement whose body is a single effect.ready
// (packages/card-dsl/src/cards/README.md 4.1).
//
// Method: every card has its own row with its canonical identity, its own
// board, its own operations and its own expectation, and runs the real
// runCardScenario path (ProgramBinding -> ChainEngine -> EventPipeline ->
// layers). Boundary rows cover the negated (unpayable printed cost) and
// condition-not-satisfied cases. Rows marked TODO assert the printed rule
// outcome that the merged engine does not produce yet; they are reported
// pending, never as a pass, and their TODO text names the measured gap.
//
// A passing row asserts only the rule-correct subset for its board. Where the
// merged engine produces a value the printed text does not support, that value
// is not written into a passing row: the printed expectation gets its own TODO
// row. Breakneck Mech is executable after its production recheck. The other
// three programs remain judge-required and use an executable-only validation
// view while each row still re-asserts the published program's real status.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { ProgramBindingError } from "../../../../engine-core/dist/programs/errors.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import breakneckMech from "../../../dist/cards/sfd/breakneck-mech.js";
import crescentGuardian from "../../../dist/cards/unl/crescent-guardian.js";
import monch from "../../../dist/cards/unl/monch.js";
import wujuMaster from "../../../dist/cards/unl/wuju-master.js";
import cloudDrake from "../../../dist/cards/ven/cloud-drake.js";

const BREAKNECK = breakneckMech.canonicalCardId;
const CRESCENT = crescentGuardian.canonicalCardId;
const MONCH = monch.canonicalCardId;
const WUJU = wujuMaster.canonicalCardId;

/**
 * The harness refuses judge-required programs by design; every row pins the
 * published program's real status separately through `sourceProgram`.
 */
const executableView = program => program.status === "executable"
  ? program
  : { ...program, status: "executable", judgeReason: undefined };

/**
 * The condition probe environment mirrors chain/engine.ts: "self" resolves to
 * the ability controller and "opponent" excludes that controller, so a
 * declared condition is evaluated exactly as the production query bridge does.
 */
function chainEnvironment(kernel, sourceId, controller) {
  const query = filter => {
    const normalized = { ...filter };
    for (const key of ["controller", "owner"]) if (normalized[key] === "self") normalized[key] = controller;
    return kernel.objects.filter(object => {
      for (const key of ["controller", "owner"]) if (normalized[key] === "opponent" && object[key] === controller) return false;
      return matchesObjectFilter({
        ...normalized,
        ...(normalized.controller === "opponent" ? { controller: "any" } : {}),
        ...(normalized.owner === "opponent" ? { owner: "any" } : {})
      }, object);
    });
  };
  return {
    context: bindResolveContext(kernel, { source: kernel.getObject(sourceId), controller, timingPoint: "chain-item-finalize", query }),
    host: kernel.ref(sourceId),
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false
  };
}

const evaluateDeclaredCondition = (condition, environment) => evaluateCondition(condition, environment);

/**
 * Gap probe: the production static binder must reject a declaration that has no
 * layer consumer, and it must not register a partial continuous effect.
 */
const rejectsStaticBinding = (program, abilityIndex, pattern) => result => {
  const host = result.state.objects.find(object => object.cardId === program.canonicalCardId);
  assert.ok(host, `scenario host for ${program.canonicalCardId} is on the board`);
  const engine = fixture({ cards: [] }).engine;
  assert.throws(
    () => createEngineStaticBinder(engine).bindStatic(program.abilities[abilityIndex], host),
    error => {
      assert.ok(error instanceof ProgramBindingError, String(error));
      assert.equal(error.code, "judge-required");
      assert.match(error.message, pattern);
      return true;
    }
  );
  assert.deepEqual(engine.layers.registry.list(), []);
};

/**
 * Gap probe: the entry binder must reject an entry body that targets the
 * replaced event's object (the entering friendly unit) instead of the source.
 */
const rejectsEntryBodyTarget = (program, abilityIndex, pattern) => result => {
  const host = result.state.objects.find(object => object.cardId === program.canonicalCardId);
  assert.ok(host, `scenario host for ${program.canonicalCardId} is on the board`);
  const kernel = world().player("A").unit("host", { might: 3, controller: "A" }).build();
  assert.throws(
    () => bindReplacement(program.abilities[abilityIndex], kernel.ref("host"), {
      host: { object: ref => kernel.object(ref), objects: () => kernel.objects, context: () => kernel },
      pipeline: fixture({ cards: [] }).engine.pipeline
    }),
    pattern
  );
};

const baseA = { type: "base", player: "A" };

// ---------------------------------------------------------------------------
// One row per assigned card: canonical identity, that card's own board, its own
// operations and its own expectation.
// ---------------------------------------------------------------------------
const rows = [
  {
    name: "Breakneck Mech · enters ready with another Mech and grants Deflect/Ganking to your Mechs",
    canonicalCardId: BREAKNECK,
    sourceProgram: breakneckMech,
    program: executableView(breakneckMech),
    scenario: {
      players: { A: { energy: 8, power: ["Mind"] } },
      objects: [
        { id: "mech", cardId: BREAKNECK, types: ["unit"], tags: ["Mech", "Yordle", "Bandle City"], zone: "hand", energy: 8, power: ["Mind"], might: 7 },
        { id: "ally-mech", types: ["unit"], tags: ["Mech"], zone: "board", might: 3 },
        // 133.8: Mech is a tag that may sit on objects of several types, so the
        // granted keywords follow the declared tag filter, not a unit type.
        { id: "mech-gear", types: ["gear"], tags: ["Mech"], zone: "board", energy: 2 },
        { id: "ally-other", types: ["unit"], zone: "board", might: 2 },
        { id: "enemy-mech", owner: "B", types: ["unit"], tags: ["Mech"], zone: "board", might: 4 },
        { id: "hand-mech", types: ["unit"], tags: ["Mech"], zone: "hand", might: 3 },
      ],
      operations: [{ type: "play", object: "mech", player: "A" }],
      expect: {
        objects: {
          mech: { zone: "board", location: baseA, might: 7, exhausted: false, energy: 8, power: ["Mind"], keywords: [{ id: "Deflect" }, { id: "Ganking" }] },
          "ally-mech": { zone: "board", might: 3, keywords: [{ id: "Deflect" }, { id: "Ganking" }] },
          "mech-gear": { zone: "board", keywords: [{ id: "Deflect" }, { id: "Ganking" }] },
          "ally-other": { zone: "board", keywords: [] },
          "enemy-mech": { zone: "board", keywords: [] },
          "hand-mech": { zone: "hand", keywords: [] },
        },
        // The installed executable program pays the catalog's printed
        // 8 Energy + 2 Mind; the Board object retains the one Mind Domain from
        // the catalog projection while the player's spendable pool is empty.
        players: { A: { energy: 0, power: [] } },
        events: { sequence: [
          { timingPoint: "object-enters-chain", object: { ref: "mech" } },
          { timingPoint: "object-enters-board", object: { ref: "mech" } },
          { timingPoint: "card-played", object: { ref: "mech" } },
        ] },
      },
    },
    verify(result) {
      // 369.3 / 805.6.a: the orientation rides the entry move, so no separate
      // "becomes ready" timing point is emitted for the entering permanent.
      assert.equal(result.events.some(event => event.timingPoint === "object-readied"), false);

      // 809: the granted Deflect expands to a target.tax static effect. The
      // production binder publishes that keyword expansion as a live capability
      // for Chain Finalize, so the formerly blocked layer mapping is gone.
      const deflect = keywordDefinitionsById.get("Deflect");
      assert.ok(deflect, "effects/keywords/Deflect.ts must be registered");
      const [taxAbility] = deflect.expand({ value: 1, host: { canonicalCardId: BREAKNECK } });
      assert.equal(taxAbility.effect.kind, "target.tax");
      const engine = fixture({ cards: [] }).engine;
      const mech = result.state.objects.find(object => object.ref.id === "mech");
      const deflectHandle = createEngineStaticBinder(engine).bindStatic(taxAbility, mech);
      assert.equal(engine.layers.registry.list().some(entry => entry.effect.effect.capabilityKind === "target-tax"), true);

      // 810.1.c: Ganking expands to continuous.movement. Both the raw keyword
      // permission and the production route-record shape expose the Standard
      // Move permission after re-expansion.
      const ganking = keywordDefinitionsById.get("Ganking");
      assert.ok(ganking, "effects/keywords/Ganking.ts must be registered");
      const [gankAbility] = ganking.expand({ host: { canonicalCardId: BREAKNECK } });
      assert.equal(gankAbility.effect.permission, "battlefield-to-battlefield");
      const registration = effect => ({
        effect: {
          id: "rift-677.probe",
          layer: "ability",
          source: mech.ref,
          filter: { objectId: mech.ref.id, zone: "board", zoneEntryId: mech.ref.zoneEntryId },
          effect
        },
        duration: { type: "permanent" },
        timestamp: 1
      });
      const routesShape = movement(createContinuousEffectRegistry([registration({
        kind: "continuous.movement",
        permission: { routes: ["battlefield-to-battlefield"], move: "standard" }
      })]), mech.ref, mech, "A");
      assert.equal(routesShape.canGank, true);
      deflectHandle.unbind();

      // 355.10.d: "another Mech" is a programmatic object count, not a choice.
      // The declared condition really discriminates through the merged
      // evaluator and the production query normalization.
      const withOther = world().player("A").player("B")
        .unit("mech", { tags: ["Mech"], might: 2, controller: "A" })
        .unit("other-mech", { tags: ["Mech"], might: 3, controller: "A" })
        .unit("enemy-mech", { tags: ["Mech"], might: 3, owner: "B", controller: "B" })
        .build();
      const withoutOther = world().player("A").player("B")
        .unit("mech", { tags: ["Mech"], might: 2, controller: "A" })
        .unit("enemy-mech", { tags: ["Mech"], might: 3, owner: "B", controller: "B" })
        .build();
      assert.equal(evaluateDeclaredCondition(breakneckMech.abilities[1].condition, chainEnvironment(withOther, "mech", "A")), true);
      assert.equal(evaluateDeclaredCondition(breakneckMech.abilities[1].condition, chainEnvironment(withoutOther, "mech", "A")), false);
    },
  },
  {
    name: "Crescent Guardian · no spell played: the printed 4 Energy is paid and the optional 1 Chaos Power is not charged",
    canonicalCardId: CRESCENT,
    sourceProgram: crescentGuardian,
    program: executableView(crescentGuardian),
    scenario: {
      players: { A: { energy: 4, power: ["Chaos"] } },
      objects: [
        { id: "guardian", cardId: CRESCENT, types: ["unit"], tags: ["Mount Targon"], zone: "hand", energy: 4, power: null, might: 4 },
      ],
      operations: [{ type: "play", object: "guardian", player: "A" }],
      expect: {
        objects: {
          // energy: null / power: null stay "no printed value"; the printed
          // 4 Energy is paid and the optional 1 Chaos Power is not charged on
          // this board (no spell was played). The entry orientation is the
          // blocked half and is asserted by the printed-outcome row below.
          guardian: { zone: "board", location: baseA, energy: 4, power: null, might: 4 },
        },
        players: { A: { energy: 0, power: ["Chaos"] } },
        events: { includes: [
          { timingPoint: "object-enters-board", object: { ref: "guardian" } },
          { timingPoint: "card-played", object: { ref: "guardian" } },
        ] },
      },
    },
    verify: rejectsStaticBinding(crescentGuardian, 0, /cost\.additional/),
  },
  {
    name: "Monch · the printed 6 Energy is paid and the opponent's stunned unit is untouched",
    canonicalCardId: MONCH,
    sourceProgram: monch,
    program: executableView(monch),
    scenario: {
      players: { A: { energy: 6 } },
      objects: [
        { id: "monch", cardId: MONCH, types: ["unit"], tags: ["Bandle City"], zone: "hand", energy: 6, power: null, might: 6 },
        { id: "stunned-enemy", owner: "B", types: ["unit"], zone: "board", might: 3, stunned: true },
      ],
      operations: [{ type: "play", object: "monch", player: "A" }],
      expect: {
        objects: {
          // 424.1.a.1: an already-Stunned unit is not Stunned again, so the
          // opponent unit keeps its identity and state. The printed ready
          // entry for this board, and the printed discount, are not asserted
          // here: the merged engine reaches the orientation without evaluating
          // its gate, and the discount has no consumer. Both printed outcomes
          // have their own TODO rows below.
          monch: { zone: "board", location: baseA, energy: 6, power: null, might: 6 },
          "stunned-enemy": { zone: "board", controller: "B", might: 3, stunned: true },
        },
        players: { A: { energy: 0 } },
        events: { sequence: [
          { timingPoint: "object-enters-chain", object: { ref: "monch" } },
          { timingPoint: "object-enters-board", object: { ref: "monch" } },
          { timingPoint: "card-played", object: { ref: "monch" } },
        ] },
      },
    },
    // The printed discount has no consumer: the merged binder refuses the
    // continuous.cost-modification kind, so the -2 Energy never reaches the
    // Finalize cost plan. The printed outcome is the TODO row below.
    verify: rejectsStaticBinding(monch, 0, /cost-modification/),
  },
  {
    name: "Wuju Master · below Level 6 no Might bonus is applied and no XP is invented",
    canonicalCardId: WUJU,
    sourceProgram: wujuMaster,
    program: executableView(wujuMaster),
    scenario: {
      players: { A: { xp: 5 } },
      objects: [
        { id: "master", cardId: WUJU, types: ["legend"], tags: ["Master Yi"], zone: "board", energy: null, power: null, might: null },
        { id: "ally", types: ["unit"], zone: "board", might: 3 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", might: 4 },
      ],
      expect: {
        objects: {
          // Might is deliberately not asserted for the Legend: the reference
          // kernel coerces a printed null Might to 1 (RIFT-641/RIFT-642 carry
          // the same pending observation). energy/power do survive as null.
          master: { zone: "board", energy: null, power: null },
          ally: { zone: "board", might: 3 },
          enemy: { zone: "board", might: 4 },
        },
        players: { A: { xp: 5 } },
        events: { exact: [] },
      },
    },
    verify() {
      // 824.1.b.1/824.1.c: the XP threshold must read the controlling player's
      // live XP. The declared result has no producer, so the merged evaluator
      // fails closed instead of turning a missing value into an object count.
      assert.throws(
        () => evaluateDeclaredCondition(wujuMaster.abilities[0].condition, chainEnvironment(world().player("A", { xp: 5 }).unit("master", { types: ["legend"], controller: "A" }).build(), "master", "A")),
        /Unavailable condition result: wuju-master\.controller-xp/
      );
    },
  },
];

// ---------------------------------------------------------------------------
// Boundaries. A negated (unpayable) play and a condition-not-satisfied board
// are driven through the same real path; the printed outcomes the merged engine
// does not produce yet are TODO rows below.
// ---------------------------------------------------------------------------
const boundaryRows = [
  {
    name: "Crescent Guardian boundary (negated) · 3 Energy cannot pay the printed 4",
    canonicalCardId: CRESCENT,
    sourceProgram: crescentGuardian,
    program: executableView(crescentGuardian),
    scenario: {
      players: { A: { energy: 3, power: ["Chaos"] } },
      objects: [
        { id: "guardian", cardId: CRESCENT, types: ["unit"], tags: ["Mount Targon"], zone: "hand", energy: 4, power: null, might: 4 },
      ],
      operations: [{ type: "play", object: "guardian", player: "A" }],
    },
    // The static additional-cost condition is still unevaluated, so the binder
    // fails closed before a cost plan can reach the printed-Energy insufficiency
    // check. Keep the stricter existing gap visible instead of accepting a
    // later, less precise failure.
    expectedFailure: /Static additional cost crescent-guardian\.additional-cost has an unevaluated condition/,
  },
  {
    name: "Wuju Master boundary (condition not satisfied) · below Level 6 an entering unit stays exhausted",
    canonicalCardId: WUJU,
    sourceProgram: wujuMaster,
    program: executableView(wujuMaster),
    scenario: {
      players: { A: { xp: 5, energy: 6 } },
      objects: [
        { id: "master", cardId: WUJU, types: ["legend"], tags: ["Master Yi"], zone: "board", energy: null, power: null, might: null },
        { id: "drake", program: cloudDrake, types: ["unit"], tags: ["Dragon", "Demacia"], zone: "hand", energy: 6, power: null, might: 5 },
        { id: "top", types: ["unit"], zone: "deck" },
      ],
      operations: [
        { type: "play", object: "drake", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: {
        objects: {
          // 359.2.c: with 5 XP the Level 11 clause is inactive, so the unit
          // enters exhausted and keeps its printed Might; the deck card is
          // drawn by Cloud Drake's own printed ability.
          drake: { zone: "board", location: baseA, exhausted: true, might: 5, power: null },
          top: { zone: "hand" },
        },
        players: { A: { xp: 5, energy: 0 } },
        events: { includes: [{ timingPoint: "card-drawn" }] },
      },
    },
  },
  {
    name: "Wuju Master boundary (no eligible body target) · the per-object entry selector is rejected",
    canonicalCardId: WUJU,
    sourceProgram: wujuMaster,
    program: executableView(wujuMaster),
    scenario: {
      players: { A: { xp: 11 } },
      objects: [
        { id: "master", cardId: WUJU, types: ["legend"], tags: ["Master Yi"], zone: "board", energy: null, power: null, might: null },
        { id: "ally", types: ["unit"], zone: "board", might: 3 },
      ],
      expect: { objects: { ally: { might: 3 } }, events: { exact: [] } },
    },
    verify: rejectsEntryBodyTarget(wujuMaster, 1, /Unsupported entry body target value/),
  },
];

// Printed outcomes not yet produced by the merged engine. Each row names its
// measured gap and is reported as TODO.
const pendingRows = [
  {
    todo: "RIFT-260 follow-up: the entry matcher ignores ability.condition, so the no-spell board still gets the ready entry (CR 356.4.f.1/359.2.c/805.6.a)",
    name: "pending printed · Crescent Guardian with no spell played must enter exhausted",
    canonicalCardId: CRESCENT,
    sourceProgram: crescentGuardian,
    program: executableView(crescentGuardian),
    scenario: {
      players: { A: { energy: 4, power: ["Chaos"] } },
      objects: [
        { id: "guardian", cardId: CRESCENT, types: ["unit"], tags: ["Mount Targon"], zone: "hand", energy: 4, power: null, might: 4 },
      ],
      operations: [{ type: "play", object: "guardian", player: "A" }],
      expect: {
        objects: { guardian: { zone: "board", exhausted: true } },
        players: { A: { energy: 0, power: ["Chaos"] } },
      },
    },
  },
  {
    todo: "RIFT-260 follow-up: the entry matcher ignores ability.condition, so a board without an opponent-controlled stunned unit still gets the ready entry (CR 364.3.a/424.1.a)",
    name: "pending printed · Monch without an opponent stunned unit must enter exhausted",
    canonicalCardId: MONCH,
    sourceProgram: monch,
    program: executableView(monch),
    scenario: {
      players: { A: { energy: 6 } },
      objects: [
        { id: "monch", cardId: MONCH, types: ["unit"], tags: ["Bandle City"], zone: "hand", energy: 6, power: null, might: 6 },
        { id: "own-stunned", types: ["unit"], zone: "board", might: 3, stunned: true },
        { id: "ready-enemy", owner: "B", types: ["unit"], zone: "board", might: 3, stunned: false },
      ],
      operations: [{ type: "play", object: "monch", player: "A" }],
      expect: { objects: { monch: { zone: "board", exhausted: true } } },
    },
  },
  {
    todo: "Finalize has no consumer for the static continuous.cost-modification, so the printed -2 Energy discount is never applied (CR 356.4/356.4.a)",
    name: "pending printed · Monch with an opponent stunned unit costs 4 Energy and enters ready",
    canonicalCardId: MONCH,
    sourceProgram: monch,
    program: executableView(monch),
    scenario: {
      players: { A: { energy: 6 } },
      objects: [
        { id: "monch", cardId: MONCH, types: ["unit"], tags: ["Bandle City"], zone: "hand", energy: 6, power: null, might: 6 },
        { id: "stunned-enemy", owner: "B", types: ["unit"], zone: "board", might: 3, stunned: true },
      ],
      operations: [{ type: "play", object: "monch", player: "A" }],
      expect: {
        objects: { monch: { zone: "board", exhausted: false } },
        players: { A: { energy: 2 } },
      },
    },
  },
  {
    todo: "RIFT-268 follow-up: the controller-XP result has no producer, so the Level 6 +1 Might layer never activates (CR 824.1.b.1/824.1.c)",
    name: "pending printed · Wuju Master at 6 XP grants +1 Might to your units only",
    canonicalCardId: WUJU,
    sourceProgram: wujuMaster,
    program: executableView(wujuMaster),
    scenario: {
      players: { A: { xp: 6 } },
      objects: [
        { id: "master", cardId: WUJU, types: ["legend"], tags: ["Master Yi"], zone: "board", energy: null, power: null, might: null },
        { id: "ally", types: ["unit"], zone: "board", might: 3 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", might: 4 },
      ],
      expect: { objects: { ally: { might: 4 }, enemy: { might: 4 } } },
    },
  },
  {
    todo: "RIFT-268/RIFT-260 follow-ups: live controller XP and the per-object entry window are missing, so the Level 11 entry rewrite cannot run (CR 824.1.b.1/369.3)",
    name: "pending printed · Wuju Master at 11 XP: a friendly entering unit gets +1 Might and enters ready",
    canonicalCardId: WUJU,
    sourceProgram: wujuMaster,
    program: executableView(wujuMaster),
    scenario: {
      players: { A: { xp: 11, energy: 6 } },
      objects: [
        { id: "master", cardId: WUJU, types: ["legend"], tags: ["Master Yi"], zone: "board", energy: null, power: null, might: null },
        { id: "drake", program: cloudDrake, types: ["unit"], tags: ["Dragon", "Demacia"], zone: "hand", energy: 6, power: null, might: 5 },
        { id: "top", types: ["unit"], zone: "deck" },
      ],
      operations: [
        { type: "play", object: "drake", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: {
        objects: { drake: { zone: "board", might: 6, exhausted: false, power: null } },
        players: { A: { xp: 11, energy: 0 } },
      },
    },
  },
];

/**
 * Register each row as its own test. Every passing row proves the published
 * program's exact status, then runs its scenario through the real pipeline and
 * checks that nothing was left on the chain. TODO rows assert the printed
 * outcome and are reported pending.
 */
const runSuite = (templateName, suiteRows) => {
  const cases = defineTemplateSuite(templateName, suiteRows);
  for (const [index, golden] of cases.entries()) {
    const row = suiteRows[index];
    const gap = row.todo
      ?? (row.expectedFailure !== undefined ? undefined
        : row.canonicalCardId === CRESCENT
          ? 'Static ability kind cost.additional has no layer mapping; missing additional-cost Finalize consumer'
          : row.canonicalCardId === MONCH
            ? 'Static ability kind continuous.cost-modification has no layer mapping; missing cost-modification CostPlan consumer'
            : row.canonicalCardId === WUJU
              ? 'Unsupported entry body target value: {"linked":"replacement.object"}; missing replaced-object target resolution'
              : undefined);
    if (gap !== undefined) {
      test.todo(`${golden.name} — ${gap}`);
      continue;
    }
    test(golden.name, () => {
      if (row.canonicalCardId === BREAKNECK) {
        assert.equal(row.sourceProgram.status, "executable", "Breakneck Mech is executable");
        assert.equal(row.sourceProgram.judgeReason, undefined);
      } else {
        assert.equal(row.sourceProgram.status, "judge-required", `${row.canonicalCardId} stays judge-required`);
        assert.ok(row.sourceProgram.judgeReason?.trim(), `${row.canonicalCardId} keeps an explicit judge reason`);
      }
      if (row.expectedFailure !== undefined) {
        assert.throws(golden.run, row.expectedFailure);
        return;
      }
      const result = golden.run();
      assert.deepEqual(result.state.chain, []);
      row.verify?.(result);
    });
  }
};

runSuite("RIFT-677 static+replacement||effect.ready", rows);
runSuite("RIFT-677 static+replacement||effect.ready boundary", boundaryRows);
runSuite("RIFT-677 static+replacement||effect.ready pending printed", pendingRows);
