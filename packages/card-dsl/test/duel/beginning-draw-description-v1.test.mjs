// Focused default (clean-checkout) suite for the pure-DATA
// `beginning-draw-description-v1` recogniser.
//
// These cases build COMPLETE inline synthetic printing tuples carrying the REAL
// catalog Loose Cannon whole-ability literal, so the suite runs in a clean
// checkout and never reads the gitignored official catalog. The real 1408-printing
// census lives in the required block at the bottom and may use an explicit
// RIFTBOUND_BEGINNING_DRAW_CATALOG override. It is labelled
// SOURCE DATA only.
//
// The recogniser returns DATA only: it is not an authority, is never registered
// in the official-program registry, executes no draw and exposes no private hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const moduleSpecifier =
  process.env.DUEL_BEGINNING_DRAW_MODULE ?? '../../dist/duel/beginning-draw-description-v1.js';
const {
  DUEL_BEGINNING_DRAW_DESCRIPTION_V1_KIND,
  DUEL_BEGINNING_DRAW_WHOLE_TEXT,
  DUEL_BEGINNING_DRAW_CARD_TYPE,
  DUEL_BEGINNING_DRAW_TRIGGER_EVENT,
  DUEL_BEGINNING_DRAW_CONDITION_CLAUSE_ROLE,
  DUEL_BEGINNING_DRAW_CONDITION_ROLE_SOURCE_RULE,
  DUEL_BEGINNING_DRAW_CONDITION_EVALUATED_AT,
  DUEL_BEGINNING_DRAW_CONDITION_EVALUATION_EVIDENCE_RULES,
  describeDuelBeginningDrawV1,
} = await import(moduleSpecifier);

const DATA_VERSION = '2026-10-15-official-gallery';
const DIGEST = 'sha256:e9635b38044140375c33d9e5d8e12c1c2386994dfaa9ae8ae6832a127ff9f73d';
// The upstream catalog envelope metadata, passed separately from each printing.
const ENVELOPE = { dataVersion: DATA_VERSION, sourceCatalogDigest: DIGEST };

// The single real whole-ability literal for this family.
const TEXT = 'At start of your Beginning Phase, draw 1 if you have one or fewer cards in your hand.';
assert.equal(TEXT, DUEL_BEGINNING_DRAW_WHOLE_TEXT, 'the exported literal must be the real catalog text');

// Complete synthetic printing tuple with every required field. A Legend carries
// no printed Energy / Power / Might, so they default to null.
const synCard = (id, ability, extra = {}) => ({
  id,
  cardType: extra.cardType ?? 'Legend',
  ability,
  energy: 'energy' in extra ? extra.energy : null,
  power: 'power' in extra ? extra.power : null,
  might: 'might' in extra ? extra.might : null,
  domains: extra.domains ?? ['Fury', 'Chaos'],
  tags: extra.tags ?? ['Jinx'],
  canonicalCardId: extra.canonicalCardId ?? 'card.hash-6725e8158faf2110c1c44cc6e73ac51a68eb3031e134f604a57dc4ef7e8b84a3',
  name: extra.name ?? 'Loose Cannon',
  fullName: extra.fullName ?? 'Loose Cannon',
  localizedName: extra.localizedName ?? '暴走萝莉',
  setCode: extra.setCode ?? 'ogn',
  cardNumber: extra.cardNumber ?? `OGN-${id}`,
  variant: extra.variant ?? 'standard',
});

// Every call passes the printing tuple plus the separate envelope metadata.
const describe = (card, envelope = ENVELOPE) => describeDuelBeginningDrawV1(card, envelope);

const KNOWN_KEYS = ['binding', 'canonicalCardId', 'cardId', 'kind', 'semantics', 'source', 'status'];
const UNKNOWN_KEYS = ['canonicalCardId', 'cardId', 'kind', 'normalizedAbilityText', 'reason', 'status'];
const CANONICAL = 'card.hash-6725e8158faf2110c1c44cc6e73ac51a68eb3031e134f604a57dc4ef7e8b84a3';

// The three real printings of this exact whole ability.
const REAL_PRINTINGS = [
  { id: 'ogn-251-298', cardNumber: 'OGN-251/298', variant: 'standard' },
  { id: 'ogn-301-298', cardNumber: 'OGN-301/298', variant: 'standard' },
  { id: 'ogn-301-star-298', cardNumber: 'OGN-301*/298', variant: 'alternate' },
];

