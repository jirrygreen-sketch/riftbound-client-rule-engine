import assert from "node:assert/strict";
import test from "node:test";
import score from "../../../dist/effects/instructions/effect.score.js";
import { runAbilityBody } from "../../../dist/effects/interpreter.js";
import { AwaitChoice, runInstruction, world } from "../../../dist/effects/testing/index.js";

const literal = value => ({ kind: "literal", value });
const target = id => literal({ kind: "target", id });
const pick = id => literal({ kind: "pick", id });
const choose = (options, id = "score-recipient") => literal({ kind: "choose", id, options });
const amount = value => ({ amount: literal(value) });
const battlefield = id => ({ type: "battlefield", id });

// The real interpreter executes the body inside the test kernel transaction.
function resolveBody(body, kernel, options = {}) {
  let outcome;
  const run = runInstruction({
    op: "test.score-body",
    argsSchema: { parse: value => value },
    execute(ctx) {
      outcome = runAbilityBody(body, ctx);
      return outcome.status === "executed" ? { status: "executed", events: [...outcome.events] } :
        { status: "negated", reason: "skipped", events: [...outcome.events] };
    }
  }, {}, { world: kernel, ...options });
  return { ...run, outcome };
}

test("effect.score awards the requested points and links actual results", () => {
  const kernel = world().player("A", { score: 3 }).build();
  const run = runInstruction(score, amount(2), { world: kernel });
  assert.equal(score.op, "effect.score");
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").score, 5);
  assert.equal(kernel.player("B").score, 0);
  assert.deepEqual(run.linked, { scored: [{ player: "A", amount: 2 }] });
  assert.deepEqual(run.result.linkedValues, run.linked);
  assert.deepEqual(run.result.events, run.events);
  assert.deepEqual(run.events.map(event => event.action), ["score"]);
});

test("effect.score defaults to the actual ability controller", () => {
  const kernel = world().build().clone({ controller: "B" });
  const run = runInstruction(score, amount(1), { world: kernel });
  assert.equal(kernel.player("A").score, 0);
  assert.equal(kernel.player("B").score, 1);
  assert.deepEqual(run.linked.scored, [{ player: "B", amount: 1 }]);
});

test("effect.score evaluates amount, recipient, and link key expressions", () => {
  const kernel = world().unit("counter-one").unit("counter-two").build();
  const run = runInstruction(score, {
    amount: { kind: "arithmetic", operator: "add", operands: [
      { kind: "count", subject: "objects", filter: { zone: "board", type: "unit" } }, literal(1)
    ] },
    player: { kind: "linked-value", instructionId: "previous", key: "recipient" },
    linkKey: literal("actualPoints")
  }, { world: kernel, linked: { recipient: "B" } });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("B").score, 3);
  assert.deepEqual(run.linked.actualPoints, [{ player: "B", amount: 3 }]);
});

for (const status of ["replaced", "prevented", "impossible"]) {
  test("effect.score negates a " + status + " action and clears obsolete linked awards", () => {
    const kernel = world().player("A", { score: 7 }).build();
    kernel.addReplacement(action => action.type === "score" ? status : null);
    const run = runInstruction(score, amount(1), {
      world: kernel, linked: { scored: [{ player: "A", amount: 99 }] }
    });
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, status === "prevented" ? "skipped" : status);
    assert.equal(kernel.player("A").score, 7);
    assert.equal(kernel.history({ action: "score" }), 0);
    assert.deepEqual(run.linked.scored, []);
    assert.equal(run.events[0].outcome, status);
    assert.deepEqual(run.result.events, run.events);
  });
}

