import { createHash } from "node:crypto";
import {
  canonicalJournalJson,
  computeJournalDigest,
  computeJournalHeaderDigest,
  computeJournalRecordDigest,
  createJournalRecordIntegrity,
  isJournal,
  isJournalEntry,
  isJournalOperation,
  serializeJournalJsonl,
  type Journal,
  type JournalCommand,
  type JournalEntropy,
  type JournalEntry,
  type JournalEntry as JournalEntryRecord,
  type JournalHeader,
  type JournalJsonObject,
  type JournalJsonValue,
  type JournalOperation,
  type JournalRecord,
  type JournalRecordInput,
  type SeatInfo,
} from "@riftbound/protocol";

export type { Journal, JournalCommand, JournalEntropy, JournalEntry, JournalHeader, JournalJsonObject,
  JournalJsonValue, JournalOperation, JournalRecord, JournalRecordInput };

export const JOURNAL_ENGINE_VERSION = "@riftbound/engine-core/current" as const;

export interface JournalStateSnapshot {
  readonly stateVersion?: number;
  readonly eventSeq?: number;
  readonly roomVersion?: number;
  readonly stateDigest?: string;
  readonly privateStateDigest?: string;
}

export interface JournalWriterHeaderInput {
  readonly engineVersion?: string;
  readonly matchId: string;
  readonly roomId?: string;
  readonly catalogDigest: string;
  readonly rosterDigest?: string;
  readonly trustedDeckDigest?: string;
  readonly seed?: string;
  readonly seats: readonly SeatInfo[];
  readonly createdAt?: string;
  readonly creation?: {
    readonly entropy?: readonly JournalEntropy[];
    readonly deterministicSeed?: string;
    readonly uidSeed?: string | null;
    readonly creator?: string;
  };
}

export interface JournalCommandInput {
  readonly playerId: string;
  readonly actor?: string;
  readonly requestId: string;
  readonly commandId: string;
  readonly command: JournalCommand;
  readonly payload?: JournalCommand;
  readonly acceptedAt?: string;
  readonly expectedStateVersion?: number;
  readonly expectedRoomVersion?: number;
  readonly appliedStateVersion?: number;
  readonly roomVersion?: number;
  readonly eventSeq?: number;
  readonly result?: JournalJsonObject;
  readonly publicReceipt?: JournalJsonObject;
  readonly duplicate?: boolean;
  readonly rejection?: null;
  readonly entropyConsumed?: readonly JournalEntropy[];
  readonly projectionDigestByViewer?: Readonly<Record<string, string>>;
  readonly state?: JournalStateSnapshot;
}

export interface JournalOperationInput {
  readonly operationId: string;
  readonly taskId: string;
  readonly phase: string;
  readonly stateVersion?: number;
  readonly eventSeq?: number;
  readonly roomVersion?: number;
  readonly sourceClosureEvidence?: readonly JournalJsonObject[];
  readonly costCensus?: JournalJsonObject | null;
  readonly paymentPlan?: JournalJsonObject | null;
  readonly paymentReceipt?: JournalJsonObject | null;
  readonly effectIRDigest?: string | null;
  readonly primitiveReceipts?: readonly JournalJsonObject[];
  readonly tokenBirths?: readonly JournalJsonObject[];
  readonly tokenRetirements?: readonly JournalJsonObject[];
  readonly zoneTransitions?: readonly JournalJsonObject[];
  readonly pendingReason?: string | null;
  readonly entropyConsumed?: readonly JournalEntropy[];
  readonly state?: JournalStateSnapshot;
}

export interface JournalWriterOptions extends JournalStateSnapshot {
  readonly header: JournalWriterHeaderInput;
  readonly parentJournalDigest?: string | null;
  readonly nonce?: string;
}

export class JournalWriterError extends TypeError {
  constructor(detail: string) {
    super(`Journal v1 writer: ${detail}`);
    this.name = "JournalWriterError";
  }
}

function fail(detail: string): never {
  throw new JournalWriterError(detail);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    return fail(`${field} must be a nonblank string`);
  }
  return value;
}

