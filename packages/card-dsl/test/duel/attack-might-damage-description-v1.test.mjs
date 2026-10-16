// Focused default (clean-checkout) suite for the pure-DATA
// `attack-might-damage-description-v1` recogniser.
//
// These cases build COMPLETE inline synthetic printing tuples with the REAL
// catalog whole-ability literal, so the suite runs in a clean checkout and never
// reads the gitignored official catalog. The real 1381-printing census lives in
// the required census below asserts every real printing. Missing catalog data
// fails rather than skipping. Assertions classify source DATA only.
//
// The recogniser returns DATA only: it is not an authority, is never registered
// in the official-program registry, and its result carries no capability, no
// runtime authority and no negative proof.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const moduleSpecifier =
  process.env.DUEL_ATTACK_MIGHT_DAMAGE_MODULE ?? '../../dist/duel/attack-might-damage-description-v1.js';
const {
  DUEL_ATTACK_MIGHT_DAMAGE_DESCRIPTION_V1_KIND,
  DUEL_ATTACK_MIGHT_DAMAGE_SOURCE_DATA_VERSION,
  DUEL_ATTACK_MIGHT_DAMAGE_SOURCE_CATALOG_DIGEST,
  DUEL_ATTACK_MIGHT_DAMAGE_WHOLE_TEXTS,
  describeDuelAttackMightDamageV1,
} = await import(moduleSpecifier);

const DATA_VERSION = '2026-10-12-official-gallery';
const DIGEST = 'sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10';

// The single exact real catalog literal for this family (no reminder/symbol variants).
const WHOLE = 'When I attack, deal damage equal to my Might to an enemy unit here.';

// The canonical identity shared by the two real printings ogn-076-298 / ogn-076a-298.
const YASUO_CANONICAL =
  'card.hash-751e2b1c16ab2529b3d0bf37e5309cfde9a7b41589d08799cf53a9a8ef42e5e8';

// Complete synthetic printing tuple with every DuelSourcePrintingCard field.
const synUnit = (id, ability, extra = {}) => ({
  id,
  cardType: extra.cardType ?? 'Unit',
  ability,
  energy: 'energy' in extra ? extra.energy : 6,
  power: 'power' in extra ? extra.power : 2,
  might: 'might' in extra ? extra.might : 6,
  domains: extra.domains ?? ['Calm'],
  tags: extra.tags ?? ['Yasuo', 'Ionia', 'Champion'],
  canonicalCardId: extra.canonicalCardId ?? YASUO_CANONICAL,
  name: extra.name ?? 'Yasuo',
  fullName: extra.fullName ?? 'Yasuo, Remorseful',
  localizedName: extra.localizedName ?? '亚索',
  setCode: extra.setCode ?? 'ogn',
  cardNumber: extra.cardNumber ?? 'OGN-076/298',
  variant: extra.variant ?? 'standard',
  dataVersion: DATA_VERSION,
  sourceCatalogDigest: DIGEST,
});

const KNOWN_KEYS = [
  'canonicalCardId', 'cardId', 'catalogDigest', 'dataVersion', 'kind',
  'printedMight', 'semantics', 'source', 'sourceFingerprint', 'status',
];
const UNKNOWN_KEYS = [
  'canonicalCardId', 'cardId', 'catalogDigest', 'dataVersion', 'kind',
  'normalizedAbilityText', 'reason', 'status',
];

// 1
test('kind, baseline source version/digest and whole-text set are fixed', () => {
  assert.equal(DUEL_ATTACK_MIGHT_DAMAGE_DESCRIPTION_V1_KIND, 'attack-might-damage-description-v1');
  assert.equal(DUEL_ATTACK_MIGHT_DAMAGE_SOURCE_DATA_VERSION, DATA_VERSION);
  assert.equal(DUEL_ATTACK_MIGHT_DAMAGE_SOURCE_CATALOG_DIGEST, DIGEST);
  assert.ok(DUEL_ATTACK_MIGHT_DAMAGE_WHOLE_TEXTS.has(WHOLE));
  assert.equal(DUEL_ATTACK_MIGHT_DAMAGE_WHOLE_TEXTS.size, 1);
});

