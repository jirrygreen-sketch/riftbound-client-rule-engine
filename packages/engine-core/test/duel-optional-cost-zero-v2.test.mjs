// Independent regression for CR 355.1.a / 356.2.b.1 / 356.4.f.1 / 356.1.b.3 against the REAL
// cost-resolver-v2. Production source is NOT modified. The resolver today has no effect/choice
// receipt: these tests only prove the existing cost data does not drop a chosen source, they do
// NOT claim any "If you do" effect execution.
// Default node --test uses the parent's compiled dist; source-level validation uses
// DUEL_OPTIONAL_COST_ZERO_SOURCE=1 node --import <tsx loader> --test test/duel-optional-cost-zero-v2.test.mjs.
// Never build shared dist merely to run the source-level test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const source = process.env.DUEL_OPTIONAL_COST_ZERO_SOURCE === '1' ||
  process.env.DUEL_COST_RESOLVER_SOURCE === '1';
const {
  createDuelCostResolverAuthorityV2, resolveDuelTotalCostV2,
  fingerprintDuelCostModifierV2, fingerprintDuelCostCoverageV2,
} = await import(source ? '../src/duel/cost-resolver-v2.ts' : '../dist/duel/cost-resolver-v2.js');

const req = Object.freeze({ transactionId: 'pay:zero:1', subjectId: 'printed:zero:1', kind: 'card-play' });
const power = (allowedDomains, amount) => ({ allowedDomains, amount });
const rune = (energy, ...requirements) => ({ energy, power: requirements });
const BASE = rune(6, power(['Mind', 'Chaos'], 3), power(['Fury'], 2));
const revision = Object.freeze({ registryRevision: 'registry:7', catalogRevision: 'catalog:9' });

// Trusted modifier/catalog fixtures (SHA-256 fingerprints are deterministic comparisons, not
// signatures): only the independent verifier snapshot authenticates the candidate set.
const candidate = (id, choice, modifierIds) =>
  ({ sourceUid: `source:${id}`, sourceEpoch: 2, choice, modifierIds });
const verified = (modifiers, baseCost = structuredClone(BASE), candidates = modifiers.map(m =>
  ({ sourceUid: `source:${m.id}`, sourceEpoch: 2, choice: m.choice ?? 'mandatory', modifierIds: [m.id] }))) =>
  ({ ...revision, nonResourceCosts: 'none',
    base: { sourceUid: 'base:printed:zero:1', sourceEpoch: 3, cost: structuredClone(baseCost) },
    candidates: structuredClone(candidates), orderedModifiers: structuredClone(modifiers) });
const coverageFingerprints = snapshot => fingerprintDuelCostCoverageV2(snapshot);
const proofFor = (modifier, coverage) => ({ proofId: `proof:${modifier.id}`, modifierId: modifier.id,
  request: req, target: modifier.target, status: 'complete', applicability: 'applies', ...revision,
  candidateSourcesFingerprint: coverage.candidateSourcesFingerprint,
  resolvedChoicesFingerprint: coverage.resolvedChoicesFingerprint,
  sourceUid: `source:${modifier.id}`, sourceEpoch: 2,
  modifierFingerprint: fingerprintDuelCostModifierV2(req, modifier) });
const decisionFor = (modifiers, snapshot) => {
  let fingerprints;
  try { fingerprints = coverageFingerprints(snapshot); }
  catch { fingerprints = {}; } // preserve malformed inputs for the negative resolver tests
  const coverage = { request: req, status: 'complete', proofId: 'proof:coverage',
    allModifierSourcesCovered: true, choicesResolved: true, nonResourceCosts: 'none', ...revision, ...fingerprints };
  return { request: req,
    base: { request: req, status: 'complete', proofId: 'proof:base', cost: structuredClone(snapshot.base.cost),
      ...revision, sourceUid: snapshot.base.sourceUid, sourceEpoch: snapshot.base.sourceEpoch },
    coverage, modifiers: structuredClone(modifiers), proofs: modifiers.map(m => proofFor(m, coverage)) };
};
const resolveWith = (decision, snapshot) =>
  resolveDuelTotalCostV2(createDuelCostResolverAuthorityV2(() => decision, () => snapshot), req);

const mod = (id, stage, target, operation, extra = {}) =>
  ({ id, sourceProofId: `proof:${id}`, stage, target, operation, ...extra });
const B = { kind: 'base' }, N = { kind: 'new-component' };
const C = componentId => ({ kind: 'component', componentId });
const add = (id, cost, choice = 'mandatory') => mod(id, 'additional', N, 'add', { choice, cost });
const cut = (id, stage, target, reduction) => mod(id, stage, target, 'discount', { reduction });
const OPTIONAL = add('optional', rune(1, power(['Fury'], 1)), 'chosen-optional');

test('declined optional source is retained in coverage, applies no modifier and leaves the trusted base intact', () => {
  const snapshot = verified([], BASE, [candidate('optional', 'declined-optional', [])]);
  const result = resolveWith(decisionFor([], snapshot), snapshot);
  assert.deepEqual(result.finalResolvedCost, BASE);
  assert.deepEqual(result.baseCost, BASE);
  assert.deepEqual(result.applications, []);
  assert.equal(result.baseProofId, 'proof:base');
  assert.equal(result.coverageProofId, 'proof:coverage');
  // A declined candidate carries no modifier ID; the coverage fingerprint reflects the decline.
  assert.equal(snapshot.candidates[0].choice, 'declined-optional');
  assert.deepEqual(snapshot.candidates[0].modifierIds, []);
  assert.notStrictEqual(result.finalResolvedCost, BASE);
});

