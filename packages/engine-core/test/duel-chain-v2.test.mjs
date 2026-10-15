import test from 'node:test';
import assert from 'node:assert/strict';

// Normal package tests use dist; the standalone source-level verification sets
// CHAIN_V2_MODULE_URL to its single-file compile in the exclusive artifact dir.
const {
  appendDuelChainItemV2,
  chainIsEmptyV2,
  commitDuelChainResolutionV2,
  createDuelChainExecutorV2,
  createDuelChainScopedExecutorV2,
  inspectDuelChainPrivateStateV2,
  createDuelChainResolutionAuthorityV2,
  createDuelChainV2,
  DuelChainBlockedErrorV2,
  finalizeDuelChainItemV2,
  passDuelChainPriorityV2,
  queryDuelChainCommittedProofV2,
  inspectDuelChainCommittedProofV2,
  requestDuelChainResolutionV2,
  resolveDuelChainItemV2,
} = await import(process.env.CHAIN_V2_MODULE_URL ?? '../dist/duel/chain-v2.js');

const ALICE = 'alice';
const BOB = 'bob';
const main = (player = ALICE) => ({ kind: 'main-phase', returnPriorityPlayerId: player });
const showdown = player => ({ kind: 'showdown', returnFocusPlayerId: player });
const receiptFor = (ticket, produced = []) => ({
  status: 'committed',
  idempotencyKey: ticket.idempotencyKey,
  chainId: ticket.chainId,
  itemId: ticket.itemId,
  executorId: ticket.executorId,
  produced,
});
const draft = (id, controllerPlayerId = ALICE, resolutionMode = 'fepr', executorId) => ({
  id, kind: 'opaque-effect', controllerPlayerId, resolutionMode,
  ...(executorId === undefined ? {} : { executorId }),
});
function blocked(fn, code) {
  assert.throws(fn, error => {
    assert.ok(error instanceof DuelChainBlockedErrorV2, String(error));
    assert.equal(error.code, code);
    return true;
  });
}
function harness(closeContext = main()) {
  const receipts = new Map();
  let queries = 0;
  const authority = createDuelChainResolutionAuthorityV2(ticket => {
    queries++;
    return receipts.get(ticket.idempotencyKey) ?? null;
  });
  return {
    authority,
    receipts,
    queries: () => queries,
    chain: createDuelChainV2({ turnOrder: [ALICE, BOB], closeContext, resolutionAuthority: authority }),
  };
}

function recordedChain(identityFactory, chainId = 'recorded-chain') {
  const receipts = new Map();
  const authority = createDuelChainResolutionAuthorityV2(ticket => receipts.get(ticket.idempotencyKey) ?? null);
  const chain = createDuelChainV2({ turnOrder: [ALICE, BOB], closeContext: main(), chainId,
    resolutionAuthority: authority, identityFactory });
  return { chain, receipts, authority };
}
function tape(...values) {
  let index = 0;
  return () => { assert.ok(index < values.length, 'declared entropy exhausted'); return values[index++]; };
}

test('fresh recorded Chain lineages replay equal identities but cannot exchange handles, tickets or proofs', () => {
  const a = recordedChain(tape('same-executor', 'same-ticket'));
  const b = recordedChain(tape('same-executor', 'same-ticket'));
  const execA = createDuelChainScopedExecutorV2(a.chain), execB = createDuelChainScopedExecutorV2(b.chain);
  assert.equal(execA.executorId, execB.executorId);
  assert.notStrictEqual(execA, execB);
  blocked(() => append(b.chain, execA), 'executor-mismatch');
  blocked(() => createDuelChainScopedExecutorV2(JSON.parse(JSON.stringify(a.chain))), 'untrusted-chain');
  const ra = requestDuelChainResolutionV2(ready(a.chain, execA), { expectedVersion: 4 });
  const rb = requestDuelChainResolutionV2(ready(b.chain, execB), { expectedVersion: 4 });
  assert.equal(ra.ticket.idempotencyKey, rb.ticket.idempotencyKey);
  assert.notStrictEqual(ra.ticket, rb.ticket);
  assert.deepEqual(inspectDuelChainPrivateStateV2(ra.chain), inspectDuelChainPrivateStateV2(rb.chain));
  a.receipts.set(ra.ticket.idempotencyKey, receiptFor(ra.ticket));
  b.receipts.set(rb.ticket.idempotencyKey, receiptFor(rb.ticket));
  const proofA = queryDuelChainCommittedProofV2(a.authority, ra.ticket);
  const proofB = queryDuelChainCommittedProofV2(b.authority, rb.ticket);
  assert.notStrictEqual(proofA, proofB);
  blocked(() => queryDuelChainCommittedProofV2(b.authority, ra.ticket), 'untrusted-authority');
  blocked(() => commitDuelChainResolutionV2(rb.chain, { expectedVersion: rb.chain.stateVersion,
    ticket: rb.ticket, proof: proofA }), 'proof-mismatch');
  const closed = commitDuelChainResolutionV2(rb.chain, { expectedVersion: rb.chain.stateVersion, ticket: rb.ticket, proof: proofB });
  assert.equal(closed.phase, 'open');
  assert.equal(inspectDuelChainPrivateStateV2(closed).issuedTicketKeys.length, 1);
});

