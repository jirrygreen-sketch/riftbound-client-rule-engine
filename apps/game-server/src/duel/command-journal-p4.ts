/** Server-private P4 replay. A JSON archive is never an authority: restoration
 * requires an independently held digest, current catalog/roster and a live gate. */
import { createHash, randomUUID } from 'node:crypto';
import { isDuelCommandMessageV3Actions1, type DuelCommandMessageV3Actions1 } from '@riftbound/protocol';
import {
  createAuthoritativeDuelRuntimeP4, fingerprintDuelAuthoritativeRuntimePrivateP4,
  DUEL_RUNTIME_PROFILE_P4_LEGACY, DUEL_RUNTIME_PROFILE_P4_SPELL,
  DUEL_RUNTIME_PROFILE_P4_PUBLIC_CHAIN, DUEL_RUNTIME_PROFILE_P4_REGIONAL, DUEL_RUNTIME_SEMANTIC_VERSION_P4_REGIONAL, DUEL_RUNTIME_SEMANTIC_VERSION_P4,
  DUEL_RUNTIME_SEMANTIC_VERSION_P4_PUBLIC_CHAIN,
  DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT, DUEL_RUNTIME_SEMANTIC_VERSION_P4_OPTIONAL_UNIT,
  DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK, DUEL_RUNTIME_SEMANTIC_VERSION_P4_OPTIONAL_UNIT_CLOCK,
  DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN, DUEL_RUNTIME_SEMANTIC_VERSION_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN,
  DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY, DUEL_RUNTIME_SEMANTIC_VERSION_P4_OPTIONAL_UNIT_RESOLVED_HISTORY,
  type DuelRuntimeProfileP4,
  type DuelAuthoritativeRuntimeP4, type DuelAuthoritativeRuntimeP4Options,
} from './authoritative-runtime-p4.js';
import {
  JournalWriter,
  digestJournalValue,
  isJournalV1,
  replayJournal,
  type Journal,
  type JournalCommand,
  type JournalJsonObject,
} from './runtime/journal/index.js';

export {
  DUEL_RUNTIME_PROFILE_P4_LEGACY, DUEL_RUNTIME_PROFILE_P4_SPELL,
  DUEL_RUNTIME_PROFILE_P4_PUBLIC_CHAIN, DUEL_RUNTIME_PROFILE_P4_REGIONAL, DUEL_RUNTIME_SEMANTIC_VERSION_P4_REGIONAL, DUEL_RUNTIME_SEMANTIC_VERSION_P4,
  DUEL_RUNTIME_SEMANTIC_VERSION_P4_PUBLIC_CHAIN,
  DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT, DUEL_RUNTIME_SEMANTIC_VERSION_P4_OPTIONAL_UNIT,
  DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK, DUEL_RUNTIME_SEMANTIC_VERSION_P4_OPTIONAL_UNIT_CLOCK,
  DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN, DUEL_RUNTIME_SEMANTIC_VERSION_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN,
  DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY, DUEL_RUNTIME_SEMANTIC_VERSION_P4_OPTIONAL_UNIT_RESOLVED_HISTORY,
} from './authoritative-runtime-p4.js';
export type { DuelRuntimeProfileP4 } from './authoritative-runtime-p4.js';

/** Replay profile aliases are kept in this module because the archive gate is
 * the only public boundary at which a profile may be selected. */
export const DUEL_REPLAY_PROFILE_P4_LEGACY = DUEL_RUNTIME_PROFILE_P4_LEGACY;
export const DUEL_REPLAY_PROFILE_P4_SPELL = DUEL_RUNTIME_PROFILE_P4_SPELL;
export const DUEL_REPLAY_PROFILE_P4_PUBLIC_CHAIN = DUEL_RUNTIME_PROFILE_P4_PUBLIC_CHAIN;
export type DuelReplayProfileP4 = DuelRuntimeProfileP4;

type Entropy = { kind: 'random'; bound: number; value: number } | { kind: 'uid'; value: string };
type Observation = { readonly ack: unknown; readonly views: readonly unknown[]; readonly privateDigest: string };
type Operation = { readonly kind: 'dispatch'; readonly actor: string; readonly packet: DuelCommandMessageV3Actions1;
  readonly entropy: readonly Entropy[]; readonly observation: Observation } |
  { readonly kind: 'resume'; readonly entropy: readonly Entropy[]; readonly observation: Observation };
