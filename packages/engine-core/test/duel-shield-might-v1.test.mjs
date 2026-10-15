import test from 'node:test';
import assert from 'node:assert/strict';

const core = await import('../dist/duel/core-v2.js');
const closure = await import('../dist/duel/phase-source-closure-v2.js');
const derived = await import('../dist/duel/derived-might-v2.js');
const board = await import('../dist/duel/battlefields.js');
const dsl = await import('@riftbound/card-dsl/duel');
const { CATALOG } = await import('../../card-dsl/test/fixtures/official-catalog.mjs');

const SHIELD = 'ogs-005-024';
const PLAIN = 'syn-unit-printed-empty';
const FIELD = 'syn-battlefield-hide';
const FIELD_TWO = 'syn-battlefield-altar';
const FIELD_THREE = 'syn-battlefield-hide-2';
const SHIELD_CARD = {
  id: SHIELD, cardType: 'Unit',
  ability: "[Shield] (+1 :rb_might: while I'm a defender.)",
  energy: 6, power: 1, might: 6, domains: ['Calm'], tags: ['Ionia', 'Bird'],
  canonicalCardId: 'card.hash-2b68503e65fe0121f9346680649fa82fb83b4edc1e53b3a7416db4848ce941c6',
  name: 'Zephyr Sage', fullName: 'Zephyr Sage', localizedName: '和风贤者',
  setCode: 'ogs', cardNumber: 'OGS-005/024', variant: 'standard',
};
const FIELD_THREE_CARD = {
  id: FIELD_THREE, cardType: 'Battlefield', ability: 'You may hide an additional card here.',
  energy: null, power: null, might: null, domains: ['Calm'], tags: ['Tree'],
  canonicalCardId: 'card.shield-field-3', name: 'Synthetic Hide 2', fullName: 'Synthetic Hide 2',
  localizedName: '合成隐藏2', setCode: 'syn', cardNumber: 'SYN-HIDE-2', variant: 'standard',
};
const sourceCatalog = { ...CATALOG, cards: [...CATALOG.cards, SHIELD_CARD, FIELD_THREE_CARD] };
const programs = dsl.createDuelShieldOfficialProgramRegistryV1(dsl.duelAbilitySourceFromCatalog(sourceCatalog));

function cardType(id) {
  if ([FIELD, FIELD_TWO, FIELD_THREE].includes(id)) return 'Battlefield';
  if (id === PLAIN) return 'Champion';
  if (id === 'ogn-007-298') return 'Rune';
  if (id === 'syn-legend-viktor') return 'Legend';
  return 'Unit';
}

function makeState() {
  const seats = ['a', 'b'].map(playerId => ({
    playerId,
    mainDeck: [
      { uid: `${playerId}-dummy`, cardId: PLAIN },
      { uid: `${playerId}-plain`, cardId: PLAIN },
      { uid: `${playerId}-shield`, cardId: SHIELD },
      { uid: `${playerId}-plain-2`, cardId: PLAIN },
      { uid: `${playerId}-plain-3`, cardId: PLAIN },
      { uid: `${playerId}-plain-4`, cardId: PLAIN },
      { uid: `${playerId}-plain-5`, cardId: PLAIN },
    ],
    champion: { uid: `${playerId}-champ`, cardId: PLAIN },
    legend: { uid: `${playerId}-legend`, cardId: 'syn-legend-viktor' },
    runeDeck: [{ uid: `${playerId}-rune`, cardId: 'ogn-007-298', domain: 'Fury' }],
    battlefields: [
      { instanceId: `${playerId}-field-0`, cardId: FIELD },
      { instanceId: `${playerId}-field-1`, cardId: FIELD_TWO },
      { instanceId: `${playerId}-field-2`, cardId: FIELD_THREE },
    ],
  }));
  const metadata = {
    matchId: 'shield-might-v1', dataVersion: sourceCatalog.dataVersion,
    catalogDigest: sourceCatalog.digest,
    roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })),
  };
  let state = core.createDuelMatchV2(seats, metadata, () => 0, cardType);
  state = core.resolveDuelMulliganV2(state, 'a', []);
  state = core.resolveDuelMulliganV2(state, 'b', []);
  return state;
}

