// RIFT-629 golden test — scenario `journal-format-seat-playerid-not-in-header-rejected`（negative）
// 依据：contract:4#journal-format、protocol:journal-v1.ts。
//
// isJournalEntries 在校验 seats 时要求每条 entry.playerId 都属于 header.seats；外来玩家
// 的命令不能混入日志，保证回放时座位映射唯一。actor 还必须与 playerId 一致，否则就是
// 伪造他人的日志条目。
import assert from 'node:assert/strict';
import test from 'node:test';
import { isJournalEntries, isJournalEntry } from '@riftbound/protocol';
import { journalEntry, journalHeader, sealEntries, verifyRawDigestChain } from './support.mjs';

test('journal-format-seat-playerid-not-in-header-rejected (contract 4 journal-format / journal-v1.ts): an entry from a seat outside the header roster rejects the journal', () => {
  const header = journalHeader();
  const [entry] = sealEntries(header, [journalEntry({ playerId: 'p3', actor: 'p3' })]);
  assert.equal(verifyRawDigestChain(header, [entry]), true);
  // The entry alone is structurally fine; the roster check is what rejects it.
  assert.equal(isJournalEntry(entry), true);
  assert.equal(isJournalEntries([entry], header.seats), false);
  // Without a seat list the same entry is accepted, proving seats drive the rejection.
  assert.equal(isJournalEntries([entry]), true);
});

test('journal-format-seat-playerid-not-in-header-rejected (journal-v1.ts): an actor that differs from playerId is rejected before the roster check', () => {
  const header = journalHeader();
  const [forged] = sealEntries(header, [journalEntry({ playerId: 'p1', actor: 'p2' })]);
  assert.equal(isJournalEntry(forged), false);
  assert.equal(isJournalEntries([forged], header.seats), false);
});