// 1
test('kind, whole-text literal, card type and condition role are fixed and frozen', () => {
  assert.equal(DUEL_BEGINNING_DRAW_DESCRIPTION_V1_KIND, 'beginning-draw-description-v1');
  assert.equal(DUEL_BEGINNING_DRAW_CARD_TYPE, 'Legend');
  assert.equal(DUEL_BEGINNING_DRAW_TRIGGER_EVENT, 'beginning-phase');
  assert.equal(DUEL_BEGINNING_DRAW_CONDITION_CLAUSE_ROLE, 'effect');
  assert.equal(DUEL_BEGINNING_DRAW_CONDITION_ROLE_SOURCE_RULE, 'CR-v1.4:383.2.a.1');
  assert.equal(DUEL_BEGINNING_DRAW_CONDITION_EVALUATED_AT, 'unclosed');
  assert.ok(Object.isFrozen(DUEL_BEGINNING_DRAW_CONDITION_EVALUATION_EVIDENCE_RULES));
  assert.ok(DUEL_BEGINNING_DRAW_CONDITION_EVALUATION_EVIDENCE_RULES.includes('CR-v1.4:383.2.a.1'));
});

// 2
test('recognises all three real printings as known, source-bound DATA', () => {
  for (const printing of REAL_PRINTINGS) {
    const card = synCard(printing.id, TEXT, {
      cardNumber: printing.cardNumber,
      variant: printing.variant,
    });
    const result = describe(card);
    assert.equal(result.status, 'known', `${printing.id} must be known`);
    assert.equal(result.kind, 'beginning-draw-description-v1');
    assert.equal(result.cardId, printing.id);
    assert.equal(result.canonicalCardId, CANONICAL);
    assert.equal(result.source.normalizedAbilityText, TEXT);
    assert.equal(result.source.energy, null);
    assert.equal(result.source.power, null);
    assert.equal(result.source.might, null);
    assert.deepEqual(result.source.domains, ['Fury', 'Chaos']);
    assert.deepEqual(result.source.tags, ['Jinx']);
    assert.deepEqual(Object.keys(result).sort(), KNOWN_KEYS);
  }
});

// 3
test('alt-art variants share the canonical identity but keep distinct whole-source fingerprints', () => {
  const fingerprints = new Map();
  for (const printing of REAL_PRINTINGS) {
    const card = synCard(printing.id, TEXT, { cardNumber: printing.cardNumber, variant: printing.variant });
    const result = describe(card);
    assert.equal(result.binding.cardId, printing.id);
    assert.equal(result.binding.canonicalCardId, CANONICAL);
    assert.equal(result.binding.dataVersion, DATA_VERSION);
    assert.equal(result.binding.sourceCatalogDigest, DIGEST);
    assert.equal(result.binding.fingerprintScheme, 'fnv1a64');
    assert.match(result.binding.wholeSourceFingerprint, /^fnv1a64:[0-9a-f]{16}$/u);
    // The whole-source fingerprint covers id/cardNumber/variant, so the alt-art
    // differs from the standard printings while the canonical identity matches.
    assert.ok(!fingerprints.has(result.binding.wholeSourceFingerprint), 'fingerprints must be distinct');
    fingerprints.set(result.binding.wholeSourceFingerprint, printing.id);
  }
  assert.equal(fingerprints.size, 3);
});

// 4
test('the semantics are the exact DATA shape: trigger + effect-embedded condition', () => {
  const result = describe(synCard('ogn-251-298', TEXT));
  assert.deepEqual(result.semantics, {
    kind: 'beginning-phase-conditional-draw',
    trigger: {
      event: 'beginning-phase',
      step: 'beginning-step',
      scope: 'controller-beginning-phase',
      timing: 'start',
      sourceRule: 'CR-v1.4:383.1',
    },
    effect: {
      kind: 'draw-cards',
      amount: 1,
      recipient: 'ability-controller',
      recipientSourceRule: 'CR-v1.4:190.6.d',
      condition: {
        kind: 'hand-size-at-most',
        maximum: 1,
        scope: 'ability-controller-hand',
        // The clause is part of the EFFECT, not the Trigger Condition (CR 383.2.a.1).
        clauseRole: 'effect',
        roleSourceRule: 'CR-v1.4:383.2.a.1',
        readsPublicInformationOnly: true,
        // UNCLOSED: the evaluation time is not fixed by the local CR.
        evaluatedAt: 'unclosed',
        evaluatedAtClosed: false,
        evaluatedAtEvidenceRules: [
          'CR-v1.4:383.2.a.1',
          'CR-v1.4:135.2.b.3',
          'CR-v1.4:359.3.f.2',
          'CR-v1.4:383.2.c',
        ],
      },
    },
  });
});

