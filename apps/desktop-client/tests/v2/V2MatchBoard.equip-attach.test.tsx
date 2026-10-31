import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import { V2MatchBoard } from "../../src/full-product/v2/V2MatchBoard";
import { v2AttachmentsByHost, v2GroupUnits } from "../../src/full-product/v2/unit-groups";
import { createV2ChoiceUiState, createV2ClientState, type V2ClientState } from "../../src/state/v2";
import type { CatalogCard } from "../../src/net/CardCatalogClient";
import type { V2Projection } from "../../../../../packages/protocol/src/v2/index.js";

// RIFT-1180: Equipment attached to a unit (Long Sword after Quick-Draw) is
// drawn under that unit instead of in a board slot of its own.
type Obj = V2Projection["objects"][number];

const rumble = {
  id: "sfd-089-221", name: "Rumble", localizedName: "兰博", cardType: "Unit", domains: ["Fury"],
  energy: 5, power: 1, might: 4, imageUrl: "https://example.test/rumble.png"
} as unknown as CatalogCard;
const longSword = {
  id: "sfd-122-221", name: "Long Sword", localizedName: "长剑", cardType: "Gear", domains: ["Fury"],
  energy: 2, power: 1, imageUrl: "https://example.test/long-sword.png"
} as unknown as CatalogCard;

const unit = (objectId: string, extra: Partial<Obj> = {}): Obj => ({
  objectId, zoneEntryId: 2, zone: "board", ownerPlayerId: "alice", cardId: "sfd-089-221", name: "Rumble",
  faceDown: false, visibility: "public", exhausted: false, damage: 0, might: 4,
  location: { kind: "base", playerId: "alice" }, ...extra
} as Obj);
const sword = (objectId: string, host: string | undefined, extra: Partial<Obj> = {}): Obj => ({
  objectId, zoneEntryId: 3, zone: "board", ownerPlayerId: "alice", cardId: "sfd-122-221", name: "Long Sword",
  faceDown: false, visibility: "public", exhausted: false, damage: 0,
  location: { kind: "base", playerId: "alice" }, ...(host === undefined ? {} : { attachedToObjectId: host }), ...extra
} as Obj);

function projection(objects: readonly Obj[]): V2Projection {
  return {
    projectionContract: "riftbound.protocol.v2.projection",
    protocolVersion: "2.0.0",
    rulesetVersion: "core-1.5",
    matchId: "rift-1180-equip-attach",
    viewerPlayerId: "alice",
    stateVersion: 9,
    eventSeq: 3,
    phase: "main",
    turnNumber: 5,
    activePlayerId: "alice",
    players: [
      { playerId: "alice", name: "Alice", score: 0, energy: 0, power: {}, xp: 0, handCount: 0, deckCount: 20, runeDeckCount: 8, zoneCounts: {} },
      { playerId: "bob", name: "Bob", score: 0, energy: 0, power: {}, xp: 0, handCount: 0, deckCount: 20, runeDeckCount: 8, zoneCounts: {} }
    ],
    zones: [],
    objects,
    chain: { status: "open", phase: "await-commit", priorityPlayerId: null, focusPlayerId: null, items: [] },
    priority: { playerId: "alice", focusPlayerId: null, window: "main" },
    scoring: {
      victoryScore: 8,
      battlefieldLocationIds: [],
      players: [
        { playerId: "alice", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
        { playerId: "bob", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] }
      ]
    },
    battlefields: [],
    combat: { status: "none" },
    actionOptions: { canEndTurn: true, canAdvance: false, moves: [], plays: [] },
    pendingChoice: { status: "none" },
    winnerPlayerId: null,
    events: []
  } as V2Projection;
}

function render(objects: readonly Obj[]): string {
  const value = projection(objects);
  const state: V2ClientState = {
    ...createV2ClientState({ viewerPlayerId: "alice", now: 0, choiceTimeoutMs: 10_000 }),
    projection: value,
    stateVersion: value.stateVersion,
    eventSeq: value.eventSeq,
    choice: createV2ChoiceUiState(value.pendingChoice, { viewerPlayerId: "alice", now: 0, timeoutMs: 10_000 })
  };
  return renderToStaticMarkup(<V2MatchBoard state={state} initialCatalogCards={[rumble, longSword]} onCommand={async () => ({
    type: "command-receipt", protocolVersion: "2.0.0", commandId: "test", stateVersion: 10, eventSeq: 4,
    accepted: true, duplicate: false, rejection: null
  })} />);
}

describe("RIFT-1180 attached Equipment grouping", () => {
  it("files gear under its host and keeps the equipped unit out of a stack", () => {
    const objects = [unit("rumble-1"), unit("rumble-2"), unit("rumble-3"), sword("sword-1", "rumble-2")];
    expect([...v2AttachmentsByHost(objects)].map(([host, gear]) => [host, gear.map(item => item.objectId)]))
      .toEqual([["rumble-2", ["sword-1"]]]);
    const groups = v2GroupUnits(objects);
    expect(groups.map(group => group.objects.map(object => object.objectId))).toEqual([["rumble-1", "rumble-3"], ["rumble-2"]]);
    expect(groups.map(group => group.attachments.map(object => object.objectId))).toEqual([[], ["sword-1"]]);
  });

  it("keeps gear whose host is not in this row, or unattached gear, as a permanent of its own", () => {
    const groups = v2GroupUnits([unit("rumble-1"), sword("sword-1", "elsewhere"), sword("sword-2", undefined, { zoneEntryId: 4 })]);
    expect(groups.flatMap(group => group.objects.map(object => object.objectId))).toEqual(["rumble-1", "sword-1", "sword-2"]);
    expect(groups.every(group => group.attachments.length === 0)).toBe(true);
  });
});

describe("RIFT-1180 board draws gear under its unit", () => {
  it("renders Long Sword as the host's attachment, not as a separate board slot", () => {
    const html = render([unit("rumble-1", { might: 6 }), sword("sword-1", "rumble-1")]);
    expect(html).toContain('aria-label="兰博 装配的装备"');
    expect(html).toContain('data-object-id="sword-1" data-attached-to="rumble-1"');
    expect(html).toContain('title="装备：长剑（装配在兰博上）"');
    expect(html).toContain("<b>装备</b>长剑");
    // The sword is not also drawn as a stack of its own.
    expect(html.match(/class="v2m-stack[^"]*" data-object-id="sword-1"/g)).toBeNull();
    // The host's badge still shows the current Might with the gear's bonus.
    expect(html).toContain("<em>+2</em>");
  });

  it("draws unattached gear as a normal board slot", () => {
    const html = render([unit("rumble-1"), sword("sword-1", undefined)]);
    expect(html).not.toContain("v2m-attached");
    expect(html).toMatch(/class="v2m-stack[^"]*" data-object-id="sword-1"/);
  });
});
