/**
 * Durable P3 command boundary.
 *
 * This module owns persistence ordering only. The command journal remains the
 * authoritative replay capability and the CAS store remains the only durable
 * writer. No turn, CardPlay, Move or Combat command is admitted here.
 */
import {
  isDuelCommandMessage,
  type DuelCommandMessage,
  type DuelProjectionV3,
  type ServerToClientMessage,
} from "@riftbound/protocol";
import {
  type DuelCommandEnvelopeV2,
  type DuelCommandOutcomeV2,
  type DuelCommandSessionV2,
  type DuelTrustedCardTypeResolverV2,
} from "@riftbound/engine-core/duel";
import type { CardCatalogRuntime } from "../card-catalog.js";
import {
  createDuelCommandJournalV2,
  createTrustedDuelCommandJournalReplayGateV2,
  replayDuelCommandJournalV2,
  type DuelCommandJournalRecorderV2,
  type SealedDuelCommandJournalV2,
} from "./command-journal-v2.js";
import {
  createPrivateJournalCasStore,
  openPrivateJournalCasStore,
  type PrivateJournalCasHead,
  type PrivateJournalCasJsonValue,
  type PrivateJournalCasStore,
} from "./private-journal-cas-store.js";
import {
  type DuelRuntimeSeatV3,
} from "./runtime-v3.js";

export const PERSISTENT_DUEL_PROJECTION_PROFILE_V3 = "P3" as const;
export type PersistentDuelProjectionProfileV3 = typeof PERSISTENT_DUEL_PROJECTION_PROFILE_V3;

/** The only private payload written by this adapter. CAS head metadata is separate. */
export interface PersistentDuelCommandRuntimeV3Data {
  readonly selectedProjectionProfile: PersistentDuelProjectionProfileV3;
  readonly journal: SealedDuelCommandJournalV2;
}

export interface PersistentDuelCommandRuntimeV3Options {
  readonly catalog: CardCatalogRuntime;
  readonly trustedRoster: readonly [DuelRuntimeSeatV3, DuelRuntimeSeatV3];
  readonly matchId: string;
  readonly trustedCardType: DuelTrustedCardTypeResolverV2;
  readonly randomIndex: (upperBound: number) => number;
  readonly uidFactory?: () => string;
  readonly selectedProjectionProfile?: PersistentDuelProjectionProfileV3;
  readonly directory?: string;
  readonly key?: string;
  readonly busyTimeoutMs?: number;
  /** Tests and an embedding room may provide an already-created protected store. */
  readonly store?: PrivateJournalCasStore<PrivateJournalCasJsonValue>;
}

export interface OpenPersistentDuelCommandRuntimeV3Options {
  readonly catalog: CardCatalogRuntime;
  readonly trustedRoster: readonly [DuelRuntimeSeatV3, DuelRuntimeSeatV3];
  readonly matchId: string;
  readonly trustedCardType: DuelTrustedCardTypeResolverV2;
  readonly randomIndex: (upperBound: number) => number;
  readonly directory?: string;
  readonly key?: string;
  readonly busyTimeoutMs?: number;
  readonly store?: PrivateJournalCasStore<PrivateJournalCasJsonValue>;
  readonly selectedProjectionProfile?: PersistentDuelProjectionProfileV3;
}

export interface PersistentDuelCommandRuntimeV3Result {
  readonly projection: DuelProjectionV3;
  readonly outbound: ServerToClientMessage;
  readonly persistRequired: boolean;
  readonly duplicate: boolean;
  readonly committed: boolean;
}

export class PersistentDuelCommandRuntimeV3Error extends Error {
  readonly code: "invalid-profile" | "persistence-failed" | "recovery-failed" | "closed";

  constructor(code: PersistentDuelCommandRuntimeV3Error["code"], detail: string) {
    super(`Persistent duel runtime V3: ${detail}`);
    this.name = "PersistentDuelCommandRuntimeV3Error";
    this.code = code;
  }
}

type RuntimeData = PrivateJournalCasJsonValue;

function fixedError(requestId: string | undefined, message: string): ServerToClientMessage {
  return { type: "error", ...(requestId === undefined ? {} : { requestId }),
    code: "command-rejected", message };
}

function requestId(raw: unknown): string | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(raw, "requestId");
  const value = descriptor && "value" in descriptor ? descriptor.value : undefined;
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