export interface DuelCommandArchiveP4 {
  readonly kind: 'private-duel-command-journal-p4'; readonly schemaVersion?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /** Audit date is metadata; v2 still hashes every effective policy decision. */
  readonly policyCheckedAt?: string;
  /** Schemas 3/4 are server-owned Spell/public-chain semantics and never an archive-selected downgrade. */
  readonly profile?: DuelReplayProfileP4;
  readonly semanticVersion?: string;
  readonly contextDigest: string; readonly creation: { readonly entropy: readonly Entropy[]; readonly observation: Observation };
  readonly operations: readonly Operation[];
  readonly header?: Journal['header'];
  readonly head?: Journal['head'];
  readonly entries?: Journal['entries'];
  readonly integrity?: Journal['integrity'];
  readonly journal?: Journal;
}
export interface DuelRecordedRuntimeP4 {
  readonly runtime: DuelAuthoritativeRuntimeP4;
  readonly profile: DuelReplayProfileP4;
  readonly archive: () => DuelCommandArchiveP4;
  /** Fresh actual owner replay, for an isolated mutation proposal. No shared linear capability. */
  readonly fork: () => DuelRecordedRuntimeP4;
}
export interface DuelReplayGateP4 { readonly _duelReplayGateP4: unique symbol }
const gates = new WeakMap<object, { options: DuelAuthoritativeRuntimeP4Options; digest: string; profile: DuelReplayProfileP4 | null }>();
const journals = new WeakMap<object, () => DuelCommandArchiveP4>();
const finishLegacyReplay = new WeakMap<object, () => void>();
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new TypeError(`P4 journal: ${message}`); }

