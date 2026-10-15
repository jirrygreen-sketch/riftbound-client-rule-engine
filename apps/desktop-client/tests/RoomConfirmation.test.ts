import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  beginDeckSwitch,
  evaluateDeckSwitch,
  evaluateReadyReceipt,
  evaluateSubmitDeckReceipt,
  type DeckSwitchEvidence,
  type DeckSwitchTracker,
  type SubmissionReceiptEvidence
} from "../src/decks/room-confirmation";
import type { RoomRequestFailure, RoomRequestReceipt } from "../src/net/GameClient";
import type { DeckByZone } from "../src/hooks/useCardCatalog";
import { emptyDeckByZone } from "../src/hooks/useCardCatalog";

/**
 * These cases exercise the pure confirmation rules that `App.tsx` runs for real
 * (the app imports the same functions; nothing here is a test-only stand-in).
 * The scenario names mirror the failure matrix of the "switch deck while ready"
 * flow: a ready=false projection is not proof on its own, and only a matched
 * `set-ready(false)` receipt plus a caught-up projection may install the
 * captured deck snapshot.
 */

function namedDeck(overrides: Partial<DeckByZone> = {}): DeckByZone {
  return {
    ...emptyDeckByZone(),
    mainDeck: { "flame-warden-standard": 3 },
    runes: { "basic-rune-standard": 12 },
    ...overrides
  };
}

const CAPTURED_DECK = namedDeck();
const OTHER_DECK = namedDeck({ mainDeck: { "flame-warden-standard": 1 } });

const CAPTURED_CONTEXT = { roomId: "room-1", playerId: "player-1" } as const;

function makeTracker(overrides: Partial<Parameters<typeof beginDeckSwitch>[0]> = {}): DeckSwitchTracker {
  return beginDeckSwitch({
    requestId: "set-ready-1",
    context: CAPTURED_CONTEXT,
    deckId: "deck-1",
    deck: CAPTURED_DECK,
    name: "阿狸 rush",
    errorRevision: 0,
    ...overrides
  });
}

function makeReceipt(overrides: Partial<RoomRequestReceipt> = {}): RoomRequestReceipt {
  return {
    requestId: "set-ready-1",
    requestType: "set-ready",
    roomId: "room-1",
    playerId: "player-1",
    socketGeneration: 1,
    ready: false,
    roomVersion: 5,
    roomEventSeq: 5,
    ...overrides
  };
}

function makeFailure(overrides: Partial<RoomRequestFailure> = {}): RoomRequestFailure {
  return {
    requestId: "set-ready-1",
    requestType: "set-ready",
    roomId: "room-1",
    playerId: "player-1",
    socketGeneration: 1,
    ...overrides
  };
}

function makeEvidence(overrides: Partial<DeckSwitchEvidence> = {}): DeckSwitchEvidence {
  return {
    connected: true,
    roomId: "room-1",
    playerId: "player-1",
    roomStatus: "waiting",
    roomVersion: 5,
    selfReady: false,
    receipt: makeReceipt(),
    failure: null,
    errorRevision: 0,
    ...overrides
  };
}

