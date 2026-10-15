// INTERNAL basic Combat deal bridge. The caller owns the source service and canonical head.
// Cleanup, Kill, Showdown resolution and Conquer remain separate outstanding work.
import {
  createTrustedDuelBaseCombatFacts, planDuelBaseCombatDamage,
  type DuelBaseCombatCompleteAllocation, type DuelBaseCombatOrderedUIDAmount,
  type DuelBaseCombatSourceEffectService,
} from './base-combat-allocation.js';
import {
  createDuelCombatChoiceCursorV2, submitDuelCombatChoiceV2,
  type DuelCombatChoiceCursorV2,
} from './combat-choice-v2.js';
import {
  assertAdmittedDuelMatchV2, commitDuelCombatDealMutationV2,
  type DuelCanonicalPlayingStateV2,
} from './core-v2.js';
import type { DuelDamageMark } from './unit-lifecycle.js';

export type DuelCombatDamageBlockCodeV2 =
  | 'invalid-authority' | 'stale-branch' | 'stale-version' | 'already-dealt'
  | 'in-use' | 'unexpected-actor' | 'invalid-choice' | 'internal-error';

export class DuelCombatDamageBlockedErrorV2 extends TypeError {
  constructor(readonly code: DuelCombatDamageBlockCodeV2) {
    super(`Duel combat damage blocked [${code}]`);
    this.name = 'DuelCombatDamageBlockedErrorV2';
  }
}

/** The only command-facing values are actor, ordered assignment, and expected version. */
export interface DuelCombatDamageChoiceV2 {
  readonly actorPlayerId: string;
  readonly orderedUIDAmounts: readonly DuelBaseCombatOrderedUIDAmount[];
  readonly expectedStateVersion: number;
}

/** An opaque process-local handle. It must never be serialized or accepted from a client. */
export interface DuelCombatDamageAuthorityV2 {
  readonly kind: 'duel-combat-damage-authority-v2';
}

export type DuelCombatDamageStepV2 =
  | { readonly kind: 'awaiting-defender'; readonly authority: DuelCombatDamageAuthorityV2;
      readonly expectedActorPlayerId: string }
  | { readonly kind: 'damage-dealt'; readonly state: DuelCanonicalPlayingStateV2;
      readonly beforeStateVersion: number; readonly afterStateVersion: number;
      readonly pendingCleanup: true };

interface BattleLedger {
  busy: boolean;
  dealt: boolean;
}
interface AuthorityState {
  readonly before: DuelCanonicalPlayingStateV2;
  readonly fieldId: string;
  readonly readHead: () => DuelCanonicalPlayingStateV2;
  readonly ledger: BattleLedger;
  readonly plan: ReturnType<typeof planDuelBaseCombatDamage>;
  cursor: DuelCombatChoiceCursorV2;
  complete: DuelBaseCombatCompleteAllocation | null;
}
const battles = new WeakMap<object, Map<string, BattleLedger>>();
const authorities = new WeakMap<object, AuthorityState>();

function blocked(code: DuelCombatDamageBlockCodeV2): never {
  throw new DuelCombatDamageBlockedErrorV2(code);
}

function freezeSnapshot(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) freezeSnapshot(descriptor.value, seen);
  }
  Object.freeze(value);
}

function current(entry: AuthorityState, expectedStateVersion: number): void {
  if (!Number.isSafeInteger(expectedStateVersion) ||
      expectedStateVersion !== entry.before.stateVersion) blocked('stale-version');
  assertHead(entry.before, entry.readHead);
}

function assertHead(before: DuelCanonicalPlayingStateV2,
  readHead: () => DuelCanonicalPlayingStateV2): void {
  let head: DuelCanonicalPlayingStateV2;
  try { head = readHead(); } catch { blocked('internal-error'); }
  if (head !== before || head.matchId !== before.matchId ||
      head.eventSeq !== before.eventSeq || head.stateVersion !== before.stateVersion) {
    blocked('stale-branch');
  }
}

function sameChoice(raw: readonly DuelBaseCombatOrderedUIDAmount[],
  expected: readonly DuelBaseCombatOrderedUIDAmount[]): boolean {
  try {
    if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype ||
        Reflect.ownKeys(raw).length !== raw.length + 1 || raw.length !== expected.length) return false;
    return expected.every((entry, index) => {
      const item = Object.getOwnPropertyDescriptor(raw, String(index));
      if (!item || !('value' in item) || item.value === null || typeof item.value !== 'object') return false;
      const value = item.value as object;
      const uid = Object.getOwnPropertyDescriptor(value, 'uid');
      const amount = Object.getOwnPropertyDescriptor(value, 'amount');
      return (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
        Reflect.ownKeys(value).length === 2 && uid && 'value' in uid && uid.value === entry.uid &&
        amount && 'value' in amount && amount.value === entry.amount;
    });
  } catch { return false; }
}

