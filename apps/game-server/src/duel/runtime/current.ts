import { canonicalJournalJson, isDuelCommandMessageV3Actions1, isJournal, type Journal } from '@riftbound/protocol';
import { PrivateJournalCasConflictError } from '../private-journal-cas-store.js';
import { createCurrentRecording } from './current-recording.js';
import { createDurableDuelRuntime, openDurableDuelRuntime, type DurableDuelRuntime } from './durable/index.js';
import { appendRecording, createRecording, findRecordedDuelCommand, journalOf, restoreRecording,
  type DurableRuntimeOptions, type DurableRuntimeResult, type RecordedRuntime } from './durable/recording.js';

export type CurrentDuelRuntimeOptions = Omit<DurableRuntimeOptions, 'recordingFactory'>;

/** Keep the CLI's established capabilities until batch E migrates the mechanism services.
 * This is a fixed owner factory, not a room/archive-selectable execution profile. */
const recordingFactory: NonNullable<DurableRuntimeOptions['recordingFactory']> = options =>
  createCurrentRecording(options);

/** One room-owned capability for command execution, private views and journal recovery. */
export class CurrentDuelRuntime {
  private durable: DurableDuelRuntime | null = null;
  private journal: Journal;
  private constructor(private readonly options: DurableRuntimeOptions, private recorded: RecordedRuntime | null,
    journal?: Journal) {
    this.journal = journal ? structuredClone(journal) : journalOf(recorded!);
  }

  static create(options: CurrentDuelRuntimeOptions): CurrentDuelRuntime {
    const trusted = { ...options, recordingFactory };
    return new CurrentDuelRuntime(trusted, createRecording(trusted));
  }

  static restore(options: CurrentDuelRuntimeOptions, journal: Journal): CurrentDuelRuntime {
    if (!isJournal(journal)) throw new TypeError('Room requires an intact journal v1');
    const trusted = { ...options, recordingFactory };
    return new CurrentDuelRuntime(trusted, restoreRecording(trusted, journal).recorded, journal);
  }

  get stateVersion(): number { return this.project(null).match.stateVersion; }
  get eventSeq(): number { return this.project(null).match.eventSeq; }
  get isDurable(): boolean { return this.durable !== null; }
  project = (viewer: string | null) => (this.durable ?? this.recorded!.runtime).project(viewer);
  exportJournal = (): Journal => this.durable?.exportJournal() ?? structuredClone(this.journal);
  dispatch = (actor: string, packet: unknown): DurableRuntimeResult | Promise<DurableRuntimeResult> => {
    if (this.durable) return this.durable.dispatch(actor, packet);
    if (!isDuelCommandMessageV3Actions1(packet)) throw new TypeError('Current command packet required');
    const journal = this.exportJournal();
    const prior = findRecordedDuelCommand(journal, packet.commandId);
    if (prior) {
      const original = prior.packet;
      if (prior.actor !== actor || !isDuelCommandMessageV3Actions1(original) ||
          original.expectedVersion !== packet.expectedVersion ||
          canonicalJournalJson(original.command) !== canonicalJournalJson(packet.command)) {
        return { ack: { type: 'error', requestId: packet.requestId,
          message: '命令编号已用于其他操作' }, projection: this.project(actor) };
      }
      if (prior.ack.type === 'request-result' && prior.ack.ok === true)
        return { ack: { ...prior.ack, requestId: packet.requestId, duplicate: true }, projection: this.project(actor) };
    }
    // Execute accepted commands on the sole in-memory owner. Only rejections
    // need reconstruction: their private receipts must not become sticky state
    // that is absent from the accepted-command journal.
    try {
      const before = journalOf(this.recorded!).entries.length;
      const result = this.recorded!.runtime.dispatch(actor, packet);
      if (result.ack.type === 'error') this.recorded = restoreRecording(this.options, journal).recorded;
      else if (!result.ack.duplicate) this.journal = appendRecording(journal, before, this.recorded!);
      return result;
    } catch (error) {
      this.recorded = restoreRecording(this.options, journal).recorded;
      throw error;
    }
  };

  async enableDurability(directory: string): Promise<void> {
    const options = { ...this.options, directory, key: this.options.matchId };
    if (this.durable) {
      if (!this.durable.isFrozen) return this.durable.synchronize();
      // A reconnect reopens the protected head after an ambiguous/failed IO.
      // This reads confirmed evidence; it never resubmits the failed command.
      await this.durable.close();
      this.durable = await openDurableDuelRuntime(options);
      return;
    }
    const initialJournal = this.exportJournal();
    // An existing command history requires its protected head. Never recreate a
    // missing head from an unprotected checkpoint or reset its CAS revision.
    if (initialJournal.integrity.revision > 0) {
      this.durable = await openDurableDuelRuntime(options);
    } else {
      try {
        this.durable = await createDurableDuelRuntime({ ...options, initialJournal });
      } catch (error) {
        if (!(error instanceof PrivateJournalCasConflictError)) throw error;
        this.durable = await openDurableDuelRuntime(options);
      }
    }
    this.recorded = null;
  }

  async close(): Promise<void> { await this.durable?.close(); }
}
