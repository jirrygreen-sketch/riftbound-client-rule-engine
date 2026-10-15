import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  DUEL_WINDOW_STATUS_CHAIN,
  DUEL_WINDOW_STATUS_CHOICE,
  DUEL_WINDOW_STATUS_DETAIL_CHAIN,
  DUEL_WINDOW_STATUS_DETAIL_PAYMENT,
  DUEL_WINDOW_STATUS_DETAIL_PENDING_ITEM,
  DUEL_WINDOW_STATUS_ENDED,
  DUEL_WINDOW_STATUS_LABEL,
  DUEL_WINDOW_STATUS_MAIN,
  DUEL_WINDOW_STATUS_OPPONENT,
  DUEL_WINDOW_STATUS_PAYMENT,
  DUEL_WINDOW_STATUS_PENDING_ITEM,
  DUEL_WINDOW_STATUS_RESOLVING,
  DUEL_WINDOW_STATUS_WAITING,
  DuelWindowStatus,
  describeDuelWindowStatus
} from "../../src/full-product/components/DuelWindowStatus";
import { isDuelProjectionV3Actions1 } from "@riftbound/protocol";
import type {
  DuelActionV3Actions1,
  DuelPendingChoiceV3Actions1,
  DuelProjectionV3Actions1
} from "@riftbound/protocol";

/**
 * Fixtures below satisfy the real P4 projection guard, so every assertion runs
 * against a genuinely valid `DuelProjectionV3Actions1` rather than a shape the
 * helper would silently misread. Rendering is static SSR only (this suite has
 * no DOM), so the component tests assert markup strings and never claim
 * native/DOM behaviour.
 */

const ALICE_BASE = JSON.stringify(["duel-base", "alice"]);
const BOB_BASE = JSON.stringify(["duel-base", "bob"]);
const FIELD_A = JSON.stringify(["duel-battlefield", "bf-a"]);
const FIELD_B = JSON.stringify(["duel-battlefield", "bf-b"]);
const EMPTY_POOL = { energy: 0, power: { Fury: 0, Calm: 0, Mind: 0, Body: 0, Chaos: 0, Order: 0, any: 0 } };

interface FixtureOptions {
  readonly viewer?: string | null;
  readonly phase?: string;
  readonly priorityPlayerId?: string | null;
  readonly stateOpen?: boolean;
  readonly chain?: unknown;
  readonly pendingChoice?: DuelPendingChoiceV3Actions1;
  readonly pendingPayment?: unknown;
  readonly execution?: unknown;
  readonly actions?: readonly DuelActionV3Actions1[];
}