test('recorded identity reuse is rejected within a Chain after an item has left it', () => {
  const h = recordedChain(tape('executor', 'nonce', 'nonce', 'executor'));
  const executor = createDuelChainScopedExecutorV2(h.chain);
  const first = requestDuelChainResolutionV2(ready(h.chain, executor), { expectedVersion: 4 });
  h.receipts.set(first.ticket.idempotencyKey, receiptFor(first.ticket));
  const proof = queryDuelChainCommittedProofV2(h.authority, first.ticket);
  const closed = commitDuelChainResolutionV2(first.chain, { expectedVersion: first.chain.stateVersion, ticket: first.ticket, proof });
  const second = ready(closed, executor, draft('second'));
  blocked(() => requestDuelChainResolutionV2(second, { expectedVersion: second.stateVersion }), 'invalid-request');
  assert.equal(second.phase, 'resolve');
  assert.equal(inspectDuelChainPrivateStateV2(second).issuedTicketKeys.length, 1);
  blocked(() => createDuelChainScopedExecutorV2(second), 'duplicate-executor-id');
});

test('a recorded Chain refuses process-global and foreign-produced executors', () => {
  const a = recordedChain(tape('a-executor', 'a-ticket')), b = recordedChain(tape('b-executor'));
  const aExec = createDuelChainScopedExecutorV2(a.chain), bExec = createDuelChainScopedExecutorV2(b.chain);
  blocked(() => append(a.chain, createDuelChainExecutorV2()), 'executor-mismatch');
  const request = requestDuelChainResolutionV2(ready(a.chain, aExec), { expectedVersion: 4 });
  a.receipts.set(request.ticket.idempotencyKey, receiptFor(request.ticket, [{ item: draft('foreign-produced'), executor: bExec }]));
  blocked(() => queryDuelChainCommittedProofV2(a.authority, request.ticket), 'executor-mismatch');
  assert.equal(inspectDuelChainPrivateStateV2(request.chain).proof, null);
  a.receipts.set(request.ticket.idempotencyKey, receiptFor(request.ticket));
  assert.ok(queryDuelChainCommittedProofV2(a.authority, request.ticket));
});

test('identity callbacks run under the actual Chain guard and cannot advance its continuation', () => {
  let chain, calls = 0;
  const h = recordedChain(() => {
    calls++;
    blocked(() => createDuelChainScopedExecutorV2(chain), 'reentrant-transition');
    return `guarded-${calls}`;
  });
  chain = h.chain;
  const executor = createDuelChainScopedExecutorV2(chain);
  assert.equal(chain.stateVersion, 0);
  const resolved = ready(chain, executor);
  chain = resolved;
  const request = requestDuelChainResolutionV2(chain, { expectedVersion: chain.stateVersion });
  assert.equal(calls, 2);
  assert.equal(request.chain.phase, 'await-commit');
  assert.equal(inspectDuelChainPrivateStateV2(request.chain).identityMode, 'parent-recorded');
  assert.equal(inspectDuelChainPrivateStateV2(request.chain).allocatedExecutors.length, 1);
});
function append(chain, executor, item = draft('a')) {
  return appendDuelChainItemV2(chain, { actor: chain.priorityPlayerId, expectedVersion: chain.stateVersion, item, executor });
}
function finalize(chain, actor = ALICE) {
  return finalizeDuelChainItemV2(chain, { actor, expectedVersion: chain.stateVersion });
}
function pass(chain) {
  return passDuelChainPriorityV2(chain, { actor: chain.priorityPlayerId, expectedVersion: chain.stateVersion });
}
function ready(chain, executor, item = draft('a')) {
  chain = finalize(append(chain, executor, item), item.controllerPlayerId);
  if (item.resolutionMode === 'fepr') chain = pass(pass(chain));
  return chain;
}
function request(chain, executor) {
  return requestDuelChainResolutionV2(chain, { expectedVersion: chain.stateVersion, executor });
}
function proofFor(h, ticket, produced = []) {
  h.receipts.set(ticket.idempotencyKey, receiptFor(ticket, produced));
  return queryDuelChainCommittedProofV2(h.authority, ticket);
}
function commit(chain, ticket, proof) {
  return commitDuelChainResolutionV2(chain, { expectedVersion: chain.stateVersion, ticket, proof });
}

