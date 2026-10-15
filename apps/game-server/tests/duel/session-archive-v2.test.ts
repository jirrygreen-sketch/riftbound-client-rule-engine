import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyDuelResourceCommandV2, assertAdmittedDuelMatchV2,
  commitDuelCommandMutationV2, commitDuelPriorityPaymentV2,
  createDuelCommandSessionV2, createDuelPhaseSourceRegistryV2,
  issueDuelRequiredCostTaskV2,
  prepareDuelRequiredCostPaymentV2, referenceDuelPhysicalCardV2,
  runDuelStartOfTurnV2, runDuelEndOfTurnV2,
  type DuelCommandSessionV2, type DuelCatalogCardTypeV2 } from '@riftbound/engine-core/duel';
import { loadCardCatalogRuntime } from '../../src/card-catalog.js';
import { createDuelRuntimeSessionV2 } from '../../src/duel/runtime-v2.js';
import { decodeDuelV2CommittedArchiveData, exportDuelV2CommittedArchiveData,
  type DuelV2CommittedArchiveData } from '../../src/duel/session-archive-v2.js';
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from './fixtures/setup-adapter-catalog.js';

const imagesDirectory = fileURLToPath(new URL('./fixtures/', import.meta.url));
const championIds = new Set(setupAdapterFixtureDecks.a.submission.champion.map(c => c.cardId));
const legendIds = new Set(setupAdapterFixtureDecks.a.submission.legend.map(c => c.cardId));
const runeIds = new Set(setupAdapterFixtureDecks.a.submission.runes.map(c => c.cardId));
const battlefieldIds = new Set(setupAdapterFixtureDecks.a.submission.battlefields.map(c => c.cardId));
function testCardType(cardId: string): DuelCatalogCardTypeV2 {
  if (championIds.has(cardId)) return 'Champion';
  if (legendIds.has(cardId)) return 'Legend';
  if (runeIds.has(cardId)) return 'Rune';
  if (battlefieldIds.has(cardId)) return 'Battlefield';
  return 'Other';
}
function wire<T>(source: T): T { return JSON.parse(JSON.stringify(source)) as T; }
async function playing(): Promise<DuelCommandSessionV2> {
  const catalog = await loadCardCatalogRuntime({ catalog: setupAdapterFixtureCatalog, imagesDirectory });
  let uid = 0;
  let session = createDuelRuntimeSessionV2(catalog, [
    { playerId: 'alice', displayName: 'Alice', deck: setupAdapterFixtureDecks.a.submission },
    { playerId: 'bob', displayName: 'Bob', deck: setupAdapterFixtureDecks.b.submission },
  ], 'archive-v2-match', { randomIndex: () => 0, uidFactory: () => `archive-v2-uid-${++uid}`,
    trustedCardType: testCardType });
  for (let i = 0; i < 2; i++) {
    const actor = session.match.turnOrder[i]!;
    const executed = applyDuelResourceCommandV2(session, actor, { commandId: `mulligan-${i}`,
      expectedVersion: session.match.stateVersion, command: { type: 'mulligan', selectedUIDs: [] } });
    expect(executed.outcome.status).toBe('applied');
    session = executed.session;
  }
  expect(session.match.stage).toBe('playing');
  return session;
}
function sources(session: DuelCommandSessionV2) {
  const match = session.match;
  const printings = setupAdapterFixtureCatalog.cards.map(card => ({ cardId: card.id,
    programReference: `fixture:${card.id}` }));
  return createDuelPhaseSourceRegistryV2({ matchId: match.matchId,
    dataVersion: match.dataVersion, catalogDigest: match.catalogDigest, printings }, request => ({
    status: 'complete', matchId: request.matchId, dataVersion: request.dataVersion,
    catalogDigest: request.catalogDigest, turn: request.turn, taskId: request.taskId,
    uid: request.source.uid, zoneEpoch: request.source.zoneEpoch,
    controllerPlayerId: request.source.controllerPlayerId, cardId: request.source.cardId,
    programReference: `fixture:${request.source.cardId}`, event: request.event,
    eventSupported: true, scope: 'known-no-handler', replacementsCovered: true,
    staticCovered: true, continuousCovered: true, triggersCovered: true }));
}
function main(session: DuelCommandSessionV2): DuelCommandSessionV2 {
  const next = runDuelStartOfTurnV2(session, { sources: sources(session),
    fepr: () => ({ status: 'none' }) });
  expect(next.status).toBe('main');
  return next.session;
}
function attestor(request: Parameters<typeof commitDuelPriorityPaymentV2>[5] extends
  (argument: infer R) => unknown ? R : never) {
  const uid = request.sourceReference.sourceUID!;
  return { matchId: request.match.matchId, actor: request.actor,
    paymentId: request.paymentId, sourceReference: request.sourceReference,
    sourceProofId: `fixture-proof-${request.paymentId}`, mode: 'current' as const,
    sourceZoneEpoch: referenceDuelPhysicalCardV2(request.match, uid).zoneEpoch,
    ...(request.taskId ? { taskId: request.taskId, continuationId: request.continuationId } : {}) };
}
function envelope(session: DuelCommandSessionV2): DuelV2CommittedArchiveData {
  const m = session.match;
  return { archiveSchemaVersion: 1, kind: 'private-duel-v2-committed',
    identity: { roomId: 'private-room', matchId: m.matchId, rulesetId: 'riftbound-duel',
      dataVersion: m.dataVersion, catalogDigest: m.catalogDigest,
      rosterPlayerIds: m.roster.map(s => s.playerId) as [string, string] },
    branch: { commitSeq: 1, parentCommitSeq: 0, parentNonce: 'genesis-nonce',
      commitNonce: 'writer-nonce-1', stateVersion: m.stateVersion, eventSeq: m.eventSeq },
    candidate: { match: m as unknown as Record<string, unknown>, receipts: session.receipts,
      requiredTasks: session.requiredTasks, priorityPayments: session.priorityPayments,
      turnCursorV2: session.turnCursorV2 ?? null },
    proofHeads: { creation: 0, physical: 0, token: 0, resourceAndReadiness: 0,
      sourceAndCost: 0, commandLedger: 0, cursor: 0, programRegistry: 0 } };
}
function tamper(source: DuelV2CommittedArchiveData, change: (value: any) => void): void {
  const raw: any = wire(source);
  const before = JSON.stringify(raw);
  change(raw);
  const mutated = JSON.stringify(raw);
  expect(mutated).not.toBe(before);
  expect(() => decodeDuelV2CommittedArchiveData(raw)).toThrow(/Duel V2 archive data/);
  expect(JSON.stringify(raw)).toBe(mutated);
}

