import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  DUEL_ACTIONS_PLAY_CARD_LABEL_SEPARATOR,
  DUEL_ACTIONS_SUBMIT_LABEL_PREFIX,
  DuelActionsPanelV3,
  EMPTY_DUEL_ACTIONS_SELECTION,
  buildDuelCommandPacket,
  duelActionDisplayLabel,
  duelPlayCardName
} from "../src/full-product/components/DuelActionsPanelV3";
import type {
  DuelActionsPanelV3Props,
  DuelActionsSelection
} from "../src/full-product/components/DuelActionsPanelV3";
import { isDuelProjectionV3Actions1 } from "@riftbound/protocol";
import type {
  DuelActionV3Actions1,
  DuelProjectionV3Actions1
} from "@riftbound/protocol";

const ALICE_BASE = JSON.stringify(["duel-base", "alice"]);
const BOB_BASE = JSON.stringify(["duel-base", "bob"]);
const FIELD_A = JSON.stringify(["duel-battlefield", "bf-a"]);
const FIELD_B = JSON.stringify(["duel-battlefield", "bf-b"]);
const EMPTY_POOL = { energy: 0, power: { Fury: 0, Calm: 0, Mind: 0, Body: 0, Chaos: 0, Order: 0, any: 0 } };

interface HandCard {
  readonly uid: string;
  readonly cardId: string;
}

interface FixtureOptions {
  readonly viewer?: string | null;
  readonly stateVersion?: number;
  readonly ownHand?: readonly HandCard[];
  readonly actions?: readonly DuelActionV3Actions1[];
  /** A raw `hand` array placed on the *opponent* seat to prove it never leaks. */
  readonly opponentHand?: readonly HandCard[];
}

/**
 * Minimal projection that genuinely satisfies `isDuelProjectionV3Actions1`: only
 * the viewer's own seat carries a `hand` array (the guard rejects a `hand` key on
 * the other seat), so an opponent's cards are structurally invisible to a player.
 */