test("effect.score preserves partial successes and continues after a prevented recipient", () => {
  const kernel = world().player("C").build();
  kernel.addReplacement(action => action.type === "score" && action.player === "B" ? "prevented" : null);
  const run = runInstruction(score, { ...amount(2), player: literal(["A", "B", "C", "A"]) }, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.deepEqual(["A", "B", "C"].map(id => kernel.player(id).score), [2, 0, 2]);
  assert.deepEqual(run.linked.scored, [{ player: "A", amount: 2 }, { player: "C", amount: 2 }]);
  assert.equal(kernel.history({ action: "score" }), 2);
  assert.equal(run.events.length, 3);
});

test("effect.score awards each explicitly listed player once in stable order", () => {
  const kernel = world().build();
  const run = runInstruction(score, { ...amount(3), player: literal(["B", "A", "B"]) }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.scored, [{ player: "B", amount: 3 }, { player: "A", amount: 3 }]);
  assert.equal(kernel.player("A").score, 3);
  assert.equal(kernel.player("B").score, 3);
});

test("effect.score ignores empty targets, even for zero points, without writing links", () => {
  const run = runInstruction(score, { ...amount(0), player: target("gone") }, { world: world().build() });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.events, []);
  assert.deepEqual(run.linked, {});
});

test("effect.score never rebinds a stale target after the object re-enters", () => {
  const kernel = world().unit("unit").build();
  const stale = kernel.ref("unit");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  assert.equal(kernel.perform({ type: "move-zone", object: kernel.ref("unit"), to: "base" }).status, "done");
  const before = kernel.stateForTest();
  const run = runInstruction(score, { ...amount(1), player: target("recipient") }, {
    world: kernel, targets: { recipient: [stale] }
  });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(kernel.stateForTest(), before);
  assert.deepEqual(run.linked, {});
});