// 2
test('recognises the real ogn-076-298 whole ability as known (dynamic, not fixed, damage)', () => {
  const card = synUnit('ogn-076-298', WHOLE);
  const result = describeDuelAttackMightDamageV1(card);
  assert.equal(result.status, 'known');
  assert.equal(result.kind, 'attack-might-damage-description-v1');
  assert.equal(result.cardId, 'ogn-076-298');
  assert.equal(result.canonicalCardId, YASUO_CANONICAL);
  assert.equal(result.dataVersion, DATA_VERSION);
  assert.equal(result.catalogDigest, DIGEST);
  assert.equal(result.source.normalizedAbilityText, WHOLE);
  assert.equal(result.source.energy, 6);
  assert.equal(result.source.power, 2);
  assert.equal(result.source.might, 6);
  assert.deepEqual(result.source.domains, ['Calm']);
  assert.deepEqual(result.source.tags, ['Yasuo', 'Ionia', 'Champion']);
  assert.equal(result.printedMight, 6);
  assert.deepEqual(result.semantics, {
    kind: 'attack-trigger-deal-damage',
    trigger: { kind: 'triggered-ability', event: 'attack', subject: 'source', firesOncePerCombat: true },
    effect: {
      kind: 'deal-damage',
      amount: { kind: 'equal-to-source-might', dynamic: true, evaluationTime: 'on-instruction-execution' },
      targets: {
        kind: 'unit', controller: 'enemy', location: 'here',
        minSelections: 1, maxSelections: 1, referentEvaluationTime: 'on-instruction-execution',
      },
    },
  });
});

// 3
test('the damage amount is NEVER modelled as a fixed number (dynamic "equal to my Might" preserved)', () => {
  const result = describeDuelAttackMightDamageV1(synUnit('ogn-076-298', WHOLE));
  assert.equal(result.status, 'known');
  const amount = result.semantics.effect.amount;
  assert.equal(typeof amount, 'object');
  assert.equal(amount.kind, 'equal-to-source-might');
  assert.equal(amount.dynamic, true);
  assert.equal(amount.evaluationTime, 'on-instruction-execution');
  assert.equal('value' in amount, false);
  assert.equal('amount' in amount, false);
  // The printed Might is carried as evidence but never baked into the amount.
  assert.equal(result.printedMight, 6);
});

// 4
test('enemy / here / source-Might referents are preserved literally; target is never pre-selected', () => {
  const result = describeDuelAttackMightDamageV1(synUnit('ogn-076-298', WHOLE));
  const targets = result.semantics.effect.targets;
  assert.equal(targets.controller, 'enemy');
  assert.equal(targets.location, 'here');
  assert.equal(targets.referentEvaluationTime, 'on-instruction-execution');
  assert.equal(targets.minSelections, 1);
  assert.equal(targets.maxSelections, 1);
  assert.equal(result.semantics.trigger.event, 'attack');
  assert.equal(result.semantics.trigger.subject, 'source');
  assert.equal(result.semantics.trigger.firesOncePerCombat, true);
});

// 5
test('alt-art ogn-076a-298 shares the canonical identity/semantics but keeps its own source fingerprint', () => {
  const standard = describeDuelAttackMightDamageV1(synUnit('ogn-076-298', WHOLE, { variant: 'standard', cardNumber: 'OGN-076/298' }));
  const alternate = describeDuelAttackMightDamageV1(synUnit('ogn-076a-298', WHOLE, { variant: 'alternate', cardNumber: 'OGN-076a/298' }));
  assert.equal(standard.status, 'known');
  assert.equal(alternate.status, 'known');
  assert.equal(standard.canonicalCardId, alternate.canonicalCardId);
  assert.deepEqual(standard.semantics, alternate.semantics);
  assert.deepEqual(standard.source, alternate.source);
  // Distinct printings must not collapse to one fingerprint.
  assert.notEqual(standard.sourceFingerprint, alternate.sourceFingerprint);
});

// 6
test('normalizes identical whole-ability text (CRLF / edge whitespace) to the same known result', () => {
  const noisy = `\r\n   ${WHOLE}   \r\n`;
  const result = describeDuelAttackMightDamageV1(synUnit('ogn-076-298', noisy));
  assert.equal(result.status, 'known');
  assert.equal(result.source.normalizedAbilityText, WHOLE);
});

// 7
test('a non-Unit printing carrying the exact text is UNKNOWN (not-unit) and never resolved', () => {
  for (const cardType of ['Spell', 'Legend', 'Gear', 'Battlefield', 'Rune']) {
    const result = describeDuelAttackMightDamageV1(
      synUnit('syn-wrongtype', WHOLE, { cardType, energy: null, power: null, might: null, domains: ['Colorless'] }),
    );
    assert.equal(result.status, 'unknown', `${cardType} must be unknown`);
    assert.equal(result.reason, 'not-unit');
  }
});

