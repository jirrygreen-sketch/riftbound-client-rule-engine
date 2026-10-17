// RIFT-703 template-level golden for the `play||` group (Cruel Patron,
// Perched Grimwyrm, Ol' Poro; packages/card-dsl/src/cards/README.md 4.1).
//
// The three programs share one IR signature — a single `play` ability whose
// `body` is empty — because none of the three printed lines is an effect:
//
//   Cruel Patron      ogn-208-298  "As an additional cost to play me, kill a friendly unit."
//   Perched Grimwyrm  sfd-015-221  "Play me only to a battlefield you conquered this turn. (You can't play me anywhere else.)"
//   Ol' Poro          ven-029-166  "I can't be played on your first, second, or third turns."
//
// Each printed line is a cost or a play-legality clause, so the shared body is
// empty by construction: no instruction exists that could resolve, be negated
// or be ignored. The group's execution question is therefore about the three
// different ways the play procedure must consume that declaration.
//
// Measured 2026-10-17: all three declarations fail closed in the real
// production binding (`programs/play.ts` via `createProgramBinding().describePlay`)
// before Finalize ever runs:
//
//   Cruel Patron      translateCost rejects kind "additional" ->
//                     ProgramBindingError(judge-required) "Additional costs are not bound for play:..."
//   Perched Grimwyrm  translateRestriction has no adapter for
//                     "play-only-to-conquered-battlefield-this-turn".
//   Ol' Poro          translateRequirements has no adapter for
//                     "not-before-own-turn" (and no per-player turn ordinal exists).
//
// Consequently no program can be promoted to `executable`; the group's status
// table stays judge-required -> judge-required, and the single-card files keep
// their full behaviour/structure assertions. This file is the execution
// evidence referenced from those three files.
//
// Each card still gets its own parameter row with its own canonical identity,
// board, operations and printed expectations. A row runs the card's *printed
// play procedure* through the real runCardScenario path (ProgramBinding ->
// ChainEngine -> EventPipeline): the unit leaves Hand, the printed Energy is
// paid, the printed Might is used, `power: null` stays null, and the permanent
// enters the Board. The row's program is a test-only slice that removes exactly
// one unsupported clause (asserted mechanically below) and changes nothing
// else; the shipped program is re-asserted in every row and never promoted.
import assert from "node:assert/strict";
import test from "node:test";

import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { defineTemplateSuite, runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { ProgramBindingError } from "../../../../engine-core/dist/programs/errors.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import cruelPatron from "../../../dist/cards/ogn/cruel-patron.js";
import perchedGrimwyrm from "../../../dist/cards/sfd/perched-grimwyrm.js";
import olPoro from "../../../dist/cards/ven/ol-poro.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const IDS = {
  cruelPatron: "card.hash-ea1f0540f042966387899650fa2fbb3646f2d1d8ad7264dd83eb0fee4bd953de",
  perchedGrimwyrm: "card.hash-1e5601a20e9eec5eb8bd27251a8711e541767f111db13703166777e918b52cbb",
  olPoro: "card.hash-2ffb19822a72dc6ca4fc7111ad103487e5e4a120251c9b158b1064e31aa11748",
};

const TEMPLATE = "RIFT-703 play||";
const BATTLEFIELD = { type: "battlefield", id: "bf-703-conquered" };
const BASE_A = { type: "base", player: "A" };

/** The harness refuses judge-required programs; this view keeps the printed clause. */
const lifted = program => ({ ...program, status: "executable", judgeReason: undefined });

/**
 * Test-only slice: same canonical identity, same sourceText, the same single
 * empty-body play ability with exactly one unsupported clause removed. The
 * shared row wrapper re-derives the kept ability from the shipped program and
 * asserts it is byte-for-byte that ability minus the named key.
 */
function playSlice(program, removed) {
  const [ability] = program.abilities;
  const { [removed]: _removedClause, ...kept } = ability;
  return { ...lifted(program), abilities: [kept] };
}

