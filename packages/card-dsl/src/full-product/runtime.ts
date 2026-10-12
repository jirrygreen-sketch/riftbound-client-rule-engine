import type {
  FullProductEffectIr,
  FullProductEffectIrEffect,
  FullProductEffectIrNode,
  FullProductEffectIrTarget
} from "./types.js";
import { parseFullProductEffectIr } from "./types.js";

export const FULL_PRODUCT_RUNTIME_SCHEMA_VERSION = 1 as const;

export const FULL_PRODUCT_RUNTIME_ERROR_CODES = {
  emptyDeck: "empty-deck",
  insufficientEnergy: "insufficient-energy",
  invalidMove: "invalid-move",
  judgeRequired: "judge-required",
  missingObject: "missing-object",
  missingPlayer: "missing-player",
  promptRequired: "prompt-required",
  unknownAction: "unknown-action"
} as const;

export type FullProductRuntimeErrorCode =
  (typeof FULL_PRODUCT_RUNTIME_ERROR_CODES)[keyof typeof FULL_PRODUCT_RUNTIME_ERROR_CODES];

export type FullProductZone = "discard";

export interface FullProductRuntimeObject {
  readonly objectId: string;
  readonly ownerPlayerId: string;
  readonly zone: FullProductZone | "hand" | "deck";
}

export interface FullProductRuntimePlayerState {
  readonly playerId: string;
  readonly energy: number;
  readonly score: number;
  readonly deck: readonly string[];
  readonly hand: readonly string[];
  readonly discard: readonly string[];
  readonly chain: readonly string[];
}

export interface FullProductRuntimeState {
  readonly schemaVersion: typeof FULL_PRODUCT_RUNTIME_SCHEMA_VERSION;
  readonly players: readonly FullProductRuntimePlayerState[];
  readonly objects: Readonly<Record<string, FullProductRuntimeObject>>;
  readonly pending?: readonly {
    readonly sourceIrId: string;
    readonly targetId: string;
    readonly prompt: string;
    readonly remainingNodeIds: readonly string[];
  }[];
}

export type FullProductRuntimeEvent =
  | { readonly type: "energy-spent"; readonly playerId: string; readonly amount: number }
  | { readonly type: "cards-drawn"; readonly playerId: string; readonly count: number; readonly instanceIds: readonly string[] }
  | { readonly type: "energy-gained"; readonly playerId: string; readonly amount: number }
  | { readonly type: "score-gained"; readonly playerId: string; readonly amount: number }
  | { readonly type: "object-moved"; readonly objectId: string; readonly from: string; readonly to: FullProductZone }
  | { readonly type: "chain-items-created"; readonly playerId: string; readonly count: number }
  | { readonly type: "prompt-created"; readonly targetId: string; readonly prompt: string; readonly remainingNodeIds: readonly string[] }
  | { readonly type: "judge-required"; readonly reason: string };

export interface FullProductRuntimeError {
  readonly code: FullProductRuntimeErrorCode;
  readonly message: string;
}

export type FullProductRuntimeResult =
  | {
    readonly status: "completed";
    readonly state: FullProductRuntimeState;
    readonly events: readonly FullProductRuntimeEvent[];
    readonly error: null;
  }
  | {
    readonly status: "awaitingPrompt" | "blocked" | "failed";
    readonly state: FullProductRuntimeState;
    readonly events: readonly [];
    readonly error: FullProductRuntimeError;
  };

export interface FullProductTargetSelection {
  readonly targetId: string;
  readonly objectIds: readonly string[];
}

export interface FullProductExecuteOptions {
  readonly sourcePlayerId: string;
  readonly sourceObjectId?: string;
  readonly targetSelections?: Readonly<Record<string, FullProductTargetSelection>>;
  readonly startNodeId?: string;
}

type MutablePlayer = {
  -readonly [K in keyof FullProductRuntimePlayerState]: FullProductRuntimePlayerState[K];
};
type MutableObject = {
  -readonly [K in keyof FullProductRuntimeObject]: FullProductRuntimeObject[K];
};
type MutableState = {
  -readonly [K in keyof FullProductRuntimeState]: FullProductRuntimeState[K];
};

export function createFullProductRuntimeState(
  input: FullProductRuntimeState
): FullProductRuntimeState {
  const cloned = cloneState(input);
  if (cloned.schemaVersion !== FULL_PRODUCT_RUNTIME_SCHEMA_VERSION) {
    throw new Error("Unsupported full-product runtime state schema version");
  }
  if (new Set(cloned.players.map(player => player.playerId)).size !== cloned.players.length) {
    throw new Error("Full-product runtime player ids must be unique");
  }
  for (const [objectId, object] of Object.entries(cloned.objects)) {
    if (object.objectId !== objectId) {
      throw new Error(`Full-product object ${objectId} has a mismatched objectId`);
    }
    if (!cloned.players.some(player => player.playerId === object.ownerPlayerId)) {
      throw new Error(`Full-product object ${objectId} has an unknown owner`);
    }
  }
  return cloned;
}

