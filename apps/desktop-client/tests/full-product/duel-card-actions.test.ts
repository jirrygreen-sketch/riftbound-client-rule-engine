import { describe, expect, it } from "vitest";
import { isDuelProjectionV3Actions1 } from "@riftbound/protocol";
import type {
  DuelActionV3Actions1,
  DuelProjectionV3Actions1,
  DuelWireCard
} from "@riftbound/protocol";
import {
  buildDuelCommandPacket,
  resolveDuelActionIssue
} from "../../src/full-product/components/DuelActionsPanelV3";
import type { DuelActionsGateState } from "../../src/full-product/components/DuelActionsPanelV3";
import {
  duelCardActionIds,
  duelCardDropSelection,
  duelCardDropTargets
} from "../../src/full-product/interactions/duel-card-actions";

const ALICE_BASE = JSON.stringify(["duel-base", "alice"]);
const BOB_BASE = JSON.stringify(["duel-base", "bob"]);
const FIELD_A = JSON.stringify(["duel-battlefield", "bf-a"]);
const FIELD_B = JSON.stringify(["duel-battlefield", "bf-b"]);

const EMPTY_POOL = { energy: 0, power: { Fury: 0, Calm: 0, Mind: 0, Body: 0, Chaos: 0, Order: 0, any: 0 } };

interface UnitFixture {
  readonly objectId: string;
  readonly controllerPlayerId: "alice" | "bob";
  readonly locationId: string;
}

interface FixtureOptions {
  readonly viewer?: string | null;
  readonly stateVersion?: number;
  readonly hand?: readonly DuelWireCard[];
  readonly baseRunes?: readonly { readonly uid: string; readonly readied?: boolean }[];
  readonly goldTokens?: readonly { readonly uid: string }[];
  readonly units?: readonly UnitFixture[];
  readonly actions?: readonly DuelActionV3Actions1[];
}

function unitWire(unit: UnitFixture): Record<string, unknown> {
  return {
    objectId: unit.objectId,
    controllerPlayerId: unit.controllerPlayerId,
    locationId: unit.locationId,
    ownerPlayerId: unit.controllerPlayerId,
    readied: true,
    trait: { kind: "token", name: unit.objectId, baseMight: 2, tags: [] },
    totalDamage: 0,
    damageMarks: []
  };
}

/** Build a projection that genuinely passes the real P4 guard, never a shape-only stub. */
function makeProjection(options: FixtureOptions = {}): DuelProjectionV3Actions1 {
  const viewer = options.viewer === undefined ? "alice" : options.viewer;
  const units = options.units ?? [];
  const occupancy = (locationId: string) =>
    units.filter(unit => unit.locationId === locationId).map(unit => unit.objectId);

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
  if (viewer === "alice") {
    alicePlayer.hand = options.hand ?? [];
    alicePlayer.handCount = (options.hand ?? []).length;
  }
  if (viewer === "bob") bobPlayer.hand = [];

  const baseRunes = (options.baseRunes ?? []).map(rune => ({
    uid: rune.uid,
    cardId: "rune-card-1",
    domain: "Fury",
    readied: rune.readied ?? true,
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    locationId: ALICE_BASE
  }));
  const goldTokens = (options.goldTokens ?? []).map(token => ({
    uid: token.uid,
    readied: true,
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    locationId: ALICE_BASE
  }));

  const board = {
    bases: [
      { locationId: ALICE_BASE, ownerPlayerId: "alice", occupancy: occupancy(ALICE_BASE) },
      { locationId: BOB_BASE, ownerPlayerId: "bob", occupancy: occupancy(BOB_BASE) }
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
        occupancy: occupancy(FIELD_A)
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
        occupancy: occupancy(FIELD_B)
      }
    ],
    units: units.map(unitWire),
    gears: []
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
      stateVersion: options.stateVersion ?? 7,
      eventSeq: 3,
      roster: [
        { playerId: "alice", displayName: "Alice" },
        { playerId: "bob", displayName: "Bob" }
      ],
      turnOrder: ["alice", "bob"],
      stage: "playing",
      players: [alicePlayer, bobPlayer],
      board,
      resources: {
        players: [
          { playerId: "alice", runePool: { ...EMPTY_POOL, power: { ...EMPTY_POOL.power } }, runeDeckCount: 8 },
          { playerId: "bob", runePool: { ...EMPTY_POOL, power: { ...EMPTY_POOL.power } }, runeDeckCount: 8 }
        ],
        bases: [
          { playerId: "alice", locationId: ALICE_BASE, baseRunes, goldTokens },
          { playerId: "bob", locationId: BOB_BASE, baseRunes: [], goldTokens: [] }
        ]
      },
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
      frame: {
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
      }
    },
    actions: options.actions ?? []
  } as unknown as DuelProjectionV3Actions1;
}

