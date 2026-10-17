import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import sivir from "../../../dist/cards/sfd/sivir-mercenary.js";
import arachnoid from "../../../dist/cards/unl/arachnoid-horror.js";
import gustwalker from "../../../dist/cards/unl/gustwalker.js";
import masterYi from "../../../dist/cards/unl/master-yi-tempered.js";
import mosstomper from "../../../dist/cards/unl/mosstomper.js";
import researchers from "../../../dist/cards/ven/applied-researchers.js";
import baccai from "../../../dist/cards/ven/baccai-sandspinner.js";
import frostcoat from "../../../dist/cards/ven/frostcoat-mother.js";
import rockbear from "../../../dist/cards/ven/grumpy-rockbear.js";
import lifeblade from "../../../dist/cards/ven/kinkou-lifeblade.js";
import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const battlefield = { type: "battlefield", id: "battlefield-649" };
const unit = (card, might, energy, power) => ({
  id: "source", cardId: card.canonicalCardId, types: ["unit"], zone: "board",
  location: battlefield, might, energy, power,
});

// One independent, unmodified full-program row per card. These are TODOs, not
// execution evidence: runCardScenario deliberately rejects judge-required cards.
// Keep the real program/status here so a missing cost/keyword is never made free
// or unconditionally active just to get a full-card golden to pass.
const fullRows = [
  { name: "Sivir, Mercenary", canonicalCardId: "card.hash-bd07122c30b6cd8a4c4c84c4bcce0070fad8ea471344189ee61fb766cb54e888", program: sivir,
    scenario: { objects: [unit(sivir, 4, 4, ["Chaos"])], expect: { objects: { source: { might: 4, buffs: 0, keywords: [] } } } } },
  { name: "Arachnoid Horror", canonicalCardId: "card.hash-158f0c8fe09a511b90b88574669f5f31fbfc1742ef2b6dea8f7b903e7a448423", program: arachnoid,
    scenario: { objects: [unit(arachnoid, 6, 6, ["Body"])], operations: [{ type: "trigger", timingPoint: "conquer", object: "source", player: "A" }, { type: "pass", player: "A" }, { type: "pass", player: "B" }],
      expect: { players: { A: { xp: 2 } }, objects: { source: { might: 6 } }, events: { includes: [{ timingPoint: "conquer" }] } } } },
  { name: "Gustwalker", canonicalCardId: "card.hash-a232dcd643d13b743c5bad3125bacbefc6b2ef53b24aa91708ec80fc13447153", program: gustwalker,
    scenario: { players: { A: { xp: 3 } }, objects: [unit(gustwalker, 3, 3, ["Mind"])], expect: { objects: { source: { might: 4, keywords: [{ id: "Ganking" }] } } } } },
  { name: "Master Yi, Tempered", canonicalCardId: "card.hash-c32a0493f88b4c947cb3f7806d8ba125b166dd6478a848bb39f1da87aed3ae92", program: masterYi,
    scenario: { players: { A: { xp: 6 } }, objects: [unit(masterYi, 4, 4, ["Body"])], expect: { objects: { source: { might: 4, keywords: [{ id: "Deflect", value: 1 }, { id: "Ganking" }] } } } } },
  { name: "Mosstomper", canonicalCardId: "card.hash-3237f73ddd77661179f659d36e72559c7bdf667aadbeeb1a45d74e35b239ea35", program: mosstomper,
    scenario: { players: { A: { xp: 3 } }, objects: [unit(mosstomper, 3, 3, ["Calm"])], expect: { objects: { source: { might: 4, keywords: [{ id: "deflect", value: 1 }] } } } } },
  { name: "Applied Researchers", canonicalCardId: "card.hash-ffb7fa0eb6027d1158053512ab5917c1ff4226d11f9110deeade65133c7312b4", program: researchers,
    scenario: { objects: [unit(researchers, 4, 4, null)], expect: { objects: { source: { might: 4, power: null } } } } },
  { name: "Baccai Sandspinner", canonicalCardId: "card.hash-43ef38def4a837781a4013a179db99f1eb1e312f85de8d9c3053f7168a1652f5", program: baccai,
    scenario: { objects: [unit(baccai, 6, 6, null)], expect: { objects: { source: { might: 6, power: null, keywords: [] } } } } },
  { name: "Frostcoat Mother", canonicalCardId: "card.hash-af86d71346754f5a19f63ebf193cb978f3d3dffe541f342d86bd89ab951eefb8", program: frostcoat,
    scenario: { objects: [unit(frostcoat, 3, 3, null)], expect: { objects: { source: { might: 3, power: null, buffs: 0 } } } } },
  { name: "Grumpy Rockbear", canonicalCardId: "card.hash-1318a3352539e807f9e1630c856d2c196aa0c08582d7d3c992b230a01f6fe243", program: rockbear,
    scenario: { objects: [unit(rockbear, 4, 4, null)], expect: { objects: { source: { might: 4, power: null, keywords: [] } } } } },
  { name: "Kinkou Lifeblade", canonicalCardId: "card.hash-d74e1963dafb67a09e7521faddbcaaae4df80b1f2ea284a6639fdc31e3e82f35", program: lifeblade,
    scenario: { objects: [unit(lifeblade, 4, 4, null)], expect: { objects: { source: { might: 4, power: null, keywords: [] } } } } },
];

