export const FULL_PRODUCT_PHASES = [
  "setup",
  "ready-check",
  "refresh",
  "main",
  "battle-declaration",
  "battle",
  "end",
  "ended"
] as const;

export const FULL_PRODUCT_TURN_STEPS = [
  "refresh",
  "main",
  "declare",
  "resolve",
  "end"
] as const;

export const FULL_PRODUCT_ERROR_CODES = {
  invalidCommand: "invalid_command",
  notYourTurn: "not_your_turn",
  promptRequired: "prompt_required",
  promptNotFound: "prompt_not_found",
  invalidPromptAnswer: "invalid_prompt_answer",
  promptExpired: "prompt_expired",
  cardNotFound: "card_not_found",
  notEnoughEnergy: "not_enough_energy",
  zoneCapacityExceeded: "zone_capacity_exceeded",
  noLegalAttackers: "no_legal_attackers",
  gameEnded: "game_ended"
} as const;

export type FullProductPhase = (typeof FULL_PRODUCT_PHASES)[number];
export type FullProductTurnStep = (typeof FULL_PRODUCT_TURN_STEPS)[number];
export type FullProductErrorCode =
  (typeof FULL_PRODUCT_ERROR_CODES)[keyof typeof FULL_PRODUCT_ERROR_CODES];

export type FullProductPlayerId = string;

export interface FullProductCardDefinition {
  cardId: string;
  name: string;
  cost: number;
  attack: number;
  health: number;
  types: readonly FullProductCardType[];
}

export type FullProductCardType =
  | "unit"
  | "rune"
  | "battlefield"
  | "champion"
  | "legend"
  | "spell";

export interface FullProductCardInstance {
  instanceId: string;
  cardId: string;
  ownerPlayerId: FullProductPlayerId;
  zone: FullProductZone;
  damage: number;
  attackedThisTurn: boolean;
}

export type FullProductZone =
  | "deck"
  | "hand"
  | "board"
  | "rune"
  | "discard"
  | "banish";

export interface FullProductPlayerState {
  playerId: FullProductPlayerId;
  name: string;
  life: number;
  energy: number;
  maximumEnergy: number;
  deck: string[];
  hand: string[];
  board: string[];
  rune: string[];
  discard: string[];
  banish: string[];
}

export interface FullProductLegalAction {
  type:
    | "confirm-setup"
    | "answer-prompt"
    | "play-card"
    | "declare-attack"
    | "pass-main"
    | "resolve-battle"
    | "pass-battle";
  playerId: FullProductPlayerId;
  instanceId?: string;
  targetInstanceId?: string;
  promptId?: string;
  optionId?: string;
  stateVersion?: number;
}

export interface FullProductPrompt {
  promptId: string;
  playerId: FullProductPlayerId;
  stateVersion: number;
  reason:
    | "ready-check"
    | "battle-declaration"
    | "damage-prevention"
    | "judge-required";
  options: FullProductPromptOption[];
}

export interface FullProductPromptOption {
  optionId: string;
  label: string;
  instanceId?: string;
  targetInstanceId?: string;
}

export type FullProductEvent =
  | { type: "game-started"; seq: number; version: number }
  | { type: "phase-entered"; seq: number; version: number; phase: FullProductPhase }
  | { type: "turn-started"; seq: number; version: number; turnNumber: number; playerId: FullProductPlayerId }
  | { type: "energy-refreshed"; seq: number; version: number; playerId: FullProductPlayerId; energy: number }
  | { type: "card-drawn"; seq: number; version: number; playerId: FullProductPlayerId; instanceId: string }
  | { type: "card-played"; seq: number; version: number; playerId: FullProductPlayerId; instanceId: string; cardId: string }
  | { type: "zone-changed"; seq: number; version: number; instanceId: string; from: FullProductZone; to: FullProductZone }
  | {
      type: "battle-declared";
      seq: number;
      version: number;
      playerId: FullProductPlayerId;
      attackerInstanceId: string;
      targetInstanceId: string;
    }
  | { type: "damage-dealt"; seq: number; version: number; targetInstanceId: string; amount: number }
  | { type: "player-damaged"; seq: number; version: number; targetPlayerId: FullProductPlayerId; amount: number }
  | { type: "object-destroyed"; seq: number; version: number; instanceId: string }
  | { type: "prompt-created"; seq: number; version: number; prompt: FullProductPrompt }
  | { type: "prompt-answered"; seq: number; version: number; promptId: string; optionId: string }
  | { type: "phase-advanced"; seq: number; version: number; from: FullProductPhase; to: FullProductPhase }
  | { type: "turn-ended"; seq: number; version: number; turnNumber: number }
  | { type: "game-ended"; seq: number; version: number; winnerPlayerId: FullProductPlayerId | null };

