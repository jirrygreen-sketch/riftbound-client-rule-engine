// Focused suite for the pure-DATA `hold-score-description-v1` recogniser.
//
// These cases build COMPLETE inline synthetic printing tuples with the REAL
// catalog Hold→score / other whole-ability literals, so the suite runs in a
// clean checkout and never requires the gitignored official catalog. The real
// 1408-printing census is a second block below that runs when the catalog is
// readable (default relative path, or RIFTBOUND_HOLD_SCORE_CATALOG) and is
// required; missing data fails so a clean checkout cannot silently omit the audit.
//
// The recogniser returns DATA only: it is not an authority, is never registered
// in the official-program registry, and its result carries no capability. The
// real-catalog census below is a SOURCE-DATA classification, NOT a claim that
// any card executes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const moduleSpecifier =
  process.env.DUEL_HOLD_SCORE_MODULE ?? '../../dist/duel/hold-score-description-v1.js';
const {
  DUEL_HOLD_SCORE_V1_KIND,
  DUEL_HOLD_SCORE_V1_DATA_VERSION,
  DUEL_HOLD_SCORE_V1_CATALOG_DIGEST,
  DUEL_HOLD_SCORE_V1_WHOLE_TEXT,
  DUEL_HOLD_SCORE_V1_SCORE_AMOUNT,
  DUEL_HOLD_SCORE_V1_TRIGGER_EVENT,
  holdScoreWholeSourceFingerprint,
  describeDuelHoldScoreV1,
} = await import(moduleSpecifier);

const DATA_VERSION = '2026-10-15-official-gallery';
const DIGEST = 'sha256:e9635b38044140375c33d9e5d8e12c1c2386994dfaa9ae8ae6832a127ff9f73d';

const WHOLE = 'When I hold, you score 1 point.';
const EXPECTED_WHOLE_FP = 'sha256:6cd154b31b48da3de3f486cb74ad26f4f089a9c1fdc9274c94672f444e7809d8';

// Complete synthetic printing tuple with every DuelSourcePrintingCard field.
const synUnit = (id, ability, extra = {}) => ({
  id,
  cardType: extra.cardType ?? 'Unit',
  ability,
  energy: 'energy' in extra ? extra.energy : 5,
  power: 'power' in extra ? extra.power : 1,
  might: 'might' in extra ? extra.might : 4,
  domains: extra.domains ?? ['Calm'],
  tags: extra.tags ?? ['Ahri', 'Ionia', 'Champion'],
  canonicalCardId: extra.canonicalCardId ?? `card.syn-${id}`,
  name: extra.name ?? 'Ahri',
  fullName: extra.fullName ?? 'Ahri, Alluring',
  localizedName: extra.localizedName ?? '阿狸',
  setCode: extra.setCode ?? 'ogn',
  cardNumber: extra.cardNumber ?? `OGN-${id}`,
  variant: extra.variant ?? 'standard',
  dataVersion: DATA_VERSION,
  sourceCatalogDigest: DIGEST,
});

const KNOWN_KEYS = [
  'canonicalCardId', 'cardId', 'kind', 'semantics', 'source', 'status', 'wholeSourceFingerprint',
];
const UNKNOWN_KEYS = ['canonicalCardId', 'cardId', 'kind', 'normalizedAbilityText', 'reason', 'status'];

// 1
test('kind, fixed source metadata, whole literal, amount and event are fixed and frozen', () => {
  assert.equal(DUEL_HOLD_SCORE_V1_KIND, 'hold-score-description-v1');
  assert.equal(DUEL_HOLD_SCORE_V1_DATA_VERSION, DATA_VERSION);
  assert.equal(DUEL_HOLD_SCORE_V1_CATALOG_DIGEST, DIGEST);
  assert.equal(DUEL_HOLD_SCORE_V1_WHOLE_TEXT, WHOLE);
  assert.equal(DUEL_HOLD_SCORE_V1_SCORE_AMOUNT, 1);
  assert.equal(DUEL_HOLD_SCORE_V1_TRIGGER_EVENT, 'hold');
  // Dependency-free fingerprint must equal the real SHA-256 of the whole text.
  assert.equal(holdScoreWholeSourceFingerprint(WHOLE), EXPECTED_WHOLE_FP);
});