test('committed proof inspection retains the issued Chain authority and rejects DATA copies', () => {
  const h = harness();
  const executor = createDuelChainExecutorV2();
  const selected = request(ready(h.chain, executor), executor);
  const proof = proofFor(h, selected.ticket);
  const inspected = inspectDuelChainCommittedProofV2(proof);
  assert.equal(inspected.resolutionAuthority, h.authority);
  assert.equal(inspected.chainId, selected.ticket.chainId);
  assert.equal(inspected.itemId, selected.ticket.itemId);
  assert.equal(inspected.executorId, selected.ticket.executorId);
  assert.ok(Object.isFrozen(inspected));
  blocked(() => inspectDuelChainCommittedProofV2({ ...proof }), 'untrusted-proof');
  blocked(() => inspectDuelChainCommittedProofV2(JSON.parse(JSON.stringify(proof))), 'untrusted-proof');
});

test('empty chain is open; append binds a real executor and consumes old continuation', () => {
  const h = harness();
  const executor = createDuelChainExecutorV2();
  assert.equal(chainIsEmptyV2(h.chain), true);
  assert.equal(h.chain.priorityPlayerId, ALICE);
  const next = append(h.chain, executor);
  assert.equal(next.status, 'closed');
  assert.equal(next.phase, 'finalize');
  assert.equal(next.items[0].executorId, executor.executorId);
  assert.equal(next.items[0].status, 'pending');
  blocked(() => append(h.chain, executor, draft('b')), 'stale-continuation');
  assert.ok(Object.isFrozen(next));
  assert.ok(Object.isFrozen(next.items));
  assert.ok(Object.isFrozen(next.items[0]));
  assert.ok(Object.isFrozen(next.continuation));
  assert.ok(Object.isFrozen(next.closeContext));
});

test('Finalize is oldest-first and controller-bound; it does not pass priority', () => {
  const executor = createDuelChainExecutorV2();
  let chain = append(harness().chain, executor);
  blocked(() => finalize(chain, BOB), 'wrong-actor');
  chain = finalize(chain);
  assert.equal(chain.items[0].status, 'finalized');
  assert.equal(chain.priorityPlayerId, ALICE);
  assert.equal(chain.consecutivePasses, 0);
  assert.equal(chain.phase, 'execute');
  blocked(() => finalize(chain), 'no-pending-item');
});

test('FEPR passes in order, resolves newest top, and returns main-phase priority from context', () => {
  const h = harness(main(ALICE));
  const executor = createDuelChainExecutorV2();
  let chain = finalize(append(h.chain, executor));
  blocked(() => request(chain, executor), 'passes-incomplete');
  blocked(() => passDuelChainPriorityV2(chain, BOB, chain.stateVersion), 'wrong-priority');
  chain = pass(chain);
  assert.equal(chain.priorityPlayerId, BOB);
  chain = pass(chain);
  assert.equal(chain.phase, 'resolve');
  const { chain: locked, ticket } = request(chain, executor);
  assert.equal(locked.phase, 'await-commit');
  assert.equal(locked.items.length, 1);
  assert.equal(locked.consecutivePasses, 2);
  assert.equal(ticket.requestedAtVersion, chain.stateVersion);
  assert.equal(ticket.lockedAtVersion, locked.stateVersion);
  const proof = proofFor(h, ticket);
  chain = commit(locked, ticket, proof);
  assert.equal(chain.items.length, 0);
  assert.equal(chain.stateOpen, true);
  assert.equal(chain.status, 'open');
  assert.equal(chain.phase, 'open');
  assert.equal(chain.consecutivePasses, 0);
  assert.equal(chain.priorityPlayerId, ALICE); // NOT next player after top controller
  assert.deepEqual(chain.issuedItemIds, ['a']);
});

test('a second pending item is finalized in append order and newest finalized item resolves first', () => {
  const h = harness();
  const executor = createDuelChainExecutorV2();
  let chain = append(h.chain, executor);
  blocked(() => append(chain, executor, draft('b')), 'invalid-phase');
  chain = finalize(chain);
  chain = append(chain, executor, draft('b'));
  blocked(() => finalize(chain, BOB), 'wrong-actor');
  chain = finalize(chain);
  assert.deepEqual(chain.items.map(item => item.status), ['finalized', 'finalized']);
  chain = pass(pass(chain));
  const { chain: locked, ticket } = request(chain, executor);
  assert.equal(ticket.itemId, 'b');
  chain = commit(locked, ticket, proofFor(h, ticket));
  assert.deepEqual(chain.items.map(item => item.id), ['a']);
  assert.equal(chain.phase, 'execute');
  assert.equal(chain.consecutivePasses, 0);
  chain = pass(pass(chain));
  const second = request(chain, executor);
  assert.equal(second.ticket.itemId, 'a');
  chain = commit(second.chain, second.ticket, proofFor(h, second.ticket));
  assert.deepEqual(chain.issuedItemIds, ['a', 'b']);
});