type DistributiveOmit<T, Keys extends keyof T> = T extends unknown
  ? Omit<T, Keys>
  : never;
type FullProductEventInput = DistributiveOmit<
  FullProductEvent,
  "seq" | "version"
>;

export interface FullProductCommand {
  type:
    | "confirm-setup"
    | "play-card"
    | "declare-attack"
    | "pass-main"
    | "resolve-battle"
    | "pass-battle"
    | "answer-prompt";
  playerId: FullProductPlayerId;
  instanceId?: string;
  targetInstanceId?: string;
  promptId?: string;
  optionId?: string;
  stateVersion?: number;
}

export interface FullProductGameConfig {
  players: readonly {
    playerId: FullProductPlayerId;
    name: string;
    life: number;
    maximumEnergy: number;
    deck: readonly { instanceId: string; cardId: string }[];
    startingHand: readonly { instanceId: string; cardId: string }[];
  }[];
  cards: readonly FullProductCardDefinition[];
  firstPlayerId?: FullProductPlayerId;
  maximumBoardSize?: number;
  drawPerTurn?: number;
}

export interface FullProductGameState {
  version: number;
  eventSeq: number;
  turnNumber: number;
  phase: FullProductPhase;
  turnStep: FullProductTurnStep;
  activePlayerId: FullProductPlayerId;
  priorityPlayerId: FullProductPlayerId;
  winnerPlayerId: FullProductPlayerId | null;
  prompt: FullProductPrompt | null;
  readyPlayerIds: readonly FullProductPlayerId[];
  players: readonly FullProductPlayerState[];
  cards: Readonly<Record<string, FullProductCardDefinition>>;
  instances: Readonly<Record<string, FullProductCardInstance>>;
  declaredAttacks: readonly {
    attackerInstanceId: string;
    targetInstanceId: string;
  }[];
  maximumBoardSize: number;
  drawPerTurn: number;
  eventLog: FullProductEvent[];
}

export interface FullProductCommandResult {
  state: FullProductGameState;
  events: readonly FullProductEvent[];
  error: { code: FullProductErrorCode; message: string } | null;
}

const defaultMaximumBoardSize = 6;
const defaultDrawPerTurn = 1;

const supportedCardTypes = new Set<FullProductCardType>([
  "unit",
  "spell"
]);