function judgeRequired(pattern) {
  return error => {
    assert.ok(error instanceof ProgramBindingError, `expected ProgramBindingError, got ${String(error)}`);
    assert.equal(error.code, "judge-required");
    assert.match(error.message, pattern);
    return true;
  };
}

/**
 * Drive the published declaration through the real production play adapter.
 * `describePlay` is the exact seam the scenario harness uses; it must refuse the
 * printed clause before any target/cost/zone work happens.
 */
function probeDescribePlay(program, object) {
  const binding = createProgramBinding({ cardPrograms: [lifted(program)] });
  const kernel = world().object("subject", { ...object, zone: "hand" }).build();
  const source = kernel.getObject("subject");
  const before = kernel.snapshot();
  let error;
  try {
    binding.describePlay({ type: "play", object: source.ref, player: "A" }, source);
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, `${program.canonicalCardId}: describePlay must fail closed`);
  assert.deepEqual(kernel.snapshot(), before, `${program.canonicalCardId}: no state may change`);
  return error;
}

const PLAY = [{ type: "play", object: "subject", player: "A" }, { type: "pass", player: "A" }];

// ---------------------------------------------------------------------------
// One row per card: that card's own board, operations and printed expectations.
// ---------------------------------------------------------------------------
const rows = [
  {
    name: "Cruel Patron · printed play procedure: 4 Energy, Might 6, Power null (additional-cost clause removed — unsupported)",
    card: cruelPatron,
    id: IDS.cruelPatron,
    canonicalCardId: IDS.cruelPatron,
    removed: "cost",
    program: playSlice(cruelPatron, "cost"),
    bindingError: judgeRequired(/^Additional costs are not bound for play:/),
    scenario: {
      players: { A: { energy: 4 } },
      objects: [
        { id: "subject", cardId: IDS.cruelPatron, types: ["unit"], zone: "hand", energy: 4, power: null, might: 6 },
        { id: "fodder", owner: "A", types: ["unit"], zone: "board", location: BATTLEFIELD, might: 1 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: BATTLEFIELD, might: 3 },
      ],
      operations: PLAY,
      expect: {
        objects: {
          subject: { zone: "board", exhausted: true, location: BASE_A, might: 6, energy: 4, power: null },
          fodder: { zone: "board", location: BATTLEFIELD },
          enemy: { zone: "board", location: BATTLEFIELD },
        },
        players: { A: { energy: 0 } },
        events: { includes: [
          { timingPoint: "chain-item-finalize", object: { ref: "subject" } },
          { timingPoint: "card-played", object: { ref: "subject" }, details: { fromZone: "hand", playedFromHand: true, printed: { energy: 4, power: null, might: 6 } } },
          { timingPoint: "chain-item-resolve", object: { ref: "subject" } },
        ] },
      },
    },
    verify: published => {
      // The printed clause stays declared: the slice removed it only for this
      // run, and the mandatory kill is never executed by the row.
      assert.equal(published.abilities[0].cost.kind, "additional");
      assert.deepEqual(published.abilities[0].cost.payments.map(payment => payment.kind), ["kill"]);
    },
  },
  {
    name: "Perched Grimwyrm · printed play procedure: 4 Energy, Might 5, chosen battlefield (restriction clause removed — unsupported)",
    card: perchedGrimwyrm,
    id: IDS.perchedGrimwyrm,
    canonicalCardId: IDS.perchedGrimwyrm,
    removed: "restriction",
    program: playSlice(perchedGrimwyrm, "restriction"),
    bindingError: judgeRequired(/restriction card\.hash-.* kind play-only-to-conquered-battlefield-this-turn needs a rules adapter/),
    scenario: {
      players: { A: { energy: 4 } },
      objects: [
        { id: "subject", cardId: IDS.perchedGrimwyrm, types: ["unit"], zone: "hand", energy: 4, power: null, might: 5 },
      ],
      operations: [{ ...PLAY[0], location: BATTLEFIELD }, PLAY[1]],
      expect: {
        objects: {
          subject: { zone: "board", exhausted: true, location: BATTLEFIELD, might: 5, energy: 4, power: null },
        },
        players: { A: { energy: 0 } },
        events: { includes: [
          { timingPoint: "object-enters-battlefield", object: { ref: "subject", location: BATTLEFIELD } },
          { timingPoint: "card-played", object: { ref: "subject" }, details: { fromZone: "hand", printed: { energy: 4, power: null, might: 5 } } },
        ] },
      },
    },
    verify: published => {
      // The printed placement clause stays declared, with its conquered-this-turn
      // marker intact; the row never treats an arbitrary battlefield as conquered.
      assert.equal(published.abilities[0].restriction.kind, "play-only-to-conquered-battlefield-this-turn");
      assert.equal(published.abilities[0].restriction.value.value.conqueredThisTurn, true);
    },
  },
  {
    name: "Ol' Poro · printed play procedure: 2 Energy, Might 4, Power null (requirement clause removed — unsupported)",
    card: olPoro,
    id: IDS.olPoro,
    canonicalCardId: IDS.olPoro,
    removed: "requirements",
    program: playSlice(olPoro, "requirements"),
    bindingError: judgeRequired(/requirement card\.hash-.* kind not-before-own-turn needs a rules adapter/),
    scenario: {
      players: { A: { energy: 2 } },
      objects: [
        { id: "subject", cardId: IDS.olPoro, types: ["unit"], zone: "hand", energy: 2, power: null, might: 4 },
      ],
      operations: PLAY,
      expect: {
        objects: {
          subject: { zone: "board", exhausted: true, location: BASE_A, might: 4, energy: 2, power: null },
        },
        players: { A: { energy: 0 } },
        events: { includes: [
          { timingPoint: "chain-item-finalize", object: { ref: "subject" } },
          { timingPoint: "card-played", object: { ref: "subject" }, details: { fromZone: "hand", printed: { energy: 2, power: null, might: 4 } } },
        ] },
      },
    },
    verify: published => {
      // The printed prohibition stays declared as the finalize requirement it is.
      assert.deepEqual(published.abilities[0].requirements, [
        { kind: "not-before-own-turn", value: { kind: "constant", value: 4 } },
      ]);
    },
  },
];

