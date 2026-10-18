import type {
  ActionOutcome,
  ActionReceipt,
  BatchAction,
  CONTRACT_ACTION_CAPABILITY_VERSION,
  ContractGameAction,
  ContractActionCapability,
  GameAction,
  LocationRef,
  ObjectSnapshot,
} from '../../effects/contract.js';
export { CONTRACT_ACTION_CAPABILITY_VERSION };

/** The state seam consumed by the contract-action bridge. */
export interface ContractActionBridgePort {
  checkpoint(): unknown;
  restore(checkpoint: unknown): void;
  objects(): readonly ObjectSnapshot[];
  perform(action: GameAction): ActionOutcome;
  performContract?(action: ContractGameAction): ActionOutcome;
  /** Batch-aware replacement seam; receives the common batch identity. */
  performBatchLeaf?(action: GameAction, batchId: string): ActionOutcome;
}

export interface ContractActionStep {
  readonly action: ContractGameAction;
  readonly before: readonly ObjectSnapshot[];
  readonly after: readonly ObjectSnapshot[];
  readonly outcome: ActionOutcome;
}

export interface ContractActionExecution {
  readonly outcome: ActionOutcome;
  /** Successful leaf executions in submission order. Failed batches expose none. */
  readonly steps: readonly ContractActionStep[];
}

export type { ContractActionCapability };

export interface ExecuteContractActionOptions {
  readonly transactionId?: string;
  /** A pipeline caller throws so its enclosing transaction restores events too. */
  readonly throwOnRollback?: boolean;
}

export class ContractActionRollbackError extends Error {
  readonly outcome: ActionOutcome;

  constructor(outcome: ActionOutcome) {
    super(`Contract action rolled back (${outcome.receipt?.status ?? 'unknown'})`);
    this.name = 'ContractActionRollbackError';
    this.outcome = outcome;
  }
}

type FailureStatus = Extract<ActionOutcome['status'], 'replaced' | 'prevented' | 'impossible'>;
type ReceiptActionStatus = ActionReceipt['actions'][number]['status'];

const GAME_ACTION_TYPES = new Set<GameAction['type']>([
  'draw', 'discard', 'move-zone', 'recycle', 'banish', 'mill', 'shuffle',
  'order-top', 'return-to-hand', 'move-location', 'ready', 'exhaust', 'stun',
  'kill', 'attach', 'detach', 'take-control', 'damage', 'heal',
  'channel-rune', 'gain-energy', 'gain-power', 'pay', 'gain-xp', 'spend-xp',
  'buff', 'spend-buff', 'empower', 'disempower', 'add-counter',
  'remove-counter', 'create-token', 'copy', 'play', 'reveal', 'look',
  'show-off', 'counter', 'score', 'win',
]);

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const sameLocation = (left: LocationRef | null, right: LocationRef): boolean =>
  left?.type === right.type && (left.type === 'base'
    ? right.type === 'base' && left.player === right.player
    : right.type === 'battlefield' && left.id === right.id);

function currentObject(objects: readonly ObjectSnapshot[], action: ContractGameAction): ObjectSnapshot | undefined {
  const ref = 'object' in action ? action.object : 'target' in action ? action.target : undefined;
  return ref === undefined
    ? undefined
    : objects.find(object => object.ref.id === ref.id && object.ref.zoneEntryId === ref.zoneEntryId);
}

function sameRef(
  left: { readonly id: string; readonly zoneEntryId: number },
  right: { readonly id: string; readonly zoneEntryId: number },
): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

function killedInTrash(before: readonly ObjectSnapshot[], after: readonly ObjectSnapshot[], action: Extract<ContractGameAction, { type: 'kill' }>): boolean {
  const previous = before.find(object => sameRef(object.ref, action.object));
  const current = after.find(object => object.ref.id === action.object.id);
  return previous?.zone === 'board' && current !== undefined && current.zone === 'trash' &&
    current.ref.zoneEntryId > action.object.zoneEntryId &&
    current.owner === previous.owner && current.controller === previous.controller;
}

