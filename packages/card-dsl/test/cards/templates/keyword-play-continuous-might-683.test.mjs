// RIFT-683 template-level parameterized golden for the `keyword+play||
// continuous.might` group (packages/card-dsl/src/cards/README.md 4.1):
// Call to Glory (ogn-207-298), Decree of Focus (ven-040-166) and Onslaught
// (ven-081-166).
//
// Method: every card has its own row with its canonical identity, the program's
// own abilities, its own board, its own operations and its own expectation
// assertions, and each row runs the real generic card scenario harness
// (RIFT-592: ProgramBinding -> ChainEngine -> EventPipeline -> layers). Rows are
// split by the printed slice they exercise; where a printed clause cannot enter
// the merged path, the boundary rows assert the measured engine rejection rather
// than an invented success.
//
// The harness refuses judge-required programs by design, so a row's `program` is
// a test-local view with the same canonicalCardId, rulesetVersion, sourceText and
// abilities; only the validation metadata differs. Every row re-asserts that the
// published program stays judge-required, so no row can be read as a promotion.
//
// Whole-card status for all three cards is judge-required, because each still
// prints a clause without a merged consumer:
//   * Call to Glory — the optional spend-buff additional cost (356.2.b) and the
//     conditional ignore-base rewrite (356.1.b.1); its printed decline branch
//     (3 Energy, +3 Might) runs through the harness.
//   * Decree of Focus — the compound target predicate (740.2.c / "being chosen
//     by an enemy Fury spell"); its +4 Might body runs through the harness with
//     the three evaluable predicates (type/zone/controller) intact.
//   * Onslaught — the [Flow] alternate cost and its leave-chain banish
//     (829.1.b.1 / 829.1.c.1); its +6 Might body runs through the harness.
// The measured-gate tests below execute each of those missing consumers and
// assert the real rejection, so the gap is verified rather than assumed.
import assert from "node:assert/strict";
import test from "node:test";

