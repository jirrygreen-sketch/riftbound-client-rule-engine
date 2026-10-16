import test from 'node:test';
import assert from 'node:assert/strict';

const root = '../../dist/duel/';
const engine = await import(process.env.DUEL_ENGINE_DIST ?? `${root}core-v2.js`);
const closure = await import(process.env.DUEL_ENGINE_CLOSURE_DIST ?? `${root}phase-source-closure-v2.js`);
const derived = await import(process.env.DUEL_ENGINE_DERIVED_DIST ?? '../../dist/combat/derived-might.js');
const boardApi = await import(process.env.DUEL_ENGINE_BOARD_DIST ?? `${root}battlefields.js`);
const dsl = await import(process.env.DUEL_DSL_MODULE ?? '@riftbound/card-dsl/duel');
const { CATALOG } = await import('../../../card-dsl/test/fixtures/official-catalog.mjs');

const ASSAULT = 'sfd-156-221';
const PLAIN = 'syn-unit-printed-empty';
const FIELD = 'syn-battlefield-hide';
const FIELD_TWO = 'syn-battlefield-altar';
const FIELD_THREE = 'syn-battlefield-hide-2';
const fields = {
  energy: 2, power: 0, might: 3, domains: ['Fury'], tags: ['Warrior'],
  canonicalCardId: 'card.assault-engine', name: 'Laurent Duelist', fullName: 'Laurent Duelist',
  localizedName: 'Laurent Duelist', setCode: 'sfd', cardNumber: 'SFD-156/221', variant: 'standard',
};
const assaultCard = {
  id: ASSAULT, cardType: 'Unit', ability: '[Assault 2] (+2 :rb_might: while I\'m an attacker.)', ...fields,
};
const fieldThreeCard = {
  id: FIELD_THREE, cardType: 'Battlefield', ability: 'You may hide an additional card here.',
  energy: null, power: null, might: null, domains: ['Calm'], tags: ['Tree'],
  canonicalCardId: 'card.assault-field', name: 'Synthetic Hide 2', fullName: 'Synthetic Hide 2',
  localizedName: 'Synthetic Hide 2', setCode: 'syn', cardNumber: 'SYN-HIDE-2', variant: 'standard',
};
const sourceCatalog = { ...CATALOG, cards: [...CATALOG.cards, assaultCard, fieldThreeCard] };
const officialPrograms = dsl.createDuelAssaultOfficialProgramRegistryV1(dsl.duelAbilitySourceFromCatalog(sourceCatalog));

function cardType(id) {
  if ([FIELD, FIELD_TWO, FIELD_THREE].includes(id)) return 'Battlefield';
  if (id === PLAIN) return 'Champion';
  if (id === 'syn-legend-viktor') return 'Legend';
  if (id.startsWith('ogn-007')) return 'Rune';
  return 'Unit';
}

function makeState() {
  const seats = ['a', 'b'].map(playerId => ({
    playerId,
    mainDeck: [
      { uid: `${playerId}-plain`, cardId: PLAIN },
      { uid: `${playerId}-assault`, cardId: ASSAULT },
      { uid: `${playerId}-plain-3`, cardId: PLAIN },
      { uid: `${playerId}-plain-4`, cardId: PLAIN },
      { uid: `${playerId}-plain-5`, cardId: PLAIN },
      { uid: `${playerId}-plain-2`, cardId: PLAIN },
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
    matchId: 'assault-might-v2', dataVersion: sourceCatalog.dataVersion,
    catalogDigest: sourceCatalog.digest,
    roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })),
  };
  let state = engine.createDuelMatchV2(seats, metadata, () => 0, cardType);
  state = engine.resolveDuelMulliganV2(state, 'a', []);
  state = engine.resolveDuelMulliganV2(state, 'b', []);
  return state;
}

function addUnit(state, playerId, uid, cardId, controllerPlayerId = playerId) {
  const locationId = state.board.battlefields[0].locationId;
  return engine.commitDuelPlayingMutationV2(state, draft => {
    const player = draft.players.find(value => value.playerId === playerId);
    assert.ok(player?.hand.some(card => card.uid === uid));
    const board = boardApi.placeDuelUnit(draft.board, { objectId: uid, controllerPlayerId, locationId });
    const players = draft.players.map(value => value.playerId === playerId
      ? { ...value, hand: value.hand.filter(card => card.uid !== uid) } : value);
    const unitMeta = { ...draft.unitMeta, [uid]: {
      ownerPlayerId: playerId, readied: false, damageMarks: [], trait: { kind: 'card', cardId },
    } };
    return { match: { ...draft, board, players, unitMeta }, transitions: [{
      uid, from: { kind: 'hand', zonePlayerId: playerId }, to: { kind: 'board-battlefield', locationId },
    }] };
  });
}

