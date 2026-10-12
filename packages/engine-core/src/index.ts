import {
  ENGINE_ERRORS,
  FOUNDATION_RULESET_ID,
  PROJECTION_SCHEMA_V1,
  TRIGGER_CONQUER_CARD,
  isCommand
} from "@riftbound/protocol";
import type {
  Command,
  EngineError,
  GameEvent,
  GameProjection,
  PlayerProjection,
  PlayerId,
  ProjectionObject,
  ProjectionZone,
  Prompt,
  PromptOption,
  RoomSnapshot
} from "@riftbound/protocol";
import type {
  ZoneProjection,
  CardEffect,
  CreateConfiguredGameOptions,
  CreateGameRulesOptions,
  DamageEffect,
  EffectTarget,
  FoundationPlayerState,
  FoundationGameState,
  GainPointsEffect,
  EngineCardDefinition,
  GameObject,
  GameObjectType,
  GameRules,
  FoundationGameRules,
  SyntheticGameRules,
  GameState,
  RulesetId,
  SyntheticGameState,
  SyntheticPlayerState,
  OutstandingTask,
  PlayerState,
  Zone
} from "./state.js";

type CreateGameOptions = {
  players: readonly {
    id: PlayerId;
    name: string;
  }[];
};
type CardInstanceLike = {
  instanceId: string;
  cardId: string;
};
type CreateGamePlayerOptions = {
  id: PlayerId;
  name: string;
  deck?: readonly CardInstanceLike[];
  startingHand?: readonly CardInstanceLike[];
  board?: readonly CardInstanceLike[];
  base?: readonly CardInstanceLike[];
  battlefield?: readonly CardInstanceLike[];
  champion?: readonly CardInstanceLike[];
  legend?: readonly CardInstanceLike[];
  rune?: readonly CardInstanceLike[];
  runeDeck?: readonly CardInstanceLike[];
};

export type {
  CardEffect,
  CreateConfiguredGameOptions,
  CreateGameRulesOptions,
  DamageEffect,
  EffectTarget,
  FoundationGameState,
  FoundationPlayerState,
  EngineCardDefinition,
  GameObject,
  GameObjectType,
  GameState,
  JudgeRequiredEffect,
  OutstandingTask,
  PlayerState,
  Zone,
  ZoneProjection
} from "./state.js";
export type {
  CardInstance,
  Command,
  EngineError,
  GameEvent,
  GameProjection,
  PlayerCommand,
  PlayerId,
  PlayerProjection,
  Prompt,
  PromptOption,
  RoomSnapshot
} from "@riftbound/protocol";

export const HOT_FEPR_STEPS = [
  "handle-outstanding-tasks",
  "finalize",
  "execute",
  "pass",
  "resolve",
  "cleanup"
] as const;

export type HotFeprStep = (typeof HOT_FEPR_STEPS)[number];

export const RULESET_ID = FOUNDATION_RULESET_ID;
export const SYNTHETIC_RULESET_ID = "synthetic-demo";

type DistributiveOmit<T, Keys extends keyof T> = T extends unknown
  ? Omit<T, Keys>
  : never;
type GameEventInput = DistributiveOmit<
  GameEvent,
  "seq" | "turnNumber" | "activePlayerId"
>;

type ObjectZone = Extract<Zone, "board" | "base" | "battlefield" | "champion" | "legend" | "rune">;
type PrimaryObjectType = Extract<GameObjectType, "unit" | "spell" | "battlefield" | "champion" | "legend" | "rune">;

const ZONE_INSTANCE_KEYS = {
  board: "board",
  base: "base",
  battlefield: "battlefield",
  champion: "champion",
  legend: "legend",
  rune: "rune"
} as const satisfies Record<ObjectZone, keyof FoundationPlayerState>;

const OBJECT_TYPE_ZONES = {
  unit: "board",
  battlefield: "battlefield",
  champion: "champion",
  legend: "legend",
  rune: "rune"
} as const satisfies Record<Exclude<PrimaryObjectType, "spell">, ObjectZone>;

type FoundationZoneList =
  | "deck" | "hand" | "board" | "base" | "battlefield" | "champion"
  | "legend" | "rune" | "rune-deck" | "discard" | "banish" | "chain";

/**
 * This package implements a deliberately narrow playable vertical slice. It
 * is not a complete implementation of the official game rules.
 */
export function createInitialGame(options: CreateGameOptions): GameState {
  if (options.players.length !== 2) {
    throw new Error("createInitialGame requires exactly two players");
  }
  if (new Set(options.players.map(player => player.id)).size !== 2 ||
      options.players.some(player => !player.id || !player.name.trim())) {
    throw new Error("Players must have unique nonempty identities");
  }

  return createSyntheticDemo({
    players: options.players.map(player => ({
      ...player,
      startingHand: [{
        instanceId: `${player.id}:trigger-conquer`,
        cardId: TRIGGER_CONQUER_CARD.id
      }]
    })),
    cards: [syntheticTriggerConquer()],
    rules: { drawOnTurnStart: false }
  });
}

