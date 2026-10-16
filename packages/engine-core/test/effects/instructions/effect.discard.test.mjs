import assert from "node:assert/strict";
import test from "node:test";
import discard from "../../../dist/effects/instructions/effect.discard.js";
import draw from "../../../dist/effects/instructions/effect.draw.js";
import { AwaitChoice, runInstruction, world } from "../../../dist/effects/testing/index.js";

const literal = value => ({ kind: "literal", value });
const args = { amount: literal(1) };
const target = { ...args, target: literal("cards") };
const pick = { ...args, pick: literal("cards") };
const ids = (kernel, player, zone) => kernel.zone(player, zone).map(ref => ref.id);

test("effect.discard submits discard and links actual cards with their old identities", () => {
  const kernel = world().hand("card", { energy: null, power: null }).deck("untouched").build();
  const old = kernel.ref("card");
  const run = runInstruction(discard, args, { world: kernel });
  assert.equal(discard.op, "effect.discard");
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.discarded, { count: 1, objects: [old], player: "A" });
  assert.deepEqual(run.result.linkedValues, run.linked);
  assert.deepEqual(run.result.events, run.events);
  assert.deepEqual(run.events.map(event => event.action), ["discard"]);
  assert.deepEqual(ids(kernel, "A", "trash"), ["card"]);
  assert.deepEqual(ids(kernel, "A", "deck"), ["untouched"]);
  assert.equal(kernel.object(old), null);
  assert.notDeepEqual(kernel.ref("card"), old);
  assert.equal(kernel.getObject("card").energy, null);
  assert.equal(kernel.getObject("card").power, null);
});

for (const [status, reason] of [["replaced", "replaced"], ["prevented", "skipped"], ["impossible", "impossible"]]) {
  test("effect.discard returns negated for an action that is " + status, () => {
    const kernel = world().hand("card").build();
    kernel.addReplacement(action => action.type === "discard" ? status : null);
    const run = runInstruction(discard, args, { world: kernel });
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, reason);
    assert.deepEqual(run.linked.discarded, { count: 0, objects: [], player: "A" });
    assert.deepEqual(ids(kernel, "A", "hand"), ["card"]);
    assert.equal(run.events[0].outcome, status);
    assert.deepEqual(run.result.events, run.events);
  });
}

test("effect.discard continues after replacement and links only successful discards", () => {
  const kernel = world().hand("first").hand("blocked").hand("last").build();
  const old = [kernel.ref("first"), kernel.ref("last")];
  kernel.addReplacement(action => action.type === "discard" && action.object.id === "blocked" ? "replaced" : null);
  const run = runInstruction(discard, { amount: literal(3) }, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.deepEqual(run.events.map(event => event.outcome ?? "done"), ["done", "replaced", "done"]);
  assert.deepEqual(run.linked.discarded, { count: 2, objects: old, player: "A" });
  assert.deepEqual(ids(kernel, "A", "hand"), ["blocked"]);
  assert.deepEqual(ids(kernel, "A", "trash"), ["first", "last"]);
});

test("effect.discard uses the first failed action for a deterministic negation reason", () => {
  const kernel = world().hand("prevented").hand("replaced").build();
  kernel.addReplacement(action => action.type !== "discard" ? null :
    action.object.id === "prevented" ? "prevented" : "replaced");
  const run = runInstruction(discard, { amount: literal(2) }, { world: kernel });
  assert.equal(run.result.reason, "skipped");
  assert.equal(run.events.length, 2);
  assert.equal(run.linked.discarded.count, 0);
});

test("effect.discard ignores all targets lost after a zone exit and re-entry", () => {
  const kernel = world().hand("card").build();
  const old = kernel.ref("card");
  assert.equal(kernel.perform({ type: "banish", object: old }).status, "done");
  assert.equal(kernel.perform({ type: "return-to-hand", object: kernel.ref("card") }).status, "done");
  const before = kernel.stateForTest();
  const run = runInstruction(discard, target, { world: kernel, targets: { cards: [old] } });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.events, []);
  assert.deepEqual(run.linked, {});
  assert.deepEqual(kernel.stateForTest(), before);
});

