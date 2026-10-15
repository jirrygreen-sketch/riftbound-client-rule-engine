// Private, process-local optional-play decision. This module never authorizes payment,
// movement, cost resolution, or an effect; the single outer command owner must do those.
import { assertAdmittedDuelMatchV2, inspectDuelNativeOriginV2,
  type DuelCanonicalPlayingStateV2 } from './core-v2.js';

export interface DuelOptionalPlaySourceV1 {
  readonly matchId: string;
  readonly actor: string;
  readonly uid: string;
  readonly cardId: string;
  readonly sourceEpoch: number;
  readonly sourceProgramFingerprint: string;
}

export interface DuelOptionalPlayChoiceRequestV1 {
  /** Authenticated by the outer command owner, never copied from a client claim. */
  readonly actor: string;
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly uid: string;
}

export interface DuelOptionalPlayAnswerV1 {
  /** Authenticated by the outer command owner. Only the IDs are client selections. */
  readonly actor: string;
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly choiceId: string;
  readonly optionId: string;
}

export interface DuelOptionalPlayPromptV1 {
  readonly choiceId: string;
  readonly payOptionId: string;
  readonly declineOptionId: string;
}

/** Identity guarded, in-memory only. A DATA copy is never a valid receipt. */
export interface DuelOptionalPlayReceiptV1 {
  readonly decision: 'pay' | 'decline';
}

/** Census metadata only. A pay decision remains pay when the eventual cost is zero. */
export interface DuelOptionalPlayReceiptDataV1 extends DuelOptionalPlaySourceV1 {
  readonly commandId: string;
  readonly stateVersion: number;
  readonly decision: 'pay' | 'decline';
}

export interface DuelOptionalPlayChoiceAuthorityV1 {
  issue(request: DuelOptionalPlayChoiceRequestV1): DuelOptionalPlayPromptV1;
  answer(request: DuelOptionalPlayAnswerV1): DuelOptionalPlayReceiptV1;
  /** Read only: inspection cannot consume, pay, execute, or move anything. */
  inspectReceipt(receipt: DuelOptionalPlayReceiptV1): DuelOptionalPlayReceiptDataV1;
}

export interface DuelOptionalPlayChoiceServicesV1 {
  readonly readHead: () => DuelCanonicalPlayingStateV2;
  /** Pure, pinned trusted catalog reader for the whole Accelerate source program. */
  readonly readSource: (match: DuelCanonicalPlayingStateV2, actor: string, uid: string) => DuelOptionalPlaySourceV1;
  /** Server owned random or monotonic opaque ID source; never derive IDs from client UIDs. */
  readonly nextOpaqueId: () => string;
}

interface Entry {
  readonly match: DuelCanonicalPlayingStateV2;
  readonly source: DuelOptionalPlaySourceV1;
  readonly commandId: string;
  readonly prompt: DuelOptionalPlayPromptV1;
  receipt?: DuelOptionalPlayReceiptV1;
  selectedOptionId?: string;
}

