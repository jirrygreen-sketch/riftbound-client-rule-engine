import type { PlayerId, RoomDeckSubmission } from "@riftbound/protocol";
import {
  createFullProductGame,
  listLegalActions as listEngineLegalActions,
  submitFullProductCommand,
  type FullProductCardDefinition,
  type FullProductCommand as EngineCommand,
  type FullProductGameState,
  type FullProductLegalAction as EngineLegalAction,
  type FullProductPrompt as EnginePrompt
} from "@riftbound/engine-core/experimental";
import { FullProductOrchestrationError } from "./errors.js";
import {
  FULL_PRODUCT_EVENT_CONTRACT,
  FULL_PRODUCT_PROJECTION_CONTRACT,
  FULL_PRODUCT_PROTOCOL_VERSION,
  FULL_PRODUCT_RULESET_ID
} from "@riftbound/protocol/full-product";
import type {
  FullProductRulesRuntime,
  FullProductRuntimeAuthority,
  FullProductRuntimeCommandResult,
  FullProductRuntimeMatchConfig,
  FullProductRuntimeProjection,
  FullProductRuntimeProjectionObject,
  FullProductRuntimePrompt,
  FullProductRuntimeEvent,
  FullProductRuntimeSnapshot,
  FullProductRuntimeStartResult
} from "./runtime.js";
import type {
  FullProductClientCommand,
  FullProductLegalAction,
  FullProductMatchResult,
  FullProductMatchSummary,
  FullProductRuntimeCommand
} from "./types.js";

export interface FullProductRuntimeAdapterOptions {
  readonly cards: readonly FullProductCardDefinition[];
  readonly startingLife: number;
  readonly maximumEnergy: number;
  readonly openingHandSize: number;
  readonly maximumBoardSize?: number;
  readonly drawPerTurn?: number;
}

interface RuntimeRecord {
  readonly engineState: FullProductGameState;
  readonly eventActors: ReadonlyMap<number, PlayerId>;
  readonly endReason: "life-zero" | "draw" | "concession" | null;
}

type EngineInstance = FullProductGameState["instances"][string];

const UNSUPPORTED_DECK_ZONES = [
  "runes",
  "legend",
  "champion",
  "battlefields",
  "sideboard"
] as const;

/**
 * Experimental life-based combat adapter, NOT the official Riftbound runtime.
 * It is intentionally not registered with the public server's room lifecycle.
 * Adapts the experimental engine to the room runtime contract.
 * The room owns lobby readiness; the engine's duplicated ready-check prompts
 * are consumed here before the match becomes visible to clients.
 */
