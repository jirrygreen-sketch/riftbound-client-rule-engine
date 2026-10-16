import { canonicalJournalJson, isDuelCommandMessageV3Actions1, isJournal, type Journal } from '@riftbound/protocol';
import { createPrivateJournalCasStore, openPrivateJournalCasStore,
  type PrivateJournalCasHead, type PrivateJournalCasJsonValue, type PrivateJournalCasSnapshot,
  type PrivateJournalCasStore } from '../../private-journal-cas-store.js';
import { digestJournalValue } from '../journal/index.js';
import { appendRecording, createRecording, findRecordedDuelCommand, journalOf, restoreRecording,
  type DurableRuntimeOptions, type DurableRuntimeResult, type RecordedRuntime } from './recording.js';

export type { DurableRuntimeResult } from './recording.js';
export class DurableRuntimeError extends TypeError {}
export interface DurableDuelRuntimeOptions extends DurableRuntimeOptions {
  /** A room checkpoint used only when creating a new protected head. */
  readonly initialJournal?: Journal;
  readonly directory?: string;
  readonly key?: string;
  readonly busyTimeoutMs?: number;
  readonly store?: PrivateJournalCasStore<PrivateJournalCasJsonValue>;
}

function encoded(journal: Journal): PrivateJournalCasJsonValue {
  return JSON.parse(canonicalJournalJson({ journal })) as PrivateJournalCasJsonValue;
}

function decoded(snapshot: PrivateJournalCasSnapshot): Journal {
  const data = snapshot.data as { readonly [key: string]: PrivateJournalCasJsonValue } | null;
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      Object.keys(data).join(',') !== 'journal' || !isJournal(data.journal)) {
    throw new DurableRuntimeError('Durable runtime requires protected journal v1 data');
  }
  const journal = data.journal;
  if (journal.integrity.revision !== snapshot.head.revision) {
    throw new TypeError('Durable journal revision does not match the protected CAS head');
  }
  return journal;
}

function sameHead(left: PrivateJournalCasHead, right: PrivateJournalCasHead): boolean {
  return left.revision === right.revision && left.nonce === right.nonce;
}

export class DurableDuelRuntime {
  readonly durability = 'protected-cas' as const;
  private busy = false;
  private unavailable = false;
  private inFlight: Promise<unknown> = Promise.resolve();
  private constructor(private readonly options: DurableDuelRuntimeOptions,
    private readonly store: PrivateJournalCasStore, private published: RecordedRuntime,
    private journal: Journal, private head: PrivateJournalCasHead, private mismatch: boolean) {}

  static async create(options: DurableDuelRuntimeOptions): Promise<DurableDuelRuntime> {
    if (options.store) return this.restore(options, options.store);
    if (!options.directory) throw new TypeError('Durable runtime requires directory or store');
    const journal = options.initialJournal ?? journalOf(createRecording(options));
    // Validate a checkpoint against the independently supplied catalog/roster before writing.
    restoreRecording(options, journal);
    const store = await createPrivateJournalCasStore({ directory: options.directory,
      key: options.key ?? options.matchId, busyTimeoutMs: options.busyTimeoutMs, genesisData: encoded(journal) });
    return this.restore(options, store);
  }

  static async open(options: DurableDuelRuntimeOptions): Promise<DurableDuelRuntime> {
    if (!options.store && !options.directory) throw new TypeError('Durable runtime requires directory or store');
    const store = options.store ?? await openPrivateJournalCasStore({ directory: options.directory!,
      key: options.key ?? options.matchId, busyTimeoutMs: options.busyTimeoutMs });
    return this.restore(options, store);
  }

  private static async restore(options: DurableDuelRuntimeOptions, store: PrivateJournalCasStore) {
    try {
      const snapshot = await store.load(), journal = decoded(snapshot);
      const restored = restoreRecording(options, journal);
      return new DurableDuelRuntime(options, store, restored.recorded, journal, snapshot.head, restored.engineMismatch);
    } catch (error) {
      await store.close().catch(() => {});
      throw error;
    }
  }

  exportJournal(): Journal { return structuredClone(this.journal); }

  get engineMismatch(): boolean { return this.mismatch; }
  get stateVersion(): number { return this.journal.head.stateVersion; }
  get stage() { return this.project(null).match.stage; }
  get isFrozen(): boolean { return this.unavailable; }
  get headRevision(): number { return this.head.revision; }
  /** Independent storage evidence, never accepted from an archive or packet. */
  get protectedHeadReference(): PrivateJournalCasHead { return Object.freeze({ ...this.head }); }

  project = (viewer: string | null) => this.published.runtime.project(viewer);

  /** Refresh the protected clock before a room resume without executing pending work. */
  synchronize = (): Promise<void> => {
    if (this.busy || this.unavailable) return Promise.reject(new DurableRuntimeError(
      this.unavailable ? '对局存储暂不可用，请重新连接恢复' : '对局正在结算'));
    this.busy = true;
    const pending = this.loadHead();
    // The caller receives the read error. Lifecycle tracking waits for its
    // settlement so close can still release a failed store before reopening.
    this.inFlight = pending.catch(() => undefined);
    return pending;
  };