export function executeFullProductEffect(
  inputIr: unknown,
  inputState: FullProductRuntimeState,
  options: FullProductExecuteOptions
): FullProductRuntimeResult {
  const ir = parseFullProductEffectIr(inputIr);
  const sourceState = createFullProductRuntimeState(inputState);
  const state = cloneState(sourceState);
  const events: FullProductRuntimeEvent[] = [];

  const matchingPending = sourceState.pending?.find(item => item.sourceIrId === ir.id) ?? null;
  if (options.startNodeId === undefined && matchingPending !== null) {
    const nextStart = matchingPending.remainingNodeIds[0];
    if (nextStart !== undefined) {
      return executeFullProductEffect(ir, sourceState, {
        ...options,
        startNodeId: nextStart
      });
    }
  }

  const nodes = flattenIr(ir.body, options.startNodeId);
  const startIndex = options.startNodeId === undefined
    ? 0
    : nodes.findIndex(node => node.id === options.startNodeId);
  if (startIndex === -1) {
    return failed(sourceState, {
      code: FULL_PRODUCT_RUNTIME_ERROR_CODES.unknownAction,
      message: `Effect node ${options.startNodeId} is not executable in this IR`
    });
  }

  for (let index = startIndex; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.type === "trigger") {
      continue;
    }
    if (node.type === "target") {
      continue;
    }

    const outcome = executeEffect(ir, node, state, options, nodes.slice(index + 1));
    if (outcome === "continue") {
      continue;
    }
    if (outcome.status === "prompt") {
      state.pending = [
        ...state.pending ?? [],
        {
          sourceIrId: ir.id,
          targetId: outcome.target.id,
          prompt: outcome.prompt,
          remainingNodeIds: nodes.slice(index + 1).map(candidate => candidate.id)
        }
      ];
      return {
        status: "awaitingPrompt",
        state,
        events: [],
        error: {
          code: FULL_PRODUCT_RUNTIME_ERROR_CODES.promptRequired,
          message: `Target ${outcome.target.id} requires a selection`
        }
      };
    }
    if (outcome.status === "blocked") {
      return blocked(sourceState, outcome.error);
    }
    events.push(...outcome.events);
  }

  state.pending = (state.pending ?? []).filter(item => item.sourceIrId !== ir.id);
  return { status: "completed", state, events, error: null };
}

function flattenIr(
  body: readonly FullProductEffectIrNode[],
  startNodeId: string | undefined
): readonly FullProductEffectIrNode[] {
  const nodes: FullProductEffectIrNode[] = [];
  const containsNode = (
    items: readonly FullProductEffectIrNode[],
    nodeId: string
  ): boolean => items.some(item =>
    item.id === nodeId ||
    (item.type === "trigger" && containsNode(item.body, nodeId))
  );
  const walk = (items: readonly FullProductEffectIrNode[], insideStart: boolean): void => {
    for (const node of items) {
      if (startNodeId === undefined || insideStart || node.id === startNodeId) {
        nodes.push(node);
      }
      if (node.type === "trigger") {
        walk(
          node.body,
          startNodeId !== undefined &&
            (insideStart || node.id === startNodeId || containsNode(node.body, startNodeId))
        );
      }
    }
  };
  walk(body, startNodeId === undefined);
  return nodes;
}

type StepOutcome =
  | "continue"
  | { readonly status: "prompt"; readonly target: FullProductEffectIrTarget; readonly prompt: string }
  | { readonly status: "blocked"; readonly error: FullProductRuntimeError }
  | { readonly status: "events"; readonly events: readonly FullProductRuntimeEvent[] };

