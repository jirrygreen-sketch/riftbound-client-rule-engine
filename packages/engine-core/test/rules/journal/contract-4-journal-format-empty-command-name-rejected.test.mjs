// RIFT-629 golden test — scenario `journal-format-empty-command-name-rejected`（negative）
// 依据：contract:4#journal-format、protocol:journal-v1.ts。
//
// isJournalCommand 只认 pass/concede/play-card/respond-to-prompt 四种封闭类型；契约第 3.5 节
// 规定交互只通过四个一等抽象发生，日志层同样不接纳 schema 之外的命令类型。
// 场景标题里的“空 command.type”与 examples 中的 `draw-card` 都属于“不在冻结联合里”，
// 因此这里两者都断言，且都要求整份日志不可解析。
import assert from 'node:assert/strict';
import test from 'node:test';
import { isJournalEntries, isJournalEntry } from '@riftbound/protocol';
import { journalEntry, journalHeader, sealEntries, verifyRawDigestChain } from './support.mjs';

const KNOWN_COMMANDS = [
  { type: 'pass' },
  { type: 'concede' },
  { type: 'play-card', instanceId: 'c1', targets: [] },
  { type: 'respond-to-prompt', promptId: 'p-1', optionId: 'o-1', targets: [] },
];

test('journal-format-empty-command-name-rejected (contract 4 journal-format / journal-v1.ts): only the four first-class commands are admitted', () => {
  const header = journalHeader();
  for (const command of KNOWN_COMMANDS) {
    const [entry] = sealEntries(header, [journalEntry({ command, payload: command })]);
    assert.equal(isJournalEntry(entry), true, command.type);
  }
});

test('journal-format-empty-command-name-rejected (journal-v1.ts): an unknown or empty command.type rejects the whole journal', () => {
  const header = journalHeader();
  for (const command of [{ type: 'draw-card' }, { type: 'move' }, { type: '' }, { type: 'pass', extra: true }, {}]) {
    const [entry] = sealEntries(header, [journalEntry({ command, payload: command })]);
    assert.equal(verifyRawDigestChain(header, [entry]), true, JSON.stringify(command));
    assert.equal(isJournalEntry(entry), false, JSON.stringify(command));
    assert.equal(isJournalEntries([entry], header.seats), false, JSON.stringify(command));
  }
});
