// In-process, two-sided choice cursor for the basic Combat allocation kernel.
// This module stops at a simultaneous-deal plan: it never deals damage or changes a board.
import {
  assertDuelBaseCombatPlan,
  completeDuelBaseCombatAllocation,
  DuelBaseCombatBlockedError,
  validateDuelBaseCombatAllocation,
  type DuelBaseCombatAllocationResult,
  type DuelBaseCombatAssignment,
  type DuelBaseCombatCompleteAllocation,
  type DuelBaseCombatOrderedUIDAmount,
  type DuelBaseCombatPlan,
} from './base-combat-allocation.js';

export type DuelCombatChoiceV2Side = 'attacker' | 'defender';
export type DuelCombatChoiceV2BlockCode =
  | 'invalid-cursor'
  | 'cursor-consumed'
  | 'cursor-in-use'
  | 'plan-mismatch'
  | 'plan-already-used'
  | 'unexpected-side'
  | 'unexpected-actor';

export class DuelCombatChoiceV2BlockedError extends TypeError {
  readonly code: DuelCombatChoiceV2BlockCode;

  constructor(code: DuelCombatChoiceV2BlockCode, message: string) {
    super(`Duel combat choice blocked [${code}]: ${message}`);
    this.name = 'DuelCombatChoiceV2BlockedError';
    this.code = code;
  }
}

/** A choice receipt, not a new Might/budget/board authority. */
export interface DuelCombatChoiceV2CommittedAllocation {
  readonly side: 'attacker';
  readonly actorPlayerId: string;
  readonly assignments: readonly DuelBaseCombatAssignment[];
}

/** Only the pending choice can be continued; completion returns the kernel's deal plan instead. */
export interface DuelCombatChoiceCursorV2 {
  readonly kind: 'duel-combat-choice-v2';
  readonly stateVersion: number;
  readonly fieldId: string;
  readonly sideIDs: readonly [string, string];
  readonly expectedSide: DuelCombatChoiceV2Side;
  readonly expectedActorPlayerId: string;
  readonly committedAllocations: readonly DuelCombatChoiceV2CommittedAllocation[];
}

interface CursorBond {
  readonly plan: DuelBaseCombatPlan;
  readonly expectedSide: DuelCombatChoiceV2Side;
  readonly attackerAllocation: DuelBaseCombatAllocationResult | null;
  spent: boolean;
  inUse: boolean;
}

interface PlanLifecycle {
  state: 'active' | 'completed';
}

// Serialized cursors/plans have no authority: both the cursor bond and the one-shot
// plan lifecycle are keyed by their actual process-local kernel-issued identities.
const cursorBonds = new WeakMap<object, CursorBond>();
const planLifecycles = new WeakMap<object, PlanLifecycle>();

function blocked(code: DuelCombatChoiceV2BlockCode, message: string): never {
  throw new DuelCombatChoiceV2BlockedError(code, message);
}

/** Public errors must not expose kernel budgets, lethal thresholds, UID or trap text. */
function publicKernelError(error: unknown): never {
  if (error instanceof DuelBaseCombatBlockedError) {
    const code = error.code;
    // Keep the kernel's stable code for existing callers, but not its computed text.
    switch (code) {
      case 'invalid-plan':
      case 'stale-plan':
      case 'plan-already-used':
      case 'invalid-allocation':
      case 'invalid-active-field':
      case 'actor-not-participant':
      case 'numeric-overflow':
        throw new DuelBaseCombatBlockedError(code, 'combat choice cannot be accepted');
      default:
        throw new DuelBaseCombatBlockedError('invalid-allocation', 'combat choice cannot be accepted');
    }
  }
  // Caller-supplied Proxies may throw anything, including a private exception.
  throw new DuelBaseCombatBlockedError('invalid-allocation', 'combat choice cannot be accepted');
}

function checkVersion(cursor: DuelCombatChoiceCursorV2, currentStateVersion: number): void {
  if (!Number.isSafeInteger(currentStateVersion) || currentStateVersion < 0 ||
      currentStateVersion !== cursor.stateVersion) {
    throw new DuelBaseCombatBlockedError('stale-plan', 'combat choice cannot be accepted');
  }
}

