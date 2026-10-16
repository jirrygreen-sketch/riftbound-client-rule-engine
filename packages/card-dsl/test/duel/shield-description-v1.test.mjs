// Focused default (clean-checkout) suite for the pure-DATA `shield-description-v1`
// recogniser.
//
// These cases build COMPLETE inline synthetic printing tuples using the REAL
// catalog Shield/other whole-ability literals, so the suite runs in a clean
// checkout and never reads the gitignored official catalog. The real 1381-printing
// census lives in the separate explicit `shield-description-v1.audit.mjs`
// (parent-run), which FAILS (not skips) when the catalog is missing.
//
// The recogniser returns DATA only: it is not an authority, is never registered
// in the official-program registry, and its result carries no capability. The
// Shield description is a literal source record, NOT combat closure and NOT a
// final-Might computation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const moduleSpecifier =
  process.env.DUEL_SHIELD_DESCRIPTION_MODULE ?? '../../dist/duel/shield-description-v1.js';
const {
  DUEL_SHIELD_DESCRIPTION_V1_KIND,
  DUEL_SHIELD_DEFAULT_AMOUNT,
  DUEL_SHIELD_CONDITION,
  DUEL_SHIELD_LAYER,
  DUEL_SHIELD_CATALOG_DATA_VERSION,
  DUEL_SHIELD_CATALOG_DIGEST,
  DUEL_SHIELD_SOURCE_FINGERPRINT_SCHEME,
  shieldReminderLiteral,
  describeDuelShieldV1,
} = await import(moduleSpecifier);

const DATA_VERSION = '2026-10-12-official-gallery';
const DIGEST = 'sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10';

const REMINDER = (n) => `[Shield ${n}] (+${n} :rb_might: while I'm a defender.)`;

// Complete synthetic printing tuple with every DuelSourcePrintingCard field.
const synUnit = (id, ability, extra = {}) => ({
  id,
  cardType: extra.cardType ?? 'Unit',
  ability,
  energy: 'energy' in extra ? extra.energy : 4,
  power: 'power' in extra ? extra.power : null,
  might: 'might' in extra ? extra.might : 4,
  domains: extra.domains ?? ['Calm'],
  tags: extra.tags ?? ['Ionia'],
  canonicalCardId: extra.canonicalCardId ?? `card.syn-${id}`,
  name: extra.name ?? `Syn ${id}`,
  fullName: extra.fullName ?? `Syn ${id}`,
  localizedName: extra.localizedName ?? '合成',
  setCode: extra.setCode ?? 'syn',
  cardNumber: extra.cardNumber ?? `SYN-${id}`,
  variant: extra.variant ?? 'standard',
});

const KNOWN_KEYS = [
  'canonicalCardId', 'cardId', 'catalogDataVersion', 'catalogDigest', 'kind',
  'printedMight', 'semantics', 'source', 'sourceFingerprint', 'status',
];
const UNKNOWN_KEYS = ['canonicalCardId', 'cardId', 'kind', 'normalizedAbilityText', 'reason', 'status'];

// 1
test('kind, default amount, condition, layer and catalog pins are fixed and frozen', () => {
  assert.equal(DUEL_SHIELD_DESCRIPTION_V1_KIND, 'shield-description-v1');
  assert.equal(DUEL_SHIELD_DEFAULT_AMOUNT, 1);
  assert.equal(DUEL_SHIELD_CONDITION, 'while-defender');
  assert.equal(DUEL_SHIELD_LAYER, 'add-subtract-might');
  assert.equal(DUEL_SHIELD_CATALOG_DATA_VERSION, '2026-10-12-official-gallery');
  assert.equal(DUEL_SHIELD_CATALOG_DIGEST, DIGEST);
  assert.equal(DUEL_SHIELD_SOURCE_FINGERPRINT_SCHEME, 'shield-source-v1');
  assert.equal(shieldReminderLiteral(2), "[Shield 2] (+2 :rb_might: while I'm a defender.)");
});

