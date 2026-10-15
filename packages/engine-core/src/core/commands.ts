import {
  ENGINE_ERRORS,
  FOUNDATION_RULESET_ID,
  TRIGGER_CONQUER_CARD,
  isCommand
} from "@riftbound/protocol";
import type {
  Command,
  CommandTarget,
  EngineError,
  PlayerId,
  Prompt,
} from "@riftbound/protocol";
import type {
  GameState,
  FoundationGameState,
  FoundationPlayerState,
  SyntheticGameState,
  SyntheticPlayerState,
  OutstandingTask,
  EffectTarget,
  CardEffect,
  DamageEffect,
  GainPointsEffect
} from "../state.js";
import { SYNTHETIC_RULESET_ID, type HotFeprStep } from "./constants.js";
import {
  appendEvent,
  cloneState,
  failure,
  getDefinition,
  getPlayer,
  getSyntheticPlayer,
  requireActivePlayer,
  requireFoundationGame,
  requireSyntheticGame,
  opponentId
} from "./shared.js";
import { syntheticTriggerConquer } from "./setup.js";
import {
  availableEffectTargets,
  currentPromptOptions,
  defaultTargets,
  effectDefinitionTargets,
  isEffectTarget,
  isTrustedFoundationEffectTask,
  isValuedEffect,
  markLegacyTaskJudgeRequired,
  reconcileLegacyPromptInPlace,
  targetOptionId,
  applyEffect
} from "./effects.js";
import {
  checkGameEnd,
  runHotFepr
} from "./lifecycle.js";
import {
  foundationActionOptions,
  foundationHandObject,
  foundationPrimaryType
} from "./projection.js";
import { OBJECT_TYPE_ZONES, ZONE_INSTANCE_KEYS } from "./contracts.js";
import type {
  CardInstanceLike,
  CommandResult,
  CreateGameOptions,
  LegacyPromptReconcileResult,
  LegacyPromptReconcileStatus
} from "./contracts.js";

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
  // An expired answer cannot silently apply an effect and then report an error.
  // An unselected mandatory target prompt may still be explicitly repaired to
  // judge-required at this boundary; other failed answers remain atomic.
  const expiredPrompt = state.rules.rulesetId === FOUNDATION_RULESET_ID &&
    command.type === "respond-to-prompt" && state.prompt &&
    state.prompt.id === command.promptId && state.prompt.stateVersion !== state.version;
  let repairedExpired = false;
  if (expiredPrompt && state.outstandingTasks.some(task =>
    task.id === state.prompt?.taskId && !task.optional && task.requiresTargetChoice &&
    isValuedEffect(task.effect) && task.effect.targets.length === 0)) {
    repairedExpired = reconcileLegacyPromptInPlace(state);
  }
  const error = executeCommand(state, command);
  if (error) {
    if (repairedExpired && state.eventSeq === startingSeq) {
      return { state, events: [], error };
    }
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


/**
 * Reconcile a legacy prompt/task pair at an authoritative transaction boundary.
 *
 * This is deliberately not used by projectGame: projections only filter what is
 * safe to disclose. Callers restoring or executing an authoritative state may
 * use this seam, then persist the returned state and events as one transaction.
 */
export function reconcileLegacyPrompt(
  currentState: GameState
): LegacyPromptReconcileResult {
  const state = cloneState(currentState);
  const startingSeq = state.eventSeq;
  const rejected = Boolean(
    state.prompt && !state.outstandingTasks.some(task => task.id === state.prompt!.taskId)
  );
  // Mark every saved foundation effect before the generic task loop can see it,
  // including tasks behind an already-pending prompt. No task is consumed on an
  // unverified effect/source.
  if (state.rules.rulesetId === FOUNDATION_RULESET_ID) {
    for (const task of state.outstandingTasks) {
      if (task.disposition || task.effect?.kind === "judge-required" ||
          task.reason === "resolve-card" || isTrustedFoundationEffectTask(state, task)) continue;
      markLegacyTaskJudgeRequired(state, task,
        state.prompt?.taskId === task.id ? state.prompt : undefined,
        "Judge required: the saved effect or its source cannot be verified.");
    }
  }
  const reconciled = reconcileLegacyPromptInPlace(state);
  if (reconciled || state.outstandingTasks.length > 0) {
    runHotFepr(state);
  }
  const changed = state.version !== currentState.version || state.eventSeq !== startingSeq;
  const hasJudgeRequired = state.outstandingTasks.some(task =>
    task.disposition === "judge-required" || task.effect?.kind === "judge-required"
  ) || state.prompt?.reason === "judge-required";
  return {
    state,
    changed,
    events: state.eventLog.filter(event => event.seq > startingSeq),
    status: rejected
      ? "rejected"
      : hasJudgeRequired
        ? "judge-required"
        : changed
          ? "resolved"
          : "unchanged"
  };
}


export function getHotFeprStep(state: GameState): HotFeprStep {
  if (state.prompt) {
    return "handle-outstanding-tasks";
  }
  if (state.outstandingTasks.length > 0) {
    const task = state.outstandingTasks[0]!;
    return task.disposition === "judge-required" || task.effect?.kind === "judge-required"
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


function executeCommand(
  state: GameState,
  command: Command
): EngineError | null {
  if (!state.players.some(player => player.id === command.playerId)) {
    return { code: ENGINE_ERRORS.invalidCommand, message: "Unknown player." };
  }
  // CR 650-651: a concession may end a duel even while a prompt is pending.
  if (command.type === "concede") {
    const winner = state.players.find(player => player.id !== command.playerId)!;
    state.phase = "ended";
    state.turnPhase = "ended";
    state.winnerPlayerId = winner.id;
    state.prompt = null;
    state.outstandingTasks = [];
    appendEvent(state, { type: "game-ended", winnerPlayerId: winner.id });
    return null;
  }
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


function passTurn(
  state: GameState,
  command: Extract<Command, { type: "pass" }>
): EngineError | null {
  const activeError = requireActivePlayer(state, command.playerId);
  if (activeError) return activeError;
  if (state.rules.rulesetId === FOUNDATION_RULESET_ID &&
      !foundationActionOptions(state as FoundationGameState, command.playerId)
        .actions.some(action => action.command.type === "pass" && action.enabled)) {
    return {
      code: ENGINE_ERRORS.invalidCommand,
      message: "Passing is not available at this action point."
    };
  }

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
    if ((command.targets?.length ?? 0) > 0) {
      return {
        code: ENGINE_ERRORS.invalidCommand,
        message: "This demo card does not accept chosen targets."
      };
    }
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
  const object = foundationHandObject(stateAsFoundation, player, card);
  if (!object) {
    return {
      code: ENGINE_ERRORS.cardNotFound,
      message: `Card instance ${card.instanceId} does not match the player's hand.`
    };
  }

  const definition = getDefinition(state, card.cardId);
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

  // The projected action is also the execution policy; never trust a client-supplied target list.
  const action = foundationActionOptions(stateAsFoundation, player.id).actions.find(
    candidate => candidate.command.type === "play-card" &&
      candidate.command.instanceId === command.instanceId
  );
  if (!action || !action.enabled) {
    return {
      code: action?.blockedReason === "judge-required"
        ? ENGINE_ERRORS.judgeRequired
        : ENGINE_ERRORS.invalidCommand,
      message: action?.blockedReason === "judge-required"
        ? "This card requires an authoritative ruling and cannot be played."
        : `Card ${card.cardId} is not available at this action point.`
    };
  }
  const selectedTargets = command.targets ?? [];
  const { minTargets, maxTargets, options } = action.targetPolicy;
  if (selectedTargets.length < minTargets ||
      selectedTargets.length > maxTargets ||
      !selectedTargets.every(target => options.some(choice =>
        targetOptionId(choice) === targetOptionId(target)))) {
    return {
      code: ENGINE_ERRORS.invalidCommand,
      message: "The selected targets are not legal for this effect."
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

  const primaryType = foundationPrimaryType(definition);
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

  const effectTargets = selectedTargets.length > 0
    ? [...selectedTargets]
    : definition.effect ? effectDefinitionTargets(definition.effect) : [];
  // An empty target list means a choice has not been made, not that an effect
  // can be dropped. In particular, point recipients are players, not objects.
  if (definition.effect) {
    state.outstandingTasks.push({
      id: `task:${card.instanceId}:effect:${playSeq}`,
      sourceCardId: card.cardId,
      sourceObjectId: card.instanceId,
      sourcePlayerId: player.id,
      reason: "resolve-effect",
      optional: false,
      effect: selectedTargets.length > 0
        ? { ...definition.effect, targets: effectTargets }
        : definition.effect,
      targetChoices: effectTargets.length > 0
        ? effectTargets
        : availableEffectTargets(state, definition.effect),
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
      message: "The selected option is not valid for this prompt."
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
  if (state.rules.rulesetId === FOUNDATION_RULESET_ID) {
    // Validate the current choice before prompt-answered or an effect can emit an
    // event. A saved prompt/targetChoices pair is not proof of current legality.
    if (!currentPromptOptions(state, prompt).some(option => option.id === command.optionId)) {
      return {
        code: ENGINE_ERRORS.invalidPromptAnswer,
        message: "The selected prompt option is not available."
      };
    }
    const action = foundationActionOptions(state as FoundationGameState, command.playerId)
      .actions.find(candidate => candidate.command.type === "respond-to-prompt" &&
        candidate.command.promptId === command.promptId &&
        candidate.command.optionId === command.optionId);
    if (!action?.enabled) {
      return {
        code: action?.blockedReason === "judge-required"
          ? ENGINE_ERRORS.judgeRequired
          : ENGINE_ERRORS.invalidPromptAnswer,
        message: action?.blockedReason === "judge-required"
          ? "Judge-required effects require an authoritative ruling and cannot be resolved by player confirmation."
          : "The selected prompt option is not available."
      };
    }
    if (!isTrustedFoundationEffectTask(state, task)) {
      return {
        code: ENGINE_ERRORS.judgeRequired,
        message: "The saved task needs authoritative review."
      };
    }
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
      candidate => isEffectTarget(candidate) && targetOptionId(candidate) === command.optionId
    );
    if (!target) {
      return {
        code: ENGINE_ERRORS.invalidPromptAnswer,
        message: "The selected target is not valid."
      };
    }
    applyEffect(state, task, [target]);
  } else if (task.disposition === "judge-required" || task.effect?.kind === "judge-required") {
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
