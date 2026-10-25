import { mkdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { V2Projection } from "../../../protocol/src/v2/index.js";
import { botCommand, projectedCombatDamagePlayer } from "../../src/v2-duel/bot.js";
import { dueSetupPlayer, runV2Duel } from "../../src/v2-duel/runner.js";
import { V2_DUEL_FIXED_SEEDS } from "../../src/v2-duel/types.js";

const outputDirectory = `/tmp/${process.env.SWARM_TASK ?? "RIFT-955-v2-two-client-duel"}/v2-duel`;
const portBase = Number(process.env.SWARM_PORT_BASE ?? "31800");
const portSpan = Number(process.env.SWARM_PORT_SPAN ?? "20");

describe("RIFT-955 V2 two-client duel", () => {
  it("answers the setup window with the explicit keep-all Mulligan command", () => {
    const projection = {
      projectionContract: "riftbound.protocol.v2.projection",
      protocolVersion: "2.0.0",
      rulesetVersion: "core-1.5",
      matchId: "RIFT-955-v2-07",
      viewerPlayerId: "player-1",
      stateVersion: 0,
      eventSeq: 0,
      phase: "setup",
      turnNumber: 1,
      activePlayerId: "player-1",
      players: ["player-1", "player-2"].map(playerId => ({
        playerId, name: playerId, score: 0, energy: 0, power: {}, xp: 0,
        handCount: 4, deckCount: 16, runeDeckCount: 0, zoneCounts: {},
      })),
      zones: [],
      objects: [],
      chain: { status: "closed", phase: "open", priorityPlayerId: null,
        focusPlayerId: null, items: [] },
      priority: { playerId: null, focusPlayerId: null, window: "choice" },
      scoring: { victoryScore: 8, battlefieldLocationIds: [], players: [] },
      battlefields: [],
      combat: { status: "none" },
      actionOptions: { canEndTurn: false, canAdvance: false, moves: [], plays: [] },
      pendingChoice: {
        status: "pending", choiceId: "mulligan:RIFT-955-v2-07:A",
        ownerPlayerId: "player-1", stateVersion: 0, kind: "select-objects",
        options: [{ id: "token:1", label: "First", value: "token:1",
          objectRef: { objectId: "token:1", zoneEntryId: 1 } }], min: 0, max: 2,
      },
      winnerPlayerId: null,
      events: [],
    } satisfies V2Projection;

    expect(botCommand(projection, "player-1", "RIFT-1050-mulligan-setup"))
      .toEqual({ type: "mulligan", commandId: "RIFT-1050-mulligan-setup",
        stateVersion: 0, selectedObjectIds: [] });
    expect(botCommand(projection, "player-2", "RIFT-1050-wrong-mulligan-actor")).toBeNull();
  });

  it("uses the projected Combat handoff instead of repeating a no-progress pass", () => {
    const projection = {
      projectionContract: "riftbound.protocol.v2.projection",
      protocolVersion: "2.0.0",
      rulesetVersion: "core-1.5",
      matchId: "RIFT-955-v2-07",
      viewerPlayerId: "player-2",
      stateVersion: 108,
      eventSeq: 1852,
      phase: "main",
      turnNumber: 16,
      activePlayerId: "player-2",
      players: ["player-1", "player-2"].map((playerId, index) => ({
        playerId, name: playerId, score: 0, energy: 3, power: {}, xp: 0,
        handCount: 0, deckCount: 20 - index, runeDeckCount: 0, zoneCounts: {},
      })),
      zones: [],
      objects: [],
      chain: {
        status: "closed", phase: "open", priorityPlayerId: "player-2",
        focusPlayerId: null, items: [],
      },
      priority: { playerId: "player-2", focusPlayerId: null, window: "open" },
      scoring: { victoryScore: 8, battlefieldLocationIds: ["bf-1"], players: [] },
      battlefields: [],
      combat: {
        status: "active", battlefieldId: "bf-1", step: "showdown",
        combatId: "combat:bf-1:1", attackerPlayerId: "player-2",
        defenderPlayerId: "player-1",
      },
      actionOptions: { canEndTurn: false, canAdvance: true, moves: [], plays: [] },
      pendingChoice: { status: "none" },
      winnerPlayerId: null,
      events: [],
    } satisfies V2Projection;

    expect(botCommand(projection, "player-2", "RIFT-1050-combat-handoff"))
      .toEqual({ type: "advance", commandId: "RIFT-1050-combat-handoff", stateVersion: 108 });
  });

  it("maps a legacy engine seat in the Combat damage window to its public actor", () => {
    const projection = {
      projectionContract: "riftbound.protocol.v2.projection",
      protocolVersion: "2.0.0",
      rulesetVersion: "core-1.5",
      matchId: "RIFT-955-v2-07",
      viewerPlayerId: "player-2",
      stateVersion: 109,
      eventSeq: 1852,
      phase: "main",
      turnNumber: 16,
      activePlayerId: "player-2",
      players: ["player-1", "player-2"].map(playerId => ({
        playerId, name: playerId, score: 0, energy: 0, power: {}, xp: 0,
        handCount: 0, deckCount: 20, runeDeckCount: 0, zoneCounts: {},
      })),
      zones: [],
      chain: { status: "closed", phase: "open", priorityPlayerId: "player-2",
        focusPlayerId: null, items: [] },
      priority: { playerId: "player-2", focusPlayerId: null, window: "open" },
      scoring: { victoryScore: 8, battlefieldLocationIds: ["bf-1"], players: [] },
      battlefields: [{
        battlefieldId: "bf-1", controllerPlayerId: "player-1",
        contestedByPlayerId: null, staged: "none", occupantObjectIds: ["unit-1", "unit-2"],
      }],
      objects: [
        { objectId: "unit-1", ownerPlayerId: "player-1", controllerPlayerId: "player-1",
          zone: "board", might: 2, location: { kind: "battlefield", battlefieldId: "bf-1" } },
        { objectId: "unit-2", ownerPlayerId: "player-2", controllerPlayerId: "player-2",
          zone: "board", might: 3, location: { kind: "battlefield", battlefieldId: "bf-1" } },
      ],
      combat: { status: "active", battlefieldId: "bf-1", step: "damage",
        combatId: "combat:bf-1:1", attackerPlayerId: "B", defenderPlayerId: "A",
        damage: { attackerMight: 3, defenderMight: 2, attackerSubmitted: false,
          expectedPlayerId: "B" } },
      actionOptions: { canEndTurn: false, canAdvance: false, moves: [], plays: [] },
      pendingChoice: { status: "none" }, winnerPlayerId: null, events: [],
    } satisfies V2Projection;

    expect(projectedCombatDamagePlayer(projection)).toBe("player-2");
    const defenderWindow = {
      ...projection,
      viewerPlayerId: "player-1",
      activePlayerId: "player-1",
      combat: { ...projection.combat, damage: { ...projection.combat.damage!, attackerSubmitted: true,
        expectedPlayerId: "A" } },
    } satisfies V2Projection;
    expect(projectedCombatDamagePlayer(defenderWindow)).toBe("player-1");
    expect(botCommand(defenderWindow, "player-1", "RIFT-1050-defender-window"))
      .toMatchObject({ type: "combat-damage", combatId: "combat:bf-1:1",
        assignments: [{ unitObjectId: "unit-2", amount: 2 }] });
    expect(botCommand(projection, "player-1", "RIFT-1050-wrong-damage-actor")).toBeNull();
    expect(botCommand(projection, "player-2", "RIFT-1050-damage-actor")).toMatchObject({
      type: "combat-damage", combatId: "combat:bf-1:1",
      assignments: [{ unitObjectId: "unit-1", amount: 3 }],
    });
  });

  it("selects the due setup seat from the pair's complementary private views", () => {
    const base = {
      projectionContract: "riftbound.protocol.v2.projection",
      protocolVersion: "2.0.0",
      rulesetVersion: "core-1.5",
      matchId: "RIFT-955-v2-07",
      stateVersion: 0,
      eventSeq: 0,
      phase: "setup",
      turnNumber: 1,
      activePlayerId: "player-1",
      players: ["player-1", "player-2"].map(playerId => ({
        playerId, name: playerId, score: 0, energy: 0, power: {}, xp: 0,
        handCount: 4, deckCount: 16, runeDeckCount: 0, zoneCounts: {},
      })),
      zones: [], objects: [],
      chain: { status: "closed", phase: "open", priorityPlayerId: null,
        focusPlayerId: null, items: [] },
      priority: { playerId: null, focusPlayerId: null, window: "choice" },
      scoring: { victoryScore: 8, battlefieldLocationIds: [], players: [] },
      battlefields: [], combat: { status: "none" },
      actionOptions: { canEndTurn: false, canAdvance: false, moves: [], plays: [] },
      winnerPlayerId: null, events: [],
    } as const;
    const first = {
      ...base, viewerPlayerId: "player-1",
      pendingChoice: { status: "pending", choiceId: "mulligan:RIFT-955-v2-07:A",
        ownerPlayerId: "player-1", stateVersion: 0, kind: "select-objects",
        options: [{ id: "token:1", label: "First", value: "token:1",
          objectRef: { objectId: "token:1", zoneEntryId: 1 } }], min: 0, max: 2 },
    } satisfies V2Projection;
    const second = {
      ...base, viewerPlayerId: "player-2", pendingChoice: { status: "none" },
    } satisfies V2Projection;

    expect(dueSetupPlayer([first, second])).toBe("player-1");
    expect(dueSetupPlayer([second, first])).toBe("player-1");
    expect(dueSetupPlayer([second, { ...second, viewerPlayerId: "player-1" }])).toBeNull();
  });

  for (const [index, seed] of V2_DUEL_FIXED_SEEDS.entries()) {
    it(`runs private protocol clients for ${seed}`, async () => {
      await mkdir(outputDirectory, { recursive: true });
      const creator = index % 2 === 0 ? "first" : "second";
      const result = await runV2Duel({ seed, port: portBase + (index % portSpan), outputDirectory,
        maxActions: 500, creator, actionTimeoutMs: 45_000,
        acknowledgementTimeoutMs: 60_000, totalTimeoutMs: 780_000 });
      expect(["player-1", "player-2"]).toContain(result.firstPlayerSeat);
      expect(result.firstPlayerSeat).toBe(creator === "first" ? "player-1" : "player-2");
      expect(result.privacy.violations).toEqual([]);
      expect(result.privacy.checkedProjections).toBeGreaterThan(0);
      // The fixed acceptance line requires a natural authoritative result.
      // A command timeout or no-op guard is evidence for the parent/owner, not
      // an acceptable terminal state for this gate.
      expect(result.termination, result.blockedReason ?? undefined).toBe("winner");
      expect(result.winnerPlayerId).not.toBeNull();
    }, 850_000);
  }
});