/** Accept only ordinary JSON data; do not invoke accessors, toJSON or coercion. */
function data(value: unknown, depth = 0): any {
  check(depth < 48, 'data nesting limit');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') { check(Number.isFinite(value), 'finite JSON number'); return value; }
  if (Array.isArray(value)) {
    check(Object.getPrototypeOf(value) === Array.prototype && Reflect.ownKeys(value).length === value.length + 1, 'dense data list');
    return Array.from({ length: value.length }, (_, i) => {
      const d = Object.getOwnPropertyDescriptor(value, String(i)); check(d && 'value' in d, 'data list item');
      return data(d.value, depth + 1);
    });
  }
  check(value && typeof value === 'object' &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'ordinary JSON object');
  const result: Record<string, unknown> = Object.create(null);
  const keys = Reflect.ownKeys(value);
  check(keys.every(key => typeof key === 'string'), 'JSON key');
  for (const key of (keys as string[]).sort()) {
    check(typeof key === 'string', 'JSON key');
    const d = Object.getOwnPropertyDescriptor(value, key); check(d && d.enumerable && 'value' in d, 'JSON data property');
    // Optional undefined is omitted when internal snapshots are encoded, as in JSON.
    if (d.value !== undefined) result[key] = data(d.value, depth + 1);
  }
  return result;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
export function digestDuelCommandArchiveP4(archive: DuelCommandArchiveP4): string {
  if (isUnifiedP4Archive(archive)) {
    const { operations: _legacyOperations, ...protectedArchive } = archive;
    return createHash('sha256').update(JSON.stringify(data(protectedArchive))).digest('hex');
  }
  return createHash('sha256').update(JSON.stringify(data(archive))).digest('hex');
}
function contextData(options: DuelAuthoritativeRuntimeP4Options, profile: DuelReplayProfileP4 = DUEL_REPLAY_PROFILE_P4_LEGACY): any {
  const catalog = options.catalog;
  const base = { matchId: options.matchId, roster: options.roster,
    catalog: catalog.publicCatalog, validationCards: catalog.validationCards,
    deckRules: catalog.deckRules, constructedRules: { rules: catalog.constructedRules.rules,
      policy: catalog.constructedRules.policy, identityMetadata: {
        byCardId: [...catalog.constructedRules.identityMetadata.byCardId].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
        knownChampionTags: [...catalog.constructedRules.identityMetadata.knownChampionTags].sort(),
      } },
    rules: 'CR-1.4', profile: 'duel-command-v3-actions-1' };
  // The old context hash is intentionally byte-for-byte stable. New semantics
  // are admitted only by schema 3/4 and carry their own version.
  if (profile === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY)
    return data({ ...base, runtimeProfile: profile,
      runtimeSemanticVersion: DUEL_RUNTIME_SEMANTIC_VERSION_P4_OPTIONAL_UNIT_RESOLVED_HISTORY,
      ...(options.constructedRegion ? { constructedRegion: options.constructedRegion } : {}) });
  if (profile === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN)
    return data({ ...base, runtimeProfile: profile,
      runtimeSemanticVersion: DUEL_RUNTIME_SEMANTIC_VERSION_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN,
      ...(options.constructedRegion ? { constructedRegion: options.constructedRegion } : {}) });
  if (profile === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK)
    return data({ ...base, runtimeProfile: profile,
      runtimeSemanticVersion: DUEL_RUNTIME_SEMANTIC_VERSION_P4_OPTIONAL_UNIT_CLOCK,
      ...(options.constructedRegion ? { constructedRegion: options.constructedRegion } : {}) });
  if (profile === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT)
    return data({ ...base, runtimeProfile: profile,
      runtimeSemanticVersion: DUEL_RUNTIME_SEMANTIC_VERSION_P4_OPTIONAL_UNIT,
      ...(options.constructedRegion ? { constructedRegion: options.constructedRegion } : {}) });
  if (profile === DUEL_RUNTIME_PROFILE_P4_REGIONAL)
    return data({...base, runtimeProfile:profile,runtimeSemanticVersion:DUEL_RUNTIME_SEMANTIC_VERSION_P4_REGIONAL,
      constructedRegion:options.constructedRegion});
  return profile === DUEL_REPLAY_PROFILE_P4_SPELL || profile === DUEL_REPLAY_PROFILE_P4_PUBLIC_CHAIN
    ? data({ ...base, runtimeProfile: profile,
      runtimeSemanticVersion: profile === DUEL_REPLAY_PROFILE_P4_PUBLIC_CHAIN
        ? DUEL_RUNTIME_SEMANTIC_VERSION_P4_PUBLIC_CHAIN : DUEL_RUNTIME_SEMANTIC_VERSION_P4 })
    : data(base);
}
function isoDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function policyDay(options: DuelAuthoritativeRuntimeP4Options): string {
  const value = data(options.catalog.constructedRules.policy).checkedAt;
  check(isoDay(value) && data(options.catalog.publicCatalog.policy).checkedAt === value,
    'consistent policy audit date required');
  return value;
}
function contextDigest(options: DuelAuthoritativeRuntimeP4Options,
  profile: DuelReplayProfileP4 = DUEL_REPLAY_PROFILE_P4_LEGACY): string {
  policyDay(options);
  const context = contextData(options, profile);
  delete context.catalog.policy.checkedAt;
  delete context.constructedRules.policy.checkedAt;
  return digestDuelCommandArchiveP4(context);
}
/** Schema 1 omitted its audit date. Recover ONLY that metadata by checking the
 * original hash; never recompute historical availability, bans, stats or rules.
 * The independent archive digest is checked before this compatibility path. */
function legacyPolicyDay(options: DuelAuthoritativeRuntimeP4Options, expectedContext: string): string | null {
  const context = contextData(options), currentDay = policyDay(options);
  if (digestDuelCommandArchiveP4(context) === expectedContext) return currentDay;
  const firstDay = options.catalog.publicCatalog.dataVersion.slice(0, 10);
  if (!isoDay(firstDay) || context.catalog.policy.checkedAt !== currentDay ||
      context.constructedRules.policy.checkedAt !== currentDay) return null;
  const first = Date.parse(firstDay), last = Date.parse(currentDay), day = 86_400_000;
  // Bound legacy work from the independently loaded source snapshot date.
  // A changed or unsupported semantic context stays rejected.
  if (first > last || (last - first) / day > 3660) return null;
  for (let time = first; time < last; time += day) {
    const candidate = new Date(time).toISOString().slice(0, 10);
    context.catalog.policy.checkedAt = candidate;
    context.constructedRules.policy.checkedAt = candidate;
    if (digestDuelCommandArchiveP4(context) === expectedContext) return candidate;
  }
  return null;
}
function observe(owner: DuelAuthoritativeRuntimeP4, options: DuelAuthoritativeRuntimeP4Options, ack: unknown): Observation {
  return freeze(data({ ack, views: [owner.project(options.roster[0].playerId), owner.project(options.roster[1].playerId), owner.project(null)],
    privateDigest: fingerprintDuelAuthoritativeRuntimePrivateP4(owner) }));
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(data(a)) === JSON.stringify(data(b)); }

function p4Clock(observation: Observation): { stateVersion: number; eventSeq: number; roomVersion: number } {
  const view = observation.views.at(-1) as { match?: { stateVersion?: number; eventSeq?: number } } | undefined;
  return { stateVersion: Number.isSafeInteger(view?.match?.stateVersion) ? view!.match!.stateVersion! : 0,
    eventSeq: Number.isSafeInteger(view?.match?.eventSeq) ? view!.match!.eventSeq! : 0, roomVersion: 0 };
}

function p4JournalCommand(packet: DuelCommandMessageV3Actions1): JournalCommand {
  const command = packet.command as Record<string, unknown>;
  switch (command.type) {
    case 'pass-priority':
    case 'pass-focus':
    case 'end-turn':
      return { type: 'pass' };
    case 'concede':
      return { type: 'concede' };
    case 'play-card':
      return { type: 'play-card', instanceId: String(command.cardUID), targets: [] };
    case 'answer-pending-choice': {
      const answers = Array.isArray(command.answers) ? command.answers as readonly Record<string, unknown>[] : [];
      const first = answers[0];
      const promptId = typeof first?.promptId === 'string' ? first.promptId : String(command.choiceId);
      const optionIds = Array.isArray(first?.optionIds) ? first.optionIds as readonly unknown[] : [];
      return { type: 'respond-to-prompt', promptId, optionId: String(optionIds[0] ?? command.choiceId), targets: [] };
    }
    default:
      return { type: 'respond-to-prompt', promptId: String(command.windowId ?? command.choiceId ?? command.type),
        optionId: String(command.type), targets: [] };
  }
}

function p4ProjectionDigests(observation: Observation, seats: readonly { playerId: string }[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [index, seat] of seats.entries()) {
    if (observation.views[index] !== undefined) result[seat.playerId] = digestJournalValue(observation.views[index]);
  }
  const publicView = observation.views.at(-1);
  if (publicView !== undefined) result.public = digestJournalValue(publicView);
  return result;
}

function unifiedP4Journal(legacy: DuelCommandArchiveP4, options: DuelAuthoritativeRuntimeP4Options): Journal {
  const creationClock = p4Clock(legacy.creation.observation);
  const writer = new JournalWriter({
    header: {
      engineVersion: 'riftbound-game-server:p4-current', matchId: options.matchId, roomId: options.matchId,
      catalogDigest: options.catalog.publicCatalog.digest,
      rosterDigest: digestJournalValue(options.roster.map(seat => ({ playerId: seat.playerId, name: seat.displayName }))),
      trustedDeckDigest: digestJournalValue(options.roster.map(seat => seat.deck)), seed: digestJournalValue([options.matchId, options.catalog.publicCatalog.digest]),
      seats: options.roster.map(seat => ({ playerId: seat.playerId, name: seat.displayName })),
      creation: { entropy: legacy.creation.entropy, deterministicSeed: digestJournalValue([options.matchId, options.catalog.publicCatalog.digest]),
        uidSeed: legacy.creation.entropy.find(item => item.kind === 'uid')?.value ?? null, creator: 'game-server' },
    },
    ...creationClock, stateDigest: digestJournalValue(legacy.creation.observation.views.at(-1)),
    privateStateDigest: digestJournalValue(legacy.creation.observation.views),
  });
  let state = creationClock;
  let operationOrdinal = 0;
  for (const operation of legacy.operations) {
    const clock = p4Clock(operation.observation);
    const captured = operation.observation.ack as Record<string, unknown> | null;
    const ack = captured && data(captured.ack) ? captured.ack as Record<string, unknown> : captured;
    if (operation.kind === 'dispatch' && ack && ack.type !== 'error' && ack.type !== 'blocked' &&
        Number.isSafeInteger(ack.appliedVersion) && ((ack.appliedVersion as number) > state.stateVersion || ack.duplicate === true)) {
      const result: JournalJsonObject = { accepted: true, ack: data(ack) as JournalJsonObject,
        legacyPacket: data(operation.packet) as JournalJsonObject };
      writer.recordCommand({ playerId: operation.actor, actor: operation.actor, requestId: operation.packet.requestId,
        commandId: operation.packet.commandId, command: p4JournalCommand(operation.packet), payload: p4JournalCommand(operation.packet),
        expectedStateVersion: operation.packet.expectedVersion, appliedStateVersion: clock.stateVersion,
        eventSeq: clock.eventSeq, roomVersion: clock.roomVersion,
        result, publicReceipt: { accepted: true, ack: data(ack) as JournalJsonObject }, duplicate: ack.duplicate === true,
        entropyConsumed: operation.entropy, projectionDigestByViewer: p4ProjectionDigests(operation.observation, options.roster),
        state: { ...clock, stateDigest: digestJournalValue(operation.observation.views.at(-1)),
          privateStateDigest: digestJournalValue(operation.observation.views) },
        acceptedAt: new Date(0).toISOString() });
    } else if (operation.kind === 'resume' || (operation.kind === 'dispatch' && ack?.type === 'blocked')) {
      const operationId = `p4:operation:${++operationOrdinal}`;
      writer.recordOperation({ operationId, taskId: operation.kind === 'resume' ? 'resume' : `command:${operation.packet.commandId}`,
        phase: operation.kind === 'resume' ? 'resume' : 'dispatch', stateVersion: clock.stateVersion, eventSeq: clock.eventSeq,
        sourceClosureEvidence: [], costCensus: null, paymentPlan: null, paymentReceipt: null, effectIRDigest: null,
        primitiveReceipts: operation.kind === 'dispatch' && ack ? [{ type: 'legacy-dispatch', actor: operation.actor,
          packet: data(operation.packet) as JournalJsonObject, ack: data(ack) as JournalJsonObject }] : [],
        tokenBirths: [], tokenRetirements: [], zoneTransitions: [],
        pendingReason: ack?.type === 'blocked' || ack?.pending === true ? 'pending' : null, entropyConsumed: operation.entropy,
        state: { ...clock, stateDigest: digestJournalValue(operation.observation.views.at(-1)),
          privateStateDigest: digestJournalValue(operation.observation.views) } });
    }
    state = clock;
  }
  return writer.snapshot();
}

function isUnifiedP4Archive(value: unknown): value is DuelCommandArchiveP4 & Journal {
  if (!value || typeof value !== 'object' || !('header' in value) || !('head' in value) ||
      !('entries' in value) || !('integrity' in value)) return false;
  const candidate = value as DuelCommandArchiveP4 & Journal;
  return isJournalV1(candidate.journal ?? { header: candidate.header!, head: candidate.head!, entries: candidate.entries!, integrity: candidate.integrity! });
}

function toUnifiedP4Archive(legacy: DuelCommandArchiveP4, options: DuelAuthoritativeRuntimeP4Options): DuelCommandArchiveP4 {
  const journal = unifiedP4Journal(legacy, options);
  return freeze({ ...legacy, header: journal.header, head: journal.head, entries: journal.entries, integrity: journal.integrity, journal,
    kind: 'private-duel-command-journal-p4' }) as DuelCommandArchiveP4;
}

export type DuelReplayProfileSelectionP4 = DuelReplayProfileP4 | {
  readonly profile?: DuelReplayProfileP4;
  readonly runtimeProfile?: DuelReplayProfileP4;
};
function selectedProfile(options: DuelAuthoritativeRuntimeP4Options,
  requested?: DuelReplayProfileSelectionP4): DuelReplayProfileP4 {
  const value = requested === undefined ? options.runtimeProfile ?? DUEL_REPLAY_PROFILE_P4_PUBLIC_CHAIN
    : typeof requested === 'string' ? requested : requested.profile ?? requested.runtimeProfile;
  check(value === DUEL_REPLAY_PROFILE_P4_LEGACY || value === DUEL_REPLAY_PROFILE_P4_SPELL || value === DUEL_REPLAY_PROFILE_P4_PUBLIC_CHAIN || value === DUEL_RUNTIME_PROFILE_P4_REGIONAL || value === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT || value === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK || value === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN || value === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY,
    'unknown server-owned recording profile');
  return value;
}
export function createDuelRecordedRuntimeP4(options: DuelAuthoritativeRuntimeP4Options,
  requestedProfile?: DuelReplayProfileSelectionP4): DuelRecordedRuntimeP4 {
  const profile = selectedProfile(options, requestedProfile);
  return createRecorded({ ...options, runtimeProfile: profile }, policyDay(options), profile);
}
function createRecorded(options: DuelAuthoritativeRuntimeP4Options, policyCheckedAt: string,
  profile: DuelReplayProfileP4, legacyReplay = false): DuelRecordedRuntimeP4 {
  check(!options.globalJournal, 'external mutable source callbacks require a separate replay contract');
  const initialContext = contextDigest(options, profile);
  let trace: Entropy[] | null = [];
  const creationTrace = trace;
  const owner = createAuthoritativeDuelRuntimeP4({ ...options, runtimeProfile: profile,
    randomIndex: bound => {
      check(trace, 'read-only operation consumed randomness');
      const value = options.randomIndex(bound);
      check(Number.isSafeInteger(value) && value >= 0 && value < bound, 'random result range');
      trace.push({ kind: 'random', bound, value }); return value;
    }, uidFactory: () => {
      check(trace, 'read-only operation allocated a UID');
      const value = (options.uidFactory ?? randomUUID)();
      check(typeof value === 'string' && value.length > 0, 'UID result'); trace.push({ kind: 'uid', value }); return value;
    } });
  trace = null;
  const creation = freeze({ entropy: freeze(creationTrace), observation: observe(owner, options, null) });
  const operations: Operation[] = [];
  let busy = false, failed = false, recordLegacyNullResume = legacyReplay;
  const capture = (operation: () => unknown, base: { kind: 'dispatch'; actor: string; packet: DuelCommandMessageV3Actions1 } | { kind: 'resume' }) => {
    check(!busy && !failed, 'unavailable recorder'); busy = true; trace = [];
    try {
      check(contextDigest(options, profile) === initialContext, 'catalog/roster changed');
      const before = base.kind === 'resume' ? observe(owner, options, null) : null;
      const result = operation(), entropy = trace;
      trace = null;
      check(contextDigest(options, profile) === initialContext, 'catalog/roster changed during operation');
      const observation = observe(owner, options, result);
      if (base.kind === 'resume' && result === null) {
        check(entropy?.length === 0 && same(before, observation), 'null resume changed owner state or entropy');
        if (!recordLegacyNullResume) return result;
      }
      operations.push(freeze(data({ ...base, entropy, observation })));
      return result;
    } catch (error) { failed = true; throw error; }
    finally { busy = false; trace = null; }
  };
  const runtime: DuelAuthoritativeRuntimeP4 = Object.freeze({ durability: 'in-memory',
    project: (viewer: string | null) => { check(!busy && !failed, 'unavailable recorder'); return owner.project(viewer); },
    dispatch: (actor: string, raw: unknown) => {
      check(isDuelCommandMessageV3Actions1(raw), 'typed P4 packet required');
      const packet = data(raw) as DuelCommandMessageV3Actions1;
      return capture(() => owner.dispatch(actor, packet), { kind: 'dispatch', actor, packet }) as ReturnType<DuelAuthoritativeRuntimeP4['dispatch']>;
    }, resumePending: () => capture(() => owner.resumePending(), { kind: 'resume' }) as ReturnType<DuelAuthoritativeRuntimeP4['resumePending']>,
  });
  const archive = () => {
    const legacy = freeze(data(profile === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY
    ? { kind: 'private-duel-command-journal-p4', schemaVersion: 9,
      profile: DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY, semanticVersion: DUEL_RUNTIME_SEMANTIC_VERSION_P4_OPTIONAL_UNIT_RESOLVED_HISTORY,
      policyCheckedAt, contextDigest: initialContext, creation, operations }
    : profile === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN
    ? { kind: 'private-duel-command-journal-p4', schemaVersion: 8,
      profile: DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN,
      semanticVersion: DUEL_RUNTIME_SEMANTIC_VERSION_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN,
      policyCheckedAt, contextDigest: initialContext, creation, operations }
    : profile === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK
    ? { kind: 'private-duel-command-journal-p4', schemaVersion: 7,
      profile: DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK,
      semanticVersion: DUEL_RUNTIME_SEMANTIC_VERSION_P4_OPTIONAL_UNIT_CLOCK,
      policyCheckedAt, contextDigest: initialContext, creation, operations }
    : profile === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT
    ? { kind: 'private-duel-command-journal-p4', schemaVersion: 6,
      profile: DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT, semanticVersion: DUEL_RUNTIME_SEMANTIC_VERSION_P4_OPTIONAL_UNIT,
      policyCheckedAt, contextDigest: initialContext, creation, operations }
    : profile === DUEL_RUNTIME_PROFILE_P4_REGIONAL
    ? {kind:'private-duel-command-journal-p4',schemaVersion:5,
      profile:DUEL_RUNTIME_PROFILE_P4_REGIONAL,semanticVersion:DUEL_RUNTIME_SEMANTIC_VERSION_P4_REGIONAL,
      policyCheckedAt,contextDigest:initialContext,creation,operations}
    : profile === DUEL_REPLAY_PROFILE_P4_PUBLIC_CHAIN
    ? { kind: 'private-duel-command-journal-p4', schemaVersion: 4,
      profile: DUEL_REPLAY_PROFILE_P4_PUBLIC_CHAIN, semanticVersion: DUEL_RUNTIME_SEMANTIC_VERSION_P4_PUBLIC_CHAIN,
      policyCheckedAt, contextDigest: initialContext, creation, operations }
    : profile === DUEL_REPLAY_PROFILE_P4_SPELL
    ? { kind: 'private-duel-command-journal-p4', schemaVersion: 3,
      profile: DUEL_RUNTIME_PROFILE_P4_SPELL, semanticVersion: DUEL_RUNTIME_SEMANTIC_VERSION_P4,
      policyCheckedAt, contextDigest: initialContext, creation, operations }
    : { kind: 'private-duel-command-journal-p4', schemaVersion: 2,
      policyCheckedAt, contextDigest: initialContext, creation, operations })) as DuelCommandArchiveP4;
    return toUnifiedP4Archive(legacy, options);
  };
  const recorded: DuelRecordedRuntimeP4 = Object.freeze({ profile, runtime, archive: () => { check(!busy && !failed, 'unavailable recorder'); return archive(); },
    fork: () => {
      check(!busy && !failed, 'unavailable recorder');
      const snapshot = archive();
      return replayDuelCommandArchiveP4(snapshot, createDuelReplayGateP4(options,
        digestDuelCommandArchiveP4(snapshot), profile));
    } });
  journals.set(recorded, archive);
  finishLegacyReplay.set(recorded, () => { recordLegacyNullResume = false; });
  return recorded;
}

/** expectedDigest must come from the live journal or trusted protected
 * storage head, independently of the archive presented to this function. */
function gateProfile(value: DuelReplayProfileSelectionP4 | undefined): DuelReplayProfileP4 | null {
  if (value === undefined) return null;
  const profile = typeof value === 'string' ? value : value.profile ?? value.runtimeProfile;
  check(profile === DUEL_REPLAY_PROFILE_P4_LEGACY || profile === DUEL_REPLAY_PROFILE_P4_SPELL || profile === DUEL_REPLAY_PROFILE_P4_PUBLIC_CHAIN || profile === DUEL_RUNTIME_PROFILE_P4_REGIONAL || profile === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT || profile === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK || profile === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN || profile === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY,
    'unknown replay profile');
  return profile;
}
export function createDuelReplayGateP4(options: DuelAuthoritativeRuntimeP4Options, expectedDigest: string,
  selectedProfile?: DuelReplayProfileSelectionP4): DuelReplayGateP4 {
  check(typeof expectedDigest === 'string' && /^[0-9a-f]{64}$/.test(expectedDigest), 'protected expected digest required');
  const gate = Object.freeze({}) as DuelReplayGateP4;
  // A live server-created owner already carries its trusted profile.  Legacy
  // archives still require an explicit third argument because their bytes do
  // not carry a profile and must never select a downgrade implicitly.
  gates.set(gate, { options, digest: expectedDigest,
    profile: gateProfile(selectedProfile) ?? options.runtimeProfile ?? DUEL_REPLAY_PROFILE_P4_PUBLIC_CHAIN }); return gate;
}
export function replayDuelCommandArchiveP4(raw: unknown, gate: DuelReplayGateP4): DuelRecordedRuntimeP4 {
  const admitted = gates.get(gate); check(admitted, 'unadmitted replay gate');
  const archive = data(raw) as DuelCommandArchiveP4;
  if (isUnifiedP4Archive(archive)) return replayUnifiedP4Archive(archive, admitted);
  check(false, 'legacy replay requires the legacy-replay-e2cbcdf implementation');
}

function replayUnifiedP4Archive(archive: DuelCommandArchiveP4 & Journal,
  admitted: { options: DuelAuthoritativeRuntimeP4Options; digest: string; profile: DuelReplayProfileP4 | null }): DuelRecordedRuntimeP4 {
  check(digestDuelCommandArchiveP4(archive) === admitted.digest, 'journal digest mismatch');
  const journal = archive.journal ?? { header: archive.header, head: archive.head, entries: archive.entries, integrity: archive.integrity };
  check(isJournalV1(journal), 'journal v1 integrity required');
  const archivedProfile = archive.profile ?? (archive.schemaVersion === 3 ? DUEL_REPLAY_PROFILE_P4_SPELL
    : archive.schemaVersion === 4 ? DUEL_REPLAY_PROFILE_P4_PUBLIC_CHAIN
      : archive.schemaVersion === 5 ? DUEL_RUNTIME_PROFILE_P4_REGIONAL
        : archive.schemaVersion === 6 ? DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT
          : archive.schemaVersion === 7 ? DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK
            : archive.schemaVersion === 8 ? DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN
              : archive.schemaVersion === 9 ? DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY : null);
  check(archivedProfile === null || admitted.profile === archivedProfile, 'profile mismatch');
  const profile = admitted.profile ?? admitted.options.runtimeProfile ?? DUEL_REPLAY_PROFILE_P4_PUBLIC_CHAIN;
  // Journal integrity and identical projections do not bind the event region,
  // date or source policy. Recompute their context from the trusted gate before
  // replay; only the catalog's audit checkedAt metadata is excluded by design.
  check(archive.contextDigest === contextDigest(admitted.options, profile), 'archive/context digest mismatch');
  const creation = archive.creation;
  let expected: readonly Entropy[] = creation.entropy, cursor = 0, live = false;
  const take = (kind: Entropy['kind'], bound?: number) => {
    const next = expected[cursor++];
    check(next?.kind === kind && (kind !== 'random' || next.kind === 'random' && next.bound === bound), 'entropy ordering mismatch');
    return next.value;
  };
  const recorded = createRecorded({ ...admitted.options, runtimeProfile: profile,
    randomIndex: bound => live ? admitted.options.randomIndex(bound) : take('random', bound) as number,
    uidFactory: () => live ? (admitted.options.uidFactory ?? randomUUID)() : take('uid') as string },
    policyDay(admitted.options), profile, true);
  check(same(recorded.archive().creation, creation), 'creation/private state mismatch');
  const replayCommand = (_state: unknown, entry: Journal['entries'][number] & { kind: 'entry' }) => {
    const result = data(entry.result) as Record<string, unknown>;
    const packet = result.legacyPacket;
    check(isDuelCommandMessageV3Actions1(packet), 'command entry is missing its P4 packet');
    expected = entry.entropyConsumed; cursor = 0;
    const actual = recorded.runtime.dispatch(entry.actor, data(packet) as DuelCommandMessageV3Actions1);
    const actualAck = data(actual.ack) as Record<string, unknown>;
    const expectedAck = data(result.ack);
    if (entry.duplicate && actualAck.duplicate === true) delete actualAck.duplicate;
    check(same(actualAck, expectedAck), 'command receipt drift');
    check(cursor === expected.length, 'unused entropy');
    const projected = recorded.runtime.project(null).match;
    check(projected.stateVersion === entry.appliedStateVersion && projected.eventSeq === entry.eventSeq,
      'command clock drift');
    return _state;
  };
  replayJournal(journal, {
    engineVersion: 'riftbound-game-server:p4-current',
    applyCommand: replayCommand,
    applyDuplicateCommand: replayCommand,
    applyOperation: (_state, operation) => {
      expected = operation.entropyConsumed; cursor = 0;
      if (operation.phase === 'resume') {
        recorded.runtime.resumePending();
      } else if (operation.phase === 'dispatch') {
        const receipt = operation.primitiveReceipts.find(item => item.type === 'legacy-dispatch');
        check(receipt !== undefined && typeof receipt.actor === 'string' && isDuelCommandMessageV3Actions1(receipt.packet),
          'pending dispatch packet is missing');
        const actual = recorded.runtime.dispatch(receipt.actor, data(receipt.packet) as DuelCommandMessageV3Actions1);
        check(same(actual.ack, receipt.ack), 'pending dispatch receipt drift');
      }
      check(cursor === expected.length, 'unused entropy');
      return _state;
    },
  });
  const publicProjection = recorded.runtime.project(null);
  check(digestJournalValue(publicProjection) === journal.head.stateDigest, 'replayed public state digest drift');
  finishLegacyReplay.get(recorded)!();
  live = true;
  return recorded;
}
