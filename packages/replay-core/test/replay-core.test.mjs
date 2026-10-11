import assert from "node:assert/strict";
import test from "node:test";
import {
  ReplayValidationError,
  isReplayEnvelope,
  parseReplay,
  serializeReplay,
  validateReplayEnvelope
} from "../dist/index.js";

function validReplay(overrides = {}) {
  return {
    rulesetId: "synthetic-demo",
    protocolVersion: "0.1.0",
    cardDataVersion: "cards-demo-1",
    seed: 12345,
    players: [
      { id: "player-1", name: "Player One" },
      { id: "player-2", name: "Player Two" }
    ],
    initialStateHash: null,
    initialEventHash: null,
    events: [
      {
        seq: 1,
        type: "game-started",
        data: { playerIds: ["player-1", "player-2"] }
      },
      {
        seq: 2,
        type: "turn-started",
        data: { playerId: "player-1", mana: 1 }
      },
      {
        seq: 3,
        type: "card-played",
        data: {
          playerId: "player-1",
          instanceId: "player-1:trigger-conquer",
          cardId: "card.trigger-conquer"
        }
      }
    ],
    ...overrides
  };
}

test("validates and normalizes a replay envelope", () => {
  const replay = validateReplayEnvelope(validReplay());

  assert.deepEqual(replay.players, [
    { id: "player-1", name: "Player One" },
    { id: "player-2", name: "Player Two" }
  ]);
  assert.deepEqual(replay.events.map((event) => event.seq), [1, 2, 3]);
  assert.equal(replay.initialStateHash, null);
  assert.equal(replay.initialEventHash, null);
  assert.equal(isReplayEnvelope(replay), true);
});

test("accepts string seeds and precomputed hash placeholders", () => {
  const hash = "a".repeat(64);
  const replay = validateReplayEnvelope(
    validReplay({
      seed: "seed-for-match-1",
      initialStateHash: hash,
      initialEventHash: hash
    })
  );

  assert.equal(replay.seed, "seed-for-match-1");
  assert.equal(replay.initialStateHash, hash);
  assert.equal(replay.initialEventHash, hash);
});

test("rejects unknown fields at every envelope level", () => {
  assert.throws(
    () => validateReplayEnvelope(validReplay({ hiddenHand: [] })),
    ReplayValidationError
  );
  assert.throws(
    () =>
      validateReplayEnvelope(
        validReplay({
          players: [
            { id: "player-1", name: "Player One", hand: [] },
            { id: "player-2", name: "Player Two" }
          ]
        })
      ),
    ReplayValidationError
  );
  assert.throws(
    () =>
      validateReplayEnvelope(
        validReplay({
          events: [
            {
              seq: 1,
              type: "game-started",
              data: { playerIds: ["player-1", "player-2"] },
              hiddenHand: []
            }
          ]
        })
      ),
    ReplayValidationError
  );
});

test("rejects out-of-order, duplicate, and non-contiguous event sequences", () => {
  const events = validReplay().events;

  assert.throws(
    () =>
      validateReplayEnvelope(
        validReplay({
          events: [events[0], { ...events[2], seq: 3 }, { ...events[1], seq: 2 }]
        })
      ),
    /contiguous/
  );
  assert.throws(
    () =>
      validateReplayEnvelope(
        validReplay({
          events: [events[0], { ...events[1], seq: 1 }, events[2]]
        })
      ),
    /strictly increasing/
  );
  assert.throws(
    () =>
      validateReplayEnvelope(
        validReplay({
          events: [events[0], { ...events[2], seq: 3 }]
        })
      ),
    /contiguous/
  );
});

test("rejects hidden hand data nested in event payloads", () => {
  for (const key of [
    "hand",
    "hiddenHand",
    "private_hand",
    "concealed-hand",
    "opponentHand"
  ]) {
    assert.throws(
      () =>
        validateReplayEnvelope(
          validReplay({
            events: [
              {
                seq: 1,
                type: "game-started",
                data: { nested: { [key]: [{ instanceId: "secret" }] } }
              }
            ]
          })
        ),
      /hidden hand data/
    );
  }
});

test("rejects duplicate player ids and non-JSON event values", () => {
  assert.throws(
    () =>
      validateReplayEnvelope(
        validReplay({
          players: [
            { id: "player-1", name: "Player One" },
            { id: "player-1", name: "Player Two" }
          ]
        })
      ),
    /unique player ids/
  );

  const events = validReplay().events;
  assert.throws(
    () =>
      validateReplayEnvelope(
        validReplay({
          events: [
            {
              seq: 1,
              type: "game-started",
              data: { playerIds: [undefined] }
            }
          ]
        })
      ),
    /JSON values/
  );
  assert.throws(
    () =>
      validateReplayEnvelope(
        validReplay({
          events: [
            {
              ...events[0],
              data: { value: Number.NaN }
            }
          ]
        })
      ),
    /finite/
  );
});

test("requires both initial hash placeholder fields", () => {
  const missingStateHash = validReplay();
  delete missingStateHash.initialStateHash;
  assert.throws(
    () => validateReplayEnvelope(missingStateHash),
    /initialStateHash: is required/
  );

  const missingEventHash = validReplay();
  delete missingEventHash.initialEventHash;
  assert.throws(
    () => validateReplayEnvelope(missingEventHash),
    /initialEventHash: is required/
  );
});

test("serializes deterministically and round-trips through parseReplay", () => {
  const replay = validateReplayEnvelope(validReplay());
  const serialized = serializeReplay(replay);
  const parsed = parseReplay(serialized);

  assert.equal(serializeReplay(parsed), serialized);
  assert.deepEqual(parsed, replay);
  assert.equal(serialized.includes("\n"), false);
  assert.ok(serialized.indexOf('"cardDataVersion"') < serialized.indexOf('"events"'));
});

test("rejects malformed JSON and invalid serialized envelopes", () => {
  assert.throws(() => parseReplay("{"), ReplayValidationError);
  assert.throws(
    () => parseReplay(JSON.stringify(validReplay({ rulesetId: "" }))),
    /rulesetId: must be a non-empty string/
  );
  assert.throws(
    () =>
      parseReplay(
        JSON.stringify(
          validReplay({
            events: [
              {
                seq: 1,
                type: "game-started",
                data: { playerIds: ["player-1", "player-2"] },
                unknown: true
              }
            ]
          })
        )
      ),
    /unknown field/
  );
});

test("does not mutate the input envelope", () => {
  const replay = validReplay();
  const before = structuredClone(replay);
  const validated = validateReplayEnvelope(replay);

  assert.deepEqual(replay, before);
  assert.notEqual(validated, replay);
  assert.notEqual(validated.events, replay.events);
  assert.notEqual(validated.events[0].data, replay.events[0].data);
});