const HAND: readonly DuelWireCard[] = [
  { uid: "h1", cardId: "same-card" },
  { uid: "h2", cardId: "same-card" }
];

function playAction(id: string, cardUID: string, enabled = true): DuelActionV3Actions1 {
  return {
    id,
    kind: "play-card",
    label: "打出单位",
    enabled,
    ...(enabled ? {} : { reason: "等待规则闭合" }),
    cardUID,
    windowId: "window-main"
  };
}

function moveAction(
  id: string,
  selectableUnitUIDs: readonly string[],
  destinations: readonly { readonly locationId: string; readonly eligibleUnitUIDs: readonly string[] }[],
  enabled = true
): DuelActionV3Actions1 {
  return {
    id,
    kind: "standard-move",
    label: "移动",
    enabled,
    ...(enabled ? {} : { reason: "当前没有可移动的单位" }),
    windowId: "window-main",
    selectableUnitUIDs,
    destinations
  };
}

function runeAction(id: string, uid: string, kind: "rune-energy" | "rune-power"): DuelActionV3Actions1 {
  return { id, kind, label: "激活符文", enabled: true, uid };
}

function openGate(): DuelActionsGateState {
  return { connectionStatus: "connected", commandPending: false, projectionValid: true, ended: false };
}

describe("duel-card-actions mapper fixtures", () => {
  it("builds projections that pass the real P4 guard", () => {
    expect(
      isDuelProjectionV3Actions1(
        makeProjection({
          hand: HAND,
          baseRunes: [{ uid: "r1" }],
          goldTokens: [{ uid: "g1" }],
          units: [{ objectId: "unit-a1", controllerPlayerId: "alice", locationId: ALICE_BASE }],
          actions: [playAction("a1", "h1"), runeAction("a2", "r1", "rune-energy"),
            moveAction("a3", ["unit-a1"], [{ locationId: FIELD_A, eligibleUnitUIDs: ["unit-a1"] }])]
        })
      )
    ).toBe(true);
  });
});

