// RIFT-697 / README 4.1: keyword + static `||` template (ability kinds |
// timing points | instruction sequence).
//
// One row per card: canonical identity, shipped program, card-specific scenario
// and card-specific expectations. The rows run the authored abilities through
// the real generic harness (ProgramBinding + ChainEngine + EventPipeline), so
// play/cost settlement, lifecycle static binding, the layer gate and the real
// Empower/Disempower actions all use production code paths. Each shipped program
// is inspected separately by `declared`, so every row keeps its documented
// unsupported clause and `judge-required` status; the executable view only lifts
// the harness status gate and never rewrites card IR.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { bindStaticAbility, createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import escapedGrayback from "../../../dist/cards/ven/escaped-grayback.js";
import legionMarauder from "../../../dist/cards/ven/legion-marauder.js";
import punchingPoro from "../../../dist/cards/ven/punching-poro.js";
import sereneAscetic from "../../../dist/cards/ven/serene-ascetic.js";
import shadowFiend from "../../../dist/cards/ven/shadow-fiend.js";
import spiderling from "../../../dist/cards/ven/spiderling.js";

const baseA = { type: "base", player: "A" };
const battlefield = { type: "battlefield", id: "bf-697" };

const IDS = {
  grayback: escapedGrayback.canonicalCardId,
  legion: legionMarauder.canonicalCardId,
  poro: punchingPoro.canonicalCardId,
  serene: sereneAscetic.canonicalCardId,
  fiend: shadowFiend.canonicalCardId,
  spiderling: spiderling.canonicalCardId
};

/** Published programs stay judge-required; the probe only satisfies the harness status gate. */
function shipped(program) {
  const published = cardProgramsById.get(program.canonicalCardId);
  assert.ok(published, `generated card program ${program.canonicalCardId} is present`);
  assert.equal(published.status, "judge-required", `${program.canonicalCardId} stays judge-required`);
  assert.ok(published.judgeReason?.trim(), `${program.canonicalCardId} keeps a concrete judgeReason`);
  return { ...program, status: "executable", judgeReason: undefined };
}

// A synthetic control spell changes the Empowered status through a real paid
// play, target Finalize, interpreter and EventPipeline. It implements none of
// the six cards' missing printed Empower activation and mutates no state
// directly; it only drives the merged effect.empower primitive (442/443).
function controlSpell(mode) {
  return {
    canonicalCardId: `test.rift-697.${mode}`,
    rulesetVersion: "core-1.5",
    status: "executable",
    sourceText: `Test control: ${mode} a unit.`,
    abilities: [{
      kind: "play",
      body: [{
        id: `control.${mode}`,
        op: "effect.empower",
        args: {
          objects: { kind: "constant", value: { kind: "target", id: "controlled-unit" } },
          ...(mode === "disempower" ? { mode: { kind: "constant", value: "disempower" } } : {})
        },
        targets: [{ id: "controlled-unit", filter: { type: "unit", zone: "board" }, min: 1, max: 1 }]
      }]
    }]
  };
}

const empowerSpell = controlSpell("empower");
const disempowerSpell = controlSpell("disempower");
const enemyTargetSpell = {
  canonicalCardId: "test.rift-697.enemy-target",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText: "Test control: empower an enemy unit.",
  abilities: [{
    kind: "play",
    body: [{
      id: "control.enemy-target",
      op: "effect.empower",
      args: { objects: { kind: "constant", value: { kind: "target", id: "enemy-unit" } } },
      targets: [{ id: "enemy-unit", filter: { type: "unit", zone: "board", controller: "B" }, min: 1, max: 1 }]
    }]
  }]
};

const spell = (id, program) => ({ id, program, types: ["spell"], zone: "hand", energy: 1, power: [] });
const resolveSpell = object => [
  { type: "play", object, player: "A" },
  { type: "pass", player: "A" },
  { type: "pass", player: "B" }
];

/** Shared real-board layout for the five Empower cards. */
function empowerBoard(program, card) {
  return {
    players: { A: { energy: 10, power: card.power === null ? [] : [...card.power] } },
    objects: [
      { id: "source", cardId: program.canonicalCardId, name: card.name, types: ["unit"], zone: "hand", might: card.might, energy: card.energy, power: card.power },
      { id: "ally", types: ["unit"], zone: "board", location: baseA, might: 2 },
      { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: baseA, might: 4 },
      { id: "discard-option", types: ["unit"], zone: "hand", energy: 2, power: null },
      spell("empower", empowerSpell),
      spell("disempower", disempowerSpell)
    ],
    answers: { "target:controlled-unit": ["source"] },
    operations: [{ type: "play", object: "source", player: "A", location: baseA }]
  };
}

