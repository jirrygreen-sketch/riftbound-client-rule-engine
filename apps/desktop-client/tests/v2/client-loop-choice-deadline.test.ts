import { describe, expect, it } from "vitest";
import { clearedActionSelection } from "../../src/app/useAppState";
import { refreshV2ChoiceUiState, updateV2ChoiceUiState } from "../../src/state/v2/choice";
import type { V2PendingChoice } from "../../../../packages/protocol/src/v2/index.js";

// RIFT-1053: both found in a real two-browser M1 run on macOS.

describe("RIFT-1053 cleared action selection", () => {
  it("keeps the same state value when the selection is already clear", () => {
    // The selection effect depends on the selection; returning a fresh empty
    // object every time re-ran it forever ("Maximum update depth exceeded").
    const clear = { actionId: null, cardId: null, targetIds: [] as string[] };
    expect(clearedActionSelection(clear)).toBe(clear);
  });

  it("clears a non-empty selection", () => {
    const selected = { actionId: "play:1", cardId: "card-1", targetIds: ["t-1"] };
    expect(clearedActionSelection(selected)).toEqual({ actionId: null, cardId: null, targetIds: [] });
  });
});

const pending: V2PendingChoice = {
  status: "pending", choiceId: "trigger:332:A:order", ownerPlayerId: "alice", stateVersion: 16,
  kind: "mode", options: [{ id: "first", label: "first" }, { id: "second", label: "second" }]
} as unknown as V2PendingChoice;

describe("RIFT-1053 V2 choice has no local deadline by default", () => {
  it("stays answerable however long the player takes when no timeout is configured", () => {
    // The server waits for the answer indefinitely (Riftbound has no decision
    // timer); a default 30s local expiry disabled every action and stalled the game.
    const state = updateV2ChoiceUiState(null, pending, { viewerPlayerId: "alice", now: 0 });
    expect(state.status).toBe("pending");
    expect(state.expiresAt).toBeNull();
    const later = refreshV2ChoiceUiState(state, { viewerPlayerId: "alice", now: 24 * 60 * 60 * 1000 });
    expect(later.status).toBe("pending");
    expect(later.answerable).toBe(true);
  });

  it("still honours an explicitly configured local deadline", () => {
    const state = updateV2ChoiceUiState(null, pending, { viewerPlayerId: "alice", now: 100, timeoutMs: 50 });
    expect(refreshV2ChoiceUiState(state, { viewerPlayerId: "alice", now: 160 }).status).toBe("expired");
  });
});
