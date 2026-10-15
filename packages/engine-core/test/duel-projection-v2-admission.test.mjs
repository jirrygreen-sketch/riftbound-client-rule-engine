import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Point at an independently compiled output for admission regression runs; default to the
// package dist for its ordinary test command. Neither path is written by this test.
const dist = process.env.DUEL_V2_ADMISSION_DIST
  ? pathToFileURL(`${resolve(process.env.DUEL_V2_ADMISSION_DIST)}/`)
  : new URL('../dist/', import.meta.url);
const [{ projectCanonicalDuelMatchV2: project },
  { assertAdmittedDuelMatchV2: assertAdmitted },
  { createDuelMatchV2, resolveDuelMulliganV2 },
  { createDuelMatch, resolveDuelMulligan }] = await Promise.all([
  import(new URL('duel/projection-v2.js', dist)),
  import(new URL('duel/core-v2.js', dist)),
  import(new URL('duel/core-v2.js', dist)),
  import(new URL('duel/match-state.js', dist)),
]);

const seats = ['alice', 'bob'].map(playerId => ({
  playerId,
  mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-main-${i}`, cardId: `print-main-${i}` })),
  champion: { uid: `${playerId}-champion`, cardId: 'print-champion' },
  legend: { uid: `${playerId}-legend`, cardId: 'print-legend' },
  runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`, cardId: `print-rune-${i}`,
    domain: i % 2 === 0 ? 'Fury' : 'Calm' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`,
    cardId: `print-field-${i}` })),
}));
const metadata = { matchId: 'admission-guard-v2', dataVersion: 'catalog-v2', catalogDigest: 'sha256:test',
  roster: seats.map(({ playerId }) => ({ playerId, displayName: playerId })) };
const cardType = cardId => cardId === 'print-champion' ? 'Champion'
  : cardId === 'print-legend' ? 'Legend'
    : cardId.startsWith('print-rune-') ? 'Rune'
      : cardId.startsWith('print-field-') ? 'Battlefield' : 'Unit';
const v2Setup = () => createDuelMatchV2(seats, metadata, () => 0, cardType);
function v2Playing() {
  const afterAlice = resolveDuelMulliganV2(v2Setup(), 'alice', []);
  assert.equal(afterAlice.stage, 'setup');
  const afterBob = resolveDuelMulliganV2(afterAlice, 'bob', []);
  assert.equal(afterBob.stage, 'playing');
  return afterBob;
}
const v1Setup = () => createDuelMatch(seats, metadata, () => 0);
function v1Playing() {
  const afterAlice = resolveDuelMulligan(v1Setup(), 'alice', []);
  assert.equal(afterAlice.stage, 'setup');
  const afterBob = resolveDuelMulligan(afterAlice, 'bob', []);
  assert.equal(afterBob.stage, 'playing');
  return afterBob;
}

function rejectedWithoutMutation(candidate, label) {
  const original = JSON.stringify(candidate);
  assert.throws(() => assertAdmitted(candidate), TypeError, `${label} must not have V2 authority`);
  assert.throws(() => project(candidate, 'alice'), TypeError, `${label} must not project as V2`);
  assert.equal(JSON.stringify(candidate), original, `${label} changed on rejection`);
}

test('only factory-admitted V2 setup and playing states receive V2 public projections', () => {
  for (const state of [v2Setup(), v2Playing()]) {
    assert.equal(assertAdmitted(state), undefined);
    for (const viewer of ['alice', 'bob', null]) {
      const projected = project(state, viewer);
      assert.equal(projected.schemaVersion, 2);
      assert.equal(projected.stage, state.stage);
      assert.equal(projected.matchId, state.matchId);
      const serialized = JSON.stringify(projected);
      for (const privateKey of ['provenance', 'originalPhysicalCards', 'physicalCardsByUID',
        'initialZonesByUID', 'zoneEpoch', 'legendStates', 'gears']) {
        assert.equal(serialized.includes(privateKey), false, `${privateKey} leaked in ${state.stage}`);
      }
    }
  }
});

test('V1 setup/playing and schema-spoofed V1 states never gain V2 projection authority', () => {
  for (const state of [v1Setup(), v1Playing()]) {
    rejectedWithoutMutation(state, `V1 ${state.stage}`);
    rejectedWithoutMutation({ ...state, schemaVersion: 2 }, `V1 ${state.stage} with forged schema`);
  }
  for (const stage of ['setup', 'playing']) {
    rejectedWithoutMutation({ schemaVersion: 2, stage, roster: metadata.roster }, `fake V2 ${stage}`);
  }
});

test('shallow, structured and JSON clones cannot carry the live V2 capability', () => {
  for (const state of [v2Setup(), v2Playing()]) {
    rejectedWithoutMutation({ ...state }, `shallow clone ${state.stage}`);
    rejectedWithoutMutation(structuredClone(state), `structured clone ${state.stage}`);
    rejectedWithoutMutation(JSON.parse(JSON.stringify(state)), `JSON clone ${state.stage}`);
    // Rejection must not revoke or mutate the original admitted object.
    assert.equal(project(state, null).stage, state.stage);
  }
});

test('non-object inputs and spoofed property getters are rejected before reading candidate fields', () => {
  for (const value of [null, undefined, 2, 'setup']) {
    assert.throws(() => assertAdmitted(value), TypeError);
    assert.throws(() => project(value, 'alice'), TypeError);
  }
  let reads = 0;
  const impostor = { get roster() { reads++; throw Error('read untrusted roster'); },
    get schemaVersion() { reads++; throw Error('read untrusted schema'); },
    get stage() { reads++; throw Error('read untrusted stage'); } };
  assert.throws(() => assertAdmitted(impostor), TypeError);
  assert.throws(() => project(impostor, 'alice'), TypeError);
  assert.equal(reads, 0);
});