test('missing or cloned executor is rejected at append; no late handle may bind', () => {
  const h = harness();
  blocked(() => appendDuelChainItemV2(h.chain, {
    actor: ALICE, expectedVersion: 0, item: draft('a', ALICE, 'fepr', 'late'),
  }), 'unknown-executor');
  const late = createDuelChainExecutorV2('late-executor-chain-v2-test');
  blocked(() => appendDuelChainItemV2(h.chain, {
    actor: ALICE, expectedVersion: 0, item: draft('a', ALICE, 'fepr', late.executorId),
    executor: JSON.parse(JSON.stringify(late)),
  }), 'unknown-executor');
  blocked(() => createDuelChainV2({
    turnOrder: [ALICE, BOB], closeContext: main(), resolutionAuthority: JSON.parse(JSON.stringify(h.authority)),
  }), 'untrusted-authority');
  assert.equal(h.chain.stateVersion, 0);
});

test('executor IDs are globally unique; different handles cannot impersonate a bound item', () => {
  let callbackCalls = 0;
  blocked(() => createDuelChainExecutorV2('forbidden-chain-v2-callback', () => { callbackCalls++; }), 'invalid-request');
  assert.equal(callbackCalls, 0);
  const id = 'unique-chain-v2-binding-test';
  const a = createDuelChainExecutorV2(id);
  blocked(() => createDuelChainExecutorV2(id), 'duplicate-executor-id');
  const b = createDuelChainExecutorV2();
  const h = harness();
  let chain = ready(h.chain, a, draft('a', ALICE, 'immediate', a.executorId));
  blocked(() => request(chain, b), 'executor-mismatch');
  blocked(() => request(chain, JSON.parse(JSON.stringify(a))), 'unknown-executor');
  const result = request(chain, a);
  assert.strictEqual(result.ticket.executor, a);
  assert.ok(Object.isFrozen(result.ticket));
  assert.ok(Object.isFrozen(result.ticket.item));
  chain = commit(result.chain, result.ticket, proofFor(h, result.ticket));
  assert.equal(chain.items.length, 0);
});

test('external blocked or throw never invokes an effect callback inside the Chain kernel', () => {
  const h = harness();
  const executor = createDuelChainExecutorV2();
  const { chain, ticket } = request(ready(h.chain, executor, draft('a', ALICE, 'immediate')), executor);
  let externalCalls = 0;
  const externalEffect = () => { externalCalls++; return { status: 'blocked' }; };
  // External effect is not passed to any kernel API; uncommitted/unknown remains
  // queryable under the SAME ticket rather than re-executing any callback.
  assert.equal(queryDuelChainCommittedProofV2(h.authority, ticket), null);
  assert.equal(externalCalls, 0);
  externalEffect();
  assert.equal(queryDuelChainCommittedProofV2(h.authority, ticket), null);
  assert.equal(externalCalls, 1);
  assert.equal(chain.phase, 'await-commit');
  blocked(() => request(chain, executor), 'invalid-phase');
  blocked(() => pass(chain), 'invalid-phase');
  blocked(() => append(chain, executor, draft('b')), 'invalid-phase');
  blocked(() => commit(chain, ticket, { status: 'committed' }), 'untrusted-proof');
  assert.equal(externalCalls, 1);
  assert.equal(chain.stateVersion, ticket.lockedAtVersion);
});

test('unknown/throw lookup stays on the same ticket; external idempotency key prevents repeat effects', () => {
  const transactions = new Map();
  let effectCalls = 0;
  let failLookup = true;
  const authority = createDuelChainResolutionAuthorityV2(ticket => {
    if (failLookup) throw new Error('temporarily unavailable');
    return transactions.get(ticket.idempotencyKey) ?? null;
  });
  let chain = createDuelChainV2({ turnOrder: [ALICE, BOB], closeContext: main(), resolutionAuthority: authority });
  const executor = createDuelChainExecutorV2();
  const result = request(ready(chain, executor, draft('a', ALICE, 'immediate')), executor);
  chain = result.chain;
  const externalCanonicalTransaction = ticket => {
    if (transactions.has(ticket.idempotencyKey)) return transactions.get(ticket.idempotencyKey);
    effectCalls++;
    const receipt = receiptFor(ticket);
    transactions.set(ticket.idempotencyKey, receipt); // durable atomic commit before acknowledgement
    throw new Error('ack lost after commit');
  };
  blocked(() => queryDuelChainCommittedProofV2(authority, result.ticket), 'resolution-query-failed');
  assert.equal(chain.phase, 'await-commit');
  assert.throws(() => externalCanonicalTransaction(result.ticket), /ack lost/);
  assert.strictEqual(externalCanonicalTransaction(result.ticket), transactions.get(result.ticket.idempotencyKey));
  assert.equal(effectCalls, 1);
  failLookup = false;
  const proof = queryDuelChainCommittedProofV2(authority, result.ticket);
  assert.strictEqual(queryDuelChainCommittedProofV2(authority, result.ticket), proof);
  chain = commit(chain, result.ticket, proof);
  assert.equal(chain.phase, 'open');
  assert.equal(effectCalls, 1);
});