test("effect.discard operates on surviving targets without counting lost targets as a shortfall", () => {
  const kernel = world().hand("lost").hand("live").build();
  const lost = kernel.ref("lost");
  const live = kernel.ref("live");
  assert.equal(kernel.perform({ type: "banish", object: lost }).status, "done");
  const run = runInstruction(discard, { ...target, amount: literal(2) }, {
    world: kernel, targets: { cards: [lost, live, live] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.discarded.objects, [live]);
  assert.equal(run.events.length, 1);
});

test("effect.discard stale non-target picks are negated rather than ignored", () => {
  const kernel = world().hand("card").build();
  const old = kernel.ref("card");
  assert.equal(kernel.perform({ type: "banish", object: old }).status, "done");
  const run = runInstruction(discard, pick, { world: kernel, picks: { cards: [old] } });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked.discarded.count, 0);
  assert.deepEqual(run.events, []);
});

test("effect.discard never discards a Board card or another player's Hand card", () => {
  const kernel = world().unit("unit").hand("enemy", { owner: "B" }).build();
  const before = kernel.stateForTest();
  const selected = [kernel.ref("unit"), kernel.ref("enemy")];
  const invalidTarget = runInstruction(discard, target, { world: kernel, targets: { cards: selected } });
  assert.equal(invalidTarget.result.status, "ignored");
  const invalidPick = runInstruction(discard, pick, { world: kernel, picks: { cards: selected } });
  assert.equal(invalidPick.result.status, "negated");
  assert.equal(invalidPick.linked.discarded.count, 0);
  assert.deepEqual(kernel.stateForTest(), before);
});

test("effect.discard zero amount requires neither a choice nor any discard action", () => {
  const kernel = world().hand("one").hand("two").build();
  const before = kernel.stateForTest();
  const run = runInstruction(discard, { amount: literal(0) }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.asked, null);
  assert.equal(run.events.length, 0);
  assert.deepEqual(run.linked.discarded, { count: 0, objects: [], player: "A" });
  assert.deepEqual(kernel.stateForTest(), before);
});

test("effect.discard with a positive amount and empty Hand is impossible", () => {
  const kernel = world().build();
  const run = runInstruction(discard, args, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked.discarded.count, 0);
  assert.equal(run.events.length, 0);
});

test("effect.discard oversized amounts discard all available cards and negate the remainder", () => {
  const kernel = world().hand("only").build();
  const run = runInstruction(discard, { amount: literal(Number.MAX_SAFE_INTEGER) }, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked.discarded.count, 1);
  assert.deepEqual(ids(kernel, "A", "trash"), ["only"]);
  assert.equal(run.events.length, 1);
});

test("effect.discard all resolves for a nonempty or empty Hand without a choice", () => {
  for (const count of [0, 2]) {
    const builder = world();
    for (let index = 0; index < count; index++) builder.hand("card-" + index);
    const kernel = builder.build();
    const run = runInstruction(discard, { amount: literal("all") }, { world: kernel });
    assert.equal(run.result.status, "executed");
    assert.equal(run.asked, null);
    assert.equal(run.linked.discarded.count, count);
    assert.equal(kernel.player("A").handSize, 0);
  }
});

test("effect.discard suspends a private choice and replays transactionally", () => {
  const kernel = world().hand("one").hand("two").hand("three").hand("enemy", { owner: "B" }).build();
  const refs = [kernel.ref("one"), kernel.ref("two"), kernel.ref("three")];
  const chosenArgs = { amount: literal(2), choiceId: literal("choose-discards") };
  const before = kernel.stateForTest();
  const asked = runInstruction(discard, chosenArgs, { world: kernel });
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.equal(asked.result, null);
  assert.deepEqual(asked.asked.request, {
    id: "choose-discards", type: "select-objects", chooser: "A", visibility: "chooser-only",
    options: refs, min: 2, max: 2
  });
  assert.deepEqual(kernel.stateForTest(), before);
  assert.deepEqual(asked.linked, {});
  const run = runInstruction(discard, chosenArgs, {
    world: kernel, answers: { "choose-discards": [refs[2], refs[0]] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.discarded.objects, [refs[0], refs[2]]);
  assert.deepEqual(ids(kernel, "A", "hand"), ["two"]);
  assert.deepEqual(ids(kernel, "B", "hand"), ["enemy"]);
  assert.deepEqual(ids(kernel, "A", "trash"), ["one", "three"]);
});

test("effect.discard asks the instructed opponent rather than the ability controller", () => {
  const kernel = world().hand("mine").hand("b1", { owner: "B" }).hand("b2", { owner: "B" }).build();
  const opponentArgs = { ...args, player: literal("B") };
  const asked = runInstruction(discard, opponentArgs, { world: kernel });
  assert.equal(asked.asked.request.chooser, "B");
  assert.equal(asked.asked.request.visibility, "chooser-only");
  assert.deepEqual(asked.asked.request.options, [kernel.ref("b1"), kernel.ref("b2")]);
  const run = runInstruction(discard, opponentArgs, {
    world: kernel, answers: { "effect.discard:B": [kernel.ref("b2")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.discarded.player, "B");
  assert.deepEqual(ids(kernel, "B", "trash"), ["b2"]);
  assert.deepEqual(ids(kernel, "A", "hand"), ["mine"]);
});

test("effect.discard non-target picks keep the preselected order and remove duplicates and non-objects", () => {
  const kernel = world().hand("first").hand("second").hand("remaining").build();
  const first = kernel.ref("first");
  const second = kernel.ref("second");
  const run = runInstruction(discard, { ...pick, amount: literal(2) }, {
    world: kernel, picks: { cards: [second, "A", second, first] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.asked, null);
  assert.deepEqual(run.linked.discarded.objects, [second, first]);
  assert.deepEqual(ids(kernel, "A", "trash"), ["second", "first"]);
  assert.deepEqual(ids(kernel, "A", "hand"), ["remaining"]);
});

test("effect.discard evaluates linked values, arithmetic counts, and a custom link key", () => {
  const kernel = world().hand("card").build();
  const run = runInstruction(discard, {
    amount: { kind: "arithmetic", operator: "add", operands: [literal(0), { kind: "linked", instructionId: "count" }] },
    player: { kind: "linked-value", instructionId: "previous", key: "who" },
    linkKey: literal("actual")
  }, { world: kernel, linked: { count: 1, who: "A" } });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.actual.count, 1);
  assert.equal(run.linked.discarded, undefined);
});

test("ogn-006-298 Flame Chompers is discarded without executing its optional pay-and-play trigger", () => {
  // "When you discard me, you may pay [Fury] to play me."
  const kernel = world().hand("chompers", { cardId: "ogn-006-298", energy: 3, power: null, might: 3 }).hand("other").build();
  const old = kernel.ref("chompers");
  const run = runInstruction(discard, pick, { world: kernel, picks: { cards: [old] } });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map(event => event.action), ["discard"]);
  assert.equal(kernel.history({ action: "discard", object: old }), 1);
  assert.deepEqual(run.linked.discarded.objects, [old]);
  assert.equal(kernel.getObject("chompers").zone, "trash");
  assert.equal(kernel.player("A").energy, 0);
  assert.deepEqual(ids(kernel, "A", "hand"), ["other"]);
  assert.equal(kernel.getObject("chompers").power, null);
});

test("ogn-202-298 Jinx Rebel sees genuine discard actions; ready and Might remain trigger work", () => {
  // "When you discard one or more cards, ready me and give me +1 [M] this turn."
  const kernel = world().unit("jinx", { cardId: "ogn-202-298", exhausted: true, might: 5 }).hand("one").hand("two").build();
  const discardedRefs = [kernel.ref("one"), kernel.ref("two")];
  const run = runInstruction(discard, { amount: literal(2) }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.discarded.count, 2);
  assert.deepEqual(run.events.map(event => event.action), ["discard", "discard"]);
  assert.equal(kernel.history({ action: "discard" }), 2);
  for (const ref of discardedRefs) {
    assert.equal(kernel.history({ action: "discard", object: ref }), 1);
    assert.equal(kernel.lastKnown(ref).owner, "A");
  }
  assert.equal(kernel.getObject("jinx").exhausted, true);
  assert.equal(kernel.getObject("jinx").might, 5);
  assert.deepEqual(kernel.continuousEffects, []);
});

test("ogn-178-298 Undercover Agent CR 423.4 discards as much as possible and then still draws two", () => {
  // "[Deathknell] Discard 2, then draw 2."
  const kernel = world().hand("only").deck(["new-one", "new-two"]).build();
  const discarded = runInstruction(discard, { amount: literal(2) }, { world: kernel });
  assert.equal(discarded.result.status, "negated");
  assert.equal(discarded.linked.discarded.count, 1);
  const drawn = runInstruction(draw, { amount: literal(2) }, { world: kernel });
  assert.equal(drawn.result.status, "executed");
  assert.deepEqual(ids(kernel, "A", "hand"), ["new-one", "new-two"]);
  assert.deepEqual(ids(kernel, "A", "trash"), ["only"]);
});

test("ogn-201-298 Invert Timelines discards each player's whole Hand before drawing four", () => {
  // "Each player discards their hand, then draws 4."
  const kernel = world().hand("old-one").hand("old-two")
    .deck(["a1", "a2", "a3", "a4"])
    .deck(["b1", "b2", "b3", "b4"], { owner: "B" }).build();
  for (const [player, count] of [["A", 2], ["B", 0]]) {
    const run = runInstruction(discard, { amount: literal("all"), player: literal(player) }, { world: kernel });
    assert.equal(run.result.status, "executed");
    assert.equal(run.linked.discarded.count, count);
    assert.equal(run.linked.discarded.player, player);
    assert.equal(kernel.player(player).handSize, 0);
  }
  for (const player of ["A", "B"]) {
    const run = runInstruction(draw, { amount: literal(4), player: literal(player) }, { world: kernel });
    assert.equal(run.result.status, "executed");
  }
  assert.deepEqual(ids(kernel, "A", "hand"), ["a1", "a2", "a3", "a4"]);
  assert.deepEqual(ids(kernel, "B", "hand"), ["b1", "b2", "b3", "b4"]);
  assert.deepEqual(ids(kernel, "A", "trash"), ["old-one", "old-two"]);
  assert.deepEqual(ids(kernel, "B", "trash"), []);
  assert.deepEqual(kernel.events.map(event => event.action), ["discard", "discard", "draw", "draw"]);
});

test("effect.discard rejects malformed schemas, invalid counts, and invalid evaluated ids", () => {
  for (const invalid of [null, [], {}, { amount: 1 }, { amount: { kind: "unknown" } },
    { amount: { kind: "literal" } }, { ...args, extra: literal(1) },
    { ...args, target: literal("cards"), pick: literal("cards") },
    { ...args, player: "A" }, { ...args, amount: { kind: "arithmetic", operator: "neg", operands: [] } }]) {
    assert.throws(() => discard.argsSchema.parse(invalid), TypeError);
  }
  for (const amount of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, null, true, "1"]) {
    const kernel = world().hand("card").build();
    assert.throws(() => runInstruction(discard, { amount: literal(amount) }, { world: kernel }), TypeError);
    assert.equal(kernel.events.length, 0);
    assert.equal(kernel.getObject("card").zone, "hand");
  }
  for (const key of ["player", "target", "pick", "choiceId", "linkKey"]) {
    const kernel = world().hand("card").build();
    assert.throws(() => runInstruction(discard, { ...args, [key]: literal(0) }, { world: kernel }), TypeError);
    assert.equal(kernel.events.length, 0);
  }
});

test("effect.discard rejects forged, stale, duplicate, or wrong-count choice answers atomically", () => {
  for (const answerFor of [
    () => [], () => null, () => ["card"], () => [{ id: "missing", zoneEntryId: 1 }],
    () => [{ id: "one", zoneEntryId: 0 }], kernel => [kernel.ref("enemy")],
    kernel => [kernel.ref("one"), kernel.ref("one")], kernel => [kernel.ref("one"), kernel.ref("two")]
  ]) {
    const kernel = world().hand("one").hand("two").hand("enemy", { owner: "B" }).build();
    const before = kernel.stateForTest();
    assert.throws(() => runInstruction(discard, args, {
      world: kernel, answers: { "effect.discard:A": answerFor(kernel) }
    }), TypeError);
    assert.deepEqual(kernel.stateForTest(), before);
  }
});