/** Create from an actual kernel-branded plan, not a shape-equivalent/JSON plan. */
export function createDuelCombatChoiceCursorV2(
  plan: DuelBaseCombatPlan,
  currentStateVersion: number,
): DuelCombatChoiceCursorV2 {
  try {
    assertDuelBaseCombatPlan(plan, currentStateVersion);
  } catch (error) {
    publicKernelError(error);
  }
  // A failed attestation has no lifecycle effect; one trusted plan has exactly
  // one cursor chain, including while a submission is in flight and after deal.
  if (planLifecycles.has(plan)) blocked('plan-already-used', 'combat plan has already opened a choice');
  const cursor: DuelCombatChoiceCursorV2 = Object.freeze({
    kind: 'duel-combat-choice-v2' as const,
    stateVersion: plan.basedOnStateVersion,
    fieldId: plan.fieldId,
    sideIDs: Object.freeze([...plan.sideIDs]) as readonly [string, string],
    expectedSide: 'attacker' as const,
    expectedActorPlayerId: plan.sideIDs[0],
    committedAllocations: Object.freeze([]) as readonly DuelCombatChoiceV2CommittedAllocation[],
  });
  cursorBonds.set(cursor, {
    plan, expectedSide: 'attacker', attackerAllocation: null, spent: false, inUse: false,
  });
  planLifecycles.set(plan, { state: 'active' });
  return cursor;
}

/**
 * Attacker chooses first, then Defender; the second choice returns only a simultaneous-deal
 * plan. Failed checks/validation leave the same cursor usable. Successful transitions spend
 * their input cursor so a replay cannot mint a second completion result.
 */
export function submitDuelCombatChoiceV2(
  cursor: DuelCombatChoiceCursorV2,
  plan: DuelBaseCombatPlan,
  side: DuelCombatChoiceV2Side,
  actorPlayerId: string,
  orderedUIDAmounts: readonly DuelBaseCombatOrderedUIDAmount[],
  currentStateVersion: number,
): DuelCombatChoiceCursorV2 | DuelBaseCombatCompleteAllocation {
  const bond = cursor !== null && typeof cursor === 'object' ? cursorBonds.get(cursor) : undefined;
  if (bond === undefined) blocked('invalid-cursor', 'cursor must be issued by this process');
  if (bond.spent) blocked('cursor-consumed', 'choice cursor has already advanced');
  if (bond.inUse) blocked('cursor-in-use', 'choice cursor is already being submitted');
  if (plan !== bond.plan) blocked('plan-mismatch', 'choice belongs to a different combat plan');
  checkVersion(cursor, currentStateVersion);
  if (side !== bond.expectedSide) blocked('unexpected-side', `expected ${bond.expectedSide}`);
  const expectedActorPlayerId = bond.plan.sideIDs[bond.expectedSide === 'attacker' ? 0 : 1];
  if (actorPlayerId !== expectedActorPlayerId) {
    blocked('unexpected-actor', `expected the ${bond.expectedSide} player`);
  }

  // Validate before advancing, with an in-flight guard against hostile Proxy traps.
  // Rejected input leaves the cursor and its single plan chain available to retry.
  bond.inUse = true;
  try {
    let allocation: DuelBaseCombatAllocationResult;
    try {
      allocation = validateDuelBaseCombatAllocation(plan, actorPlayerId,
        orderedUIDAmounts, currentStateVersion);
    } catch (error) {
      publicKernelError(error);
    }
    if (bond.expectedSide === 'defender') {
      if (bond.attackerAllocation === null) blocked('invalid-cursor', 'missing prior Attacker allocation');
      let complete: DuelBaseCombatCompleteAllocation;
      try {
        complete = completeDuelBaseCombatAllocation(
          bond.attackerAllocation, allocation, currentStateVersion);
      } catch (error) {
        publicKernelError(error);
      }
      bond.spent = true;
      const lifecycle = planLifecycles.get(plan);
      if (lifecycle !== undefined) lifecycle.state = 'completed';
      return complete;
    }

    const committed: DuelCombatChoiceV2CommittedAllocation = Object.freeze({
      side: 'attacker' as const,
      actorPlayerId: allocation.actorPlayerId,
      assignments: Object.freeze(allocation.assignments.map(assignment =>
        Object.freeze({ uid: assignment.uid, amount: assignment.amount }))),
    });
    const next: DuelCombatChoiceCursorV2 = Object.freeze({
      kind: 'duel-combat-choice-v2' as const,
      stateVersion: cursor.stateVersion,
      fieldId: cursor.fieldId,
      sideIDs: Object.freeze([...cursor.sideIDs]) as readonly [string, string],
      expectedSide: 'defender' as const,
      expectedActorPlayerId: plan.sideIDs[1],
      committedAllocations: Object.freeze([committed]),
    });
    cursorBonds.set(next, {
      plan, expectedSide: 'defender', attackerAllocation: allocation, spent: false, inUse: false,
    });
    bond.spent = true;
    return next;
  } finally {
    bond.inUse = false;
  }
}
