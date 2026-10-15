import { FOUNDATION_RULESET_ID } from "@riftbound/protocol";
import type {
  PlayerId,
  Prompt,
  PromptOption
} from "@riftbound/protocol";
import type {
  EffectTarget,
  GameState,
  OutstandingTask,
  CardEffect,
  DamageEffect,
  GainPointsEffect,
  FoundationPlayerState
} from "../state.js";
import { SYNTHETIC_RULESET_ID } from "./constants.js";
import {
  appendEvent,
  getPlayer,
  getSyntheticPlayer,
  requireFoundationGame,
  requireSyntheticGame
} from "./shared.js";

export function applyEffect(
  state: GameState,
  task: OutstandingTask,
  targets: readonly EffectTarget[]
): void {
  const effect = task.effect;
  if (!effect) return;
  if (effect.kind === "judge-required") return;
  if (effect.kind === "gain-points") {
    const resolvedTargets = targets;
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
  const foundationTargets = targets;
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


export function defaultTargets(state: GameState, task: OutstandingTask): EffectTarget[] {
  if (!isValuedEffect(task.effect)) return [];
  // The caller checks the source and printed effect before executing. Stale
  // instructions must not fall back to earlier, now-invalid candidates.
  if (task.effect.targets.length > 0) {
    return task.effect.targets.filter(target =>
      state.rules.rulesetId === SYNTHETIC_RULESET_ID ||
      isCurrentlyLegalEffectTarget(state, task, target));
  }
  if (task.targetChoices?.length === 1 &&
      (state.rules.rulesetId === SYNTHETIC_RULESET_ID || task.requiresTargetChoice) &&
      (state.rules.rulesetId === SYNTHETIC_RULESET_ID ||
        isCurrentlyLegalEffectTarget(state, task, task.targetChoices[0]!))) {
    return [task.targetChoices[0]!];
  }
  return [];
}


export function hasExecutableDefault(state: GameState, task: OutstandingTask): boolean {
  return defaultTargets(state, task).length > 0;
}

/** Verify the foundation task against its actual card and producer, not its projection. */

export function isTrustedFoundationEffectTask(state: GameState, task: OutstandingTask): boolean {
  if (state.rules.rulesetId !== FOUNDATION_RULESET_ID) return true;
  const card = state.cards[task.sourceCardId];
  const source = state.objects[task.sourceObjectId];
  const printed = card?.effect;
  const saved = task.effect;
  if (task.reason !== "resolve-effect" ||
      !state.players.some(player => player.id === task.sourcePlayerId) ||
      !source || source.objectId !== task.sourceObjectId ||
      source.instanceId !== task.sourceObjectId ||
      source.cardId !== task.sourceCardId ||
      source.ownerPlayerId !== task.sourcePlayerId ||
      !isValuedEffect(printed) || !isValuedEffect(saved) ||
      saved.kind !== printed.kind || saved.amount !== printed.amount ||
      typeof task.optional !== "boolean" ||
      (task.requiresTargetChoice !== undefined && typeof task.requiresTargetChoice !== "boolean") ||
      (task.targetChoices !== undefined && !Array.isArray(task.targetChoices))) {
    return false;
  }
  const targetFits = (target: EffectTarget): boolean =>
    saved.kind === "damage" ? target.kind === "object" : target.kind === "player";
  if (!printed.targets.every(targetFits) || !saved.targets.every(targetFits)) return false;
  const sameTargets = (a: readonly EffectTarget[], b: readonly EffectTarget[]): boolean =>
    a.length === b.length && a.every((target, index) =>
      isEffectTarget(target) && isEffectTarget(b[index]) &&
      targetOptionId(target) === targetOptionId(b[index]!));
  if (printed.targets.length > 0) {
    // Fixed printed targets cannot be widened by saved choices or replaced by
    // unrelated instructions. Their current legality is checked at execution.
    return sameTargets(saved.targets, printed.targets) &&
      (!task.requiresTargetChoice) &&
      (task.targetChoices === undefined || sameTargets(task.targetChoices, printed.targets));
  }
  // The only way a dynamic instruction differs from printed [] is a previous
  // target selection. Its selected targets must agree with saved choices;
  // requiresTargetChoice=true means no selection has yet occurred. An unselected
  // task may contain stale or malicious candidates; they are never authority.
  return task.requiresTargetChoice
    ? saved.targets.length === 0
    : saved.targets.length > 0 && sameTargets(saved.targets, task.targetChoices ?? []);
}


export function effectDefinitionTargets(effect: CardEffect): EffectTarget[] {
  if (effect.kind === "judge-required") return [];
  return [...effect.targets];
}


export function availableTargets(
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


export function availableEffectTargets(
  state: GameState,
  effect: CardEffect
): EffectTarget[] {
  if (effect.kind === "judge-required") return [];
  if (effect.kind === "gain-points") {
    return state.players.map(player => ({ kind: "player", playerId: player.id }));
  }
  return availableTargets(state, state.activePlayerId);
}

/** Recheck only legacy prompts that select a target for a dynamic effect. */

/** Recheck only legacy prompts that select a target for a dynamic effect. */
export function currentPromptOptions(state: GameState, prompt: Prompt): PromptOption[] {
  if (state.rules.rulesetId !== FOUNDATION_RULESET_ID) {
    return [...prompt.options];
  }
  const task = state.outstandingTasks.find(candidate => candidate.id === prompt.taskId);
  if (!task) return [];
  const trusted = isTrustedFoundationEffectTask(state, task);
  if (task.disposition === "judge-required" || task.effect?.kind === "judge-required" || !trusted) {
    // Unverified effects cannot authorize even a skip. Verified optional tasks
    // with no legal target stay as skip-only prompts instead (see below).
    if (!trusted && task.disposition !== "judge-required" &&
        task.effect?.kind !== "judge-required" &&
        prompt.options.every(option => option.id.startsWith("target:")) &&
        isValuedEffect(task.effect) && task.effect.targets.length === 0 &&
        !task.requiresTargetChoice) return [];
    return [{
      id: "judge-required",
      label: task.dispositionReason ??
        (task.effect?.kind === "judge-required"
          ? "Judge required"
          : "Judge required: the saved task needs authoritative review.")
    }];
  }
  if (!task.requiresTargetChoice) {
    // Never promote arbitrary saved option IDs, or a raw optional flag on an
    // unverified task, to authority. An explicit resolve is still a choice.
    return prompt.options.filter(option => option.id === "skip"
      ? task.optional && prompt.optional
      : option.id === "resolve" && hasExecutableDefault(state, task) &&
        (task.optional ? prompt.optional : true));
  }
  const choices = task.targetChoices ?? [];
  const publicObjects = new Set(availableTargets(state, task.sourcePlayerId).map(targetOptionId));
  const isLegalChoice = (choice: EffectTarget): boolean =>
    task.effect?.kind === "damage"
      ? choice.kind === "object" && publicObjects.has(targetOptionId(choice))
      : task.effect?.kind === "gain-points"
        ? choice.kind === "player" && state.players.some(player => player.id === choice.playerId)
        : false;
  const choiceCounts = new Map<string, number>();
  const optionCounts = new Map<string, number>();
  for (const choice of choices) {
    if (!isEffectTarget(choice)) continue;
    const id = targetOptionId(choice);
    choiceCounts.set(id, (choiceCounts.get(id) ?? 0) + 1);
  }
  for (const option of prompt.options) {
    optionCounts.set(option.id, (optionCounts.get(option.id) ?? 0) + 1);
  }
  return prompt.options.filter(option => {
    // Duplicate IDs or choices are ambiguous; discard the whole option, label
    // included. Compare full canonical IDs: object IDs can themselves contain ':'.
    if (optionCounts.get(option.id) !== 1) return false;
    if (choiceCounts.has(option.id)) {
      return choiceCounts.get(option.id) === 1 &&
        choices.some(choice => isEffectTarget(choice) &&
          targetOptionId(choice) === option.id && isLegalChoice(choice));
    }
    // An unknown target-like ID must not become an executable non-target option.
    if (option.id.startsWith("target:")) return false;
    if (option.id === "resolve") {
      // This non-target answer uses defaultTargets. For a dynamic effect with
      // exactly one stored choice it can be answered only while that choice is
      // still legal. A hidden/ambiguous default must never run applyEffect.
      return choices.length === 1 && isEffectTarget(choices[0]) &&
        isLegalChoice(choices[0]) && (task.optional ? prompt.optional : true);
    }
    // Only the known optional decline is safe in a dynamic target prompt.
    return option.id === "skip" && task.optional && prompt.optional;
  });
}


export function targetOptionId(target: EffectTarget): string {
  return target.kind === "player"
    ? `target:player:${target.playerId}`
    : `target:object:${target.objectId}`;
}


export function reconcileLegacyPromptInPlace(state: GameState): boolean {
  if (state.rules.rulesetId !== FOUNDATION_RULESET_ID) return false;
  const prompt = state.prompt;
  const task = prompt
    ? state.outstandingTasks.find(candidate => candidate.id === prompt.taskId)
    : state.outstandingTasks[0];
  if (!task) return false;
  if (task.disposition === "judge-required" || task.effect?.kind === "judge-required") {
    return false;
  }

  const effect = task.effect;
  if (!isTrustedFoundationEffectTask(state, task)) {
    return markLegacyTaskJudgeRequired(
      state,
      task,
      prompt ?? undefined,
      "Judge required: the saved effect or its source cannot be verified."
    );
  }

  // A saved target is not consent to an optional effect. Even when its targets
  // have since gone stale, the owner must retain the ability to decline.
  // A previously selected dynamic instruction or a printed fixed target may
  // execute once for mandatory effects. No choice means no automatic effect.
  if (!task.optional && isValuedEffect(effect) && effect.targets.length > 0) {
    return resolveSelectedLegacyTask(state, task, prompt ?? undefined);
  }

  if (!task.requiresTargetChoice) return false;
  const choices = task.targetChoices ?? [];
  const legalChoices = choices.filter(choice =>
    isCurrentlyLegalEffectTarget(state, task, choice)
  );
  if (legalChoices.length > 0 || (task.optional && prompt?.optional)) return false;

  // No target was selected. Filtered public options do not prove a fizzle, so
  // preserve the task and expose an explicit judge-required disposition.
  return markLegacyTaskJudgeRequired(
    state,
    task,
    prompt ?? undefined,
    "Judge required: no legal recipient is proven by the saved task."
  );
}


function resolveSelectedLegacyTask(
  state: GameState,
  task: OutstandingTask,
  prompt: Prompt | undefined
): boolean {
  const effect = task.effect;
  if (!isValuedEffect(effect)) return false;
  const legalTargets = effect.targets.filter(target =>
    isCurrentlyLegalEffectTarget(state, task, target)
  );
  applyEffect(state, task, legalTargets);
  if (prompt?.taskId === task.id) state.prompt = null;
  state.outstandingTasks = state.outstandingTasks.filter(candidate => candidate.id !== task.id);
  appendEvent(state, {
    type: "task-resolved",
    taskId: task.id,
    sourceCardId: task.sourceCardId,
    reason: task.reason,
    autoResolved: true
  });
  return true;
}


export function markLegacyTaskJudgeRequired(
  state: GameState,
  task: OutstandingTask,
  prompt: Prompt | undefined,
  reason: string
): boolean {
  task.disposition = "judge-required";
  task.dispositionReason = reason;
  if (prompt?.taskId === task.id) {
    prompt.reason = "judge-required";
    prompt.optional = false;
    prompt.options = [{ id: "judge-required", label: reason }];
    // Make the repaired prompt a new authority version without adding a
    // misleading gameplay event or changing any resource/card zone.
    state.version += 1;
    prompt.stateVersion = state.version;
  } else {
    state.version += 1;
  }
  return true;
}


export function isValuedEffect(
  effect: CardEffect | undefined
): effect is DamageEffect | GainPointsEffect {
  if (!effect || (effect.kind !== "damage" && effect.kind !== "gain-points")) {
    return false;
  }
  return Number.isSafeInteger(effect.amount) && effect.amount > 0 &&
    Array.isArray(effect.targets) && effect.targets.every(isEffectTarget);
}


export function isEffectTarget(value: unknown): value is EffectTarget {
  if (!value || typeof value !== "object") return false;
  const target = value as Record<string, unknown>;
  return target.kind === "player"
    ? typeof target.playerId === "string" && target.playerId.length > 0
    : target.kind === "object" && typeof target.objectId === "string" && target.objectId.length > 0;
}


export function isCurrentlyLegalEffectTarget(
  state: GameState,
  task: OutstandingTask,
  target: EffectTarget
): boolean {
  if (!isEffectTarget(target)) return false;
  if (task.effect?.kind === "gain-points") {
    return target.kind === "player" && state.players.some(player => player.id === target.playerId);
  }
  if (task.effect?.kind === "damage") {
    return target.kind === "object" && availableTargets(state, task.sourcePlayerId)
      .some(candidate => targetOptionId(candidate) === targetOptionId(target));
  }
  return false;
}
