import { beforeAll, describe, expect, it } from "vitest";
import {
  FOUNDATION_RULESET_ID,
  TRIGGER_CONQUER_CARD,
  isPrompt,
  type GameEvent
} from "@riftbound/protocol";

type EngineModule = typeof import("@riftbound/engine-core");

const players = [
  { id: "player-1", name: "Alice" },
  { id: "player-2", name: "Bob" }
] as const;

let engine: EngineModule;

beforeAll(async () => {
  try {
    const loaded = await import("@riftbound/engine-core");
    for (const exportName of ["createInitialGame", "submitCommand", "projectGame"] as const) {
      if (typeof loaded[exportName] !== "function") {
        throw new Error(`Required @riftbound/engine-core export is missing: ${exportName}`);
      }
    }
    engine = loaded;
  } catch (error: unknown) {
    throw new Error(
      "Required @riftbound/engine-core exports could not be loaded from source. " +
      "Fix the package export/syntax error instead of skipping this integration suite.",
      { cause: error }
    );
  }
});

describe("synthetic-demo engine vertical slice", () => {
  it("auto-resolves mandatory work and creates a typed optional trigger prompt", () => {
    const state = createSyntheticDemo();
    const result = engine.submitCommand(state, {
      type: "play-card",
      playerId: "player-1",
      instanceId: "player-1:trigger-conquer"
    });

    expect(result.error).toBeNull();
    expect(result.events.map(event => event.type)).toEqual([
      "card-played",
      "task-resolved",
      "prompt-created"
    ]);
    expect(result.events[1]).toMatchObject({
      type: "task-resolved",
      reason: "resolve-card",
      autoResolved: true
    });
    expect(result.state.prompt).toMatchObject({
      ownerPlayerId: "player-1",
      playerId: "player-1",
      reason: "trigger-conquer",
      optional: true
    });
    expect(isPrompt(result.state.prompt)).toBe(true);
  });

  it("resolves and skips the optional prompt through the engine transaction", () => {
    const played = engine.submitCommand(createSyntheticDemo(), {
      type: "play-card",
      playerId: "player-1",
      instanceId: "player-1:trigger-conquer"
    });
    const prompt = played.state.prompt;
    if (!prompt) throw new Error("Expected trigger prompt after playing the card");

    const resolved = engine.submitCommand(played.state, {
      type: "respond-to-prompt",
      playerId: "player-1",
      promptId: prompt.id,
      optionId: "resolve",
      stateVersion: prompt.stateVersion
    });
    expect(resolved.error).toBeNull();
    expect(resolved.state.prompt).toBeNull();
    expect((resolved.state.players[1] as { points?: number } | undefined)?.points).toBe(19);
    expect(resolved.events.map(event => event.type)).toEqual([
      "prompt-answered",
      "damage-dealt"
    ]);

    const skipped = engine.submitCommand(played.state, {
      type: "respond-to-prompt",
      playerId: "player-1",
      promptId: prompt.id,
      optionId: "skip",
      stateVersion: prompt.stateVersion
    });
    expect(skipped.error).toBeNull();
    expect((skipped.state.players[1] as { points?: number } | undefined)?.points).toBe(20);
    expect(skipped.events.at(-1)?.type).toBe("trigger-skipped");
  });

  it("keeps hidden cards and prompt ownership private per viewer", () => {
    const initial = createSyntheticDemo();
    const aliceInitial = engine.projectGame(initial, "player-1");
    const bobInitial = engine.projectGame(initial, "player-2");

    expect(aliceInitial.players[0]?.hand).toHaveLength(1);
    expect(aliceInitial.players[1]?.hand).toHaveLength(0);
    expect(bobInitial.players[0]?.hand).toHaveLength(0);
    expect(bobInitial.players[1]?.hand).toHaveLength(1);

    const played = engine.submitCommand(initial, {
      type: "play-card",
      playerId: "player-1",
      instanceId: "player-1:trigger-conquer"
    }).state;

    const alice = engine.projectGame(played, "player-1");
    const bob = engine.projectGame(played, "player-2");
    const publicView = engine.projectGame(played);

    expect(alice.players[0]?.hand).toHaveLength(0);
    expect(alice.players[1]?.hand).toHaveLength(0);
    expect(alice.prompt?.ownerPlayerId).toBe("player-1");

    expect(bob.players[0]?.hand).toHaveLength(0);
    expect(bob.players[1]?.hand).toHaveLength(1);
    expect(bob.prompt).toBeNull();

    expect(publicView.players.every(player => player.hand.length === 0)).toBe(true);
    expect(publicView.prompt).toBeNull();
  });

  it("rejects illegal commands transactionally without mutating authoritative state", () => {
    const state = createSyntheticDemo();
    const snapshot = structuredClone(state);
    const wrongPlayer = engine.submitCommand(state, {
      type: "play-card",
      playerId: "player-2",
      instanceId: "player-2:trigger-conquer"
    });

    expect(wrongPlayer.error?.code).toBe("not_your_turn");
    expect(wrongPlayer.state).toBe(state);
    expect(wrongPlayer.events).toEqual([]);
    expect(state).toEqual(snapshot);

    const duplicate = engine.submitCommand(state, {
      type: "pass",
      playerId: "player-1"
    });
    const stalePrompt = engine.submitCommand(duplicate.state, {
      type: "respond-to-prompt",
      playerId: "player-2",
      promptId: "prompt:missing",
      optionId: "resolve"
    });
    expect(stalePrompt.error?.code).toBe("prompt_not_found");
    expect(stalePrompt.state).toBe(duplicate.state);
  });

  it("produces ordered, JSON-serializable events suitable for replay", () => {
    const state = createSyntheticDemo();
    const serialized = JSON.stringify(state);
    const events = state.eventLog as readonly GameEvent[];

    expect(JSON.parse(serialized)).toEqual(state);
    expect(events.map(event => event.seq)).toEqual([1, 2]);
    expect(events.every(event => event.turnNumber >= 1)).toBe(true);
  });
});