// 2
test('recognises the real ogn-052-298 whole-ability [Shield] as known', () => {
  const ability = "[Shield] (+1 :rb_might: while I'm a defender.)";
  const card = synUnit('ogn-052-298', ability, {
    energy: 2, might: 2, domains: ['Calm'], tags: ['Poro'],
    canonicalCardId: 'card.hash-d758a4eb01d27daf80036a95c8930bef4e01df5c77bf18f8f92392c7dd708701',
    fullName: 'Stalwart Poro',
  });
  const result = describeDuelShieldV1(card);
  assert.equal(result.status, 'known');
  assert.equal(result.kind, 'shield-description-v1');
  assert.equal(result.cardId, 'ogn-052-298');
  assert.equal(result.canonicalCardId, card.canonicalCardId);
  assert.equal(result.catalogDataVersion, DATA_VERSION);
  assert.equal(result.catalogDigest, DIGEST);
  assert.match(result.sourceFingerprint, /^shield-source-v1:/u);
  assert.equal(result.source.normalizedAbilityText, ability);
  assert.equal(result.source.energy, 2);
  assert.equal(result.source.power, null);
  assert.equal(result.source.might, 2);
  assert.deepEqual(result.source.domains, ['Calm']);
  assert.deepEqual(result.source.tags, ['Poro']);
  assert.equal(result.printedMight, 2);
  assert.deepEqual(result.semantics, {
    kind: 'shield',
    amount: 1,
    condition: 'while-defender',
    layer: 'add-subtract-might',
  });
});

// 3
test('recognises the real ogs-005-024 whole-ability [Shield] as known', () => {
  const card = synUnit('ogs-005-024', REMINDER(1), {
    energy: 6, power: 1, might: 6, domains: ['Calm'], tags: ['Ionia', 'Bird'],
    canonicalCardId: 'card.hash-2b68503e65fe0121f9346680649fa82fb83b4edc1e53b3a7416db4848ce941c6',
    fullName: 'Zephyr Sage',
  });
  const result = describeDuelShieldV1(card);
  assert.equal(result.status, 'known');
  assert.equal(result.cardId, 'ogs-005-024');
  assert.equal(result.source.energy, 6);
  assert.equal(result.source.power, 1);
  assert.equal(result.printedMight, 6);
  assert.equal(result.semantics.amount, 1);
  assert.equal(result.semantics.condition, 'while-defender');
});

// 4
test('recognises a bare [Shield N] (no reminder) with the printed value', () => {
  const result = describeDuelShieldV1(synUnit('syn-bare', '[Shield 3]'));
  assert.equal(result.status, 'known');
  assert.equal(result.semantics.amount, 3);
  assert.equal(result.semantics.condition, 'while-defender');
  assert.equal(result.semantics.layer, 'add-subtract-might');
});

// 5
test('recognises a bare [Shield] (no reminder) as default 1 (CR 814.1.b.3)', () => {
  const result = describeDuelShieldV1(synUnit('syn-bare-default', '[Shield]'));
  assert.equal(result.status, 'known');
  assert.equal(result.semantics.amount, 1);
});

// 6
test('normalizes identical whole-ability text (CRLF / edge whitespace) to the same known result', () => {
  const noisy = `\r\n  ${REMINDER(2)}  \r\n`;
  const result = describeDuelShieldV1(synUnit('syn-noise', noisy));
  assert.equal(result.status, 'known');
  assert.equal(result.source.normalizedAbilityText, REMINDER(2));
  assert.equal(result.semantics.amount, 2);
});

// 7
test('a reminder that disagrees with the printed Shield Value is UNKNOWN', () => {
  const result = describeDuelShieldV1(synUnit('syn-mismatch', "[Shield 2] (+3 :rb_might: while I'm a defender.)"));
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'shield-reminder-mismatch');
  assert.equal(result.normalizedAbilityText, "[Shield 2] (+3 :rb_might: while I'm a defender.)");
  assert.deepEqual(Object.keys(result).sort(), UNKNOWN_KEYS);
});

// 8
test('an attacker-worded reminder (Assault-style) is never accepted as Shield', () => {
  const result = describeDuelShieldV1(synUnit('syn-attacker', "[Shield 2] (+2 :rb_might: while I'm an attacker.)"));
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'ability-not-pure-shield');
});

// 9
test('whole text with a trigger, [Tank] or any other instruction is UNKNOWN', () => {
  const withOther = [
    // real ven-138-166 / unl-055a-219 shape: Shield + another keyword line.
    `[Shield] (+1 :rb_might: while I'm a defender.)\n[Tank] (I must be assigned combat damage first.)`,
    // real ogn-086-298 shape: another keyword line before Shield.
    `[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n${REMINDER(1)}`,
    // real ogn-238-298 shape: Shield pure line plus a separate trigger line.
    `${REMINDER(1)}\nWhen I attack, stun an enemy unit here. (It doesn't deal combat damage this turn.)`,
    `[Shield 3]\nWhen you play me, discard 1.`,
    'Unknown trailing sentence.',
    `${REMINDER(1)}\n${REMINDER(2)}`,
  ];
  for (const ability of withOther) {
    const result = describeDuelShieldV1(synUnit('syn-other', ability));
    assert.equal(result.status, 'unknown', `expected unknown for ${JSON.stringify(ability)}`);
    assert.equal(result.reason, 'ability-not-pure-shield');
  }
});