export function createConfiguredGame(
  options: CreateConfiguredGameOptions
): GameState {
  if (options.players.length !== 2) {
    throw new Error("createConfiguredGame requires exactly two players");
  }
  if (new Set(options.players.map(player => player.id)).size !== 2 ||
      options.players.some(player => !player.id || !player.name.trim())) {
    throw new Error("Players must have unique nonempty identities");
  }

  const cards = new Map<string, EngineCardDefinition>();
  for (const definition of options.cards) {
    validateCardDefinition(definition);
    if (cards.has(definition.id)) {
      throw new Error(`Duplicate card definition ${definition.id}`);
    }
    cards.set(definition.id, definition);
  }
  const requestedRulesetId = options.rules?.rulesetId ?? FOUNDATION_RULESET_ID;
  if (requestedRulesetId !== SYNTHETIC_RULESET_ID &&
      requestedRulesetId !== FOUNDATION_RULESET_ID) {
    throw new Error(`Unsupported ruleset ${requestedRulesetId}`);
  }

  const rules: GameRules = {
    rulesetId: requestedRulesetId,
    startingPoints: requireNonNegativeInteger(
      requestedRulesetId === SYNTHETIC_RULESET_ID
        ? options.rules?.startingPoints ?? 20
        : 0,
      "startingPoints"
    ),
    targetPoints: requireNonNegativeInteger(
      requestedRulesetId === SYNTHETIC_RULESET_ID
        ? options.rules?.targetPoints ?? 0
        : options.rules?.targetPoints ?? 8,
      "targetPoints"
    ),
    startingRunes: requireNonNegativeInteger(
      requestedRulesetId === SYNTHETIC_RULESET_ID
        ? options.rules?.startingRunes ?? 1
        : 0,
      "startingRunes"
    ),
    startingEnergy: requireNonNegativeInteger(
      requestedRulesetId === SYNTHETIC_RULESET_ID
        ? options.rules?.startingEnergy ?? 0
        : options.rules?.startingEnergy ?? 0,
      "startingEnergy"
    ),
    maximumRunes: requirePositiveInteger(
      requestedRulesetId === SYNTHETIC_RULESET_ID
        ? options.rules?.maximumRunes ?? 10
        : options.rules?.maximumRunes ?? 1,
      "maximumRunes"
    ),
    maximumEnergy: requirePositiveInteger(
      requestedRulesetId === SYNTHETIC_RULESET_ID
        ? options.rules?.maximumEnergy ?? 10
        : options.rules?.maximumEnergy ?? 10,
      "maximumEnergy"
    ),
    drawOnTurnStart: options.rules?.drawOnTurnStart ?? true,
    battlefieldCapacity: requirePositiveInteger(
      options.rules?.battlefieldCapacity ?? 5,
      "battlefieldCapacity"
    )
  } as GameRules;

  const state: GameState = rules.rulesetId === SYNTHETIC_RULESET_ID
    ? {
        version: 1,
        eventSeq: 0,
        turnNumber: 1,
        phase: "main",
        turnPhase: "main",
        activePlayerId: options.players[0]!.id,
        priorityPlayerId: options.players[0]!.id,
        winnerPlayerId: null,
        rules: rules as SyntheticGameRules,
        cards: Object.fromEntries(cards),
        objects: {},
        players: options.players.map(player =>
          createPlayerState(player, rules) as SyntheticPlayerState
        ),
        prompt: null,
        outstandingTasks: [],
        eventLog: []
      }
    : {
        version: 1,
        eventSeq: 0,
        turnNumber: 1,
        phase: "main",
        turnPhase: "main",
        activePlayerId: options.players[0]!.id,
        priorityPlayerId: options.players[0]!.id,
        winnerPlayerId: null,
        rules: rules as FoundationGameRules,
        cards: Object.fromEntries(cards),
        objects: {},
        players: options.players.map(player =>
          createPlayerState(player, rules) as FoundationPlayerState
        ),
        prompt: null,
        outstandingTasks: [],
        eventLog: []
      };

  for (const playerOptions of options.players) {
    if (state.rules.rulesetId === SYNTHETIC_RULESET_ID) {
      loadSyntheticInstances(state, playerOptions, cards);
      continue;
    }
    loadFoundationInstances(state as FoundationGameState, playerOptions, cards);
  }

  appendEvent(state, {
    type: "game-started",
    playerIds: state.players.map(player => player.id)
  });
  appendEvent(state, {
    type: "turn-started",
    playerId: state.players[0]!.id,
    ...(state.rules.rulesetId === SYNTHETIC_RULESET_ID
      ? {
          mana: (state.players[0] as SyntheticPlayerState).runes
        }
      : {
          energy: (state.players[0] as FoundationPlayerState).energy
        })
  });
  return state as GameState;
}

function createSyntheticDemo(options: CreateConfiguredGameOptions): SyntheticGameState {
  const optionsWithDefaults = {
    ...options,
    rules: {
      rulesetId: SYNTHETIC_RULESET_ID,
      startingPoints: 20,
      targetPoints: 0,
      startingRunes: 1,
      maximumRunes: 10,
      drawOnTurnStart: false,
      battlefieldCapacity: 5,
      ...(options.rules as CreateGameRulesOptions | undefined)
    }
  } satisfies CreateConfiguredGameOptions;
  const state = createConfiguredGame({
    ...optionsWithDefaults,
    rules: {
      ...optionsWithDefaults.rules,
      rulesetId: SYNTHETIC_RULESET_ID
    }
  });
  return state as SyntheticGameState;
}

