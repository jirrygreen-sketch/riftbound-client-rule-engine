import { canonicalJournalJson, type DuelCommandMessageV3Actions1 } from '@riftbound/protocol';
import { createDuelRecordedRuntimeP4 } from '../command-journal-p4.js';
import { DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK } from '../authoritative-runtime-p4.js';
import { JournalWriter, digestJournalValue, type JournalCommand, type JournalJsonObject } from './journal/index.js';
import { restoreRecording, type RecordingOptions, type RecordedRuntime, type DurableRuntimeResult } from './durable/recording.js';

const json = (value: unknown): JournalJsonObject => JSON.parse(canonicalJournalJson(value));

/** Same command vocabulary as batch B; the complete, real wire packet stays in result. */
function commandOf(packet: DuelCommandMessageV3Actions1): JournalCommand {
  const command = packet.command;
  switch (command.type) {
    case 'pass-priority': case 'pass-focus': case 'end-turn': return { type: 'pass' };
    case 'play-card': return { type: 'play-card', instanceId: command.cardUID, targets: [] };
    case 'answer-pending-choice': return { type: 'respond-to-prompt',
      promptId: command.answers[0]?.promptId ?? command.choiceId,
      optionId: command.answers[0]?.optionIds[0] ?? command.choiceId, targets: [] };
    default: {
      const value = command as unknown as Record<string, unknown>;
      return { type: 'respond-to-prompt', promptId: String(value.windowId ?? value.choiceId ?? command.type),
        optionId: command.type, targets: [] };
    }
  }
}

/** Fixed current owner, retaining the existing CLI mechanism services until batch E. */
export function createCurrentRecording(options: RecordingOptions): RecordedRuntime {
  const base = createDuelRecordedRuntimeP4({ ...options, runtimeProfile: DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK });
  const genesis = base.archive().journal!;
  // The admission context is server-owned and must survive removal of the old
  // archive's separate context/profile digest. Audit timestamps stay out of it.
  let journal = new JournalWriter({ header: { ...genesis.header,
    trustedDeckDigest: digestJournalValue({ decks: options.roster.map(seat => seat.deck),
      constructedRegion: options.constructedRegion ?? null }) }, ...genesis.head }).snapshot();
  let processed = 0, operationOrdinal = 0;
  let dirty = true;
  let cached: ReturnType<RecordedRuntime['archive']>;
  const archive = (): ReturnType<RecordedRuntime['archive']> => {
    if (!dirty) return cached;
    const captured = base.archive();
    if (captured.operations.length !== processed) {
      const writer = new JournalWriter(journal);
      for (const operation of captured.operations.slice(processed)) {
        const ack = (operation.observation.ack as DurableRuntimeResult | null)?.ack;
        const operationId = operation.kind === 'resume' || ack?.type === 'blocked'
          ? `p4:operation:${++operationOrdinal}` : null;
        if (!ack || ack.type === 'error' || ack.duplicate) continue;
        // These are the recorder's actual post-command observations, not an
        // inferred clock, reconstructed DTO or manually advanced game frame.
        const views = operation.observation.views;
        const publicView = views.at(-1) as ReturnType<RecordedRuntime['runtime']['project']>;
        const clock = { stateVersion: publicView.match.stateVersion, eventSeq: publicView.match.eventSeq, roomVersion: 0 };
        const state = { ...clock, stateDigest: digestJournalValue(publicView), privateStateDigest: digestJournalValue(views) };
        if (operationId !== null) {
          const source = captured.journal!.entries.find(entry => entry.kind === 'operation' && entry.operationId === operationId);
          if (source?.kind !== 'operation') throw new TypeError('Recorder omitted native operation evidence');
          writer.recordOperation({ ...source, state });
          continue;
        }
        // A successful command need not advance the Core clock (the first
        // player's combat allocation is one example). It still needs its own
        // accepted-command record so recovery can reconstruct the next command.
        if (operation.kind !== 'dispatch') throw new TypeError('Command recorder requires an actual dispatch');
        const packet = operation.packet;
        if (clock.stateVersion === writer.snapshot().head.stateVersion) {
          // Keep the batch B command-clock invariant. Private work that has not
          // committed a new Core version is an actual dispatch operation, with
          // its original packet, receipt and entropy available to the replayer.
          writer.recordOperation({ operationId: `current:dispatch:${packet.commandId}`,
            taskId: `command:${packet.commandId}`, phase: 'dispatch', ...clock,
            primitiveReceipts: [{ type: 'legacy-dispatch', actor: operation.actor,
              packet: json(packet), ack: json(ack) }], entropyConsumed: operation.entropy, state });
          continue;
        }
        const recordedCommand = commandOf(packet);
        const digests = Object.fromEntries(options.roster.map((seat, index) =>
          [seat.playerId, digestJournalValue(views[index])]));
        digests.public = digestJournalValue(publicView);
        writer.recordCommand({ playerId: operation.actor, actor: operation.actor,
          requestId: packet.requestId, commandId: packet.commandId,
          command: recordedCommand, payload: recordedCommand, expectedStateVersion: packet.expectedVersion,
          appliedStateVersion: clock.stateVersion, eventSeq: clock.eventSeq, roomVersion: clock.roomVersion,
          result: { accepted: true, ack: json(ack), legacyPacket: json(packet) },
          publicReceipt: { accepted: true, ack: json(ack) },
          entropyConsumed: operation.entropy, projectionDigestByViewer: digests, state,
          acceptedAt: new Date(0).toISOString() });
      }
      journal = writer.snapshot();
      processed = captured.operations.length;
    }
    cached = Object.freeze({ ...captured, journal, header: journal.header, head: journal.head,
      entries: journal.entries, integrity: journal.integrity });
    dirty = false;
    return cached;
  };
  const runtime: RecordedRuntime['runtime'] = { ...base.runtime,
    dispatch: (actor, packet) => { const result = base.runtime.dispatch(actor, packet); dirty = true; return result; },
    resumePending: () => { const result = base.runtime.resumePending(); if (result !== null) dirty = true; return result; } };
  return { runtime, profile: base.profile, archive,
    fork: () => restoreRecording({ ...options, recordingFactory: createCurrentRecording }, archive().journal!).recorded };
}