/** A Recall keeps the exact incarnation and every non-location field unchanged. */
function recallPreservedState(before: readonly ObjectSnapshot[], after: readonly ObjectSnapshot[], action: Extract<ContractGameAction, { type: 'recall' }>): boolean {
  const previous = before.find(object => sameRef(object.ref, action.object));
  const current = after.find(object => sameRef(object.ref, action.object));
  if (previous === undefined || current === undefined) return false;
  return JSON.stringify({ ...previous, location: null }) === JSON.stringify({ ...current, location: null });
}

/** Verify that a completed leaf reached the location named by the submitted action. */
export function contractActionReachedDestination(
  action: ContractGameAction,
  after: readonly ObjectSnapshot[],
): boolean {
  if (action.type === 'move-location') {
    const object = currentObject(after, action);
    return object?.zone === 'board' && sameLocation(object.location, action.to);
  }
  if (action.type === 'recall') {
    const object = after.find(candidate => candidate.ref.id === action.object.id &&
      candidate.ref.zoneEntryId === action.object.zoneEntryId);
    return object?.zone === 'board' && object.controller === action.player &&
      sameLocation(object.location, { type: 'base', player: object.controller });
  }
  return true;
}

/** Verify Kill against its pre-action snapshot; the object must leave Board into its owner's Trash. */
export function contractActionCompleted(
  action: ContractGameAction,
  before: readonly ObjectSnapshot[],
  after: readonly ObjectSnapshot[],
): boolean {
  return contractActionReachedDestination(action, after) &&
    (action.type !== 'kill' || killedInTrash(before, after, action));
}

function receiptStatus(status: ActionOutcome['status']): ReceiptActionStatus {
  return status === 'done' ? 'done' : status;
}

function rolledBack(
  transactionId: string | undefined,
  types: readonly ContractGameAction['type'][],
  attempted: readonly ReceiptActionStatus[],
  failure: FailureStatus,
): ActionOutcome {
  const actions = types.map((type, index) => ({ type, status: attempted[index] ?? 'impossible' }));
  return {
    status: failure,
    events: [],
    receipt: {
      ...(transactionId === undefined ? {} : { transactionId }),
      status: 'rolled-back',
      actions,
    },
  };
}

function rejected(action: ContractGameAction): ActionOutcome {
  return {
    status: 'impossible',
    events: [],
    receipt: {
      status: 'rejected',
      actions: [{ type: action.type, status: 'impossible' }],
    },
  };
}

function rollbackResult(
  outcome: ActionOutcome,
  options: ExecuteContractActionOptions,
): ContractActionExecution {
  if (options.throwOnRollback) throw new ContractActionRollbackError(outcome);
  return { outcome, steps: [] };
}

function leafActions(action: ContractGameAction): readonly ContractGameAction[] {
  if (action.type === 'batch') return action.actions.flatMap(leafActions);
  return [action];
}

function receiptStatusFromThrown(error: unknown): ReceiptActionStatus {
  if (record(error) && typeof error.status === 'string' &&
      ['replaced', 'prevented', 'impossible'].includes(error.status)) {
    return error.status as FailureStatus;
  }
  if (error instanceof Error) {
    const match = /\b(replaced|prevented|impossible)\b/.exec(error.message);
    if (match !== null) return match[1] as FailureStatus;
  }
  return 'impossible';
}

export function isKnownContractAction(action: unknown): action is ContractGameAction {
  if (!record(action) || typeof action.type !== 'string') return false;
  if (action.type === 'batch') {
    return Array.isArray(action.actions) &&
      (action.transactionId === undefined || typeof action.transactionId === 'string') &&
      action.actions.every(isKnownContractAction);
  }
  if (action.type === 'recall') return record(action.object) &&
    typeof action.object.id === 'string' && typeof action.object.zoneEntryId === 'number' &&
    Number.isSafeInteger(action.object.zoneEntryId) &&
    typeof action.player === 'string';
  if (action.type === 'hide') return record(action.object) &&
    typeof action.object.id === 'string' && typeof action.object.zoneEntryId === 'number' &&
    Number.isSafeInteger(action.object.zoneEntryId) &&
    typeof action.player === 'string';
  return GAME_ACTION_TYPES.has(action.type as GameAction['type']);
}

