// RIFT-663 / README 4.1: every card has its own scenario and assertions.
// Breakneck Mech is executable after its production recheck. The other cards
// remain judge-required; their candidates change validation metadata only, so
// every ability, condition, target and sourceText stays intact.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import breakneckMech from "../../../dist/cards/sfd/breakneck-mech.js";
import crescentGuardian from "../../../dist/cards/unl/crescent-guardian.js";
import monch from "../../../dist/cards/unl/monch.js";
import wujuMaster from "../../../dist/cards/unl/wuju-master.js";
import cloudDrake from "../../../dist/cards/ven/cloud-drake.js";

function candidate(program) {
  if (program.canonicalCardId === breakneckMech.canonicalCardId) {
    assert.equal(program.status, "executable");
    assert.equal(program.judgeReason, undefined);
    return program;
  }
  assert.equal(program.status, "judge-required");
  const { judgeReason, ...data } = program;
  assert.ok(judgeReason);
  return { ...data, status: "executable" };
}

const rows = [
  {
    name: "Breakneck Mech: supported entry and Mech keyword grant scope (CR 133.3.a/369.3)",
    canonicalCardId: "card.hash-cb2ea7576d42c76d8ecf8fa3cdb082f007639b144aecc69402230df6bcc131ab",
    program: breakneckMech,
    scenario: {
      players: { A: { energy: 8, power: ["Mind", "Mind"] } },
      objects: [
        { id: "mech", cardId: breakneckMech.canonicalCardId, types: ["unit"], tags: ["Mech", "Yordle", "Bandle City"], zone: "hand", energy: 8, power: ["Mind", "Mind"], might: 7 },
        { id: "ally-mech", types: ["unit"], tags: ["Mech"], zone: "board", might: 3 },
        // 133.8: tags can occur on multiple card types; “Mechs” adds no unit restriction.
        { id: "mech-gear", types: ["gear"], tags: ["Mech"], zone: "board", energy: 2 },
        { id: "ally-other", types: ["unit"], zone: "board", might: 2 },
        { id: "enemy-mech", owner: "B", types: ["unit"], tags: ["Mech"], zone: "board", might: 4 },
        { id: "hand-mech", types: ["unit"], tags: ["Mech"], zone: "hand", might: 3 },
      ],
      operations: [{ type: "play", object: "mech", player: "A" }],
      expect: {
        objects: {
          mech: { zone: "board", location: { type: "base", player: "A" }, might: 7, exhausted: false, keywords: [{ id: "Deflect" }, { id: "Ganking" }] },
          "ally-mech": { might: 3, keywords: [{ id: "Deflect" }, { id: "Ganking" }] },
          "mech-gear": { keywords: [{ id: "Deflect" }, { id: "Ganking" }] },
          "ally-other": { keywords: [] },
          "enemy-mech": { keywords: [] },
          "hand-mech": { zone: "hand", keywords: [] },
        },
        events: { sequence: [{ timingPoint: "object-enters-chain", object: { ref: "mech" } }, { timingPoint: "object-enters-board", object: { ref: "mech" } }, { timingPoint: "card-played", object: { ref: "mech" } }] },
      },
    },
  },
  {
    name: "Crescent Guardian: no spell played and no additional-cost decision must enter exhausted",
    canonicalCardId: "card.hash-62fb90bb0e876e500de763bb4ffad29e29022a5cbd31d536a7adf6619570bca6",
    program: crescentGuardian,
    blocked: "RIFT-260 follow-up: entry matcher skips the payment condition; static spell history and optional cost have no consumer",
    scenario: {
      players: { A: { energy: 4, power: ["Chaos"] } },
      objects: [{ id: "guardian", cardId: crescentGuardian.canonicalCardId, types: ["unit"], tags: ["Mount Targon"], zone: "hand", energy: 4, power: null, might: 4 }],
      operations: [{ type: "play", object: "guardian", player: "A" }],
      expect: {
        objects: { guardian: { zone: "board", energy: 4, power: null, might: 4, exhausted: true } },
        players: { A: { energy: 0, power: ["Chaos"] } },
        events: { includes: [{ timingPoint: "object-enters-board", object: { ref: "guardian" } }] },
      },
    },
  },
  {
    name: "Monch: supported ready entry with an opponent-controlled stunned unit (discount still blocked)",
    canonicalCardId: "card.hash-f6fc6f5dbe6ceebe1e128bfe16a67f81a7cc149370db212b7fbda2bbd71599e4",
    program: monch,
    scenario: {
      players: { A: { energy: 6 } },
      objects: [
        { id: "monch", cardId: monch.canonicalCardId, types: ["unit"], tags: ["Bandle City"], zone: "hand", energy: 6, power: null, might: 6 },
        { id: "stunned-enemy", owner: "B", types: ["unit"], zone: "board", might: 3, stunned: true },
      ],
      operations: [{ type: "play", object: "monch", player: "A" }],
      expect: {
        objects: { monch: { zone: "board", energy: 6, power: null, might: 6, exhausted: false }, "stunned-enemy": { controller: "B", stunned: true, might: 3 } },
        events: { sequence: [{ timingPoint: "object-enters-chain", object: { ref: "monch" } }, { timingPoint: "object-enters-board", object: { ref: "monch" } }, { timingPoint: "card-played", object: { ref: "monch" } }] },
      },
    },
  },
  {
    name: "Wuju Master: unavailable XP cannot activate Level from a large object count",
    canonicalCardId: "card.hash-8b7f21bf0986b17b411aeaaeffd500931ea02096c94389c90265a214f7707ab4",
    program: wujuMaster,
    scenario: {
      players: { A: { xp: 5 } },
      objects: [
        { id: "master", cardId: wujuMaster.canonicalCardId, types: ["legend"], tags: ["Master Yi"], zone: "board", energy: null, power: null, might: null },
        { id: "ally", types: ["unit"], zone: "board", might: 3 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", might: 4 },
        ...["one", "two", "three", "four", "five", "six"].map(id => ({ id, types: ["unit"], zone: "board", might: 2 })),
      ],
      expect: {
        objects: { master: { energy: null, power: null }, ally: { might: 3 }, enemy: { might: 4 }, one: { might: 2 }, six: { might: 2 } },
        players: { A: { xp: 5 } },
        events: { exact: [] },
      },
    },
  },
];

const scenarioBindingErrors = new Map([
  [monch.canonicalCardId, /Unsupported static appliesTo "self-play-cost"/],
  [wujuMaster.canonicalCardId, /Unsupported entry body target value: \{\"linked\":\"replacement\.object\"\}/],
]);

function register(rows, template) {
  const cases = defineTemplateSuite(template, rows.map(row => ({ ...row, program: candidate(row.program) })));
  for (const [index, entry] of cases.entries()) {
    const row = rows[index];
    const bindingGap = scenarioBindingErrors.get(row.canonicalCardId);
    const gap = row.blocked
      ?? (bindingGap && `${bindingGap.toString().replace(/^\/(.*)\/$/, "$1")}; missing the corresponding replacement/static consumer`);
    if (gap !== undefined) {
      test.todo(`${entry.name} — ${gap}`);
      continue;
    }
    test(entry.name, () => {
      const bindingError = scenarioBindingErrors.get(row.canonicalCardId);
      if (bindingError) {
        assert.throws(entry.run, error => {
          assert.match(error.message, bindingError);
          return true;
        });
        return;
      }
      const result = entry.run();
      assert.deepEqual(result.state.chain, []);
      // 369.3/805.6.a: changing entry orientation emits no “becomes ready” event.
      assert.equal(result.events.some(event => event.timingPoint === "object-readied"), false);
    });
  }
}

register(rows, "static+replacement||effect.ready / supported portions and blocked card");

// Programs that remain judge-required must stay unavailable through the public
// harness. Breakneck Mech is executable and is covered by the scenario above.
for (const row of rows.filter(row => row.program.status === "judge-required")) {
  const [entry] = defineTemplateSuite("RIFT-663 production status guard", [row]);
  test(entry.name, () => assert.throws(entry.run, /is judge-required$/));
}

const [mechRow, , monchRow, masterRow] = rows;
register([
  {
    ...mechRow,
    name: "Breakneck Mech boundary: only enemy and hand Mechs do not satisfy another Mech",
    scenario: {
      ...mechRow.scenario,
      objects: mechRow.scenario.objects.filter(object => ["mech", "enemy-mech", "hand-mech"].includes(object.id)),
      expect: { objects: { mech: { zone: "board", exhausted: true }, "enemy-mech": { keywords: [] }, "hand-mech": { zone: "hand", keywords: [] } } },
    },
  },
  {
    ...monchRow,
    name: "Monch boundary: own stunned unit and an unstunned enemy give neither ready entry nor discount",
    blocked: "RIFT-260 follow-up: entry replacement must evaluate opponent-controlled stunned-unit condition",
    scenario: {
      ...monchRow.scenario,
      objects: [monchRow.scenario.objects[0], { id: "own-stunned", types: ["unit"], zone: "board", might: 3, stunned: true }, { id: "ready-enemy", owner: "B", types: ["unit"], zone: "board", might: 3, stunned: false }],
      expect: { objects: { monch: { zone: "board", exhausted: true, power: null } }, players: { A: { energy: 0 } } },
    },
  },
  {
    ...monchRow,
    name: "Monch discount: opponent stunned unit reduces the actual payment from 6 to 4 energy",
    blocked: "Finalize has no consumer for static continuous.cost-modification (CR 356.4)",
    scenario: { ...monchRow.scenario, expect: { objects: { monch: { zone: "board", exhausted: false, power: null } }, players: { A: { energy: 2 } } } },
  },
  {
    ...masterRow,
    name: "Wuju Master at 6 XP: +1 Might applies only to friendly units",
    blocked: "RIFT-268 follow-up: live controller XP result and dependent-ability binding are absent",
    scenario: {
      players: { A: { xp: 6 } },
      objects: masterRow.scenario.objects.slice(0, 3),
      expect: { objects: { ally: { might: 4 }, enemy: { might: 4 } } },
    },
  },
  {
    ...masterRow,
    name: "Wuju Master at 11 XP: a friendly entering unit gets +1 Might and enters ready",
    blocked: "RIFT-268/RIFT-260 follow-ups: live XP and per-object entry orientation remain unavailable",
    scenario: {
      players: { A: { xp: 11, energy: 6 } },
      objects: [
        masterRow.scenario.objects[0],
        { id: "ally", program: cloudDrake, types: ["unit"], tags: ["Dragon", "Demacia"], zone: "hand", energy: 6, power: null, might: 5 },
        { id: "top", types: ["unit"], zone: "deck" },
      ],
      operations: [{ type: "play", object: "ally", player: "A" }, { type: "pass", player: "A" }, { type: "pass", player: "B" }],
      expect: { objects: { ally: { zone: "board", might: 6, exhausted: false, power: null }, top: { zone: "hand" } }, players: { A: { xp: 11, energy: 0 } } },
    },
  },
], "static+replacement||effect.ready / blocked boundaries");