for (const [index, golden] of defineTemplateSuite(TEMPLATE, rows).entries()) {
  const row = rows[index];
  test(golden.name, () => {
    const published = cardProgramsById.get(row.id);
    assert.equal(published, row.card, `${row.id}: generated registry identity`);
    // The shipped program stays judge-required with a concrete reason; the
    // scenario API refuses it by design (README 4.1).
    assert.equal(published.status, "judge-required");
    assert.ok(published.judgeReason?.trim(), `${row.id}: judgeReason must name the real gap`);
    assert.throws(
      () => runCardScenario(published, { objects: [], operations: [] }),
      { message: `Scenario program ${row.id} is judge-required` },
    );
    // Shared signature: exactly one empty-body play ability.
    assert.equal(published.abilities.length, 1);
    assert.equal(published.abilities[0].kind, "play");
    assert.deepEqual(published.abilities[0].body, []);
    // The slice removes exactly the named clause and nothing else.
    const { [row.removed]: removedClause, ...keptAbility } = published.abilities[0];
    assert.notEqual(removedClause, undefined, `${row.id}: the removed clause must exist`);
    assert.deepEqual(row.program.abilities, [keptAbility]);
    // The printed declaration reaches the real adapter and fails closed there.
    assert.throws(
      () => runCardScenario(lifted(published), row.scenario),
      row.bindingError,
    );
    // The supported play procedure runs through the real path for this card.
    const result = golden.run();
    assert.deepEqual(result.state.chain, []);
    assert.ok(result.events.length > 0, `${row.name}: real pipeline events are required`);
    row.verify(published, result);
  });
}

