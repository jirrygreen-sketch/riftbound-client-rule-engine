import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applyDuelResourceCommand, createDuelMatch, issueDuelRequiredCostTask,
  prepareDuelRequiredCostPayment, projectCanonicalDuelMatch,
  type DuelCommandSession, type DuelRequiredCostTask,
} from '../../../../packages/engine-core/src/duel/index.js';
import { loadCardCatalogRuntime } from '../../src/card-catalog.js';
import { buildDuelSetupSeats } from '../../src/duel/setup-seats.js';
import {
  DuelSessionArchiveError, exportDuelSessionArchive, restoreDuelSessionArchive,
  type DuelSessionRestoreContext,
} from '../../src/duel/session-archive.js';
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from './fixtures/setup-adapter-catalog.js';

const imagesDirectory = fileURLToPath(new URL('./fixtures/', import.meta.url));
function copy<T>(source: T): T { return structuredClone(source); }
function wire<T>(source: T): T { return JSON.parse(JSON.stringify(source)) as T; }
function failure(code: DuelSessionArchiveError['code']): RegExp {
  return new RegExp(`^Duel session archive \\(${code}\\):`);
}
let sequence = 0;
async function fixture(): Promise<{ session: DuelCommandSession; context: DuelSessionRestoreContext }> {
  const runtime = await loadCardCatalogRuntime({ catalog: setupAdapterFixtureCatalog, imagesDirectory });
  const built = buildDuelSetupSeats(runtime, { matchId: 'archive-match', seats: [
    { playerId: 'alice', displayName: 'Alice', deck: setupAdapterFixtureDecks.a.submission },
    { playerId: 'bob', displayName: 'Bob', deck: setupAdapterFixtureDecks.b.submission },
  ] }, () => `archive-uid-${++sequence}`);
  if (!built.ok) throw new Error(`fixture failed: ${built.code}`);
  const match = createDuelMatch(built.seats, built.metadata, () => 0);
  return { session: { match, receipts: [] }, context: {
    expectedMatchId: built.metadata.matchId,
    expectedRoster2: built.metadata.roster,
    expectedCatalog: { dataVersion: built.metadata.dataVersion,
      catalogDigest: built.metadata.catalogDigest },
  } };
}
function restore(session: DuelCommandSession, context: DuelSessionRestoreContext): DuelCommandSession {
  return restoreDuelSessionArchive(wire(exportDuelSessionArchive(session)), context);
}
function mulligan(session: DuelCommandSession, actor: string, commandId: string): DuelCommandSession {
  const result = applyDuelResourceCommand(session, actor,
    { commandId, expectedVersion: session.match.stateVersion, command: { type: 'mulligan', selectedUIDs: [] } });
  expect(result.outcome.status).toBe('applied');
  return result.session;
}
function playing(session: DuelCommandSession): DuelCommandSession {
  const [first, second] = session.match.turnOrder;
  return mulligan(mulligan(session, first, 'mulligan-1'), second, 'mulligan-2');
}
function priority(session: DuelCommandSession): DuelCommandSession {
  if (session.match.stage !== 'playing') throw new Error('expected playing');
  return { ...session, match: { ...session.match, frame: {
    ...session.match.frame, phase: 'main', priorityPlayerId: session.match.turnOrder[0]!,
  } } };
}
function task(session: DuelCommandSession): DuelRequiredCostTask {
  return { matchId: session.match.matchId, expectedVersion: session.match.stateVersion,
    taskId: 'task-1', paymentId: 'payment-1', actor: session.match.turnOrder[0]!,
    finalResolvedCost: { energy: 0, power: [] },
    opaqueSource: { kind: 'effect', referenceId: 'trusted-fixture-resolver' },
    continuationId: 'continue-1' };
}
function verified(source: DuelRequiredCostTask): DuelSessionRestoreContext['requiredTaskSourceValidator'] {
  // Fixture-local independent registry: expectations are captured BEFORE reading disk JSON.
  const expected = wire(source);
  return (candidate, match) => match.matchId === expected.matchId &&
    candidate.status !== undefined && candidate.matchId === expected.matchId &&
    candidate.expectedVersion === expected.expectedVersion && candidate.taskId === expected.taskId &&
    candidate.paymentId === expected.paymentId && candidate.actor === expected.actor &&
    candidate.continuationId === expected.continuationId &&
    JSON.stringify(candidate.finalResolvedCost) === JSON.stringify(expected.finalResolvedCost) &&
    JSON.stringify(candidate.opaqueSource) === JSON.stringify(expected.opaqueSource);
}