export function createFullProductGame(
  config: FullProductGameConfig
): FullProductGameState {
  if (config.players.length !== 2) {
    throw new Error("Full-product 1v1 games require exactly two players");
  }
  const playerIds = config.players.map(player => player.playerId);
  if (playerIds.some(id => !id) || new Set(playerIds).size !== 2) {
    throw new Error("Players must have unique nonempty identities");
  }
  const maximumBoardSize = requirePositiveInteger(
    config.maximumBoardSize ?? defaultMaximumBoardSize,
    "maximumBoardSize"
  );
  const drawPerTurn = requireNonNegativeInteger(
    config.drawPerTurn ?? defaultDrawPerTurn,
    "drawPerTurn"
  );
  for (const player of config.players) {
    if (!player.name?.trim()) {
      throw new Error(`Player ${player.playerId} requires a name`);
    }
    requirePositiveInteger(player.life, `life for ${player.playerId}`);
    requirePositiveInteger(
      player.maximumEnergy,
      `maximumEnergy for ${player.playerId}`
    );
  }

  const cards: Record<string, FullProductCardDefinition> = {};
  for (const definition of config.cards) {
    validateDefinition(definition);
    if (cards[definition.cardId]) {
      throw new Error(`Duplicate card definition ${definition.cardId}`);
    }
    cards[definition.cardId] = definition;
  }

  const state: FullProductGameState = {
    version: 0,
    eventSeq: 0,
    turnNumber: 0,
    phase: "setup",
    turnStep: "refresh",
    activePlayerId: playerIds[0]!,
    priorityPlayerId: playerIds[0]!,
    winnerPlayerId: null,
    prompt: null,
    readyPlayerIds: [],
    players: config.players.map(player => ({
      playerId: player.playerId,
      name: player.name,
      life: player.life,
      energy: 0,
      maximumEnergy: player.maximumEnergy,
      deck: [],
      hand: [],
      board: [],
      rune: [],
      discard: [],
      banish: []
    })),
    cards,
    instances: {},
    declaredAttacks: [],
    maximumBoardSize,
    drawPerTurn,
    eventLog: []
  };

  const instanceIds = new Set<string>();
  for (const player of config.players) {
    const statePlayer = requirePlayer(state, player.playerId);
    for (const zone of ["deck", "startingHand"] as const) {
      const source = zone === "deck" ? player.deck : player.startingHand;
      for (const instance of source) {
        validateInstance(instance);
        if (!cards[instance.cardId]) {
          throw new Error(`Unknown card definition ${instance.cardId}`);
        }
        if (instanceIds.has(instance.instanceId)) {
          throw new Error(`Duplicate card instance ${instance.instanceId}`);
        }
        instanceIds.add(instance.instanceId);
        const targetZone = zone === "deck" ? "deck" : "hand";
        state.instances = {
          ...state.instances,
          [instance.instanceId]: {
            instanceId: instance.instanceId,
            cardId: instance.cardId,
            ownerPlayerId: player.playerId,
            zone: targetZone,
            damage: 0,
            attackedThisTurn: false
          }
        };
        statePlayer[targetZone].push(instance.instanceId);
      }
    }
  }

  appendEvent(state, { type: "game-started" });
  appendEvent(state, {
    type: "phase-entered",
    phase: "setup"
  });

  const firstPlayerId = config.firstPlayerId ?? playerIds[0]!;
  if (!playerIds.includes(firstPlayerId)) {
    throw new Error(`Unknown first player ${firstPlayerId}`);
  }
  state.activePlayerId = firstPlayerId;
  state.priorityPlayerId = firstPlayerId;
  state.prompt = createPrompt(state, firstPlayerId, "ready-check", [
    { optionId: "ready", label: "Ready" }
  ]);
  appendEvent(state, {
    type: "prompt-created",
    prompt: state.prompt
  });
  return state;
}

export function listLegalActions(
  state: FullProductGameState,
  playerId: FullProductPlayerId
): FullProductLegalAction[] {
  const player = requirePlayer(state, playerId);
  if (state.phase === "ended") return [];
  if (state.prompt) {
    return state.prompt.playerId === playerId
      ? state.prompt.options.map(option => ({
          type: "answer-prompt" as const,
          playerId,
          promptId: state.prompt!.promptId,
          optionId: option.optionId
        }))
      : [];
  }
  if (state.phase === "main" &&
      playerId === state.activePlayerId &&
      playerId === state.priorityPlayerId) {
    const actions: FullProductLegalAction[] = [
      { type: "pass-main", playerId }
    ];
    for (const instanceId of player.hand) {
      const card = state.cards[state.instances[instanceId]!.cardId]!;
      const playableType = card.types.some(type => supportedCardTypes.has(type));
      const boardHasRoom = !card.types.includes("unit") ||
        player.board.length < state.maximumBoardSize;
      if (card.cost <= player.energy && playableType && boardHasRoom) {
        actions.push({
          type: "play-card",
          playerId,
          instanceId
        });
      }
    }
    return actions;
  }
  if (state.phase === "battle-declaration" &&
      playerId === state.activePlayerId &&
      playerId === state.priorityPlayerId) {
    const actions: FullProductLegalAction[] = [
      { type: "pass-battle", playerId }
    ];
    const defender = requirePlayer(
      state,
      nextPlayerId(state, player.playerId)
    );
    const targets = [
      ...defender.board,
      ...(defender.life > 0 ? ["player"] : [])
    ];
    for (const instanceId of player.board) {
      if (!state.instances[instanceId]!.attackedThisTurn) {
        for (const targetInstanceId of targets) {
          actions.push({
            type: "declare-attack",
            playerId,
            instanceId,
            targetInstanceId
          });
        }
      }
    }
    return actions;
  }
  if (state.phase === "battle" &&
      playerId === state.activePlayerId &&
      playerId === state.priorityPlayerId) {
    return [{ type: "resolve-battle", playerId }];
  }
  return [];
}