function addUnit(state, playerId, uid, cardId) {
  const locationId = state.board.battlefields[0].locationId;
  return core.commitDuelPlayingMutationV2(state, draft => {
    const player = draft.players.find(value => value.playerId === playerId);
    assert.ok(player?.hand.some(card => card.uid === uid));
    const placed = board.placeDuelUnit(draft.board, { objectId: uid, controllerPlayerId: playerId, locationId });
    return { match: { ...draft, board: placed,
      players: draft.players.map(value => value.playerId === playerId
        ? { ...value, hand: value.hand.filter(card => card.uid !== uid) } : value),
      unitMeta: { ...draft.unitMeta, [uid]: { ownerPlayerId: playerId, readied: false,
        damageMarks: [], trait: { kind: 'card', cardId } } } },
      transitions: [{ uid, from: { kind: 'hand', zonePlayerId: playerId }, to: { kind: 'board-battlefield', locationId } }] };
  });
}

function openRealCombat(state) {
  const fieldId = state.board.battlefields[0].locationId;
  state = core.commitDuelPlayingMutationV2(state, draft => ({
    match: { ...draft, board: board.applyOpenDuelCleanup(draft.board) }, transitions: [],
  }));
  state = core.commitDuelPlayingMutationV2(state, draft => ({
    match: { ...draft, board: board.beginDuelCombat(draft.board, fieldId) }, transitions: [],
  }));
  return state;
}

function context(state) {
  const turn = state.frame.turnNumber;
  return { matchId: state.matchId, dataVersion: state.dataVersion, catalogDigest: state.catalogDigest,
    turn, taskId: `duel-v2:${state.matchId}:turn-${turn}:continuous:0`, phase: 'main', event: 'continuous',
    clock: { stateVersion: state.stateVersion, eventSeq: state.eventSeq } };
}

function ledger(state, c, name) {
  return { status: 'empty', ledgerId: `${name}:${state.matchId}`, revision: 0,
    proofId: `proof:${name}:${state.stateVersion}`, matchId: c.matchId, dataVersion: c.dataVersion,
    catalogDigest: c.catalogDigest, turn: c.turn, taskId: c.taskId, clock: { ...c.clock }, entries: [] };
}

function authority(state, c) {
  const refs = new Map();
  for (const object of core.enumerateDuelObjectsV2(state)) {
    if (object.cardId !== null) {
      const reference = programs.reference(object.cardId);
      if (reference) refs.set(object.cardId, dsl.encodeDuelProgramReferenceRaw(reference));
    }
  }
  const journal = closure.createDuelPhaseSourceClosureJournalV2({ ...c, tokenReferences: [],
    preExitSources: [], drawSubjects: [], transitions: [], activeEffects: ledger(state, c, 'activeEffects'),
    chain: ledger(state, c, 'chain'), effectQueue: ledger(state, c, 'effectQueue'),
    feprOutstanding: ledger(state, c, 'feprOutstanding') });
  const registry = closure.createDuelPhaseSourceClosureRegistryV2({ matchId: state.matchId,
    dataVersion: state.dataVersion, catalogDigest: state.catalogDigest,
    printings: [...refs].map(([cardId, programReference]) => ({ cardId, programReference })) }, request => {
      const onBoard = request.source.zone.kind === 'board-battlefield' || request.source.zone.kind === 'board-base';
      const decision = request.source.cardId === SHIELD && onBoard ? 'active' : 'inactive';
      return { status: 'complete', matchId: request.context.matchId, dataVersion: request.context.dataVersion,
        catalogDigest: request.context.catalogDigest, turn: request.context.turn, taskId: request.context.taskId,
        phase: request.context.phase, event: request.context.event, clock: { ...request.context.clock },
        uid: request.source.uid, kind: request.source.kind, cardId: request.source.cardId,
        zoneEpoch: request.source.zoneEpoch, controllerPlayerId: request.source.controllerPlayerId,
        zone: { ...request.source.zone }, programReference: request.expectedProgramReference,
        referenceKind: request.referenceKind, proofId: `program:${request.source.uid}`,
        eventSupported: true, decision, coverage: { wholeProgram: true, zoneScope: 'whole-program',
          eventScope: 'whole-program', static: true, replacements: true, continuous: true, triggers: true } };
    });
  return { registry, journal };
}