const safeMessages: Readonly<Record<string, string>> = {
  "invalid-command": "Invalid duel command",
  "unknown-actor": "The authenticated duel actor is not seated",
  "command-conflict": "The command ID conflicts with an earlier request",
  "stale-version": "The duel state version is stale",
  "invalid-stage": "The duel command is not valid at this stage",
  "invalid-phase": "The duel command is not valid in this phase",
  "no-permission": "The authenticated actor cannot perform this command now",
  "mulligan-rejected": "The mulligan selection is not legal",
  "resource-rejected": "The resource action is not legal",
  "payment-rejected": "The pending payment is not legal",
  "version-overflow": "The duel state version cannot advance",
};

function safeOutcomeMessage(outcome: DuelCommandOutcomeV2): string {
  return outcome.status === "rejected"
    ? safeMessages[outcome.reason] ?? "The duel command was rejected"
    : "";
}

function envelope(message: DuelCommandMessage): DuelCommandEnvelopeV2 {
  return { commandId: message.commandId, expectedVersion: message.expectedVersion,
    command: message.command };
}

function validateData(data: RuntimeData, profile: PersistentDuelProjectionProfileV3): asserts data is RuntimeData & PersistentDuelCommandRuntimeV3Data {
  const record = data !== null && typeof data === "object" && !Array.isArray(data)
    ? data as { readonly [key: string]: PrivateJournalCasJsonValue }
    : undefined;
  if (!record || Object.keys(record).sort().join(",") !== "journal,selectedProjectionProfile" ||
      record.selectedProjectionProfile !== profile || record.journal === null ||
      typeof record.journal !== "object" || Array.isArray(record.journal)) {
    throw new PersistentDuelCommandRuntimeV3Error("invalid-profile", "protected data profile mismatch");
  }
}

function casData(profile: PersistentDuelProjectionProfileV3, journal: SealedDuelCommandJournalV2): RuntimeData {
  // `seal()` has already passed the journal's strict JSON validator. This is a
  // type bridge to the CAS value union, not an archive restore or deserialization.
  return { selectedProjectionProfile: profile, journal } as unknown as RuntimeData;
}

function rosterRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  return value as Record<string, unknown>;
}

/**
 * Compare the stored creation roster independently from journal replay. CAS
 * normalizes object keys, while journal replay historically compares serialized
 * creation data in insertion order. The returned value contains the candidate's
 * actual values and array order; only object key insertion order is aligned with
 * the independently trusted roster after the full comparison succeeds.
 */
function alignTrustedRosterValue(candidate: unknown, trusted: unknown, path = "roster"): unknown {
  if (Array.isArray(trusted)) {
    if (!Array.isArray(candidate) || candidate.length !== trusted.length) {
      throw new PersistentDuelCommandRuntimeV3Error("invalid-profile", `${path} does not match trusted roster`);
    }
    return trusted.map((item, index) => alignTrustedRosterValue(candidate[index], item, `${path}[${index}]`));
  }
  const trustedObject = rosterRecord(trusted);
  if (trustedObject) {
    const candidateObject = rosterRecord(candidate);
    if (!candidateObject) {
      throw new PersistentDuelCommandRuntimeV3Error("invalid-profile", `${path} does not match trusted roster`);
    }
    const trustedKeys = Object.keys(trustedObject);
    const candidateKeys = Object.keys(candidateObject);
    if (trustedKeys.length !== candidateKeys.length ||
        trustedKeys.some(key => !Object.prototype.hasOwnProperty.call(candidateObject, key))) {
      throw new PersistentDuelCommandRuntimeV3Error("invalid-profile", `${path} fields do not match trusted roster`);
    }
    const aligned: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of trustedKeys) {
      aligned[key] = alignTrustedRosterValue(candidateObject[key], trustedObject[key], `${path}.${key}`);
    }
    return aligned;
  }
  if (!Object.is(candidate, trusted)) {
    throw new PersistentDuelCommandRuntimeV3Error("invalid-profile", `${path} does not match trusted roster`);
  }
  return candidate;
}

function makeGate(options: OpenPersistentDuelCommandRuntimeV3Options) {
  return createTrustedDuelCommandJournalReplayGateV2(
    options.catalog, options.trustedRoster, options.matchId, options.trustedCardType,
    options.randomIndex,
  );
}