export function submitCommand(
  currentState: GameState,
  command: Command
): CommandResult {
  if (!isCommand(command)) {
    return failure(currentState, {
      code: ENGINE_ERRORS.invalidCommand,
      message: "The command is not valid for this ruleset."
    });
  }

  if (currentState.phase === "ended") {
    return failure(currentState, {
      code: ENGINE_ERRORS.gameEnded,
      message: "The game has already ended."
    });
  }

  const state = cloneState(currentState);
  const startingSeq = state.eventSeq;
  const startingVersion = state.version;
  const prompt = state.prompt;
  const promptEventsBefore = state.eventSeq;

  const error = executeCommand(state, command);
  if (error) {
    return failure(currentState, error);
  }

  runHotFepr(state);
  if (state.prompt &&
      prompt?.id === state.prompt.id &&
      state.eventSeq === promptEventsBefore) {
    return failure(currentState, {
      code: ENGINE_ERRORS.judgeRequired,
      message: "Judge-required effects require an authoritative ruling and cannot be resolved by player confirmation."
    });
  }
  checkGameEnd(state);

  if (state.phase === "ended" && (state.prompt !== null || state.outstandingTasks.length > 0)) {
    return failure(currentState, {
      code: ENGINE_ERRORS.invalidCommand,
      message: "Engine transaction produced an invalid state."
    });
  }

  if (state.version < startingVersion || state.eventSeq < startingSeq) {
    return failure(currentState, {
      code: ENGINE_ERRORS.invalidCommand,
      message: "Engine transaction produced an invalid state."
    });
  }

  return {
    state,
    events: state.eventLog.filter(event => event.seq > startingSeq),
    error: null
  };
}

export interface CommandResult {
  state: GameState;
  events: readonly GameEvent[];
  error: EngineError | null;
}

export function getHotFeprStep(state: GameState): HotFeprStep {
  if (state.prompt) {
    return "handle-outstanding-tasks";
  }
  if (state.outstandingTasks.length > 0) {
    return state.outstandingTasks[0]!.effect?.kind === "judge-required"
      ? "handle-outstanding-tasks"
      : "execute";
  }
  if (state.turnPhase === "combat") {
    return "pass";
  }
  if (state.turnPhase === "cleanup") {
    return "cleanup";
  }
  return state.phase === "ended" ? "finalize" : "pass";
}

