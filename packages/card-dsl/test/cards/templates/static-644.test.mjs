// RIFT-644: template-level golden for the twelve static|| cards whose IR
// signature is "one static ability". `static||` is a structural grouping, not
// one executable effect: the shared scenario harness only accepts executable
// programs, so each row builds a test-only executable view of the published
// program (same abilities array) to drive the real lifecycle, while the test
// body asserts the published program itself stays judge-required with its
// judgeReason and that runCardScenario refuses it.
//
// Per row the scenario describes the physical object setup and the assertions
// below are this card's own result through the production path. Where the
// printed text cannot be executed yet, the assertion pins the concrete current
// gap named by that card's judgeReason (labelled as current merged behavior in
// the comment next to it); it is gap evidence and is never presented as printed
// semantics. The printed expectations that still need engine work are kept as
// test.todo titles at the bottom; no row promotes a card to executable.
//
// Per-card 1st/2nd layer goldens (validation, identity, structure and the
// component-level probes) stay in test/cards/<set>/<slug>.test.mjs; that file's
// header points back here for the scenario evidence.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite, runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { ProgramBindingError } from "../../../../engine-core/dist/programs/errors.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { appliedCosts } from "../../../../engine-core/dist/layers/rules/query.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

import crimsonPigeons from "../../../dist/cards/unl/crimson-pigeons.js";
import determinedSentry from "../../../dist/cards/unl/determined-sentry.js";
import mageseekerInvestigator from "../../../dist/cards/unl/mageseeker-investigator.js";
import masterYiUnstoppable from "../../../dist/cards/unl/master-yi-unstoppable.js";
import petalPixie from "../../../dist/cards/unl/petal-pixie.js";
import preparedNeophyte from "../../../dist/cards/unl/prepared-neophyte.js";
import soulShepherd from "../../../dist/cards/unl/soul-shepherd.js";
import syndraTranscendent from "../../../dist/cards/unl/syndra-transcendent.js";
import targonianVisionary from "../../../dist/cards/unl/targonian-visionary.js";
import dragonRoost from "../../../dist/cards/ven/dragon-roost.js";
import duneSurfer from "../../../dist/cards/ven/dune-surfer.js";
import keeperOfLaw from "../../../dist/cards/ven/keeper-of-law.js";

const TEMPLATE = "RIFT-644 static|| template";

const HERE = { type: "battlefield", id: "bf-1" };
const ELSEWHERE = { type: "battlefield", id: "bf-2" };

const sourcePrograms = new Map();
/** Test-only executable view; the published program stays judge-required. */
function executableView(program) {
  assert.equal(program.status, "judge-required", program.canonicalCardId + " must stay judge-required until every ability executes");
  assert.ok(program.judgeReason?.trim(), program.canonicalCardId + " needs a concrete judgeReason");
  sourcePrograms.set(program.canonicalCardId, program);
  return { ...program, status: "executable", judgeReason: undefined };
}

function hostOf(result, canonicalCardId) {
  const host = result.state.objects.find(object => object.cardId === canonicalCardId);
  assert.ok(host, "the source reached the Board through the real scenario lifecycle");
  return host;
}

/** Bind every static ability of the published program with the production binder. */
function bindStatics(result, canonicalCardId) {
  const source = sourcePrograms.get(canonicalCardId);
  const statics = source.abilities.filter(ability => ability.kind === "static");
  return statics.map(ability => ({
    ability,
    bind: binder => binder.bindStatic(ability, hostOf(result, canonicalCardId)),
  }));
}

/** Fail-closed evidence: the production binder rejects the declared static ability. */
function assertBindingErrors(result, canonicalCardId, patterns) {
  const statics = bindStatics(result, canonicalCardId);
  assert.equal(statics.length, patterns.length, "one expected binder result per static ability");
  const engine = fixture({ cards: [] }).engine;
  const binder = createEngineStaticBinder(engine);
  statics.forEach((staticAbility, index) => {
    assert.throws(() => staticAbility.bind(binder), error => {
      assert.ok(error instanceof ProgramBindingError, "expected a ProgramBindingError for ability " + index);
      assert.equal(error.code, "judge-required");
      assert.match(error.message, patterns[index]);
      return true;
    });
  });
  assert.equal(engine.layers.registry.list().length, 0, "no layer entry may be registered for a rejected static ability");
}

