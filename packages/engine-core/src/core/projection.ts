import {
  ACTION_OPTIONS_CONTRACT,
  PROJECTION_SCHEMA_V1
} from "@riftbound/protocol";
import type {
  CommandTarget,
  GameEvent,
  GameProjection,
  PlayerProjection,
  PlayerId,
  ProjectionAction,
  ProjectionActionOptions,
  ProjectionObject,
  ProjectionZone,
  Prompt,
  PromptOption,
  RoomSnapshot
} from "@riftbound/protocol";
import type {
  FoundationGameState,
  FoundationPlayerState,
  GameObject,
  GameState,
  GameObjectType,
  PlayerState,
  RulesetId,
  SyntheticPlayerState,
  Zone,
  EngineCardDefinition,
  ZoneProjection
} from "../state.js";
import { FOUNDATION_RULESET_ID } from "@riftbound/protocol";
import { SYNTHETIC_RULESET_ID } from "./constants.js";
import {
  objectExists,
  requireFoundationGame,
  requireSyntheticGame
} from "./shared.js";
import {
  availableTargets,
  currentPromptOptions,
  hasExecutableDefault,
  isTrustedFoundationEffectTask,
  targetOptionId
} from "./effects.js";
import type { CardInstanceLike, PrimaryObjectType } from "./contracts.js";

export function projectGame(
  state: GameState,
  viewerPlayerId: PlayerId | null = null
): GameProjection {
  const prompt = state.prompt;
  const safeOptions = prompt && prompt.ownerPlayerId === viewerPlayerId
    ? currentPromptOptions(state, prompt)
    : [];
  // Protocol 0.2.1 does not accept an empty prompt.options. Keep waitingForPlayerId
  // and the pending authoritative task, but do not send an invalid wire prompt
  // or a fake choice when every legacy target has become illegal.
  const viewerPrompt = prompt && safeOptions.length > 0
    ? projectPrompt(prompt, safeOptions)
    : null;
  const projection = {
    version: state.version,
    eventSeq: state.eventSeq,
    phase: state.phase,
    turnNumber: state.turnNumber,
    activePlayerId: state.activePlayerId,
    winnerPlayerId: state.winnerPlayerId,
    prompt: viewerPrompt,
    waitingForPlayerId: prompt?.ownerPlayerId ?? null,
    players: state.players.map(player =>
      projectPlayer(player, viewerPlayerId, state.rules.rulesetId)
    ),
    events: state.eventLog
      .filter(event => isEventVisibleTo(event, viewerPlayerId))
      .map(event => structuredClone(event))
  } as GameProjection;

  if (state.rules.rulesetId === SYNTHETIC_RULESET_ID) {
    return projection;
  }

  {
    const foundationState = state as FoundationGameState;
    projection.players = foundationState.players.map(player => {
      const projectedPlayer = projectPlayer(
        player,
        viewerPlayerId,
        state.rules.rulesetId
      );
      projectedPlayer.zoneCounts = foundationZoneCounts(
        foundationState,
        player.id
      );
      projectedPlayer.playableInstanceIds = viewerPlayerId === player.id
        ? playableFoundationHand(foundationState, player)
        : [];
      return projectedPlayer;
    });
  }

  {
    projection.projectionSchema = PROJECTION_SCHEMA_V1;
    projection.rulesetId = state.rules.rulesetId;
    projection.priority = { playerId: state.priorityPlayerId };
    projection.objects = visibleFoundationObjects(
      state as FoundationGameState,
      viewerPlayerId
    );
    projection.actionOptions = foundationActionOptions(
      state as FoundationGameState,
      viewerPlayerId
    );
  }

  return projection;
}


function visibleFoundationObjects(
  state: FoundationGameState,
  viewerPlayerId: PlayerId | null
): ProjectionObject[] {
  return Object.values(state.objects)
    .filter(object =>
      isPublicFoundationZone(object.zone) ||
      (object.zone === "hand" && object.ownerPlayerId === viewerPlayerId)
    )
    .map(object => ({
      objectId: object.objectId,
      cardId: object.cardId,
      zone: projectionZone(object.zone),
      controllerId: object.controllerPlayerId,
      ownerPlayerId: object.ownerPlayerId,
      faceUp: true,
      counters: structuredClone(object.counters),
      damage: object.damage
    }));
}


function isPublicFoundationZone(zone: Zone): boolean {
  return zone === "board" ||
    zone === "base" ||
    zone === "battlefield" ||
    zone === "champion" ||
    zone === "legend" ||
    zone === "rune" ||
    zone === "discard" ||
    zone === "banish" ||
    zone === "chain";
}


function projectionZone(zone: Zone): ProjectionZone {
  return zone as ProjectionZone;
}