describe("duelCardActionIds", () => {
  it("associates a hand card only with its own play-card action (duplicate names stay distinct)", () => {
    const projection = makeProjection({ hand: HAND, actions: [playAction("a-h1", "h1"), playAction("a-h2", "h2")] });
    expect(isDuelProjectionV3Actions1(projection)).toBe(true);
    expect(duelCardActionIds(projection, "h1")).toEqual(["a-h1"]);
    expect(duelCardActionIds(projection, "h2")).toEqual(["a-h2"]);
  });

  it("associates a base rune with rune-energy/rune-power and a gold token with gold-power", () => {
    const projection = makeProjection({
      baseRunes: [{ uid: "r1" }],
      goldTokens: [{ uid: "g1" }],
      actions: [runeAction("e1", "r1", "rune-energy"), runeAction("p1", "r1", "rune-power"), runeAction("gp1", "g1", "gold-power")]
    });
    expect(isDuelProjectionV3Actions1(projection)).toBe(true);
    expect(duelCardActionIds(projection, "r1")).toEqual(["e1", "p1"]);
    expect(duelCardActionIds(projection, "g1")).toEqual(["gp1"]);
  });

  it("associates a viewer unit with only the standard-move that selects it", () => {
    const projection = makeProjection({
      units: [
        { objectId: "unit-a1", controllerPlayerId: "alice", locationId: ALICE_BASE },
        { objectId: "unit-a2", controllerPlayerId: "alice", locationId: ALICE_BASE }
      ],
      actions: [
        moveAction("m1", ["unit-a1"], [{ locationId: FIELD_A, eligibleUnitUIDs: ["unit-a1"] }]),
        moveAction("m2", ["unit-a2"], [{ locationId: FIELD_B, eligibleUnitUIDs: ["unit-a2"] }])
      ]
    });
    expect(duelCardActionIds(projection, "unit-a1")).toEqual(["m1"]);
    expect(duelCardActionIds(projection, "unit-a2")).toEqual(["m2"]);
  });

  it("keeps an enabled play-card but also surfaces a disabled entry so the reason can be shown", () => {
    const projection = makeProjection({ hand: HAND, actions: [playAction("a-on", "h1"), playAction("a-off", "h2", false)] });
    expect(isDuelProjectionV3Actions1(projection)).toBe(true);
    expect(duelCardActionIds(projection, "h2")).toEqual(["a-off"]);
  });

  it("does not let a foreign play-card targeting a hidden/opponent UID become actionable", () => {
    const projection = makeProjection({ hand: HAND, actions: [playAction("a-leak", "bob-hidden-1")] });
    expect(isDuelProjectionV3Actions1(projection)).toBe(true);
    expect(duelCardActionIds(projection, "bob-hidden-1")).toEqual([]);
  });

  it("does not let a standard-move that lists an opponent unit become actionable", () => {
    const projection = makeProjection({
      units: [{ objectId: "unit-b1", controllerPlayerId: "bob", locationId: BOB_BASE }],
      actions: [moveAction("m-leak", ["unit-b1"], [{ locationId: ALICE_BASE, eligibleUnitUIDs: ["unit-b1"] }])]
    });
    expect(isDuelProjectionV3Actions1(projection)).toBe(true);
    expect(duelCardActionIds(projection, "unit-b1")).toEqual([]);
  });

  it("cross-checks nothing: a play-card for a unit UID and a move for a hand UID yield no option", () => {
    const projection = makeProjection({
      hand: HAND,
      units: [{ objectId: "unit-a1", controllerPlayerId: "alice", locationId: ALICE_BASE }],
      actions: [
        playAction("a-unit", "unit-a1"),
        moveAction("m-hand", ["h1"], [{ locationId: FIELD_A, eligibleUnitUIDs: ["h1"] }])
      ]
    });
    expect(isDuelProjectionV3Actions1(projection)).toBe(true);
    expect(duelCardActionIds(projection, "unit-a1")).toEqual([]);
    expect(duelCardActionIds(projection, "h1")).toEqual([]);
  });

  it("returns nothing for a spectator, an invalid projection or an unknown kind", () => {
    const spectator = makeProjection({ viewer: null });
    expect(isDuelProjectionV3Actions1(spectator)).toBe(true);
    expect(duelCardActionIds(spectator, "h1")).toEqual([]);

    const invalid = { projectionSchema: "riftbound-duel-v3-actions-1", viewerPlayerId: "alice",
      match: {}, actions: [{ id: "x", kind: "unknown-kind", label: "?", enabled: true }] };
    expect(isDuelProjectionV3Actions1(invalid)).toBe(false);
    expect(duelCardActionIds(invalid as unknown as DuelProjectionV3Actions1, "h1")).toEqual([]);
  });
});