const rows = [
  {
    // 053.1/479.4/807.1.d: the printed +2 needs a live attacker designation and
    // a controller-relative "another unit" set; neither exists, so the merged
    // layer engine cannot grant the printed Might (judgeReason).
    name: "Crimson Pigeons — the +2 declaration binds, but the attacker/another-unit condition has no production data",
    canonicalCardId: crimsonPigeons.canonicalCardId,
    program: executableView(crimsonPigeons),
    scenario: {
      // The shared harness object config does not carry ObjectSnapshot.combatRole
      // yet (engine-core/src/effects/testing/scenario/run.ts objectConfig), and
      // no production turn/combat flow assigns it either, so no attacker
      // designation can be supplied here - which is exactly the recorded gap.
      objects: [
        { id: "pigeons", cardId: crimsonPigeons.canonicalCardId, types: ["unit"], zone: "board", location: HERE, might: 3 },
        { id: "ally-attacker", types: ["unit"], zone: "board", location: HERE, might: 2 },
        { id: "enemy-elsewhere", owner: "B", types: ["unit"], zone: "board", location: ELSEWHERE, might: 4 },
      ],
      operations: [],
      expect: {
        objects: {
          pigeons: { zone: "board", location: HERE, might: 3 },
          "ally-attacker": { zone: "board", location: HERE, might: 2 },
          "enemy-elsewhere": { zone: "board", location: ELSEWHERE, might: 4 },
        },
        events: { exact: [] },
      },
    },
    verify(result) {
      // The declaration itself reaches the real static binder as an
      // arithmetic continuous.might +2 on the host; only its condition cannot
      // be evaluated truthfully (layers/filter.ts ignores combatRole and
      // compares controller: "controller" literally, and no production
      // Attacker designation exists).
      const engine = fixture({ cards: [] }).engine;
      createEngineStaticBinder(engine).bindStatic(sourcePrograms.get(crimsonPigeons.canonicalCardId).abilities[0], hostOf(result, crimsonPigeons.canonicalCardId));
      const [entry] = engine.layers.registry.list();
      assert.equal(entry.effect.layer, "arithmetic");
      assert.equal(entry.effect.effect.kind, "continuous.might");
      assert.equal(entry.effect.effect.amount, 2);
      assert.equal(typeof entry.effect.effect.condition, "function");
    },
  },
  {
    // 054/054.1 + 144.4.b: the prohibition is declared and really reaches the
    // layer snapshot for the host only; the Standard Move / effect.move
    // consumers are still missing, so the card stays judge-required.
    name: "Determined Sentry — move-to-base is recorded for the host only",
    canonicalCardId: determinedSentry.canonicalCardId,
    program: executableView(determinedSentry),
    scenario: {
      objects: [
        { id: "sentry", cardId: determinedSentry.canonicalCardId, types: ["unit"], zone: "board", location: HERE, might: 1 },
        { id: "neighbour", types: ["unit"], zone: "board", location: HERE, might: 1 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: HERE, might: 1 },
      ],
      operations: [],
      expect: {
        objects: {
          sentry: { zone: "board", movement: { allowed: true, canMove: true, canGank: false, restrictions: ["move-to-base"] } },
          neighbour: { zone: "board", movement: { allowed: true, canMove: true, canGank: false, restrictions: [] } },
          enemy: { zone: "board", movement: { allowed: true, canMove: true, canGank: false, restrictions: [] } },
        },
        events: { exact: [] },
      },
    },
    verify(result) {
      const statics = bindStatics(result, determinedSentry.canonicalCardId);
      assert.equal(statics.length, 1);
      const engine = fixture({ cards: [] }).engine;
      statics[0].bind(createEngineStaticBinder(engine));
      const [entry] = engine.layers.registry.list();
      // Both spellings are declared; the layer fold reads the singular one.
      assert.equal(entry.effect.effect.restriction, "move-to-base");
      assert.deepEqual(entry.effect.effect.restrictions, ["move-to-base"]);
    },
  },
  {
    // 204.4: the declaration binds, but normalizedEffect keeps kind
    // "restriction" instead of "applied-cost", so appliedCosts() cannot see it
    // and no movement cost plan consumes it either.
    name: "Mageseeker Investigator — applied cost binds as a restriction and is invisible to appliedCosts()",
    canonicalCardId: mageseekerInvestigator.canonicalCardId,
    program: executableView(mageseekerInvestigator),
    scenario: {
      objects: [
        { id: "investigator", cardId: mageseekerInvestigator.canonicalCardId, types: ["unit"], zone: "board", location: HERE, might: 4 },
      ],
      operations: [],
      expect: {
        objects: { investigator: { zone: "board", location: HERE, might: 4 } },
        events: { exact: [] },
      },
    },
    verify(result) {
      const statics = bindStatics(result, mageseekerInvestigator.canonicalCardId);
      assert.equal(statics.length, 1);
      const engine = fixture({ cards: [] }).engine;
      statics[0].bind(createEngineStaticBinder(engine));
      const [entry] = engine.layers.registry.list();
      assert.equal(entry.effect.effect.kind, "restriction");
      assert.equal(entry.effect.effect.mode, "applied-cost");
      assert.deepEqual(entry.effect.effect.actions, ["move"]);
      assert.deepEqual(appliedCosts(engine.layers.registry, "move"), []);
      assert.deepEqual(appliedCosts(engine.layers.registry, "play"), []);
    },
  },
  {
    // 824.1 / 356.4: no XP-valued condition and no cost.modify layer mapping;
    // every declared static ability fails closed in the production binder.
    name: "Master Yi, Unstoppable — the three discounts and the Level 16 restriction all fail closed",
    canonicalCardId: masterYiUnstoppable.canonicalCardId,
    program: executableView(masterYiUnstoppable),
    scenario: {
      objects: [
        { id: "master-yi", cardId: masterYiUnstoppable.canonicalCardId, types: ["unit"], zone: "board", location: HERE, might: 12 },
      ],
      operations: [],
      expect: {
        objects: { "master-yi": { zone: "board", location: HERE, might: 12 } },
        events: { exact: [] },
      },
    },
    verify(result) {
      assertBindingErrors(result, masterYiUnstoppable.canonicalCardId, [
        /Unsupported static appliesTo "play-cost"/,
        /Unsupported static appliesTo "play-cost"/,
        /Unsupported static appliesTo "play-cost"/,
        /Unsupported static appliesTo "spells-and-abilities"/,
      ]);
    },
  },
  {
    // 816.3 + 053.3: "+1 for each of your units with [Temporary] at my
    // battlefield" needs a keyword-feature filter and a dynamic count in the
    // static path. The binder accepts the declaration, but the layer engine
    // never evaluates the count and silently falls back to 0.
    name: "Petal Pixie — the count amount silently evaluates to 0 beside two Temporary units",
    canonicalCardId: petalPixie.canonicalCardId,
    program: executableView(petalPixie),
    scenario: {
      objects: [
        { id: "pixie", cardId: petalPixie.canonicalCardId, types: ["unit"], zone: "board", location: HERE, might: 2 },
        { id: "temp-here-1", types: ["unit"], zone: "board", location: HERE, might: 1, keywords: [{ id: "Temporary" }] },
        { id: "temp-here-2", types: ["unit"], zone: "board", location: HERE, might: 1, keywords: [{ id: "Temporary" }] },
        { id: "temp-elsewhere", types: ["unit"], zone: "board", location: ELSEWHERE, might: 1, keywords: [{ id: "Temporary" }] },
      ],
      operations: [],
      expect: {
        objects: {
          pixie: { zone: "board", location: HERE, might: 2 },
          "temp-here-1": { zone: "board", location: HERE, might: 1, keywords: [{ id: "Temporary" }] },
        },
        events: { exact: [] },
      },
    },
    verify(result) {
      const statics = bindStatics(result, petalPixie.canonicalCardId);
      assert.equal(statics.length, 1);
      const engine = fixture({ cards: [] }).engine;
      statics[0].bind(createEngineStaticBinder(engine));
      const [entry] = engine.layers.registry.list();
      assert.equal(entry.effect.effect.kind, "continuous.might");
      // The declared amount is still the count expression; the layer engine
      // never binds it to the affected object set.
      assert.equal(entry.effect.effect.amount.kind, "count");
    },
  },
  {
    // 383.2 / 206: the gate needs the Energy actually spent to play a spell
    // this turn. The merged binder evaluates the declared compare as an object
    // count, so four spells in the Trash add +4 even though nothing was paid.
    // The +4 below is current merged behavior pinned as gap evidence; the
    // printed expectation stays a todo at the end.
    name: "Prepared Neophyte — +4 applies from an object count with zero Energy spent",
    canonicalCardId: preparedNeophyte.canonicalCardId,
    program: executableView(preparedNeophyte),
    scenario: {
      players: { A: { energy: 0 } },
      objects: [
        { id: "neophyte", cardId: preparedNeophyte.canonicalCardId, types: ["unit"], zone: "board", location: HERE, might: 1 },
        { id: "spell-1", types: ["spell"], zone: "trash" },
        { id: "spell-2", types: ["spell"], zone: "trash" },
        { id: "spell-3", types: ["spell"], zone: "trash" },
        { id: "spell-4", types: ["spell"], zone: "trash" },
      ],
      operations: [],
      expect: {
        objects: { neophyte: { zone: "board", location: HERE, might: 5 } },
        players: { A: { energy: 0 } },
        events: { exact: [] },
      },
    },
  },
  {
    // 479.4 + 740.1.a: the supported path really grants the printed +1 to the
    // controller's token units and nothing else. The card stays judge-required
    // for the frozen-controller take-control gap recorded in judgeReason and
    // covered by the component test in test/cards/unl/soul-shepherd.test.mjs.
    name: "Soul Shepherd — +1 Might reaches your token units only",
    canonicalCardId: soulShepherd.canonicalCardId,
    program: executableView(soulShepherd),
    scenario: {
      objects: [
        { id: "shepherd", cardId: soulShepherd.canonicalCardId, types: ["unit"], zone: "board", location: HERE, might: 3 },
        { id: "my-token", types: ["unit"], zone: "board", location: HERE, might: 1, isToken: true },
        { id: "my-unit", types: ["unit"], zone: "board", location: HERE, might: 1 },
        { id: "enemy-token", owner: "B", types: ["unit"], zone: "board", location: HERE, might: 1, isToken: true },
      ],
      operations: [],
      expect: {
        objects: {
          shepherd: { zone: "board", location: HERE, might: 3 },
          "my-token": { zone: "board", location: HERE, might: 2 },
          "my-unit": { zone: "board", location: HERE, might: 1 },
          "enemy-token": { zone: "board", location: HERE, might: 1 },
        },
        events: { exact: [] },
      },
    },
  },
  {
    // 820.1 / 820.1.c / 308-310: Repeat really is granted to your spells only,
    // but the "while I'm in a showdown" placeholder evaluates as a truthy
    // constant in the merged interpreter and the granted instance carries no
    // payable Repeat cost into Finalize.
    name: "Syndra, Transcendent — Repeat is granted to your spells with the showdown gate unevaluated",
    canonicalCardId: syndraTranscendent.canonicalCardId,
    program: executableView(syndraTranscendent),
    scenario: {
      // No Showdown State exists in this scenario; the grant still applies.
      phase: "main",
      objects: [
        { id: "syndra", cardId: syndraTranscendent.canonicalCardId, types: ["unit"], zone: "board", location: HERE, might: 6 },
        { id: "my-spell", types: ["spell"], zone: "hand", energy: 2, power: ["Chaos"] },
        { id: "enemy-spell", owner: "B", types: ["spell"], zone: "hand", energy: 2, power: ["Chaos"] },
        { id: "my-unit", types: ["unit"], zone: "hand" },
      ],
      operations: [],
      expect: {
        objects: {
          syndra: { zone: "board" },
          "my-spell": { zone: "hand", keywords: [{ id: "repeat" }] },
          "enemy-spell": { zone: "hand", keywords: [] },
          "my-unit": { zone: "hand", keywords: [] },
        },
        events: { exact: [] },
      },
    },
    verify(result) {
      const statics = bindStatics(result, syndraTranscendent.canonicalCardId);
      assert.equal(statics.length, 1);
      const engine = fixture({ cards: [] }).engine;
      statics[0].bind(createEngineStaticBinder(engine));
      const [entry] = engine.layers.registry.list();
      // 820.1.c: the printed Repeat cost is declared but is not carried into
      // the granted keyword instance (no payable cost is attached).
      assert.deepEqual(entry.effect.effect.cost, {
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: ["Chaos"] },
      });
      assert.equal(entry.effect.effect.keyword, "repeat");
      // The retained condition is evaluated as Boolean("in-showdown"), so it
      // is truthy even though no Showdown State exists.
      assert.equal(entry.effect.effect.condition(hostOf(result, syndraTranscendent.canonicalCardId)), true);
    },
  },
  {
    // 824.1.c: the retained 11-XP gate is a count expression, so with eleven
    // board objects and zero XP it really adds +4. The expectation below is
    // current merged behavior pinned as gap evidence (the printed requirement is
    // 11 XP, not 11 objects); the printed expectation stays a todo at the end.
    name: "Targonian Visionary — the Level 11 gate counts board objects and over-applies at 0 XP",
    canonicalCardId: targonianVisionary.canonicalCardId,
    program: executableView(targonianVisionary),
    scenario: {
      players: { A: { xp: 0 }, B: { xp: 0 } },
      objects: [
        { id: "visionary", cardId: targonianVisionary.canonicalCardId, types: ["unit"], zone: "board", location: HERE, might: 6 },
        ...Array.from({ length: 11 }, (unused, index) => ({ id: "filler-" + index, types: ["unit"], zone: "board", location: HERE, might: 1 })),
      ],
      operations: [],
      expect: {
        objects: { visionary: { zone: "board", location: HERE, might: 10 } },
        players: { A: { xp: 0 } },
        events: { exact: [] },
      },
    },
  },
  {
    // 356.2.b / 355.17: cost.additional has no layer mapping, so the whole
    // static declaration fails closed; the printed null Energy/Power on the
    // Battlefield object are preserved by the harness.
    name: "Dragon Roost — the optional additional cost fails closed in the production binder",
    canonicalCardId: dragonRoost.canonicalCardId,
    program: executableView(dragonRoost),
    scenario: {
      objects: [
        { id: "roost", cardId: dragonRoost.canonicalCardId, types: ["battlefield"], zone: "board", location: HERE, might: null, energy: null, power: null },
      ],
      operations: [],
      expect: {
        objects: { roost: { zone: "board", location: HERE, energy: null, power: null } },
        events: { exact: [] },
      },
    },
    verify(result) {
      assertBindingErrors(result, dragonRoost.canonicalCardId, [
        /Static ability kind cost\.additional has no layer mapping/,
      ]);
    },
  },
  {
    // 764-767: continuous.ignore-ability has no layer mapping, and the binder
    // refuses the opponent-relative filter first; nothing can be ignored.
    name: "Dune Surfer — the ignore declaration fails closed in the production binder",
    canonicalCardId: duneSurfer.canonicalCardId,
    program: executableView(duneSurfer),
    scenario: {
      objects: [
        { id: "surfer", cardId: duneSurfer.canonicalCardId, types: ["unit"], zone: "board", location: HERE, might: 3 },
        { id: "enemy-tank", owner: "B", types: ["unit"], zone: "board", location: HERE, might: 4, keywords: [{ id: "Tank" }] },
      ],
      operations: [],
      expect: {
        objects: {
          surfer: { zone: "board", location: HERE, might: 3 },
          "enemy-tank": { zone: "board", location: HERE, might: 4, keywords: [{ id: "Tank" }] },
        },
        events: { exact: [] },
      },
    },
    verify(result) {
      assertBindingErrors(result, duneSurfer.canonicalCardId, [
        /Static controller:opponent filter needs a relative-player query/,
      ]);
    },
  },
  {
    // 356.4: continuous.cost-modification has no layer mapping and no
    // CardProgram -> Finalize discount consumer; the condition's battlefield
    // count is likewise not an honest "exactly two units there" predicate.
    name: "Keeper of Law — the static discount fails closed in the production binder",
    canonicalCardId: keeperOfLaw.canonicalCardId,
    program: executableView(keeperOfLaw),
    scenario: {
      objects: [
        { id: "keeper", cardId: keeperOfLaw.canonicalCardId, types: ["unit"], zone: "board", location: HERE, might: 5 },
        { id: "my-battlefield", types: ["battlefield"], zone: "board", location: ELSEWHERE, energy: null, power: null, might: null },
        { id: "unit-a", types: ["unit"], zone: "board", location: ELSEWHERE, might: 1 },
        { id: "unit-b", types: ["unit"], zone: "board", location: ELSEWHERE, might: 1 },
      ],
      operations: [],
      expect: {
        objects: {
          keeper: { zone: "board", location: HERE, might: 5 },
          "my-battlefield": { zone: "board", location: ELSEWHERE, energy: null, power: null },
        },
        events: { exact: [] },
      },
    },
    verify(result) {
      assertBindingErrors(result, keeperOfLaw.canonicalCardId, [
        /Static ability kind continuous\.cost-modification has no layer mapping/,
      ]);
    },
  },
];