function foundationZoneCounts(
  state: FoundationGameState,
  playerId: PlayerId
): Partial<Record<ProjectionZone, number>> {
  const player = state.players.find(candidate => candidate.id === playerId)!;
  return {
    hand: player.hand.length,
    deck: player.deck.length,
    board: player.board.length,
    base: player.base.length,
    battlefield: player.battlefield.length,
    champion: player.champion.length,
    legend: player.legend.length,
    rune: player.rune.length,
    "rune-deck": player.runeDeck.length,
    discard: player.discard.length,
    banish: player.banish.length,
    chain: player.chain.length
  };
}


export function projectZones(
  state: GameState,
  playerId: PlayerId
): ZoneProjection {
  if (state.rules.rulesetId === SYNTHETIC_RULESET_ID) {
    const player = requireSyntheticGame(state).players.find(candidate =>
      candidate.id === playerId
    )!;
    return {
      deck: [],
      hand: player.hand.map(card => ({ ...card })),
      board: [],
      base: [],
      battlefield: [],
      champion: [],
      legend: [],
      rune: [],
    runeDeck: [],
      discard: [],
      banish: [],
      chain: []
    };
  }

  const player = requireFoundationGame(state).players.find(candidate =>
    candidate.id === playerId
  )!;
  if (!player) {
    throw new Error(`Player ${playerId} is not in this game`);
  }
  const publicObject = (instanceId: string): string =>
    objectExists(state, instanceId) ? instanceId : instanceId;

  return {
    deck: player.deck?.map(publicObject) ?? [],
    hand: viewerHand(player, playerId),
    board: player.board?.map(publicObject) ?? [],
    base: player.base?.map(publicObject) ?? [],
    battlefield: player.battlefield?.map(publicObject) ?? [],
    champion: player.champion?.map(publicObject) ?? [],
    legend: player.legend?.map(publicObject) ?? [],
    rune: player.rune?.map(publicObject) ?? [],
    runeDeck: player.runeDeck?.map(publicObject) ?? [],
    discard: player.discard?.map(publicObject) ?? [],
    banish: player.banish?.map(publicObject) ?? [],
    chain: player.chain?.map(publicObject) ?? []
  };
}


export function projectObject(
  state: GameState,
  objectId: string
): GameObject | null {
  const object = state.objects[objectId];
  return object ? structuredClone(object) : null;
}


export function createRoomSnapshot(
  state: GameState,
  roomId: string,
  viewerPlayerId: PlayerId | null = null
): RoomSnapshot {
  const projection = projectGame(state, viewerPlayerId);
  return {
    roomId,
    status: state.phase === "ended" ? "ended" : "playing",
    players: state.players.map(player => ({
      id: player.id,
      name: player.name,
      connected: true,
      ready: true,
      deckSubmitted: true
    })),
    version: state.version,
    eventSeq: state.eventSeq,
    roomVersion: 1,
    roomEventSeq: 0,
    roomEvents: [],
    projection
  };
}


function canPlayFoundationCard(
  state: FoundationGameState,
  player: FoundationPlayerState,
  card: CardInstanceLike
): boolean {
  if (state.phase !== "main" || state.turnPhase !== "main") return false;
  if (state.activePlayerId !== player.id || state.priorityPlayerId !== player.id) {
    return false;
  }
  if (state.prompt !== null || state.outstandingTasks.length > 0) return false;
  const definition = state.cards[card.cardId];
  return definition !== undefined && player.energy >= definition.cost;
}


function playableFoundationHand(
  state: FoundationGameState,
  player: FoundationPlayerState
): string[] {
  return player.hand
    .filter(card => canPlayFoundationCard(state, player, card))
    .map(card => card.instanceId);
}


export function foundationActionOptions(
  state: FoundationGameState,
  viewerPlayerId: PlayerId | null
): ProjectionActionOptions {
  const options: ProjectionActionOptions = {
    contract: ACTION_OPTIONS_CONTRACT,
    stateVersion: state.version,
    viewerPlayerId,
    actions: []
  };
  const viewer = viewerPlayerId === null
    ? undefined
    : state.players.find(player => player.id === viewerPlayerId);
  if (!viewer || state.phase === "ended") return options;

  const actions: ProjectionAction[] = [
    {
      id: "concede",
      command: { type: "concede" },
      targetPolicy: emptyActionTargetPolicy(),
      enabled: true
    }
  ];

  if (state.prompt) {
    if (state.prompt.ownerPlayerId === viewer.id) {
      const task = state.outstandingTasks.find(candidate =>
        candidate.id === state.prompt!.taskId
      );
      for (const promptOption of currentPromptOptions(state, state.prompt)) {
        const judgeRequired = (task?.disposition === "judge-required" ||
          task?.effect?.kind === "judge-required" ||
          state.prompt.reason === "judge-required" ||
          !task || !isTrustedFoundationEffectTask(state, task)) && promptOption.id !== "skip";
        const action: ProjectionAction = {
          id: `${state.prompt.id}:${promptOption.id}`,
          command: {
            type: "respond-to-prompt",
            promptId: state.prompt.id,
            optionId: promptOption.id,
            stateVersion: state.prompt.stateVersion
          },
          targetPolicy: emptyActionTargetPolicy(),
          enabled: !judgeRequired,
          ...(judgeRequired ? { blockedReason: "judge-required" } : {})
        };
        actions.push(action);
      }
    }
    return { ...options, actions };
  }

  const canAct = state.phase === "main" &&
    state.turnPhase === "main" &&
    state.activePlayerId === viewer.id &&
    state.priorityPlayerId === viewer.id &&
    state.outstandingTasks.length === 0;
  if (!canAct) return { ...options, actions };

  actions.unshift({
    id: "pass",
    command: { type: "pass" },
    targetPolicy: emptyActionTargetPolicy(),
    enabled: true
  });

  const playableIds = new Set(playableFoundationHand(state, viewer));
  for (const card of viewer.hand) {
    if (!playableIds.has(card.instanceId)) continue;
    actions.splice(actions.length - 1, 0,
      foundationPlayAction(state, viewer, card));
  }

  return { ...options, actions };
}


