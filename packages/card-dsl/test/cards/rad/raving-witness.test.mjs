import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/raving-witness.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import reveal from "../../../../engine-core/dist/effects/instructions/effect.reveal.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { mightyCondition } from "../../../../engine-core/dist/effects/keywords/Mighty.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { ReferenceTestKernel, runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { isTimingPointId } from "../../../../engine-core/dist/events/timing-points.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { finalizeOrderedPickPlans } from "../../../../engine-core/dist/chain/picks/plan.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";

const CARD_ID =
  "card.hash-5100d228a6eda08c0fbbe5b5f17f74b70f6df76adde914277019866a34ba54b2";

const [triggered] = program.abilities;
const [revealTop, checkMighty, drawIfMighty, recycleOtherwise] = triggered.body;

test("rad-074-167 Raving Witness: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // README §2: the reason names the merged blockers, not task numbers.
  assert.match(program.judgeReason, /Mighty/);
  assert.match(program.judgeReason, /if\/otherwise/);
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /invalid-event-type/);
  assert.match(program.judgeReason, /return-to-hand/);
  assert.match(program.judgeReason, /condition.result/);
  assert.match(program.judgeReason, /Resolve.*有序来源捕获/);
  assert.match(program.judgeReason, /Draw.*原语/);
  assert.equal(/RIFT-\d+/.test(program.judgeReason), false);
});

test("rad-074-167 Raving Witness: sourceText is the verbatim deck-catalog ability text", () => {
  assert.equal(
    program.sourceText,
    "When I move, reveal the top card of your Main Deck. If it's [Mighty], draw it. " +
      "Otherwise, recycle it. (A unit is Mighty while it has 5+ :rb_might:.)"
  );
});

test("rad-074-167 Raving Witness: 'When I move' subscribes to the successful move timing point (449 / object-moved)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "object-moved");
  assert.deepEqual(triggered.trigger.filter, {
    event: "object-moved",
    filter: { source: "self" }
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 4);
});

test("rad-074-167 Raving Witness: the reveal reads the deck top through an ordered pick (425.1 / RIFT-66)", () => {
  assert.equal(revealTop.id, "raving-witness.reveal-top");
  assert.equal(revealTop.op, "effect.reveal");
  // A single card from a non-hand zone must arrive as a pick; zone+count would approximate
  // "the top card" from an unordered query (effect.reveal's documented boundary).
  assert.equal(revealTop.args.pick.value, "raving-witness.top-card");
  assert.equal(revealTop.args.zone, undefined);
  assert.equal(revealTop.args.count, undefined);
  assert.equal(revealTop.picks.length, 1);
  assert.deepEqual(revealTop.picks[0], {
    id: "raving-witness.top-card", options: [], ordered: true, selection: "all",
    zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 1 } }
  });
});

