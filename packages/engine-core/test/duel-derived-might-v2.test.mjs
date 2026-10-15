import test from 'node:test';
import assert from 'node:assert/strict';

import {
  commitDuelPlayingMutationV2,
  createDuelMatchV2,
  createDuelRecruitUnitV2,
  inspectDuelNativeTokenHistoryV2,
  enumerateDuelObjectsV2,
  resolveDuelMulliganV2,
} from '../dist/duel/core-v2.js';
import {
  createDuelPhaseSourceClosureJournalV2,
  createDuelPhaseSourceClosureRegistryV2,
  inspectDuelPhaseSourceClosureV2,
} from '../dist/duel/phase-source-closure-v2.js';
import {
  deriveDuelCurrentMightV2,
} from '../dist/duel/derived-might-v2.js';
import {
  createDuelOfficialProgramRegistry,
  duelAbilitySourceFromCatalog,
  encodeDuelProgramReferenceRaw,
} from '@riftbound/card-dsl/duel';
import { CATALOG as SYNTHETIC_CATALOG } from '../../card-dsl/test/fixtures/official-catalog.mjs';
import { placeDuelUnit, removeDuelUnit } from '../dist/duel/battlefields.js';

const SOUL = 'unl-077-219';
const PLAIN = 'syn-unit-printed-empty';
const UNKNOWN = 'syn-unit-partial';
const FIELD3 = 'syn-battlefield-hide-2';
const BASE_CARD_FIELDS = {
  energy: 5, power: null, might: 3, domains: ['Mind'], tags: ['Shadow Isles'],
  canonicalCardId: 'card.hash-bd9ef27aeff0a310c407d20aaac7113859f60260060aac163b4025ea2e70bf4c',
  name: 'Soul Shepherd', fullName: 'Soul Shepherd', localizedName: '牧魂人',
  setCode: 'unl', cardNumber: 'UNL-077/219', variant: 'standard',
};

const sourceCards = [
  ...SYNTHETIC_CATALOG.cards,
  { id: SOUL, cardType: 'Unit', ability: 'Your token units have +1 :rb_might:.', ...BASE_CARD_FIELDS },
  { id: FIELD3, cardType: 'Battlefield', ability: 'You may hide an additional card here.', energy: null,
    power: null, might: null, domains: ['Calm'], tags: ['Tree'], canonicalCardId: 'card.syn-hide-2',
    name: 'Synthetic Hide 2', fullName: 'Synthetic Hide 2', localizedName: '合成隐藏2',
    setCode: 'syn', cardNumber: 'SYN-HIDE-2', variant: 'standard' },
];
const sourceCatalog = { ...SYNTHETIC_CATALOG, cards: sourceCards };
const officialPrograms = createDuelOfficialProgramRegistry(duelAbilitySourceFromCatalog(sourceCatalog));

function cardType(id) {
  if (id === PLAIN) return 'Champion';
  if (id === 'syn-legend-viktor') return 'Legend';
  if (id === 'ogn-007-298') return 'Rune';
  if (id === 'syn-battlefield-hide') return 'Battlefield';
  if (id === FIELD3) return 'Battlefield';
  if (id === 'syn-battlefield-altar') return 'Battlefield';
  return 'Unit';
}

function seats({ unknown = false, huge = false } = {}) {
  return ['a', 'b'].map(playerId => ({
    playerId,
    mainDeck: [
      { uid: `${playerId}-soul-1`, cardId: SOUL },
      { uid: `${playerId}-soul-2`, cardId: SOUL },
      { uid: `${playerId}-soul-3`, cardId: SOUL },
      { uid: `${playerId}-plain-1`, cardId: PLAIN },
      ...(unknown ? [{ uid: `${playerId}-unknown`, cardId: UNKNOWN }] : []),
      ...(huge ? [{ uid: `${playerId}-huge`, cardId: 'huge-unit' }] : []),
      ...Array.from({ length: 4 - (unknown ? 1 : 0) - (huge ? 1 : 0) }, (_, i) =>
        ({ uid: `${playerId}-plain-${i + 2}`, cardId: PLAIN })),
    ],
    champion: { uid: `${playerId}-champ`, cardId: PLAIN },
    legend: { uid: `${playerId}-legend`, cardId: 'syn-legend-viktor' },
    runeDeck: Array.from({ length: 4 }, (_, i) => ({ uid: `${playerId}-rune-${i}`, cardId: 'ogn-007-298', domain: 'Fury' })),
    battlefields: [
      { instanceId: `${playerId}-field-0`, cardId: 'syn-battlefield-hide' },
      { instanceId: `${playerId}-field-1`, cardId: FIELD3 },
      { instanceId: `${playerId}-field-2`, cardId: 'syn-battlefield-altar' },
    ],
  }));
}