/**
 * Read caller-controlled choice data before the final head check. The returned
 * values are ordinary frozen records, so the kernel cannot invoke a caller
 * getter or Proxy after the check immediately preceding submission.
 */
function snapshotChoiceAssignments(raw: unknown): readonly DuelBaseCombatOrderedUIDAmount[] {
  try {
    if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype) {
      blocked('invalid-choice');
    }
    const length = raw.length;
    const keys = Reflect.ownKeys(raw);
    if (keys.length !== length + 1 || !keys.includes('length') ||
        keys.some(key => key !== 'length' && (typeof key !== 'string' ||
          !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length))) blocked('invalid-choice');
    const snapshots: DuelBaseCombatOrderedUIDAmount[] = [];
    const items: object[] = [];
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, String(index));
      if (!descriptor || !('value' in descriptor) || descriptor.value === null ||
          typeof descriptor.value !== 'object') blocked('invalid-choice');
      const item = descriptor.value as object;
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
        blocked('invalid-choice');
      }
      const itemKeys = Reflect.ownKeys(item);
      const uid = Object.getOwnPropertyDescriptor(item, 'uid');
      const amount = Object.getOwnPropertyDescriptor(item, 'amount');
      if (itemKeys.length !== 2 || !uid || !('value' in uid) || !amount || !('value' in amount)) {
        blocked('invalid-choice');
      }
      snapshots.push(Object.freeze({ uid: uid.value, amount: amount.value }) as
        unknown as DuelBaseCombatOrderedUIDAmount);
      items.push(item);
    }
    const finalKeys = Reflect.ownKeys(raw);
    if (raw.length !== length || finalKeys.length !== keys.length ||
        finalKeys.some(key => !keys.includes(key))) blocked('invalid-choice');
    for (let index = 0; index < length; index++) {
      const entry = Object.getOwnPropertyDescriptor(raw, String(index));
      const item = items[index];
      const snapshot = snapshots[index];
      if (!entry || !('value' in entry) || entry.value !== item || snapshot === undefined) {
        blocked('invalid-choice');
      }
      const uid = Object.getOwnPropertyDescriptor(item, 'uid');
      const amount = Object.getOwnPropertyDescriptor(item, 'amount');
      if (!uid || !('value' in uid) || !Object.is(uid.value, snapshot.uid) ||
          !amount || !('value' in amount) || !Object.is(amount.value, snapshot.amount)) {
        blocked('invalid-choice');
      }
    }
    return Object.freeze(snapshots);
  } catch (error) {
    if (error instanceof DuelCombatDamageBlockedErrorV2) throw error;
    blocked('invalid-choice');
  }
}

/** Trusted host entry: readHead must return the actual current admitted branch head. */
export function createDuelCombatDamageAuthorityV2(
  before: DuelCanonicalPlayingStateV2,
  fieldId: string,
  source: DuelBaseCombatSourceEffectService,
  readHead: () => DuelCanonicalPlayingStateV2,
): DuelCombatDamageAuthorityV2 {
  assertAdmittedDuelMatchV2(before);
  if (before.stage !== 'playing' || typeof readHead !== 'function') blocked('invalid-authority');
  if (typeof fieldId !== 'string' || fieldId.trim().length === 0) blocked('invalid-authority');
  let byField = battles.get(before);
  if (!byField) { byField = new Map(); battles.set(before, byField); }
  let ledger = byField.get(fieldId);
  if (!ledger) { ledger = { busy: false, dealt: false }; byField.set(fieldId, ledger); }
  if (ledger.busy) blocked('in-use');
  if (ledger.dealt) blocked('already-dealt');
  ledger.busy = true;
  try {
    let head: DuelCanonicalPlayingStateV2;
    try { head = readHead(); } catch { blocked('internal-error'); }
    if (head !== before) blocked('stale-branch');
    freezeSnapshot(before);
    let plan: ReturnType<typeof planDuelBaseCombatDamage>;
    let cursor: DuelCombatChoiceCursorV2;
    try {
      const facts = createTrustedDuelBaseCombatFacts(before.stateVersion, fieldId, source);
      plan = planDuelBaseCombatDamage(before, fieldId, facts);
      cursor = createDuelCombatChoiceCursorV2(plan, before.stateVersion);
    } catch { blocked('invalid-authority'); }
    // Source callbacks and plan construction are caller-owned work. The
    // authority is issued only if the exact admitted head survived all of it.
    assertHead(before, readHead);
    const authority = Object.freeze({ kind: 'duel-combat-damage-authority-v2' as const });
    authorities.set(authority, { before, fieldId, readHead, ledger, plan, cursor, complete: null });
    return authority;
  } finally { ledger.busy = false; }
}