// 2
test('recognises the real ogn-066-298 whole-ability Hold→score as known', () => {
  const card = synUnit('ogn-066-298', WHOLE);
  const result = describeDuelHoldScoreV1(card);
  assert.equal(result.status, 'known');
  assert.equal(result.kind, 'hold-score-description-v1');
  assert.equal(result.cardId, 'ogn-066-298');
  assert.equal(result.canonicalCardId, card.canonicalCardId);
  assert.equal(result.source.normalizedAbilityText, WHOLE);
  assert.equal(result.source.energy, 5);
  assert.equal(result.source.power, 1);
  assert.equal(result.source.might, 4);
  assert.deepEqual(result.source.domains, ['Calm']);
  assert.deepEqual(result.source.tags, ['Ahri', 'Ionia', 'Champion']);
  assert.equal(result.source.dataVersion, DATA_VERSION);
  assert.equal(result.source.sourceCatalogDigest, DIGEST);
  assert.equal(result.wholeSourceFingerprint, EXPECTED_WHOLE_FP);
  assert.deepEqual(result.semantics, {
    kind: 'hold-trigger-score',
    event: 'hold',
    sourceScope: 'hold-source-unit',
    triggerCategory: 'hold-effect',
    controllerBinding: 'ability-controller',
    condition: null,
    optional: false,
    effects: [{ kind: 'score-points', amount: 1, recipient: 'ability-controller' }],
    unmodeled: [...result.semantics.unmodeled],
  });
});

// 3
test('the alternate-art ogn-066a-298 describes to the same canonical identity and whole-source fingerprint', () => {
  const canonical = 'card.hash-4f9cef9a5292a16fac59206baa263b0654606faa95119ee4a76583f82b2a4dac';
  const a = describeDuelHoldScoreV1(synUnit('ogn-066-298', WHOLE, { canonicalCardId: canonical, variant: 'standard' }));
  const b = describeDuelHoldScoreV1(synUnit('ogn-066a-298', WHOLE, { canonicalCardId: canonical, variant: 'alternate', cardNumber: 'OGN-066a/298' }));
  assert.equal(a.status, 'known');
  assert.equal(b.status, 'known');
  assert.equal(a.cardId, 'ogn-066-298');
  assert.equal(b.cardId, 'ogn-066a-298');
  assert.equal(a.canonicalCardId, b.canonicalCardId);
  assert.equal(a.wholeSourceFingerprint, b.wholeSourceFingerprint);
  assert.deepEqual(a.semantics, b.semantics);
});

// 4
test('normalizes identical whole-ability text (CRLF / edge whitespace) to the same known result', () => {
  const noisy = `\r\n\t${WHOLE}  \r\n`;
  const result = describeDuelHoldScoreV1(synUnit('ogn-066-298', noisy));
  assert.equal(result.status, 'known');
  assert.equal(result.source.normalizedAbilityText, WHOLE);
  assert.equal(result.wholeSourceFingerprint, EXPECTED_WHOLE_FP);
});

// 5
test('a printing that merely CONTAINS "hold" or "score" (never pure) is UNKNOWN — no prefix match', () => {
  const others = [
    // Battlefield form with "here": a DIFFERENT source binding, out of scope.
    'When you hold here, you score 1 point.',
    // real rad-160-167 (Battlefield) shape.
    'When you hold here, if your Rune Deck is empty, you score 1 point.',
    // real rad-109-167 (Unit with a keyword + condition) shape.
    "[Disarm] (When I attack, give an enemy unit here -1 :rb_might: this turn.)\nWhen I hold, if you control a facedown card here, score 1 point.",
    // real ven-138-166 shape (Shield keyword + condition).
    "[Shield] (+1 :rb_might: while I'm a defender.)\nWhen I hold, if there is exactly one other unit you control here, you score 1 point.",
    // trailing unknown sentence after the exact literal.
    `${WHOLE}\nUnknown trailing sentence.`,
    // a second trigger sentence.
    `${WHOLE}\nWhen I conquer, draw 1.`,
    // different score amount.
    'When I hold, you score 2 points.',
    // keyword prefix before the trigger.
    "[Ganking] (I can move from battlefield to battlefield.)\n" + WHOLE,
    // trigger without the score clause.
    'When I hold, draw 1.',
    // real unl-177-219 shape (conquer or hold + condition).
    'When I conquer or hold, score 1 point if your units have all of the following tags among them — Bird, Cat, Dog, and Poro.',
    // partial / malformed literal.
    'When I hold, you score 1 point',
    'when i hold, you score 1 point.',
  ];
  for (const ability of others) {
    const result = describeDuelHoldScoreV1(synUnit('syn-other', ability));
    assert.equal(result.status, 'unknown', `expected unknown for ${JSON.stringify(ability)}`);
    assert.equal(result.reason, 'ability-not-pure-hold-score');
  }
});

// 6
test('the Battlefield "when you hold here" form is never accepted, even under cardType Unit', () => {
  // cardType Battlefield gives not-unit; the same text forced as a Unit still
  // fails the whole-literal check (never prefix-matched into the known shape).
  const asBattlefield = describeDuelHoldScoreV1(
    synUnit('ogn-280-298', 'When you hold here, you score 1 point.', { cardType: 'Battlefield', energy: null, power: null, might: null, domains: ['Colorless'] }),
  );
  assert.equal(asBattlefield.status, 'unknown');
  assert.equal(asBattlefield.reason, 'not-unit');
  const asUnit = describeDuelHoldScoreV1(synUnit('syn-bf-as-unit', 'When you hold here, you score 1 point.'));
  assert.equal(asUnit.status, 'unknown');
  assert.equal(asUnit.reason, 'ability-not-pure-hold-score');
});