describe('private formal duel session archive', () => {
  it('exports detached JSON-only setup without mutating input; restores full hidden hands and rejects public leaks', async () => {
    const { session, context } = await fixture();
    const before = JSON.stringify(session);
    const archive = exportDuelSessionArchive(session);
    expect(JSON.stringify(session)).toBe(before);
    expect(archive.session).not.toBe(session);
    expect(archive.session.match).not.toBe(session.match);
    const recovered = restoreDuelSessionArchive(wire(archive), context);
    expect(recovered.match).toEqual(session.match);
    if (recovered.match.stage !== 'setup' || session.match.stage !== 'setup') throw new Error('expected setup');
    expect(recovered.match.setup.players[0]?.hand).toEqual(session.match.setup.players[0]?.hand);
    const own = projectCanonicalDuelMatch(recovered.match, recovered.match.roster[0].playerId);
    expect(own.stage).toBe('setup');
    if (own.stage !== 'setup') throw new Error('expected projection');
    expect(own.setup.players[0]?.hand).toHaveLength(4);
    expect(own.setup.players[1]).not.toHaveProperty('hand');
    expect(JSON.stringify(own)).not.toContain(session.match.setup.players[1]!.hand[0]!.uid);
    (archive.session.match as { matchId: string }).matchId = 'detached-export';
    expect(session.match.matchId).toBe(context.expectedMatchId);
    const bad = wire(exportDuelSessionArchive(session));
    (bad.session as typeof bad.session & { turnProgress?: unknown }).turnProgress = { secret: true };
    expect(() => restoreDuelSessionArchive(bad, context))
      .toThrowError(failure('unsupported-sidecar'));
    const nested = wire(exportDuelSessionArchive(session));
    (nested.session.match as typeof nested.session.match & { turnProgress?: unknown }).turnProgress = { secret: true };
    expect(() => restoreDuelSessionArchive(nested, context))
      .toThrowError(failure('invalid-archive'));
  });

  it('restores after two actual commands and uses the latest match for duplicate vs conflict, scoped by actor', async () => {
    const { session, context } = await fixture();
    const current = playing(session);
    const recovered = restore(current, context);
    expect(recovered.match.stage).toBe('playing');
    if (recovered.match.stage !== 'playing') return;
    expect(recovered.match.stateVersion).toBe(2);
    const first = session.match.turnOrder[0]!;
    const duplicate = applyDuelResourceCommand(recovered, first,
      { commandId: 'mulligan-1', expectedVersion: 0, command: { type: 'mulligan', selectedUIDs: [] } });
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.persistRequired).toBe(false);
    expect(duplicate.match).toBe(recovered.match);
    expect(duplicate.session.receipts).toHaveLength(2);
    expect(duplicate.match.stateVersion).toBe(2);
    expect(applyDuelResourceCommand(recovered, first,
      { commandId: 'mulligan-1', expectedVersion: 0, command: { type: 'mulligan', selectedUIDs: ['other'] } })
      .outcome).toEqual({ status: 'rejected', reason: 'command-conflict' });
    const other = session.match.turnOrder[1]!;
    const unrelated = applyDuelResourceCommand(recovered, other,
      { commandId: 'mulligan-1', expectedVersion: 2, command: { type: 'mulligan', selectedUIDs: [] } });
    expect(unrelated.duplicate).toBe(false);
    expect(unrelated.outcome).toEqual({ status: 'rejected', reason: 'invalid-stage' });
    const view = projectCanonicalDuelMatch(recovered.match, first);
    expect(view.stage).toBe('playing');
    if (view.stage === 'playing') {
      expect(view.players[0].hand).toEqual(recovered.match.players[0].playerId === first
        ? recovered.match.players[0].hand : undefined);
      expect(view.players.find(player => player.playerId === other)).not.toHaveProperty('hand');
      expect(view).not.toHaveProperty('receipts');
    }
  });

  it('binds to independently expected match, both roster seats/names, and dataVersion/digest', async () => {
    const { session, context } = await fixture();
    const archive = exportDuelSessionArchive(session);
    for (const changed of [
      { ...context, expectedMatchId: 'wrong' },
      { ...context, expectedRoster2: [context.expectedRoster2[1], context.expectedRoster2[0]] as typeof context.expectedRoster2 },
      { ...context, expectedRoster2: [{ ...context.expectedRoster2[0], displayName: 'Forged' },
        context.expectedRoster2[1]] as typeof context.expectedRoster2 },
      { ...context, expectedCatalog: { ...context.expectedCatalog, dataVersion: 'old' } },
      { ...context, expectedCatalog: { ...context.expectedCatalog, catalogDigest: 'changed' } },
    ]) expect(() => restoreDuelSessionArchive(archive, changed)).toThrowError(failure('context-mismatch'));
    expect(() => restoreDuelSessionArchive(archive, undefined as unknown as DuelSessionRestoreContext))
      .toThrowError(failure('invalid-archive'));
  });

  it('rejects unknown fields, functions, accessors, symbols and sparse arrays rather than silently dropping them', async () => {
    const { session, context } = await fixture();
    for (const sidecar of ['turnProgress', 'pendingTasks', 'privateSidecar']) {
      const archive = wire(exportDuelSessionArchive(session)) as unknown as { session: Record<string, unknown> };
      archive.session[sidecar] = { count: 1 };
      expect(() => restoreDuelSessionArchive(archive, context)).toThrowError(failure('unsupported-sidecar'));
    }
    const getter = wire(exportDuelSessionArchive(session));
    Object.defineProperty(getter.session, 'receipts', { get() { throw new Error('invoked'); }, enumerable: true });
    expect(() => restoreDuelSessionArchive(getter, context)).toThrowError(failure('invalid-archive'));
    const sparse = wire(exportDuelSessionArchive(session));
    (sparse.session as unknown as { receipts: unknown[] }).receipts = Array(1);
    expect(() => restoreDuelSessionArchive(sparse, context)).toThrowError(failure('invalid-archive'));
    const symbol = wire(exportDuelSessionArchive(session));
    Object.defineProperty(symbol, Symbol('hidden'), { value: 1 });
    expect(() => restoreDuelSessionArchive(symbol, context)).toThrowError(failure('invalid-archive'));
    const fn = wire(exportDuelSessionArchive(session));
    (fn.session as unknown as { receipts: unknown[] }).receipts.push(() => 'capability');
    expect(() => restoreDuelSessionArchive(fn, context)).toThrowError(failure('invalid-archive'));
  });

  it('reuses strict setup validation for 4-hand, UID collision, removed fields, and mulligan clocks', async () => {
    const { session, context } = await fixture();
    const mutate = (change: (raw: any) => void) => {
      const raw = wire(exportDuelSessionArchive(session));
      change(raw);
      expect(() => restoreDuelSessionArchive(raw, context)).toThrowError(failure('invalid-archive'));
    };
    mutate(raw => raw.session.match.setup.players[0].hand.pop());
    mutate(raw => { raw.session.match.setup.players[1].hand[0].uid = raw.session.match.setup.players[0].hand[0].uid; });
    mutate(raw => { raw.session.match.setup.selection.removedByPlayer[0].battlefields[0].instanceId =
      raw.session.match.setup.selection.selected[0].instanceId; });
    mutate(raw => { raw.session.match.stateVersion = 1; });
  });

  it('validates the entire private playing graph and frame, not a public projection', async () => {
    const { session, context } = await fixture();
    const current = playing(session);
    const mutate = (change: (raw: any) => void) => {
      const raw = wire(exportDuelSessionArchive(current));
      change(raw);
      expect(() => restoreDuelSessionArchive(raw, context)).toThrowError(failure('invalid-archive'));
    };
    mutate(raw => { raw.session.match.players[0].remainingMainDeck[0].uid = raw.session.match.players[1].hand[0].uid; });
    mutate(raw => { raw.session.match.resources.players[0].runeDeck[0].uid = raw.session.match.players[0].hand[0].uid; });
    mutate(raw => { raw.session.match.board.battlefields[0].instanceId = raw.session.match.players[0].hand[0].uid; });
    mutate(raw => { raw.session.match.frame.priorityPlayerId = 'outsider'; });
    mutate(raw => { raw.session.match.frame.pendingPayment = { paymentId: 'pending', actor: 'outsider',
      resolvedCost: { energy: 0, power: [] }, sourceReference: { kind: 'effect', referenceId: 'source' } }; });
  });

  it('rejects duplicate receipts, future/drifted clock, unsupported reason, and noncanonical or forged fingerprint', async () => {
    const { session, context } = await fixture();
    const current = playing(session);
    const mutate = (change: (raw: any) => void) => {
      const raw = wire(exportDuelSessionArchive(current));
      change(raw);
      expect(() => restoreDuelSessionArchive(raw, context)).toThrowError(failure('invalid-archive'));
    };
    mutate(raw => raw.session.receipts.push(copy(raw.session.receipts[0])));
    mutate(raw => raw.session.receipts[0].outcome.appliedVersion = 999);
    mutate(raw => raw.session.receipts[0].outcome.eventSeq = 2);
    mutate(raw => { raw.session.receipts[0].outcome = { status: 'rejected', reason: 'secret-reason' }; });
    mutate(raw => raw.session.receipts[0].payloadFingerprint = '{"type":"mulligan","selectedUIDs":[]}');
    mutate(raw => raw.session.receipts[0].payloadFingerprint = '{"selectedUIDs":[],"type":"other"}');
    mutate(raw => raw.session.receipts[0].payloadFingerprint = '{"selectedUIDs":[],"type":"mulligan","expectedVersion":0}');
    mutate(raw => { raw.session.receipts[0].outcome = { status: 'applied', appliedVersion: 1,
      eventSeq: 1, paymentCompleted: { paymentId: 'fake', plan: { power: [] },
        sourceReference: { kind: 'effect', referenceId: 'fake' } } }; });
    mutate(raw => { raw.session.receipts[0].actor = 'outsider'; });
  });

  it('rejects required-task ledger without independent final-cost/source attestation; accepts fixed fixture registry', async () => {
    const { session, context } = await fixture();
    const current = priority(playing(session)), request = task(current);
    const issued = issueDuelRequiredCostTask(current, request);
    expect(() => restore(issued.session, context)).toThrowError(failure('untrusted-payment-source'));
    const ctx = { ...context, requiredTaskSourceValidator: verified(request) };
    const recovered = restore(issued.session, ctx);
    expect(recovered.requiredTasks?.[0]?.status).toBe('issued');
    const changed = wire(exportDuelSessionArchive(issued.session));
    (changed.session.requiredTasks![0] as { finalResolvedCost: { energy: number } }).finalResolvedCost.energy = 1;
    expect(() => restoreDuelSessionArchive(changed, ctx)).toThrowError(failure('untrusted-payment-source'));
    expect(() => restore(issued.session, { ...context, requiredTaskSourceValidator: () => false }))
      .toThrowError(failure('untrusted-payment-source'));
  });

  it('reissues restored issued identity via a new opaque handle once, without inventing an archive capability', async () => {
    const { session, context } = await fixture();
    const current = priority(playing(session)), request = task(current);
    const issued = issueDuelRequiredCostTask(current, request);
    const recovered = restore(issued.session,
      { ...context, requiredTaskSourceValidator: verified(request) });
    expect(() => prepareDuelRequiredCostPayment(recovered, issued.authority)).toThrow();
    const reissued = issueDuelRequiredCostTask(recovered, request);
    expect(reissued.persistRequired).toBe(false);
    const prepared = prepareDuelRequiredCostPayment(reissued.session, reissued.authority);
    expect(prepared.session.match.stage).toBe('playing');
    if (prepared.session.match.stage !== 'playing') return;
    expect(prepared.session.match.frame.pendingPayment).toMatchObject({ actor: request.actor,
      paymentId: request.paymentId, resolvedCost: request.finalResolvedCost,
      sourceReference: request.opaqueSource });
    expect(prepared.session.requiredTasks![0]!.status).toBe('active');
    expect(() => prepareDuelRequiredCostPayment(reissued.session, reissued.authority)).toThrow();
    expect(() => issueDuelRequiredCostTask(prepared.session, request)).toThrow();
  });

  it('strictly binds active ledger to pending actor/payment/cost/source and rejects replayed task identities', async () => {
    const { session, context } = await fixture();
    const current = priority(playing(session)), request = task(current);
    const issued = issueDuelRequiredCostTask(current, request);
    const prepared = prepareDuelRequiredCostPayment(issued.session, issued.authority).session;
    const ctx = { ...context, requiredTaskSourceValidator: verified(request) };
    expect(restore(prepared, ctx).requiredTasks![0]!.status).toBe('active');
    const mutate = (change: (raw: any) => void) => {
      const raw = wire(exportDuelSessionArchive(prepared));
      change(raw);
      expect(() => restoreDuelSessionArchive(raw, ctx)).toThrowError(failure('invalid-archive'));
    };
    mutate(raw => { raw.session.match.frame.pendingPayment.actor =
      raw.session.match.roster.find((seat: { playerId: string }) => seat.playerId !== request.actor).playerId; });
    mutate(raw => raw.session.match.frame.pendingPayment.resolvedCost.energy++);
    mutate(raw => raw.session.match.frame.pendingPayment.sourceReference.referenceId = 'forged');
    mutate(raw => raw.session.requiredTasks.push({ ...raw.session.requiredTasks[0], taskId: 'task-2' }));
    mutate(raw => raw.session.requiredTasks.push({ ...raw.session.requiredTasks[0], paymentId: 'payment-2' }));
  });

  it('requires a separate trusted resolver for ordinary Priority pending payment', async () => {
    const { session, context } = await fixture();
    const current = priority(playing(session));
    const request = task(current);
    // The ordinary trusted preparer is a separate path from required-task issuance.
    const { commitDuelPriorityPayment } = await import('../../../../packages/engine-core/src/duel/index.js');
    const pending = commitDuelPriorityPayment(current, request.actor, request.paymentId,
      request.finalResolvedCost, request.opaqueSource).session;
    expect(() => restore(pending, context)).toThrowError(failure('untrusted-payment-source'));
    const resolver: DuelSessionRestoreContext['priorityPaymentSourceValidator'] = (payment, match) =>
      match.matchId === request.matchId && payment.actor === request.actor &&
      payment.paymentId === request.paymentId &&
      JSON.stringify(payment.resolvedCost) === JSON.stringify(request.finalResolvedCost) &&
      JSON.stringify(payment.sourceReference) === JSON.stringify(request.opaqueSource);
    expect(restore(pending, { ...context, priorityPaymentSourceValidator: resolver }).match.stage).toBe('playing');
    expect(() => restore(pending, { ...context, priorityPaymentSourceValidator: () => false }))
      .toThrowError(failure('untrusted-payment-source'));
  });

  it('completed required payment is bound to an actual applied receipt/continuation and cannot be paid again', async () => {
    const { session, context } = await fixture();
    const current = priority(playing(session)), request = task(current);
    const issued = issueDuelRequiredCostTask(current, request);
    const prepared = prepareDuelRequiredCostPayment(issued.session, issued.authority).session;
    const paid = applyDuelResourceCommand(prepared, request.actor,
      { commandId: 'pay-1', expectedVersion: prepared.match.stateVersion,
        command: { type: 'pay-pending', paymentId: request.paymentId } }).session;
    expect(paid.requiredTasks![0]!.status).toBe('completed');
    const ctx = { ...context, requiredTaskSourceValidator: verified(request) };
    const recovered = restore(paid, ctx);
    const duplicate = applyDuelResourceCommand(recovered, request.actor,
      { commandId: 'pay-1', expectedVersion: prepared.match.stateVersion,
        command: { type: 'pay-pending', paymentId: request.paymentId } });
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.persistRequired).toBe(false);
    expect(duplicate.match).toBe(recovered.match);
    expect(() => issueDuelRequiredCostTask(recovered, request)).toThrow();
    const mutate = (change: (raw: any) => void) => {
      const raw = wire(exportDuelSessionArchive(paid));
      change(raw);
      expect(() => restoreDuelSessionArchive(raw, ctx)).toThrowError(failure('invalid-archive'));
    };
    mutate(raw => { raw.session.receipts[raw.session.receipts.length - 1].outcome.paymentCompleted.requiredTask.continuationId = 'wrong'; });
    mutate(raw => { delete raw.session.receipts[raw.session.receipts.length - 1].outcome.paymentCompleted.requiredTask; });
    mutate(raw => { raw.session.requiredTasks[0].status = 'issued'; });
    mutate(raw => { raw.session.requiredTasks[0].status = 'active'; });
    mutate(raw => { raw.session.receipts[raw.session.receipts.length - 1].outcome.paymentCompleted.plan.power.push({
      requirementIndex: 0, from: 'Order', amount: 0,
    }); });
    mutate(raw => { raw.session.receipts[raw.session.receipts.length - 1].outcome.paymentCompleted.plan.power.push({
      requirementIndex: 0, from: 'Order', amount: 1,
    }); });
  });
});