/** A real, guard-passing projection. Defaults to an open Main Phase. */
function makeProjection(options: FixtureOptions = {}): DuelProjectionV3Actions1 {
  const viewer = options.viewer === undefined ? "alice" : options.viewer;
  const chain = options.chain ?? { active: false };
  const chainActive = (chain as { active?: boolean }).active === true;

  const alicePlayer: Record<string, unknown> = {
    playerId: "alice",
    champion: { cardId: "champ-a" },
    legend: { cardId: "legend-a", controllerPlayerId: "alice", readiness: "ready" },
    handCount: 0,
    mainDeckCount: 30,
    trash: []
  };
  const bobPlayer: Record<string, unknown> = {
    playerId: "bob",
    champion: null,
    legend: { cardId: "legend-b", controllerPlayerId: "bob", readiness: "ready" },
    handCount: 0,
    mainDeckCount: 30,
    trash: []
  };
  if (viewer === "alice") alicePlayer.hand = [];
  if (viewer === "bob") bobPlayer.hand = [];

  const board = {
    bases: [
      { locationId: ALICE_BASE, ownerPlayerId: "alice", occupancy: [] },
      { locationId: BOB_BASE, ownerPlayerId: "bob", occupancy: [] }
    ],
    battlefields: [
      { locationId: FIELD_A, instanceId: "bf-a", cardId: "bf-card-a", ownerPlayerId: "alice",
        controllerPlayerId: null, contested: false, contestingPlayerId: null, showdown: "none",
        combat: "none", occupancy: [] },
      { locationId: FIELD_B, instanceId: "bf-b", cardId: "bf-card-b", ownerPlayerId: "bob",
        controllerPlayerId: null, contested: false, contestingPlayerId: null, showdown: "none",
        combat: "none", occupancy: [] }
    ],
    units: [],
    gears: []
  };

  const resources = {
    players: [
      { playerId: "alice", runePool: { ...EMPTY_POOL, power: { ...EMPTY_POOL.power } }, runeDeckCount: 8 },
      { playerId: "bob", runePool: { ...EMPTY_POOL, power: { ...EMPTY_POOL.power } }, runeDeckCount: 8 }
    ],
    bases: [
      { playerId: "alice", locationId: ALICE_BASE, baseRunes: [], goldTokens: [] },
      { playerId: "bob", locationId: BOB_BASE, baseRunes: [], goldTokens: [] }
    ]
  };

  const frame = {
    phase: options.phase ?? "main",
    turnNumber: 1,
    turnPlayerId: "alice",
    priorityPlayerId: options.priorityPlayerId === undefined ? "alice" : options.priorityPlayerId,
    focusPlayerId: null,
    // A live Chain forces a Closed State; the guard rejects chain.active + stateOpen.
    stateOpen: options.stateOpen === undefined ? !chainActive : options.stateOpen,
    pendingPayment: options.pendingPayment ?? null,
    chain,
    pendingChoice: options.pendingChoice ?? null,
    execution: options.execution ?? { status: "ready" }
  };

  return {
    projectionSchema: "riftbound-duel-v3-actions-1",
    viewerPlayerId: viewer,
    match: {
      schemaVersion: 3,
      rulesetId: "riftbound-duel",
      matchId: "match-1",
      dataVersion: "dv-1",
      catalogDigest: "cd-1",
      stateVersion: 7,
      eventSeq: 3,
      roster: [
        { playerId: "alice", displayName: "Alice" },
        { playerId: "bob", displayName: "Bob" }
      ],
      turnOrder: ["alice", "bob"],
      stage: "playing",
      players: [alicePlayer, bobPlayer],
      board,
      resources,
      scoring: {
        playerIds: ["alice", "bob"],
        battlefieldLocationIds: [FIELD_A, FIELD_B],
        victoryScore: 8,
        turnNumber: 1,
        players: [
          { playerId: "alice", points: 0, scoredBattlefieldLocationIds: [] },
          { playerId: "bob", points: 0, scoredBattlefieldLocationIds: [] }
        ]
      },
      frame
    },
    actions: options.actions ?? []
  } as unknown as DuelProjectionV3Actions1;
}

const WINDOW = "window-chain";
/**
 * An Execute window: every Chain item is finalized, so `pendingCount` is 0 and
 * the active Chain really is the response/priority window these tests exercise.
 * Same printing on every item: duplicate cardId must stay untangled.
 */
const SAME_PRINTING_CHAIN = {
  active: true,
  itemCount: 3,
  pendingCount: 0,
  cards: [
    { cardId: "ogn-004-298", controllerPlayerId: "alice", status: "finalized" },
    { cardId: "ogn-004-298", controllerPlayerId: "bob", status: "finalized" },
    { cardId: "ogn-004-298", controllerPlayerId: "alice", status: "finalized" }
  ]
};

/**
 * A Chain whose *current* item is still being completed (354 -> 359): the last
 * item is `pending`, so `pendingCount` is 1. This is NOT an Execute window, and
 * the UI must not advertise a response even if a contradictory projection also
 * marks an own play/pass `enabled`.
 */
const PENDING_ITEM_CHAIN = {
  active: true,
  itemCount: 2,
  pendingCount: 1,
  cards: [
    { cardId: "ogn-004-298", controllerPlayerId: "alice", status: "finalized" },
    { cardId: "ogn-004-298", controllerPlayerId: "alice", status: "pending" }
  ]
};

interface PlayOptions {
  readonly id?: string;
  readonly uid: string;
  readonly enabled: boolean;
}

function playCard({ id, uid, enabled }: PlayOptions): DuelActionV3Actions1 {
  return {
    id: id ?? `act-${uid}`,
    kind: "play-card",
    // Server labels are irrelevant to this helper: it never reads them for legality.
    label: "施放法术",
    enabled,
    cardUID: uid,
    windowId: WINDOW
  };
}

const PASS_PRIORITY: DuelActionV3Actions1 = {
  id: "act-pass",
  kind: "pass-priority",
  label: "让过优先权",
  enabled: true,
  windowId: WINDOW
};

function render(projection: DuelProjectionV3Actions1): string {
  return renderToStaticMarkup(<DuelWindowStatus projection={projection} />);
}

