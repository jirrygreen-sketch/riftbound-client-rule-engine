import assert from "node:assert/strict";
import test from "node:test";
import {
  createFullProductEffectRegistry,
  executeFullProductEffect,
  resumeFullProductEffectAfterPrompt
} from "../../dist/full-product/index.js";

function baseState() {
  return {
    schemaVersion: 1,
    players: [{
      playerId: "player.self",
      energy: 2,
      score: 0,
      deck: ["instance.deck-1", "instance.deck-2"],
      hand: [],
      discard: [],
      chain: []
    }],
    objects: {
      "instance.source": {
        objectId: "instance.source",
        ownerPlayerId: "player.self",
        zone: "hand"
      }
    }
  };
}

function ir(body) {
  return {
    kind: "full-product-effect-ir",
    schemaVersion: 1,
    ruleset: "full-product",
    id: "card.runtime-sample",
    body
  };
}

test("executes all basic full-product opcodes transactionally", () => {
  const input = ir([{
    type: "trigger",
    id: "card.runtime-sample.trigger",
    event: "effect.execute",
    body: [
      { type: "effect", id: "card.runtime-sample.cost", opcode: "cost.energy", args: { amount: 1 } },
      { type: "effect", id: "card.runtime-sample.draw", opcode: "draw.cards", args: { count: 2 } },
      { type: "effect", id: "card.runtime-sample.energy", opcode: "gain.energy", args: { amount: 3 } },
      { type: "effect", id: "card.runtime-sample.score", opcode: "gain.score", args: { amount: 4 } },
      { type: "effect", id: "card.runtime-sample.chain", opcode: "chain.create", args: { count: 1 } }
    ]
  }]);
  const original = baseState();
  const result = executeFullProductEffect(input, original, {
    sourcePlayerId: "player.self"
  });

  assert.equal(result.status, "completed");
  assert.equal(result.state.players[0].energy, 4);
  assert.equal(result.state.players[0].score, 4);
  assert.deepEqual(result.state.players[0].hand, ["instance.deck-1", "instance.deck-2"]);
  assert.deepEqual(result.state.players[0].deck, []);
  assert.deepEqual(result.state.players[0].chain, ["chain:1"]);
  assert.equal(original.players[0].energy, 2);
  assert.deepEqual(original.players[0].hand, []);
  assert.deepEqual(result.events.map(event => event.type), [
    "energy-spent",
    "cards-drawn",
    "energy-gained",
    "score-gained",
    "chain-items-created"
  ]);
});

test("moves source object to discard", () => {
  const input = ir([{
    type: "effect",
    id: "card.runtime-sample.move",
    opcode: "move.zone",
    args: { zone: "discard" }
  }]);
  const original = baseState();
  const result = executeFullProductEffect(input, original, {
    sourcePlayerId: "player.self",
    sourceObjectId: "instance.source"
  });

  assert.equal(result.status, "completed");
  assert.equal(result.state.objects["instance.source"].zone, "discard");
  assert.deepEqual(result.state.players[0].discard, ["instance.source"]);
  assert.equal(original.objects["instance.source"].zone, "hand");
  assert.deepEqual(result.events, [{
    type: "object-moved",
    objectId: "instance.source",
    from: "hand",
    to: "discard"
  }]);
});