// 8
test('any trailing/extra instruction is UNKNOWN; a matching prefix is never sufficient', () => {
  const tails = [
    `${WHOLE}\nI don't deal combat damage.`,
    `${WHOLE}\n:rb_rune_mind:: [Action] — Move me to your base.`,
    `${WHOLE}\nWhen you conquer, draw 1.`,
    `${WHOLE}\nJinx: discard 2.`,
    `${WHOLE}\n[Shield] (+1 :rb_might: while I'm a defender.)`,
    `${WHOLE}\nUnknown trailing sentence.`,
    `Deal damage equal to my Might to an enemy unit here.`,
    `${WHOLE.replace('When I attack', 'When I attack or defend')}`,
    `${WHOLE.replace('an enemy unit here', 'an enemy unit in a base')}`,
    `${WHOLE.replace('deal damage', 'you may deal damage')}`,
  ];
  for (const ability of tails) {
    const result = describeDuelAttackMightDamageV1(synUnit('syn-tail', ability));
    assert.equal(result.status, 'unknown', `expected unknown for ${JSON.stringify(ability)}`);
    assert.equal(result.reason, 'ability-not-pure-attack-might-damage');
  }
});

// 9
test('real catalog OTHER Might-damage composites never resolve to this family (no truncation)', () => {
  // Real whole texts of nearby cards that must stay unknown for THIS descriptor.
  const others = [
    "I must be assigned combat damage last.\n:rb_exhaust:: Deal damage equal to my Might to a unit at a battlefield. Use this ability only while I'm at a battlefield.",
    "When I attack or defend, deal damage equal to my Might to all enemy units here.\nI don't deal combat damage.",
    "When I attack or defend, deal damage equal to my Might to an enemy unit here.\nI don't deal combat damage.\n:rb_rune_mind:: [Action] — Move me to your base.",
    '[Weaponmaster]\nWhen I conquer a battlefield that was uncontrolled, deal damage equal to my Might to an enemy unit in a base.',
    '[Hunt]\nWhen I attack, you may spend 3 XP to deal damage equal to my Might to an enemy unit here.',
    '[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it\'s already attached.)\nWhen I conquer an open battlefield, deal damage equal to my Might to an enemy unit in a base.',
  ];
  for (const ability of others) {
    const result = describeDuelAttackMightDamageV1(synUnit('syn-other', ability));
    assert.equal(result.status, 'unknown', `expected unknown for ${JSON.stringify(ability)}`);
    assert.equal(result.reason, 'ability-not-pure-attack-might-damage');
  }
});

// 10
test('empty / no-ability text never returns blank, a no-ability template or a default damage', () => {
  for (const ability of ['', null, undefined]) {
    const result = describeDuelAttackMightDamageV1(synUnit('syn-empty', ability));
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'ability-not-pure-attack-might-damage');
    assert.notEqual(result.normalizedAbilityText, undefined);
  }
});

// 11
test('a non-numeric source Might is reported UNKNOWN', () => {
  const result = describeDuelAttackMightDamageV1(synUnit('syn-null-might', WHOLE, { might: null }));
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'non-numeric-source-stat');
});

// 12
test('the source fingerprint is a recomputed sha256 over the whole tuple (caller claims are ignored)', () => {
  const card = synUnit('ogn-076-298', WHOLE);
  const result = describeDuelAttackMightDamageV1(card);
  assert.equal(result.status, 'known');
  assert.match(result.sourceFingerprint, /^sha256:[0-9a-f]{64}$/u);

  // Recompute independently with node:crypto over the canonical whole tuple.
  const fields = {
    cardId: 'ogn-076-298', cardType: 'Unit', normalizedAbilityText: WHOLE,
    energy: 6, power: 2, might: 6, domains: ['Calm'], tags: ['Yasuo', 'Ionia', 'Champion'],
    canonicalCardId: YASUO_CANONICAL, name: 'Yasuo', fullName: 'Yasuo, Remorseful',
    localizedName: '亚索', setCode: 'ogn', cardNumber: 'OGN-076/298', variant: 'standard',
  };
  const canonical = (v) => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'number') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  };
  const expected = `sha256:${createHash('sha256').update(canonical(fields)).digest('hex')}`;
  assert.equal(result.sourceFingerprint, expected);

  // Deterministic across calls.
  assert.equal(describeDuelAttackMightDamageV1(card).sourceFingerprint, result.sourceFingerprint);

  // A caller-claimed fingerprint field is tolerated as extra data and NEVER trusted.
  const forged = { ...card, sourceFingerprint: 'sha256:' + '0'.repeat(64) };
  assert.equal(describeDuelAttackMightDamageV1(forged).sourceFingerprint, result.sourceFingerprint);
});