test('one-shot ticket and proof cannot be replayed, cloned, crossed, or committed before receipt', () => {
  const h = harness();
  const executor = createDuelChainExecutorV2();
  const old = ready(h.chain, executor, draft('a', ALICE, 'immediate'));
  const { chain, ticket } = request(old, executor);
  blocked(() => request(old, executor), 'stale-continuation');
  blocked(() => commit(chain, ticket, null), 'untrusted-proof');
  blocked(() => commit(chain, JSON.parse(JSON.stringify(ticket)), {}), 'untrusted-ticket');
  blocked(() => commit(chain, ticket, JSON.parse(JSON.stringify({ status: 'committed' }))), 'untrusted-proof');
  const proof = proofFor(h, ticket);
  blocked(() => commit(chain, ticket, JSON.parse(JSON.stringify(proof))), 'untrusted-proof');
  const other = harness();
  blocked(() => queryDuelChainCommittedProofV2(other.authority, ticket), 'untrusted-authority');
  const resolved = commit(chain, ticket, proof);
  blocked(() => commit(chain, ticket, proof), 'stale-continuation');
  blocked(() => queryDuelChainCommittedProofV2(h.authority, ticket), 'stale-continuation');
  blocked(() => commit(resolved, ticket, proof), 'invalid-phase');
});

test('receipt for a different ticket or executor cannot authorize commit', () => {
  const h = harness();
  const executor = createDuelChainExecutorV2();
  const result = request(ready(h.chain, executor, draft('a', ALICE, 'immediate')), executor);
  const valid = receiptFor(result.ticket);
  for (const mismatch of [
    { idempotencyKey: `${valid.idempotencyKey}:other` },
    { chainId: `${valid.chainId}:other` },
    { itemId: 'different-item' },
    { executorId: 'different-executor' },
  ]) {
    h.receipts.set(result.ticket.idempotencyKey, { ...valid, ...mismatch });
    blocked(() => queryDuelChainCommittedProofV2(h.authority, result.ticket), 'proof-mismatch');
    assert.equal(result.chain.phase, 'await-commit');
  }
  h.receipts.set(result.ticket.idempotencyKey, valid);
  const proof = queryDuelChainCommittedProofV2(h.authority, result.ticket);
  assert.equal(commit(result.chain, result.ticket, proof).phase, 'open');
});

test('ticket from another chain cannot commit against active ticket', () => {
  const authority = createDuelChainResolutionAuthorityV2(ticket => receiptFor(ticket));
  const make = () => createDuelChainV2({ turnOrder: [ALICE, BOB], closeContext: main(), resolutionAuthority: authority });
  const executor = createDuelChainExecutorV2();
  const a = request(ready(make(), executor, draft('a', ALICE, 'immediate')), executor);
  const b = request(ready(make(), executor, draft('a', ALICE, 'immediate')), executor);
  const proofA = queryDuelChainCommittedProofV2(authority, a.ticket);
  blocked(() => commit(b.chain, a.ticket, proofA), 'untrusted-ticket');
  assert.notEqual(a.ticket.idempotencyKey, b.ticket.idempotencyKey);
  assert.equal(b.chain.phase, 'await-commit');
});

test('immediate mode requests resolution immediately after Finalize without passes', () => {
  const h = harness();
  const executor = createDuelChainExecutorV2();
  let chain = ready(h.chain, executor, draft('unit', ALICE, 'immediate'));
  assert.equal(chain.phase, 'resolve');
  assert.equal(chain.consecutivePasses, 0);
  blocked(() => pass(chain), 'invalid-phase');
  // Old resolve spelling is an alias for request issuance, not effect execution.
  const result = resolveDuelChainItemV2(chain, { expectedVersion: chain.stateVersion, executor });
  assert.equal(result.ticket.itemId, 'unit');
  chain = commit(result.chain, result.ticket, proofFor(h, result.ticket));
  assert.equal(chain.phase, 'open');
});