describe("deck switch confirmation witness", () => {
  it("captures an immutable deck snapshot when the switch starts", () => {
    const source = namedDeck();
    const tracker = makeTracker({ deck: source });
    source.mainDeck = { "flame-warden-standard": 99 };
    expect(tracker.status).toBe("pending");
    expect(tracker.deck.mainDeck).toEqual({ "flame-warden-standard": 3 });
    expect(tracker.deck).not.toBe(source);
  });

  it("confirms only with the matching set-ready(false) receipt and the caught-up projection", () => {
    const tracker = makeTracker();
    const decision = evaluateDeckSwitch(tracker, makeEvidence());

    expect(decision.status).toBe("confirmed");
    if (decision.status !== "confirmed") return;
    expect(decision.witness).toEqual({
      requestId: "set-ready-1",
      requestType: "set-ready",
      ready: false,
      roomId: "room-1",
      playerId: "player-1",
      roomVersion: 5
    });
    expect(decision.tracker.status).toBe("confirmed");
    expect(decision.tracker.deck).toEqual(CAPTURED_DECK);
  });

  it("waits when an early ready=false projection arrives without any receipt", () => {
    const tracker = makeTracker();
    const early = makeEvidence({ receipt: null, roomVersion: 6, selfReady: false });
    expect(evaluateDeckSwitch(tracker, early)).toEqual({ status: "pending", tracker });
    // Repeated projections keep waiting; they never turn into an application.
    expect(evaluateDeckSwitch(tracker, makeEvidence({ receipt: null, roomVersion: 9 })))
      .toEqual({ status: "pending", tracker });
  });

  it("waits while the projection is still behind the acknowledged room version", () => {
    const tracker = makeTracker();
    const receiptBeforeProjection = makeEvidence({ roomVersion: 4, selfReady: false });
    expect(evaluateDeckSwitch(tracker, receiptBeforeProjection).status).toBe("pending");
    // The projection arrives but the seat still reads ready: keep waiting.
    const projectionBeforeReadyFlag = makeEvidence({ roomVersion: 5, selfReady: true });
    expect(evaluateDeckSwitch(tracker, projectionBeforeReadyFlag).status).toBe("pending");
    // Only once everything lines up is the switch applied.
    expect(evaluateDeckSwitch(tracker, makeEvidence({ roomVersion: 5, selfReady: false })).status)
      .toBe("confirmed");
  });

  it("never confirms from a version bump or another player's broadcast", () => {
    const tracker = makeTracker();
    expect(evaluateDeckSwitch(tracker, makeEvidence({
      receipt: null,
      roomVersion: 12,
      selfReady: false
    })).status).toBe("pending");
    expect(evaluateDeckSwitch(tracker, makeEvidence({
      receipt: makeReceipt({ playerId: "player-2", roomVersion: 12 }),
      roomVersion: 12
    })).status).toBe("pending");
    expect(evaluateDeckSwitch(tracker, makeEvidence({
      receipt: makeReceipt({ roomId: "room-2", roomVersion: 12 }),
      roomId: "room-1",
      roomVersion: 12
    })).status).toBe("pending");
  });

  it("ignores receipts for other requests, other request types, or ready=true", () => {
    const tracker = makeTracker();
    expect(evaluateDeckSwitch(tracker, makeEvidence({
      receipt: makeReceipt({ requestId: "set-ready-2" })
    })).status).toBe("pending");
    expect(evaluateDeckSwitch(tracker, makeEvidence({
      receipt: makeReceipt({ requestType: "submit-deck", requestId: "submit-deck-1" })
    })).status).toBe("pending");
    expect(evaluateDeckSwitch(tracker, makeEvidence({
      receipt: makeReceipt({ ready: true })
    })).status).toBe("pending");
  });

  it("is idempotent across duplicate acknowledgements", () => {
    const tracker = makeTracker();
    const evidence = makeEvidence();
    const first = evaluateDeckSwitch(tracker, evidence);
    const second = evaluateDeckSwitch(tracker, evidence);
    expect(first).toEqual(second);
    expect(first.status).toBe("confirmed");
  });

  it("abandons the switch when the receipt has no room version", () => {
    const tracker = makeTracker();
    const decision = evaluateDeckSwitch(tracker, makeEvidence({
      receipt: makeReceipt({ roomVersion: undefined, roomEventSeq: undefined })
    }));
    expect(decision).toEqual({
      status: "abandoned",
      reason: "missing-version",
      notice: "服务器回执缺少房间版本，切换卡组未完成，请重试。"
    });
  });

  it("abandons on the matching failure or timeout but ignores other failures", () => {
    const tracker = makeTracker();
    expect(evaluateDeckSwitch(tracker, makeEvidence({
      receipt: null,
      failure: makeFailure({ requestId: "submit-deck-1", requestType: "submit-deck" })
    })).status).toBe("pending");
    expect(evaluateDeckSwitch(tracker, makeEvidence({
      receipt: null,
      failure: makeFailure({ roomId: "room-2" })
    })).status).toBe("pending");
    const timedOut = evaluateDeckSwitch(tracker, makeEvidence({
      receipt: null,
      failure: makeFailure()
    }));
    expect(timedOut).toEqual({
      status: "abandoned",
      reason: "request-failed",
      notice: "服务器未确认取消准备，切换卡组未完成，请重试。"
    });
  });

  it("abandons when the connection drops, and a later projection cannot revive it", () => {
    const tracker = makeTracker();
    expect(evaluateDeckSwitch(tracker, makeEvidence({
      connected: false,
      receipt: null,
      roomVersion: 5
    }))).toEqual({
      status: "abandoned",
      reason: "disconnected",
      notice: "连接已断开，切换卡组未完成，请重试。"
    });
    // The late projection that shows ready=false would look like a confirmation,
    // but without the acknowledgement the switch is still only pending.
    expect(evaluateDeckSwitch(tracker, makeEvidence({
      connected: true,
      receipt: null,
      roomVersion: 6,
      selfReady: false
    })).status).toBe("pending");
  });

  it("abandons when the room, player, room status, or error revision changed", () => {
    const tracker = makeTracker();
    expect(evaluateDeckSwitch(tracker, makeEvidence({ roomId: "room-2" })))
      .toMatchObject({ status: "abandoned", reason: "room-changed" });
    expect(evaluateDeckSwitch(tracker, makeEvidence({ playerId: "player-2" })))
      .toMatchObject({ status: "abandoned", reason: "room-changed" });
    expect(evaluateDeckSwitch(tracker, makeEvidence({ roomStatus: "playing" })))
      .toMatchObject({ status: "abandoned", reason: "room-status" });
    expect(evaluateDeckSwitch(tracker, makeEvidence({ roomStatus: null })))
      .toMatchObject({ status: "abandoned", reason: "room-status" });
    expect(evaluateDeckSwitch(tracker, makeEvidence({ errorRevision: 1 })))
      .toMatchObject({ status: "abandoned", reason: "error" });
    expect(evaluateDeckSwitch(tracker, makeEvidence({ errorRevision: 1 })).status)
      .toBe("abandoned");
  });

  it("abandons before looking at evidence when the room is no longer waiting", () => {
    const tracker = makeTracker();
    const decision = evaluateDeckSwitch(tracker, makeEvidence({
      roomStatus: "ended",
      receipt: makeReceipt({ roomVersion: 5 })
    }));
    expect(decision.status).toBe("abandoned");
    if (decision.status !== "abandoned") return;
    expect(decision.notice).toContain("未完成，请重试");
  });

  it("applies the captured snapshot even after the source deck moved on", () => {
    const libraryEntry = namedDeck();
    const tracker = makeTracker({ deck: libraryEntry });
    // The user keeps editing the named deck while the request is in flight.
    libraryEntry.mainDeck = { "flame-warden-standard": 7 };
    libraryEntry.runes = { "basic-rune-standard": 1 };

    const decision = evaluateDeckSwitch(tracker, makeEvidence());
    expect(decision.status).toBe("confirmed");
    if (decision.status !== "confirmed") return;
    expect(decision.tracker.deck).toEqual(CAPTURED_DECK);
    expect(decision.tracker.deck).not.toEqual(libraryEntry);
  });
});