describe("DuelWindowStatus fixtures", () => {
  it("builds projections that pass the real P4 guard", () => {
    expect(isDuelProjectionV3Actions1(makeProjection())).toBe(true);
    expect(
      isDuelProjectionV3Actions1(
        makeProjection({
          chain: SAME_PRINTING_CHAIN,
          actions: [playCard({ uid: "reaction-uid", enabled: true }), PASS_PRIORITY]
        })
      )
    ).toBe(true);
  });
});

describe("describeDuelWindowStatus precedence", () => {
  it("reports the fine Main Phase and keeps the viewer's own enabled play UIDs", () => {
    const status = describeDuelWindowStatus(makeProjection({ actions: [playCard({ uid: "unit-uid", enabled: true })] }));
    expect(status.label).toBe(DUEL_WINDOW_STATUS_MAIN);
    // No Chain response is available in the open Main Phase, but the server-enabled
    // own play-card UID is still the viewer's own actionable card.
    expect(status.responseAvailable).toBe(false);
    expect(status.playableCardUIDs).toEqual(["unit-uid"]);
  });

  it("opens a Chain window only for the viewer's own enabled legal play/pass", () => {
    const projection = makeProjection({
      chain: SAME_PRINTING_CHAIN,
      priorityPlayerId: "alice",
      actions: [playCard({ uid: "reaction-uid", enabled: true }), PASS_PRIORITY]
    });
    const status = describeDuelWindowStatus(projection);
    expect(status.label).toBe(DUEL_WINDOW_STATUS_CHAIN);
    expect(status.detail).toBe(DUEL_WINDOW_STATUS_DETAIL_CHAIN);
    expect(status.responseAvailable).toBe(true);
    expect(status.playableCardUIDs).toEqual(["reaction-uid"]);
  });

  it("never exposes a disabled non-Reaction play even when it is the only play-card action", () => {
    const projection = makeProjection({
      chain: SAME_PRINTING_CHAIN,
      priorityPlayerId: "alice",
      actions: [playCard({ uid: "reaction-uid", enabled: true }),
        playCard({ uid: "non-reaction-unit-uid", enabled: false }), PASS_PRIORITY]
    });
    const status = describeDuelWindowStatus(projection);
    // Enabled Reaction play is offered; the disabled non-Reaction card is not,
    // and nothing widens the list beyond own enabled play-card UIDs.
    expect(status.playableCardUIDs).toEqual(["reaction-uid"]);
    expect(status.playableCardUIDs).not.toContain("non-reaction-unit-uid");
  });

  it("reports the reaction play as legal only because the server enabled it, not from its label", () => {
    const labelled = makeProjection({
      chain: SAME_PRINTING_CHAIN,
      priorityPlayerId: "alice",
      actions: [playCard({ id: "act-labelled", uid: "labelled-uid", enabled: false }),
        playCard({ id: "act-reaction", uid: "reaction-uid", enabled: true })]
    });
    expect(describeDuelWindowStatus(labelled).playableCardUIDs).toEqual(["reaction-uid"]);
  });

  it("reports '等待对手响应' when the opponent holds Chain priority", () => {
    // The server projects an empty action list to the non-priority viewer.
    const projection = makeProjection({
      chain: SAME_PRINTING_CHAIN,
      priorityPlayerId: "bob"
    });
    const status = describeDuelWindowStatus(projection);
    expect(status.label).toBe(DUEL_WINDOW_STATUS_OPPONENT);
    expect(status.responseAvailable).toBe(false);
    expect(status.playableCardUIDs).toEqual([]);
  });

  it("shows the owner a neutral '正在完成出牌' while the Chain item is still pending", () => {
    // Contradictory projection: the item is still pending (354 -> 359) yet the
    // server allegedly marks the owner's play/pass enabled. The public
    // `pendingCount` wins; no response and no playable UID are exposed.
    const projection = makeProjection({
      chain: PENDING_ITEM_CHAIN,
      priorityPlayerId: "alice",
      actions: [playCard({ uid: "reaction-uid", enabled: true }), PASS_PRIORITY]
    });
    const status = describeDuelWindowStatus(projection);
    expect(status.label).toBe(DUEL_WINDOW_STATUS_PENDING_ITEM);
    expect(status.detail).toBe(DUEL_WINDOW_STATUS_DETAIL_PENDING_ITEM);
    expect(status.responseAvailable).toBe(false);
    expect(status.playableCardUIDs).toEqual([]);
  });

  it("shows the opponent the same neutral pending-item label, never '等待对手响应'", () => {
    const projection = makeProjection({
      viewer: "bob",
      chain: PENDING_ITEM_CHAIN,
      priorityPlayerId: "alice",
      actions: [PASS_PRIORITY]
    });
    const status = describeDuelWindowStatus(projection);
    expect(status.label).toBe(DUEL_WINDOW_STATUS_PENDING_ITEM);
    expect(status.label).not.toBe(DUEL_WINDOW_STATUS_OPPONENT);
    expect(status.responseAvailable).toBe(false);
    expect(status.playableCardUIDs).toEqual([]);
  });

  it("shows a spectator the neutral pending-item label with nothing exposed", () => {
    const projection = makeProjection({
      viewer: null,
      chain: PENDING_ITEM_CHAIN,
      priorityPlayerId: "alice",
      actions: [playCard({ uid: "reaction-uid", enabled: true }), PASS_PRIORITY]
    });
    const status = describeDuelWindowStatus(projection);
    expect(status.label).toBe(DUEL_WINDOW_STATUS_PENDING_ITEM);
    expect(status.responseAvailable).toBe(false);
    expect(status.playableCardUIDs).toEqual([]);
  });

  it("locks the Chain window behind an outstanding payment", () => {
    const projection = makeProjection({
      chain: PENDING_ITEM_CHAIN,
      priorityPlayerId: "alice",
      pendingPayment: { active: true, paymentId: "pay-1", resolvedCost: { energy: 1, power: [] } },
      actions: [playCard({ uid: "reaction-uid", enabled: true }), PASS_PRIORITY]
    });
    const status = describeDuelWindowStatus(projection);
    expect(status.label).toBe(DUEL_WINDOW_STATUS_PAYMENT);
    // The payment detail must not promise a following response window: 337.2
    // resolves a finalized Unit/Gear immediately, so only the table update is
    // authoritative about what comes next.
    expect(status.detail).toBe(DUEL_WINDOW_STATUS_DETAIL_PAYMENT);
    expect(status.detail).not.toContain("响应时点");
    // The unpaid item cannot be chained, and no play UID leaks past the lock.
    expect(status.responseAvailable).toBe(false);
    expect(status.playableCardUIDs).toEqual([]);
  });

  it("also reports the pending payment label for another actor's generic pending", () => {
    const projection = makeProjection({
      chain: PENDING_ITEM_CHAIN,
      priorityPlayerId: "bob",
      pendingPayment: { active: true }
    });
    const status = describeDuelWindowStatus(projection);
    expect(status.label).toBe(DUEL_WINDOW_STATUS_PAYMENT);
    expect(status.playableCardUIDs).toEqual([]);
  });

  it("locks the Chain window behind an owner choice", () => {
    const projection = makeProjection({
      chain: PENDING_ITEM_CHAIN,
      priorityPlayerId: "alice",
      pendingChoice: {
        active: true,
        choiceId: "choice-1",
        kind: "effect-choices",
        prompts: [{
          promptId: "prompt-1",
          kind: "target",
          minSelections: 1,
          maxSelections: 1,
          options: [{ id: "option-1", label: "选项一" }]
        }]
      },
      actions: [playCard({ uid: "reaction-uid", enabled: true }), PASS_PRIORITY]
    });
    const status = describeDuelWindowStatus(projection);
    expect(status.label).toBe(DUEL_WINDOW_STATUS_CHOICE);
    expect(status.responseAvailable).toBe(false);
    expect(status.playableCardUIDs).toEqual([]);
  });

  it("reports the non-owner choice summary as a pending choice too", () => {
    const projection = makeProjection({
      chain: PENDING_ITEM_CHAIN,
      priorityPlayerId: "bob",
      pendingChoice: { active: true }
    });
    expect(describeDuelWindowStatus(projection).label).toBe(DUEL_WINDOW_STATUS_CHOICE);
  });

  it("reports rule processing when execution is pending without an active Chain", () => {
    const projection = makeProjection({ execution: { status: "pending" },
      actions: [playCard({ uid: "unsettled-card", enabled: true })] });
    const status = describeDuelWindowStatus(projection);
    expect(status.label).toBe(DUEL_WINDOW_STATUS_WAITING);
    expect(status.detail).toBe("当前规则仍有待处理项，请等待牌桌更新。");
    expect(status.responseAvailable).toBe(false);
    expect(status.playableCardUIDs).toEqual([]);
  });

  it("does not advertise regular Main actions while the server keeps the state closed", () => {
    const projection = makeProjection({ stateOpen: false, actions: [] });
    expect(describeDuelWindowStatus(projection)).toEqual({
      label: DUEL_WINDOW_STATUS_WAITING,
      detail: "当前规则仍有待处理项，请等待牌桌更新。",
      responseAvailable: false,
      playableCardUIDs: []
    });
  });

  it("fails closed to '结算中' when the viewer holds Chain priority without a legal play/pass", () => {
    const projection = makeProjection({
      chain: SAME_PRINTING_CHAIN,
      priorityPlayerId: "alice",
      actions: [playCard({ uid: "reaction-uid", enabled: false })]
    });
    const status = describeDuelWindowStatus(projection);
    expect(status.label).toBe(DUEL_WINDOW_STATUS_RESOLVING);
    expect(status.playableCardUIDs).toEqual([]);
  });

  it("reports '对局结束' for an ended match and exposes nothing", () => {
    const projection = makeProjection({ phase: "ended", priorityPlayerId: null, actions: [] });
    const status = describeDuelWindowStatus(projection);
    expect(status.label).toBe(DUEL_WINDOW_STATUS_ENDED);
    expect(status.responseAvailable).toBe(false);
    expect(status.playableCardUIDs).toEqual([]);
  });

  it("never exposes playable UIDs to a spectator", () => {
    const projection = makeProjection({ viewer: null, chain: SAME_PRINTING_CHAIN, priorityPlayerId: null });
    const status = describeDuelWindowStatus(projection);
    expect(status.responseAvailable).toBe(false);
    expect(status.playableCardUIDs).toEqual([]);
  });
});