export function submitFullProductCommand(
  currentState: FullProductGameState,
  command: FullProductCommand
): FullProductCommandResult {
  if (currentState.phase === "ended") {
    return failure(currentState, {
      code: FULL_PRODUCT_ERROR_CODES.gameEnded,
      message: "The game has already ended"
    });
  }
  const state = structuredClone(currentState);
  const startingSeq = state.eventSeq;
  const error = executeCommand(state, command);
  if (error) {
    return failure(currentState, error);
  }
  checkGameEnd(state);
  return {
    state,
    events: state.eventLog.filter(event => event.seq > startingSeq),
    error: null
  };
}

function executeCommand(
  state: FullProductGameState,
  command: FullProductCommand
): { code: FullProductErrorCode; message: string } | null {
  if (!command || !command.playerId || !command.type) {
    return invalidCommand();
  }
  const player = findPlayer(state, command.playerId);
  if (!player) {
    return invalidCommand("Unknown player");
  }
  if (state.prompt) {
    if (command.type !== "answer-prompt") {
      return {
        code: FULL_PRODUCT_ERROR_CODES.promptRequired,
        message: "The active prompt must be answered first"
      };
    }
    if (command.playerId !== state.prompt.playerId) {
      return {
        code: FULL_PRODUCT_ERROR_CODES.promptRequired,
        message: "Only the prompted player may answer"
      };
    }
    return answerPrompt(state, command);
  }
  if (command.playerId !== state.priorityPlayerId) {
    return {
      code: FULL_PRODUCT_ERROR_CODES.notYourTurn,
      message: "The player does not currently have priority"
    };
  }

  switch (command.type) {
    case "confirm-setup":
      return {
        code: FULL_PRODUCT_ERROR_CODES.invalidCommand,
        message: "Setup is handled through the ready-check prompt"
      };
    case "play-card":
      return playCard(state, player, command);
    case "pass-main":
      return enterBattleDeclaration(state);
    case "declare-attack":
      return declareAttack(state, player, command);
    case "pass-battle":
      return enterBattle(state);
    case "resolve-battle":
      return resolveBattle(state);
    case "answer-prompt":
      return {
        code: FULL_PRODUCT_ERROR_CODES.promptNotFound,
        message: "There is no active prompt"
      };
    default:
      return invalidCommand();
  }
}

function playCard(
  state: FullProductGameState,
  player: FullProductPlayerState,
  command: FullProductCommand
): { code: FullProductErrorCode; message: string } | null {
  if (state.phase !== "main") {
    return {
      code: FULL_PRODUCT_ERROR_CODES.invalidCommand,
      message: "Cards can only be played during the main phase"
    };
  }
  const instanceId = command.instanceId;
  if (!instanceId) return invalidCommand("instanceId is required");
  const handIndex = player.hand.indexOf(instanceId);
  if (handIndex === -1) {
    return {
      code: FULL_PRODUCT_ERROR_CODES.cardNotFound,
      message: "The card is not in the player's hand"
    };
  }
  const instance = state.instances[instanceId]!;
  const card = state.cards[instance.cardId]!;
  if (card.cost > player.energy) {
    return {
      code: FULL_PRODUCT_ERROR_CODES.notEnoughEnergy,
      message: "The player does not have enough energy"
    };
  }
  if (card.types.includes("unit") &&
      player.board.length >= state.maximumBoardSize) {
    return {
      code: FULL_PRODUCT_ERROR_CODES.zoneCapacityExceeded,
      message: "The board is full"
    };
  }

  player.energy -= card.cost;
  moveInstance(state, instanceId, card.types.includes("unit") ? "board" : "discard");
  appendEvent(state, {
    type: "card-played",
    playerId: player.playerId,
    instanceId,
    cardId: card.cardId
  });
  return null;
}

function enterBattleDeclaration(
  state: FullProductGameState
): { code: FullProductErrorCode; message: string } | null {
  if (state.phase !== "main") {
    return {
      code: FULL_PRODUCT_ERROR_CODES.invalidCommand,
      message: "The main phase must be passed during the main phase"
    };
  }
  advancePhase(state, "main", "battle-declaration");
  state.turnStep = "declare";
  return null;
}