function makeProjection(options: FixtureOptions = {}): DuelProjectionV3Actions1 {
  const viewer = options.viewer === undefined ? "alice" : options.viewer;
  const stateVersion = options.stateVersion ?? 7;
  const ownHand = options.ownHand ?? [];

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
  if (viewer === "alice") alicePlayer.hand = ownHand.map(card => ({ ...card }));
  if (viewer === "bob") bobPlayer.hand = ownHand.map(card => ({ ...card }));
  alicePlayer.handCount = (alicePlayer.hand as readonly unknown[] | undefined)?.length ?? 0;
  bobPlayer.handCount = (bobPlayer.hand as readonly unknown[] | undefined)?.length ?? 0;
  if (options.opponentHand !== undefined) {
    bobPlayer.hand = options.opponentHand.map(card => ({ ...card }));
    bobPlayer.handCount = options.opponentHand.length;
  }

  const board = {
    bases: [
      { locationId: ALICE_BASE, ownerPlayerId: "alice", occupancy: [] },
      { locationId: BOB_BASE, ownerPlayerId: "bob", occupancy: [] }
    ],
    battlefields: [
      {
        locationId: FIELD_A,
        instanceId: "bf-a",
        cardId: "bf-card-a",
        ownerPlayerId: "alice",
        controllerPlayerId: null,
        contested: false,
        contestingPlayerId: null,
        showdown: "none",
        combat: "none",
        occupancy: []
      },
      {
        locationId: FIELD_B,
        instanceId: "bf-b",
        cardId: "bf-card-b",
        ownerPlayerId: "bob",
        controllerPlayerId: null,
        contested: false,
        contestingPlayerId: null,
        showdown: "none",
        combat: "none",
        occupancy: []
      }
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
    phase: "main",
    turnNumber: 1,
    turnPlayerId: "alice",
    priorityPlayerId: "alice",
    focusPlayerId: null,
    stateOpen: true,
    pendingPayment: null,
    chain: { active: false },
    pendingChoice: null,
    execution: { status: "ready" }
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
      stateVersion,
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

function playAction(overrides: Partial<DuelActionV3Actions1> & { cardUID: string }): DuelActionV3Actions1 {
  return {
    id: "act-play",
    kind: "play-card",
    label: "打出单位",
    enabled: true,
    windowId: "window-main",
    ...overrides
  } as DuelActionV3Actions1;
}

function render(props: Partial<DuelActionsPanelV3Props> & { projection: DuelProjectionV3Actions1 }): string {
  const full: DuelActionsPanelV3Props = {
    connectionStatus: "connected",
    commandPending: false,
    onCommand: () => {},
    ...props
  };
  return renderToStaticMarkup(<DuelActionsPanelV3 {...full} />);
}

function buttonTag(html: string, ariaLabel: string): string {
  const index = html.indexOf(`aria-label="${ariaLabel}"`);
  expect(index, `button ${ariaLabel} not found`).toBeGreaterThanOrEqual(0);
  const open = html.lastIndexOf("<button", index);
  const close = html.indexOf(">", index);
  return html.slice(open, close + 1);
}

const catalog: Readonly<Record<string, string>> = {
  "card-ignis": "铸光者",
  "card-rock": "碎星兽",
  "card-unknown": ""
};
const resolveCardName = (cardId: string): string => catalog[cardId] ?? "";
const nameOf = (cardId: string): string => catalog[cardId] ?? "";

describe("duel-play-card-labels-v3 fixtures", () => {
  it("builds own-hand play-card projections that pass the real P4 guard", () => {
    const projection = makeProjection({
      ownHand: [
        { uid: "hand-uid-1", cardId: "card-ignis" },
        { uid: "hand-uid-2", cardId: "card-rock" }
      ],
      actions: [playAction({ id: "act-ignis", cardUID: "hand-uid-1" })]
    });
    expect(isDuelProjectionV3Actions1(projection)).toBe(true);
  });
});

describe("play-card label resolution (display only)", () => {
  it("identifies two different own-hand cards by name instead of one shared label", () => {
    const projection = makeProjection({
      ownHand: [
        { uid: "hand-uid-1", cardId: "card-ignis" },
        { uid: "hand-uid-2", cardId: "card-rock" }
      ],
      actions: [
        playAction({ id: "act-ignis", cardUID: "hand-uid-1" }),
        playAction({ id: "act-rock", cardUID: "hand-uid-2" })
      ]
    });
    const html = render({ projection, resolveCardName });

    expect(html).toContain(`打出单位${DUEL_ACTIONS_PLAY_CARD_LABEL_SEPARATOR}铸光者`);
    expect(html).toContain(`打出单位${DUEL_ACTIONS_PLAY_CARD_LABEL_SEPARATOR}碎星兽`);
    // Two distinct labels, so a player can tell the two playable cards apart.
    expect(buttonTag(html, `打出单位${DUEL_ACTIONS_PLAY_CARD_LABEL_SEPARATOR}铸光者`)).not.toContain("disabled");
    expect(buttonTag(html, `打出单位${DUEL_ACTIONS_PLAY_CARD_LABEL_SEPARATOR}碎星兽`)).not.toContain("disabled");
    // Raw hand UIDs never appear as player text.
    expect(html).not.toContain("hand-uid-1");
    expect(html).not.toContain("hand-uid-2");
  });

  it("keeps each selection/submit packet bound to its own opaque action identity", () => {
    const projection = makeProjection({
      ownHand: [
        { uid: "hand-uid-1", cardId: "card-ignis" },
        { uid: "hand-uid-2", cardId: "card-rock" }
      ],
      actions: [
        playAction({ id: "act-ignis", cardUID: "hand-uid-1" }),
        playAction({ id: "act-rock", cardUID: "hand-uid-2" })
      ]
    });
    const html = render({
      projection,
      resolveCardName,
      initialSelection: { ...EMPTY_DUEL_ACTIONS_SELECTION, actionId: "act-rock" }
    });
    // The submit packet id resolves off the opaque action identity + cardUID, not the label.
    const rockTag = buttonTag(html, `打出单位${DUEL_ACTIONS_PLAY_CARD_LABEL_SEPARATOR}碎星兽`);
    expect(rockTag).toContain('aria-pressed="true"');
    const ignisTag = buttonTag(html, `打出单位${DUEL_ACTIONS_PLAY_CARD_LABEL_SEPARATOR}铸光者`);
    expect(ignisTag).not.toContain('aria-pressed="true"');

    const rock = projection.actions.find(action => action.id === "act-rock")!;
    const ignis = projection.actions.find(action => action.id === "act-ignis")!;
    const rockPacket = buildDuelCommandPacket(rock, { ...EMPTY_DUEL_ACTIONS_SELECTION, actionId: "act-rock" }, null, {
      expectedVersion: 7,
      ids: { requestId: "r", commandId: "c-rock" }
    });
    const ignisPacket = buildDuelCommandPacket(ignis, { ...EMPTY_DUEL_ACTIONS_SELECTION, actionId: "act-ignis" }, null, {
      expectedVersion: 7,
      ids: { requestId: "r", commandId: "c-ignis" }
    });
    expect(rockPacket?.command).toEqual({ type: "play-card", cardUID: "hand-uid-2", windowId: "window-main" });
    expect(ignisPacket?.command).toEqual({ type: "play-card", cardUID: "hand-uid-1", windowId: "window-main" });
  });

  it("distinguishes two same-named, different-UID actions by identity while sharing a label", () => {
    const projection = makeProjection({
      ownHand: [
        { uid: "hand-uid-a", cardId: "card-ignis" },
        { uid: "hand-uid-b", cardId: "card-ignis" }
      ],
      actions: [
        playAction({ id: "act-a", cardUID: "hand-uid-a" }),
        playAction({ id: "act-b", cardUID: "hand-uid-b" })
      ]
    });
    const a = projection.actions.find(action => action.id === "act-a")!;
    const b = projection.actions.find(action => action.id === "act-b")!;
    // Same resolved label...
    expect(duelActionDisplayLabel(a, projection, resolveCardName)).toBe(
      duelActionDisplayLabel(b, projection, resolveCardName)
    );
    // ...but the opaque identities and submitted cardUIDs stay distinct.
    const aPacket = buildDuelCommandPacket(a, { ...EMPTY_DUEL_ACTIONS_SELECTION, actionId: "act-a" }, null, {
      expectedVersion: 7,
      ids: { requestId: "r", commandId: "c-a" }
    });
    const bPacket = buildDuelCommandPacket(b, { ...EMPTY_DUEL_ACTIONS_SELECTION, actionId: "act-b" }, null, {
      expectedVersion: 7,
      ids: { requestId: "r", commandId: "c-b" }
    });
    expect(aPacket?.command).toEqual({ type: "play-card", cardUID: "hand-uid-a", windowId: "window-main" });
    expect(bPacket?.command).toEqual({ type: "play-card", cardUID: "hand-uid-b", windowId: "window-main" });
  });

  it("passes the exact action.cardUID/windowId/expectedVersion through the submit button", () => {
    const projection = makeProjection({
      ownHand: [{ uid: "hand-uid-1", cardId: "card-ignis" }],
      actions: [playAction({ id: "act-ignis", cardUID: "hand-uid-1", windowId: "window-xyz" })]
    });
    const onCommand = vi.fn();
    const generatePacketIds = () => ({ requestId: "req-1", commandId: "cmd-1" });
    // The panel is a presentation seam; exercise the exact pure submit boundary it uses.
    const action = projection.actions.find(entry => entry.id === "act-ignis")!;
    const packet = buildDuelCommandPacket(
      action,
      { ...EMPTY_DUEL_ACTIONS_SELECTION, actionId: "act-ignis" },
      null,
      { expectedVersion: projection.match.stateVersion, ids: generatePacketIds() }
    );
    expect(packet).toEqual({
      type: "duel-command",
      commandProfile: "duel-command-v3-actions-1",
      requestId: "req-1",
      commandId: "cmd-1",
      expectedVersion: 7,
      command: { type: "play-card", cardUID: "hand-uid-1", windowId: "window-xyz" }
    });
    // Rendering the same projection does not invoke onCommand on its own.
    render({ projection, resolveCardName, onCommand });
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("never surfaces an opponent's hidden hand even when stray hand data is present", () => {
    const projection = makeProjection({
      viewer: "alice",
      ownHand: [{ uid: "hand-uid-1", cardId: "card-ignis" }],
      opponentHand: [{ uid: "bob-uid-1", cardId: "card-rock" }],
      actions: [playAction({ id: "act-bob", cardUID: "bob-uid-1" })]
    });
    // The visibility guard is fail-closed: a `hand` key on the non-viewer seat is
    // rejected outright, and the display resolver only reads the *viewer's* hand.
    expect(isDuelProjectionV3Actions1(projection)).toBe(false);
    expect(duelPlayCardName(projection, "bob-uid-1", resolveCardName)).toBeNull();

    // With a legal projection (no opponent hand key), a play-card for a UID that is
    // not in the viewer's own hand still labels nothing and never leaks a name.
    const legal = makeProjection({
      viewer: "alice",
      ownHand: [{ uid: "hand-uid-1", cardId: "card-ignis" }],
      actions: [playAction({ id: "act-bob", cardUID: "bob-uid-1" })]
    });
    const html = render({ projection: legal, resolveCardName });
    expect(html).toContain('aria-label="打出单位"');
    expect(html).not.toContain(`打出单位${DUEL_ACTIONS_PLAY_CARD_LABEL_SEPARATOR}`);
    expect(html).not.toContain("碎星兽"); // opponent's card name never rendered
    expect(html).not.toContain("bob-uid-1"); // opponent UID never rendered
  });

  it("falls back to the unchanged server label when the catalog cannot name the card", () => {
    const projection = makeProjection({
      ownHand: [{ uid: "hand-uid-1", cardId: "card-unknown" }],
      actions: [playAction({ id: "act-x", cardUID: "hand-uid-1" })]
    });
    expect(duelPlayCardName(projection, "hand-uid-1", resolveCardName)).toBeNull();
    expect(duelActionDisplayLabel(projection.actions[0]!, projection, resolveCardName)).toBe("打出单位");
    const html = render({ projection, resolveCardName });
    expect(html).toContain('aria-label="打出单位"');
    expect(html).not.toContain(`打出单位${DUEL_ACTIONS_PLAY_CARD_LABEL_SEPARATOR}`);
    expect(html).not.toContain("card-unknown");
  });

  it("treats a resolver that echoes the raw card id (catalog miss) as unresolved", () => {
    const projection = makeProjection({
      ownHand: [{ uid: "hand-uid-1", cardId: "card-ignis" }],
      actions: [playAction({ id: "act-ignis", cardUID: "hand-uid-1" })]
    });
    // The parent resolver falls back to the raw card id on a catalog miss.
    const echoResolver = (cardId: string) => cardId;
    expect(duelPlayCardName(projection, "hand-uid-1", echoResolver)).toBeNull();
    const html = render({ projection, resolveCardName: echoResolver });
    expect(html).toContain('aria-label="打出单位"');
    expect(html).not.toContain("card-ignis");
  });

  it("falls back to the unchanged server label for a play-card UID absent from the own hand", () => {
    const projection = makeProjection({
      ownHand: [{ uid: "hand-uid-1", cardId: "card-ignis" }],
      actions: [playAction({ id: "act-missing", cardUID: "hand-uid-absent" })]
    });
    const html = render({ projection, resolveCardName });
    expect(html).toContain('aria-label="打出单位"');
    expect(html).not.toContain("hand-uid-absent");
    expect(html).not.toContain("铸光者");
  });

  it("keeps the plain server label when no resolver is injected (old hard expectations stay valid)", () => {
    const projection = makeProjection({
      ownHand: [{ uid: "hand-uid-1", cardId: "card-ignis" }],
      actions: [playAction({ id: "act-ignis", cardUID: "hand-uid-1" })]
    });
    const html = render({ projection });
    expect(html).toContain('aria-label="打出单位"');
    expect(buttonTag(html, "打出单位")).not.toContain("disabled");
    expect(html).not.toContain(`打出单位${DUEL_ACTIONS_PLAY_CARD_LABEL_SEPARATOR}`);
  });

  it("keeps the confirm button label aligned with the resolved action label", () => {
    const projection = makeProjection({
      ownHand: [{ uid: "hand-uid-1", cardId: "card-ignis" }],
      actions: [playAction({ id: "act-ignis", cardUID: "hand-uid-1" })]
    });
    const selection: DuelActionsSelection = { ...EMPTY_DUEL_ACTIONS_SELECTION, actionId: "act-ignis" };
    const html = render({ projection, resolveCardName, initialSelection: selection });
    const expectedLabel = `打出单位${DUEL_ACTIONS_PLAY_CARD_LABEL_SEPARATOR}铸光者`;
    expect(html).toContain(
      `aria-label="${DUEL_ACTIONS_SUBMIT_LABEL_PREFIX}${expectedLabel}"`
    );
    expect(buttonTag(html, `${DUEL_ACTIONS_SUBMIT_LABEL_PREFIX}${expectedLabel}`)).not.toContain("disabled");
  });

  it("does not label for a spectator viewer even when hand data is present", () => {
    const projection = makeProjection({
      viewer: null,
      ownHand: [{ uid: "hand-uid-1", cardId: "card-ignis" }],
      actions: []
    });
    expect(duelPlayCardName(projection, "hand-uid-1", resolveCardName)).toBeNull();
  });
});
