// INTERNAL V4 choice authority.  A choice is issued only after the physical
// Unit has entered the Chain and State has closed.  It is never a payment or
// entry authority and its process-local receipt cannot be reconstructed from JSON.
import { assertAdmittedDuelMatchV2, inspectDuelNativeOriginV2,
  type DuelCanonicalPlayingStateV2 } from './core-v2.js';

export interface DuelOptionalPlaySourceV2 {
  readonly matchId: string;
  readonly actor: string;
  readonly uid: string;
  readonly cardId: string;
  readonly sourceEpoch: number;
  readonly sourceProgramFingerprint: string;
}
export interface DuelOptionalPlayChoiceRequestV2 {
  readonly actor: string;
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly uid: string;
}
export interface DuelOptionalPlayAnswerV2 {
  readonly actor: string;
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly choiceId: string;
  readonly optionId: string;
}
export interface DuelOptionalPlayPromptV2 {
  readonly choiceId: string;
  readonly payOptionId: string;
  readonly declineOptionId: string;
}
export interface DuelOptionalPlayReceiptV2 { readonly decision: 'pay' | 'decline' }
export interface DuelOptionalPlayReceiptDataV2 extends DuelOptionalPlaySourceV2 {
  readonly commandId: string;
  readonly stateVersion: number;
  readonly decision: 'pay' | 'decline';
}
export interface DuelOptionalPlayChoiceAuthorityV2 {
  issue(request: DuelOptionalPlayChoiceRequestV2): DuelOptionalPlayPromptV2;
  answer(request: DuelOptionalPlayAnswerV2): DuelOptionalPlayReceiptV2;
  inspectReceipt(receipt: DuelOptionalPlayReceiptV2): DuelOptionalPlayReceiptDataV2;
}
export interface DuelOptionalPlayChoiceServicesV2 {
  readonly readHead: () => DuelCanonicalPlayingStateV2;
  readonly readSource: (match: DuelCanonicalPlayingStateV2, actor: string, uid: string) => DuelOptionalPlaySourceV2;
  readonly nextOpaqueId: () => string;
}

type Entry = {
  readonly match: DuelCanonicalPlayingStateV2;
  readonly origin: object;
  readonly source: DuelOptionalPlaySourceV2;
  readonly actor: string;
  readonly uid: string;
  readonly commandId: string;
  readonly prompt: DuelOptionalPlayPromptV2;
  receipt?: DuelOptionalPlayReceiptV2;
  optionId?: string;
};

function fail(message: string): never { throw new TypeError(`Duel optional play choice V2: ${message}`); }
function check(value: unknown, message: string): asserts value { if (!value) fail(message); }
function id(value: unknown, message: string): string {
  check(typeof value === 'string' && value.trim().length > 0, message); return value;
}
function version(value: unknown): number {
  check(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, 'invalid version'); return value;
}
function plain(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'plain record required');
  const proto = Object.getPrototypeOf(raw);
  check(proto === Object.prototype || proto === null, 'plain record prototype');
  const own = Reflect.ownKeys(raw);
  check(own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key)),
    'record fields');
  for (const key of keys) check(Object.hasOwn(raw, key) &&
    'value' in Object.getOwnPropertyDescriptor(raw, key)!, 'record accessor');
  return raw as Record<string, unknown>;
}
function source(raw: unknown, match: DuelCanonicalPlayingStateV2, actor: string, uid: string): DuelOptionalPlaySourceV2 {
  const value = plain(raw, ['matchId', 'actor', 'uid', 'cardId', 'sourceEpoch', 'sourceProgramFingerprint']);
  const result = Object.freeze({ matchId: id(value.matchId, 'source match'), actor: id(value.actor, 'source actor'),
    uid: id(value.uid, 'source UID'), cardId: id(value.cardId, 'source card'),
    sourceEpoch: version(value.sourceEpoch), sourceProgramFingerprint: id(value.sourceProgramFingerprint, 'source program') });
  const physical = match.physicalCardsByUID[uid];
  const chain = (match.chainCards ?? []).filter(card => card.uid === uid);
  check(result.matchId === match.matchId && result.actor === actor && result.uid === uid,
    'source identity mismatch');
  check(chain.length === 1 && chain[0]!.cardId === result.cardId && chain[0]!.ownerPlayerId === actor,
    'source is not the current Chain card');
  check(physical?.ownerPlayerId === actor && physical.cardId === result.cardId &&
    physical.zoneEpoch === result.sourceEpoch, 'source physical epoch mismatch');
  return result;
}
function chainHead(match: DuelCanonicalPlayingStateV2, actor: string, uid: string, expectedVersion: number): object {
  assertAdmittedDuelMatchV2(match);
  check(match.stage === 'playing' && match.stateVersion === expectedVersion, 'stale or invalid head');
  check(match.frame.phase === 'main' && !match.frame.stateOpen &&
    match.frame.priorityPlayerId === actor && match.frame.pendingPayment === null,
  'choice requires closed Main Chain head');
  const card = (match.chainCards ?? []).filter(item => item.uid === uid);
  check(card.length === 1 && card[0]!.ownerPlayerId === actor && card[0]!.controllerPlayerId === actor,
    'UID is not the actor Chain card');
  return inspectDuelNativeOriginV2(match);
}