function count(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return fail(`${field} must be a safe counter`);
  return value as number;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(canonicalJournalJson(value)) as T;
}

function cloneEntropy(value: readonly JournalEntropy[] | undefined): JournalEntropy[] {
  return cloneJson(value ?? []) as JournalEntropy[];
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalJournalJson(value), "utf8").digest("hex");
}

export function digestJournalValue(value: unknown): string {
  return hash(value);
}

function digestOrHash(value: string | undefined, fallback: unknown): string {
  return value !== undefined && /^[0-9a-f]{64}$/u.test(value) ? value : hash(fallback);
}

function initialHeader(input: JournalWriterHeaderInput): JournalHeader {
  const seed = text(input.seed ?? hash([input.matchId, input.catalogDigest]), "seed");
  const creation = input.creation ?? {};
  const seats = input.seats.map(seat => ({ playerId: text(seat.playerId, "seat.playerId"), name: text(seat.name, "seat.name") }));
  if (seats.length === 0 || new Set(seats.map(seat => seat.playerId)).size !== seats.length) {
    fail("header seats must be nonempty and unique");
  }
  return {
    format: "riftbound-journal",
    formatVersion: 1,
    engineVersion: text(input.engineVersion ?? JOURNAL_ENGINE_VERSION, "engineVersion"),
    rulesetVersion: "core-1.5",
    matchId: text(input.matchId, "matchId"),
    roomId: text(input.roomId ?? input.matchId, "roomId"),
    catalogDigest: text(input.catalogDigest, "catalogDigest"),
    rosterDigest: text(input.rosterDigest ?? hash(seats), "rosterDigest"),
    trustedDeckDigest: text(input.trustedDeckDigest ?? hash(seats), "trustedDeckDigest"),
    seed,
    seats,
    createdAt: text(input.createdAt ?? new Date(0).toISOString(), "createdAt"),
    creation: {
      entropy: cloneEntropy(creation.entropy),
      deterministicSeed: text(creation.deterministicSeed ?? seed, "creation.deterministicSeed"),
      uidSeed: creation.uidSeed === undefined || creation.uidSeed === null ? null : text(creation.uidSeed, "creation.uidSeed"),
      creator: text(creation.creator ?? "game-server", "creation.creator"),
    },
  };
}

function stateOf(snapshot: JournalStateSnapshot | undefined, fallback: JournalStateSnapshot): Required<JournalStateSnapshot> {
  return {
    stateVersion: count(snapshot?.stateVersion ?? fallback.stateVersion ?? 0, "stateVersion"),
    eventSeq: count(snapshot?.eventSeq ?? fallback.eventSeq ?? 0, "eventSeq"),
    roomVersion: count(snapshot?.roomVersion ?? fallback.roomVersion ?? 0, "roomVersion"),
    stateDigest: digestOrHash(snapshot?.stateDigest, ["state", snapshot?.stateVersion ?? fallback.stateVersion ?? 0]),
    privateStateDigest: digestOrHash(snapshot?.privateStateDigest, ["private", snapshot?.stateVersion ?? fallback.stateVersion ?? 0]),
  };
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && "value" in descriptor) freezeDeep(descriptor.value);
    }
    Object.freeze(value);
  }
  return value;
}

function zeroDigest(): string {
  return "0".repeat(64);
}

function createInitialJournal(options: JournalWriterOptions): Journal {
  const header = initialHeader(options.header);
  const state = stateOf(options, options);
  const nonce = text(options.nonce ?? hash([header.matchId, header.seed]), "nonce");
  const head = {
    stateVersion: state.stateVersion,
    eventSeq: state.eventSeq,
    roomVersion: state.roomVersion,
    parentJournalDigest: options.parentJournalDigest ?? null,
    journalDigest: zeroDigest(),
    stateDigest: state.stateDigest,
    privateStateDigest: state.privateStateDigest,
  };
  const integrity = {
    parentDigest: options.parentJournalDigest ?? null,
    currentDigest: zeroDigest(),
    revision: 0,
    nonce,
    protectedHeadReference: { revision: 0, nonce },
  };
  const journal = { header, head, entries: [], integrity } as Journal;
  const currentDigest = computeJournalDigest(journal);
  journal.head = { ...head, journalDigest: currentDigest };
  journal.integrity = { ...integrity, currentDigest };
  if (!isJournal(journal)) fail("initial journal does not satisfy protocol validation");
  return journal;
}