// 5
test('person/turn wording is preserved verbatim; the descriptor never rewrites the source', () => {
  // The literal says "your" (the controller's) Beginning Phase, not "each player's"
  // or "its controller's" — a different wording is a different (unknown) ability.
  const result = describe(synCard('ogn-251-298', TEXT));
  assert.equal(result.source.normalizedAbilityText, TEXT);
  assert.equal(result.semantics.trigger.scope, 'controller-beginning-phase');
});

// 6
test('normalizes identical whole-ability text (CRLF / edge whitespace) to the same known result', () => {
  const noisy = `\r\n  ${TEXT}  \r\n`;
  const result = describe(synCard('ogn-251-298', noisy));
  assert.equal(result.status, 'known');
  assert.equal(result.source.normalizedAbilityText, TEXT);
  const clean = describe(synCard('ogn-251-298', TEXT));
  assert.equal(result.binding.wholeSourceFingerprint, clean.binding.wholeSourceFingerprint,
    'normalization must make equivalent text fingerprint identically');
});

// 7
test('a non-Legend printing with the exact text is UNKNOWN (not-legend)', () => {
  const result = describe(
    synCard('syn-unit', TEXT, { cardType: 'Unit', energy: 3, might: 3 }),
  );
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'not-legend');
  assert.deepEqual(Object.keys(result).sort(), UNKNOWN_KEYS);
});

// 8
test('a different card type (Battlefield / Gear / Spell) with the exact text is UNKNOWN', () => {
  for (const cardType of ['Battlefield', 'Gear', 'Spell']) {
    const result = describe(synCard('syn-other', TEXT, { cardType }));
    assert.equal(result.status, 'unknown', `expected unknown for ${cardType}`);
    assert.equal(result.reason, 'not-legend');
  }
});

// 9
test('a trailing unknown sentence / extra instruction is UNKNOWN (never a prefix match)', () => {
  const tails = [
    `${TEXT}\nDiscard 1.`,
    `${TEXT}\nUnknown trailing sentence.`,
    `${TEXT}\nAt the start of your Draw Phase, draw 1.`,
    `Before this, do nothing.\n${TEXT}`,
  ];
  for (const ability of tails) {
    const result = describe(synCard('syn-tail', ability));
    assert.equal(result.status, 'unknown', `expected unknown for ${JSON.stringify(ability)}`);
    assert.equal(result.reason, 'ability-not-pure-beginning-draw');
    assert.equal(result.normalizedAbilityText, ability);
  }
});

// 10
test('near-miss wordings (phase / digit / comparison / "may") are UNKNOWN, not normalised', () => {
  const nearMisses = [
    // Other turn-sequence point.
    'At start of your Draw Phase, draw 1 if you have one or fewer cards in your hand.',
    'At start of your Main Phase, draw 1 if you have one or fewer cards in your hand.',
    // "At the start" vs "At start".
    'At the start of your Beginning Phase, draw 1 if you have one or fewer cards in your hand.',
    // "each player's" / "its controller's" instead of "your".
    "At start of each player's Beginning Phase, draw 1 if you have one or fewer cards in your hand.",
    // Different draw amount.
    'At start of your Beginning Phase, draw 2 if you have one or fewer cards in your hand.',
    // Different comparison bound.
    'At start of your Beginning Phase, draw 1 if you have two or fewer cards in your hand.',
    'At start of your Beginning Phase, draw 1 if you have one card in your hand.',
    // Optional / may variant (a real different ability shape).
    'At start of your Beginning Phase, you may draw 1 if you have one or fewer cards in your hand.',
    // Reversed clause order.
    'If you have one or fewer cards in your hand, at start of your Beginning Phase, draw 1.',
    // Missing "Beginning Phase" wording entirely.
    'At start of your turn, draw 1 if you have one or fewer cards in your hand.',
    // Real different Loose-Cannon-adjacent shapes from the same catalog family.
    'At the start of your Beginning Phase, recycle 3 from your trash.',
    'At the start of your Beginning Phase, if you control a facedown card at a battlefield, draw 1.',
  ];
  for (const ability of nearMisses) {
    const result = describe(synCard('syn-near', ability));
    assert.equal(result.status, 'unknown', `expected unknown for ${JSON.stringify(ability)}`);
    assert.equal(result.reason, 'ability-not-pure-beginning-draw');
  }
});

// 11
test('empty / no-ability text never returns blank, a no-ability template or a default draw', () => {
  for (const ability of ['', '   ', '\n\n', null, undefined]) {
    const result = describe(synCard('syn-empty', ability));
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'empty-source-text');
    assert.notEqual(result.normalizedAbilityText, undefined);
  }
});