function createSyntheticDemo() {
  return engine.createInitialGame({ players });
}

describe("foundation engine projection vertical slice", () => {
  it("starts from submitted cards and keeps private zones out of opponent/public views", () => {
    const configured = engine.createConfiguredGame;
    if (typeof configured !== "function") {
      throw new Error("createConfiguredGame must be exported for foundation start.");
    }
    const state = configured({
      players: [
        {
          id: "player-1",
          name: "Alice",
          startingHand: [{
            instanceId: "p1:flame",
            cardId: "integration.flame-warden.standard"
          }],
          deck: [
            { instanceId: "p1:deck-1", cardId: "integration.flame-warden.alternate" },
            { instanceId: "p1:deck-2", cardId: "integration.tide-oracle" }
          ]
        },
        {
          id: "player-2",
          name: "Bob",
          startingHand: [],
          deck: [
            { instanceId: "p2:deck-1", cardId: "integration.tide-oracle" },
            { instanceId: "p2:deck-2", cardId: "integration.tide-oracle" }
          ]
        }
      ],
      cards: [
        {
          id: "integration.flame-warden.standard",
          name: "Flame Warden",
          cost: 2,
          types: ["unit"],
          health: 3
        },
        {
          id: "integration.flame-warden.alternate",
          name: "Flame Warden",
          cost: 2,
          types: ["unit"],
          health: 3
        },
        {
          id: "integration.tide-oracle",
          name: "Tide Oracle",
          cost: 1,
          types: ["unit"],
          health: 2
        }
      ],
      rules: {
        rulesetId: FOUNDATION_RULESET_ID,
        targetPoints: 8
      }
    });

    expect(state.rules.rulesetId).toBe(FOUNDATION_RULESET_ID);
    const aliceState = state.players[0] as { score: number; energy: number };
    const bobState = state.players[1] as { score: number; energy: number };
    expect(aliceState.score).toBe(0);
    expect(aliceState.energy).toBe(0);
    expect(bobState.score).toBe(0);
    expect(state.players[0]?.hand.map(card => card.cardId))
      .toContain("integration.flame-warden.standard");
    expect((state.players[0] as { deck: string[] }).deck)
      .toEqual(["p1:deck-1", "p1:deck-2"]);

    const alice = engine.projectGame(state, "player-1");
    const bob = engine.projectGame(state, "player-2");
    const publicView = engine.projectGame(state);

    expect(alice.players[0]?.hand.map(card => card.cardId))
      .toContain("integration.flame-warden.standard");
    expect(alice.players[1]?.hand).toEqual([]);
    expect(bob.players[1]?.hand).toEqual([]);
    expect(publicView.players.every(player => player.hand.length === 0)).toBe(true);
    expect(alice.rulesetId).toBe(FOUNDATION_RULESET_ID);
    expect(alice.objects).toBeDefined();
  });
});