export function foundationPrimaryType(definition: EngineCardDefinition): PrimaryObjectType | undefined {
  return definition.types.find(type =>
    type === "unit" || type === "spell" || type === "battlefield" ||
    type === "champion" || type === "legend" || type === "rune"
  ) as PrimaryObjectType | undefined;
}


export function foundationHandObject(
  state: FoundationGameState,
  player: FoundationPlayerState,
  card: CardInstanceLike
): GameObject | null {
  const object = state.objects[card.instanceId];
  return object?.instanceId === card.instanceId &&
    object.zone === "hand" &&
    object.ownerPlayerId === player.id &&
    object.controllerPlayerId === player.id &&
    object.cardId === card.cardId
    ? object
    : null;
}


function foundationPlayAction(
  state: FoundationGameState,
  player: FoundationPlayerState,
  card: CardInstanceLike
): ProjectionAction {
  const action: ProjectionAction = {
    id: `play:${card.instanceId}`,
    command: { type: "play-card", instanceId: card.instanceId },
    targetPolicy: emptyActionTargetPolicy(),
    enabled: true
  };
  const object = foundationHandObject(state, player, card);
  const definition = state.cards[card.cardId];
  if (!object || !definition) {
    return { ...action, enabled: false, blockedReason: "unsupported-card" };
  }

  const primaryType = foundationPrimaryType(definition);
  if (!primaryType) {
    return {
      ...action,
      enabled: false,
      blockedReason: "unsupported-card-type"
    };
  }
  if (definition.effect?.kind === "judge-required") {
    return { ...action, enabled: false, blockedReason: "judge-required" };
  }

  if (definition.effect?.kind === "damage" &&
      definition.effect.targets.length === 0) {
    const targetOptions = availableTargets(state, player.id).map(target =>
      target as CommandTarget
    );
    if (targetOptions.length === 0) {
      return {
        ...action,
        enabled: false,
        blockedReason: "no-legal-target"
      };
    }
    return {
      ...action,
      targetPolicy: { minTargets: 1, maxTargets: 1, options: targetOptions }
    };
  }
  return action;
}


function emptyActionTargetPolicy(): {
  minTargets: 0;
  maxTargets: 0;
  options: readonly CommandTarget[];
} {
  return { minTargets: 0, maxTargets: 0, options: [] };
}


function viewerHand(
  player: PlayerState,
  viewerPlayerId: PlayerId | null
): CardInstanceLike[] {
  const hand = player.hand ?? [];
  return viewerPlayerId === player.id
    ? hand.map(card => ({ ...card }))
    : [];
}


function projectPlayer(
  player: PlayerState,
  viewerPlayerId: PlayerId | null,
  rulesetId: RulesetId
): PlayerProjection {
  const hand = viewerHand(player, viewerPlayerId);
  const projection: PlayerProjection = {
    id: player.id,
    name: player.name,
    handCount: player.hand.length,
    hand
  };
  if (rulesetId === SYNTHETIC_RULESET_ID) {
    const synthetic = player as SyntheticPlayerState;
    projection.life = synthetic.points;
    projection.mana = synthetic.runes;
  } else {
    const foundation = player as FoundationPlayerState;
    projection.score = foundation.score;
    projection.energy = foundation.energy;
    projection.power = structuredClone(foundation.power);
    projection.zoneCounts = {};
    projection.playableInstanceIds = [];
  }
  return projection;
}


function projectPrompt(prompt: Prompt, options: readonly PromptOption[]): Prompt {
  return {
    id: prompt.id,
    ownerPlayerId: prompt.ownerPlayerId,
    playerId: prompt.playerId,
    stateVersion: prompt.stateVersion,
    status: prompt.status,
    taskId: prompt.taskId,
    reason: prompt.reason,
    optional: prompt.optional,
    options: options.map(option => ({ ...option }))
  };
}


function isEventVisibleTo(
  event: GameEvent,
  viewerPlayerId: PlayerId | null
): boolean {
  if (event.type === "prompt-created" || event.type === "prompt-answered") {
    return event.playerId === viewerPlayerId;
  }
  return true;
}