function declareAttack(
  state: FullProductGameState,
  player: FullProductPlayerState,
  command: FullProductCommand
): { code: FullProductErrorCode; message: string } | null {
  if (state.phase !== "battle-declaration") {
    return {
      code: FULL_PRODUCT_ERROR_CODES.invalidCommand,
      message: "Attacks are declared during battle declaration"
    };
  }
  const instanceId = command.instanceId;
  if (!instanceId) return invalidCommand("instanceId is required");
  if (!player.board.includes(instanceId)) {
    return {
      code: FULL_PRODUCT_ERROR_CODES.cardNotFound,
      message: "The attacker is not on the active player's board"
    };
  }
  if (state.declaredAttacks.some(attack =>
    attack.attackerInstanceId === instanceId
  )) {
    return invalidCommand("The attacker has already been declared");
  }
  const targetInstanceId = command.targetInstanceId;
  if (!targetInstanceId) {
    return invalidCommand("targetInstanceId is required");
  }
  const defender = requirePlayer(state, nextPlayerId(state, player.playerId));
  if (!defender.board.includes(targetInstanceId) &&
      targetInstanceId !== "player") {
    return {
      code: FULL_PRODUCT_ERROR_CODES.cardNotFound,
      message: "The attack target is not legal"
    };
  }
  state.instances[instanceId]!.attackedThisTurn = true;
  state.declaredAttacks = [
    ...state.declaredAttacks,
    { attackerInstanceId: instanceId, targetInstanceId }
  ];
  appendEvent(state, {
    type: "battle-declared",
    playerId: player.playerId,
    attackerInstanceId: instanceId,
    targetInstanceId
  });
  return null;
}

function enterBattle(
  state: FullProductGameState
): { code: FullProductErrorCode; message: string } | null {
  if (state.phase !== "battle-declaration") {
    return {
      code: FULL_PRODUCT_ERROR_CODES.invalidCommand,
      message: "The battle phase starts after battle declaration"
    };
  }
  if (state.declaredAttacks.length === 0) {
    return {
      code: FULL_PRODUCT_ERROR_CODES.noLegalAttackers,
      message: "At least one attacker must be declared"
    };
  }
  advancePhase(state, "battle-declaration", "battle");
  state.turnStep = "resolve";
  return null;
}

function resolveBattle(
  state: FullProductGameState
): { code: FullProductErrorCode; message: string } | null {
  if (state.phase !== "battle") {
    return {
      code: FULL_PRODUCT_ERROR_CODES.invalidCommand,
      message: "Battle can only be resolved during the battle phase"
    };
  }
  const active = requirePlayer(state, state.activePlayerId);
  const defender = requirePlayer(state, nextPlayerId(state, active.playerId));
  const boardInstanceIds = new Set([
    ...active.board,
    ...defender.board
  ]);
  const pendingObjectDamage = new Map<string, number>();
  let pendingPlayerDamage = 0;

  for (const attack of state.declaredAttacks) {
    const attackerId = attack.attackerInstanceId;
    if (!boardInstanceIds.has(attackerId)) continue;
    const attacker = state.instances[attackerId]!;
    const attackerCard = state.cards[attacker.cardId]!;
    if (attack.targetInstanceId !== "player") {
      const defenderId = attack.targetInstanceId;
      if (!boardInstanceIds.has(defenderId)) continue;
      const defenderInstance = state.instances[defenderId]!;
      const defenderCard = state.cards[defenderInstance.cardId]!;
      pendingObjectDamage.set(
        defenderId,
        (pendingObjectDamage.get(defenderId) ?? 0) + attackerCard.attack
      );
      pendingObjectDamage.set(
        attackerId,
        (pendingObjectDamage.get(attackerId) ?? 0) + defenderCard.attack
      );
      continue;
    }
    pendingPlayerDamage += attackerCard.attack;
  }

  for (const [instanceId, amount] of pendingObjectDamage) {
    dealObjectDamage(state, instanceId, amount);
  }
  if (pendingPlayerDamage > 0) {
    defender.life -= pendingPlayerDamage;
    appendEvent(state, {
      type: "player-damaged",
      targetPlayerId: defender.playerId,
      amount: pendingPlayerDamage
    });
  }
  state.declaredAttacks = [];
  for (const instance of Object.values(state.instances)) {
    instance.attackedThisTurn = false;
  }
  enterEnd(state);
  return null;
}