test("effect.score uses surviving target controllers and deduplicates recipients", () => {
  const kernel = world().unit("stolen", { owner: "A", controller: "B" }).unit("other", { owner: "B" }).build();
  const run = runInstruction(score, { ...amount(1), player: target("recipients") }, {
    world: kernel, targets: { recipients: [
      { id: "gone", zoneEntryId: 1 }, kernel.ref("stolen"), kernel.ref("other")
    ] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").score, 0);
  assert.equal(kernel.player("B").score, 1);
  assert.deepEqual(run.linked.scored, [{ player: "B", amount: 1 }]);
  assert.equal(kernel.history({ action: "score" }), 1);
});

test("effect.score consumes player picks without consulting unrelated targets", () => {
  const kernel = world().build();
  const run = runInstruction(score, { ...amount(2), player: pick("recipients") }, {
    world: kernel, targets: { recipients: [] }, picks: { recipients: ["B", "B"] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("B").score, 2);
  assert.deepEqual(run.linked.scored, [{ player: "B", amount: 2 }]);
});

for (const entries of [[], [{ id: "not-a-player", zoneEntryId: 1 }], ["A", 2]]) {
  test("effect.score rejects empty or malformed non-target player sets: " + JSON.stringify(entries), () => {
    const kernel = world().build();
    const run = runInstruction(score, { ...amount(1), player: literal(entries) }, { world: kernel });
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, "impossible");
    assert.equal(kernel.history({ action: "score" }), 0);
    assert.deepEqual(run.linked.scored, []);
  });
}

test("effect.score zero points is an executed no-op, not a score action", () => {
  const kernel = world().player("A", { score: 7 }).build();
  const run = runInstruction(score, amount(0), { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").score, 7);
  assert.deepEqual(run.events, []);
  assert.deepEqual(run.linked.scored, []);
  assert.equal(kernel.history({ action: "score" }), 0);
});

for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, "1", true]) {
  test("effect.score rejects invalid quantities without coercion: " + JSON.stringify(value), () => {
    const kernel = world().build();
    const before = kernel.stateForTest();
    const run = runInstruction(score, amount(value), { world: kernel });
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, "impossible");
    assert.deepEqual(run.events, []);
    assert.deepEqual(run.linked.scored, []);
    assert.deepEqual(kernel.stateForTest(), before);
  });
}

test("effect.score accepts the largest safe point total without a Victory Score cap", () => {
  const kernel = world().build();
  const run = runInstruction(score, amount(Number.MAX_SAFE_INTEGER), { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").score, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(run.linked.scored, [{ player: "A", amount: Number.MAX_SAFE_INTEGER }]);
  assert.equal(kernel.history({ action: "win" }), 0);
});

test("effect.score rejects overflow before any recipient is awarded", () => {
  const kernel = world().player("B", { score: Number.MAX_SAFE_INTEGER }).build();
  const run = runInstruction(score, { ...amount(1), player: literal(["A", "B"]) }, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(kernel.player("A").score, 0);
  assert.equal(kernel.player("B").score, Number.MAX_SAFE_INTEGER);
  assert.equal(kernel.history({ action: "score" }), 0);
});

test("effect.score cannot award an unavailable player", () => {
  const kernel = world().build();
  const run = runInstruction(score, { ...amount(1), player: literal("missing") }, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.deepEqual(run.linked.scored, []);
  assert.deepEqual(run.events, []);
});

test("effect.score suspends a recipient choice and deterministically replays exactly one award", () => {
  const kernel = world(115).build();
  const args = { ...amount(2), player: choose(["B", "A", "B"]) };
  const before = kernel.stateForTest();
  const asked = runInstruction(score, args, { world: kernel });
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.deepEqual(asked.asked.request, {
    id: "score-recipient", type: "mode", chooser: "A", visibility: "public", options: ["B", "A"]
  });
  assert.equal(asked.result, null);
  assert.deepEqual(asked.linked, {});
  assert.deepEqual(kernel.stateForTest(), before);
  const answered = runInstruction(score, args, { world: kernel, answers: { "score-recipient": "B" } });
  const replayWorld = world(115).build();
  const replayed = runInstruction(score, args, { world: replayWorld, answers: { "score-recipient": "B" } });
  assert.equal(answered.result.status, "executed");
  assert.deepEqual(answered.linked.scored, [{ player: "B", amount: 2 }]);
  assert.equal(kernel.history({ action: "score" }), 1);
  assert.deepEqual(answered.result, replayed.result);
  assert.deepEqual(kernel.stateForTest(), replayWorld.stateForTest());
});

for (const answer of ["missing", null, ["A", "B"]]) {
  test("effect.score rejects a recipient answer outside its options: " + JSON.stringify(answer), () => {
    const kernel = world().build();
    const run = runInstruction(score, { ...amount(1), player: choose(["A", "B"]) }, {
      world: kernel, answers: { "score-recipient": answer }
    });
    assert.equal(run.result.status, "negated");
    assert.equal(kernel.history({ action: "score" }), 0);
    assert.deepEqual(run.linked.scored, []);
  });
}

test("effect.score avoids a prompt for one distinct candidate; none is impossible", () => {
  const kernel = world().build();
  const one = runInstruction(score, { ...amount(1), player: choose(["B", "B"]) }, { world: kernel });
  assert.equal(one.result.status, "executed");
  assert.equal(one.asked, null);
  assert.equal(kernel.player("B").score, 1);
  const none = runInstruction(score, { ...amount(1), player: choose([]) }, { world: kernel });
  assert.equal(none.result.status, "negated");
  assert.equal(none.asked, null);
});

test("effect.score schema rejects malformed IR and non-finite/cyclic values", () => {
  const cyclic = {}; cyclic.self = cyclic;
  for (const args of [null, [], {}, { ...amount(1), bogus: literal(true) },
    amount(Infinity), amount(NaN), amount(cyclic),
    { amount: { kind: "literal" } }, { amount: { kind: "unknown" } },
    { amount: { kind: "arithmetic", operator: "sub", operands: [literal(1)] } }
  ]) assert.throws(() => score.argsSchema.parse(args), TypeError);
});

test("effect.score rejects malformed recipient selectors and empty linked keys", () => {
  for (const args of [
    { ...amount(1), player: literal({ kind: "target", id: "" }) },
    { ...amount(1), player: literal({ kind: "choose", id: "choice", options: [1] }) },
    { ...amount(1), player: literal({ kind: "other", id: "choice" }) },
    { ...amount(1), linkKey: literal(" ") }
  ]) assert.throws(() => runInstruction(score, args, { world: world().build() }), TypeError);
});

test("ogn-205-298 Yasuo: third-move gain can be the Final Point without Conquer or drawing", () => {
  // "The third time I move in a turn, you score 1 point." The trigger's
  // movement prerequisite is evaluated by the interpreter, not effect.score.
  const kernel = world().player("A", { score: 7 }).unit("yasuo", {
    cardId: "ogn-205-298", location: { type: "base", player: "A" }
  }).deck("undrawn").build();
  const body = [
    { id: "third", op: "condition.history", args: {
      query: literal({ scope: "turn", action: "move-location", object: kernel.ref("yasuo") }),
      operator: literal("eq"), right: literal(3)
    } },
    { id: "gain", op: "effect.score", args: amount(1), condition: {
      kind: "expression", value: { kind: "linked-value", instructionId: "third", key: "value" }
    } }
  ];
  for (const id of ["one", "two"]) {
    assert.equal(kernel.perform({ type: "move-location", object: kernel.ref("yasuo"), to: battlefield(id) }).status, "done");
  }
  resolveBody(body, kernel);
  assert.equal(kernel.player("A").score, 7);
  assert.equal(kernel.perform({ type: "move-location", object: kernel.ref("yasuo"), to: battlefield("three") }).status, "done");
  const resolved = resolveBody(body, kernel);
  assert.equal(resolved.outcome.status, "executed");
  assert.equal(kernel.player("A").score, 8);
  assert.deepEqual(resolved.linked["gain.scored"], [{ player: "A", amount: 1 }]);
  assert.equal(kernel.history({ action: "score" }), 1);
  assert.equal(kernel.history({ action: "draw" }), 0);
  assert.equal(kernel.history({ action: "win" }), 0);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(resolved.events.map(event => event.action), ["score"]);
});

test("ogn-290-298 The Arena's Greatest: that player gains 1, independently of battlefield controller", () => {
  // "At the start of each player's first Beginning Phase, that player gains
  // 1 point." The phase trigger supplies that player's non-target identity;
  // this tests its resolving gain instruction, not a synthetic turn advance.
  const kernel = world().player("B", { score: 7 }).object("arena", {
    cardId: "ogn-290-298", types: ["battlefield"], zone: "board",
    owner: "A", controller: "A", energy: null, power: null
  }).build().clone({ timingPoint: "beginning-start" });
  const run = resolveBody([{ id: "arena-gain", op: "effect.score", args: {
    ...amount(1), player: pick("turn-player")
  } }], kernel, { picks: { "turn-player": ["B"] } });
  assert.equal(run.outcome.status, "executed");
  assert.equal(kernel.player("A").score, 0);
  assert.equal(kernel.player("B").score, 8);
  assert.deepEqual(run.linked["arena-gain.scored"], [{ player: "B", amount: 1 }]);
  assert.equal(kernel.getObject("arena").energy, null);
  assert.equal(kernel.getObject("arena").power, null);
  assert.equal(kernel.history({ action: "win" }), 0);
});

test("effect.score choice replay rolls back earlier body awards and scopes request ids", () => {
  const kernel = world().build();
  const before = kernel.stateForTest();
  const body = [
    { id: "first", op: "effect.score", args: amount(1) },
    { id: "second", op: "effect.score", args: { ...amount(2), player: choose(["A", "B"]) } }
  ];
  const asked = resolveBody(body, kernel);
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.equal(asked.asked.request.id, "second/score-recipient");
  assert.deepEqual(kernel.stateForTest(), before);
  assert.deepEqual(asked.linked, {});
  const answered = resolveBody(body, kernel, { answers: { "second/score-recipient": "B" } });
  assert.equal(answered.outcome.status, "executed");
  assert.equal(kernel.player("A").score, 1);
  assert.equal(kernel.player("B").score, 2);
  assert.equal(kernel.history({ action: "score" }), 2);
});