// ---------------------------------------------------------------------------
// Boundary group (README 4.1): every row asserts a real fail-closed outcome of
// merged production code. The printed bodies are empty, so the possible
// boundaries are "no legal candidate", "cannot evaluate the clause" and
// "cannot pay the printed cost"; there is no instruction that could be negated
// or ignored on these three cards.
// ---------------------------------------------------------------------------
const boundaryRows = [
  {
    name: "boundary (no legal target): Cruel Patron's mandatory kill cost has no friendly-unit candidate",
    card: cruelPatron,
    id: IDS.cruelPatron,
    canonicalCardId: IDS.cruelPatron,
    program: lifted(cruelPatron),
    bindingError: judgeRequired(/^Additional costs are not bound for play:/),
    scenario: {
      players: { A: { energy: 4 } },
      objects: [
        { id: "subject", cardId: IDS.cruelPatron, types: ["unit"], zone: "hand", energy: 4, power: null, might: 6 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: BATTLEFIELD, might: 3 },
      ],
      operations: PLAY,
    },
  },
  {
    name: "boundary (condition not evaluable): Perched Grimwyrm's conquered-battlefield restriction has no rules adapter",
    card: perchedGrimwyrm,
    id: IDS.perchedGrimwyrm,
    canonicalCardId: IDS.perchedGrimwyrm,
    program: lifted(perchedGrimwyrm),
    bindingError: judgeRequired(/restriction card\.hash-.* kind play-only-to-conquered-battlefield-this-turn needs a rules adapter/),
    scenario: {
      players: { A: { energy: 4 } },
      objects: [
        { id: "subject", cardId: IDS.perchedGrimwyrm, types: ["unit"], zone: "hand", energy: 4, power: null, might: 5 },
      ],
      operations: [{ ...PLAY[0], location: BATTLEFIELD }, PLAY[1]],
    },
  },
  {
    name: "boundary (condition not evaluable): Ol' Poro's turn-ordinal requirement has no rules adapter",
    card: olPoro,
    id: IDS.olPoro,
    canonicalCardId: IDS.olPoro,
    program: lifted(olPoro),
    bindingError: judgeRequired(/requirement card\.hash-.* kind not-before-own-turn needs a rules adapter/),
    scenario: {
      players: { A: { energy: 2 } },
      objects: [
        { id: "subject", cardId: IDS.olPoro, types: ["unit"], zone: "hand", energy: 2, power: null, might: 4 },
      ],
      operations: PLAY,
    },
  },
  {
    name: "boundary (cannot pay): Ol' Poro's printed 2 Energy is not payable with 1 Energy",
    card: olPoro,
    id: IDS.olPoro,
    canonicalCardId: IDS.olPoro,
    program: playSlice(olPoro, "requirements"),
    bindingError: error => {
      assert.ok(error instanceof CostPlanError, `expected CostPlanError, got ${String(error)}`);
      assert.equal(error.reason, "cannot-pay-cost");
      assert.match(error.message, /insufficient Energy/);
      return true;
    },
    scenario: {
      players: { A: { energy: 1 } },
      objects: [
        { id: "subject", cardId: IDS.olPoro, types: ["unit"], zone: "hand", energy: 2, power: null, might: 4 },
      ],
      operations: PLAY,
    },
    supported: () => {
      // Differential control: the same printed procedure succeeds when the
      // printed cost is actually payable, so the boundary is the payment.
      const result = runCardScenario(playSlice(olPoro, "requirements"), {
        players: { A: { energy: 2 } },
        objects: [{ id: "subject", cardId: IDS.olPoro, types: ["unit"], zone: "hand", energy: 2, power: null, might: 4 }],
        operations: PLAY,
      });
      assert.equal(result.state.objects.find(object => object.ref.id === "subject").zone, "board");
      assert.equal(result.state.players.A.energy, 0);
    },
  },
];

for (const [index, golden] of defineTemplateSuite(`${TEMPLATE} boundaries`, boundaryRows).entries()) {
  const row = boundaryRows[index];
  test(golden.name, () => {
    assert.equal(cardProgramsById.get(row.id), row.card);
    assert.equal(row.card.status, "judge-required");
    assert.throws(() => golden.run(), row.bindingError);
    row.supported?.();
  });
}