test('produced pending items preserve order; an immediate item resolves before newer pending items', () => {
  const h = harness();
  const executor = createDuelChainExecutorV2();
  let chain = ready(h.chain, executor, draft('parent', ALICE, 'immediate'));
  const first = request(chain, executor);
  const proof = proofFor(h, first.ticket, [
    { item: draft('one', BOB, 'immediate'), executor },
    { item: draft('two', ALICE, 'fepr'), executor },
  ]);
  chain = commit(first.chain, first.ticket, proof);
  assert.deepEqual(chain.items.map(item => item.id), ['one', 'two']);
  assert.deepEqual(chain.issuedItemIds, ['parent', 'one', 'two']);
  assert.equal(chain.phase, 'finalize');
  assert.equal(chain.priorityPlayerId, BOB);
  blocked(() => finalize(chain, ALICE), 'wrong-actor');
  chain = finalize(chain, BOB);
  assert.equal(chain.phase, 'resolve');
  assert.equal(chain.priorityPlayerId, BOB);
  assert.equal(chain.items[0].status, 'finalized');
  assert.equal(chain.items[1].status, 'pending');
  blocked(() => requestDuelChainResolutionV2(chain, { actor: ALICE,
    expectedVersion: chain.stateVersion, executor }), 'wrong-priority');
  const firstImmediate = requestDuelChainResolutionV2(chain, { actor: BOB,
    expectedVersion: chain.stateVersion, executor });
  assert.equal(firstImmediate.ticket.itemId, 'one');
  chain = commit(firstImmediate.chain, firstImmediate.ticket, proofFor(h, firstImmediate.ticket));
  assert.deepEqual(chain.items.map(item => item.id), ['two']);
  assert.equal(chain.phase, 'finalize');
  assert.equal(chain.priorityPlayerId, ALICE);
  chain = finalize(chain, ALICE);
  assert.equal(chain.phase, 'execute');
  chain = pass(pass(chain));
  const second = request(chain, executor);
  assert.equal(second.ticket.itemId, 'two');
  chain = commit(second.chain, second.ticket, proofFor(h, second.ticket));
  assert.equal(chain.phase, 'open');
});

test('mixed pending resolution keeps the finalized immediate ticket identity across retry and commit', () => {
  const h = harness();
  const executor = createDuelChainExecutorV2();
  let chain = ready(h.chain, executor, draft('parent', ALICE, 'immediate'));
  const parent = request(chain, executor);
  const parentProof = proofFor(h, parent.ticket, [
    { item: draft('immediate-child', ALICE, 'immediate'), executor },
    { item: draft('fepr-child', BOB, 'fepr'), executor },
  ]);
  chain = commit(parent.chain, parent.ticket, parentProof);
  chain = finalize(chain, ALICE);
  assert.equal(chain.phase, 'resolve');
  const selected = request(chain, executor);
  assert.equal(selected.ticket.itemId, 'immediate-child');
  assert.equal(selected.ticket.item.id, 'immediate-child');
  assert.equal(queryDuelChainCommittedProofV2(h.authority, selected.ticket), null);
  const receipt = receiptFor(selected.ticket);
  h.receipts.set(selected.ticket.idempotencyKey, receipt);
  const selectedProof = queryDuelChainCommittedProofV2(h.authority, selected.ticket);
  assert.ok(selectedProof);
  chain = commit(selected.chain, selected.ticket, selectedProof);
  assert.deepEqual(chain.items.map(item => item.id), ['fepr-child']);
  assert.equal(chain.phase, 'finalize');
  chain = finalize(chain, BOB);
  chain = pass(pass(chain));
  const fepr = request(chain, executor);
  assert.equal(fepr.ticket.itemId, 'fepr-child');
  chain = commit(fepr.chain, fepr.ticket, proofFor(h, fepr.ticket));
  assert.equal(chain.phase, 'open');
});

test('two immediate pending items resolve oldest finalized immediate before the next pending item', () => {
  const h = harness();
  const executor = createDuelChainExecutorV2();
  let chain = ready(h.chain, executor, draft('parent', ALICE, 'immediate'));
  const parent = request(chain, executor);
  chain = commit(parent.chain, parent.ticket, proofFor(h, parent.ticket, [
    { item: draft('first-immediate', ALICE, 'immediate'), executor },
    { item: draft('second-immediate', BOB, 'immediate'), executor },
  ]));
  chain = finalize(chain, ALICE);
  assert.equal(chain.phase, 'resolve');
  const first = request(chain, executor);
  assert.equal(first.ticket.itemId, 'first-immediate');
  chain = commit(first.chain, first.ticket, proofFor(h, first.ticket));
  assert.deepEqual(chain.items.map(item => item.id), ['second-immediate']);
  chain = finalize(chain, BOB);
  assert.equal(chain.phase, 'resolve');
  const second = request(chain, executor);
  assert.equal(second.ticket.itemId, 'second-immediate');
  chain = commit(second.chain, second.ticket, proofFor(h, second.ticket));
  assert.equal(chain.phase, 'open');
});

