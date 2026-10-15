// Default node --test uses the parent's compiled dist; source-level validation uses
// DUEL_COST_RESOLVER_SOURCE=1 node --import <tsx loader> --test test/duel-cost-resolver-v2.test.mjs.
// Never build shared dist merely to run the source-level test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const source = process.env.DUEL_COST_RESOLVER_SOURCE === '1';
const {
  createDuelCostResolverAuthorityV2, resolveDuelTotalCostV2,
  fingerprintDuelCostModifierV2, fingerprintDuelCostCoverageV2,
} = await import(source ? '../src/duel/cost-resolver-v2.ts' : '../dist/duel/cost-resolver-v2.js');
const {
  createDuelResources, restoreDuelResources, payDuelRuneCost,
} = await import(source ? '../src/duel/resources.ts' : '../dist/duel/resources.js');

const req = Object.freeze({ transactionId: 'pay:1', subjectId: 'printed:1', kind: 'card-play' });
const power = (allowedDomains, amount) => ({ allowedDomains, amount });
const rune = (energy, ...requirements) => ({ energy, power: requirements });
const all = ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'];
const BASE = rune(6, power(['Mind', 'Chaos'], 3), power(['Fury'], 2));
const snapshots = new WeakMap();
const revision = Object.freeze({ registryRevision: 'registry:7', catalogRevision: 'catalog:9' });
const sourceOf = modifier => ({ sourceUid: `source:${modifier.id}`, sourceEpoch: 2,
  choice: modifier.choice ?? 'mandatory', modifierIds: [modifier.id] });
const verified = (modifiers, baseCost = structuredClone(BASE), candidates = modifiers.map(sourceOf)) =>
  ({ ...revision, nonResourceCosts: 'none', base: { sourceUid: 'base:printed:1', sourceEpoch: 3,
    cost: structuredClone(baseCost) }, candidates: structuredClone(candidates), orderedModifiers: structuredClone(modifiers) });
const of = (modifier, n = modifier.id, coverageProof) =>
  ({ proofId: `proof:${n}`, modifierId: modifier.id, request: req,
    target: modifier.target, status: 'complete', applicability: 'applies', ...revision,
    candidateSourcesFingerprint: coverageProof.candidateSourcesFingerprint,
    resolvedChoicesFingerprint: coverageProof.resolvedChoicesFingerprint,
    sourceUid: `source:${modifier.id}`, sourceEpoch: 2,
    modifierFingerprint: (() => { try { return fingerprintDuelCostModifierV2(req, modifier); }
      catch { return 'invalid-modifier'; } })() });
const base = () => {
  const snapshot = verified([]);
  const d = { request: req, base: { request: req, status: 'complete', proofId: 'proof:base',
    cost: structuredClone(BASE), ...revision, sourceUid: snapshot.base.sourceUid,
    sourceEpoch: snapshot.base.sourceEpoch },
  coverage: { request: req, status: 'complete', proofId: 'proof:coverage',
    allModifierSourcesCovered: true, choicesResolved: true, nonResourceCosts: 'none',
    ...revision, ...fingerprintDuelCostCoverageV2(snapshot) },
  proofs: [], modifiers: [] };
  snapshots.set(d, snapshot);
  return d;
};
const decision = (...modifiers) => {
  const d = base(), snapshot = trustedSnapshot({ modifiers, base: d.base });
  let coverage;
  try { coverage = { ...d.coverage, ...fingerprintDuelCostCoverageV2(snapshot) }; }
  catch { coverage = d.coverage; } // preserve malformed inputs for negative resolver tests
  const result = { ...d, coverage, modifiers, proofs: modifiers.map(m => of(m, m.id, coverage)) };
  snapshots.set(result, snapshot);
  return result;
};
const trustedSnapshot = d => {
  if (snapshots.has(d)) return snapshots.get(d);
  try { return verified(d.modifiers, d.base.cost); }
  catch { return verified([]); } // malformed decision must reach and be rejected by the resolver
};
// A separate verifier closure takes its own snapshot before mutations to the service decision.
const resolver = (d, snapshot = trustedSnapshot(d), request = req) =>
  resolveDuelTotalCostV2(createDuelCostResolverAuthorityV2(() => d, () => snapshot), request);