// 7
test('a non-Unit printing (e.g. a real Hold Battlefield) is UNKNOWN (not-unit)', () => {
  const result = describeDuelHoldScoreV1(
    synUnit('ogn-280-298', 'When you hold here, draw 1.', { cardType: 'Battlefield', energy: null, power: null, might: null, domains: ['Colorless'], tags: [] }),
  );
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'not-unit');
});

// 8
test('empty / no-ability text is UNKNOWN and never a blank program or a default score', () => {
  for (const ability of ['', null, undefined]) {
    const result = describeDuelHoldScoreV1(synUnit('syn-empty', ability));
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'empty-ability-text');
    assert.equal(result.normalizedAbilityText, '');
  }
});

// 9
test('the caller cannot inject source metadata: extra fields (fingerprint/dataVersion) are tolerated but never read', () => {
  const forged = {
    ...synUnit('ogn-066-298', WHOLE),
    // A caller-claimed fingerprint/digest must NOT be trusted or echoed.
    wholeSourceFingerprint: 'sha256:deadbeef',
    sourceCatalogDigest: 'sha256:deadbeef',
    dataVersion: 'attacker-supplied',
  };
  const result = describeDuelHoldScoreV1(forged);
  assert.equal(result.status, 'known');
  assert.equal(result.wholeSourceFingerprint, EXPECTED_WHOLE_FP);
  assert.equal(result.source.sourceCatalogDigest, DIGEST);
  assert.equal(result.source.dataVersion, DATA_VERSION);
});

// 10
test('results are deeply frozen and the input is never mutated', () => {
  const card = synUnit('ogn-066-298', WHOLE, { domains: ['Calm'], tags: ['Ahri'] });
  const before = JSON.stringify(card);
  const result = describeDuelHoldScoreV1(card);
  assert.equal(JSON.stringify(card), before, 'input tuple must not be mutated');
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.source));
  assert.ok(Object.isFrozen(result.source.domains));
  assert.ok(Object.isFrozen(result.source.tags));
  assert.ok(Object.isFrozen(result.semantics));
  assert.ok(Object.isFrozen(result.semantics.effects));
  assert.ok(Object.isFrozen(result.semantics.effects[0]));
  assert.ok(Object.isFrozen(result.semantics.unmodeled));
  assert.throws(() => {
    'use strict';
    result.semantics.effects[0].amount = 99;
  }, TypeError);
});

// 11
test('a known or unknown result is DATA only: no capability/authority fields, no executable reference', () => {
  const known = describeDuelHoldScoreV1(synUnit('ogn-066-298', WHOLE));
  const unknown = describeDuelHoldScoreV1(synUnit('syn-tail', `${WHOLE}\nJinx: discard 2.`));
  for (const result of [known, unknown]) {
    const keys = Object.keys(result);
    for (const forbidden of [
      'privateUID', 'epoch', 'mintReceipt', 'sourceProof', 'authority', 'encoded', 'reference',
      'program', 'runtimeAuthority', 'sourceProgramComplete', 'negativeProof',
    ]) {
      assert.ok(!keys.includes(forbidden), `result must not carry ${forbidden}`);
    }
  }
  assert.deepEqual(Object.keys(known).sort(), KNOWN_KEYS);
  assert.deepEqual(Object.keys(unknown).sort(), UNKNOWN_KEYS);
});