// 13
test('results are deeply frozen and the input is never mutated', () => {
  const card = synUnit('ogn-076-298', WHOLE);
  const before = JSON.stringify(card);
  const result = describeDuelAttackMightDamageV1(card);
  assert.equal(JSON.stringify(card), before, 'input tuple must not be mutated');
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.source));
  assert.ok(Object.isFrozen(result.source.domains));
  assert.ok(Object.isFrozen(result.source.tags));
  assert.ok(Object.isFrozen(result.semantics));
  assert.ok(Object.isFrozen(result.semantics.trigger));
  assert.ok(Object.isFrozen(result.semantics.effect));
  assert.ok(Object.isFrozen(result.semantics.effect.amount));
  assert.ok(Object.isFrozen(result.semantics.effect.targets));
  assert.throws(() => {
    'use strict';
    result.semantics.effect.amount.dynamic = false;
  }, TypeError);
});

// 14
test('a known or unknown result is DATA only: no capability, authority or executable reference', () => {
  const known = describeDuelAttackMightDamageV1(synUnit('ogn-076-298', WHOLE));
  const unknown = describeDuelAttackMightDamageV1(synUnit('syn-tail', `${WHOLE}\nJinx: discard 2.`));
  for (const result of [known, unknown]) {
    const keys = Object.keys(result);
    for (const forbidden of [
      'privateUID', 'epoch', 'mintReceipt', 'sourceProof', 'sourceProgramComplete',
      'authority', 'encoded', 'reference', 'program', 'executable', 'grant',
    ]) {
      assert.ok(!keys.includes(forbidden), `result must not carry ${forbidden}`);
    }
  }
  assert.deepEqual(Object.keys(known).sort(), KNOWN_KEYS);
  assert.deepEqual(Object.keys(unknown).sort(), UNKNOWN_KEYS);
});

// 15
test('input snapshotting: accessors never invoked; symbol/sparse/missing/malformed/exotic are rejected', () => {
  // A spread clone (fresh own-data copy) describes identically.
  const original = synUnit('ogn-076-298', WHOLE);
  const clone = { ...original, domains: [...original.domains], tags: [...original.tags] };
  assert.deepEqual(describeDuelAttackMightDamageV1(clone), describeDuelAttackMightDamageV1(original));

  // Getters are never invoked.
  let invoked = 0;
  const withGetter = synUnit('syn-getter', WHOLE);
  Object.defineProperty(withGetter, 'id', { get() { invoked += 1; return 'syn-getter'; }, enumerable: true, configurable: true });
  assert.throws(() => describeDuelAttackMightDamageV1(withGetter), TypeError);
  assert.equal(invoked, 0, 'accessor must never be invoked');

  // Symbol keys are rejected.
  const withSymbol = synUnit('syn-symbol', WHOLE);
  withSymbol[Symbol('x')] = 1;
  assert.throws(() => describeDuelAttackMightDamageV1(withSymbol), TypeError);

  // Sparse arrays are rejected.
  const sparse = synUnit('syn-sparse', WHOLE);
  sparse.domains = ['Calm'];
  delete sparse.domains[0];
  sparse.domains.length = 1;
  assert.throws(() => describeDuelAttackMightDamageV1(sparse), TypeError);

  // Missing required fields are rejected.
  for (const key of ['id', 'cardType', 'ability', 'energy', 'power', 'might', 'domains', 'tags', 'canonicalCardId', 'name', 'fullName', 'localizedName', 'setCode', 'cardNumber', 'variant']) {
    const missing = synUnit('syn-missing', WHOLE);
    delete missing[key];
    assert.throws(() => describeDuelAttackMightDamageV1(missing), TypeError, `missing ${key} must throw`);
  }

  // Malformed scalar types are rejected.
  assert.throws(() => describeDuelAttackMightDamageV1({ ...synUnit('syn-num-id', WHOLE), id: 5 }), TypeError);
  assert.throws(() => describeDuelAttackMightDamageV1(synUnit('syn-num-ability', 42)), TypeError);
  assert.throws(() => describeDuelAttackMightDamageV1(synUnit('syn-neg-might', WHOLE, { might: -1 })), TypeError);
  assert.throws(() => describeDuelAttackMightDamageV1(synUnit('syn-float-energy', WHOLE, { energy: 1.5 })), TypeError);

  // Malformed domains/tags arrays are rejected.
  assert.throws(() => describeDuelAttackMightDamageV1(synUnit('syn-dom-str', WHOLE, { domains: 'Calm' })), TypeError);
  assert.throws(() => describeDuelAttackMightDamageV1(synUnit('syn-dom-num', WHOLE, { domains: [1] })), TypeError);

  // Exotic prototypes / cycles are rejected.
  const exotic = Object.assign(Object.create({ inherited: true }), synUnit('syn-exotic', WHOLE));
  assert.throws(() => describeDuelAttackMightDamageV1(exotic), TypeError);
  const cyclic = synUnit('syn-cyclic', WHOLE);
  cyclic.domains = [];
  cyclic.domains.push(cyclic.domains);
  assert.throws(() => describeDuelAttackMightDamageV1(cyclic), TypeError);

  // Extra enumerable DATA fields (as on the real catalog, e.g. imageUrl) are
  // tolerated and never read as semantics.
  const withExtra = { ...synUnit('syn-extra', WHOLE), imageUrl: 'https://example.invalid/x.png' };
  const extraResult = describeDuelAttackMightDamageV1(withExtra);
  assert.equal(extraResult.status, 'known');
  assert.deepEqual(Object.keys(extraResult).sort(), KNOWN_KEYS);
});

