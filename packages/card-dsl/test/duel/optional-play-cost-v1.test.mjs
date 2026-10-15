// Focused default (clean-checkout) suite for the pure-DATA `optional-play-cost-v1`
// recogniser.
//
// These cases build COMPLETE inline synthetic printing tuples with the REAL
// catalog Accelerate/other whole-ability literals, so the suite runs in a clean
// checkout and never reads the gitignored official catalog. The real catalog
// census lives in the separate TEST_REAL_CATALOG block below, which is SKIPPED
// unless RIFTBOUND_OPTIONAL_PLAY_COST_CATALOG points at a readable catalog
// (the parent runs it explicitly).
//
// The recogniser returns DATA only: it is not an authority, is never registered
// in the official-program registry, and its result carries no capability.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const moduleSpecifier =
  process.env.DUEL_OPTIONAL_PLAY_COST_MODULE ?? '../../dist/duel/optional-play-cost-v1.js';
const {
  DUEL_OPTIONAL_PLAY_COST_V1_KIND,
  DUEL_OPTIONAL_PLAY_COST_RUNE_DOMAINS,
  describeDuelOptionalPlayCostV1,
} = await import(moduleSpecifier);

const DATA_VERSION = '2026-10-12-official-gallery';
const DIGEST = 'sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10';

const REMINDER = (domain) =>
  `[Accelerate] (You may pay :rb_energy_1::rb_rune_${domain}: as an additional cost to have me enter ready.)`;

// Complete synthetic printing tuple with every DuelSourcePrintingCard field.
const synUnit = (id, ability, extra = {}) => ({
  id,
  cardType: extra.cardType ?? 'Unit',
  ability,
  energy: 'energy' in extra ? extra.energy : 5,
  power: 'power' in extra ? extra.power : null,
  might: 'might' in extra ? extra.might : 5,
  domains: extra.domains ?? ['Fury'],
  tags: extra.tags ?? ['Dragon'],
  canonicalCardId: extra.canonicalCardId ?? `card.syn-${id}`,
  name: extra.name ?? `Syn ${id}`,
  fullName: extra.fullName ?? `Syn ${id}`,
  localizedName: extra.localizedName ?? '合成',
  setCode: extra.setCode ?? 'syn',
  cardNumber: extra.cardNumber ?? `SYN-${id}`,
  variant: extra.variant ?? 'standard',
  dataVersion: DATA_VERSION,
  sourceCatalogDigest: DIGEST,
});

const ALL_SIX = ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'];

// 1
test('kind and baseline Rune domains are fixed and frozen', () => {
  assert.equal(DUEL_OPTIONAL_PLAY_COST_V1_KIND, 'optional-play-cost-v1');
  assert.deepEqual([...DUEL_OPTIONAL_PLAY_COST_RUNE_DOMAINS], ALL_SIX);
  assert.ok(Object.isFrozen(DUEL_OPTIONAL_PLAY_COST_RUNE_DOMAINS));
  assert.ok(!DUEL_OPTIONAL_PLAY_COST_RUNE_DOMAINS.includes('Colorless'));
});

// 2
test('recognises the real ogn-001-298 whole-ability Accelerate (Fury) as known', () => {
  const card = synUnit('ogn-001-298', REMINDER('fury'), { energy: 5, might: 5, domains: ['Fury'], tags: ['Dragon', 'Noxus'] });
  const result = describeDuelOptionalPlayCostV1(card);
  assert.equal(result.status, 'known');
  assert.equal(result.kind, 'optional-play-cost-v1');
  assert.equal(result.cardId, 'ogn-001-298');
  assert.equal(result.canonicalCardId, card.canonicalCardId);
  assert.equal(result.source.normalizedAbilityText, REMINDER('fury'));
  assert.equal(result.source.energy, 5);
  assert.equal(result.source.power, null);
  assert.equal(result.source.might, 5);
  assert.deepEqual(result.source.domains, ['Fury']);
  assert.deepEqual(result.source.tags, ['Dragon', 'Noxus']);
  assert.equal(result.printedBaseCost.energy, 5);
  assert.equal(result.source.might, 5);
  assert.deepEqual(result.semantics, {
    kind: 'accelerate',
    choiceTiming: 'card-play-choices',
    optional: true,
    additionalCost: { energy: 1, power: [{ allowedDomains: ['Fury'], amount: 1 }] },
    paidEffect: { kind: 'enter-ready-replacement', timing: 'unit-entry' },
  });
});

