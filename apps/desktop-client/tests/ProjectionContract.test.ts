import { describe, expect, it } from "vitest";
import {
  buildProjectedGameView,
  buildProjectedPlayerView,
  buildProjectedZones,
  getActionState,
  isPromptForViewer,
  isProjectionZone,
  PROJECTION_SCHEMA_V1,
  type ProjectionObject
} from "../src/game/projectionContract";
import {
  FOUNDATION_RULESET_ID,
  TRIGGER_CONQUER_CARD,
  type CardInstance,
  type GameProjection,
  type Prompt
} from "@riftbound/protocol";

const triggerCard: CardInstance = {
  instanceId: "instance-1",
  cardId: TRIGGER_CONQUER_CARD.id
};

const runeObject: ProjectionObject = {
  objectId: "rune-1",
  cardId: "rune.card",
  zone: "rune",
  controllerId: "player-1",
  ownerPlayerId: "player-1",
  faceUp: true
};

describe("projection contract", () => {
  it("treats the current wire projection as legacy synthetic and only exposes hand data", () => {
    const game = buildProjectedGameView(gameProjection({ schemaVersion: undefined }));
    expect(game.isLegacy).toBe(true);
    expect(game.schemaVersion).toBeNull();

    const player = buildProjectedPlayerView(game, "player-1");
    const zones = buildProjectedZones(player, "player-1");

    expect(player).toMatchObject({
      score: null,
      energy: null,
      playableInstanceIds: null,
      isLegacy: true,
      life: 20,
      mana: 1
    });
    expect(zones.find(zone => zone.zone === "hand")).toMatchObject({
      state: "ready",
      count: 1
    });
    expect(zones.filter(zone => zone.zone !== "hand").every(zone => zone.state === "awaiting-projection"))
      .toBe(true);
  });

  it("renders foundation score, energy, rune objects, and server-declared zones", () => {
    const game = buildProjectedGameView(gameProjection({ schemaVersion: PROJECTION_SCHEMA_V1 }));
    const player = buildProjectedPlayerView(game, "player-1");
    const zones = buildProjectedZones(player, "player-1");

    expect(game.isLegacy).toBe(false);
    expect(game.rulesetId).toBe(FOUNDATION_RULESET_ID);
    expect(player?.score).toBe(7);
    expect(player?.energy).toBe(3);
    expect(player?.zoneCounts).toMatchObject({
      hand: 1,
      rune: 1
    });
    expect(player?.runes).toEqual([runeObject]);
    expect(zones.map(zone => zone.zone)).toEqual(["rune", "hand"]);
    expect(zones.every(zone => zone.state === "ready")).toBe(true);
    expect(zones.find(zone => zone.zone === "rune")?.objects).toEqual([runeObject]);
  });

  it("does not invent unsupported zones and validates wire objects", () => {
    expect(isProjectionZone("rune")).toBe(true);
    expect(isProjectionZone("not-a-zone")).toBe(false);

    const invalidObject = { ...runeObject, zone: "not-a-zone" };
    const projection = gameProjection({ schemaVersion: PROJECTION_SCHEMA_V1 });
    (projection as { objects?: unknown }).objects = [invalidObject];
    const game = buildProjectedGameView(projection);

    expect(game.objects).toEqual([]);
  });

  it("keeps private zones hidden from opponent views", () => {
    const game = buildProjectedGameView(gameProjection({ schemaVersion: PROJECTION_SCHEMA_V1 }));
    const opponent = buildProjectedPlayerView(game, "player-2");
    const zones = buildProjectedZones(opponent, "player-2");

    expect(zones.find(zone => zone.zone === "hand")).toMatchObject({
      objects: [],
      count: 0
    });
    expect(zones.find(zone => zone.zone === "deck")).toBeUndefined();
    expect(zones.find(zone => zone.zone === "base")).toBeUndefined();
  });

  it("derives action availability and blocked reasons without guessing rules", () => {
    const ready = getActionState({
      connected: true,
      commandPending: false,
      projection: gameProjection({ schemaVersion: undefined, activePlayerId: "player-1" }),
      viewerPlayerId: "player-1",
      selectedCard: triggerCard
    });
    expect(ready).toMatchObject({
      canPass: true,
      canPlay: false,
      blockedReason: "等待服务端可操作列表"
    });

    const foundationPlayable = getActionState({
      connected: true,
      commandPending: false,
      projection: gameProjection({
        schemaVersion: PROJECTION_SCHEMA_V1,
        activePlayerId: "player-1",
        playableInstanceIds: ["instance-1"]
      }),
      viewerPlayerId: "player-1",
      selectedCard: triggerCard
    });
    expect(foundationPlayable).toMatchObject({ canPlay: true, blockedReason: null });

    const foundationNotPlayable = getActionState({
      connected: true,
      commandPending: false,
      projection: gameProjection({
        schemaVersion: PROJECTION_SCHEMA_V1,
        activePlayerId: "player-1",
        playableInstanceIds: []
      }),
      viewerPlayerId: "player-1",
      selectedCard: triggerCard
    });
    expect(foundationNotPlayable.canPlay).toBe(false);
    expect(foundationNotPlayable.blockedReason).toBe("服务端标记该牌当前不可打出");

    const prompt = getActionState({
      connected: true,
      commandPending: false,
      projection: gameProjection({
        schemaVersion: undefined,
        activePlayerId: "player-1",
        prompt: promptFor("player-1")
      }),
      viewerPlayerId: "player-1",
      selectedCard: triggerCard
    });
    expect(prompt).toMatchObject({
      canRespondPrompt: true,
      canPass: false,
      canPlay: false
    });

    const opponentPrompt = getActionState({
      connected: true,
      commandPending: false,
      projection: gameProjection({
        schemaVersion: undefined,
        activePlayerId: "player-1",
        prompt: promptFor("player-2")
      }),
      viewerPlayerId: "player-1",
      selectedCard: triggerCard
    });
    expect(opponentPrompt.blockedReason).toBe("等待对手响应 Prompt");
  });

  it("checks prompt ownership", () => {
    expect(isPromptForViewer(promptFor("player-1"), "player-1")).toBe(true);
    expect(isPromptForViewer(promptFor("player-1"), "player-2")).toBe(false);
  });
});