export class FullProductEngineRuntimeAdapter
  implements FullProductRulesRuntime
{
  private readonly authorityMarker = Symbol("full-product-engine-authority");
  private readonly records = new WeakMap<
    FullProductRuntimeAuthority,
    RuntimeRecord
  >();
  private readonly definitions: ReadonlyMap<string, FullProductCardDefinition>;

  constructor(private readonly options: FullProductRuntimeAdapterOptions) {
    const definitions = new Map<string, FullProductCardDefinition>();
    for (const definition of options.cards) {
      if (definitions.has(definition.cardId)) {
        throw new Error(`Duplicate card definition ${definition.cardId}`);
      }
      definitions.set(definition.cardId, definition);
    }
    this.definitions = definitions;
  }

  createMatch(
    config: FullProductRuntimeMatchConfig
  ): FullProductRuntimeStartResult {
    let engineState = createFullProductGame({
      players: config.seats.map(seat => this.playerConfig(seat)),
      cards: [...this.definitions.values()],
      firstPlayerId: config.firstPlayerId,
      maximumBoardSize: this.options.maximumBoardSize,
      drawPerTurn: this.options.drawPerTurn
    });
    const eventActors = new Map<number, PlayerId>();

    while (engineState.prompt?.reason === "ready-check") {
      const prompt = engineState.prompt;
      const result = submitFullProductCommand(engineState, {
        type: "answer-prompt",
        playerId: prompt.playerId,
        promptId: prompt.promptId,
        optionId: "ready",
        stateVersion: prompt.stateVersion
      });
      if (result.error) {
        throw new Error(
          `Unable to complete authoritative setup: ${result.error.message}`
        );
      }
      for (const event of result.events) {
        if (event.type === "prompt-answered") {
          eventActors.set(event.seq, prompt.playerId);
        }
      }
      engineState = result.state;
    }

    if (engineState.prompt !== null || engineState.phase !== "main") {
      throw new Error("The engine did not enter its main phase after setup");
    }

    return {
      snapshot: this.snapshot({
        engineState,
        eventActors,
        endReason: null
      })
    };
  }

  submitCommand(
    snapshot: FullProductRuntimeSnapshot,
    command: FullProductRuntimeCommand
  ): FullProductRuntimeCommandResult {
    const record = this.requireRecord(snapshot);
    if (command.type === "concede") {
      return this.concede(record, command.playerId);
    }
    const engineCommand = this.translateCommand(
      record.engineState,
      command
    );
    if (engineCommand === null) {
      return {
        snapshot,
        error: {
          code: "invalid_command",
          message: "The command is not supported by the full-product runtime"
        }
      };
    }

    const result = submitFullProductCommand(
      record.engineState,
      engineCommand
    );
    if (result.error) {
      return { snapshot, error: result.error };
    }

    const eventActors = new Map(record.eventActors);
    for (const event of result.events) {
      if (event.type === "prompt-answered") {
        eventActors.set(event.seq, command.playerId);
      }
    }
    const nextRecord: RuntimeRecord = {
      engineState: result.state,
      eventActors,
      endReason: result.state.phase === "ended"
        ? result.state.winnerPlayerId === null ? "draw" : "life-zero"
        : record.endReason
    };
    return {
      snapshot: this.snapshot(nextRecord),
      error: null
    };
  }

  listLegalActions(
    snapshot: FullProductRuntimeSnapshot,
    playerId: PlayerId
  ): readonly FullProductLegalAction[] {
    const record = this.requireRecord(snapshot);
    const state = record.engineState;
    if (state.phase === "ended") return [];

    const prompt = this.protocolPrompt(state);
    if (prompt !== null) {
      if (prompt.ownerPlayerId !== playerId) return [];
      const actions = prompt.options.map(option => ({
        type: "respond-to-prompt" as const,
        playerId,
        promptId: prompt.promptId,
        optionId: option.optionId,
        ...(option.targetInstanceId === undefined
          ? {}
          : { targetInstanceId: option.targetInstanceId })
      }));
      return this.enginePromptAllowsPass(state, playerId)
        ? [...actions, { type: "pass" as const, playerId }]
        : actions;
    }

    const actions: FullProductLegalAction[] = [];
    for (const engineAction of listEngineLegalActions(state, playerId)) {
      if (engineAction.type === "play-card") {
        actions.push({
          type: "play-card",
          playerId,
          instanceId: engineAction.instanceId
        });
      } else if (
        engineAction.type === "pass-main" ||
        engineAction.type === "pass-battle" ||
        engineAction.type === "resolve-battle"
      ) {
        if (!actions.some(action => action.type === "pass")) {
          actions.push({ type: "pass", playerId });
        }
      }
    }
    return actions;
  }

  project(
    snapshot: FullProductRuntimeSnapshot,
    viewerPlayerId: PlayerId | null
  ): FullProductRuntimeProjection {
    const record = this.requireRecord(snapshot);
    const state = record.engineState;
    return {
      summary: this.summary(state),
      projectionContract: FULL_PRODUCT_PROJECTION_CONTRACT,
      protocolVersion: FULL_PRODUCT_PROTOCOL_VERSION,
      rulesetId: FULL_PRODUCT_RULESET_ID,
      players: state.players.map(player => ({
        id: player.playerId,
        name: player.name,
        score: player.life,
        energy: player.energy,
        power: {},
        zoneCounts: {
          hand: player.hand.length,
          deck: player.deck.length,
          board: player.board.length,
          discard: player.discard.length,
          banish: player.banish.length
        },
        handCount: player.hand.length,
        hand: viewerPlayerId === player.playerId
          ? player.hand.map(instanceId => this.cardInstance(state, instanceId))
          : [],
        playableInstanceIds: viewerPlayerId === player.playerId
          ? listEngineLegalActions(state, player.playerId)
              .flatMap(action =>
                action.instanceId === undefined ? [] : [action.instanceId]
              )
          : []
      })),
      objects: Object.values(state.instances)
        .flatMap(instance => this.visibleObject(instance, viewerPlayerId)),
      prompt: this.protocolPrompt(state),
      events: this.protocolEvents(record, viewerPlayerId)
    };
  }

  matchResult(
    snapshot: FullProductRuntimeSnapshot
  ): FullProductMatchResult | null {
    const record = this.requireRecord(snapshot);
    const state = record.engineState;
    if (state.phase !== "ended" || record.endReason === null) return null;
    return {
      winnerPlayerId: state.winnerPlayerId,
      reason: record.endReason,
      finalVersion: state.version,
      finalEventSeq: state.eventSeq
    };
  }

  private playerConfig(seat: {
    playerId: PlayerId;
    name: string;
    deck: RoomDeckSubmission;
  }) {
    for (const zone of UNSUPPORTED_DECK_ZONES) {
      if (seat.deck[zone] !== undefined) {
        throw new Error(
          `The full-product engine does not support deck zone ${zone}`
        );
      }
    }
    const instances: { instanceId: string; cardId: string }[] = [];
    const entries = seat.deck.mainDeck ?? [];
    for (const [entryIndex, entry] of entries.entries()) {
      const definition = this.definitions.get(entry.cardId);
      if (!definition) {
        throw new Error(`Unknown card definition ${entry.cardId}`);
      }
      if (!Number.isSafeInteger(entry.quantity) || entry.quantity < 1) {
        throw new Error(`Invalid quantity for card ${entry.cardId}`);
      }
      for (let copy = 1; copy <= entry.quantity; copy += 1) {
        instances.push({
          instanceId: `${seat.playerId}:mainDeck:${entryIndex}:${copy}`,
          cardId: entry.cardId
        });
      }
    }

    return {
      playerId: seat.playerId,
      name: seat.name,
      life: this.options.startingLife,
      maximumEnergy: this.options.maximumEnergy,
      deck: instances.slice(this.options.openingHandSize),
      startingHand: instances.slice(0, this.options.openingHandSize)
    };
  }

  private translateCommand(
    state: FullProductGameState,
    command: FullProductRuntimeCommand
  ): EngineCommand | null {
    switch (command.type) {
      case "pass":
        return this.passCommand(state, command.playerId);
      case "play-card":
        if (command.targets.length > 0) return null;
        return {
          type: "play-card",
          playerId: command.playerId,
          instanceId: command.instanceId
        };
      case "respond-to-prompt":
        return this.promptCommand(state, command);
      case "concede":
        return null;
    }
  }

  private passCommand(
    state: FullProductGameState,
    playerId: PlayerId
  ): EngineCommand | null {
    const actions = listEngineLegalActions(state, playerId);
    const passAction = actions.find(action =>
      action.type === "pass-main" ||
      action.type === "pass-battle" ||
      action.type === "resolve-battle"
    );
    if (!passAction) return null;
    return {
      type: passAction.type,
      playerId
    };
  }

  private promptCommand(
    state: FullProductGameState,
    command: Extract<FullProductClientCommand, {
      type: "respond-to-prompt";
    }> & { playerId: PlayerId }
  ): EngineCommand | null {
    if (state.prompt !== null) {
      if (command.promptId !== state.prompt.promptId) return null;
      const option = state.prompt.options.find(option =>
        option.optionId === command.optionId
      );
      if (!option || command.targets.length > 0) return null;
      return {
        type: "answer-prompt",
        playerId: command.playerId,
        promptId: state.prompt.promptId,
        optionId: command.optionId,
        stateVersion: state.prompt.stateVersion
      };
    }

    if (state.phase !== "battle-declaration") return null;
    const action = listEngineLegalActions(
      state,
      command.playerId
    ).find(action =>
      action.type === "declare-attack" &&
      this.promptOptionId(action) === command.optionId
    );
    if (!action || command.targets.length > 0) return null;
    return {
      type: "declare-attack",
      playerId: command.playerId,
      instanceId: action.instanceId,
      targetInstanceId: action.targetInstanceId
    };
  }

  private concede(
    record: RuntimeRecord,
    loserPlayerId: PlayerId
  ): FullProductRuntimeCommandResult {
    const state = structuredClone(record.engineState);
    const snapshot = this.snapshot(record);
    const loser = state.players.find(player => player.playerId === loserPlayerId);
    if (!loser) {
      return {
        snapshot,
        error: {
          code: "invalid_command",
          message: "Unknown concession player"
        }
      };
    }
    const winner = state.players.find(player => player.playerId !== loserPlayerId)
      ?.playerId ?? null;
    state.phase = "ended";
    state.turnStep = "end";
    state.winnerPlayerId = winner;
    state.prompt = null;
    state.declaredAttacks = [];
    state.version += 1;
    state.eventSeq += 1;
    state.eventLog.push({
      type: "game-ended",
      seq: state.eventSeq,
      version: state.version,
      winnerPlayerId: winner
    });

    return {
      snapshot: this.snapshot({
        engineState: state,
        eventActors: new Map(record.eventActors),
        endReason: "concession"
      }),
      error: null
    };
  }

  private enginePromptAllowsPass(
    state: FullProductGameState,
    playerId: PlayerId
  ): boolean {
    return listEngineLegalActions(state, playerId)
      .some(action => action.type === "pass-battle");
  }

  private promptOptionId(
    action: EngineLegalAction
  ): string {
    return `attack:${action.instanceId ?? "unknown"}:${action.targetInstanceId ?? "unknown"}`;
  }

  private protocolPrompt(
    state: FullProductGameState
  ): FullProductRuntimePrompt | null {
    if (state.prompt !== null) {
      return this.enginePrompt(state.prompt);
    }
    if (state.phase !== "battle-declaration") return null;

    const options = listEngineLegalActions(
      state,
      state.activePlayerId
    ).flatMap(action =>
      action.type === "declare-attack"
        && action.instanceId !== undefined
        && action.targetInstanceId !== undefined
        ? [{
            optionId: this.promptOptionId(action),
            label: `Attack with ${this.cardName(state, action.instanceId)}`,
            targetInstanceId: action.targetInstanceId
          }]
        : []
    );
    if (options.length === 0) return null;
    return {
      promptId: `battle:${state.version}`,
      ownerPlayerId: state.activePlayerId,
      stateVersion: state.version,
      optional: true,
      targetPolicy: {
        minTargets: 0,
        maxTargets: 0,
        allowedZones: []
      },
      options
    };
  }

  private enginePrompt(
    prompt: EnginePrompt
  ): FullProductRuntimePrompt {
    return {
      promptId: prompt.promptId,
      ownerPlayerId: prompt.playerId,
      stateVersion: prompt.stateVersion,
      optional: false,
      targetPolicy: {
        minTargets: 0,
        maxTargets: 0,
        allowedZones: []
      },
      options: prompt.options.map(option => ({
        optionId: option.optionId,
        label: option.label,
        ...(option.targetInstanceId === undefined
          ? {}
          : { targetInstanceId: option.targetInstanceId })
      }))
    };
  }

  private visibleObject(
    instance: EngineInstance,
    viewerPlayerId: PlayerId | null
  ): FullProductRuntimeProjectionObject[] {
    if (
      (instance.zone === "deck" || instance.zone === "hand") &&
      instance.ownerPlayerId !== viewerPlayerId
    ) {
      return [];
    }
    return [{
      objectId: instance.instanceId,
      cardId: instance.cardId,
      zone: instance.zone,
      controllerId: instance.ownerPlayerId,
      ownerPlayerId: instance.ownerPlayerId,
      faceUp: true,
      visibility: instance.zone === "deck" || instance.zone === "hand"
        ? "private"
        : "public",
      damage: instance.damage
    }];
  }

  private cardInstance(
    state: FullProductGameState,
    instanceId: string | undefined
  ) {
    const instance = instanceId === undefined ? undefined : state.instances[instanceId];
    if (!instance) {
      throw new Error(`Card instance ${instanceId} is missing`);
    }
    return {
      instanceId: instance.instanceId,
      cardId: instance.cardId
    };
  }

  private cardName(
    state: FullProductGameState,
    instanceId: string
  ): string {
    const instance = state.instances[instanceId];
    return instance
      ? state.cards[instance.cardId]?.name ?? instance.cardId
      : instanceId ?? "Unknown card";
  }

  private promptVisible(
    prompt: EnginePrompt | null,
    viewerPlayerId: PlayerId | null
  ): FullProductRuntimePrompt | null {
    return prompt !== null && prompt.playerId === viewerPlayerId
      ? this.enginePrompt(prompt)
      : null;
  }

  private answeredPromptOptionId(
    promptId: string,
    viewerPlayerId: PlayerId | null,
    actorPlayerId: PlayerId,
    optionId: string
  ): string {
    return viewerPlayerId !== null &&
      viewerPlayerId !== actorPlayerId &&
      (promptId.startsWith("prompt:") || promptId.startsWith("battle:"))
      ? `${promptId}:${viewerPlayerId}`
      : optionId;
  }

  private protocolEvents(
    record: RuntimeRecord,
    viewerPlayerId: PlayerId | null
  ): readonly FullProductRuntimeEvent[] {
    const state = record.engineState;
    const events: FullProductRuntimeEvent[] = [];
    for (const event of state.eventLog) {
      const projected = this.projectEvent(record, event, viewerPlayerId);
      if (projected !== null) events.push(projected);
    }
    return events;
  }

  private projectEvent(
    record: RuntimeRecord,
    event: FullProductGameState["eventLog"][number],
    viewerPlayerId: PlayerId | null
  ): FullProductRuntimeEvent {
    const state = record.engineState;
    const base = {
      eventContract: FULL_PRODUCT_EVENT_CONTRACT,
      seq: event.seq,
      turnNumber: Math.max(1, state.turnNumber),
      activePlayerId: state.activePlayerId,
      priorityPlayerId: state.priorityPlayerId
    };
    switch (event.type) {
      case "game-started":
        return {
          ...base,
          type: event.type,
          playerIds: state.players.map(player => player.playerId),
          rulesetId: "riftbound-foundation"
        };
      case "turn-started":
        return {
          ...base,
          turnNumber: event.turnNumber,
          activePlayerId: event.playerId,
          priorityPlayerId: event.playerId,
          type: event.type,
          playerId: event.playerId
        };
      case "card-played":
        return {
          ...base,
          type: event.type,
          playerId: event.playerId,
          instanceId: event.instanceId,
          cardId: event.cardId,
          targets: []
        };
      case "prompt-created":
        return {
          ...base,
          type: event.type,
          promptId: event.prompt.promptId,
          ownerPlayerId: event.prompt.playerId,
          stateVersion: event.prompt.stateVersion,
          optional: false,
          targetPolicy: {
            minTargets: 0,
            maxTargets: 0,
            allowedZones: []
          },
          prompt: this.promptVisible(state.prompt, viewerPlayerId)
        };
      case "prompt-answered":
        return {
          ...base,
          type: event.type,
          promptId: event.promptId,
          playerId: record.eventActors.get(event.seq) ?? state.priorityPlayerId,
          optionId: this.answeredPromptOptionId(
            event.promptId,
            viewerPlayerId,
            record.eventActors.get(event.seq) ?? state.priorityPlayerId,
            event.optionId
          ),
          targets: []
        };
      case "game-ended":
        return {
          ...base,
          type: event.type,
          winnerPlayerId: event.winnerPlayerId
        };
      default:
        return {
          ...base,
          type: "priority-passed",
          playerId: state.priorityPlayerId
        };
    }
  }

  private summary(
    state: FullProductGameState
  ): FullProductMatchSummary {
    const prompt = this.protocolPrompt(state);
    return {
      version: state.version,
      eventSeq: state.eventSeq,
      phase: state.phase === "ended" ? "ended" : "main",
      turnNumber: Math.max(1, state.turnNumber),
      activePlayerId: state.activePlayerId,
      priorityPlayerId: state.priorityPlayerId,
      winnerPlayerId: state.winnerPlayerId,
      waitingForPlayerId: prompt?.ownerPlayerId ?? null
    };
  }

  private snapshot(record: RuntimeRecord): FullProductRuntimeSnapshot {
    const authority = {
      __fullProductRuntimeAuthority: this.authorityMarker
    } as FullProductRuntimeAuthority;
    this.records.set(authority, record);
    return {
      summary: this.summary(record.engineState),
      authority
    };
  }

  private requireRecord(
    snapshot: FullProductRuntimeSnapshot
  ): RuntimeRecord {
    if (snapshot.authority.__fullProductRuntimeAuthority !== this.authorityMarker) {
      throw new FullProductOrchestrationError(
        "The runtime snapshot was not issued by this adapter",
        "invalid-token"
      );
    }
    const record = this.records.get(snapshot.authority);
    if (!record) {
      throw new FullProductOrchestrationError(
        "The runtime snapshot is no longer available",
        "invalid-token"
      );
    }
    return record;
  }
}