describe("submit-deck receipt confirmation", () => {
  function makeEvidence(overrides: Partial<SubmissionReceiptEvidence> = {}): SubmissionReceiptEvidence {
    return {
      receipt: makeReceipt({ requestType: "submit-deck", requestId: "submit-deck-1" }),
      pendingRequestId: "submit-deck-1",
      context: CAPTURED_CONTEXT,
      roomId: "room-1",
      playerId: "player-1",
      roomVersion: 5,
      ...overrides
    };
  }

  it("confirms only once the room projection reaches the acknowledged version", () => {
    expect(evaluateSubmitDeckReceipt(makeEvidence({ roomVersion: 4 })))
      .toEqual({ kind: "waiting" });
    expect(evaluateSubmitDeckReceipt(makeEvidence({ roomVersion: 5 })))
      .toEqual({ kind: "confirmed", roomVersion: 5 });
    // A later version bump for someone else is not evidence for a finished request.
    expect(evaluateSubmitDeckReceipt(makeEvidence({
      pendingRequestId: null,
      roomVersion: 9
    }))).toEqual({ kind: "ignored" });
  });

  it("drops the in-flight submit, without confirming, on a missing version", () => {
    const decision = evaluateSubmitDeckReceipt(makeEvidence({
      receipt: makeReceipt({
        requestType: "submit-deck",
        requestId: "submit-deck-1",
        roomVersion: undefined
      })
    }));
    expect(decision).toEqual({
      kind: "abandoned",
      notice: "服务器回执缺少房间版本，本次提交未确认，请重试。"
    });
  });

  it("drops the in-flight submit when the room context was replaced", () => {
    expect(evaluateSubmitDeckReceipt(makeEvidence({ context: { roomId: "room-1", playerId: "player-2" } })))
      .toEqual({ kind: "abandoned", notice: "房间已变化，本次提交未确认，请重试。" });
    expect(evaluateSubmitDeckReceipt(makeEvidence({ context: null })))
      .toMatchObject({ kind: "abandoned" });
    expect(evaluateSubmitDeckReceipt(makeEvidence({ roomId: "room-2" })))
      .toMatchObject({ kind: "abandoned" });
    expect(evaluateSubmitDeckReceipt(makeEvidence({ playerId: "player-2" })))
      .toMatchObject({ kind: "abandoned" });
  });

  it("ignores receipts that do not match the in-flight request", () => {
    expect(evaluateSubmitDeckReceipt(makeEvidence({ pendingRequestId: "submit-deck-2" })))
      .toEqual({ kind: "ignored" });
    expect(evaluateSubmitDeckReceipt(makeEvidence({ pendingRequestId: null })))
      .toEqual({ kind: "ignored" });
    expect(evaluateSubmitDeckReceipt(makeEvidence({
      receipt: makeReceipt({ requestType: "set-ready", requestId: "set-ready-1" })
    }))).toEqual({ kind: "ignored" });
  });
});