export function createDuelOptionalPlayChoiceAuthorityV2(
  services: DuelOptionalPlayChoiceServicesV2,
): DuelOptionalPlayChoiceAuthorityV2 {
  const configured = plain(services, ['readHead', 'readSource', 'nextOpaqueId']);
  check(typeof configured.readHead === 'function' && typeof configured.readSource === 'function' &&
    typeof configured.nextOpaqueId === 'function', 'invalid choice services');
  const readHead = configured.readHead as DuelOptionalPlayChoiceServicesV2['readHead'];
  const readSource = configured.readSource as DuelOptionalPlayChoiceServicesV2['readSource'];
  const nextOpaqueId = configured.nextOpaqueId as DuelOptionalPlayChoiceServicesV2['nextOpaqueId'];
  const entries = new Map<string, Entry>();
  const receipts = new WeakMap<object, Entry>();
  const used = new Set<string>();
  let busy = false;
  let poisoned = false;
  let binding: { readonly matchId: string; readonly origin: object } | undefined;
  const locked = <T>(work: () => T): T => {
    if (busy) { poisoned = true; fail('reentrant operation'); }
    check(!poisoned, 'authority poisoned');
    busy = true;
    try { const result = work(); check(!poisoned, 'authority poisoned'); return result; }
    finally { busy = false; }
  };
  const head = (): DuelCanonicalPlayingStateV2 => {
    const match = readHead();
    check(!poisoned, 'authority poisoned');
    assertAdmittedDuelMatchV2(match);
    const origin = inspectDuelNativeOriginV2(match);
    if (binding) check(binding.matchId === match.matchId && binding.origin === origin, 'foreign match lineage');
    else binding = { matchId: match.matchId, origin };
    return match;
  };
  const opaque = (): string => {
    const value = id(nextOpaqueId(), 'invalid opaque ID');
    check(!used.has(value), 'duplicate opaque ID'); used.add(value); return value;
  };
  return Object.freeze({
    issue(raw: DuelOptionalPlayChoiceRequestV2): DuelOptionalPlayPromptV2 {
      return locked(() => {
        const value = plain(raw, ['actor', 'commandId', 'expectedVersion', 'uid']);
        const actor = id(value.actor, 'actor'), commandId = id(value.commandId, 'command ID'), uid = id(value.uid, 'UID');
        const expectedVersion = version(value.expectedVersion), match = head();
        chainHead(match, actor, uid, expectedVersion);
        const key = JSON.stringify([match.matchId, actor, commandId]);
        const prior = entries.get(key);
        if (prior) {
          check(prior.match === match && prior.uid === uid, 'command conflict'); return prior.prompt;
        }
        const read = source(readSource(match, actor, uid), match, actor, uid);
        const prompt = Object.freeze({ choiceId: opaque(), payOptionId: opaque(), declineOptionId: opaque() });
        entries.set(key, { match, origin: inspectDuelNativeOriginV2(match), source: read, actor, uid, commandId, prompt });
        return prompt;
      });
    },
    answer(raw: DuelOptionalPlayAnswerV2): DuelOptionalPlayReceiptV2 {
      return locked(() => {
        const value = plain(raw, ['actor', 'commandId', 'expectedVersion', 'choiceId', 'optionId']);
        const actor = id(value.actor, 'actor'), commandId = id(value.commandId, 'command ID'),
          expectedVersion = version(value.expectedVersion), choiceId = id(value.choiceId, 'choice ID'),
          optionId = id(value.optionId, 'option ID'), match = head();
        const entry = entries.get(JSON.stringify([match.matchId, actor, commandId]));
        check(entry && entry.match === match && entry.actor === actor && entry.prompt.choiceId === choiceId,
          'unknown or stale choice');
        chainHead(match, actor, entry.uid, expectedVersion);
        check(optionId === entry.prompt.payOptionId || optionId === entry.prompt.declineOptionId, 'unknown option');
        if (entry.receipt) { check(entry.optionId === optionId, 'choice already frozen'); return entry.receipt; }
        const refreshed = source(readSource(match, actor, entry.uid), match, actor, entry.uid);
        check(JSON.stringify(refreshed) === JSON.stringify(entry.source), 'source program changed');
        const receipt = Object.freeze({ decision: optionId === entry.prompt.payOptionId ? 'pay' as const : 'decline' as const });
        entry.optionId = optionId; entry.receipt = receipt; receipts.set(receipt, entry); return receipt;
      });
    },
    inspectReceipt(raw: DuelOptionalPlayReceiptV2): DuelOptionalPlayReceiptDataV2 {
      return locked(() => {
        check(raw !== null && typeof raw === 'object', 'invalid receipt');
        const entry = receipts.get(raw as object); check(entry?.receipt === raw, 'foreign or unchosen receipt');
        const match = head(); check(match === entry.match, 'stale receipt');
        chainHead(match, entry.actor, entry.uid, entry.match.stateVersion);
        return Object.freeze({ ...entry.source, commandId: entry.commandId,
          stateVersion: entry.match.stateVersion, decision: entry.receipt!.decision });
      });
    },
  });
}