function replayData(options: OpenPersistentDuelCommandRuntimeV3Options, data: RuntimeData): DuelCommandJournalRecorderV2 {
  const profile = options.selectedProjectionProfile ?? PERSISTENT_DUEL_PROJECTION_PROFILE_V3;
  validateData(data, profile);
  // CAS canonicalizes object keys. First compare every stored roster value and
  // array position against the independent trusted roster, then align only object
  // key insertion order for the journal's legacy creation comparison. No stored
  // value is discarded or replaced by this normalization.
  const alignedRoster = alignTrustedRosterValue(data.journal.creation.roster, options.trustedRoster);
  const journal = {
    ...data.journal,
    creation: { ...data.journal.creation, roster: alignedRoster },
  } as SealedDuelCommandJournalV2;
  return replayDuelCommandJournalV2(journal, makeGate(options));
}

function keyFor(options: { readonly key?: string; readonly matchId: string }): string {
  return options.key ?? `duel-v3:${options.matchId}`;
}

/**
 * A protected, save-before-ACK runtime. Every command proposal is replayed from
 * the last committed journal, then CASed; the visible recorder is replaced only
 * after the CAS result is durable.
 */
export class PersistentDuelCommandRuntimeV3 {
  private recorder: DuelCommandJournalRecorderV2;
  private head: PrivateJournalCasHead;
  private closed = false;
  private frozen = false;
  private serial: Promise<void> = Promise.resolve();

  private constructor(
    private readonly options: OpenPersistentDuelCommandRuntimeV3Options,
    private readonly store: PrivateJournalCasStore<RuntimeData>,
    recorder: DuelCommandJournalRecorderV2,
    head: PrivateJournalCasHead,
  ) {
    this.recorder = recorder;
    this.head = head;
  }

  static async create(options: PersistentDuelCommandRuntimeV3Options): Promise<PersistentDuelCommandRuntimeV3> {
    const profile = options.selectedProjectionProfile ?? PERSISTENT_DUEL_PROJECTION_PROFILE_V3;
    if (profile !== PERSISTENT_DUEL_PROJECTION_PROFILE_V3) {
      throw new PersistentDuelCommandRuntimeV3Error("invalid-profile", "only P3 is supported");
    }
    const recorder = createDuelCommandJournalV2(options.catalog, options.trustedRoster, options.matchId, {
      randomIndex: options.randomIndex, uidFactory: options.uidFactory, trustedCardType: options.trustedCardType,
    });
    const journal = recorder.seal();
    const data = casData(profile, journal);
    const store = options.store ?? await createPrivateJournalCasStore<RuntimeData>({
      directory: options.directory!, key: keyFor(options), genesisData: data,
      busyTimeoutMs: options.busyTimeoutMs,
    });
    const loaded = await store.load();
    validateData(loaded.data, profile);
    const restored = replayData(options, loaded.data);
    return new PersistentDuelCommandRuntimeV3(options, store, restored, loaded.head);
  }

  static async open(options: OpenPersistentDuelCommandRuntimeV3Options): Promise<PersistentDuelCommandRuntimeV3> {
    const profile = options.selectedProjectionProfile ?? PERSISTENT_DUEL_PROJECTION_PROFILE_V3;
    if (profile !== PERSISTENT_DUEL_PROJECTION_PROFILE_V3) {
      throw new PersistentDuelCommandRuntimeV3Error("invalid-profile", "only P3 is supported");
    }
    const store = options.store ?? await openPrivateJournalCasStore<RuntimeData>({
      directory: options.directory!, key: keyFor(options), busyTimeoutMs: options.busyTimeoutMs,
    });
    const loaded = await store.load();
    const recorder = replayData(options, loaded.data);
    return new PersistentDuelCommandRuntimeV3(options, store, recorder, loaded.head);
  }

  get stateVersion(): number { return this.recorder.stateVersion; }
  get stage(): DuelCommandSessionV2["match"]["stage"] { return this.recorder.stage; }
  get isFrozen(): boolean { return this.frozen; }
  get headRevision(): number { return this.head.revision; }

  project(viewer: string | null): DuelProjectionV3 {
    this.assertLive();
    // The journal seal re-checks the trusted catalog/roster context before any
    // committed projection is exposed.
    this.recorder.seal();
    return this.recorder.projectV3(viewer);
  }

  /** Execute is serialized per adapter and never acknowledges before CAS success. */
  execute(actor: string, message: unknown): Promise<PersistentDuelCommandRuntimeV3Result> {
    const run = this.serial.then(() => this.executeOne(actor, message), () => this.executeOne(actor, message));
    this.serial = run.then(() => undefined, () => undefined);
    return run;
  }

  apply(actor: string, message: unknown): Promise<PersistentDuelCommandRuntimeV3Result> {
    return this.execute(actor, message);
  }