export function projectGame(
  state: GameState,
  viewerPlayerId: PlayerId | null = null
): GameProjection {
  const prompt = state.prompt;
  const viewerPrompt = prompt && prompt.ownerPlayerId === viewerPlayerId
    ? projectPrompt(prompt)
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

function createPlayerState(
  options: CreateGamePlayerOptions,
  rules: GameRules
): SyntheticPlayerState | FoundationPlayerState {
  if (rules.rulesetId === SYNTHETIC_RULESET_ID) {
    return {
      id: options.id,
      name: options.name,
      points: rules.startingPoints,
      runes: rules.startingRunes,
      hand: [...(options.startingHand ?? [])]
    };
  }

  return {
    id: options.id,
    name: options.name,
    score: rules.startingPoints,
    energy: rules.startingEnergy,
    power: {},
    deck: options.deck?.map(instance => instance.instanceId) ?? [],
    hand: [...(options.startingHand ?? [])],
    board: options.board?.map(instance => instance.instanceId) ?? [],
    base: options.base?.map(instance => instance.instanceId) ?? [],
    battlefield: options.battlefield?.map(instance => instance.instanceId) ?? [],
    champion: options.champion?.map(instance => instance.instanceId) ?? [],
    legend: options.legend?.map(instance => instance.instanceId) ?? [],
    rune: options.rune?.map(instance => instance.instanceId) ?? [],
    runeDeck: options.runeDeck?.map(instance => instance.instanceId) ?? [],
    discard: [],
    banish: [],
    chain: []
  };
}

function loadSyntheticInstances(
  state: GameState,
  playerOptions: CreateConfiguredGameOptions["players"][number],
  cards: ReadonlyMap<string, EngineCardDefinition>
): void {
  if (state.rules.rulesetId !== SYNTHETIC_RULESET_ID) return;
  const synthetic = state as SyntheticGameState;
  const player = synthetic.players.find(candidate =>
    candidate.id === playerOptions.id
  )!;
  for (const instance of playerOptions.startingHand ?? []) {
    validateInstance(instance);
    if (state.objects[instance.instanceId]) {
      throw new Error(`Duplicate card instance ${instance.instanceId}`);
    }
    createObject(
      synthetic,
      instance,
      playerOptions.id,
      "hand",
      requireDefinition(cards, instance.cardId)
    );
  }
}

function loadFoundationInstances(
  state: FoundationGameState,
  playerOptions: CreateConfiguredGameOptions["players"][number],
  cards: ReadonlyMap<string, EngineCardDefinition>
): void {
  const player = state.players.find(candidate =>
    candidate.id === playerOptions.id
  )!;
  const zoneInputs: readonly [FoundationZoneList, readonly CardInstanceLike[] | undefined][] = [
    ["hand", playerOptions.startingHand],
    ["deck", playerOptions.deck],
    ["board", playerOptions.board],
    ["base", playerOptions.base],
    ["battlefield", playerOptions.battlefield],
    ["champion", playerOptions.champion],
    ["legend", playerOptions.legend],
    ["rune", playerOptions.rune],
    ["rune-deck", playerOptions.runeDeck]
  ];
  for (const [zone, instances] of zoneInputs) {
    for (const instance of instances ?? []) {
      validateInstance(instance);
      if (state.objects[instance.instanceId]) {
        throw new Error(`Duplicate card instance ${instance.instanceId}`);
      }
      createObject(
        state,
        instance,
        playerOptions.id,
        zone,
        requireDefinition(cards, instance.cardId)
      );
    }
  }
}

function validateInstance(instance: CardInstanceLike): void {
  if (!instance?.instanceId?.trim()) {
    throw new Error("Card instances require a nonempty instanceId");
  }
  if (!instance.cardId?.trim()) {
    throw new Error(`Card instance ${instance.instanceId} requires a cardId`);
  }
}

function validateCardDefinition(definition: EngineCardDefinition): void {
  if (!definition?.id?.trim() || !definition.name?.trim()) {
    throw new Error("Card definitions require nonempty id and name");
  }
  if (!Number.isSafeInteger(definition.cost) || definition.cost < 0) {
    throw new Error(`Card ${definition.id} has invalid cost`);
  }
  if (!Array.isArray(definition.types) || definition.types.length === 0 ||
      new Set(definition.types).size !== definition.types.length) {
    throw new Error(`Card ${definition.id} requires unique nonempty types`);
  }
  if (definition.types.some(type => !type?.trim())) {
    throw new Error(`Card ${definition.id} requires nonempty types`);
  }
  if (definition.health !== undefined &&
      (!Number.isSafeInteger(definition.health) || definition.health < 0)) {
    throw new Error(`Card ${definition.id} has invalid health`);
  }
  if (definition.effect) {
    validateEffect(definition.effect, definition.id);
  }
}

function validateEffect(effect: CardEffect, cardId: string): void {
  if (effect.kind === "judge-required") {
    if (!effect.reason?.trim()) {
      throw new Error(`Card ${cardId} judge-required effect requires a reason`);
    }
    return;
  }
  const valuedEffect = effect as DamageEffect | GainPointsEffect;
  if (!Number.isSafeInteger(valuedEffect.amount) || valuedEffect.amount <= 0) {
    throw new Error(`Card ${cardId} effect amount must be a positive integer`);
  }
    if (!Array.isArray(valuedEffect.targets)) {
    throw new Error(`Card ${cardId} effect targets must be an array`);
  }
  for (const target of valuedEffect.targets) {
    if (target.kind !== "player" && target.kind !== "object") {
      throw new Error(`Card ${cardId} has unsupported effect target`);
    }
    if (target.kind === "player" && !target.playerId?.trim()) {
      throw new Error(`Card ${cardId} player target requires playerId`);
    }
    if (target.kind === "object" && !target.objectId?.trim()) {
      throw new Error(`Card ${cardId} object target requires objectId`);
    }
  }
}

function createObject(
  state: GameState,
  instance: { instanceId: string; cardId: string },
  ownerPlayerId: PlayerId,
  zone: Zone,
  definition: EngineCardDefinition
): GameObject {
  const object: GameObject = {
    objectId: instance.instanceId,
    instanceId: instance.instanceId,
    cardId: instance.cardId,
    ownerPlayerId,
    controllerPlayerId: ownerPlayerId,
    zone,
    damage: 0,
    counters: {}
  };
  state.objects[object.objectId] = object;
  return object;
}

function syntheticTriggerConquer(): EngineCardDefinition {
  return {
    id: TRIGGER_CONQUER_CARD.id,
    name: TRIGGER_CONQUER_CARD.name,
    cost: TRIGGER_CONQUER_CARD.cost,
    types: ["spell"],
    effect: { kind: "damage", amount: 1, targets: [] }
  };
}

function executeCommand(
  state: GameState,
  command: Command
): EngineError | null {
  if (state.prompt) {
    if (command.type !== "respond-to-prompt") {
      return {
        code: ENGINE_ERRORS.promptRequired,
        message: "A prompt must be answered before other commands."
      };
    }
    return answerPrompt(state, command);
  }

  switch (command.type) {
    case "pass":
      return passTurn(state, command);
    case "play-card":
      return playCard(state, command);
    case "respond-to-prompt":
      return {
        code: ENGINE_ERRORS.promptNotFound,
        message: "There is no active prompt to answer."
      };
  }
}

function requireSyntheticGame(state: GameState): SyntheticGameState {
  if (state.rules.rulesetId !== SYNTHETIC_RULESET_ID) {
    throw new Error("This command requires synthetic-demo state");
  }
  return state as SyntheticGameState;
}

function requireFoundationGame(state: GameState): FoundationGameState {
  if (state.rules.rulesetId !== FOUNDATION_RULESET_ID) {
    throw new Error("This command requires riftbound-foundation state");
  }
  return state as FoundationGameState;
}

function getSyntheticPlayer(
  state: SyntheticGameState,
  playerId: PlayerId
): SyntheticPlayerState {
  const player = state.players.find(
    candidate => candidate.id === playerId
  );
  if (!player) {
    throw new Error(`Player ${playerId} is not in this game`);
  }
  return player;
}

function passTurn(
  state: GameState,
  command: Extract<Command, { type: "pass" }>
): EngineError | null {
  const activeError = requireActivePlayer(state, command.playerId);
  if (activeError) return activeError;

  appendEvent(state, {
    type: "turn-passed",
    playerId: command.playerId
  });

  const nextPlayer = state.players.find(player =>
    player.id !== state.activePlayerId
  )!;
  if (!nextPlayer) {
    return {
      code: ENGINE_ERRORS.invalidCommand,
      message: "The game must have two players."
    };
  }
  state.activePlayerId = nextPlayer.id;
  state.priorityPlayerId = nextPlayer.id;
  state.turnPhase = "main";
  state.turnNumber += 1;

  if (state.rules.rulesetId === "synthetic-demo") {
    const syntheticPlayer = nextPlayer as SyntheticPlayerState;
    syntheticPlayer.runes = Math.min(
      state.rules.maximumRunes,
      syntheticPlayer.runes + 1
    );
    appendEvent(state, {
      type: "turn-started",
      playerId: nextPlayer.id,
      mana: syntheticPlayer.runes
    });
    return null;
  }

  const foundation = state as FoundationGameState;
  const foundationPlayer = foundation.players.find(candidate =>
    candidate.id === nextPlayer.id
  )!;
  if (!foundationPlayer) {
    return {
      code: ENGINE_ERRORS.invalidCommand,
      message: "The game must have two players."
    };
  }
  foundationPlayer.energy = Math.min(
    state.rules.maximumEnergy,
    foundationPlayer.energy + 1
  );
  appendEvent(state, {
    type: "turn-started",
    playerId: foundationPlayer.id,
    energy: foundationPlayer.energy
  });

  if (state.rules.drawOnTurnStart) {
    const drawError = drawCard(foundation, foundationPlayer);
    if (drawError) return drawError;
  }
  return null;
}

function drawCard(
  state: GameState,
  player: FoundationPlayerState,
  count = 1
): EngineError | null {
  for (let drawn = 0; drawn < count; drawn += 1) {
    const instanceId = player.deck.shift();
    if (!instanceId) {
      return null;
    }

    const object = state.objects[instanceId];
    if (!object) {
      return {
        code: ENGINE_ERRORS.invalidCommand,
        message: `Deck instance ${instanceId} has no game object.`
      };
    }
    object.zone = "hand";
    player.hand.push({
      instanceId,
      cardId: object.cardId
    });
    state.version += 1;
  }
  return null;
}

function playCard(
  state: GameState,
  command: Extract<Command, { type: "play-card" }>
): EngineError | null {
  const activeError = requireActivePlayer(state, command.playerId);
  if (activeError) return activeError;

  if (state.rules.rulesetId === SYNTHETIC_RULESET_ID) {
    return playSyntheticCard(state, command);
  }

  const stateAsFoundation = requireFoundationGame(state);
  const player = getPlayer(stateAsFoundation, command.playerId) as FoundationPlayerState;
  const cardIndex = player.hand.findIndex(
    card => card.instanceId === command.instanceId
  );
  if (cardIndex === -1) {
    return {
      code: ENGINE_ERRORS.cardNotFound,
      message: `Card instance ${command.instanceId} is not in the player's hand.`
    };
  }

  const card = player.hand[cardIndex]!;
  const object = state.objects[card.instanceId];
  if (!object) {
    return {
      code: ENGINE_ERRORS.cardNotFound,
      message: `Card instance ${card.instanceId} has no game object.`
    };
  }

  const definition = getDefinition(state, object.cardId);
  if (!definition) {
    return {
      code: ENGINE_ERRORS.cardNotFound,
      message: `Unsupported card ${card.cardId}.`
    };
  }
  if (player.energy < definition.cost) {
    return {
      code: ENGINE_ERRORS.notEnoughMana,
      message: "The player does not have enough energy."
    };
  }

  const [cardInstance] = player.hand.splice(cardIndex, 1) as [CardInstanceLike];
  player.energy -= definition.cost;
  const playSeq = state.eventSeq;
  appendEvent(state, {
    type: "card-played",
    playerId: player.id,
    instanceId: card.instanceId,
    cardId: card.cardId
  });

  const primaryType = definition.types.find(
    type => type !== "token"
  ) as PrimaryObjectType | undefined;
  if (!primaryType) {
    return {
      code: ENGINE_ERRORS.invalidCommand,
      message: `Card ${definition.id} has no game object types.`
    };
  }

  if (primaryType === "spell") {
    player.chain.push(card.instanceId);
    object.zone = "chain";
  } else {
    const zone = OBJECT_TYPE_ZONES[primaryType];
    (player[ZONE_INSTANCE_KEYS[zone]] as string[]).push(card.instanceId);
    object.zone = zone;
  }
  state.version += 1;

  if (definition.effect?.kind === "judge-required") {
    const taskId = `task:${card.instanceId}:judge:${playSeq}`;
    state.outstandingTasks.push({
      id: taskId,
      sourceCardId: card.cardId,
      sourceObjectId: card.instanceId,
      sourcePlayerId: player.id,
      reason: "judge-required",
      optional: false,
      effect: definition.effect
    });
    return null;
  }

  const effectTargets = definition.effect
    ? effectDefinitionTargets(definition.effect)
    : [];
  if (definition.effect &&
      (effectTargets.length > 0 || availableTargets(state, player.id).length > 0)) {
    state.outstandingTasks.push({
      id: `task:${card.instanceId}:effect:${playSeq}`,
      sourceCardId: card.cardId,
      sourceObjectId: card.instanceId,
      sourcePlayerId: player.id,
      reason: "resolve-effect",
      optional: false,
      effect: definition.effect,
      targetChoices: effectTargets.length > 0
        ? effectTargets
        : availableTargets(state, player.id),
      requiresTargetChoice: effectTargets.length === 0
    });
  }
  return null;
}

function playSyntheticCard(
  state: GameState,
  command: Extract<Command, { type: "play-card" }>
): EngineError | null {
  const synthetic = requireSyntheticGame(state);
  const player = getSyntheticPlayer(synthetic, command.playerId);
  const cardIndex = player.hand.findIndex(
    card => card.instanceId === command.instanceId
  );
  if (cardIndex === -1) {
    return {
      code: ENGINE_ERRORS.cardNotFound,
      message: `Card instance ${command.instanceId} is not in the player's hand.`
    };
  }

  const card = player.hand[cardIndex]!;
  if (card.cardId !== TRIGGER_CONQUER_CARD.id) {
    return {
      code: ENGINE_ERRORS.cardNotFound,
      message: `Unsupported card ${card.cardId}.`
    };
  }
  if (player.runes < TRIGGER_CONQUER_CARD.cost) {
    return {
      code: ENGINE_ERRORS.notEnoughMana,
      message: "The player does not have enough runes."
    };
  }

  const [cardInstance] = player.hand.splice(cardIndex, 1) as [CardInstanceLike];
  player.runes -= TRIGGER_CONQUER_CARD.cost;
  appendEvent(state, {
    type: "card-played",
    playerId: player.id,
    instanceId: cardInstance.instanceId,
    cardId: cardInstance.cardId
  });

  const playSeq = state.eventSeq;
  state.outstandingTasks.push(
    {
      id: `task:${cardInstance.instanceId}:mandatory:${playSeq}`,
      sourceCardId: cardInstance.cardId,
      sourceObjectId: cardInstance.instanceId,
      sourcePlayerId: player.id,
      reason: "resolve-card",
      optional: false
    },
    {
      id: `task:${cardInstance.instanceId}:trigger:${playSeq}`,
      sourceCardId: cardInstance.cardId,
      sourceObjectId: cardInstance.instanceId,
      sourcePlayerId: player.id,
      reason: "trigger-conquer",
      optional: true,
      effect: syntheticTriggerConquer().effect,
      targetChoices: [
        { kind: "player", playerId: opponentId(state, player.id) }
      ]
    }
  );
  return null;
}

function answerPrompt(
  state: GameState,
  command: Extract<Command, { type: "respond-to-prompt" }>
): EngineError | null {
  const prompt = state.prompt;
  if (!prompt || prompt.id !== command.promptId) {
    return {
      code: ENGINE_ERRORS.promptNotFound,
      message: `Prompt ${command.promptId} is not active.`
    };
  }
  if (prompt.ownerPlayerId !== command.playerId ||
      prompt.playerId !== command.playerId) {
    return {
      code: ENGINE_ERRORS.notYourTurn,
      message: "Only the prompt owner may answer this prompt."
    };
  }
  if (command.stateVersion !== undefined &&
      command.stateVersion !== prompt.stateVersion) {
    return {
      code: ENGINE_ERRORS.promptExpired,
      message: "The prompt response was created for a different state version."
    };
  }
  if (prompt.stateVersion !== state.version) {
    return {
      code: ENGINE_ERRORS.promptExpired,
      message: "The prompt has expired."
    };
  }
  if (!prompt.options.some(option => option.id === command.optionId)) {
    return {
      code: ENGINE_ERRORS.invalidPromptAnswer,
      message: `Option ${command.optionId} is not valid for this prompt.`
    };
  }

  const task = state.outstandingTasks.find(
    candidate => candidate.id === prompt.taskId
  );
  if (!task) {
    return {
      code: ENGINE_ERRORS.promptNotFound,
      message: "The prompted task is no longer active."
    };
  }

  appendEvent(state, {
    type: "prompt-answered",
    promptId: prompt.id,
    playerId: prompt.ownerPlayerId,
    optionId: command.optionId
  });

  if (command.optionId === "skip") {
    appendEvent(state, {
      type: "trigger-skipped",
      taskId: task.id,
      sourceCardId: task.sourceCardId
    });
  } else if (command.optionId.startsWith("target:")) {
    const target = task.targetChoices?.find(
      candidate => targetOptionId(candidate) === command.optionId
    );
    if (!target) {
      return {
        code: ENGINE_ERRORS.invalidPromptAnswer,
        message: `Target option ${command.optionId} is not valid.`
      };
    }
    applyEffect(state, task, [target]);
  } else if (task.effect?.kind === "judge-required") {
    if (command.optionId !== "judge-required") {
      return {
        code: ENGINE_ERRORS.invalidPromptAnswer,
        message: "This card requires judge confirmation."
      };
    }
    return {
      code: ENGINE_ERRORS.judgeRequired,
      message: "Judge-required effects require an authoritative ruling and cannot be resolved by player confirmation."
    };
  } else if (command.optionId === "resolve") {
    applyEffect(state, task, defaultTargets(state, task));
  }

  state.prompt = null;
  state.outstandingTasks = state.outstandingTasks.filter(
    candidate => candidate.id !== prompt.taskId
  );
  return null;
}

function applyEffect(
  state: GameState,
  task: OutstandingTask,
  targets: readonly EffectTarget[]
): void {
  const effect = task.effect;
  if (!effect) return;
  if (effect.kind === "judge-required") return;
  if (effect.kind === "gain-points") {
    const resolvedTargets = targets.length > 0
      ? targets
      : [...effect.targets];
    for (const target of resolvedTargets) {
      if (target.kind !== "player") continue;
      const foundation = requireFoundationGame(state);
      const player = getPlayer(foundation, target.playerId) as FoundationPlayerState;
      player.score = Math.min(Number.MAX_SAFE_INTEGER, player.score + effect.amount);
      appendEvent(state, {
        type: "points-gained",
        sourceCardId: task.sourceCardId,
        sourcePlayerId: task.sourcePlayerId,
        targetPlayerId: target.playerId,
        amount: effect.amount
      });
      state.version += 1;
    }
    return;
  }

  const damageEffect = effect.kind === "damage" ? effect : null;
  if (!damageEffect) return;
  const foundationTargets = targets.length > 0
    ? targets
    : [...damageEffect.targets];
  for (const target of foundationTargets) {
    if (damageEffect && target.kind === "player" &&
        state.rules.rulesetId === SYNTHETIC_RULESET_ID) {
      const synthetic = requireSyntheticGame(state);
      const player = getSyntheticPlayer(synthetic, target.playerId);
      player.points -= damageEffect.amount;
      appendEvent(state, {
        type: "damage-dealt",
        sourceCardId: task.sourceCardId,
        sourcePlayerId: task.sourcePlayerId,
        targetPlayerId: target.playerId,
        amount: damageEffect.amount
      });
      state.version += 1;
      continue;
    }
    if (damageEffect && target.kind === "object") {
      const object = state.objects[target.objectId];
      if (!object) continue;
      object.damage += damageEffect.amount;
      const source = state.objects[task.sourceObjectId];
      appendEvent(state, {
        type: "damage-dealt",
        sourceCardId: task.sourceCardId,
        sourcePlayerId: source?.controllerPlayerId ?? state.activePlayerId,
        targetPlayerId: object.controllerPlayerId,
        targetObjectId: object.objectId,
        amount: damageEffect.amount
      });
      state.version += 1;
    }
  }
}

function defaultTargets(state: GameState, task: OutstandingTask): EffectTarget[] {
  if (task.targetChoices?.length === 1) {
    return [task.targetChoices[0]!];
  }
  if (task.effect?.kind === "damage" && task.effect.targets.length > 0) {
    return [...task.effect.targets];
  }
  return [];
}

function effectDefinitionTargets(effect: CardEffect): EffectTarget[] {
  if (effect.kind === "judge-required") return [];
  return [...effect.targets];
}

function availableTargets(
  state: GameState,
  playerId: PlayerId
): EffectTarget[] {
  const targets: EffectTarget[] = [];
  for (const object of Object.values(state.objects)) {
    if (object.zone === "board" || object.zone === "battlefield") {
      targets.push({ kind: "object", objectId: object.objectId });
    }
  }
  return targets;
}

function targetOptionId(target: EffectTarget): string {
  return target.kind === "player"
    ? `target:player:${target.playerId}`
    : `target:object:${target.objectId}`;
}

function runHotFepr(state: GameState): void {
  handleOutstandingTasks(state);
  while (state.prompt === null &&
         state.outstandingTasks.some(task =>
           task.effect?.kind !== "judge-required" && task.reason !== "resolve-card"
         ) &&
         resolveNextExecutableTask(state)) {
    handleOutstandingTasks(state);
  }
  cleanupResolvedPermanents(state);
  moveResolvedFoundationSpells(state);
}

function handleOutstandingTasks(state: GameState): void {
  while (!state.prompt && state.outstandingTasks.length > 0) {
    const task = state.outstandingTasks[0]!;

    if (task.effect?.kind === "judge-required") {
      createTaskPrompt(state, task, [
        { id: "judge-required", label: "Judge required" }
      ]);
      continue;
    }

    if (task.optional) {
      createTaskPrompt(state, task, [
        { id: "resolve", label: "Resolve trigger" },
        { id: "skip", label: "Skip trigger" }
      ]);
      continue;
    }

  if (task.requiresTargetChoice &&
      (task.targetChoices?.length ?? 0) > 0) {
      createTaskPrompt(
        state,
        task,
        (task.targetChoices ?? []).map(target => ({
          id: targetOptionId(target),
          label: target.kind === "player"
            ? `Player ${target.playerId}`
            : `Object ${target.objectId}`
        }))
      );
      continue;
    }

    if (task.effect) {
      break;
    }

    state.outstandingTasks.shift();
    appendEvent(state, {
      type: "task-resolved",
      taskId: task.id,
      sourceCardId: task.sourceCardId,
      reason: task.reason,
      autoResolved: true
    });
  }
}

function createTaskPrompt(
  state: GameState,
  task: OutstandingTask,
  options: PromptOption[]
): void {
  const prompt: Prompt = {
    id: `prompt:${task.id}`,
    ownerPlayerId: state.activePlayerId,
    playerId: state.activePlayerId,
    stateVersion: state.version + 1,
    status: "pending",
    taskId: task.id,
    reason: task.reason,
    optional: task.optional,
    options
  };
  state.prompt = prompt;
  appendEvent(state, {
    type: "prompt-created",
    promptId: prompt.id,
    playerId: prompt.ownerPlayerId,
    reason: prompt.reason,
    optional: prompt.optional
  });
}

function resolveNextExecutableTask(state: GameState): boolean {
  const index = state.outstandingTasks.findIndex(
    task =>
      task.effect?.kind !== "judge-required" &&
      task.reason !== "resolve-card" &&
      !task.requiresTargetChoice &&
      (task.effect?.targets.length ?? 0) > 0 &&
      !state.prompt
  );
  if (index === -1) return false;

  const task = state.outstandingTasks[index]!;
  if (task.effect) {
    applyEffect(state, task, defaultTargets(state, task));
  }
  state.outstandingTasks.splice(index, 1);
  appendEvent(state, {
    type: "task-resolved",
    taskId: task.id,
    sourceCardId: task.sourceCardId,
    reason: task.reason,
    autoResolved: true
  });
  return true;
}

function cleanupResolvedPermanents(state: GameState): void {
  if (state.turnPhase !== "cleanup") return;
  state.turnPhase = "main";
}

function moveResolvedFoundationSpells(state: GameState): void {
  if (state.rules.rulesetId !== FOUNDATION_RULESET_ID) return;
  const foundation = state as FoundationGameState;
  for (const player of foundation.players) {
    const unresolved = new Set(state.outstandingTasks.map(task =>
      task.sourceObjectId
    ));
    const resolvedSpells = player.chain.filter(instanceId =>
      !unresolved.has(instanceId)
    );
    for (const instanceId of resolvedSpells) {
      const object = foundation.objects[instanceId];
      if (!object) {
        throw new Error(`Chain instance ${instanceId} has no game object`);
      }
      player.chain = player.chain.filter(candidate => candidate !== instanceId);
      player.discard.push(instanceId);
      object.zone = "discard";
      foundation.version += 1;
    }
  }
}

function checkGameEnd(state: GameState): void {
  if (state.phase === "ended") return;
  const scoreOf = (player: PlayerState): number =>
    state.rules.rulesetId === SYNTHETIC_RULESET_ID
      ? (player as SyntheticPlayerState).points
      : (player as FoundationPlayerState).score;

  if (state.rules.rulesetId === FOUNDATION_RULESET_ID &&
      (state.prompt !== null || state.outstandingTasks.length > 0)) {
    return;
  }

  if (state.rules.rulesetId === FOUNDATION_RULESET_ID && state.rules.targetPoints > 0) {
    const threshold = state.rules.targetPoints;
    const winners = state.players.filter(player => scoreOf(player) >= threshold);
    if (winners.length === 0) return;
    const highestScore = Math.max(...state.players.map(player => scoreOf(player)));
    const leaders = winners.filter(player => scoreOf(player) === highestScore);
    if (leaders.length !== 1) return;

    state.phase = "ended";
    state.turnPhase = "ended";
    state.winnerPlayerId = leaders[0]!.id;
    appendEvent(state, {
      type: "game-ended",
      winnerPlayerId: leaders[0]!.id
    });
    state.prompt = null;
    state.outstandingTasks = [];
    return;
  }

  if (state.rules.targetPoints > 0) {
    const winner = state.players.find(
      player =>
        scoreOf(player) >= state.rules.targetPoints
    );
    if (!winner) return;

    state.phase = "ended";
    state.turnPhase = "ended";
    state.winnerPlayerId = winner.id;
    appendEvent(state, {
      type: "game-ended",
      winnerPlayerId: winner.id
    });
    state.prompt = null;
    state.outstandingTasks = [];
    return;
  }

  const loser = state.players.find(player =>
    scoreOf(player) <= 0
  );
  if (!loser) return;

  const winner = state.players.find(player => player.id !== loser.id)!;
  if (!winner) return;

  state.phase = "ended";
  state.turnPhase = "ended";
  state.winnerPlayerId = winner.id;
  appendEvent(state, {
    type: "game-ended",
    winnerPlayerId: winner.id
  });
  state.prompt = null;
  state.outstandingTasks = [];
}

function requireActivePlayer(
  state: GameState,
  playerId: PlayerId
): EngineError | null {
  if (state.activePlayerId !== playerId) {
    return {
      code: ENGINE_ERRORS.notYourTurn,
      message: `It is not ${playerId}'s turn.`
    };
  }
  return null;
}

function getPlayer(state: GameState, playerId: PlayerId): PlayerState {
  return requirePlayer(state, playerId);
}

function requirePlayer(state: GameState, playerId: PlayerId): PlayerState {
  const player = state.players.find(player => player.id === playerId);
  if (!player) {
    throw new Error(`Player ${playerId} is not in this game`);
  }
  return player;
}

function opponentId(state: GameState, playerId: PlayerId): PlayerId {
  return state.players.find(player => player.id !== playerId)!.id;
}

function getDefinition(
  state: GameState,
  cardId: string
): EngineCardDefinition | undefined {
  return state.cards[cardId];
}

function objectExists(state: GameState, instanceId: string): boolean {
  return Boolean(state.objects[instanceId]);
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

function projectPrompt(prompt: Prompt): Prompt {
  return {
    id: prompt.id,
    ownerPlayerId: prompt.ownerPlayerId,
    playerId: prompt.playerId,
    stateVersion: prompt.stateVersion,
    status: prompt.status,
    taskId: prompt.taskId,
    reason: prompt.reason,
    optional: prompt.optional,
    options: prompt.options.map(option => ({ ...option }))
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

function appendEvent(
  state: GameState,
  event: GameEventInput
): GameEvent {
  state.eventSeq += 1;
  const fullEvent = {
    ...event,
    seq: state.eventSeq,
    turnNumber: state.turnNumber,
    activePlayerId: state.activePlayerId
  } as GameEvent;
  state.eventLog.push(fullEvent);
  state.version += 1;
  return fullEvent;
}

function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

function failure(state: GameState, error: EngineError): CommandResult {
  return { state, events: [], error };
}

function requireNonNegativeInteger(
  value: number,
  name: string
): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a nonnegative integer`);
  }
  return value;
}

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function requireDefinition(
  cards: ReadonlyMap<string, EngineCardDefinition>,
  cardId: string
): EngineCardDefinition {
  const definition = cards.get(cardId);
  if (!definition) {
    throw new Error(`Unknown card definition ${cardId}`);
  }
  return definition;
}