describe("duelCardDropTargets", () => {
  it("offers only the viewer's own Base for a hand play-card", () => {
    const projection = makeProjection({ hand: HAND, actions: [playAction("a-h1", "h1")] });
    expect(isDuelProjectionV3Actions1(projection)).toBe(true);
    expect(duelCardDropTargets(projection, "h1")).toEqual([{ kind: "base", locationId: ALICE_BASE }]);
  });

  it("never offers a battlefield for a hand play-card even if a move action names the hand UID", () => {
    const projection = makeProjection({
      hand: HAND,
      actions: [
        playAction("a-h1", "h1"),
        moveAction("m-hand", ["h1"], [{ locationId: FIELD_A, eligibleUnitUIDs: ["h1"] }])
      ]
    });
    expect(isDuelProjectionV3Actions1(projection)).toBe(true);
    expect(duelCardDropTargets(projection, "h1")).toEqual([{ kind: "base", locationId: ALICE_BASE }]);
  });

  it("returns no target for resource runes or gold tokens (they are not dragged to a battlefield)", () => {
    const projection = makeProjection({
      baseRunes: [{ uid: "r1" }],
      goldTokens: [{ uid: "g1" }],
      actions: [runeAction("e1", "r1", "rune-energy"), runeAction("gp1", "g1", "gold-power")]
    });
    expect(duelCardDropTargets(projection, "r1")).toEqual([]);
    expect(duelCardDropTargets(projection, "g1")).toEqual([]);
  });

  it("offers exactly the enabled standard-move destinations that list the unit", () => {
    const projection = makeProjection({
      units: [{ objectId: "unit-a1", controllerPlayerId: "alice", locationId: ALICE_BASE }],
      actions: [
        moveAction("m1", ["unit-a1"], [
          { locationId: FIELD_A, eligibleUnitUIDs: ["unit-a1"] },
          { locationId: FIELD_B, eligibleUnitUIDs: ["unit-a1"] }
        ])
      ]
    });
    expect(isDuelProjectionV3Actions1(projection)).toBe(true);
    expect(duelCardDropTargets(projection, "unit-a1")).toEqual([
      { kind: "battlefield", locationId: FIELD_A },
      { kind: "battlefield", locationId: FIELD_B }
    ]);
  });

  it("excludes a disabled move action so a disabled entry is display-only", () => {
    const projection = makeProjection({
      units: [{ objectId: "unit-a1", controllerPlayerId: "alice", locationId: ALICE_BASE }],
      actions: [moveAction("m-off", ["unit-a1"], [{ locationId: FIELD_A, eligibleUnitUIDs: ["unit-a1"] }], false)]
    });
    expect(isDuelProjectionV3Actions1(projection)).toBe(true);
    expect(duelCardActionIds(projection, "unit-a1")).toEqual(["m-off"]);
    expect(duelCardDropTargets(projection, "unit-a1")).toEqual([]);
  });

  it("ignores an eligible list that names another unit and returns nothing for a foreign card", () => {
    const projection = makeProjection({
      units: [
        { objectId: "unit-a1", controllerPlayerId: "alice", locationId: ALICE_BASE },
        { objectId: "unit-a2", controllerPlayerId: "alice", locationId: ALICE_BASE }
      ],
      actions: [moveAction("m1", ["unit-a2"], [{ locationId: FIELD_A, eligibleUnitUIDs: ["unit-a2"] }])]
    });
    expect(duelCardDropTargets(projection, "unit-a1")).toEqual([]);
    expect(duelCardDropTargets(projection, "bob-any")).toEqual([]);
  });
});

