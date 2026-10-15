import { FOUNDATION_RULESET_ID } from "@riftbound/protocol";
import type {
  FoundationGameState,
  FoundationPlayerState,
  GameState,
  PlayerState,
  SyntheticPlayerState,
  OutstandingTask
} from "../state.js";
import type { PromptOption, Prompt } from "@riftbound/protocol";
import { SYNTHETIC_RULESET_ID } from "./constants.js";
import {
  appendEvent,
  requireFoundationGame
} from "./shared.js";
import {
  applyEffect,
  defaultTargets,
  hasExecutableDefault,
  isCurrentlyLegalEffectTarget,
  isTrustedFoundationEffectTask,
  isValuedEffect,
  markLegacyTaskJudgeRequired,
  targetOptionId
} from "./effects.js";

export function runHotFepr(state: GameState): void {
  handleOutstandingTasks(state);
  while (state.prompt === null && resolveNextExecutableTask(state)) {
    handleOutstandingTasks(state);
  }
  cleanupResolvedPermanents(state);
  moveResolvedFoundationSpells(state);
}


function handleOutstandingTasks(state: GameState): void {
  while (!state.prompt && state.outstandingTasks.length > 0) {
    const task = state.outstandingTasks[0]!;

    if (task.disposition === "judge-required" || task.effect?.kind === "judge-required") {
      createTaskPrompt(state, task, [
        { id: "judge-required", label: task.dispositionReason ?? "Judge required" }
      ]);
      if (task.disposition === "judge-required") state.prompt!.reason = "judge-required";
      continue;
    }

    if (state.rules.rulesetId === FOUNDATION_RULESET_ID && task.reason !== "resolve-card" &&
        !isTrustedFoundationEffectTask(state, task)) {
      markLegacyTaskJudgeRequired(state, task, undefined,
        "Judge required: the saved effect or its source cannot be verified.");
      continue;
    }

    if (task.optional && state.rules.rulesetId === SYNTHETIC_RULESET_ID) {
      createTaskPrompt(state, task, [
        { id: "resolve", label: "Resolve trigger" },
        { id: "skip", label: "Skip trigger" }
      ]);
      continue;
    }

    if (task.optional) {
      const choices = task.requiresTargetChoice
        ? (task.targetChoices ?? []).filter(choice =>
          isCurrentlyLegalEffectTarget(state, task, choice))
        : [];
      createTaskPrompt(state, task, [
        ...choices.map(target => ({
          id: targetOptionId(target),
          label: target.kind === "player"
            ? `Player ${target.playerId}`
            : `Object ${target.objectId}`
        })),
        ...(task.requiresTargetChoice || !hasExecutableDefault(state, task)
          ? [] : [{ id: "resolve", label: "Resolve trigger" }]),
        { id: "skip", label: "Skip trigger" }
      ]);
      continue;
    }

    if (task.requiresTargetChoice) {
      const choices = (task.targetChoices ?? []).filter(choice =>
        isCurrentlyLegalEffectTarget(state, task, choice));
      if (choices.length === 0) {
        markLegacyTaskJudgeRequired(state, task, undefined,
          "Judge required: no legal recipient is proven by the saved task.");
        continue;
      }
      createTaskPrompt(state, task, choices.map(target => ({
        id: targetOptionId(target),
        label: target.kind === "player"
          ? `Player ${target.playerId}`
          : `Object ${target.objectId}`
      })));
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
      !task.optional && task.disposition !== "judge-required" &&
      task.reason === "resolve-effect" &&
      !task.requiresTargetChoice &&
      isTrustedFoundationEffectTask(state, task) &&
      isValuedEffect(task.effect) && task.effect.targets.length > 0 &&
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
    // A task with an unverifiable source cannot authorize cleanup of any
    // unrelated paid chain object. Keep that object in place for a ruling.
    const blockedByUnverifiedTask = state.outstandingTasks.some(task =>
      task.disposition === "judge-required" &&
      (!state.objects[task.sourceObjectId] ||
        state.objects[task.sourceObjectId]?.cardId !== task.sourceCardId)
    );
    const resolvedSpells = blockedByUnverifiedTask ? [] : player.chain.filter(instanceId =>
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


export function checkGameEnd(state: GameState): void {
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