for (const row of defineTemplateSuite("RIFT-649 full card (blocked)", fullRows)) {
  const program = fullRows.find(entry => entry.canonicalCardId === row.canonicalCardId).program;
  assert.equal(program.status, "judge-required");
  assert.ok(program.judgeReason);
  test.todo(`${row.name}: ${program.judgeReason}`);
}

// The existing harness has no partial-program entry point. Isolate only original
// static abilities that it can bind, retaining every original condition and
// effect object by identity. This test-only subprogram does NOT certify the full
// CardProgram (keyword, costs, movement and taxes remain in the TODO rows above).
function staticSubset(card, indexes) {
  const abilities = indexes.map(index => card.abilities[index]);
  assert.ok(abilities.every(ability => ability.kind === "static"));
  const program = {
    canonicalCardId: card.canonicalCardId,
    rulesetVersion: card.rulesetVersion,
    sourceText: card.sourceText,
    status: "executable",
    abilities,
  };
  assert.deepEqual(validateCardProgram(program).issues, []);
  return program;
}

const subsets = {
  sivir: staticSubset(sivir, [1, 2]),
  gustwalker: staticSubset(gustwalker, [1, 2]),
  masterYi: staticSubset(masterYi, [1, 2]),
  mosstomper: staticSubset(mosstomper, [1, 2]),
  baccai: staticSubset(baccai, [2]),
  frostcoat: staticSubset(frostcoat, [2]),
  rockbear: staticSubset(rockbear, [2]),
  lifeblade: staticSubset(lifeblade, [1, 2]),
};

// Synthetic effect sources drive real GameActions through Play -> ChainEngine
// -> interpreter -> EventPipeline. They are neither the card's missing Empower
// activation nor a callback that edits the source's state. The target is locked
// by the chain; explicit zero is this test spell's cost, never a missing printed cost.
function stateDriver(mode) {
  return {
    canonicalCardId: `test.rift-649.${mode}`,
    rulesetVersion: "core-1.5",
    status: "executable",
    sourceText: `Test control: ${mode} a unit.`,
    abilities: [{ kind: "play", cost: { kind: "explicit", energy: { kind: "constant", value: 0 } }, body: [{
      id: `driver.${mode}`, op: "effect.empower",
      args: { objects: { kind: "constant", value: { kind: "target", id: "controlled-unit" } }, ...(mode === "disempower" ? { mode: { kind: "constant", value: mode } } : {}) },
      targets: [{ id: "controlled-unit", filter: { type: "unit", zone: "board" }, min: 1, max: 1 }],
    }] }],
  };
}
const empowerDriver = stateDriver("empower");
const disempowerDriver = stateDriver("disempower");
const playDriver = id => [{ type: "play", object: id, player: "A" }, { type: "pass", player: "A" }, { type: "pass", player: "B" }];
const driverObject = (id, program) => ({ id, program, types: ["spell"], zone: "hand", energy: 0, power: [] });

function empoweredScenario(card, might, energy, mode) {
  return {
    objects: [unit(card, might, energy, null), driverObject("empower", empowerDriver), driverObject("disempower", disempowerDriver)],
    answers: { "target:controlled-unit": ["source"] },
    operations: mode === "off" ? [] : [...playDriver("empower"), ...(mode === "revoked" ? playDriver("disempower") : [])],
  };
}