test('an immediate derived item remains ordered behind older pending items and resolves next', () => {
  const h = harness();
  const executor = createDuelChainExecutorV2();
  let chain = ready(h.chain, executor, draft('parent', ALICE, 'immediate'));
  const parent = request(chain, executor);
  chain = commit(parent.chain, parent.ticket, proofFor(h, parent.ticket, [
    { item: draft('older-fepr', BOB, 'fepr'), executor },
    { item: draft('child-immediate', ALICE, 'immediate'), executor },
  ]));
  chain = finalize(chain, BOB);
  chain = finalize(chain, ALICE);
  assert.equal(chain.phase, 'resolve');
  const child = request(chain, executor);
  assert.equal(child.ticket.itemId, 'child-immediate');
  chain = commit(child.chain, child.ticket, proofFor(h, child.ticket, [
    { item: draft('grandchild-immediate', ALICE, 'immediate'), executor },
  ]));
  assert.deepEqual(chain.items.map(item => item.id), ['older-fepr', 'grandchild-immediate']);
  assert.equal(chain.phase, 'finalize');
  chain = finalize(chain, ALICE);
  assert.equal(chain.phase, 'resolve');
  const grandchild = request(chain, executor);
  assert.equal(grandchild.ticket.itemId, 'grandchild-immediate');
  chain = commit(grandchild.chain, grandchild.ticket, proofFor(h, grandchild.ticket));
  assert.equal(chain.items[0].id, 'older-fepr');
  chain = pass(pass(chain));
  const older = request(chain, executor);
  assert.equal(older.ticket.itemId, 'older-fepr');
  chain = commit(older.chain, older.ticket, proofFor(h, older.ticket));
  assert.equal(chain.phase, 'open');
});

test('invalid produced IDs, executor, and controller fail before commit and preserve ticket', () => {
  const h = harness();
  const executor = createDuelChainExecutorV2();
  const first = request(ready(h.chain, executor, draft('a', ALICE, 'immediate')), executor);
  h.receipts.set(first.ticket.idempotencyKey, {
    ...receiptFor(first.ticket), produced: [
      { item: draft('b', ALICE, 'immediate'), executor },
      { item: draft('b', BOB, 'fepr'), executor },
    ],
  });
  blocked(() => queryDuelChainCommittedProofV2(h.authority, first.ticket), 'duplicate-item-id');
  assert.equal(first.chain.phase, 'await-commit');
  assert.deepEqual(first.chain.issuedItemIds, ['a']);
  h.receipts.set(first.ticket.idempotencyKey, {
    ...receiptFor(first.ticket), produced: [{ item: draft('a', ALICE, 'fepr'), executor }],
  });
  blocked(() => queryDuelChainCommittedProofV2(h.authority, first.ticket), 'duplicate-item-id');
  h.receipts.set(first.ticket.idempotencyKey, {
    ...receiptFor(first.ticket), produced: [{ item: draft('new', 'outsider', 'fepr'), executor }],
  });
  blocked(() => queryDuelChainCommittedProofV2(h.authority, first.ticket), 'wrong-actor');
  h.receipts.set(first.ticket.idempotencyKey, {
    ...receiptFor(first.ticket), produced: [{ item: draft('new', ALICE, 'fepr'), executor: { executorId: executor.executorId } }],
  });
  blocked(() => queryDuelChainCommittedProofV2(h.authority, first.ticket), 'unknown-executor');
  assert.equal(first.chain.stateVersion, first.ticket.lockedAtVersion);
  assert.equal(h.queries(), 4);
});

test('main-phase, Showdown Focus, and Showdown handoff close without guessing from top controller', () => {
  for (const [context, expectedPhase, expectedPriority] of [
    [main(BOB), 'open', BOB],
    [showdown(ALICE), 'open', ALICE],
    [{ kind: 'showdown-handoff' }, 'handoff', null],
  ]) {
    const h = harness(context);
    const executor = createDuelChainExecutorV2();
    const result = request(ready(h.chain, executor, draft('a', ALICE, 'immediate')), executor);
    const chain = commit(result.chain, result.ticket, proofFor(h, result.ticket));
    assert.equal(chain.phase, expectedPhase);
    assert.equal(chain.priorityPlayerId, expectedPriority);
    if (expectedPhase === 'handoff') {
      assert.equal(chain.status, 'handoff');
      blocked(() => appendDuelChainItemV2(chain, {
        actor: ALICE, expectedVersion: chain.stateVersion, item: draft('b'), executor,
      }), 'invalid-phase');
    } else {
      assert.equal(chain.status, 'open');
    }
  }
});

test('Proxy normalization trap cannot advance same Chain and reads only descriptors', () => {
  const h = harness();
  const executor = createDuelChainExecutorV2();
  let trapped = 0;
  const raw = new Proxy({ actor: ALICE, expectedVersion: 0, item: draft('outer'), executor }, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'actor') {
        trapped++;
        blocked(() => append(h.chain, executor, draft('inner')), 'reentrant-transition');
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    get() { throw new Error('raw get must never be used by normalization'); },
  });
  const next = appendDuelChainItemV2(h.chain, raw);
  assert.equal(trapped, 1);
  assert.deepEqual(next.issuedItemIds, ['outer']);
  assert.equal(next.stateVersion, 1);
  assert.equal(h.chain.stateVersion, 0);
  assert.deepEqual(h.chain.issuedItemIds, []);
});

