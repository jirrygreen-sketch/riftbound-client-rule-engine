// RIFT-629 golden test — scenario `journal-format-entry-field-set-rejected`（negative）
// 依据：contract:4#journal-format、protocol:journal-v1.ts。
//
// isJournalEntry 用 exactKeys 锁定 {kind, seq, playerId, actor, requestId, commandId, command,
// payload, acceptedAt, expectedStateVersion, expectedRoomVersion, appliedStateVersion,
// roomVersion, eventSeq, result, publicReceipt, duplicate, rejection, entropyConsumed,
// projectionDigestByViewer, integrity}；缺一个字段或多一个字段即整个 journal 拒绝解析，
// 防止前向兼容时静默吞掉未知语义。
import assert from 'node:assert/strict';
import test from 'node:test';
import { isJournal, isJournalEntries, isJournalEntry, parseJournalJsonl, serializeJournalJsonl } from '@riftbound/protocol';
import { validJournal } from './support.mjs';

test('journal-format-entry-field-set-rejected (contract 4 journal-format / journal-v1.ts): an extra entry field rejects the whole journal', () => {
  const journal = validJournal();
  assert.equal(isJournal(journal), true);

  const withExtra = structuredClone(journal);
  withExtra.entries[0].extraField = true;
  assert.equal(isJournalEntry(withExtra.entries[0]), false);
  assert.equal(isJournalEntries(withExtra.entries, withExtra.header.seats), false);
  assert.equal(isJournal(withExtra), false);

  // The same failure surfaces through the serialized JSONL boundary.
  const text = serializeJournalJsonl(journal).trim().split('\n');
  const first = JSON.parse(text[1]);
  first.extraField = true;
  assert.throws(() => parseJournalJsonl([text[0], JSON.stringify(first), ...text.slice(2)].join('\n') + '\n'), TypeError);
});

test('journal-format-entry-field-set-rejected (journal-v1.ts): a missing entry field is rejected just as strictly', () => {
  const journal = validJournal();
  for (const key of ['commandId', 'acceptedAt', 'appliedStateVersion', 'publicReceipt', 'duplicate', 'integrity']) {
    const candidate = structuredClone(journal);
    delete candidate.entries[1][key];
    assert.equal(isJournalEntry(candidate.entries[1]), false, `missing ${key}`);
    assert.equal(isJournal(candidate), false, `journal with missing ${key}`);
  }
});