const resolve = d => resolver(d);
const mod = (id, stage, target, operation, extra = {}) => ({ id, sourceProofId: `proof:${id}`, stage, target, operation, ...extra });
const B = { kind: 'base' }, N = { kind: 'new-component' }, T = { kind: 'total' };
const C = componentId => ({ kind: 'component', componentId });
const add = (id, cost, choice = 'mandatory') => mod(id, 'additional', N, 'add', { choice, cost });
const increase = (id, cost) => mod(id, 'increase', N, 'increase', { cost });
const discount = (id, stage, target, reduction) => mod(id, stage, target, 'discount', { reduction });
const rejects = (d, pattern = /Duel cost resolver/) => assert.throws(() => resolve(d), pattern);

// Untrusted client messages can only reference the transaction; they cannot carry costs/modifiers.
test('no modifiers returns the exact trusted base cost, without source aliasing', () => {
  const d = base();
  const result = resolve(d);
  assert.deepEqual(result.finalResolvedCost, BASE);
  assert.deepEqual(result.applications, []);
  assert.equal(result.baseProofId, 'proof:base');
  assert.equal(result.coverageProofId, 'proof:coverage');
  assert.notStrictEqual(result.baseCost, d.base.cost);
  assert.notStrictEqual(result.finalResolvedCost, d.base.cost);
  assert.notStrictEqual(result.finalResolvedCost.power[0].allowedDomains, BASE.power[0].allowedDomains);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.applications));
  assert.ok(Object.isFrozen(result.baseCost) && Object.isFrozen(result.finalResolvedCost));
  assert.ok(Object.isFrozen(result.finalResolvedCost.power) && Object.isFrozen(result.finalResolvedCost.power[0].allowedDomains));
  d.base.cost.power[0].allowedDomains.push('Order');
  assert.deepEqual(result.finalResolvedCost, rune(6, power(['Mind', 'Chaos'], 3), power(['Fury'], 2)));
});

test('base rewrite/ignore precede optional additions and increases; component before total discounts', () => {
  const d = decision(
    mod('replace', 'base', B, 'replace-base', { cost: rune(8, power(['Mind', 'Chaos'], 4)) }),
    mod('ignoreEnergy', 'base', B, 'ignore-base-energy'),
    discount('baseLess', 'component-discount', C('base'), { power: [{ requirementIndex: 0, amount: 1 }] }),
    add('optional', rune(2, power(['Fury'], 3)), 'chosen-optional'),
    discount('optionalLess', 'additional-component-discount', C('optional'),
      { energy: { amount: 1 }, power: [{ requirementIndex: 0, amount: 2 }] }),
    add('mandatory', rune(1, power(all, 1))),
    increase('increase', rune(2, power(['Order'], 2))),
    discount('wholeLess', 'total-discount', T,
      { energy: { amount: 2 }, power: [{ requirementIndex: 1, amount: 1 }] }),
  );
  const result = resolve(d);
  assert.deepEqual(result.finalResolvedCost, rune(2,
    power(['Mind', 'Chaos'], 3), power(all, 1), power(['Order'], 2)));
  assert.equal(result.applications.length, d.modifiers.length);
  assert.deepEqual(result.applications.map(a => a.modifierId), d.modifiers.map(m => m.id));
  assert.deepEqual(result.applications[4].before, rune(2, power(['Fury'], 3)));
  assert.deepEqual(result.applications[4].after, rune(1, power(['Fury'], 1)));
  assert.deepEqual(result.applications.at(-1).before, rune(4, power(['Mind', 'Chaos'], 3),
    power(['Fury'], 1), power(all, 1), power(['Order'], 2)));
  assert.ok(result.applications.every(a => Object.isFrozen(a) && Object.isFrozen(a.target) &&
    Object.isFrozen(a.before.power) && Object.isFrozen(a.after.power)));
  assert.deepEqual(Object.keys(result).sort(), ['applications', 'baseCost', 'baseProofId', 'coverageProofId', 'finalResolvedCost']);
  assert.deepEqual(Object.keys(result.applications[0]).sort(), ['after', 'before', 'modifierId', 'sourceProofId', 'stage', 'target']);
  assert.ok(!JSON.stringify(result).includes('private-source-card-text'));
});