// 12
test('a Legend with a spurious non-null printed stat is UNKNOWN (unmodeled-printing-stat)', () => {
  const result = describe(synCard('syn-stat', TEXT, { energy: 1 }));
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'unmodeled-printing-stat');
});

// 13
test('malformed tuple shapes are rejected with a TypeError (arrays, numbers, symbols, accessors)', () => {
  // Sparse array field.
  const sparse = synCard('syn-sparse', TEXT);
  sparse.domains = ['Fury'];
  delete sparse.domains[0];
  sparse.domains.length = 1;
  assert.throws(() => describe(sparse), TypeError);

  // Missing required field.
  const missing = synCard('syn-missing', TEXT);
  delete missing.tags;
  assert.throws(() => describe(missing), TypeError);

  // Non-integer / negative numeric stat.
  assert.throws(() => describe(synCard('syn-float', TEXT, { energy: 1.5 })), TypeError);
  assert.throws(() => describe(synCard('syn-neg', TEXT, { might: -1 })), TypeError);

  // Symbol key.
  const withSymbol = synCard('syn-symbol', TEXT);
  withSymbol[Symbol('x')] = 1;
  assert.throws(() => describe(withSymbol), TypeError);

  // Accessor is rejected and never invoked.
  let invoked = 0;
  const withGetter = synCard('syn-getter', TEXT);
  Object.defineProperty(withGetter, 'id', {
    get() { invoked += 1; return 'syn-getter'; }, enumerable: true, configurable: true,
  });
  assert.throws(() => describe(withGetter), TypeError);
  assert.equal(invoked, 0, 'accessor must never be invoked');

  // Non-array domains.
  const badDomains = synCard('syn-baddomains', TEXT);
  badDomains.domains = 'Fury';
  assert.throws(() => describe(badDomains), TypeError);

  // Dense-array violation inside a nested list (holes).
  const holey = synCard('syn-holey', TEXT);
  holey.tags = ['Jinx', 'Noxus'];
  delete holey.tags[1];
  holey.tags.length = 2;
  assert.throws(() => describe(holey), TypeError);

  // Non-plain prototype.
  const exotic = Object.assign(Object.create({ weird: true }), synCard('syn-exotic', TEXT));
  assert.throws(() => describe(exotic), TypeError);
});

// 13b
test('a malformed source envelope is rejected with a TypeError (never silently defaulted)', () => {
  const card = synCard('ogn-251-298', TEXT);
  assert.throws(() => describeDuelBeginningDrawV1(card, { dataVersion: '', sourceCatalogDigest: DIGEST }), TypeError);
  assert.throws(() => describeDuelBeginningDrawV1(card, { dataVersion: DATA_VERSION }), TypeError);
  assert.throws(() => describeDuelBeginningDrawV1(card, { dataVersion: 1, sourceCatalogDigest: DIGEST }), TypeError);
  let invoked = 0;
  const accessorEnvelope = {};
  Object.defineProperty(accessorEnvelope, 'dataVersion', {
    get() { invoked += 1; return DATA_VERSION; }, enumerable: true, configurable: true,
  });
  Object.defineProperty(accessorEnvelope, 'sourceCatalogDigest', {
    get() { invoked += 1; return DIGEST; }, enumerable: true, configurable: true,
  });
  assert.throws(() => describeDuelBeginningDrawV1(card, accessorEnvelope), TypeError);
  assert.equal(invoked, 0, 'envelope accessors must never be invoked');
  // A different envelope changes the whole-source fingerprint (drift detection).
  const base = describe(card);
  const other = describe(card, { dataVersion: DATA_VERSION, sourceCatalogDigest: 'sha256:other' });
  assert.notEqual(base.binding.wholeSourceFingerprint, other.binding.wholeSourceFingerprint);
});

// 14
test('a caller-supplied fingerprint is never read or trusted; the binding is recomputed', () => {
  const card = synCard('ogn-251-298', TEXT);
  const baseline = describe(card);
  const forged = { ...card, wholeSourceFingerprint: 'fnv1a64:0000000000000000', sourceProof: true };
  const result = describe(forged);
  assert.equal(result.status, 'known');
  assert.equal(result.binding.wholeSourceFingerprint, baseline.binding.wholeSourceFingerprint);
  assert.notEqual(result.binding.wholeSourceFingerprint, 'fnv1a64:0000000000000000');
  assert.deepEqual(Object.keys(result).sort(), KNOWN_KEYS);
});

