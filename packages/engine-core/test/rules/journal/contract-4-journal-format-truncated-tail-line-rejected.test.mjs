// RIFT-629 golden test — scenario `journal-format-truncated-tail-line-rejected`（negative）
// 依据：contract:4#journal-format、protocol:journal-v1.ts。
//
// 进程在写入中途崩溃会在末尾留下半行 JSON。格式层必须先明确失败（不能把不完整尾部
// 当成“少一条命令”静默吞掉）：parseJournalJsonl 对每一行做 JSON.parse，截断行抛
// SyntaxError 并带行号；恢复侧若要跳过尾部不完整行，必须自己显式实现。
import assert from 'node:assert/strict';
import test from 'node:test';
import { isJournal, parseJournalJsonl, serializeJournalJsonl } from '@riftbound/protocol';
import { validJournal } from './support.mjs';

test('journal-format-truncated-tail-line-rejected (contract 4 journal-format / journal-v1.ts): a half-written final line fails the parse with a line number', () => {
  const journal = validJournal();
  const text = serializeJournalJsonl(journal);
  assert.equal(isJournal(parseJournalJsonl(text)), true);

  const lines = text.trimEnd().split('\n');
  const truncated = [...lines.slice(0, -1), lines.at(-1).slice(0, Math.floor(lines.at(-1).length / 2))].join('\n');
  assert.throws(() => parseJournalJsonl(truncated), error => {
    assert.equal(error instanceof SyntaxError, true);
    // jsonl line numbers are 1-based and count the header line.
    assert.match(error.message, new RegExp(`line ${lines.length}\\b`, 'u'));
    return true;
  });
});

test('journal-format-truncated-tail-line-rejected (journal-v1.ts): an unterminated JSON object is rejected even when it parses as a prefix', () => {
  const journal = validJournal();
  const headerLine = serializeJournalJsonl(journal).split('\n')[0];
  // The raw sample from the scenario: the last entry is cut mid-string.
  const rawTail = '{"kind":"entry","seq":2,"playerId":"p2","commandId":"cmd-2","command":{"type":"pass"},"acceptedAt":"2026-10-15T00:00';
  assert.throws(() => parseJournalJsonl([headerLine, rawTail].join('\n') + '\n'), SyntaxError);
  // A well-formed final line with a missing required field is a TypeError, not silently accepted.
  assert.throws(() => parseJournalJsonl([headerLine, '{"kind":"entry","seq":2}'].join('\n') + '\n'), TypeError);
});