test('ignore base costs does not erase later additions; ignore ALL costs acts at total modification', () => {
  const ignore = mod('ignore', 'base', B, 'ignore-base');
  const extra = add('accelerate', rune(1, power(['Fury'], 1)), 'chosen-optional');
  assert.deepEqual(resolve(decision(ignore, extra)).finalResolvedCost, rune(1, power(['Fury'], 1)));
  const ignoreAll = mod('ignoreAll', 'total-modification', T, 'ignore-all-costs');
  const outcome = resolve(decision(ignore, extra, ignoreAll));
  assert.deepEqual(outcome.finalResolvedCost, rune(0));
  assert.deepEqual(outcome.applications.at(-1).before, rune(1, power(['Fury'], 1)));
  assert.deepEqual(resolve(decision(mod('noPower', 'base', B, 'ignore-base-power'))).finalResolvedCost, rune(6));
});

test('each discount floor applies only to that discount; second discount can reduce below first floor', () => {
  const d = decision(
    discount('floorOne', 'total-discount', T,
      { energy: { amount: 5, floor: 3 }, power: [{ requirementIndex: 0, amount: 10, floor: 1 }] }),
    discount('afterFloor', 'total-discount', T,
      { energy: { amount: 10 }, power: [{ requirementIndex: 0, amount: 10 }] }),
  );
  assert.deepEqual(resolve(d).finalResolvedCost, rune(0, power(['Fury'], 2)));
  assert.deepEqual(resolve(d).applications[0].after,
    rune(3, power(['Mind', 'Chaos'], 1), power(['Fury'], 2)));
  assert.deepEqual(resolve(decision(discount('over', 'total-discount', T,
    { energy: { amount: Number.MAX_SAFE_INTEGER, floor: 7 } }))).finalResolvedCost, BASE);
});

test('the resolved DuelRuneCost is accepted by the real payment kernel with exact domain allocation', () => {
  const finalResolvedCost = resolve(decision(discount('energyLess', 'total-discount', T,
    { energy: { amount: 5 }, power: [{ requirementIndex: 0, amount: 2 }] }))).finalResolvedCost;
  assert.deepEqual(finalResolvedCost, rune(1, power(['Mind', 'Chaos'], 1), power(['Fury'], 2)));
  const locations = [{ playerId: 'p1', locationId: 'base:p1' }, { playerId: 'p2', locationId: 'base:p2' }];
  const state = structuredClone(createDuelResources({ playerIds: ['p1', 'p2'], baseLocations: locations, runeDecks: [[], []] }));
  state.players[0].runePool.energy = 1;
  state.players[0].runePool.power.Mind = 1;
  state.players[0].runePool.power.Fury = 2;
  const restored = restoreDuelResources(state, locations);
  const paid = payDuelRuneCost(restored, 'p1', finalResolvedCost,
    { stateOpen: false, priorityPlayerId: null, resourcePaymentPlayerId: 'p1' });
  assert.equal(paid.resources.players[0].runePool.energy, 0);
  assert.equal(paid.resources.players[0].runePool.power.Mind, 0);
  assert.equal(paid.resources.players[0].runePool.power.Fury, 0);
  assert.equal(restored.players[0].runePool.power.Mind, 1);
  assert.equal(restored.players[0].runePool.energy, 1);
});

test('total modifications replace the whole numeric cost after discounts and cannot be followed by discounts', () => {
  const rewrite = mod('rewrite', 'total-modification', T, 'replace-total',
    { cost: rune(4, power(['Calm', 'Mind'], 2)) });
  assert.deepEqual(resolve(decision(rewrite)).finalResolvedCost, rune(4, power(['Calm', 'Mind'], 2)));
  rejects(decision(rewrite, discount('late', 'total-discount', T, { energy: { amount: 1 } })), /stage order/);
});

test('JSON authority and client-computed totals never authenticate; decision/request mismatches reject', () => {
  const trusted = createDuelCostResolverAuthorityV2(() => base(), () => verified([]));
  for (const imposter of [{}, { _duelCostResolverAuthorityV2: true },
    JSON.parse(JSON.stringify(trusted)), Object.create(trusted)]) {
    assert.throws(() => resolveDuelTotalCostV2(imposter, req), /unrecognized resolver authority/);
  }
  assert.throws(() => resolveDuelTotalCostV2(trusted, { ...req, finalResolvedCost: rune(0) }), /unknown keys/);
  assert.throws(() => resolveDuelTotalCostV2(trusted, { ...req, subjectId: '' }), /subject ID/);
  rejects({ ...base(), request: { ...req, transactionId: 'other' } }, /different request/);
  rejects({ ...base(), base: { ...base().base, request: { ...req, subjectId: 'other' } } }, /different request/);
  rejects({ ...base(), coverage: { ...base().coverage, request: { ...req, subjectId: 'other' } } }, /different request/);
});

