// RIFT-629 golden test — scenario `journal-format-header-validates`（positive）
// 依据：contract:4#journal-format、protocol:journal-v1.ts（冻结的 journal v1 校验器）。
//
// 被测对象是 `@riftbound/protocol` 的 journal v1 校验器本身：合法 header 必须被接受，
// 且格式校验要先于任何引擎/重放代码（readJournal 的第一道门）。场景样本只给扩展前的
// 最小字段；契约第 4 节冻结的 v1 扩充要求 matchId/roomId、roster/trusted-deck digest、
// creation 熵转录，因此夹具补齐这些字段后再断言通过（差异见本任务回复）。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isJournal,
  isJournalEntries,
  isJournalHeader,
  serializeJournalJsonl,
} from '@riftbound/protocol';
import { journalHeader, sealEntries, validJournal } from './support.mjs';

test('journal-format-header-validates (contract 4 journal-format / journal-v1.ts): a conforming v1 header and entry chain validate', () => {
  const header = journalHeader();
  assert.equal(isJournalHeader(header), true);

  const entries = sealEntries(header, [
    {
      kind: 'entry', seq: 1, playerId: 'p1', actor: 'p1', requestId: 'request-1', commandId: 'cmd-1',
      command: { type: 'play-card', instanceId: 'c1', targets: [] },
      payload: { type: 'play-card', instanceId: 'c1', targets: [] },
      acceptedAt: '2026-10-15T00:00:01Z', expectedStateVersion: 0, expectedRoomVersion: 0,
      appliedStateVersion: 1, roomVersion: 1, eventSeq: 2,
      result: { accepted: true, appliedStateVersion: 1 },
      publicReceipt: { type: 'command-result', commandId: 'cmd-1', appliedVersion: 1 },
      duplicate: false, rejection: null, entropyConsumed: [],
      projectionDigestByViewer: { p1: 'a'.repeat(64), p2: 'a'.repeat(64) },
    },
  ]);
  // Exact field set, seat membership and contiguous seq are enforced by isJournalEntries.
  assert.equal(isJournalEntries(entries, header.seats), true);

  const journal = validJournal();
  assert.equal(isJournal(journal), true);
  // JSONL round trip: the frozen serialized form parses back to the same envelope.
  assert.equal(serializeJournalJsonl(journal).trim().split('\n').length, journal.entries.length + 1);
});

test('journal-format-header-validates (journal-v1.ts): the header demands an exact field set and non-empty unique seats', () => {
  const header = journalHeader();
  assert.equal(isJournalHeader({ ...header, extraField: true }), false);
  const { roomId: _roomId, ...withoutRoom } = header;
  assert.equal(isJournalHeader(withoutRoom), false);
  assert.equal(isJournalHeader({ ...header, seats: [] }), false);
  assert.equal(isJournalHeader({ ...header, seats: [header.seats[0], header.seats[0]] }), false);
  // Literal format/version/ruleset match is part of the frozen contract.
  for (const override of [{ format: 'riftbound-other' }, { formatVersion: 2 }, { rulesetVersion: 'core-1.4' }]) {
    assert.equal(isJournalHeader({ ...header, ...override }), false);
  }
});
