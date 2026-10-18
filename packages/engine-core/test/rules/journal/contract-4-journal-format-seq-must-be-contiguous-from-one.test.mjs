// RIFT-629 golden test — scenario `journal-format-seq-must-be-contiguous-from-one`（edge）
// 依据：contract:4#journal-format、protocol:journal-v1.ts。
//
// isJournalEntries 要求 record.seq === index + 1；跳号、乱序、重复都让整份日志不可解析，
// 从而避免“部分重放”造成状态分叉。这里用真实的重封链构造跳号条目：既验证 seq 规则本身，
// 也确认失败不是由摘要链断裂引起的。
import assert from 'node:assert/strict';
import test from 'node:test';
import { isJournalEntries } from '@riftbound/protocol';
import { journalEntry, journalHeader, sealEntries, verifyRawDigestChain } from './support.mjs';

test('journal-format-seq-must-be-contiguous-from-one (contract 4 journal-format / journal-v1.ts): a gap in seq rejects the whole journal', () => {
  const header = journalHeader();
  const entries = sealEntries(header, [
    journalEntry({ seq: 1 }),
    journalEntry({
      seq: 3, playerId: 'p2', actor: 'p2', requestId: 'request-2', commandId: 'cmd-2',
      expectedStateVersion: 1, expectedRoomVersion: 1, appliedStateVersion: 2, roomVersion: 2, eventSeq: 2,
      publicReceipt: { type: 'command-result', commandId: 'cmd-2', appliedVersion: 2 },
    }),
  ]);
  // The digest chain itself is intact; only seq 2 is missing.
  assert.equal(verifyRawDigestChain(header, entries), true);
  assert.equal(isJournalEntries(entries, header.seats), false);
});

test('journal-format-seq-must-be-contiguous-from-one (journal-v1.ts): seq must start at 1 and increase by exactly one', () => {
  const header = journalHeader();
  const single = seq => sealEntries(header, [
    journalEntry({
      seq, playerId: 'p1', actor: 'p1', requestId: 'request-1', commandId: 'cmd-1',
      expectedStateVersion: 0, expectedRoomVersion: 0, appliedStateVersion: 1, roomVersion: 1, eventSeq: 1,
    }),
  ]);
  assert.equal(isJournalEntries(single(0), header.seats), false);
  assert.equal(isJournalEntries(single(2), header.seats), false);

  const duplicated = sealEntries(header, [journalEntry({ seq: 1 }), journalEntry({
    seq: 1, playerId: 'p2', actor: 'p2', requestId: 'request-2', commandId: 'cmd-2',
    expectedStateVersion: 1, expectedRoomVersion: 1, appliedStateVersion: 2, roomVersion: 2, eventSeq: 2,
  })]);
  assert.equal(isJournalEntries(duplicated, header.seats), false);
});