test('missing, unknown or inapplicable evidence cannot stand in for zero modifiers', () => {
  for (const field of ['allModifierSourcesCovered', 'choicesResolved']) {
    const d = base(); d.coverage[field] = false; rejects(d, /incomplete cost source/);
  }
  for (const status of ['unknown', null]) {
    const d = base(); d.coverage.status = status; rejects(d, /incomplete cost source/);
  }
  for (const value of ['present', 'unknown', null]) {
    const d = base(); d.coverage.nonResourceCosts = value; rejects(d, /incomplete cost source/);
  }
  const d = base(); d.base.status = 'unknown'; rejects(d, /unknown or incomplete base/);
  const m = add('extra', rune(1));
  for (const mutate of [
    d => d.proofs = [],
    d => d.proofs[0].status = 'unknown',
    d => d.proofs[0].applicability = 'unknown',
    d => d.proofs[0].applicability = 'does-not-apply',
    d => d.proofs[0].modifierId = 'alien',
    d => d.proofs[0].target = T,
    d => d.proofs[0].request = { ...req, transactionId: 'alien' },
    d => d.proofs[0].proofId = 'proof:base',
    d => d.proofs[0].proofId = 'proof:coverage',
  ]) { const candidate = decision(m); mutate(candidate); rejects(candidate); }
  rejects({ ...base(), coverage: { ...base().coverage, proofId: 'proof:base' } });
  rejects({ ...base(), extraWireField: true }, /unknown keys/);
});

test('duplicates, illegal stages, illegal operations/targets and unchosen optional additions reject', () => {
  const m = add('one', rune(2));
  rejects(decision(m, m), /duplicate/);
  const badCases = [
    [mod('bad', 'increase', N, 'increase', { cost: rune(1) }), m],
    [mod('bad', 'additional', T, 'add', { choice: 'mandatory', cost: rune(1) })],
    [mod('bad', 'base', N, 'ignore-base')],
    [mod('bad', 'total-discount', C('base'), 'discount', { reduction: { energy: { amount: 1 } } })],
    [mod('bad', 'arbitrary', T, 'discount', { reduction: { energy: { amount: 1 } } })],
    [add('bad', rune(1), 'not-chosen')],
    [discount('early', 'additional-component-discount', C('late'), { energy: { amount: 1 } }), add('late', rune(2))],
    [add('one', rune(2)), add('two', rune(3)), discount('late', 'additional-component-discount', C('one'), { energy: { amount: 1 } })],
    [add('one', rune(2)), discount('wrong', 'additional-component-discount', C('base'), { energy: { amount: 1 } })],
    [discount('wrong', 'component-discount', C('unknown'), { energy: { amount: 1 } })],
    [discount('wrong', 'total-discount', T, { power: [{ requirementIndex: 99, amount: 1 }] })],
    [mod('bad', 'base', B, 'replace-base')],
    [{ ...m, injected: 1 }],
  ];
  for (const modifiers of badCases) rejects(decision(...modifiers));
  const d = decision(add('one', rune(1)), add('two', rune(1)));
  d.proofs[1].proofId = d.proofs[0].proofId;
  rejects(d, /duplicate proof/);
});

