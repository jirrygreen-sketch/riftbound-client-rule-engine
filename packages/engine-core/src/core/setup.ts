import {
  FOUNDATION_RULESET_ID,
  TRIGGER_CONQUER_CARD
} from "@riftbound/protocol";
import type { PlayerId } from "@riftbound/protocol";
import type {
  CreateConfiguredGameOptions,
  CreateGameRulesOptions,
  EngineCardDefinition,
  FoundationGameState,
  FoundationGameRules,
  FoundationPlayerState,
  GameObject,
  GameRules,
  GameState,
  SyntheticGameRules,
  SyntheticGameState,
  SyntheticPlayerState,
  CardEffect,
  DamageEffect,
  GainPointsEffect,
  Zone
} from "../state.js";
import { SYNTHETIC_RULESET_ID } from "./constants.js";
import {
  appendEvent,
  requireDefinition,
  requireNonNegativeInteger,
  requirePositiveInteger
} from "./shared.js";
import type {
  CardInstanceLike,
  CreateGameOptions,
  CreateGamePlayerOptions,
  FoundationZoneList
} from "./contracts.js";
import { OBJECT_TYPE_ZONES, ZONE_INSTANCE_KEYS } from "./contracts.js";

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


export function syntheticTriggerConquer(): EngineCardDefinition {
  return {
    id: TRIGGER_CONQUER_CARD.id,
    name: TRIGGER_CONQUER_CARD.name,
    cost: TRIGGER_CONQUER_CARD.cost,
    types: ["spell"],
    effect: { kind: "damage", amount: 1, targets: [] }
  };
}
