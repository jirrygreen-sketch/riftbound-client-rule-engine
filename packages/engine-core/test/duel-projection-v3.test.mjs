import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// Compile current engine/protocol sources into exclusive output directories for source-level
// runs. Neither this test nor its ordinary dist fallbacks write any shared build artifacts.
const dist = process.env.DUEL_V3_PROJECTION_DIST
  ? pathToFileURL(`${resolve(process.env.DUEL_V3_PROJECTION_DIST)}/`)
  : new URL('../dist/', import.meta.url);
const protocol = process.env.DUEL_V3_PROTOCOL_DIST
  ? new URL('index.js', pathToFileURL(`${resolve(process.env.DUEL_V3_PROTOCOL_DIST)}/`))
  : '@riftbound/protocol';
const [
  { DUEL_PROJECTION_SCHEMA_V3, isDuelProjectionV3, isDuelProjectionV2 },
  { projectCanonicalDuelMatchV3: project },
  { createDuelMatchV2, resolveDuelMulliganV2, assertAdmittedDuelMatchV2,
    commitDuelPlayingMutationV2, registerDuelGearFromTrustedSourceV2,
    attachDuelGearV2, moveDuelUnitV2, removeDuelGearToOwnerTrashV2 },
  { placeDuelUnit, removeDuelUnit },
  { adoptAdmittedDuelPlayingSessionV2, commitDuelPriorityPaymentV2 },
  { createDuelMatch, resolveDuelMulligan },
] = await Promise.all([
  import(protocol),
  import(new URL('duel/projection-v3.js', dist)),
  import(new URL('duel/core-v2.js', dist)),
  import(new URL('duel/battlefields.js', dist)),
  import(new URL('duel/canonical-session-v2.js', dist)),
  import(new URL('duel/match-state.js', dist)),
]);