test('Proxy receipt and produced drafts cannot reenter; snapshot is cached and frozen', () => {
  let chain;
  let executor;
  let ticket;
  const authority = createDuelChainResolutionAuthorityV2(receiptTicket => new Proxy({
    ...receiptFor(receiptTicket), produced: [{ item: draft('child', BOB, 'immediate'), executor }],
  }, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'produced') blocked(() => append(chain, executor, draft('reentry')), 'reentrant-transition');
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  }));
  executor = createDuelChainExecutorV2();
  const original = createDuelChainV2({ turnOrder: [ALICE, BOB], closeContext: main(), resolutionAuthority: authority });
  ({ chain, ticket } = request(ready(original, executor, draft('a', ALICE, 'immediate')), executor));
  const proof = queryDuelChainCommittedProofV2(authority, ticket);
  assert.ok(Object.isFrozen(proof));
  assert.ok(Object.isFrozen(proof.produced));
  assert.ok(Object.isFrozen(proof.produced[0]));
  assert.ok(Object.isFrozen(proof.produced[0].item));
  assert.strictEqual(queryDuelChainCommittedProofV2(authority, ticket), proof);
  chain = commit(chain, ticket, proof);
  assert.deepEqual(chain.issuedItemIds, ['a', 'child']);
});

test('accessors, symbols, sparse lists, malformed modes, and cloned chains fail closed', () => {
  const h = harness();
  const executor = createDuelChainExecutorV2();
  blocked(() => appendDuelChainItemV2(h.chain, {
    get actor() { throw new Error('accessor must not execute'); },
    expectedVersion: 0, item: draft('a'), executor,
  }), 'invalid-request');
  blocked(() => append(h.chain, executor, draft('a', ALICE, 'invalid')), 'invalid-item');
  blocked(() => appendDuelChainItemV2(h.chain, {
    actor: ALICE, expectedVersion: 0, item: { ...draft('a'), [Symbol('evil')]: true }, executor,
  }), 'invalid-item');
  const chain = ready(h.chain, executor, draft('a', ALICE, 'immediate'));
  const clone = JSON.parse(JSON.stringify(chain));
  blocked(() => request(clone, executor), 'untrusted-chain');
  const forged = { ...chain, stateVersion: Number.MAX_SAFE_INTEGER };
  blocked(() => request(forged, executor), 'untrusted-chain');
  const result = request(chain, executor);
  const sparse = new Array(1);
  h.receipts.set(result.ticket.idempotencyKey, receiptFor(result.ticket, sparse));
  blocked(() => queryDuelChainCommittedProofV2(h.authority, result.ticket), 'invalid-request');
});

test('duplicate item ID, wrong priority, stale version, and old state remain blocked', () => {
  const h = harness();
  const executor = createDuelChainExecutorV2();
  blocked(() => appendDuelChainItemV2(h.chain, {
    actor: BOB, expectedVersion: h.chain.stateVersion, item: draft('a', BOB), executor,
  }), 'wrong-priority');
  let chain = append(h.chain, executor);
  blocked(() => appendDuelChainItemV2(chain, {
    actor: ALICE, expectedVersion: chain.stateVersion - 1, item: draft('b'), executor,
  }), 'stale-version');
  const bytes = JSON.stringify(chain);
  blocked(() => passDuelChainPriorityV2(chain, ALICE, chain.stateVersion), 'invalid-phase');
  assert.equal(JSON.stringify(chain), bytes);
  chain = finalize(chain);
  chain = pass(pass(chain));
  const result = request(chain, executor);
  chain = commit(result.chain, result.ticket, proofFor(h, result.ticket));
  blocked(() => append(chain, executor, draft('a')), 'duplicate-item-id');
  blocked(() => append(h.chain, executor, draft('c')), 'stale-continuation');
});

test('unsafe expectedVersion and cloned max-safe state are rejected without overflow', () => {
  const h = harness();
  const executor = createDuelChainExecutorV2();
  blocked(() => appendDuelChainItemV2(h.chain, {
    actor: ALICE, expectedVersion: Number.MAX_SAFE_INTEGER + 1, item: draft('a'), executor,
  }), 'stale-version');
  blocked(() => appendDuelChainItemV2({ ...h.chain, stateVersion: Number.MAX_SAFE_INTEGER }, {
    actor: ALICE, expectedVersion: Number.MAX_SAFE_INTEGER, item: draft('a'), executor,
  }), 'untrusted-chain');
  assert.equal(h.chain.stateVersion, 0);
});