describe("DuelWindowStatus SSR presentation", () => {
  it("renders the label, detail and one inert marker per own enabled play-card UID", () => {
    const html = render(
      makeProjection({
        chain: SAME_PRINTING_CHAIN,
        priorityPlayerId: "alice",
        actions: [playCard({ uid: "reaction-uid", enabled: true }), PASS_PRIORITY]
      })
    );
    expect(html).toContain(DUEL_WINDOW_STATUS_LABEL);
    expect(html).toContain(DUEL_WINDOW_STATUS_CHAIN);
    expect(html).toContain('data-response-available="true"');
    expect(html.split('class="full-product-duel-window-status-playable"').length - 1).toBe(1);
    expect(html).toContain('data-card-uid="reaction-uid"');
    // Static SSR: the strip is inert guidance and adds no command surface.
    expect(html).not.toContain("<button");
    expect(html).not.toContain("onClick");
  });

  it("renders a locked payment state with no playable markers", () => {
    const html = render(
      makeProjection({
        chain: SAME_PRINTING_CHAIN,
        priorityPlayerId: "alice",
        pendingPayment: { active: true, paymentId: "pay-1", resolvedCost: { energy: 1, power: [] } },
        actions: [playCard({ uid: "reaction-uid", enabled: true }), PASS_PRIORITY]
      })
    );
    expect(html).toContain(DUEL_WINDOW_STATUS_PAYMENT);
    expect(html).toContain('data-response-available="false"');
    expect(html).not.toContain("full-product-duel-window-status-playable");
    expect(html).not.toContain("<button");
  });

  it("renders a locked choice state with no playable markers", () => {
    const html = render(
      makeProjection({
        chain: SAME_PRINTING_CHAIN,
        priorityPlayerId: "alice",
        pendingChoice: { active: true },
        actions: [playCard({ uid: "reaction-uid", enabled: true })]
      })
    );
    expect(html).toContain(DUEL_WINDOW_STATUS_CHOICE);
    expect(html).toContain('data-response-available="false"');
    expect(html).not.toContain("full-product-duel-window-status-playable");
    expect(html).not.toContain("<button");
  });

  it("renders the opponent-wait state when the viewer has no priority", () => {
    const html = render(makeProjection({ chain: SAME_PRINTING_CHAIN, priorityPlayerId: "bob" }));
    expect(html).toContain(DUEL_WINDOW_STATUS_OPPONENT);
    expect(html).toContain('data-response-available="false"');
  });
});

describe("null priority and unpaid response boundary", () => {
  it("shows resolving when no player holds Chain priority", () => {
    const projection=makeProjection({chain:SAME_PRINTING_CHAIN,priorityPlayerId:null,actions:[]});
    if(projection.match.stage!=="playing") throw Error("playing fixture required");
    Object.assign(projection.match.frame,{priorityPlayerId:null});
    expect(isDuelProjectionV3Actions1(projection)).toBe(true);
    expect(describeDuelWindowStatus(projection)).toMatchObject({label:DUEL_WINDOW_STATUS_RESOLVING,
      responseAvailable:false,playableCardUIDs:[]});
  });
});