describe("plain set-ready receipt confirmation", () => {
  function makeEvidence(overrides: Partial<Parameters<typeof evaluateReadyReceipt>[0]> = {}) {
    return {
      receipt: makeReceipt({ ready: true }),
      pendingRequestId: "set-ready-1",
      context: CAPTURED_CONTEXT,
      roomId: "room-1",
      playerId: "player-1",
      roomVersion: 5,
      selfReady: true,
      ...overrides
    };
  }

  it("acknowledges only when the receipt and the projection agree", () => {
    expect(evaluateReadyReceipt(makeEvidence({ roomVersion: 4 }))).toEqual({ kind: "waiting" });
    expect(evaluateReadyReceipt(makeEvidence({ selfReady: false }))).toEqual({ kind: "waiting" });
    expect(evaluateReadyReceipt(makeEvidence({ selfReady: null }))).toEqual({ kind: "waiting" });
    expect(evaluateReadyReceipt(makeEvidence())).toEqual({ kind: "acknowledged" });
  });

  it("abandons on a missing version or a replaced context", () => {
    expect(evaluateReadyReceipt(makeEvidence({
      receipt: makeReceipt({ ready: true, roomVersion: undefined })
    }))).toEqual({
      kind: "abandoned",
      notice: "服务器回执缺少房间版本，本次准备状态未确认，请重试。"
    });
    expect(evaluateReadyReceipt(makeEvidence({
      context: { roomId: "room-9", playerId: "player-1" }
    }))).toMatchObject({ kind: "abandoned" });
  });

  it("ignores receipts for other requests", () => {
    expect(evaluateReadyReceipt(makeEvidence({ pendingRequestId: "set-ready-2" })))
      .toEqual({ kind: "ignored" });
    expect(evaluateReadyReceipt(makeEvidence({ pendingRequestId: null })))
      .toEqual({ kind: "ignored" });
    expect(evaluateReadyReceipt(makeEvidence({
      receipt: makeReceipt({ requestType: "submit-deck", requestId: "submit-deck-1" })
    }))).toEqual({ kind: "ignored" });
  });
});

describe("no optimistic confirmation", () => {
  it("keeps every incomplete path in Chinese and never claims success", () => {
    const tracker = makeTracker();
    const decisions = [
      evaluateDeckSwitch(tracker, makeEvidence({
        receipt: makeReceipt({ roomVersion: undefined })
      })),
      evaluateDeckSwitch(tracker, makeEvidence({ receipt: null, failure: makeFailure() })),
      evaluateDeckSwitch(tracker, makeEvidence({ connected: false })),
      evaluateDeckSwitch(tracker, makeEvidence({ roomStatus: "playing" })),
      evaluateDeckSwitch(tracker, makeEvidence({ roomId: "room-3" })),
      evaluateDeckSwitch(tracker, makeEvidence({ errorRevision: 2 }))
    ];
    for (const decision of decisions) {
      expect(decision.status).toBe("abandoned");
      if (decision.status !== "abandoned") continue;
      expect(decision.notice).toContain("未完成，请重试");
      expect(decision.notice).not.toContain("已切换");
    }
  });

  it("never installs a deck other than the captured one", () => {
    const tracker = makeTracker({ deck: OTHER_DECK });
    const decision = evaluateDeckSwitch(tracker, makeEvidence());
    expect(decision.status).toBe("confirmed");
    if (decision.status !== "confirmed") return;
    expect(decision.tracker.deck).toEqual(OTHER_DECK);
    expect(decision.tracker.deck).not.toEqual(CAPTURED_DECK);
  });
});

describe("app wiring", () => {
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

  it("uses the pure tracker for the deck switch instead of an optimistic apply", () => {
    expect(appSource).toContain('} from "./decks/room-confirmation"');
    expect(appSource).toContain("beginDeckSwitch({");
    expect(appSource).toContain("evaluateDeckSwitch(pendingSwitch,");
    expect(appSource).toContain("setDeckFromSnapshot(switchDecision.tracker.deck)");
    // The old flow applied the switch as soon as it had "no matching ack" plus a
    // ready=false projection; that decision must not come back.
    expect(appSource).not.toContain("setDeckFromSnapshot(pendingSwitch.deck)");
    expect(appSource).not.toContain("if (roomSelf?.ready !== false) return;");
  });
});