function gameProjection({
  schemaVersion,
  activePlayerId,
  mana = 1,
  playableInstanceIds,
  prompt = null
}: {
  schemaVersion?: string;
  activePlayerId?: string;
  mana?: number;
  playableInstanceIds?: readonly string[];
  prompt?: Prompt | null;
}): GameProjection {
  const base = {
    version: 1,
    eventSeq: 0,
    phase: "main" as const,
    turnNumber: 1,
    activePlayerId: activePlayerId ?? "player-2",
    winnerPlayerId: null,
    prompt,
    waitingForPlayerId: null,
    players: [
      {
        id: "player-1",
        name: "Alice",
        life: 20,
        mana,
        handCount: 1,
        hand: [triggerCard]
      },
      {
        id: "player-2",
        name: "Bob",
        life: 20,
        mana: 1,
        handCount: 0,
        hand: []
      }
    ],
    events: []
  };

  if (schemaVersion === undefined) return base;
  return {
    ...base,
    projectionSchema: schemaVersion,
    priority: { playerId: activePlayerId ?? "player-2" },
    objects: [runeObject],
    rulesetId: FOUNDATION_RULESET_ID,
    players: base.players.map(player =>
      player.id === "player-1"
        ? {
            ...player,
            life: undefined,
            mana: undefined,
            score: 7,
            energy: 3,
            power: { nature: 2 },
            zoneCounts: { hand: 1, rune: 1 },
            playableInstanceIds: playableInstanceIds ?? []
          }
        : {
            ...player,
            life: undefined,
            mana: undefined,
            score: 0,
            energy: 1,
            power: {},
            zoneCounts: { hand: 0 },
            playableInstanceIds: []
          }
    )
  } as unknown as GameProjection;
}

function promptFor(playerId: string): Prompt {
  return {
    id: "prompt-1",
    ownerPlayerId: playerId,
    playerId,
    stateVersion: 1,
    status: "pending",
    taskId: "task-1",
    reason: "trigger-conquer",
    optional: true,
    options: [{ id: "resolve", label: "Resolve" }]
  };
}