for (const [index, templateCase] of defineTemplateSuite(TEMPLATE, rows).entries()) {
  const row = rows[index];
  test(templateCase.name, () => {
    const source = sourcePrograms.get(row.canonicalCardId);
    // The harness gate stays closed for the published program: the scenario
    // API itself refuses judge-required programs.
    assert.throws(() => runCardScenario(source, row.scenario), {
      message: "Scenario program " + row.canonicalCardId + " is judge-required",
    });
    assert.equal(row.program.abilities, source.abilities, "the executable view must not rewrite abilities");
    const result = templateCase.run();
    assert.deepEqual(result.state.chain, [], "a static template row must not leave chain items");
    row.verify?.(result);
  });
}

// Boundary group: condition-not-satisfied states for the cards whose printed
// effect is currently gated by the merged condition algebra.
const boundaryRows = [
  {
    name: "Crimson Pigeons boundary — the unsatisfiable attacker condition leaves the printed +2 off",
    canonicalCardId: crimsonPigeons.canonicalCardId,
    program: executableView(crimsonPigeons),
    scenario: {
      objects: [
        { id: "pigeons", cardId: crimsonPigeons.canonicalCardId, types: ["unit"], zone: "board", location: HERE, might: 3 },
        { id: "ally-attacker", types: ["unit"], zone: "board", location: HERE, might: 2 },
      ],
      operations: [],
      expect: {
        objects: {
          pigeons: { zone: "board", location: HERE, might: 3 },
          "ally-attacker": { might: 2 },
        },
        events: { exact: [] },
      },
    },
  },
  {
    name: "Targonian Visionary boundary — 11 XP with a single board object does not grant +4",
    canonicalCardId: targonianVisionary.canonicalCardId,
    program: executableView(targonianVisionary),
    scenario: {
      players: { A: { xp: 11 } },
      objects: [
        { id: "visionary", cardId: targonianVisionary.canonicalCardId, types: ["unit"], zone: "board", location: HERE, might: 6 },
      ],
      operations: [],
      expect: {
        objects: { visionary: { zone: "board", location: HERE, might: 6 } },
        players: { A: { xp: 11 } },
        events: { exact: [] },
      },
    },
  },
  {
    name: "Petal Pixie boundary — no Temporary unit at my battlefield still leaves the silent 0",
    canonicalCardId: petalPixie.canonicalCardId,
    program: executableView(petalPixie),
    scenario: {
      objects: [
        { id: "pixie", cardId: petalPixie.canonicalCardId, types: ["unit"], zone: "board", location: HERE, might: 2 },
        { id: "plain-here", types: ["unit"], zone: "board", location: HERE, might: 1 },
        { id: "temp-elsewhere", types: ["unit"], zone: "board", location: ELSEWHERE, might: 1, keywords: [{ id: "Temporary" }] },
      ],
      operations: [],
      expect: {
        objects: {
          pixie: { zone: "board", location: HERE, might: 2 },
          "plain-here": { zone: "board", location: HERE, might: 1 },
          "temp-elsewhere": { zone: "board", location: ELSEWHERE, might: 1 },
        },
        events: { exact: [] },
      },
    },
  },
  {
    name: "Prepared Neophyte boundary — one spell in the Trash does not reach the printed threshold",
    canonicalCardId: preparedNeophyte.canonicalCardId,
    program: executableView(preparedNeophyte),
    scenario: {
      players: { A: { energy: 0 } },
      objects: [
        { id: "neophyte", cardId: preparedNeophyte.canonicalCardId, types: ["unit"], zone: "board", location: HERE, might: 1 },
        { id: "spell-1", types: ["spell"], zone: "trash" },
      ],
      operations: [],
      expect: {
        objects: { neophyte: { zone: "board", location: HERE, might: 1 } },
        players: { A: { energy: 0 } },
        events: { exact: [] },
      },
    },
  },
  {
    name: "Soul Shepherd boundary — an enemy token and a friendly non-token gain nothing",
    canonicalCardId: soulShepherd.canonicalCardId,
    program: executableView(soulShepherd),
    scenario: {
      objects: [
        { id: "shepherd", cardId: soulShepherd.canonicalCardId, types: ["unit"], zone: "board", location: HERE, might: 3 },
        { id: "enemy-token", owner: "B", types: ["unit"], zone: "board", location: HERE, might: 1, isToken: true },
        { id: "my-unit", types: ["unit"], zone: "board", location: HERE, might: 1 },
      ],
      operations: [],
      expect: {
        objects: {
          shepherd: { zone: "board", location: HERE, might: 3 },
          "enemy-token": { zone: "board", location: HERE, might: 1 },
          "my-unit": { zone: "board", location: HERE, might: 1 },
        },
        events: { exact: [] },
      },
    },
  },
];