// 10
test('granted / dynamic / conditional / aura / granted-value Shield is UNKNOWN (not the printed keyword)', () => {
  const others = [
    // grant instruction (Spell): real ogn-057-298 shape.
    "Give a unit [Shield 3] and [Tank] this turn. (+3 :rb_might: while it's a defender. It must be assigned combat damage first.)",
    // dynamic value: "equal to ...".
    'Give a unit [Shield] equal to the number of friendly units.',
    // conditional self-grant: real ven-117-166 shape.
    "I have [Shield 3] while I'm at a battlefield with exactly one other unit you control. (+3 :rb_might: while I'm a defender.)",
    // aura affecting other units: real ogn-074-298 tail line.
    'Other friendly units here have [Shield].',
    // Empowered compound: real ven-030-166 shape.
    '[Empowered][>] I have [Deflect] and [Shield 3]. (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.+3 :rb_might: while I\'m a defender.)',
    // a second distinct Shield in one whole text.
    `${REMINDER(2)}\n${REMINDER(3)}`,
    '[Shield] (Unknown reminder wording.)',
    "[Shield X] (+X :rb_might: while I'm a defender.)",
  ];
  for (const ability of others) {
    const result = describeDuelShieldV1(synUnit('syn-other', ability));
    assert.equal(result.status, 'unknown', `expected unknown for ${JSON.stringify(ability)}`);
    assert.equal(result.reason, 'ability-not-pure-shield');
  }
});

// 11
test('a non-Unit printing with the exact whole text is UNKNOWN (not-unit)', () => {
  const result = describeDuelShieldV1(
    synUnit('rad-162-167', REMINDER(1), { cardType: 'Battlefield', energy: null, might: null, domains: ['Colorless'] }),
  );
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'not-unit');
});

// 12
test('wrong symbol (e.g. a different Might token) is UNKNOWN, never prefix-matched', () => {
  for (const ability of [
    "[Shield] (+1 :rb_power: while I'm a defender.)",
    "[Shield] (+1 :rb_might: while I'm a defender)",
    "[Shield] (+1 :rb_might: while I’m a defender.)", // curly apostrophe
  ]) {
    const result = describeDuelShieldV1(synUnit('syn-symbol', ability));
    assert.equal(result.status, 'unknown', `expected unknown for ${JSON.stringify(ability)}`);
    assert.equal(result.reason, 'ability-not-pure-shield');
  }
});

// 13
test('empty / no-ability text never returns blank, a no-ability template or a default 1', () => {
  for (const ability of ['', null, undefined]) {
    const result = describeDuelShieldV1(synUnit('syn-empty', ability));
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'ability-not-pure-shield');
    assert.notEqual(result.normalizedAbilityText, undefined);
  }
});

// 14
test('a non-numeric source Might is reported UNKNOWN', () => {
  const result = describeDuelShieldV1(synUnit('syn-null-might', REMINDER(1), { might: null }));
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'non-numeric-source-stat');
});

// 15
test('results are deeply frozen and the input is never mutated', () => {
  const card = synUnit('ogn-052-298', REMINDER(1), { domains: ['Calm'], tags: ['Poro'] });
  const before = JSON.stringify(card);
  const result = describeDuelShieldV1(card);
  assert.equal(JSON.stringify(card), before, 'input tuple must not be mutated');
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.source));
  assert.ok(Object.isFrozen(result.source.domains));
  assert.ok(Object.isFrozen(result.source.tags));
  assert.ok(Object.isFrozen(result.semantics));
  assert.throws(() => {
    'use strict';
    result.semantics.amount = 99;
  }, TypeError);
});

// 16
test('a known or unknown result is DATA only: no capability/executable/sourceProgramComplete fields', () => {
  const known = describeDuelShieldV1(synUnit('ogn-052-298', REMINDER(1)));
  const unknown = describeDuelShieldV1(synUnit('syn-tail', `${REMINDER(1)}\nJinx: discard 2.`));
  for (const result of [known, unknown]) {
    const keys = Object.keys(result);
    for (const forbidden of [
      'privateUID', 'epoch', 'mintReceipt', 'sourceProof', 'authority', 'encoded',
      'reference', 'program', 'sourceProgramComplete', 'executable', 'negativeProof',
    ]) {
      assert.ok(!keys.includes(forbidden), `result must not carry ${forbidden}`);
    }
  }
  assert.deepEqual(Object.keys(known).sort(), KNOWN_KEYS);
  assert.deepEqual(Object.keys(unknown).sort(), UNKNOWN_KEYS);
});