const empowerEvents = {
  sequence: [
    { timingPoint: "card-played", object: { ref: { id: "source" } } },
    { timingPoint: "empowered-changed", action: { type: "empower", object: "source" } }
  ]
};

const empowerCards = [
  {
    name: "Escaped Grayback / Empowered +2 Might lands on the host only",
    canonicalCardId: IDS.grayback,
    published: escapedGrayback,
    card: { name: "Escaped Grayback", energy: 3, power: null, might: 3 },
    empoweredMight: 5,
    keywords: [],
    declared: program => {
      assert.match(program.judgeReason, /params\.cost/);
      assert.match(program.judgeReason, /Kill a friendly unit/);
      assert.match(program.judgeReason, /ObjectSnapshot/);
    }
  },
  {
    name: "Legion Marauder / Empowered +1 Might lands on the host only",
    canonicalCardId: IDS.legion,
    published: legionMarauder,
    card: { name: "Legion Marauder", energy: 2, power: null, might: 2 },
    empoweredMight: 3,
    keywords: [],
    declared: program => {
      assert.match(program.judgeReason, /827\.1\.c\.2/);
      assert.match(program.judgeReason, /ObjectSnapshot/);
      assert.match(program.judgeReason, /二选一费用/);
    }
  },
  {
    name: "Punching Poro / Empowered +1 Might without discarding a card",
    canonicalCardId: IDS.poro,
    published: punchingPoro,
    card: { name: "Punching Poro", energy: 2, power: null, might: 2 },
    empoweredMight: 3,
    keywords: [],
    declared: program => {
      assert.match(program.judgeReason, /discard 1/);
      assert.match(program.judgeReason, /params\.cost/);
      assert.match(program.judgeReason, /ObjectSnapshot/);
    }
  },
  {
    name: "Serene Ascetic / Empowered grants Deflect 1 and Shield 3 to the host",
    canonicalCardId: IDS.serene,
    published: sereneAscetic,
    card: { name: "Serene Ascetic", energy: 3, power: null, might: 3 },
    empoweredMight: 3,
    keywords: [{ id: "deflect", value: 1 }, { id: "shield", value: 3 }],
    declared: program => {
      assert.match(program.judgeReason, /target\.tax/);
      assert.match(program.judgeReason, /Shield/);
      assert.match(program.judgeReason, /bindStatic/);
    }
  },
  {
    name: "Shadow Fiend / Empowered grants Assault 3 to the host",
    canonicalCardId: IDS.fiend,
    published: shadowFiend,
    card: { name: "Shadow Fiend", energy: 2, power: null, might: 2 },
    empoweredMight: 2,
    keywords: [{ id: "assault", value: 3 }],
    declared: program => {
      assert.match(program.judgeReason, /continuous\.grant-keyword/);
      assert.match(program.judgeReason, /807\.1\.c/);
      assert.match(program.judgeReason, /ObjectSnapshot/);
    }
  }
];

function empowerRow(row) {
  const program = shipped(row.published);
  const scenario = empowerBoard(program, row.card);
  return {
    name: row.name,
    canonicalCardId: row.canonicalCardId,
    published: row.published,
    program,
    scenario: {
      ...scenario,
      operations: [...scenario.operations, ...resolveSpell("empower")],
      expect: {
        objects: {
          source: { zone: "board", location: baseA, might: row.empoweredMight, empowered: 1, keywords: row.keywords, power: row.card.power, buffs: 0 },
          ally: { might: 2, keywords: [] },
          enemy: { might: 4, keywords: [] },
          "discard-option": { zone: "hand", power: null }
        },
        players: { A: { energy: 10 - row.card.energy - 1 } },
        events: empowerEvents
      }
    },
    declared: row.declared
  };
}

// The printed Spiderling bonus is zero here: the only other same-named units
// sit at another location / under the opponent, so "+1 for each other unit you
// control here with my name" must add nothing. The dynamic name self-reference
// and N-times count amount stay missing, so a same-name neighbour is NOT
// asserted as +1.
const spiderlingRow = {
  name: "Spiderling / paid battlefield entry with no friendly same-name unit here adds nothing",
  canonicalCardId: IDS.spiderling,
  published: spiderling,
  declared: program => {
    assert.match(program.judgeReason, /Hidden/);
    assert.match(program.judgeReason, /continuous\.might/);
    assert.match(program.judgeReason, /103\.3\.b/);
    assert.match(program.judgeReason, /N 倍/);
  }
};

