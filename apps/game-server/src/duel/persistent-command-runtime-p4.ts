/** P4 proposal/CAS publication. Only a durable protected head may publish its ACK. */
import { createHash } from 'node:crypto';
import { isDuelCommandMessageV3Actions1 } from '@riftbound/protocol';
import type { DuelAuthoritativeRuntimeP4Options, DuelAuthoritativeRuntimeP4Result } from './authoritative-runtime-p4.js';
import { createDuelRecordedRuntimeP4, createDuelReplayGateP4, digestDuelCommandArchiveP4,
  DUEL_RUNTIME_PROFILE_P4_LEGACY, DUEL_RUNTIME_PROFILE_P4_SPELL,
  DUEL_RUNTIME_PROFILE_P4_PUBLIC_CHAIN, DUEL_RUNTIME_PROFILE_P4_REGIONAL,
  DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT, DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK,
  DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN,
  DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY,
  replayDuelCommandArchiveP4, type DuelRecordedRuntimeP4, type DuelCommandArchiveP4 } from './command-journal-p4.js';
import { createPrivateJournalCasStore, openPrivateJournalCasStore,
  type PrivateJournalCasStore, type PrivateJournalCasJsonValue, type PrivateJournalCasHead } from './private-journal-cas-store.js';

export interface PersistentDuelRuntimeP4Options extends DuelAuthoritativeRuntimeP4Options {
  readonly directory?: string; readonly key?: string;
  readonly store?: PrivateJournalCasStore<PrivateJournalCasJsonValue>;
}
export interface PersistentDuelRuntimeP4 {
  readonly project: DuelRecordedRuntimeP4['runtime']['project'];
  readonly dispatch: (actor: string, packet: unknown) => Promise<DuelAuthoritativeRuntimeP4Result>;
  readonly resumePending: () => Promise<DuelAuthoritativeRuntimeP4Result | null>;
  readonly close: () => Promise<void>;
  readonly durability: 'protected-cas';
}
function encoded(recorded: DuelRecordedRuntimeP4): PrivateJournalCasJsonValue {
  return JSON.parse(JSON.stringify({ profile: 'P4', journal: recorded.archive() }));
}
function restored(data: PrivateJournalCasJsonValue, options: PersistentDuelRuntimeP4Options): DuelRecordedRuntimeP4 {
  const value = data && typeof data === 'object' && !Array.isArray(data)
    ? data as { readonly [key: string]: PrivateJournalCasJsonValue } : null;
  if (!value || value.profile !== 'P4' || Object.keys(value).sort().join(',') !== 'journal,profile' || !value.journal)
    throw new TypeError('invalid protected P4 data');
  // This data came from the independent protected CAS load, never an input packet.
  const archive = value.journal as unknown as DuelCommandArchiveP4;
  return replayDuelCommandArchiveP4(archive, createDuelReplayGateP4(options,
    digestDuelCommandArchiveP4(archive),
    archive.schemaVersion === 1 || archive.schemaVersion === 2
      ? DUEL_RUNTIME_PROFILE_P4_LEGACY : archive.schemaVersion === 9 ? DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY
        : archive.schemaVersion === 8 ? DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN
        : archive.schemaVersion === 7 ? DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK
        : archive.schemaVersion === 6 ? DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT
        : archive.schemaVersion === 5 ? DUEL_RUNTIME_PROFILE_P4_REGIONAL : archive.schemaVersion === 4
        ? DUEL_RUNTIME_PROFILE_P4_PUBLIC_CHAIN : DUEL_RUNTIME_PROFILE_P4_SPELL));
}
function same(a: PrivateJournalCasHead, b: PrivateJournalCasHead) { return a.revision === b.revision && a.nonce === b.nonce; }
function owner(options: PersistentDuelRuntimeP4Options, store: PrivateJournalCasStore<PrivateJournalCasJsonValue>,
  initial: DuelRecordedRuntimeP4, initialHead: PrivateJournalCasHead): PersistentDuelRuntimeP4 {
  let published = initial, head = initialHead, busy = false, unavailable = false;
  const error = (packet: unknown, message: string): DuelAuthoritativeRuntimeP4Result => {
    const request = packet && typeof packet === 'object' ? Object.getOwnPropertyDescriptor(packet, 'requestId') : undefined;
    return { ack: { type: 'error', code: 'command-rejected', message,
      ...(request && 'value' in request && typeof request.value === 'string' ? { requestId: request.value } : {}) },
      projection: published.runtime.project(null) };
  };
  const mutate = async (operation: (proposal: DuelRecordedRuntimeP4) => DuelAuthoritativeRuntimeP4Result | null,
    packet: unknown): Promise<DuelAuthoritativeRuntimeP4Result | null> => {
    if (busy || unavailable) return error(packet, unavailable ? '对局存储暂不可用，请重新连接恢复' : '对局正在结算');
    busy = true;
    try {
      const loaded = await store.load();
      if (!same(head, loaded.head)) { published = restored(loaded.data, options); head = loaded.head; }
      const proposal = published.fork(), result = operation(proposal);
      if (result === null) return null;
      const next = encoded(proposal);
      const writeId = createHash('sha256').update(JSON.stringify([head.nonce, digestDuelCommandArchiveP4(proposal.archive())])).digest('hex');
      const saved = await store.compareAndSwap(head, writeId, next);
      if (saved.status === 'conflict') {
        published = restored(saved.current.data, options); head = saved.current.head;
        return error(packet, '对局已变化，请使用最新状态重试');
      }
      published = proposal; head = saved.head;
      return result;
    } catch {
      unavailable = true;
      return error(packet, '对局保存或恢复失败，尚未确认操作完成');
    } finally { busy = false; }
  };
  return Object.freeze({ durability: 'protected-cas' as const,
    project: (viewer: string | null) => published.runtime.project(viewer),
    dispatch: async (actor: string, packet: unknown) => {
      if (!isDuelCommandMessageV3Actions1(packet)) return error(packet, '对局命令格式无效');
      return (await mutate(proposal => proposal.runtime.dispatch(actor, packet), packet))!;
    }, resumePending: () => mutate(proposal => proposal.runtime.resumePending(), null),
    close: async () => { unavailable = true; await store.close(); },
  });
}
export async function createPersistentDuelRuntimeP4(options: PersistentDuelRuntimeP4Options): Promise<PersistentDuelRuntimeP4> {
  const recorded = createDuelRecordedRuntimeP4(options);
  const store = options.store ?? await createPrivateJournalCasStore({ directory: options.directory!, key: options.key ?? options.matchId,
    genesisData: encoded(recorded) });
  try {
    const loaded = await store.load();
    const recovered = restored(loaded.data, options);
    return owner(options, store, recovered, loaded.head);
  } catch (error) {
    await store.close().catch(() => {});
    throw error;
  }
}
export async function openPersistentDuelRuntimeP4(options: PersistentDuelRuntimeP4Options): Promise<PersistentDuelRuntimeP4> {
  const store = options.store ?? await openPrivateJournalCasStore({ directory: options.directory!, key: options.key ?? options.matchId });
  try {
    const loaded = await store.load();
    return owner(options, store, restored(loaded.data, options), loaded.head);
  } catch (error) {
    await store.close().catch(() => {});
    throw error;
  }
}
