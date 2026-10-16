import assert from "node:assert/strict";
import test from "node:test";
import win from "../../../src/effects/instructions/effect.win.ts";
import { runAbilityBody } from "../../../dist/effects/interpreter.js";
import { AwaitChoice, runInstruction, world } from "../../../src/effects/testing/index.ts";

const literal = value => ({ kind: "literal", value });
const target = id => literal({ kind: "target", id });
const pick = id => literal({ kind: "pick", id });
const choose = (options, id = "winning-player") => literal({ kind: "choose", id, options });
const location = id => ({ type: "battlefield", id });
const count = filter => ({ kind: "count", subject: "objects", filter });
const compare = (left, operator, value) => ({ kind: "compare", left, operator, right: literal(value) });

// Run actual EffectIR through the interpreter inside the reference kernel's
// transaction. The primitive remains responsible for the only winning action.
function resolveBody(body, kernel, options = {}) {
  let outcome;
  const run = runInstruction({
    op: "test.win-body",
    argsSchema: { parse: value => value },
    execute(ctx) {
      outcome = runAbilityBody(body, ctx);
      return outcome.status === "executed" ? { status: "executed", events: [...outcome.events] } :
        { status: "negated", reason: "skipped", events: [...outcome.events] };
    }
  }, {}, { world: kernel, ...options });
  return { ...run, outcome };
}

function conditionalWin(condition) {
  return [
    { id: "qualify", op: "condition.predicate", args: { condition: literal(condition) } },
    {
      id: "victory", op: "effect.win", args: { player: literal("A") },
      condition: compare({ kind: "linked-value", instructionId: "qualify", key: "value" }, "eq", true)
    }
  ];
}

test("effect.win declares the controller without awarding points or rewriting null printed costs", () => {
  const kernel = world().object("plaza", { types: ["battlefield"], energy: null, power: null }).build();
  const run = runInstruction(win, {}, { world: kernel });
  assert.equal(win.op, "effect.win");
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked, { winner: "A" });
  assert.deepEqual(run.result.linkedValues, { winner: "A" });
  assert.deepEqual(run.events.map(event => event.action), ["win"]);
  assert.equal(kernel.history({ action: "win", player: "A" }), 1);
  assert.equal(kernel.history({ action: "score" }), 0);
  assert.equal(kernel.player("A").score, 0);
  assert.equal(kernel.player("B").score, 0);
  assert.equal(kernel.getObject("plaza").energy, null);
  assert.equal(kernel.getObject("plaza").power, null);
});

test("effect.win can name a player below the Victory Score even while an opponent has more points", () => {
  const kernel = world().player("A", { score: 10 }).build();
  const run = runInstruction(win, { player: literal("B"), linkKey: literal("actualWinner") }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked, { actualWinner: "B" });
  assert.equal(kernel.history({ action: "win", player: "B" }), 1);
  assert.equal(kernel.player("A").score, 10);
  assert.equal(kernel.player("B").score, 0);
});

test("effect.win defaults to the supplied ability controller rather than player A", () => {
  const kernel = world().build().clone({ controller: "B" });
  const run = runInstruction(win, {}, { world: kernel });
  assert.equal(run.linked.winner, "B");
  assert.equal(kernel.history({ action: "win", player: "B" }), 1);
});

test("effect.win evaluates a linked player Expr", () => {
  const run = runInstruction(win, {
    player: { kind: "linked-value", instructionId: "previous", key: "selectedPlayer" }
  }, { world: world().build(), linked: { selectedPlayer: "B" } });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.winner, "B");
});

for (const status of ["replaced", "prevented", "impossible"]) {
  test("effect.win returns negated when the win action is " + status, () => {
    const kernel = world().build();
    kernel.addReplacement(action => action.type === "win" ? status : null);
    const run = runInstruction(win, {}, { world: kernel, linked: { winner: "obsolete" } });
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, status === "replaced" ? "replaced" : status === "prevented" ? "skipped" : "impossible");
    assert.equal(run.events[0].outcome, status);
    assert.deepEqual(run.result.events, run.events);
    assert.equal(run.linked.winner, null);
    assert.equal(kernel.history({ action: "win" }), 0);
    assert.equal(kernel.history({ action: "score" }), 0);
  });
}

test("effect.win passes an unavailable player to the authoritative action and links no winner", () => {
  const kernel = world().build();
  const run = runInstruction(win, { player: literal("missing") }, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.events[0].outcome, "impossible");
  assert.equal(run.linked.winner, null);
  assert.equal(kernel.history({ action: "win" }), 0);
});

test("effect.win ignores stale targets even after the same object returns to the board", () => {
  const kernel = world().unit("unit").build();
  const stale = kernel.ref("unit");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  assert.equal(kernel.perform({ type: "move-zone", object: kernel.ref("unit"), to: "battlefield" }).status, "done");
  const before = kernel.stateForTest();
  const run = runInstruction(win, { player: target("controller") }, {
    world: kernel, targets: { controller: [stale] }
  });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.events, []);
  assert.deepEqual(run.linked, {});
  assert.deepEqual(kernel.stateForTest(), before);
});