function makeState(options = {}) {
  const data = seats(options);
  const metadata = {
    matchId: `derived-might-${options.unknown ? 'unknown' : options.huge ? 'huge' : 'ok'}`,
    dataVersion: SYNTHETIC_CATALOG.dataVersion,
    catalogDigest: SYNTHETIC_CATALOG.digest,
    roster: data.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })),
  };
  let setup = createDuelMatchV2(data, metadata, () => 0, cardType);
  let state = resolveDuelMulliganV2(setup, 'a', []);
  state = resolveDuelMulliganV2(state, 'b', []);
  return { state, data };
}

function addCardUnit(state, playerId, uid, cardId, controllerPlayerId = playerId) {
  const base = state.board.battlefields.find(field => field.ownerPlayerId === 'a').locationId;
  return commitDuelPlayingMutationV2(state, draft => {
    const player = draft.players.find(item => item.playerId === playerId);
    assert.ok(player?.hand.some(card => card.uid === uid));
    const board = placeDuelUnit(draft.board, {
      objectId: uid, controllerPlayerId, locationId: base,
    });
    const players = draft.players.map(item => item.playerId === playerId
      ? { ...item, hand: item.hand.filter(card => card.uid !== uid) } : item);
    const unitMeta = { ...draft.unitMeta, [uid]: {
      ownerPlayerId: playerId, readied: false, damageMarks: [], trait: { kind: 'card', cardId },
    } };
    return { match: { ...draft, board, players, unitMeta }, transitions: [{
      uid, from: { kind: 'hand', zonePlayerId: playerId }, to: { kind: 'board-battlefield', locationId: base },
    }] };
  });
}

function tokenRequest(state, uid, sourceUID = 'a-plain-2') {
  const source = enumerateDuelObjectsV2(state).find(item => item.uid === sourceUID);
  assert.equal(source?.zone.kind, 'hand');
  const locationId = state.board.bases.find(base => base.ownerPlayerId === 'a').locationId;
  return {
    kind: 'recruit', tokenUID: uid, sourceEffectId: `effect:${uid}`, eventId: `event:${uid}`,
    sourceUID, sourceZoneEpoch: source.zoneEpoch, sourceMode: 'current',
    effectControllerPlayerId: 'a', controllerPlayerId: 'a', locationId,
    readied: true, name: 'Recruit', baseMight: 1, tags: ['Recruit'],
  };
}

function transferUnitControl(state, uid, controllerPlayerId) {
  return commitDuelPlayingMutationV2(state, draft => {
    const unit = draft.board.units.find(item => item.objectId === uid);
    assert.ok(unit);
    const removed = removeDuelUnit(draft.board, uid);
    const board = placeDuelUnit(removed, {
      objectId: uid, controllerPlayerId, locationId: unit.locationId,
    });
    return { match: { ...draft, board }, transitions: [] };
  });
}

function context(state, patch = {}) {
  const turn = state.frame.turnNumber;
  return {
    matchId: state.matchId, dataVersion: state.dataVersion, catalogDigest: state.catalogDigest,
    turn, taskId: `duel-v2:${state.matchId}:turn-${turn}:continuous:0`, phase: 'main', event: 'continuous',
    clock: { stateVersion: state.stateVersion, eventSeq: state.eventSeq }, ...patch,
  };
}

function ledger(state, c, name) {
  return { status: 'empty', ledgerId: `${name}:${state.matchId}`, revision: 0,
    proofId: `proof:${name}:${state.stateVersion}`, matchId: c.matchId, dataVersion: c.dataVersion,
    catalogDigest: c.catalogDigest, turn: c.turn, taskId: c.taskId, clock: { ...c.clock }, entries: [] };
}

function recruitReference(birth) {
  return `recruit:${birth.tokenUID}:${birth.sourceProofId}`;
}