function commandKey(entry: JournalEntryRecord): string {
  return entry.commandId;
}

function lastState(journal: Journal): Required<JournalStateSnapshot> {
  return journal.head;
}

export class JournalWriter {
  private journal: Journal;
  private readonly commandEntries = new Map<string, JournalEntry>();
  private readonly operationIds = new Set<string>();

  constructor(options: JournalWriterOptions | Journal) {
    this.journal = isJournal(options) ? cloneJson(options) : createInitialJournal(options);
    for (const record of this.journal.entries) {
      if (record.kind === "entry") {
        if (!record.duplicate) this.commandEntries.set(commandKey(record), record);
      } else {
        this.operationIds.add(record.operationId);
      }
    }
  }

  get header(): JournalHeader { return this.journal.header; }
  get head(): Journal["head"] { return this.journal.head; }
  get size(): number { return this.journal.entries.length; }

  recordCommand(input: JournalCommandInput): JournalEntry {
    const actor = text(input.actor ?? input.playerId, "actor");
    const playerId = text(input.playerId, "playerId");
    const commandId = text(input.commandId, "commandId");
    const requestId = text(input.requestId, "requestId");
    const prior = this.commandEntries.get(commandId);
    if (prior) {
      if (canonicalJournalJson(prior.command) !== canonicalJournalJson(input.command) ||
          prior.playerId !== playerId || prior.actor !== actor ||
          prior.expectedStateVersion !== (input.expectedStateVersion ?? prior.expectedStateVersion) ||
          prior.expectedRoomVersion !== (input.expectedRoomVersion ?? prior.expectedRoomVersion)) {
        fail(`commandId conflict: ${commandId}`);
      }
      return this.appendCommand({
        kind: "entry", seq: this.journal.entries.length + 1, playerId, actor, requestId, commandId,
        command: cloneJson(prior.command), payload: cloneJson(prior.payload), acceptedAt: input.acceptedAt ?? prior.acceptedAt,
        expectedStateVersion: prior.expectedStateVersion, expectedRoomVersion: prior.expectedRoomVersion,
        appliedStateVersion: this.journal.head.stateVersion, roomVersion: this.journal.head.roomVersion,
        eventSeq: this.journal.head.eventSeq, result: cloneJson(prior.result), publicReceipt: cloneJson(prior.publicReceipt),
        duplicate: true, rejection: null, entropyConsumed: [], projectionDigestByViewer: cloneJson(prior.projectionDigestByViewer),
      });
    }
    if (input.duplicate === true) fail(`duplicate commandId has no original: ${commandId}`);
    const current = lastState(this.journal);
    const expectedStateVersion = count(input.expectedStateVersion ?? current.stateVersion, "expectedStateVersion");
    const expectedRoomVersion = count(input.expectedRoomVersion ?? current.roomVersion, "expectedRoomVersion");
    if (expectedStateVersion !== current.stateVersion || expectedRoomVersion !== current.roomVersion) {
      fail(`command expected version does not match journal head (expected=${expectedStateVersion}/${expectedRoomVersion}, head=${current.stateVersion}/${current.roomVersion})`);
    }
    const state = stateOf(input.state, { ...current, ...input });
    const appliedStateVersion = count(input.appliedStateVersion ?? state.stateVersion, "appliedStateVersion");
    const eventSeq = count(input.eventSeq ?? state.eventSeq, "eventSeq");
    const roomVersion = count(input.roomVersion ?? state.roomVersion, "roomVersion");
    if (appliedStateVersion <= expectedStateVersion) fail("new command must advance stateVersion");
    const entry: JournalEntryInput = {
      kind: "entry", seq: this.journal.entries.length + 1, playerId, actor, requestId, commandId,
      command: cloneJson(input.command), payload: cloneJson(input.payload ?? input.command),
      acceptedAt: input.acceptedAt ?? new Date(0).toISOString(), expectedStateVersion, expectedRoomVersion,
      appliedStateVersion, roomVersion, eventSeq, result: cloneJson(input.result ?? { accepted: true }),
      publicReceipt: cloneJson(input.publicReceipt ?? input.result ?? { accepted: true }), duplicate: input.duplicate ?? false,
      rejection: input.rejection ?? null, entropyConsumed: cloneEntropy(input.entropyConsumed),
      projectionDigestByViewer: Object.fromEntries(Object.entries(input.projectionDigestByViewer ?? {}).map(([key, value]) => [key, text(value, `projectionDigestByViewer.${key}`)])),
    };
    const appended = this.appendCommand(entry, state);
    this.commandEntries.set(commandKey(appended), appended);
    return appended;
  }