function spiderlingScenario(program, objects, operations) {
  return { players: { A: { energy: 5 } }, objects, operations };
}

const spiderlingObjects = [
  { id: "source", cardId: IDS.spiderling, name: "Spiderling", types: ["unit"], zone: "hand", might: 1, energy: 3, power: null },
  { id: "far", cardId: IDS.spiderling, name: "Spiderling", owner: "A", types: ["unit"], zone: "board", location: baseA, might: 1 },
  { id: "enemy", name: "Spiderling", owner: "B", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-697-enemy" }, might: 1 }
];

const definitions = [
  ...empowerCards.map(empowerRow),
  (() => {
    const program = shipped(spiderlingRow.published);
    return {
      name: spiderlingRow.name,
      canonicalCardId: spiderlingRow.canonicalCardId,
      published: spiderlingRow.published,
      program,
      scenario: {
      ...spiderlingScenario(program, spiderlingObjects, [{ type: "play", object: "source", player: "A", location: battlefield }]),
      expect: {
        objects: {
          source: { zone: "board", location: battlefield, might: 1, power: null, buffs: 0 },
          far: { might: 1 },
          enemy: { zone: "board", might: 1 }
        },
        players: { A: { energy: 2 } },
        events: { includes: [{ timingPoint: "card-played" }, { timingPoint: "object-enters-battlefield" }] }
      }
      },
      declared: spiderlingRow.declared
    };
  })()
];

// Boundary group: condition not satisfied (no Empower), the negated branch
// (Disempower returns the dependent ability to inactive), the zero-count
// Spiderling edge, an unpayable base cost, and a no-legal-target control play.
const boundaries = [
  ...empowerCards.flatMap(row => [
    {
      name: `${row.card.name} / dependent ability inactive before any Empower`,
      canonicalCardId: row.canonicalCardId,
      published: row.published,
      scenario: {
        ...empowerBoard(shipped(row.published), row.card),
        expect: {
          objects: {
            source: { zone: "board", location: baseA, might: row.card.might, empowered: 0, keywords: [] },
            ally: { might: 2, keywords: [] },
            enemy: { might: 4, keywords: [] },
            "discard-option": { zone: "hand", power: null }
          },
          players: { A: { energy: 10 - row.card.energy } },
          events: { includes: [{ timingPoint: "card-played", object: { ref: { id: "source" } } }] }
        }
      }
    },
    {
      name: `${row.card.name} / Disempower returns the dependent ability to inactive`,
      canonicalCardId: row.canonicalCardId,
      published: row.published,
      scenario: (() => {
        const scenario = empowerBoard(shipped(row.published), row.card);
        return {
          ...scenario,
          operations: [...scenario.operations, ...resolveSpell("empower"), ...resolveSpell("disempower")],
          expect: {
            objects: {
              source: { zone: "board", location: baseA, might: row.card.might, empowered: 0, keywords: [] },
              ally: { might: 2 },
              enemy: { might: 4 }
            },
            players: { A: { energy: 10 - row.card.energy - 2 } },
            events: {
              sequence: [
                { timingPoint: "card-played", object: { ref: { id: "source" } } },
                { timingPoint: "empowered-changed", action: { type: "empower", object: "source" } },
                { timingPoint: "empowered-changed", action: { type: "disempower", object: "source" } }
              ]
            }
          }
        };
      })()
    },
    {
      name: `${row.card.name} / missing printed Empower cost still fails closed`,
      canonicalCardId: row.canonicalCardId,
      published: row.published,
      expectedFailure: /Unsupported cost kind empower/,
      scenario: {
        ...empowerBoard(shipped(row.published), row.card),
        operations: [
          { type: "play", object: "source", player: "A", location: baseA },
          { type: "activate", object: "source", player: "A" }
        ]
      }
    }
  ]),
  {
    name: "Spiderling / no other same-name unit anywhere keeps the printed +0",
    canonicalCardId: IDS.spiderling,
    published: spiderling,
    scenario: spiderlingScenario(shipped(spiderling), [
      { id: "source", cardId: IDS.spiderling, name: "Spiderling", types: ["unit"], zone: "hand", might: 1, energy: 3, power: null }
    ], [{ type: "play", object: "source", player: "A", location: battlefield }]),
    scenarioExpect: {
      objects: { source: { zone: "board", location: battlefield, might: 1, power: null } },
      players: { A: { energy: 2 } },
      events: { includes: [{ timingPoint: "card-played" }] }
    }
  },
  {
    name: "Escaped Grayback / negated boundary: insufficient Energy leaves the card in hand",
    canonicalCardId: IDS.grayback,
    published: escapedGrayback,
    expectedFailure: /insufficient Energy/,
    scenario: {
      players: { A: { energy: 2 } },
      objects: [
        { id: "source", cardId: IDS.grayback, name: "Escaped Grayback", types: ["unit"], zone: "hand", might: 3, energy: 3, power: null }
      ],
      operations: [{ type: "play", object: "source", player: "A", location: baseA }]
    }
  },
  {
    name: "Escaped Grayback / no-legal-target boundary: an enemy-only target set is rejected before resolution",
    canonicalCardId: IDS.grayback,
    published: escapedGrayback,
    expectedFailure: /required target count is not available/,
    scenario: {
      players: { A: { energy: 10 } },
      objects: [
        { id: "source", cardId: IDS.grayback, name: "Escaped Grayback", types: ["unit"], zone: "hand", might: 3, energy: 3, power: null },
        spell("enemy-target", enemyTargetSpell)
      ],
      operations: [
        { type: "play", object: "source", player: "A", location: baseA },
        { type: "play", object: "enemy-target", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" }
      ]
    }
  },
  {
    name: "Spiderling / [Hidden] expands to cost.hidden, not to a faked activated ability",
    canonicalCardId: IDS.spiderling,
    published: spiderling,
    expectedFailure: /No activated ability 0/,
    scenario: {
      players: { A: { energy: 5 } },
      objects: [
        { id: "source", cardId: IDS.spiderling, name: "Spiderling", types: ["unit"], zone: "hand", might: 1, energy: 3, power: null }
      ],
      operations: [
        { type: "play", object: "source", player: "A", location: battlefield },
        { type: "activate", object: "source", player: "A" }
      ]
    }
  }
];

function register(rows, templateName) {
  const cases = defineTemplateSuite(templateName, rows.map(row => ({
    name: row.name,
    canonicalCardId: row.canonicalCardId,
    program: row.program ?? shipped(row.published),
    scenario: row.scenarioExpect ? { ...row.scenario, expect: row.scenarioExpect } : row.scenario
  })));
  for (const [index, templateCase] of cases.entries()) {
    test(templateCase.name, () => {
      const row = rows[index];
      const declared = cardProgramsById.get(row.canonicalCardId);
      assert.ok(declared, `generated program ${row.canonicalCardId} is present`);
      assert.equal(declared.status, "judge-required");
      assert.ok(declared.judgeReason?.trim());
      row.declared?.(declared);
      if (row.expectedFailure) {
        assert.throws(templateCase.run, row.expectedFailure);
        return;
      }
      templateCase.run();
    });
  }
}

register(definitions, "RIFT-697 keyword+static");
register(boundaries, "RIFT-697 keyword+static boundary");

// [Hidden] evidence outside the scenario harness: the keyword really expands to
// the authored cost.hidden static ability, and the production static binder
// fails it closed with the named judge-required reason because the Hide action
// / facedown-zone consumer is still missing (811.1.b / 811.1.d). No card-local
// approximation of Hide is asserted here.
test(`RIFT-697 Spiderling [${IDS.spiderling}]: [Hidden] expands to cost.hidden and the production binder fails it closed`, () => {
  const published = cardProgramsById.get(IDS.spiderling);
  assert.equal(published.status, "judge-required");
  const program = shipped(spiderling);
  const host = { ref: { id: "spiderling", zoneEntryId: 1 }, cardId: IDS.spiderling, name: "Spiderling", types: ["unit"], tags: [], keywords: [], owner: "A", controller: "A", zone: "board", location: null, might: 1, energy: 3, power: null, exhausted: false, damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false };
  const binding = createProgramBinding({ cardPrograms: [program] });
  const expanded = binding.inspect(host).abilities;
  const hidden = expanded.filter(ability => ability.kind === "static" && ability.effect.kind === "cost.hidden");
  assert.deepEqual(hidden.map(ability => ability.effect), [{ kind: "cost.hidden" }]);
  const binder = createEngineStaticBinder(fixture({ cards: [] }).engine);
  assert.throws(() => bindStaticAbility(binder, hidden[0], host), /has no layer mapping/);
});