const partialRows = [
  { name: "Sivir, Mercenary / no Power spent / static subset", canonicalCardId: sivir.canonicalCardId, program: subsets.sivir,
    scenario: { objects: [unit(sivir, 4, 4, ["Chaos"])], expect: { objects: { source: { might: 4, buffs: 0, keywords: [] } }, events: { exact: [] } } } },
  ...["off", "on", "revoked"].flatMap(mode => {
    const active = mode === "on";
    return [
      { name: `Baccai Sandspinner / ${mode} / grant subset`, canonicalCardId: baccai.canonicalCardId, program: subsets.baccai,
        scenario: empoweredScenario(baccai, 6, 6, mode), expect: { objects: { source: { might: 6, empowered: active ? 1 : 0, power: null, keywords: active ? [{ id: "deflect", value: 1 }, { id: "assault", value: 2 }] : [] } } } },
      { name: `Frostcoat Mother / ${mode} / +3 Might subset`, canonicalCardId: frostcoat.canonicalCardId, program: subsets.frostcoat,
        scenario: empoweredScenario(frostcoat, 3, 3, mode), expect: { objects: { source: { might: active ? 6 : 3, empowered: active ? 1 : 0, power: null, buffs: 0 } } } },
      { name: `Grumpy Rockbear / ${mode} / grant subset`, canonicalCardId: rockbear.canonicalCardId, program: subsets.rockbear,
        scenario: empoweredScenario(rockbear, 4, 4, mode), expect: { objects: { source: { might: 4, empowered: active ? 1 : 0, power: null, keywords: active ? [{ id: "deflect", value: 1 }, { id: "shield", value: 3 }] : [] } } } },
      { name: `Kinkou Lifeblade / ${mode} / Might + Ganking subset`, canonicalCardId: lifeblade.canonicalCardId, program: subsets.lifeblade,
        scenario: empoweredScenario(lifeblade, 4, 4, mode), expect: { objects: { source: { might: active ? 5 : 4, empowered: active ? 1 : 0, power: null, buffs: 0, keywords: active ? [{ id: "Ganking" }] : [] } } } },
    ].map(row => ({ ...row, expect: { ...row.expect, events: mode === "off" ? { exact: [] } : { includes: [{ action: { type: "empower", object: "source" } }, ...(mode === "revoked" ? [{ action: { type: "disempower", object: "source" } }] : [])] } } }));
  }),
  // CR 824.1.c/d cannot be executed yet. These are regression tests for the
  // explicit blocked branch, including enough objects to reproduce the previous
  // erroneous count >= threshold at 0 XP. High XP must not bypass that block.
  ...[0, 2, 3, 5, 6, 10].flatMap(xp => [
    { name: `Gustwalker / XP ${xp} / Level query blocked`, canonicalCardId: gustwalker.canonicalCardId, program: subsets.gustwalker,
      scenario: { players: { A: { xp } }, objects: [unit(gustwalker, 3, 3, ["Mind"]), ...Array.from({ length: 8 }, (_, i) => ({ id: `extra-${i}`, owner: "B", types: ["unit"], zone: "board", might: 1 }))],
        expect: { players: { A: { xp } }, objects: { source: { might: 3, keywords: [] } } } } },
    { name: `Master Yi, Tempered / XP ${xp} / Level query blocked`, canonicalCardId: masterYi.canonicalCardId, program: subsets.masterYi,
      scenario: { players: { A: { xp } }, objects: [unit(masterYi, 4, 4, ["Body"]), ...Array.from({ length: 8 }, (_, i) => ({ id: `extra-${i}`, owner: "B", types: ["unit"], zone: "board", might: 1 }))],
        expect: { players: { A: { xp } }, objects: { source: { might: 4, keywords: [] } } } } },
    { name: `Mosstomper / XP ${xp} / Level query blocked`, canonicalCardId: mosstomper.canonicalCardId, program: subsets.mosstomper,
      scenario: { players: { A: { xp } }, objects: [unit(mosstomper, 3, 3, ["Calm"]), ...Array.from({ length: 8 }, (_, i) => ({ id: `extra-${i}`, owner: "B", types: ["unit"], zone: "board", might: 1 }))],
        expect: { players: { A: { xp } }, objects: { source: { might: 3, keywords: [] } } } } },
  ]),
];

for (const row of defineTemplateSuite("RIFT-649 original static subset", partialRows)) test(row.name, row.run);

// The discount consumer is missing, but the authored numeric expression is
// has an additional missing relative-player query adapter. Keep the expected
// negative delta and nonzero cases as TODO regressions; never substitute a
// player ID in the card expression merely to manufacture execution evidence.
for (const card of [frostcoat, rockbear]) {
  for (const runes of [0, 1, 4, 12, 13]) {
    test(`RIFT-649 ${card === frostcoat ? "Frostcoat Mother" : "Grumpy Rockbear"} [${card.canonicalCardId}] / ${runes} runes / negative cost expression`, { todo: runes > 0 && "count.filter.controller:self needs a relative-player query adapter; unchanged card expression currently counts 0" }, () => {
      const builder = world().unit("source", { owner: "A", zone: "board" });
      for (let i = 0; i < runes; i++) builder.rune(`rune-${i}`, { owner: "A", zone: "rune-zone" });
      builder.rune("enemy-rune", { owner: "B", zone: "rune-zone" });
      builder.rune("hand-rune", { owner: "A", zone: "hand" });
      const kernel = builder.build();
      const context = kernel.clone({ sourceSnapshot: kernel.getObject("source"), controller: "A" });
      const outcome = runAbilityBody([{ id: "cost-delta", op: "condition.value", args: { value: card.abilities[1].effect.amount } }], context);
      assert.equal(outcome.status, "executed");
      assert.equal(outcome.results[0].result.linkedValues.value, -runes);
    });
  }
}