// 3
test('recognises the real ogn-010-298 whole-ability Accelerate (Fury) with base 2/2', () => {
  const card = synUnit('ogn-010-298', REMINDER('fury'), { energy: 2, might: 2, domains: ['Fury'], tags: ['Trifarian', 'Noxus'] });
  const result = describeDuelOptionalPlayCostV1(card);
  assert.equal(result.status, 'known');
  assert.equal(result.printedBaseCost.energy, 2);
  assert.equal(result.source.might, 2);
  assert.deepEqual(result.semantics.additionalCost.power[0].allowedDomains, ['Fury']);
});

// 4
test('the additional cost is energy 1 plus one power of the unit domain; base cost is separate', () => {
  const card = synUnit('syn-known-calm', REMINDER('calm'), { energy: 7, might: 6, domains: ['Calm'] });
  const result = describeDuelOptionalPlayCostV1(card);
  assert.equal(result.status, 'known');
  assert.deepEqual(result.semantics.additionalCost, {
    energy: 1,
    power: [{ allowedDomains: ['Calm'], amount: 1 }],
  });
  // The base cost is listed separately and never auto-summed into the additional cost.
  assert.deepEqual(result.printedBaseCost, { energy: 7, power: null });
});

// 5
test('normalizes identical whole-ability text (CRLF / edge whitespace) to the same known result', () => {
  const noisy = `\r\n  ${REMINDER('mind')}  \r\n`;
  const result = describeDuelOptionalPlayCostV1(synUnit('syn-known-mind', noisy, { domains: ['Mind'] }));
  assert.equal(result.status, 'known');
  assert.equal(result.source.normalizedAbilityText, REMINDER('mind'));
  assert.deepEqual(result.semantics.additionalCost.power[0].allowedDomains, ['Mind']);
});

// 6
test('a domain symbol that disagrees with the unit domains is UNKNOWN (never silently accepted)', () => {
  // Text prints Fury but the printing's domains are Calm.
  const result = describeDuelOptionalPlayCostV1(synUnit('syn-mismatch', REMINDER('fury'), { domains: ['Calm'] }));
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'accelerate-rune-symbol-mismatch');
  assert.equal(result.normalizedAbilityText, REMINDER('fury'));
});

// 7
test('any attached instruction after the Accelerate reminder is UNKNOWN (tail effects are not ignored)', () => {
  const tails = [
    `${REMINDER('fury')}\nJinx: discard 2.`,
    `${REMINDER('fury')}\n[Assault 2] (+2 :rb_might: while I'm an attacker.)`,
    `${REMINDER('fury')}\nWhen I conquer, draw 1.`,
    `${REMINDER('fury')}\n[Ganking] (I can move from battlefield to battlefield.)`,
    `${REMINDER('fury')}\nWhen you play me, discard 2.`,
    `${REMINDER('fury')}\nUnknown trailing sentence.`,
  ];
  for (const ability of tails) {
    const result = describeDuelOptionalPlayCostV1(synUnit('syn-tail', ability));
    assert.equal(result.status, 'unknown', `expected unknown for ${JSON.stringify(ability)}`);
    assert.equal(result.reason, 'ability-not-pure-accelerate');
  }
});

// 8
test('a second Accelerate or partial text is UNKNOWN', () => {
  const partial = [
    '[Accelerate]',
    '[Accelerate]\n[Assault 2]\nWhen you play me, discard 2.',
    `${REMINDER('fury')}\n${REMINDER('fury')}`,
    '[Accelerate] (You may pay :rb_energy_1: as an additional cost to have me enter ready.)',
    '[Accelerate] (You may pay :rb_energy_2::rb_rune_fury: as an additional cost to have me enter ready.)',
  ];
  for (const ability of partial) {
    const result = describeDuelOptionalPlayCostV1(synUnit('syn-partial', ability));
    assert.equal(result.status, 'unknown', `expected unknown for ${JSON.stringify(ability)}`);
  }
});