  private async loadHead(): Promise<void> {
    try {
      const loaded = await this.store.load();
      if (!sameHead(this.head, loaded.head)) this.refresh(loaded);
      else if (canonicalJournalJson(decoded(loaded)) !== canonicalJournalJson(this.journal)) {
        throw new TypeError('Protected head changed without a CAS revision/nonce change');
      }
    } catch {
      this.unavailable = true;
      throw new DurableRuntimeError('对局保存或恢复失败，尚未确认操作完成');
    } finally { this.busy = false; }
  }

  dispatch = (actor: string, packet: unknown): Promise<DurableRuntimeResult> => {
    if (!isDuelCommandMessageV3Actions1(packet)) return Promise.resolve(this.error(packet, '对局命令格式无效'));
    return this.start(proposal => proposal.runtime.dispatch(actor, packet), packet, actor) as Promise<DurableRuntimeResult>;
  };

  resumePending = (): Promise<DurableRuntimeResult | null> => this.start(proposal => proposal.runtime.resumePending(), null);

  async close(): Promise<void> {
    this.unavailable = true;
    await this.inFlight;
    await this.store.close();
  }

  private error(packet: unknown, message: string): DurableRuntimeResult {
    const request = packet && typeof packet === 'object' ? Object.getOwnPropertyDescriptor(packet, 'requestId') : undefined;
    return { ack: { type: 'error', code: 'command-rejected', message,
      ...(request && 'value' in request && typeof request.value === 'string' ? { requestId: request.value } : {}) },
      projection: this.project(null) };
  }

  private refresh(snapshot: PrivateJournalCasSnapshot): void {
    const journal = decoded(snapshot), restored = restoreRecording(this.options, journal);
    this.published = restored.recorded;
    this.journal = journal;
    this.head = snapshot.head;
    this.mismatch = restored.engineMismatch;
  }

  private start(operation: (proposal: RecordedRuntime) => DurableRuntimeResult | null, packet: unknown, actor?: string) {
    if (this.busy || this.unavailable) return Promise.resolve(this.error(packet,
      this.unavailable ? '对局存储暂不可用，请重新连接恢复' : '对局正在结算'));
    this.busy = true;
    const pending = this.mutate(operation, packet, actor);
    this.inFlight = pending;
    return pending;
  }

  private async mutate(operation: (proposal: RecordedRuntime) => DurableRuntimeResult | null,
    packet: unknown, actor?: string): Promise<DurableRuntimeResult | null> {
    try {
      const loaded = await this.store.load();
      if (!sameHead(this.head, loaded.head)) this.refresh(loaded);
      else if (canonicalJournalJson(decoded(loaded)) !== canonicalJournalJson(this.journal)) {
        throw new TypeError('Protected head changed without a CAS revision/nonce change');
      }
      if (isDuelCommandMessageV3Actions1(packet)) {
        const prior = findRecordedDuelCommand(this.journal, packet.commandId);
        if (prior) {
          const recordedPacket = prior.packet;
          if (prior.actor !== actor || !isDuelCommandMessageV3Actions1(recordedPacket) ||
              recordedPacket.expectedVersion !== packet.expectedVersion ||
              canonicalJournalJson(recordedPacket.command) !== canonicalJournalJson(packet.command)) {
            return this.error(packet, '命令编号已用于其他操作');
          }
          if (prior.ack.type === 'request-result' && prior.ack.ok === true) {
            // The protected head already proves this result. A duplicate does
            // not need another owner/proposal replay and never writes a head.
            return { ack: { ...prior.ack, requestId: packet.requestId, duplicate: true },
              projection: this.project(actor!) };
          }
        }
      }
      const proposal = restoreRecording(this.options, this.journal).recorded;
      const before = journalOf(proposal).entries.length;
      const result = operation(proposal);
      if (result === null || result.ack.type === 'error' || result.ack.duplicate) return result;
      if (journalOf(proposal).entries.length === before) {
        throw new TypeError('Recorder omitted an accepted durable operation');
      }
      const next = appendRecording(this.journal, before, proposal);
      const writeId = digestJournalValue([this.head.revision, this.head.nonce, next.integrity.currentDigest]);
      // This is the only durable publication path. The bound head object comes
      // from this store, never from journal JSON or a client-provided nonce.
      const saved = await this.store.compareAndSwap(this.head, writeId, encoded(next));
      if (saved.status === 'conflict') {
        this.refresh(saved.current);
        return this.error(packet, '对局已变化，请使用最新状态重试');
      }
      if (saved.head.revision !== this.head.revision + 1 || saved.head.nonce === this.head.nonce ||
          canonicalJournalJson(decoded(saved)) !== canonicalJournalJson(next)) {
        throw new TypeError('CAS did not confirm the proposed journal head');
      }
      this.published = proposal;
      this.journal = next;
      this.head = saved.head;
      return saved.status === 'duplicate' ? { ...result, ack: { ...result.ack, duplicate: true } } : result;
    } catch {
      // A thrown write may already have reached disk. Keep the last confirmed
      // view, withhold its ACK, and require a new protected load on reopen.
      this.unavailable = true;
      return this.error(packet, '对局保存或恢复失败，尚未确认操作完成');
    } finally { this.busy = false; }
  }
}

export const createDurableDuelRuntime = (options: DurableDuelRuntimeOptions) => DurableDuelRuntime.create(options);
export const openDurableDuelRuntime = (options: DurableDuelRuntimeOptions) => DurableDuelRuntime.open(options);