test("rad-074-167 Raving Witness: the Mighty branch moves the revealed card to hand (707/708/711)", () => {
  assert.equal(drawIfMighty.id, "raving-witness.draw-mighty");
  assert.equal(drawIfMighty.op, "effect.zone");
  assert.equal(drawIfMighty.linkedTo, "raving-witness.reveal-top");
  assert.deepEqual(drawIfMighty.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(drawIfMighty.args.pick, {
    kind: "constant",
    value: "raving-witness.revealed-card"
  });
  // 707/708/711: snapshot the unit-only, non-null, printed >=5 predicate once.
  assert.equal(checkMighty.op, "condition.predicate");
  assert.equal(checkMighty.linkedTo, revealTop.id);
  assert.deepEqual(checkMighty.args.condition.value, {
    kind: "all",
    conditions: [
      {
        kind: "compare",
        left: { kind: "count", subject: "objects", filter: { type: "unit", object: { linked: revealTop.id } } },
        operator: "gt", right: { kind: "constant", value: 0 }
      },
      {
        kind: "compare",
        left: { kind: "object-property", object: { linked: revealTop.id }, property: "might" },
        operator: "ne", right: { kind: "constant", value: null }
      },
      {
        kind: "compare",
        left: { kind: "object-property", object: { linked: revealTop.id }, property: "might" },
        operator: "gte", right: { kind: "constant", value: 5 }
      }
    ]
  });
  assert.deepEqual(drawIfMighty.condition, { kind: "result", result: checkMighty.id, key: "value" });
  assert.deepEqual(drawIfMighty.picks, [{
    id: "raving-witness.revealed-card", options: [], ordered: true, selection: "all",
    linked: { kind: "linked-value", instructionId: revealTop.id, key: "revealed" }
  }]);
});

test("rad-074-167 Raving Witness: the otherwise branch recycles the same revealed card to the deck bottom (417.1.a)", () => {
  assert.equal(recycleOtherwise.id, "raving-witness.recycle-not-mighty");
  assert.equal(recycleOtherwise.op, "effect.recycle");
  assert.equal(recycleOtherwise.linkedTo, "raving-witness.reveal-top");
  assert.deepEqual(recycleOtherwise.condition, { kind: "not", condition: drawIfMighty.condition });
  assert.deepEqual(recycleOtherwise.args.objects, {
    kind: "linked-value",
    instructionId: "raving-witness.reveal-top",
    key: "revealed"
  });
  // The two branches are gated on complementary conditions over one locked object, so neither
  // can silently move a card the other already handled.
  assert.equal(recycleOtherwise.condition.condition.result, checkMighty.id);
});

test("rad-074-167 Raving Witness: effect.reveal publicly reveals the picked top card without moving it (425.1.a.2)", () => {
  const kernel = world().unit("raving-witness", { might: 3 }).deck(["mighty-card", "second"]).build();
  const top = kernel.zoneSlice("A", "deck", "top", 1)[0].ref;
  const run = runInstruction(
    reveal,
    { pick: "raving-witness.top-card" },
    { world: kernel, picks: { "raving-witness.top-card": [top] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.revealedCount, 1);
  assert.deepEqual(run.linked.revealed, [top]);
  assert.equal(kernel.getObject("mighty-card").zone, "deck");
  assert.equal(kernel.player("A").deckSize, 2);
  assert.equal(kernel.player("A").handSize, 0);
});

test("rad-074-167 Raving Witness: the revealed card can be drawn to hand by effect.zone (414.1)", () => {
  const kernel = world().deck(["mighty-card", "second"]).build();
  const top = kernel.zoneSlice("A", "deck", "top", 1)[0].ref;
  const run = runInstruction(
    zone,
    {
      pick: "raving-witness.revealed-card",
      to: { kind: "constant", value: "hand" },
      amount: { kind: "constant", value: 1 }
    },
    { world: kernel, picks: { "raving-witness.revealed-card": [top] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("mighty-card").zone, "hand");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  // The kernel routes a move to hand through the closed return-to-hand action.
});

test("rad-074-167 Raving Witness: the otherwise branch recycles the revealed card to the bottom of its owner's deck (417.1.a)", () => {
  const kernel = world().deck(["not-mighty", "second", "third"]).build();
  const top = kernel.zoneSlice("A", "deck", "top", 1)[0].ref;
  const run = runInstruction(
    recycle,
    { objects: { kind: "constant", value: [top] } },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.recycledCount, 1);
  assert.equal(kernel.player("A").deckSize, 3);
  const deckIds = kernel.zoneSlice("A", "deck", "top").map(object => object.ref.id);
  assert.equal(deckIds.at(-1), "not-mighty", "recycle always lands on the deck bottom");
  assert.deepEqual(run.events.map(event => event.action), ["recycle"]);
});

test("rad-074-167 Raving Witness: Mighty threshold executes at 5 and above (CR 707/708/711)", () => {
  for (const [might, expected] of [[4, false], [5, true], [6, true]]) {
    const kernel = world().unit(`mighty-${might}`, { might }).build();
    const outcome = runAbilityBody([{
      id: "mighty-check",
      op: "condition.predicate",
      args: {
        condition: { kind: "constant", value: mightyCondition({ canonicalCardId: CARD_ID }) }
      }
    }], kernel, undefined, { host: kernel.ref(`mighty-${might}`) });
    assert.equal(outcome.results[0].result.status, "executed");
    assert.equal(outcome.linkedValues["mighty-check.value"], expected);
  }
});

test.todo(
  "rad-074-167 Raving Witness: object-moved is not in the engine EVENT_PATTERN_TYPES — " +
    "validateTriggerSpec reports invalid-event-type (the timing point itself exists), so the " +
    "event vocabulary needs the move event before this trigger can register"
);

test("rad-074-167 Raving Witness: the as-printed body executes both branches against the locked deck top", () => {
  // The body is the card's own IR (no fixture settlement): the deck top is bound
  // by the ordered pick, and the two mutually exclusive conditions run against
  // the locked object's printed Might (CR 707/708/711).
  for (const [might, expected] of [[6, "hand"], [5, "hand"], [4, "deck"], [1, "deck"]]) {
    const kernel = world()
      .unit("witness", { might: 3 })
      .card("bottom", { zone: "deck", might: 1 })
      .card("top", { zone: "deck", types: ["unit"], might })
      .build();
    const [top] = kernel.zoneSlice("A", "deck", "top", 1);
    assert.equal(top.ref.id, "top", "the ordered slice names the real deck top");
    const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("witness") });
    for (const plan of finalizeOrderedPickPlans(scoped, triggered.body)) scoped.setPicks(plan.id, plan.refs);

    const outcome = resolveChainBody(triggered.body, scoped);

    const expectedReveal = "executed";
    const expectedDraw = might >= 5 ? "executed" : "negated";
    const expectedRecycle = might >= 5 ? "negated" : "executed";
    assert.deepEqual(
      outcome.results.map(entry => [entry.id, entry.result.status]),
      [
        ["raving-witness.reveal-top", expectedReveal],
        ["raving-witness.check-mighty", "executed"],
        ["raving-witness.draw-mighty", expectedDraw],
        ["raving-witness.recycle-not-mighty", expectedRecycle]
      ],
      `printed Might ${might}: ${JSON.stringify(outcome.results)}`
    );
    if (might >= 5) {
      // 707/708/711 + effect.zone: the locked card itself moved to the hand.
      assert.equal(scoped.getObject("top").zone, "hand");
      assert.deepEqual(outcome.events.map(event => event.action), ["reveal", "return-to-hand"]);
      assert.deepEqual(scoped.zoneSlice("A", "deck", "top").map(object => object.ref.id), ["bottom"]);
    } else {
      // 417.1/417.1.a: the locked card recycled to the bottom of its owner's deck.
      assert.equal(scoped.getObject("top").zone, "deck");
      assert.deepEqual(outcome.events.map(event => event.action), ["reveal", "recycle"]);
      assert.deepEqual(
        scoped.zoneSlice("A", "deck", "top").map(object => object.ref.id).at(-1),
        "top"
      );
    }
  }
});

test("rad-074-167 Raving Witness: object-moved is missing from the merged event vocabulary", () => {
  // The timing point exists and the action adapter maps move-location onto it,
  // but EVENT_PATTERN_TYPES has no entry, so the strict validator rejects the
  // translated registration (translateTriggerFilter itself succeeds).
  assert.equal(isTimingPointId("object-moved"), true);
  const source = world().unit("witness", { cardId: CARD_ID }).build().getObject("witness");
  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const [registration] = triggerRegistrations(new ProgramRegistry([lifted]), source);
  assert.deepEqual(registration.spec.filter, {
    event: "object-moved",
    object: { objectId: "witness" }
  });
  const result = validateTriggerSpec(registration.spec);
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues.map(issue => issue.code), ["invalid-event-type"]);
});

// CR 707/708: a non-unit or a unit without printed Might is not Mighty.
// Before the snapshot predicate, both ordered null comparisons were ignored.
for (const [name, types, might] of [
  ["null Might unit", ["unit"], null],
  ["null Might spell", ["spell"], null],
  ["non-unit with numeric Might", ["gear"], 6]
]) test(`rad-074-167 Raving Witness regression: ${name} is recycled by the otherwise branch`, () => {
  const kernel = world().unit("witness", { might: 3 })
    .card("bottom", { zone: "deck", might: 1 })
    .card("top", { zone: "deck", types, might, energy: null, power: null }).build();
  // WorldBuilder currently defaults null Might to 1. Construct the initial
  // immutable fixture with its exact printed characteristic; no game action
  // or settlement has occurred yet, and execution uses the unchanged kernel.
  const initial = kernel.snapshot();
  const scoped = new ReferenceTestKernel({
    sourceSnapshot: kernel.getObject("witness"),
    state: { ...initial, objects: new Map([...initial.objects].map(([id, object]) =>
      [id, id === "top" ? { ...object, might } : object])) }
  });
  for (const plan of finalizeOrderedPickPlans(scoped, triggered.body)) scoped.setPicks(plan.id, plan.refs);
  const outcome = resolveChainBody(triggered.body, scoped);
  assert.deepEqual(outcome.events.map(event => event.action), ["reveal", "recycle"]);
  assert.deepEqual(scoped.zone("A", "deck").map(ref => ref.id), ["bottom", "top"]);
  assert.equal(outcome.linkedValues["raving-witness.check-mighty.value"], false);
  assert.equal(scoped.getObject("top").might, might);
  assert.equal(scoped.getObject("top").energy, null);
  assert.equal(scoped.getObject("top").power, null);
  assert.equal(scoped.player("A").handSize, 0);
});

test("rad-074-167 Raving Witness: empty deck reveals and moves no object", () => {
  const kernel = world().unit("witness", { might: 3 }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("witness") });
  for (const plan of finalizeOrderedPickPlans(scoped, triggered.body)) scoped.setPicks(plan.id, plan.refs);
  const outcome = resolveChainBody(triggered.body, scoped);
  assert.deepEqual(outcome.events, []);
  assert.equal(scoped.player("A").deckSize, 0);
  assert.equal(scoped.player("A").handSize, 0);
});