const seats = ['p1', 'p2'].map(playerId => ({
  playerId,
  mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-main-${i}`, cardId: `print-${playerId}-${i}` })),
  champion: { uid: `${playerId}-champion`, cardId: `champion-${playerId}` },
  legend: { uid: `${playerId}-legend-private`, cardId: `legend-${playerId}` },
  runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`,
    cardId: `rune-${playerId}-${i}`, domain: i % 2 ? 'Calm' : 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`,
    cardId: `battlefield-${playerId}-${i}` })),
}));
const metadata = { matchId: 'projector-v3-live', dataVersion: 'trusted-catalog',
  catalogDigest: 'sha256:fixture', roster: seats.map(s => ({ playerId: s.playerId, displayName: s.playerId })) };
const type = cardId => cardId.startsWith('champion-') ? 'Champion'
  : cardId.startsWith('legend-') ? 'Legend'
    : cardId.startsWith('rune-') ? 'Rune'
      : cardId.startsWith('battlefield-') ? 'Battlefield'
        : /-[13]$/.test(cardId) ? 'Gear' : 'Unit';
const setup = () => createDuelMatchV2(seats, metadata, () => 0, type);
function playing() {
  const first = resolveDuelMulliganV2(setup(), 'p1', []);
  assert.equal(first.stage, 'setup');
  const state = resolveDuelMulliganV2(first, 'p2', []);
  assert.equal(state.stage, 'playing');
  assert.equal(assertAdmittedDuelMatchV2(state), undefined);
  return state;
}
const card = (uid, player = 'p1') => ({ uid, cardId: `print-${player}-${uid.split('-').at(-1)}` });
const wrap = (match, viewer) => ({ projectionSchema: DUEL_PROJECTION_SCHEMA_V3,
  viewerPlayerId: viewer, match, actions: [] });
const valid = (match, viewer) => assert.equal(isDuelProjectionV3(wrap(match, viewer)), true,
  `invalid ${match.stage} V3 projection for ${viewer}`);
const viewers = ['p1', 'p2', null];
const forbidden = ['"provenance"', '"originalPhysicalCards"', '"physicalCardsByUID"',
  '"initialZonesByUID"', '"zoneEpoch"', '"legendStates"', '"retiredPhysicalUIDs"',
  '"sourceReference"', '"sourceProofId"', '"requiredTasks"', '"priorityPayments"',
  '"receipts"', '"ownerPlayerId":"private-owner"'];
function assertPrivacy(match, viewer) {
  const json = JSON.stringify(match);
  for (const key of forbidden) assert.equal(json.includes(key), false, `${key} leaked to ${viewer}`);
  assert.equal(json.includes('legend-private'), false, 'Legend UID must never appear on public wire');
  for (const player of match.stage === 'setup' ? match.setup.players : match.players) {
    if (player.playerId === viewer) assert.equal(player.hand.length, player.handCount);
    else assert.equal(Object.hasOwn(player, 'hand'), false, 'other hand must be absent, not empty');
  }
}
function assertThreeViews(state) {
  for (const viewer of viewers) {
    const match = project(state, viewer);
    valid(match, viewer);
    assert.equal(match.schemaVersion, 3);
    assert.equal(match.stage, state.stage);
    assert.equal(isDuelProjectionV2(wrap(match, viewer)), false);
    assertPrivacy(match, viewer);
  }
}
const base = (state, player = 'p1') => state.board.bases.find(b => b.ownerPlayerId === player).locationId;
const field = state => state.board.battlefields[0].locationId;
const gearUID = 'p1-main-1', childUID = 'p1-main-3', unitUID = 'p1-main-2';
function enterUnit(state) {
  assert.ok(state.players[0].hand.some(item => item.uid === unitUID));
  return commitDuelPlayingMutationV2(state, draft => ({ match: { ...draft,
    board: placeDuelUnit(draft.board, { objectId: unitUID, controllerPlayerId: 'p1',
      locationId: base(draft) }),
    players: draft.players.map(p => ({ ...p, hand: p.hand.filter(c => c.uid !== unitUID) })),
    unitMeta: { ...draft.unitMeta, [unitUID]: { ownerPlayerId: 'p1', readied: false,
      damageMarks: [], trait: { kind: 'card', cardId: card(unitUID).cardId } } } },
  transitions: [{ uid: unitUID, from: { kind: 'hand', zonePlayerId: 'p1' },
    to: { kind: 'board-base', locationId: base(draft) } }] }));
}
function chain() {
  let state = enterUnit(playing());
  state = registerDuelGearFromTrustedSourceV2(state, gearUID, 'p1', base(state), false);
  state = registerDuelGearFromTrustedSourceV2(state, childUID, 'p1', base(state), true);
  state = attachDuelGearV2(state, gearUID, unitUID);
  state = attachDuelGearV2(state, childUID, gearUID);
  return state;
}
function gearView(state, viewer = null) {
  const match = project(state, viewer);
  valid(match, viewer);
  return match.board.gears;
}

test('real admitted V2 setup projects only V3 setup and viewer hand, without permanent fields', () => {
  const state = setup();
  assert.equal(state.schemaVersion, 2);
  assert.ok(state.provenance.originalPhysicalCards.length > 0);
  assertThreeViews(state);
  for (const viewer of viewers) {
    const match = project(state, viewer);
    assert.deepEqual(Object.keys(match).sort(), ['schemaVersion', 'rulesetId', 'matchId', 'dataVersion',
      'catalogDigest', 'stateVersion', 'eventSeq', 'roster', 'turnOrder', 'stage', 'setup'].sort());
    assert.equal(Object.hasOwn(match, 'board'), false);
    assert.equal(Object.hasOwn(match.setup.players[0].legend, 'readiness'), false);
    assert.equal(Object.hasOwn(match.setup.players[0].legend, 'controllerPlayerId'), false);
  }
});

test('real initial playing state publishes empty gears and exact unestablished Legends to all views', () => {
  const state = playing();
  assert.deepEqual(state.gears, []);
  assertThreeViews(state);
  for (const viewer of viewers) {
    const match = project(state, viewer);
    assert.deepEqual(match.board.gears, []);
    assert.deepEqual(Object.keys(match.board).sort(), ['bases', 'battlefields', 'units', 'gears'].sort());
    assert.deepEqual(match.players.map(p => p.legend), seats.map(s => ({ cardId: s.legend.cardId,
      controllerPlayerId: s.playerId, readiness: 'not-established' })));
    assert.equal(match.resources.players[0].runeDeckCount, 6);
    assert.equal(JSON.stringify(match).includes('p2-rune-0'), false);
  }
});

test('independent Gear reads physical printing and settled readiness without original-owner/epoch disclosure', () => {
  const before = playing();
  const state = registerDuelGearFromTrustedSourceV2(before, gearUID, 'p1', base(before), false);
  assert.equal(state.physicalCardsByUID[gearUID].zoneEpoch, 1);
  assert.equal(state.physicalCardsByUID[gearUID].ownerPlayerId, 'p1');
  assertThreeViews(state);
  for (const viewer of viewers) {
    const match = project(state, viewer);
    assert.deepEqual(match.board.gears, [{ uid: gearUID, cardId: card(gearUID).cardId,
      controllerPlayerId: 'p1', locationId: base(state), readied: false, attachedToUID: null }]);
    assert.deepEqual(Object.keys(match.board.gears[0]).sort(),
      ['uid', 'cardId', 'controllerPlayerId', 'locationId', 'readied', 'attachedToUID'].sort());
    assert.equal(Object.hasOwn(match.board.gears[0], 'ownerPlayerId'), false);
    if (viewer === 'p1') assert.equal(match.players[0].hand.some(c => c.uid === gearUID), false);
    else assert.equal(Object.hasOwn(match.players[0], 'hand'), false);
  }
});

test('card Unit → Gear → Gear attachment follows host and preserves independent controller/readiness', () => {
  const attached = chain();
  const expected = [
    { uid: gearUID, cardId: card(gearUID).cardId, controllerPlayerId: 'p1',
      locationId: base(attached), readied: false, attachedToUID: unitUID },
    { uid: childUID, cardId: card(childUID).cardId, controllerPlayerId: 'p1',
      locationId: base(attached), readied: true, attachedToUID: gearUID },
  ];
  for (const viewer of viewers) {
    const match = project(attached, viewer);
    valid(match, viewer);
    assert.deepEqual(match.board.gears, expected);
    assert.equal(match.board.units[0].objectId, unitUID);
    assert.equal(match.board.units[0].readied, false);
  }
  const moved = moveDuelUnitV2(attached, unitUID, field(attached));
  const controlled = commitDuelPlayingMutationV2(moved, draft => ({ match: { ...draft,
    gears: draft.gears.map(g => ({ ...g, controllerPlayerId: 'p2', readied: !g.readied })) },
  transitions: [] }));
  assert.equal(controlled.physicalCardsByUID[gearUID].ownerPlayerId, 'p1');
  assert.equal(controlled.physicalCardsByUID[gearUID].zoneEpoch, 1, 'board relocation is not a new object');
  assertThreeViews(controlled);
  for (const viewer of viewers) {
    assert.deepEqual(gearView(controlled, viewer), expected.map(g => ({ ...g,
      locationId: field(controlled), controllerPlayerId: 'p2', readied: !g.readied })));
  }
  const removed = commitDuelPlayingMutationV2(controlled, draft => ({ match: { ...draft,
    board: removeDuelUnit(draft.board, unitUID),
    unitMeta: Object.fromEntries(Object.entries(draft.unitMeta).filter(([uid]) => uid !== unitUID)),
    players: draft.players.map(p => p.playerId === 'p1'
      ? { ...p, trash: [...p.trash, card(unitUID)] } : p),
    gears: draft.gears.map(g => g.attachedToUID === unitUID ? { ...g, attachedToUID: null } : g) },
  transitions: [{ uid: unitUID, from: { kind: 'board-battlefield', locationId: field(draft) },
    to: { kind: 'trash', zonePlayerId: 'p1' } }] }));
  assertThreeViews(removed);
  assert.equal(project(removed, null).board.units.length, 0);
  assert.deepEqual(gearView(removed), [
    { ...expected[0], locationId: field(removed), controllerPlayerId: 'p2', readied: true, attachedToUID: null },
    { ...expected[1], locationId: field(removed), controllerPlayerId: 'p2', readied: false },
  ]);
  const gearGone = removeDuelGearToOwnerTrashV2(removed, gearUID);
  assertThreeViews(gearGone);
  assert.deepEqual(gearView(gearGone), [{ ...expected[1], locationId: field(gearGone),
    controllerPlayerId: 'p2', readied: false, attachedToUID: null }]);
  assert.equal(gearGone.players[0].trash.some(c => c.uid === gearUID), true);
  assert.equal(gearGone.physicalCardsByUID[gearUID].zoneEpoch, 2);
});

test('Legend readiness stays tri-state and controller derives from UID-keyed authority, not seat', () => {
  let state = playing();
  const keys = state.players.map(p => p.legend.uid);
  state = commitDuelPlayingMutationV2(state, draft => ({ match: { ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, value]) =>
      [uid, { ...value, controllerPlayerId: uid === keys[0] ? 'p2' : 'p1', readiness: 'ready' }])),
    frame: { ...draft.frame, phase: 'main', priorityPlayerId: 'p1', stateOpen: true } },
  transitions: [] }));
  assertThreeViews(state);
  for (const viewer of viewers) {
    assert.deepEqual(project(state, viewer).players.map(p => p.legend), [
      { cardId: seats[0].legend.cardId, controllerPlayerId: 'p2', readiness: 'ready' },
      { cardId: seats[1].legend.cardId, controllerPlayerId: 'p1', readiness: 'ready' },
    ]);
  }
  const exhausted = commitDuelPlayingMutationV2(state, draft => ({ match: { ...draft,
    legendStates: { ...draft.legendStates, [keys[0]]: { controllerPlayerId: 'p2', readiness: 'exhausted' } } },
  transitions: [] }));
  assertThreeViews(exhausted);
  assert.equal(project(exhausted, null).players[0].legend.readiness, 'exhausted');
  assert.throws(() => commitDuelPlayingMutationV2(exhausted, draft => ({ match: { ...draft,
    legendStates: { ...draft.legendStates, [keys[0]]: { controllerPlayerId: 'p2', readiness: 'not-established' } } },
  transitions: [] })), /not-established Legend/);
  assert.equal(project(exhausted, null).players[0].legend.readiness, 'exhausted');
});

test('pending ID/resolved cost are actor-only; non-actor and spectator see active alone', () => {
  const initial = playing();
  const state = commitDuelPlayingMutationV2(initial, draft => ({ match: { ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, value]) =>
      [uid, { ...value, readiness: 'ready' }])),
    frame: { ...draft.frame, phase: 'main', priorityPlayerId: 'p1', stateOpen: true } },
  transitions: [] }));
  const sourceUID = state.players[0].hand[0].uid;
  const source = { kind: 'effect', referenceId: 'private-effect-ref', sourceUID };
  const paymentId = 'private-payment-p1';
  const paid = commitDuelPriorityPaymentV2(adoptAdmittedDuelPlayingSessionV2(state), 'p1', paymentId,
    { energy: 2, power: [{ allowedDomains: ['Fury'], amount: 1 }] }, source,
    request => ({ matchId: request.match.matchId, actor: request.actor, paymentId: request.paymentId,
      sourceReference: request.sourceReference, sourceProofId: 'private-source-proof', mode: 'current',
      sourceZoneEpoch: request.match.physicalCardsByUID[sourceUID].zoneEpoch }));
  assert.equal(paid.session.match.frame.pendingPayment.actor, 'p1');
  assert.equal(paid.session.match.frame.priorityPlayerId, 'p1');
  const otherPriority = commitDuelPlayingMutationV2(paid.session.match, draft => ({ match: { ...draft,
    frame: { ...draft.frame, priorityPlayerId: 'p2' } }, transitions: [] }));
  assert.equal(otherPriority.frame.pendingPayment.actor, 'p1', 'payment actor survives changed priority');
  assertThreeViews(otherPriority);
  const actor = project(otherPriority, 'p1');
  assert.deepEqual(actor.frame.pendingPayment, { active: true, paymentId,
    resolvedCost: { energy: 2, power: [{ allowedDomains: ['Fury'], amount: 1 }] } });
  assert.equal(JSON.stringify(actor).includes('private-source-proof'), false);
  assert.equal(JSON.stringify(actor).includes('private-effect-ref'), false);
  for (const viewer of ['p2', null]) {
    const other = project(otherPriority, viewer);
    assert.deepEqual(other.frame.pendingPayment, { active: true });
    assert.equal(JSON.stringify(other).includes(paymentId), false);
  }
  // The public guard validates DTO shape, not the private actor. The server must bind
  // viewer -> this projector before the outbound guard, never trust a relabeled DTO.
  assert.equal(isDuelProjectionV3(wrap(actor, 'p2')), false, 'own hand still binds viewer');
  const relabeled = structuredClone(actor);
  delete relabeled.players[0].hand;
  relabeled.players[1].hand = project(otherPriority, 'p2').players[1].hand;
  assert.equal(isDuelProjectionV3(wrap(relabeled, 'p2')), true, 'guard alone cannot authenticate payment actor');
});

test('outputs remain detached and private extra fields are rejected at every public layer', () => {
  const state = chain();
  const original = project(state, 'p1');
  const authority = JSON.stringify(state);
  const mutable = project(state, 'p1');
  mutable.roster[0].displayName = 'changed';
  mutable.players[0].legend.controllerPlayerId = 'p2';
  mutable.players[0].hand[0].cardId = 'fake';
  mutable.board.gears[0].attachedToUID = null;
  mutable.board.units[0].damageMarks.push({ amount: 1, responsiblePlayerId: 'p1' });
  mutable.board.bases[0].occupancy.pop();
  mutable.resources.players[0].runePool.power.Fury = 100;
  mutable.scoring.players[0].scoredBattlefieldLocationIds.push('fake');
  assert.deepEqual(project(state, 'p1'), original);
  assert.equal(JSON.stringify(state), authority);
  const privateExtras = [
    projection => { projection.provenance = {}; },
    projection => { projection.players[0].legend.uid = 'private-legend'; },
    projection => { projection.players[0].legend.ownerPlayerId = 'p1'; },
    projection => { projection.players[0].sourceProofId = 'secret'; },
    projection => { projection.board.gears[0].zoneEpoch = 99; },
    projection => { projection.board.gears[0].ownerPlayerId = 'p1'; },
    projection => { projection.board.receipts = []; },
    projection => { projection.resources.requiredTasks = []; },
    projection => { projection.frame.sourceReference = {}; },
  ];
  for (const inject of privateExtras) {
    const bad = structuredClone(original);
    inject(bad);
    assert.equal(isDuelProjectionV3(wrap(bad, 'p1')), false);
  }
  const setupProjection = project(setup(), 'p1');
  setupProjection.setup.players[0].legend.controllerPlayerId = 'p1';
  assert.equal(isDuelProjectionV3(wrap(setupProjection, 'p1')), false);
});

test('visible alias/attachment/timing conflicts fail the strict public guard', () => {
  const state = chain();
  const cases = [
    projection => { projection.board.gears[1].uid = projection.board.gears[0].uid; },
    projection => { projection.board.gears[1].uid = projection.board.units[0].objectId; },
    projection => { projection.board.gears[0].uid = projection.players[0].hand[0].uid; },
    projection => { projection.board.gears[0].attachedToUID = 'hidden-host'; },
    projection => { projection.board.gears[0].attachedToUID = projection.board.gears[1].uid; },
    projection => { projection.board.gears[1].locationId = projection.board.bases[1].locationId; },
    projection => { projection.board.gears[0].controllerPlayerId = 'foreign-seat'; },
    projection => { projection.board.gears[0].readied = 'ready'; },
    projection => { projection.board.gears[1].attachedToUID = projection.players[0].hand[0].uid; },
    projection => { projection.board.gears[1].attachedToUID = projection.players[0].legend.cardId; },
    projection => { projection.board.gears[1].attachedToUID = projection.board.battlefields[0].instanceId; },
    projection => { projection.players[0].legend.readiness = true; },
    projection => { projection.frame.phase = 'main'; },
    projection => { projection.board.bases[0].occupancy.length = 0; },
  ];
  for (const change of cases) {
    const forged = structuredClone(project(state, 'p1'));
    change(forged);
    assert.equal(isDuelProjectionV3(wrap(forged, 'p1')), false);
  }
  assert.deepEqual(gearView(state).map(g => g.uid), [gearUID, childUID]);
});

test('cloned, V1-shaped or forged V2 authorities are rejected before their fields are read', () => {
  const v1Setup = createDuelMatch(seats, metadata, () => 0);
  const v1First = resolveDuelMulligan(v1Setup, 'p1', []);
  const v1Playing = resolveDuelMulligan(v1First, 'p2', []);
  for (const v1 of [v1Setup, v1Playing]) {
    assert.throws(() => project(v1, 'p1'), TypeError);
    assert.throws(() => project({ ...v1, schemaVersion: 2 }, 'p1'), TypeError);
  }
  for (const genuine of [setup(), playing()]) {
    for (const fake of [{ ...genuine }, structuredClone(genuine), JSON.parse(JSON.stringify(genuine)),
      { schemaVersion: 2, stage: genuine.stage, roster: genuine.roster },
      { ...project(genuine, 'p1'), schemaVersion: 2 }]) {
      const before = JSON.stringify(fake);
      assert.throws(() => project(fake, 'p1'), TypeError);
      assert.equal(JSON.stringify(fake), before);
    }
    assert.throws(() => project(genuine, 'non-seat'), TypeError);
    valid(project(genuine, 'p1'), 'p1');
  }
  for (const fake of [null, undefined, 'setup', 2]) assert.throws(() => project(fake, 'p1'), TypeError);
  let readCount = 0;
  const getter = { get schemaVersion() { readCount++; throw Error('unsafe'); },
    get stage() { readCount++; throw Error('unsafe'); },
    get roster() { readCount++; throw Error('unsafe'); } };
  assert.throws(() => project(getter, 'p1'), TypeError);
  assert.equal(readCount, 0);
});