function fail(reason: string): never {
  throw new TypeError(`Duel optional play choice: ${reason}`);
}
function check(ok: unknown, reason: string): asserts ok {
  if (!ok) fail(reason);
}
function fields(raw: unknown, names: readonly string[], reason: string): Record<string, unknown> {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), reason);
  const prototype = Object.getPrototypeOf(raw);
  check(prototype === Object.prototype || prototype === null, reason);
  const keys = Reflect.ownKeys(raw);
  check(keys.length === names.length && names.every(name => keys.includes(name)) &&
    keys.every(key => typeof key === 'string' && names.includes(key) &&
      'value' in Object.getOwnPropertyDescriptor(raw, key)!), reason);
  return Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(raw, name)!.value]));
}
function id(value: unknown, reason: string): string {
  check(typeof value === 'string' && value.trim().length > 0, reason);
  return value;
}
function version(value: unknown): number {
  check(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, 'invalid version');
  return value;
}
function sourceOf(raw: unknown, match: DuelCanonicalPlayingStateV2, actor: string, uid: string): DuelOptionalPlaySourceV1 {
  const value = fields(raw, ['matchId', 'actor', 'uid', 'cardId', 'sourceEpoch',
    'sourceProgramFingerprint'], 'invalid source reader result');
  const source = Object.freeze({ matchId: id(value.matchId, 'invalid source match'),
    actor: id(value.actor, 'invalid source actor'), uid: id(value.uid, 'invalid source UID'),
    cardId: id(value.cardId, 'invalid source card'), sourceEpoch: version(value.sourceEpoch),
    sourceProgramFingerprint: id(value.sourceProgramFingerprint, 'missing source program fingerprint') });
  check(source.matchId === match.matchId && source.actor === actor && source.uid === uid,
    'source identity mismatch');
  const physical = match.physicalCardsByUID[uid];
  check(physical?.ownerPlayerId === actor && physical.cardId === source.cardId &&
    physical.zoneEpoch === source.sourceEpoch, 'source physical identity mismatch');
  return source;
}
function current(match: DuelCanonicalPlayingStateV2, actor: string, uid: string, expectedVersion: number): void {
  assertAdmittedDuelMatchV2(match);
  check(match.stage === 'playing' && match.stateVersion === expectedVersion, 'stale or invalid match');
  check(match.frame.phase === 'main' && match.frame.stateOpen &&
    match.frame.priorityPlayerId === actor && match.frame.pendingPayment === null,
  'optional play requires open Main and current Priority');
  const owner = match.players.find(player => player.playerId === actor);
  check(owner !== undefined && match.players.flatMap(player => player.hand)
    .filter(card => card.uid === uid).length === 1 &&
    owner.hand.filter(card => card.uid === uid).length === 1, 'UID is not the actor unique current Hand card');
  check(match.physicalCardsByUID[uid]?.ownerPlayerId === actor &&
    match.physicalCardsByUID[uid]?.cardId === owner.hand.find(card => card.uid === uid)?.cardId,
  'Hand physical source mismatch');
}

/**
 * A selected receipt is only evidence of pay/decline for a cost census. It is not payment
 * or effect authority. No restore or automatic version rebind exists: after a resource
 * mutation the outer single command owner must provide an explicit lineage policy.
 */