test("effect.win ignores an empty target group without choosing a default winner", () => {
  const run = runInstruction(win, { player: target("gone") }, { world: world().build() });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.linked, {});
  assert.deepEqual(run.events, []);
});

test("effect.win uses the controller of the surviving target and ignores its stale peers", () => {
  const kernel = world().unit("unit", { owner: "A", controller: "B" }).build();
  const run = runInstruction(win, { player: target("controller") }, {
    world: kernel, targets: { controller: [{ id: "gone", zoneEntryId: 1 }, kernel.ref("unit")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.winner, "B");
  assert.equal(kernel.history({ action: "win", player: "B" }), 1);
});

test("effect.win deduplicates multiple targets controlled by the same player", () => {
  const kernel = world().unit("one").unit("two").build();
  const run = runInstruction(win, { player: target("controller") }, {
    world: kernel, targets: { controller: [kernel.ref("one"), kernel.ref("two"), kernel.ref("one")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.events.length, 1);
  assert.equal(kernel.history({ action: "win" }), 1);
});

test("effect.win rejects multiple distinct targeted players instead of performing sequential wins", () => {
  const kernel = world().unit("one").unit("two", { owner: "B" }).build();
  const run = runInstruction(win, { player: target("controller") }, {
    world: kernel, targets: { controller: [kernel.ref("one"), kernel.ref("two")] }
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked.winner, null);
  assert.equal(kernel.history({ action: "win" }), 0);
  assert.deepEqual(run.events, []);
});

test("effect.win reads PlayerId picks as non-target selections and deduplicates them", () => {
  const kernel = world().build();
  const run = runInstruction(win, { player: pick("recipient") }, {
    world: kernel, picks: { recipient: ["B", "B"] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.winner, "B");
  assert.deepEqual(run.events.map(event => event.action), ["win"]);
});

for (const picks of [[], ["A", "B"], [{ id: "unit", zoneEntryId: 1 }]]) {
  test("effect.win negates an empty, ambiguous, or non-player pick " + JSON.stringify(picks), () => {
    const run = runInstruction(win, { player: pick("recipient") }, {
      world: world().build(), picks: { recipient: picks }
    });
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, "impossible");
    assert.equal(run.linked.winner, null);
    assert.deepEqual(run.events, []);
  });
}

test("effect.win with zero choice candidates is impossible without a prompt", () => {
  const run = runInstruction(win, { player: choose([]) }, { world: world().build() });
  assert.equal(run.result.status, "negated");
  assert.equal(run.linked.winner, null);
  assert.equal(run.asked, null);
  assert.deepEqual(run.events, []);
});

test("effect.win with one distinct choice candidate needs no prompt", () => {
  const run = runInstruction(win, { player: choose(["B", "B"]) }, { world: world().build() });
  assert.equal(run.result.status, "executed");
  assert.equal(run.asked, null);
  assert.equal(run.linked.winner, "B");
  assert.equal(run.events.length, 1);
});

test("effect.win suspends a multi-player choice and deterministically replays its answer", () => {
  const kernel = world(116).build();
  const args = { player: choose(["B", "A", "B"]) };
  const before = kernel.stateForTest();
  const asked = runInstruction(win, args, { world: kernel });
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.deepEqual(asked.asked.request, {
    id: "winning-player", type: "mode", chooser: "A", visibility: "public", options: ["B", "A"]
  });
  assert.equal(asked.result, null);
  assert.deepEqual(asked.linked, {});
  assert.deepEqual(kernel.stateForTest(), before);
  const answered = runInstruction(win, args, { world: kernel, answers: { "winning-player": "B" } });
  const replayWorld = world(116).build();
  const replayed = runInstruction(win, args, { world: replayWorld, answers: { "winning-player": "B" } });
  assert.equal(answered.result.status, "executed");
  assert.equal(answered.linked.winner, "B");
  assert.equal(kernel.history({ action: "win" }), 1);
  assert.deepEqual(answered.result, replayed.result);
  assert.deepEqual(kernel.stateForTest(), replayWorld.stateForTest());
});

for (const answer of ["C", null, ["A", "B"]]) {
  test("effect.win rejects a choice answer outside the single-player options: " + JSON.stringify(answer), () => {
    const kernel = world().build();
    const run = runInstruction(win, { player: choose(["A", "B"]) }, {
      world: kernel, answers: { "winning-player": answer }
    });
    assert.equal(run.result.status, "negated");
    assert.equal(run.linked.winner, null);
    assert.deepEqual(run.events, []);
    assert.equal(kernel.history({ action: "win" }), 0);
  });
}

test("effect.win rejects unsupported loss/count modes and malformed arguments before actions", () => {
  const invalid = [null, [], { lose: literal("A") }, { amount: literal(0) },
    { player: { kind: "unknown" } }, { player: { kind: "literal" } }, { linkKey: 1 }];
  for (const args of invalid) {
    const kernel = world().build();
    assert.throws(() => runInstruction(win, args, { world: kernel }), TypeError);
    assert.deepEqual(kernel.events, []);
    assert.equal(kernel.history({ action: "win" }), 0);
  }
  for (const args of [{ player: literal({ kind: "lose", id: "A" }) },
    { player: choose(["A", ""]) }, { linkKey: literal("") }]) {
    assert.throws(() => runInstruction(win, args, { world: world().build() }), TypeError);
  }
});

for (const value of [null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER, []]) {
  test("effect.win never coerces a non-player expression into a winner: " + JSON.stringify(value), () => {
    const run = runInstruction(win, { player: literal(value) }, { world: world().build() });
    assert.equal(run.result.status, "negated");
    assert.equal(run.linked.winner, null);
    assert.deepEqual(run.events, []);
  });
}

for (const units of [6, 7, 8]) {
  test("ogn-293-298 The Grand Plaza: resolved hold ability requires 7+ friendly units here (" + units + ")", () => {
    // Card text: When you hold here, if you have 7+ units here, you win the game.
    // Hold timing is supplied by the caller; the actual predicate gates win.
    const plaza = location("plaza");
    const builder = world().object("plaza", { types: ["battlefield"], zone: "board", location: plaza, energy: null, power: null });
    for (let index = 0; index < units; index++) builder.unit("friendly-" + index, { location: plaza });
    const kernel = builder.base("base-unit").unit("elsewhere", { location: location("other") })
      .unit("enemy", { owner: "B", location: plaza }).build();
    const condition = compare(count({ type: "unit", zone: "board", controller: "A", location: plaza }), "gte", 7);
    const run = resolveBody(conditionalWin(condition), kernel);
    assert.equal(run.outcome.results[1].result.status, units >= 7 ? "executed" : "negated");
    assert.equal(kernel.history({ action: "win" }), units >= 7 ? 1 : 0);
    assert.deepEqual(run.events.map(event => event.action), units >= 7 ? ["win"] : []);
    assert.equal(run.linked["victory.winner"], units >= 7 ? "A" : undefined);
    assert.equal(kernel.player("A").score, 0);
    assert.equal(kernel.getObject("plaza").energy, null);
    assert.equal(kernel.getObject("plaza").power, null);
  });
}

for (const [hand, units] of [[4, 4], [3, 4], [5, 4], [4, 3], [4, 5]]) {
  test("unl-088-219 Gutter Palace: Beginning trigger requires exactly four cards and four battlefield units (" + hand + ", " + units + ")", () => {
    // Card text: At the start of your Beginning Phase, if you have exactly 4
    // cards in hand and exactly 4 units at battlefields, you win the game.
    // The activated discard/exhaust/token ability is a separate instruction.
    const fields = ["battlefield-1", "battlefield-2", "battlefield-3"];
    const builder = world().base("palace", { types: ["gear"], energy: 4, power: null });
    for (let index = 0; index < hand; index++) builder.hand("card-" + index);
    for (let index = 0; index < units; index++) builder.unit("unit-" + index, { location: location(fields[index % fields.length]) });
    const kernel = builder.base("base-unit").unit("enemy", { owner: "B" }).hand("opponent-card", { owner: "B" }).build();
    const condition = {
      kind: "all", conditions: [
        compare(count({ zone: "hand", controller: "A" }), "eq", 4),
        compare({ kind: "arithmetic", operator: "add", operands: fields.map(id =>
          count({ type: "unit", zone: "board", controller: "A", location: location(id) })) }, "eq", 4)
      ]
    };
    const qualifies = hand === 4 && units === 4;
    const run = resolveBody(conditionalWin(condition), kernel);
    assert.equal(run.outcome.results[1].result.status, qualifies ? "executed" : "negated");
    assert.equal(kernel.history({ action: "win", player: "A" }), qualifies ? 1 : 0);
    assert.deepEqual(run.events.map(event => event.action), qualifies ? ["win"] : []);
    assert.equal(kernel.player("A").handSize, hand);
    assert.equal(kernel.player("A").score, 0);
    assert.equal(kernel.getObject("palace").power, null);
  });
}

test("effect.win works with evaluated Expr arguments and scoped choice ids through the real interpreter", () => {
  const kernel = world().build();
  const body = [{ id: "victory", op: "effect.win", args: { player: choose(["A", "B"]), linkKey: literal("champion") } }];
  const asked = resolveBody(body, kernel);
  assert.equal(asked.asked.request.id, "victory/winning-player");
  assert.equal(kernel.history({ action: "win" }), 0);
  const run = resolveBody(body, kernel, { answers: { "victory/winning-player": "B" } });
  assert.equal(run.outcome.results[0].result.status, "executed");
  assert.equal(run.linked["victory.champion"], "B");
  assert.equal(kernel.history({ action: "win", player: "B" }), 1);
});
