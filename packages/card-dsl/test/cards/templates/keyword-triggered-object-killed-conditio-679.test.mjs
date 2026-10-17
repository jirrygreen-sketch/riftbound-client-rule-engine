// RIFT-679 template-level execution evidence (README 4.1).
//
// The four source programs share the IR signature
//   keyword + triggered|object-killed|condition.value + effect.token
// Hunting Dog, Carrion Dredger, Honest Broker and Noxian Emissary all stay
// judge-required because the printed effect cannot complete on merged code:
// effect.token's frozen definition table has no Bird (CR 187.7) or Gold
// (CR 187.5) entry, effect.token rejects the "exhausted" entry stipulation,
// and programs/play.ts needs a real program for the cardId:null native token.
//
// Each row below keeps the card's canonical identity, sourceText and authored
// death-trigger body, and drives it through the generic scenario harness
// (./packages/engine-core/src/effects/testing/scenario). Only the status
// metadata changes so the harness accepts the transient copy, and only two
// things are left out: the Deathknell keyword declaration (its expansion would
// add an unregistered trigger.leave body) and, for Noxian Emissary, the
// Empowered trigger gate - the harness's `testTrigger` port evaluates against
// its construction-time source snapshot, so a post-registration state flip is
// not observable through it. The gate itself is evaluated by the canonical
// event-aware evaluator and asserted in test/cards/ven/noxian-emissary.test.mjs.
// Nothing is re-implemented and no token id is substituted. The death timing
// is a real pipeline emission through the harness's declared
// `trigger` operation; a real `kill` action still cannot fire a program-bound
// death trigger because src/programs/lifecycle.ts hangs its detach on the
// `object-leaves-board` / `object-killed` emission and unregisters right after
// the pipeline scans `object-leaves-board` (see the todos below).
//
// Harvested gaps (also named in each card's judgeReason):
// - effect.token: no Bird / Gold definition -> negated with
//   blockedReason "token-definition-or-abilities-judge-required".
// - effect.token: `entersExhausted` is rejected ("Invalid effect.token
//   argument"); a later effect.exhaust is not equivalent (143.4).
// - programs/play.ts: a played token with cardId:null has no play program.
// - Deathknell: trigger.leave is unregistered and the lifecycle detach above
//   removes the subscription before the trigger scan runs.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import huntingDog from "../../../dist/cards/rad/hunting-dog.js";
import carrionDredger from "../../../dist/cards/unl/carrion-dredger.js";
import honestBroker from "../../../dist/cards/sfd/honest-broker.js";
import noxianEmissary from "../../../dist/cards/ven/noxian-emissary.js";

const authoredTrigger = program => program.abilities.find(candidate => candidate.kind === "triggered");

/** Transient executable view: same identity, sourceText and authored ability. */
function executionSlice(program, trigger = authoredTrigger(program)) {
  return {
    canonicalCardId: program.canonicalCardId,
    rulesetVersion: program.rulesetVersion,
    sourceText: program.sourceText,
    status: "executable",
    abilities: [trigger],
  };
}

const baseA = { type: "base", player: "A" };
const baseB = { type: "base", player: "B" };
const battlefield = { type: "battlefield", id: "bf-679" };
const death = (object, player) => ({ type: "trigger", timingPoint: "object-killed", object, player });

// Synthetic control program: it pays nothing but really locks a target and
// performs the merged effect.empower GameAction, so the Emissary row observes a
// genuine empowered state change instead of a hand-written field.
const empowerDriver = {
  canonicalCardId: "test.rift-679.empower-driver",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText: "Test control: empower a unit.",
  abilities: [{
    kind: "play",
    cost: { kind: "explicit", energy: { kind: "constant", value: 0 } },
    body: [{
      id: "driver.empower",
      op: "effect.empower",
      args: { objects: { kind: "constant", value: { kind: "target", id: "controlled-unit" } } },
      targets: [{ id: "controlled-unit", filter: { type: "unit", zone: "board", controller: "self" }, min: 1, max: 1, selection: "one" }],
    }],
  }],
};

