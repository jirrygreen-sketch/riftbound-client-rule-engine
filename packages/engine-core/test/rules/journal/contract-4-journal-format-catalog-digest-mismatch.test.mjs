// RIFT-629 golden test — scenario `journal-format-catalog-digest-mismatch`（edge）
// 依据：contract:4#journal-format、contract:4#replay、protocol:journal-v1.ts。
//
// 契约第 4 节只规定了 engineVersion 不一致时的 engineMismatch 标记，没有规定 catalogDigest
// 不一致如何处理；journal v1 校验器只要求 digest 是非空 64 位十六进制字符串、不参与结构校验。
// 本测试因此只断言当前内核能证明的事实：
//   1) header.catalogDigest 是 header 摘要与整条摘要链的输入，改动它必然使已封链的日志失效；
//   2) 用新目录摘要重新封链后，日志结构上依然合法。
// 是否应另加 catalogMismatch 标记属于契约缺口，见本任务回复的契约变更请求，不在此发明语义。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeJournalHeaderDigest,
  isJournal,
  isJournalEntries,
} from '@riftbound/protocol';
import { journalEntry, journalFrom, journalHeader, sealEntries, validJournal } from './support.mjs';

const OTHER_DIGEST = 'b'.repeat(64);

test('journal-format-catalog-digest-mismatch (contract 4 journal-format / journal-v1.ts): catalogDigest binds the header and the whole record chain', () => {
  const sealed = journalHeader();
  const swapped = journalHeader({ catalogDigest: OTHER_DIGEST });
  assert.notEqual(computeJournalHeaderDigest(sealed), computeJournalHeaderDigest(swapped));

  const entries = sealEntries(sealed, [journalEntry()]);
  const sealedJournal = journalFrom(sealed, entries);
  // Reusing the sealed entries under a different catalog digest breaks the chain.
  const mismatched = { ...sealedJournal, header: swapped };
  assert.equal(isJournalEntries(entries, swapped.seats), true);
  assert.equal(isJournal(mismatched), false);
});

test('journal-format-catalog-digest-mismatch (journal-v1.ts): a journal re-sealed under the current catalog digest is structurally valid again', () => {
  const current = journalHeader({ catalogDigest: OTHER_DIGEST });
  const reSealed = journalFrom(current, sealEntries(current, [journalEntry()]));
  assert.equal(isJournal(reSealed), true);
  assert.equal(reSealed.header.catalogDigest, OTHER_DIGEST);

  // A malformed digest is rejected outright by the header validator.
  for (const catalogDigest of ['', 'sha256:cat1', 'a'.repeat(63), 'A'.repeat(64)]) {
    assert.equal(isJournal({ ...validJournal(), header: journalHeader({ catalogDigest }) }), false, catalogDigest);
  }
});
