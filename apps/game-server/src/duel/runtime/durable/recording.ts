import { randomUUID } from 'node:crypto';
import { canonicalJournalJson, isDuelCommandMessageV3Actions1, type JournalEntropy } from '@riftbound/protocol';
import { createDuelRecordedRuntimeP4 as createRecordedRuntime } from '../../command-journal-p4.js';
import { digestJournalValue, JournalWriter, replayJournal, type Journal } from '../journal/index.js';

/** The journal bridge owns recording; durability never selects a runtime profile. */
export type DurableRuntimeOptions = Omit<Parameters<typeof createRecordedRuntime>[0], 'runtimeProfile'>;
export type RecordedRuntime = ReturnType<typeof createRecordedRuntime>;
export type DurableRuntimeResult = ReturnType<RecordedRuntime['runtime']['dispatch']>;

function check(value: unknown, message: string): asserts value {
  if (!value) throw new TypeError(`Durable journal: ${message}`);
}

export function journalOf(recorded: RecordedRuntime): Journal {
  const journal = recorded.archive().journal;
  check(journal, 'the recorder must provide journal v1');
  return journal;
}

export function createRecording(options: DurableRuntimeOptions): RecordedRuntime {
  // Copy the trusted options explicitly: an untyped caller cannot select a
  // historical profile through an extra property on its options object.
  return createRecordedRuntime({ catalog: options.catalog, roster: options.roster,
    matchId: options.matchId, randomIndex: options.randomIndex, uidFactory: options.uidFactory,
    constructedRegion: options.constructedRegion, globalJournal: options.globalJournal });
}

export function restoreRecording(options: DurableRuntimeOptions, journal: Journal) {
  let entropy: readonly JournalEntropy[] = journal.header.creation.entropy;
  let cursor = 0, live = false;
  const take = (kind: JournalEntropy['kind'], bound?: number) => {
    const next = entropy[cursor++];
    check(next?.kind === kind && (next.kind !== 'random' || next.bound === bound), 'entropy ordering mismatch');
    return next.value;
  };
  const recorded = createRecording({ ...options,
    randomIndex: bound => live ? options.randomIndex(bound) : take('random', bound) as number,
    uidFactory: () => live ? (options.uidFactory ?? randomUUID)() : take('uid') as string });
  check(cursor === entropy.length, 'unused creation entropy');
  const initial = journalOf(recorded);
  const { engineVersion: _oldEngine, ...trustedHeader } = initial.header;
  const { engineVersion: _engine, ...storedHeader } = journal.header;
  check(canonicalJournalJson(trustedHeader) === canonicalJournalJson(storedHeader), 'trusted catalog/roster/header mismatch');
  const mismatch = journal.header.engineVersion !== initial.header.engineVersion;
  const begin = (next: readonly JournalEntropy[]) => { entropy = next; cursor = 0; };
  const end = () => check(cursor === entropy.length, 'unused operation entropy');
  const views = () => [...options.roster.map(seat => recorded.runtime.project(seat.playerId)), recorded.runtime.project(null)];
  const applyCommand = (_state: undefined, entry: Journal['entries'][number] & { kind: 'entry' }) => {
    const packet = entry.result.legacyPacket;
    check(isDuelCommandMessageV3Actions1(packet), 'missing recorded command packet');
    check(packet.commandId === entry.commandId && packet.requestId === entry.requestId &&
      packet.expectedVersion === entry.expectedStateVersion, 'command envelope mismatch');
    begin(entry.entropyConsumed);
    const result = recorded.runtime.dispatch(entry.actor, packet);
    end();
    if (!mismatch) {
      const { duplicate: _duplicate, ...ack } = result.ack;
      const expected = entry.result.ack;
      check(canonicalJournalJson(ack) === canonicalJournalJson(expected), 'command receipt drift');
      const match = recorded.runtime.project(null).match;
      check(match.stateVersion === entry.appliedStateVersion && match.eventSeq === entry.eventSeq, 'command clock drift');
      for (const [viewer, digest] of Object.entries(entry.projectionDigestByViewer)) {
        const player = viewer === 'public' ? null : viewer;
        check(digestJournalValue(recorded.runtime.project(player)) === digest, 'viewer projection digest drift');
      }
    }
    return _state;
  };
  const replay = replayJournal(journal, { engineVersion: initial.header.engineVersion,
    applyCommand, applyDuplicateCommand: applyCommand,
    applyOperation: (_state: undefined, operation) => {
      begin(operation.entropyConsumed);
      if (operation.phase === 'resume') {
        check(recorded.runtime.resumePending() !== null, 'recorded resume became a no-op');
      } else {
        check(operation.phase === 'dispatch', 'unsupported durable operation');
        const receipt = operation.primitiveReceipts.find(item => item.type === 'legacy-dispatch');
        check(receipt && typeof receipt.actor === 'string' && isDuelCommandMessageV3Actions1(receipt.packet),
          'missing pending dispatch packet');
        const result = recorded.runtime.dispatch(receipt.actor, receipt.packet);
        if (!mismatch) check(canonicalJournalJson(result.ack) === canonicalJournalJson(receipt.ack), 'pending receipt drift');
      }
      end();
      return _state;
    } });
  if (!mismatch) {
    check(digestJournalValue(recorded.runtime.project(null)) === journal.head.stateDigest, 'public state digest drift');
    check(digestJournalValue(views()) === journal.head.privateStateDigest, 'private state digest drift');
    const replayed = journalOf(recorded);
    check(replayed.entries.length === journal.entries.length, 'journal record count drift');
    for (const [index, actual] of replayed.entries.entries()) {
      const expected = journal.entries[index]!;
      check(actual.kind === expected.kind, 'journal record kind drift');
      if (actual.kind === 'entry' && expected.kind === 'entry') {
        check(canonicalJournalJson(actual.command) === canonicalJournalJson(expected.command) &&
          canonicalJournalJson(actual.publicReceipt) === canonicalJournalJson(expected.publicReceipt), 'command semantics drift');
      } else if (actual.kind === 'operation' && expected.kind === 'operation') {
        const { integrity: _actualIntegrity, ...actualEvidence } = actual;
        const { integrity: _expectedIntegrity, ...expectedEvidence } = expected;
        check(canonicalJournalJson(actualEvidence) === canonicalJournalJson(expectedEvidence), 'operation evidence drift');
      }
    }
    check(replayed.head.parentJournalDigest === journal.head.parentJournalDigest &&
      replayed.integrity.nonce === journal.integrity.nonce, 'journal head chain drift');
  }
  live = true;
  return { recorded, engineMismatch: replay.engineMismatch };
}

/** Continue the confirmed digest chain, rather than the recorder's fresh fork. */
export function appendRecording(confirmed: Journal, before: number, recorded: RecordedRuntime): Journal {
  const fresh = journalOf(recorded);
  const appended = fresh.entries.slice(before);
  check(appended.length === 1, 'one publication must contain exactly one command or operation');
  const writer = new JournalWriter(confirmed);
  const record = appended[0]!;
  if (record.kind === 'entry') writer.recordCommand({ ...record, state: fresh.head });
  else writer.recordOperation({ ...record, state: fresh.head });
  return writer.snapshot();
}
