/** Run with: pnpm --filter @riftbound/game-server exec tsx --test src/duel/command-journal-p4-context.test.mjs
 * Kept beside the implementation because RIFT-103 forbids editing the existing
 * regional-room test unless its assertions conflict with the approved contract.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isJournal } from '@riftbound/protocol';
import { loadCardCatalogRuntime } from '../card-catalog.js';
import { bindConstructedRegion, catalogForConstructedRegion } from '../constructed-regional-context.js';
import {
  createDuelRecordedRuntimeP4, createDuelReplayGateP4, digestDuelCommandArchiveP4,
  replayDuelCommandArchiveP4, DUEL_RUNTIME_PROFILE_P4_REGIONAL,
} from './command-journal-p4.js';
import { p4RuntimeFixtureCatalog } from '../../tests/duel/fixtures/p4-runtime-catalog.js';
import { setupAdapterFixtureDecks } from '../../tests/duel/fixtures/setup-adapter-catalog.js';

const catalog = await loadCardCatalogRuntime({
  catalog: p4RuntimeFixtureCatalog, constructedPolicy: { asOf: '2026-10-14' },
});
function optionsFor(regionCode = 'ROW', eventDate = '2026-10-14') {
  const constructedRegion = bindConstructedRegion({ regionCode, eventDate });
  let uid = 0;
  return {
    catalog: catalogForConstructedRegion(catalog, constructedRegion),
    constructedRegion, runtimeProfile: DUEL_RUNTIME_PROFILE_P4_REGIONAL,
    matchId: 'regional-context-regression', randomIndex: () => 0,
    uidFactory: () => `regional-context-${++uid}`,
    roster: [
      { playerId: 'alice', displayName: 'Alice', deck: setupAdapterFixtureDecks.a.submission },
      { playerId: 'bob', displayName: 'Bob', deck: setupAdapterFixtureDecks.b.submission },
    ],
  };
}
function restore(archive, options) {
  return replayDuelCommandArchiveP4(archive,
    createDuelReplayGateP4(options, digestDuelCommandArchiveP4(archive)));
}

test('journal v1 retains the trusted regional context and all viewer projections', () => {
  const options = optionsFor();
  const recorded = createDuelRecordedRuntimeP4(options);
  const archive = recorded.archive();
  assert.equal(isJournal(archive.journal), true);
  assert.equal(archive.journal.header.format, 'riftbound-journal');
  const bytes = JSON.stringify(archive);
  const restored = restore(archive, options);
  for (const viewer of ['alice', 'bob', null]) {
    assert.deepEqual(restored.runtime.project(viewer), recorded.runtime.project(viewer));
  }
  assert.equal(restored.archive().contextDigest, archive.contextDigest);
  assert.equal(JSON.stringify(archive), bytes);
});

test('journal v1 refuses a different event date even when every printing remains equally available', () => {
  const options = optionsFor();
  const changed = optionsFor('ROW', '2026-10-13');
  const availability = value => value.catalog.publicCatalog.cards.map(card => [card.id, card.available]);
  assert.deepEqual(availability(changed), availability(options));
  const archive = createDuelRecordedRuntimeP4(options).archive();
  assert.throws(() => restore(archive, changed), /archive\/context digest mismatch/);
});

test('journal v1 refuses a different region before replaying the same deck', () => {
  const options = optionsFor();
  const archive = createDuelRecordedRuntimeP4(options).archive();
  assert.throws(() => restore(archive, optionsFor('CN')), /archive\/context digest mismatch/);
});

test('journal v1 refuses a missing or forged context even with a newly calculated archive digest', () => {
  const options = optionsFor();
  const archive = createDuelRecordedRuntimeP4(options).archive();
  for (const contextDigest of [undefined, '0'.repeat(64)]) {
    const forged = { ...archive, contextDigest };
    assert.throws(() => restore(forged, options), /archive\/context digest mismatch/);
  }
});