for (const [index, templateCase] of defineTemplateSuite(TEMPLATE + " boundary", boundaryRows).entries()) {
  const row = boundaryRows[index];
  test(templateCase.name, () => {
    assert.equal(row.program.abilities, sourcePrograms.get(row.canonicalCardId).abilities);
    const result = templateCase.run();
    assert.deepEqual(result.state.chain, []);
  });
}

// Printed expectations that still need merged engine work. A todo is not
// execution evidence and must not become a passing assertion of the current
// wrong value; each title names the missing semantic and the recorded
// dependency in that card's judgeReason.
test.todo(
  "RIFT-644 Crimson Pigeons [" + crimsonPigeons.canonicalCardId + "]: a live Attacker designation plus the controller-relative \"another unit\" set " +
    "must grant the printed +2 Might while attacking (CR 466.2.c.3 / 807.1.d / 740.2.c) - layers/filter.ts ignores combatRole and compares " +
    "controller: \"controller\" literally, and no production turn/combat flow writes combatRole"
);
test.todo(
  "RIFT-644 Determined Sentry [" + determinedSentry.canonicalCardId + "]: the printed prohibition must stop a Standard Move and an effect.move to the " +
    "base (CR 054/054.1 / 144.4.b / 451.1) - the restriction reaches layers/rules/query.ts movement(), but no production caller supplies " +
    "DuelMovementRuleContext and effect.move never consults the query"
);
test.todo(
  "RIFT-644 Mageseeker Investigator [" + mageseekerInvestigator.canonicalCardId + "]: opponents must really pay the per-extra-unit applied cost as the " +
    "batch Move happens, including [A] any-domain Power and the batch count (CR 204.4 / 135.2.e.5 / 163.2.b) - the static declaration binds as kind " +
    "\"restriction\" so appliedCosts() cannot read it, no movement cost plan consumes it, and universal Power has no representation"
);
test.todo(
  "RIFT-644 Master Yi, Unstoppable [" + masterYiUnstoppable.canonicalCardId + "]: the [Level N][>] discounts must reach the Finalize discount stage with " +
    "the instead replacement and the 356.6 floor, and the [Level 16] Untargetable must reject illegal target choices (CR 824.1.c / 356.4 / 757.1) - " +
    "no XP-valued condition exists, cost.modify has no layer mapping, and the restriction's appliesTo shape is rejected"
);
test.todo(
  "RIFT-644 Petal Pixie [" + petalPixie.canonicalCardId + "]: each of your [Temporary] units at my battlefield must add +1 Might, counting only " +
    "Temporary members (CR 816.1 / 816.3 / 479.4) - the static filter path cannot express hasKeyword and the layer engine silently evaluates the " +
    "dynamic count amount as 0"
);
test.todo(
  "RIFT-644 Prepared Neophyte [" + preparedNeophyte.canonicalCardId + "]: +4 Might must apply exactly when 4+ Energy was actually spent to play a spell " +
    "this turn (CR 383.2 / 206 / 364.3.a) - Expr/Condition have no payment-amount or finalized-receipt reader and layers/engine.ts evaluates the " +
    "declared compare as an object count"
);
test.todo(
  "RIFT-644 Soul Shepherd [" + soulShepherd.canonicalCardId + "]: \"your token units\" must follow the current controller after take-control " +
    "(CR 479.4 / 740.1.a) - the shared static binder freezes controller: \"controller\" to the source's controller at first Board entry"
);
test.todo(
  "RIFT-644 Syndra, Transcendent [" + syndraTranscendent.canonicalCardId + "]: the Repeat grant must hold only while I'm in a showdown and the granted " +
    "instance must carry its payable 2 Energy + 1 Chaos additional cost into Finalize (CR 820.1 / 820.1.c.1 / 308-310) - the showdown predicate " +
    "placeholder is truthy and layer-granted keywords do not reach the spell's KeywordDef/Finalize path"
);
test.todo(
  "RIFT-644 Targonian Visionary [" + targonianVisionary.canonicalCardId + "]: the printed +4 must be Active exactly while the controller has 11+ XP " +
    "(CR 824.1.c / 824.1.c.1 / 824.1.d) - the retained count gate counts board objects and over-applies the +4 at 0 XP, and the Level predicate has " +
    "no layer or binder mapping"
);
test.todo(
  "RIFT-644 Dragon Roost [" + dragonRoost.canonicalCardId + "]: the optional [A][A] additional cost must be charged to a played Dragon and its " +
    "356.4.f.1 paid proof must make \"play it to this battlefield\" a mandatory requirement (CR 356.2.b / 355.17) - cost.additional has no layer " +
    "mapping and no Finalize producer binds the declaration to the pending played object"
);
test.todo(
  "RIFT-644 Dune Surfer [" + duneSurfer.canonicalCardId + "]: the controller must ignore [Tank] while assigning combat damage here (CR 764-767 / 815.1) - " +
    "no ignore-abilities consumer exists, [Tank]'s own assignment priority is not bound, and continuous.ignore-ability has no layer mapping"
);
test.todo(
  "RIFT-644 Keeper of Law [" + keeperOfLaw.canonicalCardId + "]: the printed 2 Energy + 1 Order discount must reach the Finalize cost plan exactly when " +
    "the controller's battlefield holds exactly two units there (CR 356.4 / 190.4) - continuous.cost-modification has no layer mapping, no " +
    "CardProgram -> Finalize consumer exists, and the \"there\" location anchor is not expressible"
);

