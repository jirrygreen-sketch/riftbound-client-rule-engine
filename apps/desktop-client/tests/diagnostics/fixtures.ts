import type { V2Projection } from "../../../../packages/protocol/src/v2/index.js";
import type { V2EngineEvent } from "../../../../packages/protocol/src/v2/index.js";

export function event(eventSeq: number, stateVersion = eventSeq): V2EngineEvent {
  return {
    contract: "riftbound.protocol.v2.event",
    seq: eventSeq,
    eventSeq,
    stateVersion,
    timingPoint: "card-played",
    audience: { visibility: "public" },
    payload: { cardObjectId: { visibility: "public", value: `card-${eventSeq}` } }
  };
}

export function projection(overrides: Partial<V2Projection> = {}): V2Projection {
  return {
    projectionContract: "riftbound.protocol.v2.projection",
    protocolVersion: "2.0.0",
    rulesetVersion: "core-1.5",
    matchId: "match-1",
    viewerPlayerId: "player-1",
    stateVersion: 9,
    eventSeq: 4,
    phase: "main",
    turnNumber: 2,
    activePlayerId: "player-1",
    players: [
      { playerId: "player-1", name: "Alice", score: 0, energy: 1, power: {}, xp: 0,
        handCount: 0, deckCount: 0, runeDeckCount: 0, zoneCounts: {} }
    ],
    zones: [],
    objects: [],
    chain: { status: "closed", phase: "open", priorityPlayerId: null, focusPlayerId: null, items: [] },
    priority: { playerId: null, focusPlayerId: null, window: "open" },
    scoring: { victoryScore: 8, battlefieldLocationIds: [], players: [] },
    battlefields: [],
    combat: { status: "none" },
    actionOptions: { canEndTurn: true, canAdvance: true, moves: [], plays: [] },
    pendingChoice: { status: "none" },
    winnerPlayerId: null,
    events: [],
    ...overrides
  };
}

export class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}