describe('private V2 committed archive DATA codec (not restore/CAS)', () => {
  it('round-trips a real playing V2 match with ordered roster and required explicit empty ledgers/null cursor', async () => {
    const session = await playing();
    const original = JSON.stringify(session);
    const data = envelope(session);
    const exported = exportDuelV2CommittedArchiveData(data);
    expect(JSON.stringify(session)).toBe(original);
    expect(exported).not.toBe(data);
    expect(exported.candidate.match).not.toBe(session.match);
    expect(exported.candidate.receipts).not.toBe(session.receipts);
    expect(exported.candidate.match).toEqual(wire(session.match));
    expect(exported.candidate).toHaveProperty('turnCursorV2', null);
    expect(exported.candidate.requiredTasks).toEqual([]);
    expect(exported.candidate.priorityPayments).toEqual([]);
    const decoded = decodeDuelV2CommittedArchiveData(wire(exported));
    expect(decoded).toEqual(exported);
    expect(JSON.stringify(decoded)).toBe(JSON.stringify(exported));
    (exported.candidate.match as any).matchId = 'detached-only';
    expect(session.match.matchId).toBe('archive-v2-match');
    expect(() => assertAdmittedDuelMatchV2(decoded.candidate.match)).toThrow(/untrusted V2 state/);
    const clone = wire(session);
    expect(() => applyDuelResourceCommandV2(clone, 'alice', { commandId: 'must-not-run',
      expectedVersion: session.match.stateVersion, command: { type: 'rune-energy', uid: 'none' } }))
      .toThrow(/unadmitted V2 session/);
  });

  it('rejects schema downgrade/V1 mixing, unmatched branch clocks and changed identity', async () => {
    const source = envelope(await playing());
    tamper(source, a => { a.archiveSchemaVersion = 0; });
    tamper(source, a => { a.kind = 'duel-command-session'; });
    tamper(source, a => { a.candidate.match.schemaVersion = 1; });
    tamper(source, a => { a.candidate.match.stage = 'setup'; });
    tamper(source, a => { a.branch.commitSeq = 3; });
    tamper(source, a => { a.branch.commitNonce = a.branch.parentNonce; });
    tamper(source, a => { a.branch.eventSeq++; });
    tamper(source, a => { a.candidate.match.eventSeq++; });
    tamper(source, a => { a.branch.stateVersion = Number.MAX_SAFE_INTEGER + 1; });
    tamper(source, a => { a.identity.roomId = ' '; });
    tamper(source, a => { a.identity.matchId = 'different'; });
    tamper(source, a => { a.identity.dataVersion = 'different'; });
    tamper(source, a => { a.identity.catalogDigest = 'different'; });
    tamper(source, a => { a.identity.rosterPlayerIds.reverse(); });
    tamper(source, a => { a.identity.rosterPlayerIds[1] = 'alice'; });
    tamper(source, a => { a.candidate.match.roster[0].playerId = 'outsider'; });
    tamper(source, a => { a.candidate.match.turnOrder = ['alice', 'alice']; });
    tamper(source, a => { a.candidate.match.players[0].hand[0].uid =
      a.candidate.match.players[1].hand[0].uid; });
    tamper(source, a => { a.candidate.match.resources.players[0].runePool.energy = -1; });
    tamper(source, a => { a.candidate.match.physicalCardsByUID['foreign-uid'] = {
      cardId: 'forged', ownerPlayerId: 'alice', origin: 'created', zoneEpoch: 0 }; });
    tamper(source, a => { a.candidate.match.provenance.transitions.push({
      uid: 'not-a-genesis-uid', from: { kind: 'hand', zonePlayerId: 'alice' },
      to: { kind: 'main-deck', zonePlayerId: 'alice' } }); });
    tamper(source, a => { a.candidate.match.provenance.transitions.push({
      uid: Object.keys(a.candidate.match.provenance.initialZonesByUID)[0],
      from: { kind: 'hand', zonePlayerId: 'alice' }, to: { kind: 'hand', zonePlayerId: 'alice' } }); });
  });

  it('rejects missing proof domain, ledger/cursor fields and extra arbitrary sidecars', async () => {
    const source = envelope(await playing());
    for (const key of Object.keys(source.proofHeads))
      tamper(source, a => { delete a.proofHeads[key]; });
    tamper(source, a => { a.proofHeads.cursor = -1; });
    tamper(source, a => { a.proofHeads.creation = 1.5; });
    for (const key of ['receipts', 'requiredTasks', 'priorityPayments', 'turnCursorV2'])
      tamper(source, a => { delete a.candidate[key]; });
    tamper(source, a => { a.candidate.proof = { trusted: true }; });
    tamper(source, a => { a.candidate.turnCursorV2 = {}; });
    tamper(source, a => { a.session = a.candidate; });
    tamper(source, a => { a.candidate.receipts.push(a.candidate.receipts[0]); });
    tamper(source, a => { a.candidate.receipts[0].outcome.appliedVersion = 999; });
    tamper(source, a => { a.candidate.receipts[0].actor = 'outsider'; });
    tamper(source, a => { a.candidate.match.frame.pendingPayment = { paymentId: 'unbound', actor: 'alice',
      resolvedCost: { energy: 0, power: [] }, sourceReference: { kind: 'card', referenceId: 'a' } }; });
    tamper(source, a => { a.candidate.requiredTasks.push({ matchId: source.identity.matchId,
      expectedVersion: 2, taskId: 'task', paymentId: 'payment', actor: 'alice',
      finalResolvedCost: { energy: 0, power: [] }, opaqueSource: { kind: 'effect', referenceId: 'source' },
      continuationId: 'continuation', status: 'issued' }); });
  });

  it('rejects arbitrary JSON graph tricks before accessing getters or silently serializing holes', async () => {
    const source = envelope(await playing());
    const getter = wire(source);
    Object.defineProperty(getter.candidate, 'receipts', { enumerable: true,
      get() { throw new Error('getter invoked'); } });
    expect(() => decodeDuelV2CommittedArchiveData(getter)).toThrow(/Duel V2 archive data/);
    const sparse = wire(source);
    (sparse.candidate as any).receipts = Array(1);
    expect(() => decodeDuelV2CommittedArchiveData(sparse)).toThrow(/dense array/);
    const symbol = wire(source);
    Object.defineProperty(symbol, Symbol('hidden'), { value: 1 });
    expect(() => decodeDuelV2CommittedArchiveData(symbol)).toThrow();
    const prototype = wire(source);
    Object.setPrototypeOf(prototype.identity, { roomId: 'shadow' });
    expect(() => decodeDuelV2CommittedArchiveData(prototype)).toThrow(/plain prototype/);
    const undefinedLedger = wire(source);
    (undefinedLedger.candidate as any).requiredTasks = undefined;
    expect(() => decodeDuelV2CommittedArchiveData(undefinedLedger)).toThrow();
    const extraArrayKey = wire(source);
    Object.defineProperty(extraArrayKey.candidate.receipts, 'shadow', { value: true });
    expect(() => decodeDuelV2CommittedArchiveData(extraArrayKey)).toThrow();
  });

  it('rejects tampered V2-only carriers and replayed physical positions/epochs', async () => {
    const source = envelope(await playing());
    const match: any = source.candidate.match;
    const handUID = match.players[0].hand[0].uid;
    tamper(source, a => { a.candidate.match.gears = ['not-a-gear']; });
    tamper(source, a => { a.candidate.match.legendStates[match.players[0].legend.uid] = 'not-a-legend-state'; });
    tamper(source, a => { a.candidate.match.legendStates[match.players[0].legend.uid].controllerPlayerId = 'outsider'; });
    tamper(source, a => { a.candidate.match.legendStates[match.players[0].legend.uid].readiness = 'impossible'; });
    tamper(source, a => { delete a.candidate.match.legendStates[match.players[0].legend.uid]; });
    tamper(source, a => { a.candidate.match.physicalCardsByUID[handUID].zoneEpoch = 1; });
    tamper(source, a => { a.candidate.match.provenance.transitions.push({ uid: handUID,
      from: { kind: 'hand', zonePlayerId: 'alice' }, to: { kind: 'trash', zonePlayerId: 'alice' } },
    { uid: handUID, from: { kind: 'trash', zonePlayerId: 'alice' },
      to: { kind: 'hand', zonePlayerId: 'alice' } }); });
    tamper(source, a => { a.candidate.match.provenance.transitions.push({ uid: handUID,
      from: { kind: 'hand', zonePlayerId: 'alice' }, to: { kind: 'trash', zonePlayerId: 'alice' } },
    { uid: handUID, from: { kind: 'trash', zonePlayerId: 'alice' },
      to: { kind: 'hand', zonePlayerId: 'alice' } });
    a.candidate.match.physicalCardsByUID[handUID].zoneEpoch = 2;
    a.candidate.match.provenance.transitions[1].from.zonePlayerId = 'bob'; });
    // An internally consistent invented round trip is *not* an attested history.
    const selfReported: any = wire(source);
    selfReported.candidate.match.provenance.transitions.push({ uid: handUID,
      from: { kind: 'hand', zonePlayerId: 'alice' }, to: { kind: 'trash', zonePlayerId: 'alice' } },
    { uid: handUID, from: { kind: 'trash', zonePlayerId: 'alice' },
      to: { kind: 'hand', zonePlayerId: 'alice' } });
    selfReported.candidate.match.physicalCardsByUID[handUID].zoneEpoch = 2;
    expect(decodeDuelV2CommittedArchiveData(selfReported).candidate.match)
      .toEqual(selfReported.candidate.match);
    expect(() => assertAdmittedDuelMatchV2(selfReported.candidate.match))
      .toThrow(/untrusted V2 state/);
    tamper(source, a => { a.candidate.match.provenance.transitions.push({ uid: handUID,
      from: { kind: 'hand', zonePlayerId: 'alice' },
      to: { kind: 'board-base', locationId: 'missing-base' } }); });
    tamper(source, a => { a.candidate.match.players[0].hand[0].uid = 'nonexistent-current-uid'; });
  });

  it('round-trips a real nonempty Gear and Legend state with engine-issued physical transitions', async () => {
    // A dedicated engine fixture supplies one Gear printing in an actual starting deck;
    // the server catalog fixture has none and cannot attest one for a room.
    const ids = ['alice', 'bob'] as const;
    const seats = ids.map(playerId => ({ playerId,
      mainDeck: Array.from({ length: 10 }, (_, index) => ({ uid: `${playerId}-card-${index}`,
        cardId: playerId === 'alice' && index === 9 ? 'fixture-gear' : 'fixture-unit' })),
      champion: { uid: `${playerId}-champ`, cardId: 'fixture-champion' },
      legend: { uid: `${playerId}-legend`, cardId: 'fixture-legend' },
      runeDeck: Array.from({ length: 6 }, (_, index) => ({ uid: `${playerId}-rune-${index}`,
        cardId: 'fixture-rune', domain: 'Fury' as const })),
      battlefields: Array.from({ length: 3 }, (_, index) => ({ instanceId: `${playerId}-field-${index}`,
        cardId: `fixture-field-${index}` })),
    })) as Parameters<typeof createDuelCommandSessionV2>[0];
    const types = (cardId: string): DuelCatalogCardTypeV2 => cardId === 'fixture-gear' ? 'Gear' :
      cardId === 'fixture-champion' ? 'Champion' : cardId === 'fixture-legend' ? 'Legend' :
        cardId === 'fixture-rune' ? 'Rune' : cardId.startsWith('fixture-field-') ? 'Battlefield' : 'Unit';
    let session = createDuelCommandSessionV2(seats, { matchId: 'archive-gear-match',
      dataVersion: 'fixture-gear', catalogDigest: 'fixture-gear-digest',
      roster: ids.map(playerId => ({ playerId, displayName: playerId })) as
        [{ playerId: string; displayName: string }, { playerId: string; displayName: string }] },
    () => 0, types);
    for (const actor of session.match.turnOrder) {
      const result = applyDuelResourceCommandV2(session, actor, {
        commandId: `gear-mulligan-${actor}`, expectedVersion: session.match.stateVersion,
        command: { type: 'mulligan', selectedUIDs: [] } });
      expect(result.outcome.status).toBe('applied');
      session = result.session;
    }
    expect(session.match.stage).toBe('playing');
    if (session.match.stage !== 'playing') return;
    const deck = session.match.players[0].remainingMainDeck;
    const gear = deck.find(card => card.cardId === 'fixture-gear')!;
    const swapped = session.match.players[0].hand[0]!;
    session = commitDuelCommandMutationV2(session, draft => ({
      match: { ...draft, players: draft.players.map(player => player.playerId === 'alice'
        ? { ...player, hand: [gear, ...player.hand.filter(c => c.uid !== swapped.uid)],
          remainingMainDeck: [swapped, ...player.remainingMainDeck.filter(c => c.uid !== gear.uid)] }
        : player) as typeof draft.players },
      transitions: [
        { uid: gear.uid, from: { kind: 'main-deck', zonePlayerId: 'alice' },
          to: { kind: 'hand', zonePlayerId: 'alice' } },
        { uid: swapped.uid, from: { kind: 'hand', zonePlayerId: 'alice' },
          to: { kind: 'main-deck', zonePlayerId: 'alice' } },
      ] })).session;
    const match = session.match;
    expect(match.stage).toBe('playing');
    if (match.stage !== 'playing') return;
    const boardLocation = match.board.bases.find(base => base.ownerPlayerId === 'alice')!.locationId;
    // The admitted session mutation bridge supplies the genuine hand-to-board
    // physical transition and publishes the engine-validated Gear carrier.
    session = commitDuelCommandMutationV2(session, draft => ({
      match: { ...draft, players: draft.players.map(player => ({ ...player,
        hand: player.hand.filter(card => card.uid !== gear.uid) })) as typeof draft.players,
        gears: [...draft.gears, { uid: gear.uid, controllerPlayerId: 'alice',
          locationId: boardLocation, readied: true, attachedToUID: null }] },
      transitions: [{ uid: gear.uid, from: { kind: 'hand', zonePlayerId: 'alice' },
        to: { kind: 'board-base', locationId: boardLocation } }] })).session;
    const checked = decodeDuelV2CommittedArchiveData(wire(envelope(session)));
    expect((checked.candidate.match as any).gears).toHaveLength(1);
    expect(Object.keys((checked.candidate.match as any).legendStates)).toHaveLength(2);
    expect((checked.candidate.match as any).physicalCardsByUID[gear.uid].zoneEpoch).toBe(2);
    tamper(checked, a => { a.candidate.match.gears[0].attachedToUID = 'missing-host'; });
    tamper(checked, a => { a.candidate.match.gears[0].readied = 'ready'; });
    tamper(checked, a => { a.candidate.match.gears[0].locationId = 'missing-location'; });
    tamper(checked, a => { a.candidate.match.gears.push(a.candidate.match.gears[0]); });
    tamper(checked, a => { a.candidate.match.legendStates[match.players[0].legend.uid].readiness = null; });
  });

  it('keeps real command/payment/cursor as untrusted data and rejects impossible ledger/cursor claims', async () => {
    let session = main(await playing());
    const cursorData = decodeDuelV2CommittedArchiveData(wire(envelope(session)));
    expect(cursorData.candidate.turnCursorV2).toEqual(wire(session.turnCursorV2));
    expect(cursorData.candidate.turnCursorV2?.step).toBe('main');
    tamper(cursorData, a => { a.candidate.turnCursorV2.eventSeq++; });
    tamper(cursorData, a => { delete a.candidate.turnCursorV2.consumedIDs; });
    tamper(cursorData, a => { a.candidate.turnCursorV2.consumedIDs.push('duplicate', 'duplicate'); });
    tamper(cursorData, a => { a.candidate.turnCursorV2.consumedIDs.push(
      `duel-v2:${a.identity.matchId}:turn-1:fiction:0`); });
    tamper(cursorData, a => { a.candidate.turnCursorV2.pendingTaskID = 'fake'; });
    tamper(cursorData, a => { a.candidate.turnCursorV2.consumedIDs[0] =
      `duel-v2:${a.identity.matchId}:turn-1:hold:999`; });

    const actor = session.match.frame.turnPlayerId;
    const handUID = session.match.players.find(p => p.playerId === actor)!.hand[0]!.uid;
    const src = { kind: 'card' as const, referenceId: 'fixture-source', sourceUID: handUID };
    const cost = { energy: 0, power: [] };
    const prepared = commitDuelPriorityPaymentV2(session, actor, 'payment-1', cost, src, attestor);
    session = prepared.session;
    const checked = decodeDuelV2CommittedArchiveData(wire(envelope(session)));
    expect(checked.candidate.priorityPayments).toHaveLength(1);
    expect(checked.candidate.match).toHaveProperty('frame.pendingPayment.paymentId', 'payment-1');
    tamper(checked, a => { a.candidate.priorityPayments[0].sourceBinding.sourceProofId = ''; });
    tamper(checked, a => { a.candidate.priorityPayments[0].sourceBinding.actor = 'bob'; });
    tamper(checked, a => { a.candidate.priorityPayments.push(a.candidate.priorityPayments[0]); });
    tamper(checked, a => { delete a.candidate.priorityPayments[0].sourceBinding; });
    tamper(checked, a => { a.candidate.priorityPayments[0].finalResolvedCost.energy = 1; });
    tamper(checked, a => { a.candidate.match.frame.pendingPayment = null; });
    tamper(checked, a => { a.candidate.priorityPayments[0].sourceBinding.sourceReference.sourceUID = 'missing-uid';
      a.candidate.priorityPayments[0].opaqueSource.sourceUID = 'missing-uid';
      a.candidate.match.frame.pendingPayment.sourceReference.sourceUID = 'missing-uid'; });
    tamper(checked, a => { a.candidate.priorityPayments[0].sourceBinding.sourceZoneEpoch = 999; });
    const paid = applyDuelResourceCommandV2(session, actor, { commandId: 'pay-real',
      expectedVersion: session.match.stateVersion,
      command: { type: 'pay-pending', paymentId: 'payment-1' } }, { sourceAttestor: attestor });
    expect(paid.outcome.status).toBe('applied');
    const done = decodeDuelV2CommittedArchiveData(wire(envelope(paid.session)));
    expect(done.candidate.priorityPayments[0]?.status).toBe('completed');
    expect(done.candidate.receipts.at(-1)?.outcome.status).toBe('applied');
    // A completed "current" attestation belongs to its payment's earlier clock.
    // Moving the source in a later admitted mutation must not retroactively reject
    // the persisted receipt and historical payment binding at today's epoch.
    const moved = commitDuelCommandMutationV2(paid.session, draft => ({
      match: { ...draft, players: draft.players.map(player => player.playerId === actor
        ? { ...player, hand: player.hand.filter(card => card.uid !== handUID),
          trash: [...player.trash, player.hand.find(card => card.uid === handUID)!] }
        : player) as typeof draft.players },
      transitions: [{ uid: handUID, from: { kind: 'hand', zonePlayerId: actor },
        to: { kind: 'trash', zonePlayerId: actor } }],
    })).session;
    expect(decodeDuelV2CommittedArchiveData(wire(envelope(moved)))
      .candidate.priorityPayments[0]?.status).toBe('completed');
    for (const reason of ['invalid-command', 'unknown-actor', 'command-conflict'])
      tamper(done, a => { a.candidate.receipts.push({ actor, commandId: `fake-${reason}`,
        payloadFingerprint: JSON.stringify({ type: 'rune-energy', uid: handUID }),
        outcome: { status: 'rejected', reason } }); });
    const endingRegistry = sources(paid.session);
    const waiting = runDuelEndOfTurnV2(paid.session, actor, { sources: endingRegistry,
      fepr: () => ({ status: 'pending' }) });
    expect(waiting.status).toBe('pending');
    expect(waiting.session.turnCursorV2?.step).toBe('special-fepr');
    // Real end-drive carries the ordered special cleanup IDs in one round.
    expect(waiting.session.turnCursorV2?.consumedIDs).toBeDefined();
    expect(decodeDuelV2CommittedArchiveData(wire(envelope(waiting.session)))
      .candidate.turnCursorV2?.step).toBe('special-fepr');
    const ended = runDuelEndOfTurnV2(paid.session, actor, { sources: endingRegistry,
      fepr: () => ({ status: 'none' }) });
    expect(ended.status).toBe('awaiting-turn-start');
    expect(decodeDuelV2CommittedArchiveData(wire(envelope(ended.session)))
      .candidate.turnCursorV2?.step).toBe('awaiting-turn-start');
    const second = runDuelStartOfTurnV2(ended.session, { sources: sources(ended.session),
      fepr: () => ({ status: 'none' }) });
    expect(second.status).toBe('main');
    expect(decodeDuelV2CommittedArchiveData(wire(envelope(second.session)))
      .candidate.turnCursorV2?.firstChannelProcessedPlayerIDs)
      .toEqual([second.session.match.turnOrder[1]]);
    const secondEnd = runDuelEndOfTurnV2(second.session,
      second.session.match.frame.turnPlayerId, { sources: sources(second.session),
        fepr: () => ({ status: 'none' }) });
    expect(secondEnd.status).toBe('awaiting-turn-start');
    expect(decodeDuelV2CommittedArchiveData(wire(envelope(secondEnd.session)))
      .candidate.turnCursorV2?.step).toBe('awaiting-turn-start');
  }, 30_000);

  it('keeps issued/active required tasks only in the live phase and rejects invented current sources', async () => {
    const idle = envelope(await playing());
    const task = { matchId: idle.identity.matchId, expectedVersion: 2,
      taskId: 'task-real', paymentId: 'payment-required', actor: 'alice',
      finalResolvedCost: { energy: 0, power: [] },
      opaqueSource: { kind: 'card', referenceId: 'fixture',
        sourceUID: (idle.candidate.match as any).players[0].hand[0].uid },
      continuationId: 'continuation-real', status: 'issued',
      sourceBinding: { matchId: idle.identity.matchId, actor: 'alice',
        paymentId: 'payment-required', sourceReference: { kind: 'card', referenceId: 'fixture',
          sourceUID: (idle.candidate.match as any).players[0].hand[0].uid },
        sourceProofId: 'fixture-proof', mode: 'current', sourceZoneEpoch: 0,
        taskId: 'task-real', continuationId: 'continuation-real' } };
    tamper(idle, a => { a.candidate.requiredTasks.push(task); });
    tamper(idle, a => { a.candidate.requiredTasks.push({ ...task, status: 'active' });
      a.candidate.match.frame.pendingPayment = { paymentId: task.paymentId, actor: task.actor,
        sourceReference: task.opaqueSource, resolvedCost: task.finalResolvedCost }; });
    const active = main(await playing());
    const actor = active.match.frame.turnPlayerId;
    const uid = active.match.players.find(p => p.playerId === actor)!.hand[0]!.uid;
    const issued = issueDuelRequiredCostTaskV2(active, { matchId: active.match.matchId,
      expectedVersion: active.match.stateVersion, taskId: 'task-real',
      paymentId: 'payment-required', actor, finalResolvedCost: task.finalResolvedCost,
      opaqueSource: { kind: 'card', referenceId: 'fixture', sourceUID: uid },
      continuationId: 'continuation-real' }, attestor);
    expect(decodeDuelV2CommittedArchiveData(wire(envelope(issued.session)))
      .candidate.requiredTasks[0]?.status).toBe('issued');
    const prepared = prepareDuelRequiredCostPaymentV2(issued.session, issued.authority, attestor);
    const checked = decodeDuelV2CommittedArchiveData(wire(envelope(prepared.session)));
    expect(checked.candidate.requiredTasks[0]?.status).toBe('active');
    tamper(checked, a => { a.candidate.requiredTasks[0].sourceBinding.sourceZoneEpoch = 999; });
    tamper(checked, a => { a.candidate.requiredTasks[0].opaqueSource.sourceUID = 'nonexistent-uid';
      a.candidate.requiredTasks[0].sourceBinding.sourceReference.sourceUID = 'nonexistent-uid';
      a.candidate.match.frame.pendingPayment.sourceReference.sourceUID = 'nonexistent-uid'; });
    const paid = applyDuelResourceCommandV2(prepared.session, actor, {
      commandId: 'pay-task', expectedVersion: prepared.session.match.stateVersion,
      command: { type: 'pay-pending', paymentId: 'payment-required' } }, { sourceAttestor: attestor });
    expect(paid.outcome.status).toBe('applied');
    expect(decodeDuelV2CommittedArchiveData(wire(envelope(paid.session)))
      .candidate.requiredTasks[0]?.status).toBe('completed');
  });
});