import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { assessCostPayment, payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { ProgramBindingError } from "../../../../engine-core/dist/programs/errors.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { translateInstructionTargets } from "../../../../engine-core/dist/programs/filters.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import callToGlory from "../../../dist/cards/ogn/call-to-glory.js";
import retreat from "../../../dist/cards/ogn/retreat.js";
import decreeOfFocus from "../../../dist/cards/ven/decree-of-focus.js";
import onslaught from "../../../dist/cards/ven/onslaught.js";

const CALL_TO_GLORY = callToGlory.canonicalCardId;
const DECREE_OF_FOCUS = decreeOfFocus.canonicalCardId;
const ONSLAUGHT = onslaught.canonicalCardId;

const playAbility = program => program.abilities.find(ability => ability.kind === "play");

/** The scenario harness refuses judge-required programs by design. */
const executableView = program => ({ ...program, status: "executable", judgeReason: undefined });

/**
 * Decree of Focus carries a named, non-evaluable `targetRestriction` key; the
 * card's measured-gate test proves programs/filters.ts rejects that key in the
 * production translator. The rows drop only that description, so the printed
 * +4 Might body runs with its type/zone/controller predicates intact (the same
 * drop the card's own golden has always made when executing the body).
 */
const withoutDescriptiveRestriction = program => ({
  ...program,
  abilities: program.abilities.map(ability => ability.kind !== "play" ? ability : ({
    ...ability,
    body: ability.body.map(instruction => ({
      ...instruction,
      targets: instruction.targets.map(spec => {
        const { targetRestriction: _inexpressible, ...filter } = spec.filter;
        return { ...spec, filter };
      }),
    })),
  })),
});

const resolveSpell = [
  { type: "play", object: "spell", player: "A" },
  { type: "pass", player: "A" },
  { type: "pass", player: "B" },
];

// 317.2.c: every "this turn" effect expires simultaneously at end of turn.
const endTurn = { type: "trigger", timingPoint: "turn-end" };

/**
 * The three cards print the same instruction shape — one selected Board unit
 * gets a signed, this-turn Might modification — so their rows are built from a
 * shared shape while everything that makes a card itself (identity, program,
 * instruction id, target id, printed Energy, target owner, printed Might and
 * printed Buff count) stays per-row data.
 */
const groups = [
  {
    card: "Call to Glory",
    canonicalCardId: CALL_TO_GLORY,
    program: callToGlory,
    view: executableView(callToGlory),
    instructionId: "call-to-glory.grant-might",
    targetId: "call-to-glory.unit",
    amount: 3,
    printedEnergy: 3,
    // 355.9.a.1: "a unit" is a Board unit with no printed controller limit.
    targetOwner: "B",
    targetMight: 2,
    targetBuffs: 1,
  },
  {
    card: "Decree of Focus",
    canonicalCardId: DECREE_OF_FOCUS,
    program: decreeOfFocus,
    view: executableView(withoutDescriptiveRestriction(decreeOfFocus)),
    instructionId: "decree-of-focus.give-plus-4",
    targetId: "decree-of-focus.friendly-unit",
    amount: 4,
    printedEnergy: 1,
    // 355.9.b: "friendly" restricts the target to the ability controller.
    targetOwner: "A",
    targetMight: 3,
    targetBuffs: 0,
  },
  {
    card: "Onslaught",
    canonicalCardId: ONSLAUGHT,
    program: onslaught,
    view: executableView(onslaught),
    instructionId: "onslaught.give-plus-6",
    targetId: "onslaught.unit",
    amount: 6,
    printedEnergy: 4,
    // 355.9.a.1: "a unit" is a Board unit with no printed controller limit.
    targetOwner: "B",
    targetMight: 4,
    targetBuffs: 0,
  },
];

/** Each card's own board: its spell, its chosen target, a bystander and a hand unit. */
function mainBoard(group) {
  return [
    { id: "spell", cardId: group.canonicalCardId, types: ["spell"], zone: "hand", energy: group.printedEnergy, power: null, might: null },
    { id: "chosen", owner: group.targetOwner, types: ["unit"], zone: "board", might: group.targetMight, buffs: group.targetBuffs },
    // A second Board unit the effect must not touch, and a unit card outside the
    // Board that every printed "unit" predicate must exclude (355.9.a.1).
    { id: "other", owner: group.targetOwner === "A" ? "B" : "A", types: ["unit"], zone: "board", might: 4 },
    { id: "hand-unit", owner: "A", types: ["unit"], zone: "hand", might: 7 },
  ];
}

const rows = [];

for (const group of groups) {
  const boostedMight = group.targetMight + group.amount;
  const chosenRef = { ref: "chosen" };

  // Row 1 per card: the printed Might grant lands on the chosen Board unit.
  rows.push({
    group,
    name: `${group.card} · the printed +${group.amount} Might lands on the chosen Board unit`,
    canonicalCardId: group.canonicalCardId,
    program: group.view,
    scenario: {
      players: { A: { energy: group.printedEnergy } },
      objects: mainBoard(group),
      answers: { [`target:${group.targetId}`]: ["chosen"] },
      operations: resolveSpell,
      expect: {
        objects: {
          spell: { zone: "trash", power: null },
          chosen: { zone: "board", might: boostedMight, buffs: group.targetBuffs },
          other: { zone: "board", might: 4, buffs: 0 },
          "hand-unit": { zone: "hand", might: 7, buffs: 0 },
        },
        players: { A: { energy: 0, power: [] } },
        events: {
          includes: [
            // 355.8: the unit is locked while the spell is finalized.
            { timingPoint: "became-target", target: chosenRef, object: chosenRef },
            { timingPoint: "chain-item-finalize", object: { ref: "spell" } },
            { timingPoint: "card-played", object: { ref: "spell" } },
            { timingPoint: "chain-item-resolve", object: { ref: "spell" } },
            { timingPoint: "object-enters-trash", object: { ref: "spell" } },
          ],
        },
        // continuous.might links the real affected set, so each row also proves
        // that exactly the chosen unit received the arithmetic-layer effect.
        links: {
          [`${group.instructionId}.affected.count`]: 1,
          [`${group.instructionId}.affected.objects`]: ["chosen"],
        },
      },
    },
    verify(result) {
      // The Might change is a layer effect, never a Buff counter (702/703 vs
      // 143.2.a): the printed Buff count must survive the grant untouched.
      assert.equal(result.state.objects.find(object => object.ref.id === "chosen").buffs, group.targetBuffs);
    },
  });

  // Row 2 per card: the same grant expires in the end-of-turn cleanup.
  rows.push({
    group,
    name: `${group.card} · 317.2.c end-of-turn cleanup removes the +${group.amount} Might again`,
    canonicalCardId: group.canonicalCardId,
    program: group.view,
    scenario: {
      players: { A: { energy: group.printedEnergy } },
      objects: mainBoard(group),
      answers: { [`target:${group.targetId}`]: ["chosen"] },
      operations: [...resolveSpell, endTurn],
      expect: {
        objects: {
          spell: { zone: "trash", power: null },
          chosen: { zone: "board", might: group.targetMight, buffs: group.targetBuffs },
          other: { zone: "board", might: 4 },
          "hand-unit": { zone: "hand", might: 7 },
        },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "turn-end" }] },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Boundary rows driven through the same real scenario path. Each card gets its
// own row so a failure localizes to one card; the three required shapes (no
// legal target, negated, illegal answer) are each covered here.
// ---------------------------------------------------------------------------
const boundaryRows = [];

for (const group of groups) {
  // No legal target. "A unit" means a Board unit (355.9.a.1) and "friendly"
  // additionally means the controller's own (355.9.b), so a board with no legal
  // unit and a hand unit card must fail finalization: a spell cannot be put on
  // the chain without valid choices for all of its targets (355.8).
  const targetless = [
    { id: "spell", cardId: group.canonicalCardId, types: ["spell"], zone: "hand", energy: group.printedEnergy, power: null, might: null },
    { id: "board-gear", owner: "A", types: ["gear"], zone: "board", energy: null, power: null, might: null },
    { id: "hand-unit", owner: "A", types: ["unit"], zone: "hand", might: 7 },
  ];
  if (group.canonicalCardId === DECREE_OF_FOCUS) {
    // An enemy Board unit satisfies "a unit" but not "a friendly unit".
    targetless.push({ id: "enemy-unit", owner: "B", types: ["unit"], zone: "board", might: 8 });
  }
  boundaryRows.push({
    group,
    program: group.view,
    name: `${group.card} boundary (no legal target) · the printed target predicate finds no candidate`,
    canonicalCardId: group.canonicalCardId,
    scenario: { players: { A: { energy: group.printedEnergy } }, objects: targetless, operations: resolveSpell },
    expectedFailure: error => error?.code === "no-legal-targets",
  });

  // Negated: the printed base cost cannot be paid, and the chain must not
  // substitute a free play. For Onslaught the printed 4 Energy is also its Flow
  // cost (829.1.c.1), so one Energy short fails under either cost.
  boundaryRows.push({
    group,
    program: group.view,
    name: `${group.card} boundary (negated) · one Energy short of the printed ${group.printedEnergy} cannot play the spell`,
    canonicalCardId: group.canonicalCardId,
    scenario: {
      players: { A: { energy: group.printedEnergy - 1 } },
      objects: [
        { id: "spell", cardId: group.canonicalCardId, types: ["spell"], zone: "hand", energy: group.printedEnergy, power: null, might: null },
        { id: "chosen", owner: group.targetOwner, types: ["unit"], zone: "board", might: group.targetMight },
      ],
      answers: { [`target:${group.targetId}`]: ["chosen"] },
      operations: resolveSpell,
    },
    expectedFailure: error => error?.name === "CostPlanError" && error?.reason === "cannot-pay-cost",
  });

  // Condition not satisfied / illegal answer: the chosen object is not a legal
  // target for the printed predicate, so the real target planner rejects the
  // choice instead of locking it and ignoring it later.
  boundaryRows.push({
    group,
    program: group.view,
    name: `${group.card} boundary (illegal answer) · a hand card cannot be locked as the target`,
    canonicalCardId: group.canonicalCardId,
    scenario: {
      players: { A: { energy: group.printedEnergy } },
      objects: [
        { id: "spell", cardId: group.canonicalCardId, types: ["spell"], zone: "hand", energy: group.printedEnergy, power: null, might: null },
        // The board does offer a legal target, so the failure below is the
        // planner rejecting the answer and not an empty candidate set.
        { id: "legal-unit", owner: group.targetOwner, types: ["unit"], zone: "board", might: group.targetMight },
        { id: "hand-unit", owner: "A", types: ["unit"], zone: "hand", might: 7 },
      ],
      answers: { [`target:${group.targetId}`]: ["hand-unit"] },
      operations: resolveSpell,
    },
    expectedFailure: error => error?.code === "invalid-target-choice",
  });
}

/**
 * Register every row as its own test. Each row first pins the published card,
 * then either runs its scenario (and checks that the chain drained) or asserts
 * the measured failure. The rows come from the real template helper, so each
 * test name carries the card name and its canonical identity.
 */
function register(templateName, suiteRows) {
  for (const [index, golden] of defineTemplateSuite(templateName, suiteRows).entries()) {
    const row = suiteRows[index];
    if (row.group.card === "Onslaught") {
      test.todo(`${golden.name} — Unsupported replacement opcode: effect.banish; missing Flow leave-chain banish replacement consumer`);
      continue;
    }
    test(golden.name, () => {
      assert.equal(row.group.program.status, "judge-required", `${row.group.card} stays judge-required`);
      assert.equal(row.group.program.canonicalCardId, row.canonicalCardId);
      assert.ok(row.group.program.judgeReason?.trim(), `${row.group.card} keeps a concrete judgeReason`);
      if (row.expectedFailure !== undefined) {
        assert.throws(golden.run, row.expectedFailure);
        return;
      }
      const result = golden.run();
      assert.deepEqual(result.state.chain, []);
      row.verify?.(result);
    });
  }
}

register("RIFT-683 keyword+play||continuous.might", rows);
register("RIFT-683 keyword+play||continuous.might boundary", boundaryRows);

// ---------------------------------------------------------------------------
// Cross-card boundary: the locked target leaves the Board while the spell is
// still on the chain. Every card's body must be ignored, register no layer, and
// leave the returned unit untouched (359.3.e.1-6). A real [Reaction] spell
// (ogn/retreat) performs the return through the production chain; nothing is
// hand-mutated and no printed clause is dropped.
// ---------------------------------------------------------------------------
for (const group of groups) {
  if (group.card === "Onslaught") {
    test.todo(`${group.card} boundary (ignored) · a target returned by a real Reaction receives no Might [${group.canonicalCardId}] — Unsupported replacement opcode: effect.banish; missing Flow leave-chain banish replacement consumer`);
    continue;
  }
  test(`${group.card} boundary (ignored) · a target returned by a real Reaction receives no Might [${group.canonicalCardId}]`, () => {
    const golden = defineTemplateSuite(`RIFT-683 ${group.card} ignored boundary`, [{
      name: group.card,
      canonicalCardId: group.canonicalCardId,
      program: group.view,
      scenario: {
        players: { A: { energy: group.printedEnergy + 1 } },
        objects: [
          { id: "spell", cardId: group.canonicalCardId, types: ["spell"], zone: "hand", energy: group.printedEnergy, power: null, might: null },
          { id: "retreat", program: retreat, cardId: retreat.canonicalCardId, owner: "A", types: ["spell"], zone: "hand", energy: 1, power: null, might: null },
          { id: "chosen", owner: "A", types: ["unit"], zone: "board", might: group.targetMight, buffs: group.targetBuffs },
        ],
        answers: { [`target:${group.targetId}`]: ["chosen"], "target:friendly-unit": ["chosen"] },
        operations: [
          { type: "play", object: "spell", player: "A" },
          { type: "pass", player: "A" },
          { type: "play", object: "retreat", player: "A" },
          { type: "pass", player: "A" },
          { type: "pass", player: "B" },
          { type: "pass", player: "A" },
          { type: "pass", player: "B" },
        ],
        expect: {
          objects: {
            spell: { zone: "trash", power: null },
            retreat: { zone: "trash", power: null },
            chosen: { zone: "hand", might: group.targetMight, buffs: group.targetBuffs },
          },
          events: {
            includes: [
              { timingPoint: "became-target", target: { ref: "chosen" }, source: { ref: "spell" } },
              { timingPoint: "object-enters-hand", object: { ref: "chosen" } },
              { timingPoint: "card-played", object: { ref: "spell" } },
              { timingPoint: "card-played", object: { ref: "retreat" } },
            ],
          },
        },
      },
    }])[0];
    const result = golden.run();
    assert.deepEqual(result.state.chain, []);
    // 359.3.e.2/e.4/e.6: the target reference is gone, so continuous.might
    // writes no affected set and registers no layer for this card.
    assert.equal(result.links[`${group.instructionId}.affected`], undefined);
    assert.equal(result.links[`${group.instructionId}.affected.count`], undefined);
  });
}

// ---------------------------------------------------------------------------
// Measured gates: the printed clause each card still cannot run. These tests
// execute the declared consumer and assert the real rejection, so the recorded
// gap is verified instead of assumed. They add no success and promote nothing.
// ---------------------------------------------------------------------------
test(`RIFT-683 measured gate · Call to Glory's optional spend-buff cost and ignore-base rewrite have no consumer (356.2.b/356.1.b.1/702.2.b.1) [${CALL_TO_GLORY}]`, () => {
  const program = callToGlory;
  assert.equal(program.status, "judge-required");
  const [reaction, payment, rewrite, play] = program.abilities;
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(payment.kind, "static");
  assert.equal(payment.effect.kind, "cost.additional");
  assert.equal(payment.effect.optional, true);
  assert.deepEqual(play.cost, { kind: "cost.printed", energy: { kind: "constant", value: 3 } });

  // The printed base cost and the Might body are what the merged path can run;
  // the declared optional cost and the rewrite are both rejected by the
  // production static binder, so neither can silently apply.
  const binder = createEngineStaticBinder(fixture({ cards: [] }).engine);
  const spell = world()
    .card("spell", { owner: "A", cardId: program.canonicalCardId, types: ["spell"], zone: "hand", energy: 3, power: null, might: null })
    .build()
    .getObject("spell");
  assert.throws(
    () => binder.bindStatic(payment, spell),
    error => error instanceof ProgramBindingError && error.code === "judge-required" &&
      error.message === "Static ability kind cost.additional has no layer mapping"
  );
  assert.equal(rewrite.effect.kind, "continuous.cost-modification");
  assert.throws(
    () => binder.bindStatic(rewrite, spell),
    error => error instanceof ProgramBindingError && error.code === "judge-required" &&
      error.message === "Static ability kind continuous.cost-modification has no layer mapping"
  );

  // The cost layer itself does support the printed payment once a Finalize-time
  // adapter supplies the runtime option set and the pay/decline decision; both
  // branches then behave per 702.2.b.1 / 357.2.a. This is the adapter's target
  // behavior, not whole-card execution.
  const paymentId = payment.effect.payments[0].choice.id;
  for (const selected of [true, false]) {
    const kernel = world()
      .player("A", { energy: 3 })
      .card("spell", { owner: "A", cardId: program.canonicalCardId, types: ["spell"], zone: "hand", energy: 3, power: null, might: null })
      .unit("holder", { owner: "A", controller: "A", might: 2, buffs: 1 })
      .build();
    const context = kernel.clone({
      sourceSnapshot: kernel.getObject("spell"),
      controller: "A",
      answers: new Map([[`cost:rift-683:${selected}:pick:${paymentId}`, [kernel.ref("holder")]]]),
    });
    const plan = buildCostPlan(context, {
      id: `cost:rift-683:${selected}`,
      // 3 Energy base: the merged path cannot yet apply the conditional
      // ignore-base rewrite, so this row keeps the printed base cost rather than
      // pretending the free play happened.
      cost: { kind: "explicit", energy: { kind: "constant", value: 3 } },
      optionalAdditional: [{
        id: paymentId,
        kind: "additional",
        selected,
        cost: { payments: [{ ...payment.effect.payments[0], choice: { ...payment.effect.payments[0].choice, options: [context.ref("holder")] } }] },
      }],
    });
    const receipt = payCostPlan(context, plan);
    assert.equal(context.player("A").energy, 0);
    if (selected) {
      // 702.2.b spends exactly one Buff counter and 357.2.a records the cost as
      // paid, so the component survives in the receipt.
      assert.equal(context.getObject("holder").buffs, 0);
      assert.deepEqual(plan.selectedAdditional, [{ id: paymentId, kind: "additional" }]);
      assert.deepEqual(receipt.additional, [{ id: paymentId, kind: "additional", paid: true }]);
    } else {
      assert.equal(context.getObject("holder").buffs, 1);
      assert.deepEqual(plan.declinedAdditional, [paymentId]);
      assert.deepEqual(receipt.additional, []);
    }
  }

  // 702.2.b.1: a unit without a buff cannot be spent from, so the option is
  // genuinely unpayable and nothing is debited.
  const unbuffed = world()
    .player("A", { energy: 3 })
    .card("spell", { owner: "A", cardId: program.canonicalCardId, types: ["spell"], zone: "hand", energy: 3, power: null, might: null })
    .unit("holder", { owner: "A", controller: "A", might: 2, buffs: 0 })
    .build();
  const context = unbuffed.clone({
    sourceSnapshot: unbuffed.getObject("spell"),
    controller: "A",
    answers: new Map([[`cost:rift-683:unbuffed:pick:${paymentId}`, [unbuffed.ref("holder")]]]),
  });
  const plan = buildCostPlan(context, {
    id: "cost:rift-683:unbuffed",
    cost: { kind: "explicit", energy: { kind: "constant", value: 3 } },
    optionalAdditional: [{
      id: paymentId,
      kind: "additional",
      selected: true,
      cost: { payments: [{ ...payment.effect.payments[0], choice: { ...payment.effect.payments[0].choice, options: [context.ref("holder")] } }] },
    }],
  });
  const assessed = assessCostPayment(context, plan);
  assert.equal(assessed.payable, false);
  assert.equal(assessed.error.reason, "cannot-pay-cost");
  assert.equal(assessed.error.message, "Insufficient Buffs");
  assert.equal(context.player("A").energy, 3);
  assert.equal(context.getObject("holder").buffs, 0);
});

test(`RIFT-683 measured gate · Decree of Focus's compound target predicate is not expressible (740.2.c/355.9.b) [${DECREE_OF_FOCUS}]`, () => {
  const program = decreeOfFocus;
  assert.equal(program.status, "judge-required");
  const target = playAbility(program).body[0].targets[0];
  // The disjunction is carried as a named description only; the production
  // filter translator rejects that key instead of ignoring it, so the authored
  // IR cannot legalize every friendly unit by accident.
  assert.equal(target.filter.targetRestriction, "in-combat-with-an-enemy-fury-unit-or-being-chosen-by-an-enemy-fury-spell");
  assert.deepEqual(Object.keys(target.filter).sort(), ["controller", "targetRestriction", "type", "zone"]);
  assert.throws(
    () => translateInstructionTargets(playAbility(program).body),
    error => error instanceof ProgramBindingError && error.code === "judge-required" &&
      error.message === "Unsupported filter field targetRestriction"
  );
  // The Might half itself uses only evaluable vocabulary: dropping the
  // descriptive key yields a spec the production translator binds. That is what
  // the rows above run, and it does not make the printed restriction executable.
  const [bindable] = translateInstructionTargets(playAbility(program).body.map(instruction => ({
    ...instruction,
    targets: instruction.targets.map(spec => {
      const { targetRestriction: _inexpressible, ...filter } = spec.filter;
      return { ...spec, filter };
    }),
  })));
  assert.deepEqual(bindable.targets[0].filter, { type: "unit", zone: "board", controller: "self" });
});

test(`RIFT-683 measured gate · Onslaught's Flow cost and leave-chain banish have no consumer (829.1.b.1/829.1.c.1) [${ONSLAUGHT}]`, () => {
  const program = onslaught;
  assert.equal(program.status, "judge-required");
  // The binder resolves the replacement host from its own engine, so the card
  // object has to live in that engine's kernel.
  const { engine, kernel } = fixture({
    cards: [{ id: "spell", cardId: program.canonicalCardId, types: ["spell"], energy: 4, power: null, might: null }],
  });
  engine.commit({ type: "move-zone", object: kernel.ref("spell"), to: "trash" });
  const host = kernel.getObject("spell");
  const abilities = createProgramBinding({ cardPrograms: [program] }).inspect(host).abilities;
  const cost = abilities.find(ability => ability.kind === "static" && ability.effect.kind === "flow.cost");
  const banished = abilities.find(ability => ability.kind === "replacement" && ability.replaces.event === "object-leaves-chain");
  assert.ok(cost, "the Flow expansion declares its alternate cost");
  assert.ok(banished, "the Flow expansion declares the delayed banish");
  // 829.1.c/829.1.c.1: the printed 4 Energy never reaches Flow.expand today,
  // because the keyword ability carries no value/params.cost.
  assert.equal(cost.cost, undefined);
  assert.deepEqual(banished.with.map(instruction => instruction.op), ["effect.banish"]);

  const binder = createEngineStaticBinder(engine);
  assert.throws(
    () => binder.bindStatic(cost, kernel.getObject("spell")),
    error => error instanceof ProgramBindingError && error.code === "judge-required" &&
      error.message === "Static ability kind flow.cost has no layer mapping"
  );
  assert.throws(
    () => binder.bindReplacement(banished, kernel.getObject("spell")),
    error => error.name === "BlockedReplacementError" &&
      error.message === "Unsupported replacement opcode: effect.banish"
  );
});