// The three declarations are refused by the exact production seam the harness
// uses, before any cost/target/zone work; the kernel snapshot stays untouched.
for (const [label, program, object, pattern] of [
  ["Cruel Patron", cruelPatron, { cardId: IDS.cruelPatron, types: ["unit"], energy: 4, power: null, might: 6 }, /^Additional costs are not bound for play:/],
  ["Perched Grimwyrm", perchedGrimwyrm, { cardId: IDS.perchedGrimwyrm, types: ["unit"], energy: 4, power: null, might: 5 }, /restriction card\.hash-.* needs a rules adapter/],
  ["Ol' Poro", olPoro, { cardId: IDS.olPoro, types: ["unit"], energy: 2, power: null, might: 4 }, /requirement card\.hash-.* needs a rules adapter/],
]) {
  test(`RIFT-703 ${label} [${program.canonicalCardId}]: describePlay refuses the printed declaration before any state change`, () => {
    const error = probeDescribePlay(program, object);
    assert.ok(error instanceof ProgramBindingError, String(error));
    assert.equal(error.code, "judge-required");
    assert.match(error.message, pattern);
  });
}

// ---------------------------------------------------------------------------
// Cruel Patron's cost half: the card's own declared kill payment is exercised
// through the merged cost layer (cost.modify -> cost.pay) with caller-bound
// runtime candidates. The production CardProgram -> mandatoryAdditional binding
// does not exist (pinned above), so this is cost-layer evidence only.
// ---------------------------------------------------------------------------
function boundCostArgs(kernel, options) {
  const [payment] = cruelPatron.abilities[0].cost.payments;
  return {
    id: "cruel-patron.cost",
    cost: { kind: "printed" },
    mandatoryAdditional: [{
      id: "cruel-patron.kill",
      cost: { payments: [{ ...payment, choice: { ...payment.choice, options } }] },
    }],
  };
}

test(`RIFT-703 boundary (no legal target): Cruel Patron's declared kill payment cannot be planned with zero friendly-unit candidates [${IDS.cruelPatron}]`, () => {
  const kernel = world()
    .player("A", { energy: 4 })
    .hand("patron", { cardId: IDS.cruelPatron, types: ["unit"], energy: 4, power: null, might: 6 })
    .unit("enemy", { owner: "B" })
    .build();
  const bound = kernel.clone({ sourceSnapshot: kernel.getObject("patron") });
  const before = bound.snapshot();
  assert.throws(
    () => runInstruction(costModify, boundCostArgs(bound, []), { world: bound }),
    error => error instanceof CostPlanError && error.reason === "invalid-cost-plan",
  );
  assert.deepEqual(bound.snapshot(), before);
  assert.equal(bound.linked("cost"), undefined);
  assert.equal(bound.linked("payment"), undefined);
});

test(`RIFT-703 boundary (no legal target): Cruel Patron's declared kill payment rejects an opponent-controlled candidate without committing anything [${IDS.cruelPatron}]`, () => {
  const kernel = world()
    .player("A", { energy: 4 })
    .hand("patron", { cardId: IDS.cruelPatron, types: ["unit"], energy: 4, power: null, might: 6 })
    .unit("enemy", { owner: "B" })
    .build();
  const bound = kernel.clone({ sourceSnapshot: kernel.getObject("patron") });
  const plan = runInstruction(costModify, boundCostArgs(bound, [bound.ref("enemy")]), {
    world: bound,
    picks: { "friendly-unit": [bound.ref("enemy")] },
  }).linked.cost;
  assert.deepEqual(plan.total.actions.map(entry => entry.action), [{ type: "kill", object: bound.ref("enemy") }]);
  const before = bound.snapshot();
  const links = bound.linkedSnapshot();
  assert.throws(
    () => runInstruction(costPay, { cost: { kind: "constant", value: plan } }, { world: bound }),
    error => error instanceof CostPlanError && error.reason === "cannot-pay-cost",
  );
  assert.deepEqual(bound.snapshot(), before);
  assert.deepEqual(bound.linkedSnapshot(), links);
  assert.equal(bound.player("A").energy, 4);
  assert.equal(bound.getObject("enemy").zone, "board");
  assert.equal(bound.getObject("patron").zone, "hand");
});