test('negative/fractional/unsafe amounts, zero Power and empty Domain sets fail without mutation', () => {
  const d = decision(add('extra', rune(1)));
  const original = structuredClone(d);
  for (const raw of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null, undefined]) {
    const candidate = structuredClone(d); candidate.modifiers[0].cost.energy = raw;
    rejects(candidate);
    assert.deepEqual(candidate.modifiers[0].cost.energy, raw);
  }
  for (const badPower of [power([], 1), power(['Mind', 'Mind'], 1), power(['NotDomain'], 1),
    power(['Mind'], 0), power(['Mind'], -1), power(['Mind'], Number.MAX_SAFE_INTEGER + 1)]) {
    const candidate = structuredClone(d); candidate.modifiers[0].cost.power = [badPower];
    rejects(candidate);
    assert.deepEqual(candidate.modifiers[0].cost.power, [badPower]);
  }
  for (const reduction of [{}, { power: [] }, { energy: { amount: 0 } }, { energy: { amount: -1 } },
    { energy: { amount: 1, floor: -1 } }, { power: [{ requirementIndex: 0, amount: 0 }] },
    { power: [{ requirementIndex: 0, amount: 1 }, { requirementIndex: 0, amount: 1 }] },
    { power: [{ requirementIndex: -1, amount: 1 }] }]) {
    rejects(decision(discount('bad', 'total-discount', T, reduction)));
  }
  assert.deepEqual(d, original, 'failure never mutates the decision');
});

test('combined overflow rejects before any later discount or rewrite can hide it', () => {
  rejects({ ...base(), base: { ...base().base, cost: rune(Number.MAX_SAFE_INTEGER, power(['Mind'], 1)) } }, /overflows/);
  rejects(decision(add('extra', rune(Number.MAX_SAFE_INTEGER))), /overflows/);
  rejects(decision(increase('incr', rune(0, power(['Fury'], Number.MAX_SAFE_INTEGER)))), /overflows/);
  rejects(decision(add('extra', rune(Number.MAX_SAFE_INTEGER)),
    discount('discount', 'total-discount', T, { energy: { amount: Number.MAX_SAFE_INTEGER } })), /overflows/);
  rejects(decision(mod('rewrite', 'total-modification', T, 'replace-total',
    { cost: rune(Number.MAX_SAFE_INTEGER, power(['Fury'], 1)) })), /overflows/);
});

test('untrusted accessors, sparse arrays and inherited proof fields reject without executing getters', () => {
  const d = base(); let accessed = false;
  Object.defineProperty(d.coverage, 'status', { enumerable: true, get() { accessed = true; return 'complete'; } });
  rejects(d, /accessors/);
  assert.equal(accessed, false);
  const sparse = base(); sparse.modifiers = new Array(1); rejects(sparse, /dense/);
  const extra = decision(add('one', rune(1)));
  extra.proofs[0] = Object.assign(Object.create({ status: 'complete' }), extra.proofs[0]);
  rejects(extra, /plain record/);
  const tampered = decision(add('one', rune(1)));
  tampered.modifiers[0].cost.power = [power(['Mind'], 1)];
  Object.defineProperty(tampered.modifiers[0].cost.power[0], 'amount', { get() { accessed = true; return 1; } });
  rejects(tampered, /accessors/);
  assert.equal(accessed, false);
});

// The source snapshot is independently captured before any decision mutation. All fingerprints
// are deterministic SHA-256 comparisons; possession of the public helpers is NOT proof of origin.
test('public decision JSON and self-computed fingerprints do not replace an independent verifier', () => {
  const d = base();
  assert.throws(() => createDuelCostResolverAuthorityV2(() => d), /independent verifier required/);
  assert.throws(() => resolveDuelTotalCostV2(d, req), /unrecognized resolver authority/);
  const m = add('required', rune(7));
  const omitted = base();
  const snapshot = verified([m]);
  assert.throws(() => resolver(omitted, snapshot), /source coverage snapshot mismatch/);
  omitted.coverage = { ...omitted.coverage, ...fingerprintDuelCostCoverageV2(snapshot) };
  assert.throws(() => resolver(omitted, snapshot), /source modifiers are incomplete/);
  assert.equal(omitted.coverage.allModifierSourcesCovered, true);
  assert.equal(omitted.coverage.choicesResolved, true);
});

test('complete candidate coverage includes nonapplicable and declined sources with no modifiers', () => {
  const d = base();
  const candidates = [
    { sourceUid: 'source:not-applicable', sourceEpoch: 1, choice: 'not-applicable', modifierIds: [] },
    { sourceUid: 'source:declined', sourceEpoch: 2, choice: 'declined-optional', modifierIds: [] },
  ];
  const snapshot = verified([], d.base.cost, candidates);
  d.coverage = { ...d.coverage, ...fingerprintDuelCostCoverageV2(snapshot) };
  assert.deepEqual(resolver(d, snapshot).finalResolvedCost, BASE);
  const missing = verified([], d.base.cost, candidates.slice(0, 1));
  assert.throws(() => resolver(d, missing), /source coverage snapshot mismatch/);
  const alteredChoice = verified([], d.base.cost, [candidates[0], { ...candidates[1], choice: 'chosen-optional' }]);
  assert.throws(() => resolver(d, alteredChoice), /source coverage snapshot mismatch/);
  const duplicated = verified([], d.base.cost, [candidates[0], candidates[0]]);
  assert.throws(() => resolver(d, duplicated), /duplicate candidate source/);
});