test('a chosen optional 1 Energy + 1 Fury additional cost accumulates on top of the trusted base (356.2.b.1)', () => {
  const snapshot = verified([OPTIONAL], BASE, [candidate('optional', 'chosen-optional', ['optional'])]);
  const result = resolveWith(decisionFor([OPTIONAL], snapshot), snapshot);
  assert.deepEqual(result.finalResolvedCost,
    rune(7, power(['Mind', 'Chaos'], 3), power(['Fury'], 2), power(['Fury'], 1)));
  assert.equal(result.applications.length, 1);
  assert.deepEqual(result.applications[0].before, rune(0));
  assert.deepEqual(result.applications[0].after, rune(1, power(['Fury'], 1)));
  assert.equal(result.applications[0].modifierId, 'optional');
  assert.equal(result.applications[0].sourceProofId, 'proof:optional');
  assert.ok(Object.isFrozen(result.applications[0].after));
});

test('ignoring the base cost does not erase a chosen optional additional cost (356.1.b.3)', () => {
  const ignore = mod('ignoreBase', 'base', B, 'ignore-base');
  const snapshot = verified([ignore, OPTIONAL], BASE,
    [candidate('ignoreBase', 'mandatory', ['ignoreBase']), candidate('optional', 'chosen-optional', ['optional'])]);
  const result = resolveWith(decisionFor([ignore, OPTIONAL], snapshot), snapshot);
  assert.deepEqual(result.finalResolvedCost, rune(1, power(['Fury'], 1)));
  assert.deepEqual(result.applications[0].after, rune(0));
  assert.deepEqual(result.applications[1].after, rune(1, power(['Fury'], 1)));
});

test('a legal component discount can reduce a chosen optional cost to 0 while keeping chosen source data (356.4.f.1)', () => {
  const reduction = cut('cut', 'additional-component-discount', C('optional'),
    { energy: { amount: 1 }, power: [{ requirementIndex: 0, amount: 1 }] });
  const chosenSnapshot = verified([OPTIONAL, reduction], BASE,
    [candidate('optional', 'chosen-optional', ['optional']), candidate('cut', 'mandatory', ['cut'])]);
  const result = resolveWith(decisionFor([OPTIONAL, reduction], chosenSnapshot), chosenSnapshot);
  // The optional component is driven to zero, so the total equals the untouched base...
  assert.deepEqual(result.finalResolvedCost, BASE);
  assert.deepEqual(result.applications[1].before, rune(1, power(['Fury'], 1)));
  assert.deepEqual(result.applications[1].after, rune(0));
  // ...but the chosen source is preserved: application + proof still reference the chosen source.
  assert.equal(result.applications[0].modifierId, 'optional');
  assert.equal(result.applications[0].sourceProofId, 'proof:optional');
  assert.deepEqual(Object.keys(result).sort(),
    ['applications', 'baseCost', 'baseProofId', 'coverageProofId', 'finalResolvedCost']);
  assert.deepEqual(Object.keys(result.applications[0]).sort(),
    ['after', 'before', 'modifierId', 'sourceProofId', 'stage', 'target']);
  // No effect/choice receipt exists in this resolver today: a discounted-to-zero chosen cost is
  // only distinguishable from "declined" by the coverage/resolved-choice fingerprint and proofs.
  const declinedSnapshot = verified([], BASE, [candidate('optional', 'declined-optional', [])]);
  assert.notEqual(coverageFingerprints(chosenSnapshot).resolvedChoicesFingerprint,
    coverageFingerprints(declinedSnapshot).resolvedChoicesFingerprint);
  assert.notEqual(coverageFingerprints(chosenSnapshot).candidateSourcesFingerprint,
    coverageFingerprints(declinedSnapshot).candidateSourcesFingerprint);
});

test('a declined source carrying a modifier, an unresolved choice, a forged coverage fingerprint and a missing candidate are all rejected', () => {
  const declinedWithModifier = verified([OPTIONAL], BASE, [candidate('optional', 'declined-optional', ['optional'])]);
  assert.throws(() => resolveWith(decisionFor([OPTIONAL], declinedWithModifier), declinedWithModifier),
    /Duel cost resolver/);
  const unresolved = verified([OPTIONAL], BASE, [candidate('optional', 'pending', ['optional'])]);
  assert.throws(() => resolveWith(decisionFor([OPTIONAL], unresolved), unresolved), /Duel cost resolver/);
  const realSnapshot = verified([OPTIONAL], BASE, [candidate('optional', 'chosen-optional', ['optional'])]);
  const forged = decisionFor([OPTIONAL], realSnapshot);
  forged.coverage.candidateSourcesFingerprint = 'sha256:forged-candidates';
  forged.coverage.resolvedChoicesFingerprint = 'sha256:forged-choices';
  assert.throws(() => resolveWith(forged, realSnapshot), /source coverage snapshot mismatch/);
  const missingCandidate = verified([], BASE, []);
  assert.throws(() => resolveWith(decisionFor([OPTIONAL], realSnapshot), missingCandidate),
    /source coverage snapshot mismatch/);
  const wrongSource = decisionFor([OPTIONAL], realSnapshot);
  wrongSource.proofs[0].sourceUid = 'source:counterfeit';
  assert.throws(() => resolveWith(wrongSource, realSnapshot), /modifier source snapshot mismatch/);
});
