// RIFT-629 golden test — scenario `journal-format-duplicate-commandid-in-log-rejected`（negative）
// 依据：contract:4#journal-format、protocol:journal-v1.ts。
//
// 即使运行时幂等表被绕过，落盘后的格式校验仍会捕获重复幂等键并拒绝整份日志，双重防线。
// 注意与“标记为 duplicate 的重发条目”区分：后者必须显式 duplicate: true 且沿用原回执，
// 属于合法形态（见 journal-idempotent 组）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { isJournal, isJournalEntries, isJournalEntry } from '@riftbound/protocol';
import { journalEntry, journalFrom, journalHeader, sealEntries, verifyRawDigestChain } from './support.mjs';

test('journal-format-duplicate-commandid-in-log-rejected (contract 4 journal-format / journal-v1.ts): an unmarked duplicate commandId rejects the journal', () => {
  const header = journalHeader();
  const entries = sealEntries(header, [
    journalEntry({ seq: 1, playerId: 'p1', actor: 'p1', commandId: 'cmd-1' }),
    journalEntry({
      seq: 2, playerId: 'p2', actor: 'p2', requestId: 'request-2', commandId: 'cmd-1',
      expectedStateVersion: 1, expectedRoomVersion: 1, appliedStateVersion: 2, roomVersion: 2, eventSeq: 2,
      publicReceipt: { type: 'command-result', commandId: 'cmd-1', appliedVersion: 2 },
    }),
  ]);
  // The digest chain is well formed and only the idempotency-key rule is violated.
  assert.equal(verifyRawDigestChain(header, entries), true);
  assert.equal(isJournalEntries(entries, header.seats), false);
  assert.throws(() => journalFrom(header, entries), TypeError);
});

test('journal-format-duplicate-commandid-in-log-rejected (journal-v1.ts): a duplicate retry entry must replay the original receipt', () => {
  const header = journalHeader();
  const original = journalEntry();
  const [sealedOriginal] = sealEntries(header, [original]);
  const duplicateBody = {
    ...original,
    seq: 2,
    requestId: 'request-retry',
    duplicate: true,
    appliedStateVersion: 1,
    roomVersion: 1,
    eventSeq: 1,
    entropyConsumed: [],
  };
  const [duplicateEntry] = sealEntries(header, [duplicateBody]);
  // Re-seal the pair on one chain so only the duplicate semantics are under test.
  const chained = sealEntries(header, [sealedOriginal, duplicateEntry]);
  assert.equal(isJournalEntry(chained[1]), true);
  assert.equal(isJournalEntries(chained, header.seats), true);
  assert.equal(isJournal(journalFrom(header, chained)), true);

  // A duplicate that changes the stored receipt is not a legal duplicate.
  const drifted = structuredClone(duplicateEntry);
  drifted.publicReceipt = { type: 'command-result', commandId: 'cmd-1', appliedVersion: 99 };
  drifted.integrity = { parentDigest: chained[0].integrity.currentDigest, currentDigest: 'b'.repeat(64) };
  assert.equal(isJournalEntries([chained[0], drifted], header.seats), false);
});