  executeCommand(actor: string, message: unknown): Promise<PersistentDuelCommandRuntimeV3Result> {
    return this.execute(actor, message);
  }

  async close(): Promise<void> {
    await this.serial;
    if (!this.closed) {
      this.closed = true;
      await this.store.close();
    }
  }

  private assertLive(): void {
    if (this.closed) throw new PersistentDuelCommandRuntimeV3Error("closed", "runtime is closed");
    if (this.frozen) throw new PersistentDuelCommandRuntimeV3Error("recovery-failed", "runtime is frozen after recovery failure");
  }

  private async executeOne(actor: string, raw: unknown): Promise<PersistentDuelCommandRuntimeV3Result> {
    this.assertLive();
    if (!isDuelCommandMessage(raw)) {
      return { projection: this.recorder.projectV3(null), outbound: fixedError(requestId(raw), "Invalid duel command"),
        persistRequired: false, duplicate: false, committed: false };
    }
    const message = raw as DuelCommandMessage;
    const proposal = replayData(this.options, casData(
      PERSISTENT_DUEL_PROJECTION_PROFILE_V3, this.recorder.seal()));
    const applied = proposal.apply(actor, envelope(message));
    if (!applied.persistRequired) {
      const outbound: ServerToClientMessage = applied.outcome.status === "applied"
        ? { type: "request-result", requestId: message.requestId, ok: true, commandId: message.commandId,
            appliedVersion: applied.outcome.appliedVersion, eventSeq: applied.outcome.eventSeq,
            duplicate: applied.duplicate }
        : fixedError(message.requestId, safeOutcomeMessage(applied.outcome));
      return { projection: this.recorder.projectV3(actor), outbound, persistRequired: false,
        duplicate: applied.duplicate, committed: false };
    }
    const candidate = proposal.seal();
    let result;
    try {
      result = await this.store.compareAndSwap(this.head, JSON.stringify([actor, message.commandId]),
        casData(PERSISTENT_DUEL_PROJECTION_PROFILE_V3, candidate));
    } catch (error) {
      await this.recoverAfterFailure();
      throw new PersistentDuelCommandRuntimeV3Error("persistence-failed", "durable command commit failed");
    }
    if (result.status !== "committed") {
      await this.recoverAfterFailure();
      throw new PersistentDuelCommandRuntimeV3Error("persistence-failed", "durable command head conflict");
    }
    this.head = result.head;
    this.recorder = replayData(this.options, result.data);
    const outbound: ServerToClientMessage = applied.outcome.status === "applied"
      ? { type: "request-result", requestId: message.requestId, ok: true, commandId: message.commandId,
          appliedVersion: applied.outcome.appliedVersion, eventSeq: applied.outcome.eventSeq,
          duplicate: applied.duplicate }
      : fixedError(message.requestId, safeOutcomeMessage(applied.outcome));
    return { projection: this.recorder.projectV3(actor), outbound, persistRequired: true,
      duplicate: applied.duplicate, committed: true };
  }

  private async recoverAfterFailure(): Promise<void> {
    try {
      const loaded = await this.store.load();
      const restored = replayData(this.options, loaded.data);
      this.head = loaded.head;
      this.recorder = restored;
    } catch {
      this.frozen = true;
      throw new PersistentDuelCommandRuntimeV3Error("recovery-failed", "protected head could not be replayed");
    }
  }
}

export async function createPersistentDuelCommandRuntimeV3(
  options: PersistentDuelCommandRuntimeV3Options,
): Promise<PersistentDuelCommandRuntimeV3> {
  if (options.directory === undefined && options.store === undefined) {
    throw new TypeError("Persistent duel runtime V3 requires directory or store");
  }
  return PersistentDuelCommandRuntimeV3.create(options);
}

export async function openPersistentDuelCommandRuntimeV3(
  options: OpenPersistentDuelCommandRuntimeV3Options,
): Promise<PersistentDuelCommandRuntimeV3> {
  if (options.directory === undefined && options.store === undefined) {
    throw new TypeError("Persistent duel runtime V3 requires directory or store");
  }
  return PersistentDuelCommandRuntimeV3.open(options);
}

// Naming aliases keep the boundary discoverable beside the existing runtime-v3
// factory while retaining the explicit command-runtime name for new callers.
export {
  PersistentDuelCommandRuntimeV3 as PersistentCommandRuntimeV3,
  createPersistentDuelCommandRuntimeV3 as createPersistentCommandRuntimeV3,
  openPersistentDuelCommandRuntimeV3 as openPersistentCommandRuntimeV3,
};