  recordOperation(input: JournalOperationInput): JournalOperation {
    const operationId = text(input.operationId, "operationId");
    if (this.operationIds.has(operationId)) fail(`duplicate operationId: ${operationId}`);
    const current = lastState(this.journal);
    const state = stateOf(input.state, { ...current, ...input });
    const record: JournalOperationInputRecord = {
      kind: "operation", seq: this.journal.entries.length + 1, operationId,
      taskId: text(input.taskId, "taskId"), phase: text(input.phase, "phase"),
      stateVersion: count(input.stateVersion ?? state.stateVersion, "stateVersion"),
      eventSeq: count(input.eventSeq ?? state.eventSeq, "eventSeq"),
      roomVersion: count(input.roomVersion ?? state.roomVersion, "roomVersion"),
      sourceClosureEvidence: cloneJson(input.sourceClosureEvidence ?? []) as JournalJsonObject[], costCensus: cloneJson(input.costCensus ?? null),
      paymentPlan: cloneJson(input.paymentPlan ?? null), paymentReceipt: cloneJson(input.paymentReceipt ?? null),
      effectIRDigest: input.effectIRDigest ?? null, primitiveReceipts: cloneJson(input.primitiveReceipts ?? []) as JournalJsonObject[],
      tokenBirths: cloneJson(input.tokenBirths ?? []) as JournalJsonObject[], tokenRetirements: cloneJson(input.tokenRetirements ?? []) as JournalJsonObject[],
      zoneTransitions: cloneJson(input.zoneTransitions ?? []) as JournalJsonObject[], pendingReason: input.pendingReason ?? null,
      entropyConsumed: cloneEntropy(input.entropyConsumed),
    };
    if (record.stateVersion < current.stateVersion || record.eventSeq < current.eventSeq || record.roomVersion < current.roomVersion) {
      fail("operation clock regressed");
    }
    const appended = this.appendOperation(record, state);
    this.operationIds.add(operationId);
    return appended;
  }

  append(record: JournalRecordInput): JournalRecord {
    if (record.kind === "entry") return this.appendCommand(record);
    return this.appendOperation(record);
  }

  snapshot(): Journal {
    return freezeDeep(cloneJson(this.journal));
  }

  serialize(): string {
    return serializeJournalJsonl(this.snapshot());
  }

  private appendCommand(record: JournalEntryInput, state?: Required<JournalStateSnapshot>): JournalEntry {
    if (!isJournalEntry({ ...record, integrity: { parentDigest: zeroDigest(), currentDigest: zeroDigest() } })) {
      fail("command entry does not satisfy protocol validation");
    }
    return this.appendRecord(record, state) as JournalEntry;
  }

  private appendOperation(record: JournalOperationInputRecord, state?: Required<JournalStateSnapshot>): JournalOperation {
    if (!isJournalOperation({ ...record, integrity: { parentDigest: zeroDigest(), currentDigest: zeroDigest() } })) {
      fail("operation record does not satisfy protocol validation");
    }
    return this.appendRecord(record, state) as JournalOperation;
  }