// 9
test('other optional-cost shapes (Clockwork Keeper, optional discard, mandatory Deflect) are UNKNOWN', () => {
  const others = [
    'As you play me, you may pay :rb_rune_calm: as an additional cost. If you do, draw 1.',
    'As you play me, you may discard 1 as an additional cost. If you do, reduce my cost by :rb_energy_2:.',
    '[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)',
  ];
  for (const ability of others) {
    const result = describeDuelOptionalPlayCostV1(synUnit('syn-other', ability));
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'ability-not-pure-accelerate');
  }
});

// 10
test('a non-Unit printing with the exact reminder is UNKNOWN (not-unit)', () => {
  const result = describeDuelOptionalPlayCostV1(
    synUnit('rad-162-167', REMINDER('fury'), { cardType: 'Battlefield', energy: null, might: null, domains: ['Colorless'] }),
  );
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'not-unit');
});

// 11
test('empty / no-ability text never returns blank or a no-ability template', () => {
  for (const ability of ['', null, undefined]) {
    const result = describeDuelOptionalPlayCostV1(synUnit('syn-empty', ability));
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'ability-not-pure-accelerate');
    assert.notEqual(result.normalizedAbilityText, undefined);
  }
});

// 12
test('non-numeric source energy/might is reported UNKNOWN', () => {
  const noEnergy = describeDuelOptionalPlayCostV1(synUnit('syn-null-energy', REMINDER('fury'), { energy: null }));
  assert.equal(noEnergy.status, 'unknown');
  assert.equal(noEnergy.reason, 'non-numeric-source-stat');
  const noMight = describeDuelOptionalPlayCostV1(synUnit('syn-null-might', REMINDER('fury'), { might: null }));
  assert.equal(noMight.status, 'unknown');
  assert.equal(noMight.reason, 'non-numeric-source-stat');
});

// 13
test('unknown Rune-domain token is UNKNOWN; Colorless is never a seventh domain', () => {
  const weird = describeDuelOptionalPlayCostV1(synUnit('syn-weird', REMINDER('fury'), { domains: ['Fury', 'Piltover'] }));
  assert.equal(weird.status, 'unknown');
  assert.equal(weird.reason, 'unknown-runedomain-token');

  // No CR1.4 evidence establishes the catalog Colorless convention as an
  // empty domain list; it remains unknown rather than granting any-domain power.
  const colorless = describeDuelOptionalPlayCostV1(synUnit('syn-colorless', REMINDER('fury'), { domains: ['Colorless'] }));
  assert.equal(colorless.status, 'unknown');
  assert.equal(colorless.reason, 'unknown-runedomain-token');
});

// 14
test('multi-domain / domainless allowed-domains behaviour (given CR fixture, marked fixture)', () => {
  // FIXTURE: the real catalog carries no pure-Accelerate multi-domain printing and
  // no pure-Accelerate domainless printing; these tuples are synthetic CR fixtures.
  const multi = describeDuelOptionalPlayCostV1(
    synUnit('syn-fixture-multi', REMINDER('fury'), { domains: ['Fury', 'Chaos'] }),
  );
  assert.equal(multi.status, 'known');
  assert.deepEqual(multi.semantics.additionalCost.power[0].allowedDomains, ['Fury', 'Chaos']);

  const domainless = describeDuelOptionalPlayCostV1(
    synUnit('syn-fixture-domainless', REMINDER('fury'), { domains: [] }),
  );
  assert.equal(domainless.status, 'known');
  assert.deepEqual(domainless.semantics.additionalCost.power[0].allowedDomains, ALL_SIX);
});