function applyDeal(entry: AuthorityState, complete: DuelBaseCombatCompleteAllocation): DuelCanonicalPlayingStateV2 {
  const marks = new Map<string, DuelDamageMark>();
  for (const side of [complete.attacker, complete.defender]) {
    const sources = side.side === 'attacker' ? entry.plan.defender.targets : entry.plan.attacker.targets;
    const sourceObjectIds = Object.freeze(sources.filter(unit => unit.currentMight > 0).map(unit => unit.uid));
    for (const assignment of side.assignments) {
      if (marks.has(assignment.uid)) blocked('internal-error');
      marks.set(assignment.uid, { amount: assignment.amount,
        responsiblePlayerId: side.actorPlayerId, sourceObjectIds });
    }
  }
  return commitDuelCombatDealMutationV2(entry.before, complete, draft => {
    const unitMeta = { ...draft.unitMeta };
    for (const [uid, mark] of marks) {
      const meta = unitMeta[uid];
      if (!meta) blocked('internal-error');
      const total = meta.damageMarks.reduce((sum, prior) => sum + prior.amount, mark.amount);
      if (!Number.isSafeInteger(total)) blocked('internal-error');
      unitMeta[uid] = { ...meta, damageMarks: [...meta.damageMarks, mark] };
    }
    return { match: { ...draft, unitMeta }, transitions: [] };
  });
}

/** The defender's successful choice commits both sides in one canonical mutation. */
export function submitDuelCombatDamageChoiceV2(
  authority: DuelCombatDamageAuthorityV2,
  choice: DuelCombatDamageChoiceV2,
): DuelCombatDamageStepV2 {
  const entry = authority !== null && typeof authority === 'object' ? authorities.get(authority) : undefined;
  if (!entry) blocked('invalid-authority');
  if (entry.ledger.busy) blocked('in-use');
  if (entry.ledger.dealt) blocked('already-dealt');
  entry.ledger.busy = true;
  try {
    if (choice === null || typeof choice !== 'object') blocked('invalid-choice');
    let expectedStateVersion: unknown;
    let actorPlayerId: unknown;
    let orderedUIDAmounts: readonly DuelBaseCombatOrderedUIDAmount[];
    try {
      expectedStateVersion = choice.expectedStateVersion;
      current(entry, expectedStateVersion as number);
      actorPlayerId = choice.actorPlayerId;
      orderedUIDAmounts = snapshotChoiceAssignments(choice.orderedUIDAmounts);
    } catch (error) {
      if (error instanceof DuelCombatDamageBlockedErrorV2) throw error;
      blocked('invalid-choice');
    }
    // All caller-controlled reads are complete. This is the final branch check
    // before the kernel advances its one-shot cursor or emits a Deal receipt.
    current(entry, expectedStateVersion as number);
    const expectedActor = entry.complete ? entry.plan.sideIDs[1] : entry.cursor.expectedActorPlayerId;
    if (actorPlayerId !== expectedActor) blocked('unexpected-actor');
    if (entry.complete) {
      if (!sameChoice(orderedUIDAmounts, entry.complete.defender.assignments)) blocked('invalid-choice');
    } else {
      let result: ReturnType<typeof submitDuelCombatChoiceV2>;
      try {
        result = submitDuelCombatChoiceV2(entry.cursor, entry.plan, entry.cursor.expectedSide,
          actorPlayerId as string, orderedUIDAmounts, entry.before.stateVersion);
      } catch { blocked('invalid-choice'); }
      if (result.kind === 'duel-combat-choice-v2') {
        entry.cursor = result;
        return Object.freeze({ kind: 'awaiting-defender' as const, authority,
          expectedActorPlayerId: result.expectedActorPlayerId });
      }
      entry.complete = result;
    }
    // Recheck after the kernel has produced the genuine completion receipt and
    // immediately before the canonical Deal mutation.
    current(entry, expectedStateVersion as number);
    let state: DuelCanonicalPlayingStateV2;
    try { state = applyDeal(entry, entry.complete); } catch { blocked('internal-error'); }
    // Commit has returned a fully admitted state; no caller callback runs before consumption.
    entry.ledger.dealt = true;
    return Object.freeze({ kind: 'damage-dealt' as const, state,
      beforeStateVersion: entry.before.stateVersion, afterStateVersion: state.stateVersion,
      pendingCleanup: true as const });
  } finally { entry.ledger.busy = false; }
}