test('modifier content/order, base identity and source epoch bind to independent catalog evidence', () => {
  const change = discount('off', 'total-discount', T,
    { energy: { amount: 1, floor: 1 }, power: [{ requirementIndex: 0, amount: 1 }] });
  const d = decision(add('required', rune(7)), change);
  const original = trustedSnapshot(d);
  const tampered = structuredClone(d);
  tampered.modifiers[0].cost.energy = 1;
  assert.throws(() => resolver(tampered, original), /modifier source snapshot mismatch/);
  tampered.proofs[0].modifierFingerprint = fingerprintDuelCostModifierV2(req, tampered.modifiers[0]);
  assert.throws(() => resolver(tampered, original), /modifier source snapshot mismatch/);
  const stageChange = structuredClone(d);
  stageChange.modifiers[1].reduction.energy.floor = 0;
  stageChange.proofs[1].modifierFingerprint = fingerprintDuelCostModifierV2(req, stageChange.modifiers[1]);
  assert.throws(() => resolver(stageChange, original), /modifier source snapshot mismatch/);
  const reorder = structuredClone(d);
  reorder.modifiers.reverse();
  assert.throws(() => resolver(reorder, original), /modifier source snapshot mismatch/);
  for (const mutate of [
    d => { d.base.sourceUid = 'source:counterfeit'; },
    d => { d.base.sourceEpoch += 1; },
    d => { d.base.cost.energy -= 1; },
    d => { d.proofs[0].sourceEpoch += 1; },
    d => { d.proofs[0].sourceUid = 'source:other'; },
    d => { d.proofs[0].modifierFingerprint = 'sha256:self-claimed'; },
    d => { d.coverage.registryRevision = 'registry:8'; d.proofs.forEach(p => p.registryRevision = 'registry:8'); },
    d => { d.coverage.catalogRevision = 'catalog:10'; d.proofs.forEach(p => p.catalogRevision = 'catalog:10');
      d.base.catalogRevision = 'catalog:10'; },
  ]) {
    const mutated = structuredClone(d); mutate(mutated);
    assert.throws(() => resolver(mutated, original), /Duel cost resolver/);
  }
  const otherRequest = { ...req, transactionId: 'pay:2' };
  assert.notEqual(fingerprintDuelCostModifierV2(req, change),
    fingerprintDuelCostModifierV2(otherRequest, change));
});

test('proxy get/map/status cannot erase costs or source coverage', () => {
  const d = decision(add('mandatory', rune(9, power(['Mind'], 1))));
  const snapshot = trustedSnapshot(d);
  const mapTrap = (target, key, receiver) => key === 'map' ? () => [] : Reflect.get(target, key, receiver);
  d.modifiers = new Proxy(d.modifiers, { get: mapTrap });
  assert.deepEqual(resolver(d, snapshot).finalResolvedCost,
    rune(15, power(['Mind', 'Chaos'], 3), power(['Fury'], 2), power(['Mind'], 1)));
  const withoutMods = decision(add('mandatory', rune(9)));
  const expected = trustedSnapshot(withoutMods);
  withoutMods.modifiers = new Proxy(withoutMods.modifiers, { get: mapTrap });
  withoutMods.proofs = [];
  assert.throws(() => resolver(withoutMods, expected), /every modifier needs exactly one source proof/);
  const proxiedBase = base();
  proxiedBase.base.cost.power = new Proxy(proxiedBase.base.cost.power, { get: mapTrap });
  assert.deepEqual(resolve(proxiedBase).finalResolvedCost, BASE);
  const status = base(); status.coverage.status = 'unknown';
  status.coverage = new Proxy(status.coverage, {
    get(target, key, receiver) { return key === 'status' ? 'complete' : Reflect.get(target, key, receiver); },
  });
  assert.throws(() => resolve(status), /incomplete cost source/);
});