  private appendRecord(record: JournalRecordInput, state?: Required<JournalStateSnapshot>): JournalRecord {
    const parentDigest = this.journal.entries.length === 0
      ? computeJournalHeaderDigest(this.journal.header)
      : this.journal.entries.at(-1)!.integrity.currentDigest;
    const integrity = createJournalRecordIntegrity(record, parentDigest);
    const entries = [...this.journal.entries, { ...cloneJson(record), integrity } as JournalRecord];
    const last = entries.at(-1)!;
    const head = {
      ...this.journal.head,
      stateVersion: last.kind === "entry" ? last.appliedStateVersion : last.stateVersion,
      eventSeq: last.eventSeq,
      roomVersion: last.roomVersion,
      parentJournalDigest: this.journal.integrity.currentDigest,
      journalDigest: zeroDigest(),
      stateDigest: state?.stateDigest ?? this.journal.head.stateDigest,
      privateStateDigest: state?.privateStateDigest ?? this.journal.head.privateStateDigest,
    };
    const integrityState = {
      ...this.journal.integrity,
      parentDigest: this.journal.integrity.currentDigest,
      currentDigest: zeroDigest(),
      revision: this.journal.integrity.revision + 1,
      protectedHeadReference: { revision: this.journal.integrity.revision + 1, nonce: this.journal.integrity.nonce },
    };
    const candidate = { header: this.journal.header, head, entries, integrity: integrityState } as Journal;
    const currentDigest = computeJournalDigest(candidate);
    this.journal = { header: candidate.header, head: { ...head, journalDigest: currentDigest }, entries,
      integrity: { ...integrityState, currentDigest } };
    if (!isJournal(this.journal)) fail("journal digest chain is invalid after append");
    return this.journal.entries.at(-1)!;
  }
}

type JournalEntryInput = Omit<JournalEntry, "integrity">;
type JournalOperationInputRecord = Omit<JournalOperation, "integrity">;

export interface JournalReplayOptions<State> {
  readonly engineVersion?: string;
  readonly state?: State;
  readonly applyCommand?: (state: State, entry: JournalEntry) => State;
  readonly applyDuplicateCommand?: (state: State, entry: JournalEntry) => State;
  readonly applyOperation?: (state: State, operation: JournalOperation) => State;
}

export interface JournalReplayResult<State> {
  readonly state: State | undefined;
  readonly journal: Journal;
  readonly engineMismatch: boolean;
  readonly appliedCommands: number;
  readonly appliedOperations: number;
}

export function replayJournal<State>(raw: unknown, options: JournalReplayOptions<State> = {}): JournalReplayResult<State> {
  if (!isJournal(raw)) throw new TypeError("Journal v1 replay requires a valid journal");
  let state = options.state;
  let appliedCommands = 0;
  let appliedOperations = 0;
  for (const record of raw.entries) {
    if (record.kind === "entry") {
      if (record.duplicate) {
        if (options.applyDuplicateCommand) state = options.applyDuplicateCommand(state as State, record);
      } else if (options.applyCommand) state = options.applyCommand(state as State, record);
      appliedCommands += 1;
    } else {
      if (options.applyOperation) state = options.applyOperation(state as State, record);
      appliedOperations += 1;
    }
  }
  return { state, journal: raw, engineMismatch: raw.header.engineVersion !== (options.engineVersion ?? JOURNAL_ENGINE_VERSION),
    appliedCommands, appliedOperations };
}

export class JournalReplayer<State> {
  constructor(private readonly options: JournalReplayOptions<State> = {}) {}

  replay(raw: unknown): JournalReplayResult<State> {
    return replayJournal(raw, this.options);
  }
}

export function isJournalV1(value: unknown): value is Journal {
  return isJournal(value);
}

export function journalDigest(value: Journal): string {
  if (!isJournal(value)) throw new TypeError("Invalid journal");
  return value.integrity.currentDigest;
}

export function journalRecordDigest(record: JournalRecordInput | JournalRecord, parentDigest: string): string {
  return computeJournalRecordDigest(record, parentDigest);
}