// 15
test('results are deeply frozen and the input is never mutated', () => {
  const card = synUnit('ogn-001-298', REMINDER('fury'), { domains: ['Fury'], tags: ['Dragon'] });
  const before = JSON.stringify(card);
  const result = describeDuelOptionalPlayCostV1(card);
  assert.equal(JSON.stringify(card), before, 'input tuple must not be mutated');
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.source));
  assert.ok(Object.isFrozen(result.source.domains));
  assert.ok(Object.isFrozen(result.semantics));
  assert.ok(Object.isFrozen(result.semantics.additionalCost));
  assert.ok(Object.isFrozen(result.semantics.additionalCost.power[0]));
  assert.ok(Object.isFrozen(result.semantics.additionalCost.power[0].allowedDomains));
  assert.throws(() => {
    'use strict';
    result.semantics.additionalCost.energy = 99;
  }, TypeError);
});

// 16
test('a known or unknown result is DATA only: no capability fields, no executable reference', () => {
  const known = describeDuelOptionalPlayCostV1(synUnit('ogn-001-298', REMINDER('fury')));
  const unknown = describeDuelOptionalPlayCostV1(synUnit('syn-tail', `${REMINDER('fury')}\nJinx: discard 2.`));
  for (const result of [known, unknown]) {
    const keys = Object.keys(result);
    for (const forbidden of ['privateUID', 'epoch', 'mintReceipt', 'sourceProof', 'authority', 'encoded', 'reference']) {
      assert.ok(!keys.includes(forbidden), `result must not carry ${forbidden}`);
    }
  }
  assert.deepEqual(Object.keys(known).sort(), [
    'canonicalCardId', 'cardId', 'kind', 'printedBaseCost', 'semantics', 'source', 'status',
  ]);
  assert.deepEqual(Object.keys(unknown).sort(), [
    'canonicalCardId', 'cardId', 'kind', 'normalizedAbilityText', 'reason', 'status',
  ]);
});

// 17
test('accessors are never invoked; symbol/sparse/missing fields are rejected; extra data fields are tolerated unread', () => {
  let invoked = 0;
  const withGetter = synUnit('syn-getter', REMINDER('fury'));
  Object.defineProperty(withGetter, 'id', { get() { invoked += 1; return 'syn-getter'; }, enumerable: true, configurable: true });
  assert.throws(() => describeDuelOptionalPlayCostV1(withGetter), TypeError);
  assert.equal(invoked, 0, 'accessor must never be invoked');

  const withSymbol = synUnit('syn-symbol', REMINDER('fury'));
  withSymbol[Symbol('x')] = 1;
  assert.throws(() => describeDuelOptionalPlayCostV1(withSymbol), TypeError);

  const sparse = synUnit('syn-sparse', REMINDER('fury'));
  sparse.domains = ['Fury'];
  delete sparse.domains[0];
  sparse.domains.length = 1;
  assert.throws(() => describeDuelOptionalPlayCostV1(sparse), TypeError);

  const missing = synUnit('syn-missing', REMINDER('fury'));
  delete missing.tags;
  assert.throws(() => describeDuelOptionalPlayCostV1(missing), TypeError);

  // Extra enumerable DATA fields (as on the real catalog, e.g. imageUrl) are
  // tolerated and never read as semantics.
  const withExtra = { ...synUnit('syn-extra', REMINDER('fury')), imageUrl: 'https://example.invalid/x.png' };
  const extraResult = describeDuelOptionalPlayCostV1(withExtra);
  assert.equal(extraResult.status, 'known');
  assert.deepEqual(Object.keys(extraResult).sort(), [
    'canonicalCardId', 'cardId', 'kind', 'printedBaseCost', 'semantics', 'source', 'status',
  ]);
});

// 18
test('the recogniser is never registered in the official-program registry', async () => {
  const programsSpecifier =
    process.env.DUEL_OFFICIAL_PROGRAMS_MODULE ?? '../../dist/duel/official-programs.js';
  const mod = await import(programsSpecifier);
  for (const name of Object.keys(mod)) {
    assert.ok(!/optional-play-cost/u.test(name), `registry export ${name} must not exist`);
  }
});

