import assert from "node:assert/strict";
import test from "node:test";
import { bindTurnHistory, evaluateExtendedExpression } from "../../../../dist/effects/interpreter/expr-ext/index.js";
import { fixture } from "../../../turn/helpers.mjs";
import { environment } from "./helpers.mjs";

test("turn expressions follow the actual full turn driver, including each player's third turn", () => {
  const f = fixture();
  const context = bindTurnHistory(f.kernel, f.flow.chain.pipeline);
  const env = environment(context);
  const turns = () => [
    { kind: "turn-number" }, { kind: "player-turn-count" }, { kind: "player-turn-count", player: { id: "B" } }
  ].map(expr => evaluateExtendedExpression(expr, env));
  assert.deepEqual(turns(), [0, 0, 0]);
  f.flow.start();
  assert.deepEqual(turns(), [1, 1, 0]);
  f.flow.endTurn("A");
  assert.deepEqual(turns(), [2, 1, 1]);
  f.flow.endTurn("B");
  assert.deepEqual(turns(), [3, 2, 1]);
  f.flow.endTurn("A");
  assert.deepEqual(turns(), [4, 2, 2]);
  f.flow.endTurn("B");
  assert.deepEqual(turns(), [5, 3, 2]);
  assert.deepEqual(f.flow.chain.pipeline.events.filter(event => event.timingPoint === "turn-start").map(event => event.player), ["A", "B", "A", "B", "A"]);
});

test("the turn-history binding delegates unrelated history and validates explicit players", () => {
  const f = fixture();
  const context = bindTurnHistory(f.kernel, f.flow.chain.pipeline);
  assert.equal(context.perform({ type: "gain-energy", player: "A", amount: 1 }).status, "done");
  assert.equal(context.history({ scope: "game", action: "gain-energy", player: "A" }), 1);
  const query = { scope: "game", timingPoint: "turn-start", action: "gain-energy" };
  assert.equal(context.history(query), f.kernel.history(query));
  assert.throws(() => evaluateExtendedExpression({ kind: "player-turn-count", player: { id: "missing" } }, environment(context)));
});

test("turn expression evaluation leaves the pipeline and player state unchanged", () => {
  const f = fixture();
  f.flow.start();
  const beforeEvents = f.flow.chain.pipeline.events;
  const beforeState = f.kernel.snapshot();
  const context = bindTurnHistory(f.kernel, f.flow.chain.pipeline);
  evaluateExtendedExpression({ kind: "turn-number" }, environment(context));
  evaluateExtendedExpression({ kind: "player-turn-count" }, environment(context));
  assert.deepEqual(f.flow.chain.pipeline.events, beforeEvents);
  assert.deepEqual(f.kernel.snapshot(), beforeState);
});