// 15
test('extra enumerable DATA fields (as on the real catalog, e.g. imageUrl) are tolerated unread', () => {
  const withExtra = {
    ...synCard('ogn-251-298', TEXT),
    imageUrl: 'https://example.invalid/x.png',
    groupId: 'grp-ignored',
  };
  const result = describe(withExtra);
  assert.equal(result.status, 'known');
  assert.deepEqual(Object.keys(result).sort(), KNOWN_KEYS);
});

// 16
test('results are deeply frozen and the input is never mutated', () => {
  const card = synCard('ogn-251-298', TEXT, { domains: ['Fury', 'Chaos'], tags: ['Jinx'] });
  const before = JSON.stringify(card);
  const result = describe(card);
  assert.equal(JSON.stringify(card), before, 'input tuple must not be mutated');
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.source));
  assert.ok(Object.isFrozen(result.source.domains));
  assert.ok(Object.isFrozen(result.source.tags));
  assert.ok(Object.isFrozen(result.binding));
  assert.ok(Object.isFrozen(result.semantics));
  assert.ok(Object.isFrozen(result.semantics.trigger));
  assert.ok(Object.isFrozen(result.semantics.effect));
  assert.ok(Object.isFrozen(result.semantics.effect.condition));
  assert.ok(Object.isFrozen(result.semantics.effect.condition.evaluatedAtEvidenceRules));
  assert.throws(() => {
    'use strict';
    result.semantics.effect.amount = 99;
  }, TypeError);
});

// 17
test('a known or unknown result is DATA only: no capability/authority/execution fields', () => {
  const known = describe(synCard('ogn-251-298', TEXT));
  const unknown = describe(synCard('syn-tail', `${TEXT}\nDiscard 1.`));
  for (const result of [known, unknown]) {
    const keys = Object.keys(result);
    for (const forbidden of [
      'privateUID', 'epoch', 'mintReceipt', 'sourceProof', 'authority', 'encoded',
      'reference', 'program', 'sourceProgramComplete', 'capability', 'execute',
      'runtimeAuthority', 'negativeProof', 'privateHand', 'hand',
    ]) {
      assert.ok(!keys.includes(forbidden), `result must not carry ${forbidden}`);
    }
  }
  assert.deepEqual(Object.keys(known).sort(), KNOWN_KEYS);
  assert.deepEqual(Object.keys(unknown).sort(), UNKNOWN_KEYS);
});

// 18
test('the recogniser is never registered in the official-program registry', async () => {
  const programsSpecifier =
    process.env.DUEL_OFFICIAL_PROGRAMS_MODULE ?? '../../dist/duel/official-programs.js';
  const mod = await import(programsSpecifier);
  for (const name of Object.keys(mod)) {
    assert.ok(!/beginning-draw|beginningDraw/iu.test(name), `registry export ${name} must not exist`);
  }
});

// Required real catalog SOURCE-DATA census.
// Uses the official catalog by default; an explicit path can select the
// official catalog. This is SOURCE DATA recognition only; it makes no claim that
// the draw is executable and does not touch any generated card-data output.
test('real catalog SOURCE DATA census: exactly the 3 Loose Cannon printings are known', () => {
  const catalogPath = process.env.RIFTBOUND_BEGINNING_DRAW_CATALOG ??
    new URL('../../../card-data/data/deck-catalog.json', import.meta.url);
  assert.ok(existsSync(catalogPath), `official catalog is required for this audit: ${catalogPath}`);
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  assert.ok(Array.isArray(catalog.cards), 'catalog.cards must be an array');
  assert.equal(catalog.cards.length, 1408, 'expected the 1408-printing catalog');

  // The real catalog carries dataVersion/digest on the ENVELOPE, not per card.
  const envelope = { dataVersion: catalog.dataVersion, sourceCatalogDigest: catalog.digest };
  assert.equal(envelope.dataVersion, DATA_VERSION);

  const known = [];
  for (const card of catalog.cards) {
    const result = describe(card, envelope);
    if (result.status === 'known') known.push(card.id);
  }
  known.sort();
  assert.deepEqual(known, ['ogn-251-298', 'ogn-301-298', 'ogn-301-star-298']);

  // Every other catalog card is classified unknown; none is silently resolved.
  const klass = new Set(catalog.cards.map((card) => describe(card, envelope).status));
  assert.ok([...klass].every((status) => status === 'known' || status === 'unknown'));
  console.log(`[beginning-draw-description-v1] SOURCE DATA census: known=${known.length} total=${catalog.cards.length}`);
});