function executeEffect(
  ir: FullProductEffectIr,
  effect: FullProductEffectIrEffect,
  state: MutableState,
  options: FullProductExecuteOptions,
  remainingNodes: readonly FullProductEffectIrNode[]
): StepOutcome {
  const args = effect.args as Record<string, string | number>;
  const requirePlayer = (): MutablePlayer | { status: "blocked"; error: FullProductRuntimeError } => {
    const player = state.players.find(candidate => candidate.playerId === options.sourcePlayerId);
    return player ?? {
      status: "blocked",
      error: {
        code: FULL_PRODUCT_RUNTIME_ERROR_CODES.missingPlayer,
        message: `Player ${options.sourcePlayerId} is not in runtime state`
      }
    };
  };
  const unknownAction = (): { status: "blocked"; error: FullProductRuntimeError } => ({
    status: "blocked",
    error: {
      code: FULL_PRODUCT_RUNTIME_ERROR_CODES.unknownAction,
      message: `Opcode ${effect.opcode} is not registered in the full-product runtime`
    }
  });

  switch (effect.opcode) {
    case "cost.energy": {
      const playerResult = requirePlayer();
      if ("status" in playerResult) return playerResult;
      const amount = args.amount as number;
      if (playerResult.energy < amount) {
        return {
          status: "blocked",
          error: {
            code: FULL_PRODUCT_RUNTIME_ERROR_CODES.insufficientEnergy,
            message: `Player ${options.sourcePlayerId} has ${playerResult.energy} energy; ${amount} is required`
          }
        };
      }
      playerResult.energy -= amount;
      return {
        status: "events",
        events: [{ type: "energy-spent", playerId: playerResult.playerId, amount }]
      };
    }
    case "draw.cards": {
      const playerResult = requirePlayer();
      if ("status" in playerResult) return playerResult;
      const count = args.count as number;
      if (playerResult.deck.length < count) {
        return {
          status: "blocked",
          error: {
            code: FULL_PRODUCT_RUNTIME_ERROR_CODES.emptyDeck,
            message: `Player ${options.sourcePlayerId} has ${playerResult.deck.length} deck cards; ${count} are required`
          }
        };
      }
      const drawn = playerResult.deck.slice(0, count);
      playerResult.deck = playerResult.deck.slice(count);
      playerResult.hand = [...playerResult.hand, ...drawn];
      return {
        status: "events",
        events: [{
          type: "cards-drawn",
          playerId: playerResult.playerId,
          count,
          instanceIds: drawn
        }]
      };
    }
    case "gain.energy": {
      const playerResult = requirePlayer();
      if ("status" in playerResult) return playerResult;
      const amount = args.amount as number;
      playerResult.energy += amount;
      return {
        status: "events",
        events: [{ type: "energy-gained", playerId: playerResult.playerId, amount }]
      };
    }
    case "gain.score": {
      const playerResult = requirePlayer();
      if ("status" in playerResult) return playerResult;
      const amount = args.amount as number;
      playerResult.score += amount;
      return {
        status: "events",
        events: [{ type: "score-gained", playerId: playerResult.playerId, amount }]
      };
    }
    case "move.zone": {
      const objectId = options.sourceObjectId;
      if (objectId === undefined) {
        return {
          status: "blocked",
          error: {
            code: FULL_PRODUCT_RUNTIME_ERROR_CODES.missingObject,
            message: "move.zone requires sourceObjectId"
          }
        };
      }
      const object = state.objects[objectId] as MutableObject | undefined;
      if (object === undefined) {
        return {
          status: "blocked",
          error: {
            code: FULL_PRODUCT_RUNTIME_ERROR_CODES.missingObject,
            message: `Object ${objectId} is not in runtime state`
          }
        };
      }
      const zone = args.zone as FullProductZone;
      if (zone !== "discard") return unknownAction();
      const owner = requirePlayerByObjectId(state, object);
      if (owner === null) {
        return {
          status: "blocked",
          error: {
            code: FULL_PRODUCT_RUNTIME_ERROR_CODES.missingPlayer,
            message: `Object ${objectId} has no owner in runtime state`
          }
        };
      }
      const from = object.zone;
      if (from === "discard") {
        return {
          status: "blocked",
          error: {
            code: FULL_PRODUCT_RUNTIME_ERROR_CODES.invalidMove,
            message: `Object ${objectId} is already in discard`
          }
        };
      }
      removeFromZone(owner, objectId, from);
      owner.discard = [...owner.discard, objectId];
      object.zone = "discard";
      return {
        status: "events",
        events: [{ type: "object-moved", objectId, from, to: "discard" }]
      };
    }
    case "prompt.target": {
      const target = findTarget(ir.body, effect.targetId);
      if (target === null || effect.targetId === undefined) {
        return {
          status: "blocked",
          error: {
            code: FULL_PRODUCT_RUNTIME_ERROR_CODES.unknownAction,
            message: `Effect ${effect.id} has no resolved target node`
          }
        };
      }
      const selection = options.targetSelections?.[effect.targetId];
      if (selection === undefined) {
        return {
          status: "prompt",
          target,
          prompt: args.prompt as string
        };
      }
      if (selection.objectIds.length < target.minCount) {
        return {
          status: "blocked",
          error: {
            code: FULL_PRODUCT_RUNTIME_ERROR_CODES.unknownAction,
            message: `Target ${target.id} requires at least ${target.minCount} object(s)`
          }
        };
      }
      if (target.maxCount !== null && selection.objectIds.length > target.maxCount) {
        return {
          status: "blocked",
          error: {
            code: FULL_PRODUCT_RUNTIME_ERROR_CODES.unknownAction,
            message: `Target ${target.id} accepts at most ${target.maxCount} object(s)`
          }
        };
      }
      for (const objectId of selection.objectIds) {
        if (state.objects[objectId] === undefined) {
          return {
            status: "blocked",
            error: {
              code: FULL_PRODUCT_RUNTIME_ERROR_CODES.missingObject,
              message: `Selected object ${objectId} is not in runtime state`
            }
          };
        }
      }
      return "continue";
    }
    case "chain.create": {
      const playerResult = requirePlayer();
      if ("status" in playerResult) return playerResult;
      const count = args.count as number;
      playerResult.chain = [...playerResult.chain, ...Array.from(
        { length: count },
        (_, index) => `chain:${playerResult.chain.length + index + 1}`
      )];
      return {
        status: "events",
        events: [{
          type: "chain-items-created",
          playerId: playerResult.playerId,
          count
        }]
      };
    }
    case "judge.required": {
      return {
        status: "blocked",
        error: {
          code: FULL_PRODUCT_RUNTIME_ERROR_CODES.judgeRequired,
          message: args.reason as string
        }
      };
    }
    default:
      return unknownAction();
  }
}