test("blocks on insufficient energy and preserves input state", () => {
  const input = ir([{
    type: "effect",
    id: "card.runtime-sample.cost",
    opcode: "cost.energy",
    args: { amount: 3 }
  }]);
  const original = baseState();
  const result = executeFullProductEffect(input, original, {
    sourcePlayerId: "player.self"
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.error.code, "insufficient-energy");
  assert.equal(result.state.players[0].energy, 2);
  assert.equal(original.players[0].energy, 2);
});

test("blocks on an empty deck and rejects unknown players, objects, and moves", () => {
  const emptyDeck = ir([{
    type: "effect",
    id: "card.runtime-sample.draw",
    opcode: "draw.cards",
    args: { count: 3 }
  }]);
  const emptyDeckResult = executeFullProductEffect(emptyDeck, baseState(), {
    sourcePlayerId: "player.self"
  });
  assert.equal(emptyDeckResult.status, "blocked");
  assert.equal(emptyDeckResult.error.code, "empty-deck");

  const missingPlayer = ir([{
    type: "effect",
    id: "card.runtime-sample.draw",
    opcode: "draw.cards",
    args: { count: 1 }
  }]);
  const missingPlayerResult = executeFullProductEffect(missingPlayer, baseState(), {
    sourcePlayerId: "player.missing"
  });
  assert.equal(missingPlayerResult.status, "blocked");
  assert.equal(missingPlayerResult.error.code, "missing-player");

  const missingObject = ir([{
    type: "effect",
    id: "card.runtime-sample.move",
    opcode: "move.zone",
    args: { zone: "discard" }
  }]);
  const missingObjectResult = executeFullProductEffect(missingObject, baseState(), {
    sourcePlayerId: "player.self",
    sourceObjectId: "instance.missing"
  });
  assert.equal(missingObjectResult.status, "blocked");
  assert.equal(missingObjectResult.error.code, "missing-object");

  const alreadyDiscarded = baseState();
  alreadyDiscarded.objects["instance.source"].zone = "discard";
  const invalidMove = ir([{
    type: "effect",
    id: "card.runtime-sample.move",
    opcode: "move.zone",
    args: { zone: "discard" }
  }]);
  const invalidMoveResult = executeFullProductEffect(invalidMove, alreadyDiscarded, {
    sourcePlayerId: "player.self",
    sourceObjectId: "instance.source"
  });
  assert.equal(invalidMoveResult.status, "blocked");
  assert.equal(invalidMoveResult.error.code, "invalid-move");
});

test("pauses on target prompt and resumes without replaying earlier effects", () => {
  const input = ir([
    {
      type: "target",
      id: "card.runtime-sample.target",
      placeholder: "selected-target",
      minCount: 1,
      maxCount: 1
    },
    {
      type: "trigger",
      id: "card.runtime-sample.trigger",
      event: "effect.execute",
      body: [
        { type: "effect", id: "card.runtime-sample.energy", opcode: "gain.energy", args: { amount: 1 } },
        {
          type: "effect",
          id: "card.runtime-sample.prompt",
          opcode: "prompt.target",
          args: { prompt: "Choose a target" },
          targetId: "card.runtime-sample.target"
        },
        { type: "effect", id: "card.runtime-sample.score", opcode: "gain.score", args: { amount: 5 } }
      ]
    }
  ]);
  const original = baseState();
  const paused = executeFullProductEffect(input, original, {
    sourcePlayerId: "player.self"
  });
  assert.equal(paused.status, "awaitingPrompt");
  assert.equal(paused.error.code, "prompt-required");
  assert.equal(paused.state.players[0].energy, 3);
  assert.deepEqual(paused.state.pending, [{
    sourceIrId: "card.runtime-sample",
    targetId: "card.runtime-sample.target",
    prompt: "Choose a target",
    remainingNodeIds: ["card.runtime-sample.score"]
  }]);

  const resumed = resumeFullProductEffectAfterPrompt(input, paused.state, {
    sourcePlayerId: "player.self"
  }, {
    targetId: "card.runtime-sample.target",
    objectIds: ["instance.source"]
  });
  assert.equal(resumed.status, "completed");
  assert.equal(resumed.state.players[0].energy, 3);
  assert.equal(resumed.state.players[0].score, 5);
  assert.deepEqual(resumed.state.pending, []);
  assert.equal(resumed.events[0].type, "score-gained");
});

test("blocks judge-required effects and rejects invalid target selections", () => {
  const judge = ir([{
    type: "effect",
    id: "card.runtime-sample.judge",
    opcode: "judge.required",
    args: { reason: "Official semantics are not verified." }
  }]);
  const judgeResult = executeFullProductEffect(judge, baseState(), {
    sourcePlayerId: "player.self"
  });
  assert.equal(judgeResult.status, "blocked");
  assert.equal(judgeResult.error.code, "judge-required");
  assert.equal(judgeResult.error.message, "Official semantics are not verified.");

  const input = ir([
    {
      type: "target",
      id: "card.runtime-sample.target",
      placeholder: "selected-target",
      minCount: 1,
      maxCount: 1
    },
    {
      type: "effect",
      id: "card.runtime-sample.prompt",
      opcode: "prompt.target",
      args: { prompt: "Choose a target" },
      targetId: "card.runtime-sample.target"
    }
  ]);
  const result = executeFullProductEffect(input, baseState(), {
    sourcePlayerId: "player.self",
    targetSelections: {
      "card.runtime-sample.target": {
        targetId: "card.runtime-sample.target",
        objectIds: []
      }
    }
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.error.code, "unknown-action");
});

test("registers card effects for future per-card integration", () => {
  const registry = createFullProductEffectRegistry();
  const input = ir([{
    type: "effect",
    id: "card.runtime-sample.draw",
    opcode: "draw.cards",
    args: { count: 1 }
  }]);
  const registered = registry.registerCardEffect("card.runtime-sample", input);
  assert.equal(registered.ir.id, "card.runtime-sample");
  assert.equal(registry.has("card.runtime-sample"), true);
  assert.deepEqual(registry.listCardIds(), ["card.runtime-sample"]);

  assert.throws(() => registry.registerCardEffect("card.runtime-sample", input), /already registered/);
  assert.throws(
    () => registry.registerCardEffect("card.other", input),
    /does not match card id/
  );
});