export function createDuelOptionalPlayChoiceAuthorityV1(
  services: DuelOptionalPlayChoiceServicesV1,
): DuelOptionalPlayChoiceAuthorityV1 {
  const configured = fields(services, ['readHead', 'readSource', 'nextOpaqueId'], 'invalid services');
  check(typeof configured.readHead === 'function' && typeof configured.readSource === 'function' &&
    typeof configured.nextOpaqueId === 'function', 'invalid services');
  const readHead = configured.readHead as DuelOptionalPlayChoiceServicesV1['readHead'];
  const readSource = configured.readSource as DuelOptionalPlayChoiceServicesV1['readSource'];
  const nextOpaqueId = configured.nextOpaqueId as DuelOptionalPlayChoiceServicesV1['nextOpaqueId'];
  const entries = new Map<string, Entry>();
  const sourceClaims = new Map<string, string>();
  const receipts = new WeakMap<object, Entry>();
  const usedIds = new Set<string>();
  let busy = false;
  // Reentry is a failed authority transaction. Keep the authority poisoned after
  // any nested call, including when a trusted callback catches that call.
  let poisoned = false;
  let matchBinding: { readonly matchId: string; readonly origin: object } | undefined;

  function locked<T>(work: () => T): T {
    if (busy) {
      poisoned = true;
      fail('reentrant operation');
    }
    check(!poisoned, 'authority poisoned by reentrant operation');
    busy = true;
    try {
      const result = work();
      // A callback may catch the nested-operation exception. The outer command
      // must still fail closed before exposing a prompt or receipt.
      check(!poisoned, 'authority poisoned by reentrant operation');
      return result;
    } finally { busy = false; }
  }
  function head(): DuelCanonicalPlayingStateV2 {
    const match = readHead();
    check(!poisoned, 'authority poisoned by reentrant operation');
    assertAdmittedDuelMatchV2(match);
    check(match.stage === 'playing', 'playing match required');
    const origin = inspectDuelNativeOriginV2(match);
    if (matchBinding) check(match.matchId === matchBinding.matchId && origin === matchBinding.origin,
      'foreign match lineage');
    else matchBinding = { matchId: match.matchId, origin };
    return match as DuelCanonicalPlayingStateV2;
  }
  function opaque(): string {
    const value = id(nextOpaqueId(), 'invalid opaque ID');
    check(!poisoned, 'authority poisoned by reentrant operation');
    check(!usedIds.has(value), 'duplicate opaque ID');
    usedIds.add(value);
    return value;
  }
  function sameSource(a: DuelOptionalPlaySourceV1, b: DuelOptionalPlaySourceV1): boolean {
    return a.matchId === b.matchId && a.actor === b.actor && a.uid === b.uid &&
      a.cardId === b.cardId && a.sourceEpoch === b.sourceEpoch &&
      a.sourceProgramFingerprint === b.sourceProgramFingerprint;
  }

  return Object.freeze({
    issue(raw: DuelOptionalPlayChoiceRequestV1): DuelOptionalPlayPromptV1 {
      return locked(() => {
        const request = fields(raw, ['actor', 'commandId', 'expectedVersion', 'uid'], 'invalid issue');
        const actor = id(request.actor, 'invalid actor');
        const commandId = id(request.commandId, 'invalid command ID');
        const uid = id(request.uid, 'invalid UID');
        const expectedVersion = version(request.expectedVersion);
        const match = head();
        current(match, actor, uid, expectedVersion);
        const key = JSON.stringify([match.matchId, actor, commandId]);
        const prior = entries.get(key);
        if (prior) {
          check(prior.match === match && prior.source.actor === actor && prior.source.uid === uid,
            'command conflict');
          return prior.prompt;
        }
        const source = sourceOf(readSource(match, actor, uid), match, actor, uid);
        check(!poisoned, 'authority poisoned by reentrant operation');
        const sourceKey = JSON.stringify([source.matchId, actor, uid, source.sourceEpoch, match.stateVersion]);
        check(!sourceClaims.has(sourceKey), 'source already has a choice');
        const prompt = Object.freeze({ choiceId: opaque(), payOptionId: opaque(), declineOptionId: opaque() });
        entries.set(key, { match, source, commandId, prompt });
        sourceClaims.set(sourceKey, key);
        return prompt;
      });
    },
    answer(raw: DuelOptionalPlayAnswerV1): DuelOptionalPlayReceiptV1 {
      return locked(() => {
        const request = fields(raw, ['actor', 'commandId', 'expectedVersion', 'choiceId', 'optionId'], 'invalid answer');
        const actor = id(request.actor, 'invalid actor');
        const commandId = id(request.commandId, 'invalid command ID');
        const expectedVersion = version(request.expectedVersion);
        const choiceId = id(request.choiceId, 'invalid choice ID');
        const optionId = id(request.optionId, 'invalid option ID');
        const match = head();
        const entry = entries.get(JSON.stringify([match.matchId, actor, commandId]));
        check(entry !== undefined && entry.match === match && entry.prompt.choiceId === choiceId,
          'unknown or stale choice');
        current(match, actor, entry.source.uid, expectedVersion);
        check(entry.source.actor === actor, 'wrong actor');
        check(optionId === entry.prompt.payOptionId || optionId === entry.prompt.declineOptionId,
          'unknown option');
        if (entry.receipt) {
          check(entry.selectedOptionId === optionId, 'choice already frozen');
          return entry.receipt;
        }
        const refreshed = sourceOf(readSource(match, actor, entry.source.uid), match, actor, entry.source.uid);
        check(!poisoned, 'authority poisoned by reentrant operation');
        check(sameSource(entry.source, refreshed), 'source program changed');
        const receipt = Object.freeze({ decision: optionId === entry.prompt.payOptionId ? 'pay' as const : 'decline' as const });
        entry.selectedOptionId = optionId;
        entry.receipt = receipt;
        receipts.set(receipt, entry);
        return receipt;
      });
    },
    inspectReceipt(raw: DuelOptionalPlayReceiptV1): DuelOptionalPlayReceiptDataV1 {
      return locked(() => {
        check(raw !== null && typeof raw === 'object', 'invalid receipt');
        const entry = receipts.get(raw);
        check(entry !== undefined && entry.receipt === raw, 'foreign or unchosen receipt');
        const match = head();
        check(match === entry.match, 'stale receipt');
        current(match, entry.source.actor, entry.source.uid, entry.match.stateVersion);
        return Object.freeze({ ...entry.source, commandId: entry.commandId,
          stateVersion: entry.match.stateVersion, decision: entry.receipt.decision });
      });
    },
  });
}
