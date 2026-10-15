import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_OPTIONS_CONTRACT,
  FOUNDATION_RULESET_ID,
  PROJECTION_SCHEMA_V1,
  PROTOCOL_VERSION,
  isGameProjection,
  isServerMessage
} from "../dist/index.js";

const emptyPolicy = { minTargets: 0, maxTargets: 0, options: [] };

function fixture() {
  return {
    projectionSchema: PROJECTION_SCHEMA_V1,
    rulesetId: FOUNDATION_RULESET_ID,
    version: 4,
    eventSeq: 1,
    phase: "main",
    turnNumber: 1,
    activePlayerId: "alice",
    priority: { playerId: "alice" },
    winnerPlayerId: null,
    prompt: null,
    waitingForPlayerId: null,
    players: [
      {
        id: "alice", name: "Alice", score: 0, energy: 2, power: {},
        handCount: 2,
        hand: [
          { instanceId: "alice:one", cardId: "fixture.strike" },
          { instanceId: "alice:two", cardId: "fixture.strike" }
        ],
        zoneCounts: { hand: 2, deck: 10 },
        playableInstanceIds: ["alice:one", "alice:two"]
      },
      {
        id: "bob", name: "Bob", score: 0, energy: 1, power: {},
        handCount: 4, hand: [], zoneCounts: { hand: 4, deck: 10 },
        playableInstanceIds: []
      }
    ],
    objects: [
      ...["alice:one", "alice:two"].map(objectId => ({
        objectId, cardId: "fixture.strike", zone: "hand",
        ownerPlayerId: "alice", controllerId: "alice", faceUp: true
      })),
      {
        objectId: "bob:public", cardId: "fixture.unit", zone: "board",
        ownerPlayerId: "bob", controllerId: "bob", faceUp: true
      }
    ],
    events: [{
      type: "game-started", seq: 1, turnNumber: 1,
      activePlayerId: "alice", playerIds: ["alice", "bob"]
    }],
    actionOptions: {
      contract: ACTION_OPTIONS_CONTRACT,
      stateVersion: 4,
      viewerPlayerId: "alice",
      actions: [
        { id: "pass", command: { type: "pass" }, enabled: true, targetPolicy: emptyPolicy },
        {
          id: "play:alice:one", command: { type: "play-card", instanceId: "alice:one" },
          enabled: true,
          targetPolicy: {
            minTargets: 1, maxTargets: 1,
            options: [{ kind: "object", objectId: "bob:public" }]
          }
        },
        {
          id: "play:alice:two", command: { type: "play-card", instanceId: "alice:two" },
          enabled: false, blockedReason: "judge-required", targetPolicy: emptyPolicy
        },
        { id: "concede", command: { type: "concede" }, enabled: true, targetPolicy: emptyPolicy }
      ]
    }
  };
}

test("the new public wire version carries instance-specific authoritative actions", () => {
  assert.equal(PROTOCOL_VERSION, "0.2.1");
  const projection = fixture();
  assert.equal(isGameProjection(projection), true);
  assert.equal(isServerMessage({ type: "projection", roomId: "room", projection }), true);
  const { actionOptions, ...legacyProjection } = projection;
  assert.equal(isGameProjection(legacyProjection), true);
  assert.equal(actionOptions.actions[1].targetPolicy.minTargets, 1);
  assert.equal(actionOptions.actions[2].enabled, false);
});

test("action metadata rejects stale versions, actor injection and invisible instances", () => {
  for (const mutate of [
    p => { p.actionOptions.stateVersion -= 1; },
    p => { p.actionOptions.viewerPlayerId = "outsider"; },
    p => { p.actionOptions.viewerPlayerId = "bob"; },
    p => { p.actionOptions.actions[1].command.playerId = "bob"; },
    p => { p.actionOptions.actions[1].command.instanceId = "bob:hidden"; },
    p => { p.actionOptions.actions[1].command.targets = [{ kind: "object", objectId: "bob:public" }]; },
    p => { p.actionOptions.actions[1].targetPolicy.options[0].objectId = "bob:hidden"; },
    p => { p.actionOptions.actions[1].targetPolicy.options[0].objectId = "alice:one"; },
    p => { p.actionOptions.actions[1].targetPolicy.options.push(p.actionOptions.actions[1].targetPolicy.options[0]); },
    p => { p.actionOptions.actions[1].targetPolicy.maxTargets = 2; },
    p => { p.actionOptions.actions[1].targetPolicy.minTargets = 2; },
    p => { p.actionOptions.actions[1].id = "pass"; },
    p => { p.actionOptions.actions[2].enabled = true; },
    p => { delete p.actionOptions.actions[2].blockedReason; }
  ]) {
    const projection = structuredClone(fixture());
    mutate(projection);
    assert.equal(isGameProjection(projection), false);
  }
});

test("malformed action metadata is rejected without throwing", () => {
  for (const value of [null, [], {}, { ...fixture().actionOptions, actions: null }]) {
    assert.equal(isGameProjection({ ...fixture(), actionOptions: value }), false);
  }
  for (const action of [null, {}, { ...fixture().actionOptions.actions[1], targetPolicy: null }]) {
    const projection = structuredClone(fixture());
    projection.actionOptions.actions = [action];
    assert.equal(isGameProjection(projection), false);
  }
  assert.equal(isGameProjection({ ...fixture(), objects: null }), false);
});

test("a single-target action can offer more targets than the command selection limit", () => {
  const projection = structuredClone(fixture());
  const targets = Array.from({ length: 40 }, (_, index) => ({
    objectId: `board:${index}`, cardId: "fixture.unit", zone: "board",
    ownerPlayerId: "bob", controllerId: "bob", faceUp: true
  }));
  projection.objects.push(...targets);
  projection.actionOptions.actions[1].targetPolicy.options = targets.map(object => ({
    kind: "object", objectId: object.objectId
  }));
  assert.equal(isGameProjection(projection), true);
});

test("an opposing prompt permits concession but cannot authorize a pass or prompt response", () => {
  const projection = structuredClone(fixture());
  projection.waitingForPlayerId = "bob";
  projection.actionOptions.actions = [projection.actionOptions.actions[3]];
  assert.equal(isGameProjection(projection), true);
  projection.actionOptions.actions.push(fixture().actionOptions.actions[0]);
  assert.equal(isGameProjection(projection), false);
  projection.actionOptions.actions = [{
    id: "hidden:answer", command: {
      type: "respond-to-prompt", promptId: "hidden", optionId: "answer", stateVersion: 4
    }, enabled: true, targetPolicy: emptyPolicy
  }];
  assert.equal(isGameProjection(projection), false);
});

test("spectator and finished projections have no actionable commands", () => {
  const spectator = structuredClone(fixture());
  spectator.players[0].hand = [];
  spectator.players[0].playableInstanceIds = [];
  spectator.objects = spectator.objects.filter(object => object.zone !== "hand");
  spectator.actionOptions.viewerPlayerId = null;
  spectator.actionOptions.actions = [];
  assert.equal(isGameProjection(spectator), true);
  spectator.actionOptions.actions = [fixture().actionOptions.actions[3]];
  assert.equal(isGameProjection(spectator), false);

  const ended = structuredClone(fixture());
  ended.phase = "ended";
  ended.winnerPlayerId = "bob";
  ended.actionOptions.actions = [];
  assert.equal(isGameProjection(ended), true);
  ended.actionOptions.actions = [fixture().actionOptions.actions[3]];
  assert.equal(isGameProjection(ended), false);
});