function setEngagement(state, status, contestingPlayerId = 'a') {
  return engine.commitDuelPlayingMutationV2(state, draft => ({
    match: { ...draft, board: {
      ...draft.board,
      battlefields: draft.board.battlefields.map(field => field.locationId === state.board.battlefields[0].locationId
        ? { ...field, contested: true, contestingPlayerId, showdown: status, combat: status }
        : field),
    } }, transitions: [],
  }));
}

function context(state, patch = {}) {
  const turn = state.frame.turnNumber;
  return {
    matchId: state.matchId, dataVersion: state.dataVersion, catalogDigest: state.catalogDigest,
    turn, taskId: `duel-v2:${state.matchId}:turn-${turn}:continuous:0`,
    phase: 'main', event: 'continuous',
    clock: { stateVersion: state.stateVersion, eventSeq: state.eventSeq }, ...patch,
  };
}

function ledger(state, c, name) {
  return { status: 'empty', ledgerId: `${name}:${state.matchId}`, revision: 0,
    proofId: `proof:${name}:${state.stateVersion}`, matchId: c.matchId, dataVersion: c.dataVersion,
    catalogDigest: c.catalogDigest, turn: c.turn, taskId: c.taskId, clock: { ...c.clock }, entries: [] };
}

function authority(state, c) {
  const refs = new Map();
  for (const object of engine.enumerateDuelObjectsV2(state)) {
    if (object.cardId !== null) {
      const reference = officialPrograms.reference(object.cardId);
      refs.set(object.cardId, reference ? dsl.encodeDuelProgramReferenceRaw(reference) : `unknown:${object.cardId}`);
    }
  }
  const journal = closure.createDuelPhaseSourceClosureJournalV2({
    ...c, tokenReferences: [], preExitSources: [], drawSubjects: [], transitions: [],
    activeEffects: ledger(state, c, 'activeEffects'), chain: ledger(state, c, 'chain'),
    effectQueue: ledger(state, c, 'effectQueue'), feprOutstanding: ledger(state, c, 'feprOutstanding'),
  });
  const registry = closure.createDuelPhaseSourceClosureRegistryV2({
    matchId: state.matchId, dataVersion: state.dataVersion, catalogDigest: state.catalogDigest,
    printings: [...refs].map(([cardId, programReference]) => ({ cardId, programReference })),
  }, request => {
    const onBoard = request.source.zone.kind === 'board-battlefield' || request.source.zone.kind === 'board-base';
    const decision = request.source.cardId === ASSAULT && onBoard ? 'active' : 'inactive';
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

function evaluate(state, uid, patch = {}) {
  const c = context(state, patch);
  const proof = authority(state, c);
  return derived.deriveDuelCurrentMightV2({ match: state, uid, context: c,
    closureRegistry: proof.registry, journal: proof.journal, officialPrograms });
}

test('adds each pure self-Assault source only for its own canonical active attacker', () => {
  let state = makeState();
  state = addUnit(state, 'a', 'a-assault', ASSAULT);
  state = addUnit(state, 'b', 'b-plain-3', PLAIN);
  state = setEngagement(state, 'staged', 'a');
  let precombat = evaluate(state, 'a-assault');
  assert.equal(precombat.status, 'complete', precombat.reason);
  assert.equal(precombat.currentMight, 3);

  state = setEngagement(state, 'active', 'a');
  const attacker = evaluate(state, 'a-assault');
  assert.equal(attacker.status, 'complete', attacker.reason);
  assert.equal(attacker.baseMight, 3);
  assert.equal(attacker.currentMight, 5);
  assert.deepEqual(attacker.appliedSourceUIDs, ['a-assault']);
});

test('defender and no active combat are known zero contributions, not blocked guesses', () => {
  let state = makeState();
  state = addUnit(state, 'a', 'a-assault', ASSAULT);
  state = addUnit(state, 'b', 'b-plain-3', PLAIN);
  state = setEngagement(state, 'active', 'b');
  let result = evaluate(state, 'a-assault');
  assert.equal(result.status, 'complete', result.reason);
  assert.equal(result.currentMight, 3);
  assert.deepEqual(result.appliedSourceUIDs, []);

  state = setEngagement(state, 'staged', 'a');
  result = evaluate(state, 'a-assault');
  assert.equal(result.status, 'complete', result.reason);
  assert.equal(result.currentMight, 3);
  assert.deepEqual(result.appliedSourceUIDs, []);
});