// 12
test('accessors are never invoked; clone works; symbol/sparse/missing/malformed fields are rejected; extra data fields tolerated unread', () => {
  const original = synUnit('ogn-066-298', WHOLE, { domains: ['Calm'], tags: ['Ahri'] });
  const clone = { ...original, domains: [...original.domains], tags: [...original.tags] };
  assert.deepEqual(describeDuelHoldScoreV1(clone), describeDuelHoldScoreV1(original));

  let invoked = 0;
  const withGetter = synUnit('syn-getter', WHOLE);
  Object.defineProperty(withGetter, 'id', { get() { invoked += 1; return 'syn-getter'; }, enumerable: true, configurable: true });
  assert.throws(() => describeDuelHoldScoreV1(withGetter), TypeError);
  assert.equal(invoked, 0, 'accessor must never be invoked');

  const withSymbol = synUnit('syn-symbol', WHOLE);
  withSymbol[Symbol('x')] = 1;
  assert.throws(() => describeDuelHoldScoreV1(withSymbol), TypeError);

  const sparse = synUnit('syn-sparse', WHOLE);
  sparse.domains = ['Calm'];
  delete sparse.domains[0];
  sparse.domains.length = 1;
  assert.throws(() => describeDuelHoldScoreV1(sparse), TypeError);

  const missing = synUnit('syn-missing', WHOLE);
  delete missing.tags;
  assert.throws(() => describeDuelHoldScoreV1(missing), TypeError);

  const badDomain = synUnit('syn-baddomain', WHOLE);
  badDomain.domains = ['Calm', 3];
  assert.throws(() => describeDuelHoldScoreV1(badDomain), TypeError);

  const badEnergy = synUnit('syn-badenergy', WHOLE);
  badEnergy.energy = -1;
  assert.throws(() => describeDuelHoldScoreV1(badEnergy), TypeError);

  const badCardType = synUnit('syn-badtype', WHOLE);
  badCardType.cardType = '';
  assert.throws(() => describeDuelHoldScoreV1(badCardType), TypeError);

  const exotic = synUnit('syn-exotic', WHOLE);
  Object.setPrototypeOf(exotic, { injected: true });
  assert.throws(() => describeDuelHoldScoreV1(exotic), TypeError);

  // Extra enumerable DATA fields (as on the real catalog, e.g. imageUrl) are
  // tolerated and never read as semantics.
  const withExtra = { ...synUnit('syn-extra', WHOLE), imageUrl: 'https://example.invalid/x.png' };
  const extraResult = describeDuelHoldScoreV1(withExtra);
  assert.equal(extraResult.status, 'known');
  assert.deepEqual(Object.keys(extraResult).sort(), KNOWN_KEYS);
});

// 13
test('a real catalog Unit with NO Hold→score (ogn-067-298 Ahri, Nine-Tailed Fox) is UNKNOWN', () => {
  const ability = "[Tank] (I must be assigned combat damage first.)\nWhen you play me to a battlefield, you may move an enemy unit to here.\nWhen I hold, return me to my owner's hand.";
  const result = describeDuelHoldScoreV1(synUnit('ogn-067-298', ability, { energy: 4, power: 0, might: 5, fullName: 'Ahri, Nine-Tailed Fox' }));
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'ability-not-pure-hold-score');
});

// 14
test('the recogniser is never registered in the official-program registry', async () => {
  const programsSpecifier =
    process.env.DUEL_OFFICIAL_PROGRAMS_MODULE ?? '../../dist/duel/official-programs.js';
  const mod = await import(programsSpecifier);
  for (const name of Object.keys(mod)) {
    assert.ok(!/hold-score|holdScore/u.test(name), `registry export ${name} must not exist`);
  }
});

// 15 (real catalog census: SOURCE DATA classification, not game execution)
test('real catalog census: only the exact Unit Hold→score printings are known', () => {
  const envPath = process.env.RIFTBOUND_HOLD_SCORE_CATALOG;
  const defaultPath = new URL('../../../card-data/data/deck-catalog.json', import.meta.url);
  const catalogPath = envPath ?? defaultPath;
  assert.ok(existsSync(catalogPath), `required official catalog missing: ${catalogPath}`);
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  assert.ok(Array.isArray(catalog.cards), 'catalog.cards must be an array');
  assert.equal(catalog.dataVersion, DATA_VERSION, 'unexpected catalog dataVersion');
  assert.equal(catalog.digest, DIGEST, 'unexpected catalog digest');

  const known = [];
  const unknown = [];
  for (const card of catalog.cards) {
    const result = describeDuelHoldScoreV1(card);
    (result.status === 'known' ? known : unknown).push(card.id);
  }
  known.sort();
  assert.deepEqual(known, ['ogn-066-298', 'ogn-066a-298']);
  assert.equal(known.length + unknown.length, catalog.cards.length);

  // Both known printings share the canonical identity and whole-source fingerprint.
  const descriptions = catalog.cards
    .filter((card) => card.id === 'ogn-066-298' || card.id === 'ogn-066a-298')
    .map((card) => describeDuelHoldScoreV1(card));
  assert.equal(new Set(descriptions.map((d) => d.canonicalCardId)).size, 1);
  assert.equal(new Set(descriptions.map((d) => d.wholeSourceFingerprint)).size, 1);
  assert.equal(descriptions[0].wholeSourceFingerprint, EXPECTED_WHOLE_FP);

  // Every other catalog printing is classified unknown (never silently known).
  for (const card of catalog.cards) {
    const result = describeDuelHoldScoreV1(card);
    assert.ok(result.status === 'known' || result.status === 'unknown');
    if (!known.includes(card.id)) assert.equal(result.status, 'unknown');
  }

  console.log(`[hold-score-description-v1] known=${known.length} unknown=${unknown.length} total=${catalog.cards.length}`);
});
