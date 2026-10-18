// RIFT-672: keyword + static, with one independent parameter row per card.
// Published programs stay judge-required. The harness requires executable, so
// probes change only that status: every original ability, gate and cost sentinel
// is preserved. These are supported-path tests, never full-card certification.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite, runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import escapedGrayback from "../../../dist/cards/ven/escaped-grayback.js";
import legionMarauder from "../../../dist/cards/ven/legion-marauder.js";
import punchingPoro from "../../../dist/cards/ven/punching-poro.js";
import sereneAscetic from "../../../dist/cards/ven/serene-ascetic.js";
import shadowFiend from "../../../dist/cards/ven/shadow-fiend.js";
import spiderling from "../../../dist/cards/ven/spiderling.js";

const base = { type: "base", player: "A" };
const battlefield = { type: "battlefield", id: "bf-672" };

function probe(program) {
  assert.equal(program.status, "judge-required");
  assert.ok(program.judgeReason?.trim());
  return { ...program, status: "executable", judgeReason: undefined };
}

// A synthetic test spell changes status through a paid play, locked target,
// interpreter and EventPipeline. It does not implement any card's missing
// Empower activation or mutate the world through a fixture callback.
function stateSpell(mode) {
  return {
    canonicalCardId: `test.rift-672.${mode}`,
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
const empowerSpell = stateSpell("empower");
const disempowerSpell = stateSpell("disempower");
const spell = (id, program) => ({ id, program, types: ["spell"], zone: "hand", energy: 1, power: [] });
const resolveSpell = object => [
  { type: "play", object, player: "A" },
  { type: "pass", player: "A" },
  { type: "pass", player: "B" }
];

function empoweredScenario(program, name, might, energy) {
  return {
    players: { A: { energy: 10 } },
    objects: [
      { id: "source", cardId: program.canonicalCardId, name, types: ["unit"], zone: "hand", might, energy, power: null },
      { id: "ally", types: ["unit"], zone: "board", location: base, might: 2 },
      { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: base, might: 4 },
      { id: "discard-option", types: ["unit"], zone: "hand", energy: 2, power: null },
      spell("empower", empowerSpell),
      spell("disempower", disempowerSpell)
    ],
    answers: { "target:controlled-unit": ["source"] },
    operations: [{ type: "play", object: "source", player: "A", location: base }, ...resolveSpell("empower")]
  };
}

const empowerEvents = {
  sequence: [
    { timingPoint: "card-played", object: { ref: { id: "source" } } },
    { action: { type: "empower", object: "source" } }
  ]
};

const rows = [
  {
    name: "Escaped Grayback / Empowered grants +2 Might to self",
    canonicalCardId: "card.hash-873c8f0234994082b765c3eb70f58d38ed667f83edf9a43739a2a1f28910a0f5",
    declared: escapedGrayback, program: probe(escapedGrayback),
    scenario: empoweredScenario(escapedGrayback, "Escaped Grayback", 3, 3),
    expect: { objects: { source: { zone: "board", might: 5, empowered: 1, buffs: 0, power: null, keywords: [] }, ally: { zone: "board", might: 2 }, enemy: { might: 4 } }, players: { A: { energy: 6 } }, events: empowerEvents },
    inactive: { might: 3, keywords: [] }
  },
  {
    name: "Legion Marauder / Empowered grants +1 Might to self",
    canonicalCardId: "card.hash-211eca36faf7df8cbf91263292d612607b7b7e515ee1ee6aaeb0003817aff8f8",
    declared: legionMarauder, program: probe(legionMarauder),
    scenario: empoweredScenario(legionMarauder, "Legion Marauder", 2, 2),
    expect: { objects: { source: { zone: "board", might: 3, empowered: 1, buffs: 0, power: null, keywords: [] }, ally: { might: 2 }, enemy: { might: 4 } }, players: { A: { energy: 7 } }, events: empowerEvents },
    inactive: { might: 2, keywords: [] }
  },
  {
    name: "Punching Poro / Empowered grants +1 without discarding a card",
    canonicalCardId: "card.hash-4e84bd06baa7f0981211f77e8859b781d223544ea2429070561399db373e5c6f",
    declared: punchingPoro, program: probe(punchingPoro),
    scenario: empoweredScenario(punchingPoro, "Punching Poro", 2, 2),
    expect: { objects: { source: { zone: "board", might: 3, empowered: 1, buffs: 0, power: null }, "discard-option": { zone: "hand", power: null }, ally: { might: 2 }, enemy: { might: 4 } }, players: { A: { energy: 7 } }, events: empowerEvents },
    inactive: { might: 2, keywords: [] }
  },
  {
    name: "Serene Ascetic / Empowered grants Deflect 1 and Shield 3",
    canonicalCardId: "card.hash-e5195b063794caf45ca0ef55353be70e2a69d150511f33bccf7dfe8ae729254b",
    declared: sereneAscetic, program: probe(sereneAscetic),
    scenario: empoweredScenario(sereneAscetic, "Serene Ascetic", 3, 3),
    expect: { objects: { source: { zone: "board", might: 3, empowered: 1, power: null, keywords: [{ id: "deflect", value: 1 }, { id: "shield", value: 3 }] }, ally: { might: 2, keywords: [] }, enemy: { might: 4, keywords: [] } }, players: { A: { energy: 6 } }, events: empowerEvents },
    inactive: { might: 3, keywords: [] }
  },
  {
    name: "Shadow Fiend / Empowered grants Assault 3",
    canonicalCardId: "card.hash-b0dae42b029e826ed425d0108e52126d253bfbcb0232487d1515afeae22ef257",
    declared: shadowFiend, program: probe(shadowFiend),
    scenario: empoweredScenario(shadowFiend, "Shadow Fiend", 2, 2),
    expect: { objects: { source: { zone: "board", might: 2, empowered: 1, power: null, keywords: [{ id: "assault", value: 3 }] }, ally: { might: 2, keywords: [] }, enemy: { might: 4, keywords: [] } }, players: { A: { energy: 7 } }, events: empowerEvents },
    inactive: { might: 2, keywords: [] }
  },
  {
    name: "Spiderling / normal paid play with no other friendly unit here",
    canonicalCardId: "card.hash-1400b3c0af1e862d41c3291804cf107f4abf2a01f86c47c825fafff617f972a7",
    declared: spiderling, program: probe(spiderling),
    scenario: {
      players: { A: { energy: 5 } },
      objects: [
        { id: "source", cardId: spiderling.canonicalCardId, name: "Spiderling", types: ["unit"], zone: "hand", might: 1, energy: 3, power: null },
        { id: "far", cardId: spiderling.canonicalCardId, name: "Spiderling", owner: "A", types: ["unit"], zone: "board", location: base, might: 1 },
        { id: "enemy", name: "Spiderling", owner: "B", types: ["unit"], zone: "board", location: battlefield, might: 1 }
      ],
      operations: [{ type: "play", object: "source", player: "A", location: battlefield }]
    },
    expect: { objects: { source: { zone: "board", location: battlefield, might: 1, power: null, buffs: 0 }, far: { might: 1 }, enemy: { might: 1 } }, players: { A: { energy: 2 } }, events: { includes: [{ timingPoint: "card-played" }, { timingPoint: "object-enters-battlefield" }] } },
    bindingError: /Static ability kind cost\.hidden has no layer mapping/
  }
];

for (const row of defineTemplateSuite("RIFT-672 keyword+static supported paths", rows)) {
  test(row.name, () => {
    const source = rows.find(candidate => candidate.canonicalCardId === row.canonicalCardId);
    if (source.bindingError) {
      assert.throws(row.run, source.bindingError);
      return;
    }
    row.run();
  });
}

for (const row of rows) {
  test(`RIFT-672 published status guard: ${row.name} [${row.canonicalCardId}]`, () => {
    assert.throws(() => runCardScenario(row.declared, row.scenario), /is judge-required/);
  });
}

for (const row of rows.filter(row => row.inactive)) {
  const { scenario, expect, ...identity } = row;
  const played = scenario.operations.slice(0, 1);
  for (const mode of ["unempowered", "disempowered"]) {
    const revoked = mode === "disempowered";
    const boundary = {
      ...identity,
      name: `${row.name} / ${mode}: the dependent ability is inactive`,
      scenario: { ...scenario, operations: revoked ? [...scenario.operations, ...resolveSpell("disempower")] : played },
      expect: {
        objects: { ...expect.objects, source: { ...expect.objects.source, ...row.inactive, empowered: 0 } },
        players: { A: { energy: expect.players.A.energy + (revoked ? -1 : 1) } },
        events: revoked ? { includes: [{ action: { type: "empower", object: "source" } }, { action: { type: "disempower", object: "source" } }] } : { includes: [{ timingPoint: "card-played" }] }
      }
    };
    for (const item of defineTemplateSuite("RIFT-672 conditional boundary", [boundary])) test(item.name, item.run);
  }
  test(`RIFT-672 missing printed Empower cost fails closed: ${row.name} [${row.canonicalCardId}]`, () => {
    assert.throws(() => runCardScenario(row.program, {
      ...scenario,
      operations: [...played, { type: "activate", object: "source", player: "A" }]
    }), /[Uu]nsupported.*empower|empower.*[Uu]nsupported/);
  });
}

// Expected rules behaviour stays pending: do not assert zero as success when
// same-name neighbours ought to contribute +N (dynamic name and count missing).
for (const count of [1, 2]) {
  const row = rows.at(-1);
  for (const item of defineTemplateSuite("RIFT-672 blocked Spiderling count", [{
    ...row,
    name: `Spiderling / ${count} same-name neighbours give +${count}`,
    scenario: {
      ...row.scenario,
      objects: [...row.scenario.objects, ...Array.from({ length: count }, (_, index) => ({
        id: `neighbour-${index}`, name: "Spiderling", types: ["unit"], zone: "board", location: battlefield, might: 1
      }))]
    },
    expect: { ...row.expect, objects: { ...row.expect.objects, source: { ...row.expect.objects.source, might: 1 + count } } }
  }])) test(item.name, { todo: "RIFT-672: dynamic self.name filter and continuous count amount consumers are missing" }, item.run);
}