// 17
test('whole-source fingerprint is stable, id/power sensitive, and never caller-trusted', () => {
  const base = synUnit('ogn-052-298', REMINDER(1), { domains: ['Calm'], tags: ['Poro'] });
  const clone = { ...base, domains: [...base.domains], tags: [...base.tags] };
  const fp = describeDuelShieldV1(base).sourceFingerprint;
  assert.equal(describeDuelShieldV1(clone).sourceFingerprint, fp, 'clone must fingerprint identically');

  // A caller-claimed fingerprint/version/digest field is ignored, not trusted.
  const forged = { ...base, sourceFingerprint: 'shield-source-v1:forged', dataVersion: 'evil', sourceCatalogDigest: 'sha256:deadbeef' };
  const forgedResult = describeDuelShieldV1(forged);
  assert.equal(forgedResult.status, 'known');
  assert.equal(forgedResult.sourceFingerprint, fp);
  assert.equal(forgedResult.catalogDataVersion, DATA_VERSION);
  assert.equal(forgedResult.catalogDigest, DIGEST);

  // Distinct whole-source identity -> distinct fingerprint.
  assert.notEqual(describeDuelShieldV1({ ...base, id: 'ogn-052a-298' }).sourceFingerprint, fp);
  assert.notEqual(describeDuelShieldV1({ ...base, variant: 'alternate' }).sourceFingerprint, fp);
  assert.notEqual(describeDuelShieldV1({ ...base, power: 1 }).sourceFingerprint, fp);
  // Length-ambiguity guard: different domains must not collide.
  assert.notEqual(
    describeDuelShieldV1({ ...base, domains: ['Calm'] }).sourceFingerprint,
    describeDuelShieldV1({ ...base, domains: ['Cal', 'm'] }).sourceFingerprint,
  );
});

// 18
test('two alt-art printings sharing one canonical identity are each known with distinct fingerprints', () => {
  const canonicalCardId = 'card.hash-d758a4eb01d27daf80036a95c8930bef4e01df5c77bf18f8f92392c7dd708701';
  const standard = synUnit('ogn-052-298', REMINDER(1), { canonicalCardId, variant: 'standard' });
  const alt = synUnit('ogn-052a-298', REMINDER(1), { canonicalCardId, variant: 'alternate' });
  const rs = describeDuelShieldV1(standard);
  const ra = describeDuelShieldV1(alt);
  assert.equal(rs.status, 'known');
  assert.equal(ra.status, 'known');
  assert.equal(rs.canonicalCardId, ra.canonicalCardId);
  assert.notEqual(rs.sourceFingerprint, ra.sourceFingerprint);
});

// 19
test('accessors are never invoked; symbol/sparse/missing fields are rejected; extra data fields tolerated unread', () => {
  const original = synUnit('ogn-052-298', REMINDER(1), { domains: ['Calm'], tags: ['Poro'] });
  const clone = { ...original, domains: [...original.domains], tags: [...original.tags] };
  assert.deepEqual(describeDuelShieldV1(clone), describeDuelShieldV1(original));

  let invoked = 0;
  const withGetter = synUnit('syn-getter', REMINDER(1));
  Object.defineProperty(withGetter, 'id', { get() { invoked += 1; return 'syn-getter'; }, enumerable: true, configurable: true });
  assert.throws(() => describeDuelShieldV1(withGetter), TypeError);
  assert.equal(invoked, 0, 'accessor must never be invoked');

  const withSymbol = synUnit('syn-symbol', REMINDER(1));
  withSymbol[Symbol('x')] = 1;
  assert.throws(() => describeDuelShieldV1(withSymbol), TypeError);

  const sparse = synUnit('syn-sparse', REMINDER(1));
  sparse.domains = ['Calm'];
  delete sparse.domains[0];
  sparse.domains.length = 1;
  assert.throws(() => describeDuelShieldV1(sparse), TypeError);

  const missing = synUnit('syn-missing', REMINDER(1));
  delete missing.tags;
  assert.throws(() => describeDuelShieldV1(missing), TypeError);

  // Malformed / exotic array inputs are rejected.
  const badDomains = synUnit('syn-bad', REMINDER(1));
  badDomains.domains = 'Calm';
  assert.throws(() => describeDuelShieldV1(badDomains), TypeError);
  const exoticProto = synUnit('syn-proto', REMINDER(1));
  exoticProto.domains = Object.create(Array.prototype);
  exoticProto.domains.push('Calm');
  assert.throws(() => describeDuelShieldV1(exoticProto), TypeError);
  const badNumber = synUnit('syn-num', REMINDER(1));
  badNumber.might = 1.5;
  assert.throws(() => describeDuelShieldV1(badNumber), TypeError);

  // Extra enumerable DATA fields (as on the real catalog, e.g. imageUrl) are
  // tolerated and never read as semantics.
  const withExtra = { ...synUnit('syn-extra', REMINDER(1)), imageUrl: 'https://example.invalid/x.png' };
  const extraResult = describeDuelShieldV1(withExtra);
  assert.equal(extraResult.status, 'known');
  assert.deepEqual(Object.keys(extraResult).sort(), KNOWN_KEYS);
});