test('drifting Proxy descriptors/ownKeys and throwing traps fail without revealing private payloads', () => {
  const secret = 'PRIVATE-HAND-AND-PROOF-ID';
  const assertPrivateError = execute => {
    let error;
    try { execute(); } catch (caught) { error = caught; }
    assert.ok(error instanceof TypeError && error.message.startsWith('Duel cost resolver:'));
    assert.equal(error.cause, undefined);
    assert.ok(!String(error.message).includes(secret));
    assert.ok(!String(error.stack).includes(secret));
  };
  const drift = base(); let keys = 0;
  drift.modifiers = new Proxy([], {
    ownKeys(t) { return ++keys % 2 ? Reflect.ownKeys(t) : ['length', '0']; },
  });
  assertPrivateError(() => resolve(drift));
  const descriptor = base(); let reads = 0;
  descriptor.coverage = new Proxy(descriptor.coverage, {
    getOwnPropertyDescriptor(t, key) {
      if (key === 'status' && ++reads === 2)
        return { ...Reflect.getOwnPropertyDescriptor(t, key), value: 'unknown' };
      return Reflect.getOwnPropertyDescriptor(t, key);
    },
  });
  assertPrivateError(() => resolve(descriptor));
  const throwing = base();
  throwing.base.cost.power = new Proxy(throwing.base.cost.power, {
    ownKeys() { throw new Error(secret, { cause: new Error(secret) }); },
  });
  assertPrivateError(() => resolve(throwing));
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  assertPrivateError(() => resolveDuelTotalCostV2(revoked.proxy, req));
});

test('callback exceptions are opaque; same authority and transaction cannot reenter or replay', () => {
  const secret = 'PRIVATE: hidden hand / proof';
  const inspect = run => {
    let error;
    try { run(); } catch (caught) { error = caught; }
    assert.equal(error?.message, 'Duel cost resolver: source callback failed');
    assert.equal(error?.cause, undefined);
    assert.ok(!String(error?.stack).includes(secret));
  };
  inspect(() => resolveDuelTotalCostV2(
    createDuelCostResolverAuthorityV2(() => { throw new Error(secret, { cause: new Error(secret) }); },
      () => verified([])), req));
  inspect(() => resolveDuelTotalCostV2(
    createDuelCostResolverAuthorityV2(() => base(), () => { throw new Error(secret); }), req));
  const d = base(); let calls = 0;
  let authority;
  authority = createDuelCostResolverAuthorityV2(() => {
    calls++;
    assert.throws(() => resolveDuelTotalCostV2(authority, req), /already in flight/);
    return d;
  }, () => verified([]));
  assert.throws(() => resolveDuelTotalCostV2(authority, req), /reentered/);
  assert.equal(calls, 1);
  assert.throws(() => resolveDuelTotalCostV2(authority, req), /already resolved/);
  let verifierCalls = 0;
  authority = createDuelCostResolverAuthorityV2(() => d, () => {
    verifierCalls++;
    assert.throws(() => resolveDuelTotalCostV2(authority, req), /already in flight/);
    return verified([]);
  });
  assert.throws(() => resolveDuelTotalCostV2(authority, req), /reentered/);
  assert.equal(verifierCalls, 1);
  let serviceCalls = 0;
  authority = createDuelCostResolverAuthorityV2(() => { serviceCalls++; return d; }, () => verified([]));
  assert.deepEqual(resolveDuelTotalCostV2(authority, req).finalResolvedCost, BASE);
  assert.throws(() => resolveDuelTotalCostV2(authority, req), /already resolved/);
  assert.equal(serviceCalls, 1);
});

test('extreme intermediate overflow rejects even with immediate component discount', () => {
  const hugeBase = rune(Number.MAX_SAFE_INTEGER - 1);
  const d = decision(add('extra', rune(2)),
    discount('immediate', 'additional-component-discount', C('extra'), { energy: { amount: 1 } }));
  d.base.cost = hugeBase;
  const snapshot = verified(d.modifiers, hugeBase);
  assert.throws(() => resolver(d, snapshot), /combined Energy overflows/);
  assert.equal(d.base.cost.energy, Number.MAX_SAFE_INTEGER - 1);
});