function enterEnd(
  state: FullProductGameState
): { code: FullProductErrorCode; message: string } | null {
  advancePhase(state, state.phase, "end");
  appendEvent(state, {
    type: "turn-ended",
    turnNumber: state.turnNumber
  });
  const nextPlayer = nextPlayerId(state, state.activePlayerId);
  state.activePlayerId = nextPlayer;
  state.priorityPlayerId = nextPlayer;
  advancePhase(state, "end", "refresh");
  startTurn(state, nextPlayer);
  return null;
}

function answerPrompt(
  state: FullProductGameState,
  command: FullProductCommand
): { code: FullProductErrorCode; message: string } | null {
  const prompt = state.prompt!;
  if (command.stateVersion !== undefined &&
      command.stateVersion !== prompt.stateVersion) {
    return {
      code: FULL_PRODUCT_ERROR_CODES.promptExpired,
      message: "The prompt answer was created for a different state version"
    };
  }
  if (prompt.stateVersion !== state.version) {
    return {
      code: FULL_PRODUCT_ERROR_CODES.promptExpired,
      message: "The prompt has expired"
    };
  }
  if (command.promptId !== prompt.promptId) {
    return {
      code: FULL_PRODUCT_ERROR_CODES.promptNotFound,
      message: "The prompt is not active"
    };
  }
  const option = prompt.options.find(
    option => option.optionId === command.optionId
  );
  if (!option) {
    return {
      code: FULL_PRODUCT_ERROR_CODES.invalidPromptAnswer,
      message: "The prompt answer is not legal"
    };
  }
  appendEvent(state, {
    type: "prompt-answered",
    promptId: prompt.promptId,
    optionId: option.optionId
  });
  if (prompt.reason === "ready-check") {
    if (option.optionId !== "ready") {
      return invalidCommand("The ready-check answer is not supported");
    }
    if (!state.readyPlayerIds.includes(command.playerId)) {
      state.readyPlayerIds = [...state.readyPlayerIds, command.playerId];
    }
    if (state.readyPlayerIds.length === 2) {
      state.prompt = null;
      state.priorityPlayerId = state.activePlayerId;
      advancePhase(state, "setup", "ready-check");
      advancePhase(state, "ready-check", "refresh");
      startTurn(state, state.activePlayerId);
      return null;
    }
    const nextReadyPlayer = state.players.find(player =>
      !state.readyPlayerIds.includes(player.playerId)
    )!;
    state.priorityPlayerId = nextReadyPlayer.playerId;
    state.prompt = createPrompt(
      state,
      nextReadyPlayer.playerId,
      "ready-check",
      [{ optionId: "ready", label: "Ready" }]
    );
    appendEvent(state, {
      type: "prompt-created",
      prompt: state.prompt
    });
  }
  return null;
}

function startTurn(
  state: FullProductGameState,
  playerId: FullProductPlayerId
): void {
  state.turnNumber += 1;
  state.turnStep = "refresh";
  const player = requirePlayer(state, playerId);
  player.energy = Math.min(
    player.maximumEnergy,
    player.energy + player.maximumEnergy
  );
  appendEvent(state, {
    type: "turn-started",
    turnNumber: state.turnNumber,
    playerId
  });
  appendEvent(state, {
    type: "energy-refreshed",
    playerId,
    energy: player.energy
  });
  for (let index = 0; index < (state.drawPerTurn ?? defaultDrawPerTurn); index += 1) {
    const deck = player.deck;
    if (deck.length === 0) break;
    const instanceId = deck.shift()!;
    moveInstance(state, instanceId, "hand");
    appendEvent(state, {
      type: "card-drawn",
      playerId,
      instanceId
    });
  }
  advancePhase(state, "refresh", "main");
  state.turnStep = "main";
}

function moveInstance(
  state: FullProductGameState,
  instanceId: string,
  to: FullProductZone
): void {
  const instance = state.instances[instanceId]!;
  const from = instance.zone;
  const owner = requirePlayer(state, instance.ownerPlayerId);
  owner[from] = owner[from].filter(id => id !== instanceId);
  owner[to].push(instanceId);
  instance.zone = to;
  appendEvent(state, {
    type: "zone-changed",
    instanceId,
    from,
    to
  });
}