// 20
test('a real catalog Unit with NO Shield (ogn-036-298 Vi, Destructive) is UNKNOWN', () => {
  const ability = "[Ganking] (I can move from battlefield to battlefield.)\nRecycle 1 from your trash: Give me +1 :rb_might: this turn.";
  const result = describeDuelShieldV1(synUnit('ogn-036-298', ability, { energy: 2, power: 1, might: 3, fullName: 'Vi, Destructive' }));
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'ability-not-pure-shield');
});

// 21
test('the recogniser is never registered in the official-program registry', async () => {
  const programsSpecifier =
    process.env.DUEL_OFFICIAL_PROGRAMS_MODULE ?? '../../dist/duel/official-programs.js';
  const mod = await import(programsSpecifier);
  for (const name of Object.keys(mod)) {
    assert.ok(!/shield-description/u.test(name), `registry export ${name} must not exist`);
  }
});

// 22
// Real-catalog census (DATA source, not gameplay execution). The official
// catalog is a required project prerequisite; when it is missing
// this required census fails rather than silently passing. In this workspace
// the catalog is present and the census asserts the exhaustive pure-Shield set.
test('real 1381-printing catalog census: pure whole-ability Shield is exactly ogn-052-298 and ogs-005-024', (t) => {
  const catalogPath =
    process.env.RIFTBOUND_SHIELD_CATALOG ??
    new URL('../../../card-data/data/deck-catalog.json', import.meta.url);
  assert.ok(existsSync(catalogPath), `required official catalog missing: ${catalogPath}`);
  const bytes = readFileSync(catalogPath);
  const catalog = JSON.parse(bytes.toString('utf8'));
  assert.ok(Array.isArray(catalog.cards));
  assert.equal(catalog.cards.length, 1381);
  assert.equal(catalog.dataVersion, DATA_VERSION);
  assert.equal(catalog.digest, DIGEST);
  // The descriptor's pinned catalog identity matches the real catalog bytes.
  assert.equal(DUEL_SHIELD_CATALOG_DATA_VERSION, catalog.dataVersion);
  assert.equal(DUEL_SHIELD_CATALOG_DIGEST, catalog.digest);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    '06d99a589fed6046bff8072847946d5304a8ca43ef1e4e2c680c4a7a0f1df766');

  const known = catalog.cards.filter((card) => describeDuelShieldV1(card).status === 'known').map((card) => card.id).sort();
  assert.deepEqual(known, ['ogn-052-298', 'ogs-005-024']);

  // Every Shield-mentioning printing is classified; the other 45 stay unknown.
  const shieldCards = catalog.cards.filter(
    (card) => typeof card.ability === 'string' && card.ability.includes('[Shield'),
  );
  assert.equal(shieldCards.length, 47);
  assert.equal(shieldCards.filter((card) => describeDuelShieldV1(card).status === 'known').length, 2);

  // The real Vi, Destructive has no Shield and must never be recognised.
  const vi = catalog.cards.find((card) => card.id === 'ogn-036-298');
  assert.ok(vi);
  assert.equal(describeDuelShieldV1(vi).status, 'unknown');

  // The two known sources carry the exact real catalog literal and pinned catalog.
  for (const id of known) {
    const result = describeDuelShieldV1(catalog.cards.find((card) => card.id === id));
    assert.equal(result.source.normalizedAbilityText, "[Shield] (+1 :rb_might: while I'm a defender.)");
    assert.equal(result.semantics.amount, 1);
    assert.equal(result.catalogDataVersion, DATA_VERSION);
    assert.equal(result.catalogDigest, DIGEST);
    assert.match(result.sourceFingerprint, /^shield-source-v1:/u);
  }
});