/**
 * Execute Recall or a Batch as one authoritative transaction. Leaf actions use
 * the caller's existing GameAction seam; only a fully successful batch is
 * returned to the event adapter for publication.
 */
export function executeContractAction(
  action: ContractGameAction,
  port: ContractActionBridgePort,
  options: ExecuteContractActionOptions = {},
): ContractActionExecution {
  if (!isKnownContractAction(action)) return { outcome: rejected(action), steps: [] };
  if (action.type === 'hide') return { outcome: rejected(action), steps: [] };

  const transactionId = action.type === 'batch'
    ? action.transactionId ?? options.transactionId
    : options.transactionId;
  const leaves = leafActions(action);
  const types = leaves.map(leaf => leaf.type);
  const attempted: ReceiptActionStatus[] = [];
  const steps: ContractActionStep[] = [];
  const checkpoint = port.checkpoint();

  try {
    if (action.type === 'batch') {
      for (const leaf of leaves) {
        if (leaf.type === 'hide') {
          port.restore(checkpoint);
          return rollbackResult(
            rolledBack(transactionId, types, [], 'impossible'),
            options,
          );
        }
      }
    }
    for (const leaf of leaves) {
      const before = structuredClone(port.objects());
      const outcome = leaf.type === 'recall' && port.performContract !== undefined
        ? port.performContract(leaf)
        : leaf.type === 'kill' && port.performBatchLeaf !== undefined
          ? port.performBatchLeaf(leaf, transactionId ?? options.transactionId ?? 'batch')
          : port.perform(leaf as GameAction);
      attempted.push(receiptStatus(outcome.status));
      if (outcome.status !== 'done') {
        port.restore(checkpoint);
        return rollbackResult(
          rolledBack(transactionId, types, attempted, outcome.status),
          options,
        );
      }
      const after = structuredClone(port.objects());
      if (!contractActionCompleted(leaf, before, after) ||
          leaf.type === 'recall' && !recallPreservedState(before, after, leaf)) {
        port.restore(checkpoint);
        return rollbackResult(
          rolledBack(transactionId, types, [...attempted.slice(0, -1), 'impossible'], 'impossible'),
          options,
        );
      }
      steps.push({ action: leaf, before, after, outcome });
    }
  } catch (error) {
    port.restore(checkpoint);
    if (error instanceof ContractActionRollbackError) throw error;
    const failure = receiptStatusFromThrown(error);
    return rollbackResult(
      rolledBack(transactionId, types, [...attempted, failure], failure === 'done' ? 'impossible' : failure),
      options,
    );
  }

  const receipt: ActionReceipt = {
    ...(transactionId === undefined ? {} : { transactionId }),
    status: 'committed',
    actions: leaves.map(leaf => ({ type: leaf.type, status: 'done' })),
  };
  return {
    outcome: {
      status: 'done',
      events: steps.flatMap(step => step.outcome.events),
      receipt,
    },
    steps,
  };
}

/** A context capability shared by the reference kernel and production adapters. */
export function createContractActionCapability(
  perform: (action: ContractGameAction) => ActionOutcome,
): ContractActionCapability {
  return { version: CONTRACT_ACTION_CAPABILITY_VERSION, perform };
}

/** Construct the one transactional representation of a multi-object Kill instruction. */
export function killBatch(
  objects: readonly { readonly id: string; readonly zoneEntryId: number }[],
  transactionId?: string,
): BatchAction {
  return {
    type: 'batch',
    ...(transactionId === undefined ? {} : { transactionId }),
    actions: objects.map(object => ({ type: 'kill', object })),
  };
}

export type { BatchAction };