export function resumeFullProductEffectAfterPrompt(
  inputIr: unknown,
  inputState: FullProductRuntimeState,
  options: FullProductExecuteOptions,
  targetSelection: FullProductTargetSelection
): FullProductRuntimeResult {
  const ir = parseFullProductEffectIr(inputIr);
  const pending = inputState.pending?.find(item =>
    item.sourceIrId === ir.id && item.targetId === targetSelection.targetId
  );
  if (pending === undefined) {
    return failed(inputState, {
      code: FULL_PRODUCT_RUNTIME_ERROR_CODES.unknownAction,
      message: `No pending target ${targetSelection.targetId} for effect ${ir.id}`
    });
  }
  const nextStart = pending.remainingNodeIds[0];
  if (nextStart === undefined) {
    const state = cloneState(inputState);
    state.pending = (state.pending ?? []).filter(item => item.sourceIrId !== ir.id);
    return { status: "completed", state, events: [], error: null };
  }
  return executeFullProductEffect(ir, inputState, {
    ...options,
    startNodeId: nextStart,
    targetSelections: {
      ...options.targetSelections,
      [targetSelection.targetId]: targetSelection
    }
  });
}

function requirePlayerByObjectId(
  state: MutableState,
  object: FullProductRuntimeObject
): MutablePlayer | null {
  return state.players.find(player => player.playerId === object.ownerPlayerId) ?? null;
}

function removeFromZone(
  player: MutablePlayer,
  objectId: string,
  zone: FullProductRuntimeObject["zone"]
): void {
  if (zone === "hand") {
    player.hand = player.hand.filter(id => id !== objectId);
  } else if (zone === "deck") {
    player.deck = player.deck.filter(id => id !== objectId);
  }
}

function findTarget(
  body: readonly FullProductEffectIrNode[],
  targetId: string | undefined
): FullProductEffectIrTarget | null {
  if (targetId === undefined) return null;
  for (const node of body) {
    if (node.type === "target" && node.id === targetId) return node;
    if (node.type === "trigger") {
      const nested = findTarget(node.body, targetId);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function failed(
  state: FullProductRuntimeState,
  error: FullProductRuntimeError
): FullProductRuntimeResult {
  const cloned = cloneState(state);
  if (cloned.schemaVersion !== FULL_PRODUCT_RUNTIME_SCHEMA_VERSION) {
    throw new Error("Unsupported full-product runtime state schema version");
  }
  return { status: "failed", state: cloned, events: [], error };
}

function blocked(
  state: FullProductRuntimeState,
  error: FullProductRuntimeError
): FullProductRuntimeResult {
  const cloned = cloneState(state);
  return { status: "blocked", state: cloned, events: [], error };
}

function cloneState(state: FullProductRuntimeState): MutableState {
  return {
    schemaVersion: state.schemaVersion,
    players: state.players.map(player => ({
      playerId: player.playerId,
      energy: player.energy,
      score: player.score,
      deck: [...player.deck],
      hand: [...player.hand],
      discard: [...player.discard],
      chain: [...player.chain]
    })),
    objects: Object.fromEntries(Object.entries(state.objects).map(([objectId, object]) => [
      objectId,
      {
        objectId: object.objectId,
        ownerPlayerId: object.ownerPlayerId,
        zone: object.zone
      }
    ])),
    pending: (state.pending ?? []).map(item => ({
      sourceIrId: item.sourceIrId,
      targetId: item.targetId,
      prompt: item.prompt,
      remainingNodeIds: [...item.remainingNodeIds]
    }))
  };
}
