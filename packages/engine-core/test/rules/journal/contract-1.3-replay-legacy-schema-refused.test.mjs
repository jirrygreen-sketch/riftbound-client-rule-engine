// RIFT-629 golden test — scenario `journal-replay-legacy-schema-refused`（negative）
// 依据：contract:1.3（一个概念一个实现，不允许旧 schema/profile 并存）、contract:4#journal-format。
//
// 契约第 1 节原则 2：不再要求新代码重放 journal schema 4–9；当前引擎对 formatVersion≠1
// 一律拒绝。本层可执行：journal v1 校验器拒绝 4–9（以及任何非 1 版本），且 createMatch
// 拒绝非 core-1.5 ruleset。旧日志回放本身由 legacy-replay-e2cbcdf tag 的代码负责。
import assert from 'node:assert/strict';
import test from 'node:test';
import { isJournal, isJournalHeader, parseJournalJsonl, serializeJournalJsonl } from '@riftbound/protocol';
import { createMatch } from '../../../dist/game/lifecycle.js';
import { journalHeader, newMatch, validJournal } from './support.mjs';

test('journal-replay-legacy-schema-refused (contract 1.3 / 4 journal-format): formatVersion 4–9 and core-1.4 journals are refused', () => {
  const header = journalHeader();
  for (const formatVersion of [4, 5, 6, 7, 8, 9]) {
    assert.equal(isJournalHeader({ ...header, formatVersion }), false, `formatVersion ${formatVersion}`);
  }
  // A legacy ruleset is refused even at formatVersion 1.
  assert.equal(isJournalHeader({ ...header, rulesetVersion: 'core-1.4' }), false);
  // The scenario's exact sample: v9 + core-1.4 + old engine.
  assert.equal(isJournalHeader({
    ...header,
    formatVersion: 9,
    rulesetVersion: 'core-1.4',
    engineVersion: '0.9.0+legacy9',
  }), false);
});

test('journal-replay-legacy-schema-refused (contract 1.3): a legacy journal body cannot be parsed as v1 either', () => {
  const legacy = { ...validJournal(), header: { ...validJournal().header, formatVersion: 9 } };
  assert.equal(isJournal(legacy), false);
  // Serialization refuses to emit it, so a legacy envelope can never be relabelled as v1.
  assert.throws(() => serializeJournalJsonl(legacy), TypeError);
  const lines = serializeJournalJsonl(validJournal()).split('\n');
  const downgraded = JSON.stringify({ kind: 'header', ...legacy.header, head: legacy.head, integrity: legacy.integrity });
  assert.throws(() => parseJournalJsonl([downgraded, ...lines.slice(1)].join('\n')), TypeError);
});

test('journal-replay-legacy-schema-refused (contract 1.3): the current match lifecycle refuses a non-core-1.5 ruleset', () => {
  const { host } = newMatch({ seed: 'journal-legacy-ruleset' });
  assert.throws(
    () => createMatch({ rulesetVersion: 'core-1.4', decks: [], host }),
    /Unsupported ruleset version: core-1\.4/u,
  );
});