const emissaryAuthored = authoredTrigger(noxianEmissary);
// Keep the authored trigger filter; drop only the Empowered gate, whose
// evaluation needs the event-aware trigger evaluator (the scenario harness's
// testTrigger port reads the construction-time source snapshot). The gate is
// covered faithfully in test/cards/ven/noxian-emissary.test.mjs.
const { condition: _unsupportedGate, ...emissaryFilter } = emissaryAuthored.trigger;
const emissaryBodyOnly = { ...emissaryAuthored, trigger: emissaryFilter };

const rows = [
  {
    name: "Hunting Dog · the 1-Might Bird request negates after the death trigger resolves (CR 187.7)",
    canonicalCardId: huntingDog.canonicalCardId,
    program: executionSlice(huntingDog),
    verify(result) {
      assert.deepEqual(result.state.chain, []);
      assert.equal(result.state.objects.filter(object => object.isToken).length, 0);
    },
    scenario: {
      objects: [{ id: "dog", cardId: huntingDog.canonicalCardId, types: ["unit"], zone: "board", location: battlefield, might: 3 }],
      operations: [death("dog", "B"), { type: "pass", player: "A" }, { type: "pass", player: "B" }],
    },
    expect: {
      // The harness emission is the timing point only; no zone change is faked.
      objects: { dog: { zone: "board", might: 3, isToken: false } },
      links: {
        "hunting-dog.base.value": baseA,
        "hunting-dog.play-bird-token.birdToken": {
          amount: 0,
          objects: [],
          blockedReason: "token-definition-or-abilities-judge-required",
        },
      },
      events: { sequence: [
        { timingPoint: "object-killed", object: { ref: "dog" } },
        { timingPoint: "chain-item-finalize" },
        { timingPoint: "chain-item-resolve" },
      ] },
    },
  },
  {
    name: "Carrion Dredger · controller B's base is linked before the Bird request negates (CR 808.1.c, 187.7)",
    canonicalCardId: carrionDredger.canonicalCardId,
    program: executionSlice(carrionDredger),
    verify(result) {
      assert.deepEqual(result.state.chain, []);
      assert.equal(result.state.objects.filter(object => object.isToken).length, 0);
    },
    scenario: {
      objects: [{ id: "dredger", cardId: carrionDredger.canonicalCardId, owner: "A", controller: "B", types: ["unit"], zone: "board", location: battlefield, might: 1 }],
      operations: [death("dredger", "A"), { type: "pass", player: "B" }, { type: "pass", player: "A" }],
    },
    expect: {
      objects: { dredger: { zone: "board", controller: "B", might: 1 } },
      links: {
        "carrion-dredger.controller-base.location": baseB,
        "carrion-dredger.play-bird-token.birdToken": {
          amount: 0,
          objects: [],
          blockedReason: "token-definition-or-abilities-judge-required",
        },
      },
      events: { sequence: [
        { timingPoint: "object-killed", object: { ref: "dredger" } },
        { timingPoint: "chain-item-finalize" },
        { timingPoint: "chain-item-resolve" },
      ] },
    },
  },
  {
    name: "Honest Broker · the death trigger finalizes verbatim, including the exhausted-Gold stipulation (CR 187.5)",
    canonicalCardId: honestBroker.canonicalCardId,
    program: executionSlice(honestBroker),
    verify(result) {
      const [item] = result.state.chain;
      assert.equal(item.status, "finalized");
      assert.equal(item.kind, "triggered");
      assert.equal(item.controller, "A");
      // The authored body is carried unchanged, entry stipulation included; the
      // next boundary row shows the primitive rejecting it at resolve time.
      assert.deepEqual(item.body, authoredTrigger(honestBroker).body);
      assert.equal(result.state.objects.filter(object => object.isToken).length, 0);
    },
    scenario: {
      objects: [{ id: "broker", cardId: honestBroker.canonicalCardId, types: ["unit"], zone: "board", location: baseA, might: 2 }],
      answers: { "honest-broker.choose-location/location%3Ahonest-broker.token-location": baseA },
      operations: [death("broker", "B"), { type: "pass", player: "A" }],
    },
    expect: {
      objects: { broker: { zone: "board", might: 2 } },
      events: { sequence: [
        { timingPoint: "object-killed", object: { ref: "broker" } },
        { timingPoint: "chain-item-finalize" },
      ] },
    },
  },
  {
    name: "Noxian Emissary · the pre-death empowered snapshot queues the two-Recruit body (CR 727.1.c.1, 828.1.b.1)",
    canonicalCardId: noxianEmissary.canonicalCardId,
    program: executionSlice(noxianEmissary, emissaryBodyOnly),
    verify(result) {
      const [item] = result.state.chain;
      assert.equal(item.status, "finalized");
      assert.equal(item.controller, "A");
      assert.equal(item.source.empowered, 1);
      assert.deepEqual(item.body, emissaryAuthored.body);
      assert.equal(result.state.objects.filter(object => object.isToken).length, 0);
    },
    scenario: {
      players: { A: { energy: 1, power: ["Order"] } },
      objects: [
        { id: "emissary", cardId: noxianEmissary.canonicalCardId, types: ["unit"], zone: "board", location: baseA, might: 2, energy: 2, power: ["Order"] },
        { id: "driver", program: empowerDriver, types: ["spell"], zone: "hand", energy: 0, power: null },
      ],
      answers: { "target:controlled-unit": ["emissary"] },
      operations: [
        { type: "play", object: "driver", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
        death("emissary", "B"),
      ],
    },
    expect: {
      objects: { emissary: { zone: "board", empowered: 1, energy: 2, power: ["Order"] } },
      events: { sequence: [
        { timingPoint: "empowered-changed", action: { type: "empower", object: "emissary" } },
        { timingPoint: "object-killed", object: { ref: "emissary" } },
        { timingPoint: "chain-item-finalize" },
      ] },
    },
  },
];

for (const [index, row] of defineTemplateSuite("RIFT-679 keyword/triggered object-killed/effect.token", rows).entries()) {
  test(row.name, () => {
    const result = row.run();
    rows[index].verify(result);
  });
}

// Each template keeps at least one boundary beyond the rows above.
const boundaryRows = [
  {
    name: "Hunting Dog · another unit's death never queues the self trigger (808.1.d)",
    canonicalCardId: huntingDog.canonicalCardId,
    program: executionSlice(huntingDog),
    scenario: {
      objects: [
        { id: "dog", cardId: huntingDog.canonicalCardId, types: ["unit"], zone: "board", location: battlefield, might: 3 },
        { id: "other", owner: "A", controller: "A", types: ["unit"], zone: "board", location: battlefield, might: 2 },
      ],
      operations: [death("other", "A")],
    },
    verify(result) {
      assert.deepEqual(result.state.chain, []);
      assert.deepEqual(result.links, {});
    },
    expect: { objects: { dog: { zone: "board" }, other: { zone: "board" } }, links: {}, events: { exact: [{ timingPoint: "object-killed" }, { timingPoint: "cleanup-start" }, { timingPoint: "cleanup-end" }] } },
  },
  {
    name: "Honest Broker · resolving the authored exhausted entry stipulation fails closed (143.4, 184.1)",
    canonicalCardId: honestBroker.canonicalCardId,
    program: executionSlice(honestBroker),
    scenario: {
      objects: [{ id: "broker", cardId: honestBroker.canonicalCardId, types: ["unit"], zone: "board", location: baseA, might: 2 }],
      answers: { "honest-broker.choose-location/location%3Ahonest-broker.token-location": baseA },
      operations: [death("broker", "B"), { type: "pass", player: "A" }, { type: "pass", player: "B" }],
    },
    throws: /Invalid effect\.token argument: entersExhausted/,
  },
  {
    name: "Noxian Emissary · the Recruit play handoff has no native-token program (440.2.c, 185.2.a)",
    canonicalCardId: noxianEmissary.canonicalCardId,
    program: executionSlice(noxianEmissary, emissaryBodyOnly),
    scenario: {
      objects: [{ id: "emissary", cardId: noxianEmissary.canonicalCardId, types: ["unit"], zone: "board", location: baseA, might: 2, energy: 2, power: ["Order"] }],
      operations: [death("emissary", "B"), { type: "pass", player: "A" }, { type: "pass", player: "B" }],
    },
    throws: /No CardProgram is registered for <null>/,
  },
  {
    // The gate's rule outcome (an unempowered death queues nothing, CR 727.1.b.3 /
    // 828.1.b.1) is asserted here against the authored trigger. Which evaluator
    // reads the pre-death LKI is pinned in test/cards/ven/noxian-emissary.test.mjs:
    // the harness's testTrigger port re-reads its construction-time source snapshot,
    // so a state flip after registration is not observable through this path.
    name: "Noxian Emissary · an unempowered death queues no printed body (727.1.b.3, 828.1.b.1)",
    canonicalCardId: noxianEmissary.canonicalCardId,
    program: executionSlice(noxianEmissary),
    scenario: {
      objects: [{ id: "emissary", cardId: noxianEmissary.canonicalCardId, types: ["unit"], zone: "board", location: baseA, might: 2, energy: 2, power: ["Order"] }],
      operations: [death("emissary", "B")],
    },
    verify(result) {
      assert.deepEqual(result.state.chain, []);
      assert.deepEqual(result.links, {});
    },
    expect: {
      objects: { emissary: { zone: "board", empowered: 0, might: 2 } },
      links: {},
      events: { exact: [{ timingPoint: "object-killed" }, { timingPoint: "cleanup-start" }, { timingPoint: "cleanup-end" }] },
    },
  },
];

for (const [index, row] of defineTemplateSuite("RIFT-679 keyword/triggered object-killed boundaries", boundaryRows).entries()) {
  test(row.name, () => {
    if (boundaryRows[index].throws) {
      assert.throws(() => row.run(), boundaryRows[index].throws);
      return;
    }
    const result = row.run();
    boundaryRows[index].verify(result);
  });
}

// Gaps that no row above can honestly execute. These are not passes.
test.todo(
  "RIFT-679: effect.token needs the CR 187.7 Bird (1 Might, Bird tag, [Deflect]) and CR 187.5 Gold " +
  "(with its own [Reaction][>] ability) definitions before Hunting Dog, Carrion Dredger and Honest " +
  "Broker can complete; the frozen table only holds recruit/sand-soldier/mech/reflection/tentacle"
);
test.todo(
  "RIFT-679: a played token with cardId:null has no programs/play.ts binding, so Noxian Emissary's " +
  "two Recruits (CREATED + play, 440.2.c / 185.2.a / 350.2 / 354) cannot resolve on the production chain"
);
test.todo(
  "RIFT-679: programs/lifecycle.ts unregisters a program-bound trigger right after the pipeline scans " +
  "object-leaves-board, so the later object-killed scan has no subscription and a real kill action " +
  "never queues these death triggers; the rows above use the scenario harness's declared trigger " +
  "emission instead (measured: the registration count drops 2 -> 1 across a real kill commit)"
);
test.todo(
  "RIFT-679: Deathknell's expansion body still references the unregistered trigger.leave instruction " +
  "(CR 808.1.d.1/808.1.d.2); the keyword half cannot resolve until it is merged"
);
test.todo(
  "RIFT-679: Deflect's static target.tax has no layer mapping and Chain Finalize charges the tax as " +
  "Energy instead of any-domain Power (809.1.c/809.1.c.1), which would apply to the Bird token once its " +
  "definition exists"
);
test.todo(
  "RIFT-679: Empower's printed 1 Energy + 1 Order Power is not carried through KeywordAbility/" +
  "programs/keywords.ts (827.1.c.1); the activation path rejects cost kind \"empower\""
);