// 16
test('the recogniser is never registered in the official-program registry', async () => {
  const programsSpecifier =
    process.env.DUEL_OFFICIAL_PROGRAMS_MODULE ?? '../../dist/duel/official-programs.js';
  const mod = await import(programsSpecifier);
  for (const name of Object.keys(mod)) {
    assert.ok(!/attack-might-damage/u.test(name), `registry export ${name} must not exist`);
  }
});

// ---------------------------------------------------------------------------
// Real official-catalog census. SOURCE DATA ONLY: this asserts which whole-card
// sources the descriptor recognises, NOT that any of them are executable.
//
// The catalog is gitignored and absent in a fresh checkout. When it is present
// (this snapshot), the census is asserted EXACTLY and fails loudly on any drift.
// Missing catalog is a prerequisite failure; the census is never skipped.
// ---------------------------------------------------------------------------
const catalogPath =
  process.env.RIFTBOUND_ATTACK_MIGHT_DAMAGE_CATALOG ??
  new URL('../../../card-data/data/deck-catalog.json', import.meta.url);

test('real 1381-printing census: exactly the two Yasuo printings are recognised (SOURCE DATA)', () => {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  assert.ok(Array.isArray(catalog.cards), 'catalog.cards must be an array');
  assert.equal(catalog.cards.length, 1381, 'expected the 1381-printing catalog');

  const known = [];
  for (const card of catalog.cards) {
    const result = describeDuelAttackMightDamageV1(card);
    assert.ok(result.status === 'known' || result.status === 'unknown');
    if (result.status === 'known') known.push(card.id);
  }
  known.sort();
  assert.deepEqual(known, ['ogn-076-298', 'ogn-076a-298']);

  // Both printings carry the real literal and share the Yasuo canonical identity.
  for (const id of known) {
    const card = catalog.cards.find((c) => c.id === id);
    assert.equal(card.ability, WHOLE);
    assert.equal(card.cardType, 'Unit');
    assert.equal(card.canonicalCardId, YASUO_CANONICAL);
    assert.equal(describeDuelAttackMightDamageV1(card).canonicalCardId, YASUO_CANONICAL);
  }

  // No other catalog card that mentions "equal to my Might" resolves here.
  const mightDamage = catalog.cards.filter((c) => typeof c.ability === 'string' && c.ability.includes('equal to my Might'));
  assert.ok(mightDamage.length > known.length, 'expected other Might-damage composites in the catalog');
  for (const card of mightDamage) {
    if (known.includes(card.id)) continue;
    assert.equal(describeDuelAttackMightDamageV1(card).status, 'unknown', `${card.id} must stay unknown`);
  }

  console.log(`[attack-might-damage-description-v1] known=${known.length} unknown=${catalog.cards.length - known.length} total=${catalog.cards.length} mightDamagePrintings=${mightDamage.length}`);
});