function evaluate(state, uid) {
  const c = context(state);
  const proof = authority(state, c);
  return derived.deriveDuelCurrentMightV2({ match: state, uid, context: c,
    closureRegistry: proof.registry, journal: proof.journal, officialPrograms: programs });
}

test('adds Shield only to the live non-contesting Defender in actual active Combat', () => {
  let state = makeState();
  state = addUnit(state, 'a', 'a-plain', PLAIN);
  state = addUnit(state, 'b', 'b-shield', SHIELD);
  state = openRealCombat(state);
  const result = evaluate(state, 'b-shield');
  assert.equal(result.status, 'complete', result.reason);
  assert.equal(result.baseMight, 6);
  assert.equal(result.currentMight, 7);
  assert.deepEqual(result.appliedSourceUIDs, ['b-shield']);
});

test('attacker, staged Showdown, non-contesting unit and unknown source remain non-Shield', () => {
  let state = makeState();
  state = addUnit(state, 'a', 'a-shield', SHIELD);
  state = addUnit(state, 'b', 'b-plain', PLAIN);
  const staged = state = core.commitDuelPlayingMutationV2(state, draft => ({
    match: { ...draft, board: board.applyOpenDuelCleanup(draft.board) }, transitions: [],
  }));
  let result = evaluate(staged, 'a-shield');
  assert.equal(result.status, 'complete', result.reason);
  assert.equal(result.currentMight, 6);
  assert.deepEqual(result.appliedSourceUIDs, []);

  state = openRealCombat(state);
  result = evaluate(state, 'a-shield');
  assert.equal(result.status, 'complete', result.reason);
  assert.equal(result.currentMight, 6);
  assert.deepEqual(result.appliedSourceUIDs, []);

  const unknownPrograms = dsl.createDuelOfficialProgramRegistry(dsl.duelAbilitySourceFromCatalog(sourceCatalog));
  const c = context(state);
  const proof = authority(state, c);
  result = derived.deriveDuelCurrentMightV2({ match: state, uid: 'a-shield', context: c,
    closureRegistry: proof.registry, journal: proof.journal, officialPrograms: unknownPrograms });
  assert.equal(result.status, 'blocked');
  assert.match(result.reason, /unsupported-or-unknown-physical-unit-program|unknown-candidate-program/);
});

test('Shield source does not repeat across dynamic Might evaluation and disappears after combat ends', () => {
  let state = makeState();
  state = addUnit(state, 'a', 'a-plain', PLAIN);
  state = addUnit(state, 'b', 'b-shield', SHIELD);
  state = openRealCombat(state);
  const first = evaluate(state, 'b-shield');
  const second = evaluate(state, 'b-shield');
  assert.equal(first.currentMight, 7);
  assert.equal(second.currentMight, 7);
  assert.deepEqual(second.appliedSourceUIDs, ['b-shield']);

  const fieldId = state.board.battlefields[0].locationId;
  state = core.commitDuelPlayingMutationV2(state, draft => ({
    match: { ...draft, board: board.removeDuelUnit(draft.board, 'a-plain'),
      unitMeta: Object.fromEntries(Object.entries(draft.unitMeta).filter(([uid]) => uid !== 'a-plain')),
      players: draft.players.map(player => player.playerId === 'a'
        ? { ...player, trash: [...player.trash, { uid: 'a-plain', cardId: PLAIN }] } : player) },
    transitions: [{ uid: 'a-plain', from: { kind: 'board-battlefield', locationId: fieldId },
      to: { kind: 'trash', zonePlayerId: 'a' } }],
  }));
  state = core.commitDuelPlayingMutationV2(state, draft => ({
    match: { ...draft, board: board.endDuelCombat(draft.board, fieldId,
      { recalledAttackersDuringCleanup: false }).board }, transitions: [],
  }));
  const ended = evaluate(state, 'b-shield');
  assert.equal(ended.status, 'complete', ended.reason);
  assert.equal(ended.currentMight, 6);
  assert.deepEqual(ended.appliedSourceUIDs, []);
});