function dealObjectDamage(
  state: FullProductGameState,
  instanceId: string,
  amount: number
): void {
  const instance = state.instances[instanceId]!;
  instance.damage += amount;
  appendEvent(state, {
    type: "damage-dealt",
    targetInstanceId: instanceId,
    amount
  });
  const card = state.cards[instance.cardId]!;
  if (instance.damage >= card.health) {
    moveInstance(state, instanceId, "discard");
    appendEvent(state, {
      type: "object-destroyed",
      instanceId
    });
  }
  return;
}

function advancePhase(
  state: FullProductGameState,
  from: FullProductPhase,
  to: FullProductPhase
): void {
  if (state.phase !== from) return;
  state.phase = to;
  appendEvent(state, {
    type: "phase-advanced",
    from,
    to
  });
}

function checkGameEnd(state: FullProductGameState): void {
  if (state.phase === "ended") return;
  const losers = state.players.filter(player => player.life <= 0);
  if (losers.length === 0) return;
  const winners = state.players.filter(player => player.life > 0);
  state.phase = "ended";
  state.turnStep = "end";
  state.winnerPlayerId = winners.length === 1 ? winners[0]!.playerId : null;
  state.prompt = null;
  state.declaredAttacks = [];
  appendEvent(state, {
    type: "game-ended",
    winnerPlayerId: state.winnerPlayerId
  });
}

function createPrompt(
  state: FullProductGameState,
  playerId: FullProductPlayerId,
  reason: FullProductPrompt["reason"],
  options: FullProductPromptOption[]
): FullProductPrompt {
  return {
    promptId: `prompt:${state.eventSeq + 2}`,
    playerId,
    stateVersion: state.version + 1,
    reason,
    options
  };
}

function findPlayer(
  state: FullProductGameState,
  playerId: FullProductPlayerId
): FullProductPlayerState | null {
  return state.players.find(player => player.playerId === playerId) ?? null;
}

function requirePlayer(
  state: FullProductGameState,
  playerId: FullProductPlayerId
): FullProductPlayerState {
  const player = findPlayer(state, playerId);
  if (!player) {
    throw new Error(`Player ${playerId} is not in this game`);
  }
  return player;
}

function nextPlayerId(
  state: FullProductGameState,
  playerId: FullProductPlayerId
): FullProductPlayerId {
  const other = state.players.find(player => player.playerId !== playerId);
  if (!other) {
    throw new Error("The game requires two players");
  }
  return other.playerId;
}

function invalidCommand(message = "The command is not valid"): {
  code: FullProductErrorCode;
  message: string;
} {
  return {
    code: FULL_PRODUCT_ERROR_CODES.invalidCommand,
    message
  };
}

function failure(
  state: FullProductGameState,
  error: { code: FullProductErrorCode; message: string }
): FullProductCommandResult {
  return { state, events: [], error };
}

function appendEvent(
  state: FullProductGameState,
  event: FullProductEventInput
): void {
  state.eventSeq += 1;
  state.version += 1;
  state.eventLog.push({
    ...event,
    seq: state.eventSeq,
    version: state.version
  } as FullProductEvent);
}

function validateDefinition(definition: FullProductCardDefinition): void {
  if (!definition || !definition.cardId || !definition.name) {
    throw new Error("Card definitions require cardId and name");
  }
  if (!Number.isSafeInteger(definition.cost) || definition.cost < 0 ||
      !Number.isSafeInteger(definition.attack) || definition.attack < 0 ||
      !Number.isSafeInteger(definition.health) || definition.health <= 0) {
    throw new Error(`Invalid card definition ${definition.cardId}`);
  }
  if (!Array.isArray(definition.types) || definition.types.length === 0) {
    throw new Error(`Card ${definition.cardId} requires at least one type`);
  }
  if (definition.types.some(type => !supportedCardTypes.has(type))) {
    throw new Error(`Card ${definition.cardId} has an unsupported type`);
  }
}

function validateInstance(instance: {
  instanceId: string;
  cardId: string;
}): void {
  if (!instance || !instance.instanceId || !instance.cardId) {
    throw new Error("Card instances require instanceId and cardId");
  }
}

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function requireNonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a nonnegative integer`);
  }
  return value;
}