function makeAuthority(state, c, programs = officialPrograms) {
  const refs = new Map();
  for (const object of enumerateDuelObjectsV2(state)) {
    if (object.cardId !== null) {
      const reference = programs.reference(object.cardId);
      refs.set(object.cardId, reference ? encodeDuelProgramReferenceRaw(reference) : `unknown:${object.cardId}`);
    }
  }
  const tokenRefs = [];
  for (const birth of inspectDuelNativeTokenHistoryV2(state).births) {
    if (birth.kind === 'recruit' && state.board.units.some(unit => unit.objectId === birth.tokenUID)) {
      tokenRefs.push({ uid: birth.tokenUID, kind: 'recruit', sourceEffectId: birth.sourceEffectId,
        eventId: birth.eventId, sourceUID: birth.sourceUID, sourceZoneEpoch: birth.sourceZoneEpoch,
        sourceMode: birth.sourceMode, controllerPlayerId: birth.controllerPlayerId,
        referenceKind: 'recruit-birth', programReference: recruitReference(birth), sourceProofId: birth.sourceProofId });
    }
  }
  const journalInput = { ...c, tokenReferences: tokenRefs, preExitSources: [], drawSubjects: [], transitions: [],
    activeEffects: ledger(state, c, 'activeEffects'), chain: ledger(state, c, 'chain'),
    effectQueue: ledger(state, c, 'effectQueue'), feprOutstanding: ledger(state, c, 'feprOutstanding') };
  const journal = createDuelPhaseSourceClosureJournalV2(journalInput);
  const registry = createDuelPhaseSourceClosureRegistryV2({ matchId: state.matchId,
    dataVersion: state.dataVersion, catalogDigest: state.catalogDigest,
    printings: [...refs].map(([cardId, programReference]) => ({ cardId, programReference })),
  }, request => {
    const board = request.source.zone.kind === 'board-base' || request.source.zone.kind === 'board-battlefield';
    const decision = request.source.cardId === SOUL && board ? 'active' : 'inactive';
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
  const authority = makeAuthority(state, c);
  return deriveDuelCurrentMightV2({ match: state, uid, context: c,
    closureRegistry: authority.registry, journal: authority.journal, officialPrograms });
}

test('actual Core no-ability Unit and native Recruit bases derive without trusting DTO Might', () => {
  let { state } = makeState();
  state = addCardUnit(state, 'a', 'a-plain-1', PLAIN);
  assert.deepEqual(evaluate(state, 'a-plain-1'), {
    status: 'complete', uid: 'a-plain-1', baseMight: 4, currentMight: 4,
    appliedSources: [], appliedSourceUIDs: [], targetZoneEpoch: 1,
    targetControllerPlayerId: 'a', head: { matchId: state.matchId, stateVersion: state.stateVersion,
      eventSeq: state.eventSeq, turn: state.frame.turnNumber },
  });
  const request = tokenRequest(state, 'recruit-1');
  state = createDuelRecruitUnitV2(state, request, ({ match, request: source }) => ({
    ...source, matchId: match.matchId, dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
    sourceProofId: `proof:${source.tokenUID}`,
  }));
  const result = evaluate(state, 'recruit-1');
  assert.equal(result.status, 'complete');
  assert.equal(result.baseMight, 1);
  assert.equal(result.currentMight, 1);
  assert.equal(result.tokenEvidence?.sourceProofId, 'proof:recruit-1');
});

test('Soul Shepherd source is continuous, own controller stacks, enemy/hidden/trash sources do not', () => {
  let { state } = makeState();
  state = addCardUnit(state, 'a', 'a-soul-2', SOUL);
  state = addCardUnit(state, 'a', 'a-soul-3', SOUL);
  state = addCardUnit(state, 'a', 'a-plain-1', PLAIN);
  const physicalResult = evaluate(state, 'a-plain-1');
  assert.equal(physicalResult.status, 'complete');
  assert.equal(physicalResult.baseMight, 4);
  assert.equal(physicalResult.currentMight, 4);
  assert.deepEqual(physicalResult.appliedSourceUIDs, []);
  const request = tokenRequest(state, 'recruit-stack');
  state = createDuelRecruitUnitV2(state, request, ({ match, request: source }) => ({ ...source,
    matchId: match.matchId, dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
    sourceProofId: 'proof:stack',
  }));
  let result = evaluate(state, 'recruit-stack');
  assert.equal(result.status, 'complete');
  assert.equal(result.currentMight, 3);
  assert.deepEqual(result.appliedSourceUIDs, ['a-soul-2', 'a-soul-3']);
  assert.deepEqual(result.appliedSources.map(source => source.zoneEpoch), [1, 1]);

  state = addCardUnit(state, 'b', 'b-soul-2', SOUL, 'b');
  result = evaluate(state, 'recruit-stack');
  assert.equal(result.status, 'complete');
  assert.equal(result.currentMight, 3);
  assert.equal(result.appliedSourceUIDs.includes('b-soul-2'), false);

  state = transferUnitControl(state, 'a-soul-2', 'b');
  result = evaluate(state, 'recruit-stack');
  assert.equal(result.status, 'complete');
  assert.equal(result.currentMight, 2);
  assert.deepEqual(result.appliedSourceUIDs, ['a-soul-3']);

  // Moving a source to Trash is a real Core transfer; the closure producer sees
  // its non-board zone and therefore does not report the continuous modifier.
  state = commitDuelPlayingMutationV2(state, draft => {
    const unit = draft.board.units.find(item => item.objectId === 'a-soul-2');
    assert.ok(unit);
    const board = removeDuelUnit(draft.board, 'a-soul-2');
    const players = draft.players.map(player => player.playerId === 'a'
      ? { ...player, trash: [...player.trash, { uid: 'a-soul-2', cardId: SOUL }] } : player);
    const unitMeta = Object.fromEntries(Object.entries(draft.unitMeta).filter(([id]) => id !== 'a-soul-2'));
    return { match: { ...draft, board, players, unitMeta }, transitions: [{ uid: 'a-soul-2',
      from: { kind: 'board-battlefield', locationId: unit.locationId }, to: { kind: 'trash', zonePlayerId: 'a' } }] };
  });
  result = evaluate(state, 'recruit-stack');
  assert.equal(result.status, 'complete');
  assert.equal(result.currentMight, 2);
});

test('unknown programs, stale clocks, cloned heads, active runtime, and overflow block', () => {
  let { state } = makeState({ unknown: true });
  state = addCardUnit(state, 'a', 'a-plain-1', PLAIN);
  state = addCardUnit(state, 'a', 'a-unknown', UNKNOWN);
  let result = evaluate(state, 'a-plain-1');
  assert.equal(result.status, 'blocked');
  assert.match(result.reason, /unknown-candidate-program/);
  const stale = evaluate(state, 'a-plain-1', { clock: { stateVersion: 0, eventSeq: 0 } });
  assert.equal(stale.status, 'blocked');
  assert.equal(stale.reason, 'stale-continuous-boundary');
  const clone = structuredClone(state);
  assert.equal(deriveDuelCurrentMightV2({ match: clone, uid: 'a-plain-1', context: context(state),
    closureRegistry: makeAuthority(state, context(state)).registry,
    journal: makeAuthority(state, context(state)).journal, officialPrograms }).status, 'blocked');
});

test('high bound arithmetic stays exact and a forged ordinary closure object cannot close', () => {
  const huge = { id: 'huge-unit', cardType: 'Unit', ability: '', energy: 3, power: 0,
    might: Number.MAX_SAFE_INTEGER, domains: ['Fury'], tags: ['Warrior'], canonicalCardId: 'huge',
    name: 'Huge', fullName: 'Huge', localizedName: 'Huge', setCode: 'syn', cardNumber: 'HUGE', variant: 'standard' };
  const registry = createDuelOfficialProgramRegistry(duelAbilitySourceFromCatalog({ ...sourceCatalog, cards: [...sourceCards, huge] }));
  assert.equal(registry.getProgram('huge-unit')?.source.might, Number.MAX_SAFE_INTEGER);
  let { state } = makeState({ huge: true });
  state = addCardUnit(state, 'a', 'a-huge', 'huge-unit');
  state = addCardUnit(state, 'a', 'a-soul-2', SOUL);
  const c = context(state);
  const authority = makeAuthority(state, c, registry);
  const result = deriveDuelCurrentMightV2({ match: state, uid: 'a-huge', context: c,
    closureRegistry: authority.registry, journal: authority.journal, officialPrograms: registry });
  assert.equal(result.status, 'complete');
  assert.equal(result.baseMight, Number.MAX_SAFE_INTEGER);
  assert.equal(result.currentMight, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(result.appliedSourceUIDs, []);
  const ordinaryRegistry = { ...registry };
  const forgedAuthorityResult = deriveDuelCurrentMightV2({ match: state, uid: 'a-huge', context: c,
    closureRegistry: authority.registry, journal: authority.journal, officialPrograms: ordinaryRegistry });
  assert.equal(forgedAuthorityResult.status, 'blocked');
  const clonedJournal = structuredClone(authority.journal);
  assert.equal(deriveDuelCurrentMightV2({ match: state, uid: 'a-huge', context: c,
    closureRegistry: authority.registry, journal: clonedJournal, officialPrograms: registry }).status, 'blocked');
});