describe("duelCardDropSelection", () => {
  it("prefills the own-Base play-card with no move fields and still passes build/resolve", () => {
    const projection = makeProjection({ hand: HAND, actions: [playAction("a-h1", "h1")] });
    const selection = duelCardDropSelection(projection, "h1", ALICE_BASE);
    expect(selection).toEqual({ actionId: "a-h1", moveUnitUIDs: [], moveDestinationLocationId: null,
      choiceOptionIds: {}, allocationAmounts: {} });
    const action = projection.actions[0]!;
    expect(resolveDuelActionIssue(action, selection!, null, openGate())).toBeNull();
    expect(buildDuelCommandPacket(action, selection!, null, { expectedVersion: 7, ids: { requestId: "r", commandId: "c" } })).toEqual({
      type: "duel-command", commandProfile: "duel-command-v3-actions-1", requestId: "r", commandId: "c", expectedVersion: 7,
      command: { type: "play-card", cardUID: "h1", windowId: "window-main" }
    });
  });

  it("prefills exactly the unit UID and the exact destination, and still passes build/resolve", () => {
    const projection = makeProjection({
      units: [{ objectId: "unit-a1", controllerPlayerId: "alice", locationId: ALICE_BASE }],
      actions: [moveAction("m1", ["unit-a1"], [{ locationId: FIELD_A, eligibleUnitUIDs: ["unit-a1"] }])]
    });
    const selection = duelCardDropSelection(projection, "unit-a1", FIELD_A);
    expect(selection).toEqual({ actionId: "m1", moveUnitUIDs: ["unit-a1"], moveDestinationLocationId: FIELD_A,
      choiceOptionIds: {}, allocationAmounts: {} });
    const action = projection.actions[0]!;
    expect(resolveDuelActionIssue(action, selection!, null, openGate())).toBeNull();
    expect(buildDuelCommandPacket(action, selection!, null, { expectedVersion: 7, ids: { requestId: "r", commandId: "c" } })).toEqual({
      type: "duel-command", commandProfile: "duel-command-v3-actions-1", requestId: "r", commandId: "c", expectedVersion: 7,
      command: { type: "standard-move", windowId: "window-main", unitUIDs: ["unit-a1"], destinationLocationId: FIELD_A }
    });
  });

  it("returns null for an illegal or stale destination, a disabled action, a rune and a foreign/spectator card", () => {
    const projection = makeProjection({
      hand: HAND,
      baseRunes: [{ uid: "r1" }],
      units: [{ objectId: "unit-a1", controllerPlayerId: "alice", locationId: ALICE_BASE }],
      actions: [
        playAction("a-h1", "h1"),
        playAction("a-h2", "h2", false),
        runeAction("e1", "r1", "rune-energy"),
        moveAction("m1", ["unit-a1"], [{ locationId: FIELD_A, eligibleUnitUIDs: ["unit-a1"] }]),
        moveAction("m-off", ["unit-a1"], [{ locationId: FIELD_B, eligibleUnitUIDs: ["unit-a1"] }], false)
      ]
    });
    expect(isDuelProjectionV3Actions1(projection)).toBe(true);
    // illegal destination not listed by the move action
    expect(duelCardDropSelection(projection, "unit-a1", FIELD_B)).toBeNull();
    // destination not on the board at all
    expect(duelCardDropSelection(projection, "unit-a1", JSON.stringify(["duel-battlefield", "nope"]))).toBeNull();
    // disabled hand play-card
    expect(duelCardDropSelection(projection, "h2", ALICE_BASE)).toBeNull();
    // resource rune has no drop
    expect(duelCardDropSelection(projection, "r1", ALICE_BASE)).toBeNull();
    // hidden/foreign card
    expect(duelCardDropSelection(projection, "bob-hidden-1", ALICE_BASE)).toBeNull();

    const spectator = makeProjection({ viewer: null });
    expect(duelCardDropSelection(spectator, "h1", ALICE_BASE)).toBeNull();
  });

  it("recomputes a fresh temporary selection on a new state version and drops a stale destination", () => {
    const before = makeProjection({
      stateVersion: 7,
      units: [{ objectId: "unit-a1", controllerPlayerId: "alice", locationId: ALICE_BASE }],
      actions: [moveAction("m1", ["unit-a1"], [{ locationId: FIELD_A, eligibleUnitUIDs: ["unit-a1"] }])]
    });
    const after = makeProjection({
      stateVersion: 8,
      units: [{ objectId: "unit-a1", controllerPlayerId: "alice", locationId: ALICE_BASE }],
      actions: [moveAction("m2", ["unit-a1"], [{ locationId: FIELD_B, eligibleUnitUIDs: ["unit-a1"] }])]
    });
    const first = duelCardDropSelection(before, "unit-a1", FIELD_A);
    const second = duelCardDropSelection(after, "unit-a1", FIELD_B);
    expect(first?.actionId).toBe("m1");
    expect(second?.actionId).toBe("m2");
    expect(first).not.toBe(second);
    // the destination from the previous version is stale in the new projection
    expect(duelCardDropSelection(after, "unit-a1", FIELD_A)).toBeNull();
    expect(duelCardActionIds(after, "unit-a1")).toEqual(["m2"]);
  });
});
