// Focused default (clean-checkout) suite for the pure-DATA `temporary-description-v1`
// recogniser.
//
// These cases build COMPLETE synthetic envelope/printing tuples with the REAL
// catalog `[Temporary]` whole-ability literals, so the suite runs in a clean
// checkout and never requires the gitignored official catalog. The one real
// The 1408-printing census requires the official catalog; missing data fails
// it loudly rather than failing; when the catalog IS present it asserts strictly.
//
// The recogniser returns DATA only: it is not an authority, is never registered
// in the official-program registry, and its result carries no capability.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const moduleSpecifier =
  process.env.DUEL_TEMPORARY_DESCRIPTION_MODULE ?? '../../dist/duel/temporary-description-v1.js';
const {
  DUEL_TEMPORARY_DESCRIPTION_V1_KIND,
  DUEL_TEMPORARY_V1_REMINDER_BODIES,
  temporaryReminderLiteral,
  describeDuelTemporaryV1,
} = await import(moduleSpecifier);

const DATA_VERSION = '2026-10-15-official-gallery';
const DIGEST = 'sha256:e9635b38044140375c33d9e5d8e12c1c2386994dfaa9ae8ae6832a127ff9f73d';

// The two real catalog whole-ability Unit [Temporary] literals.
const SPRITE_TEXT = '[Temporary] (Kill me at the start of your Beginning Phase, before scoring.)';
// The other self-relative wording observed on Units; there is no PURE whole-ability
// catalog printing with it (only compound texts), so it is exercised synthetically.
const CONTROLLER_TEXT =
  "[Temporary] (Kill me at the start of my controller's Beginning Phase, before scoring.)";

// Complete synthetic printing tuple with every DuelSourcePrintingCard field.
const synCard = (id, ability, extra = {}) => ({
  id,
  cardType: extra.cardType ?? 'Unit',
  ability,
  energy: 'energy' in extra ? extra.energy : null,
  power: 'power' in extra ? extra.power : null,
  might: 'might' in extra ? extra.might : 3,
  domains: extra.domains ?? ['Colorless'],
  tags: extra.tags ?? ['Fae', 'Token'],
  canonicalCardId: extra.canonicalCardId ?? `card.syn-${id}`,
  name: extra.name ?? 'Syn',
  fullName: extra.fullName ?? 'Syn',
  localizedName: extra.localizedName ?? '合成',
  setCode: extra.setCode ?? 'syn',
  cardNumber: extra.cardNumber ?? `SYN-${id}`,
  variant: extra.variant ?? 'standard',
});

const env = (card, extra = {}) => ({
  dataVersion: extra.dataVersion ?? DATA_VERSION,
  sourceCatalogDigest: extra.sourceCatalogDigest ?? DIGEST,
  card,
});

const KNOWN_KEYS = [
  'canonicalCardId', 'cardId', 'dataVersion', 'kind', 'printing', 'semantics',
  'source', 'sourceCatalogDigest', 'sourceFingerprint', 'status',
];
const UNKNOWN_KEYS = [
  'canonicalCardId', 'cardId', 'dataVersion', 'kind', 'normalizedAbilityText',
  'reason', 'sourceCatalogDigest', 'status',
];

// 1
test('kind and the accepted reminder bodies are fixed and frozen', () => {
  assert.equal(DUEL_TEMPORARY_DESCRIPTION_V1_KIND, 'temporary-description-v1');
  assert.ok(Object.isFrozen(DUEL_TEMPORARY_V1_REMINDER_BODIES));
  assert.deepEqual([...DUEL_TEMPORARY_V1_REMINDER_BODIES], [
    'Kill me at the start of your Beginning Phase, before scoring.',
    "Kill me at the start of my controller's Beginning Phase, before scoring.",
  ]);
  assert.equal(
    temporaryReminderLiteral('Kill me at the start of your Beginning Phase, before scoring.'),
    SPRITE_TEXT,
  );
});

// 2
test('recognises the real ogn-274-298 whole-ability [Temporary] as a token definition', () => {
  const card = synCard('ogn-274-298', SPRITE_TEXT, {
    canonicalCardId: 'card.hash-610cc33146e5be610b1b548bd327d47a44aba21edb081e7669cba4971753ccef',
    name: 'Sprite', fullName: 'Sprite', setCode: 'ogn', cardNumber: 'OGN-274/298', tags: ['Fae', 'Token'],
  });
  const result = describeDuelTemporaryV1(env(card));
  assert.equal(result.status, 'known');
  assert.equal(result.kind, 'temporary-description-v1');
  assert.equal(result.cardId, 'ogn-274-298');
  assert.equal(result.canonicalCardId, card.canonicalCardId);
  assert.equal(result.dataVersion, DATA_VERSION);
  assert.equal(result.sourceCatalogDigest, DIGEST);
  assert.equal(result.source.normalizedAbilityText, SPRITE_TEXT);
  assert.equal(result.source.might, 3);
  assert.deepEqual(result.source.domains, ['Colorless']);
  assert.deepEqual(result.source.tags, ['Fae', 'Token']);
  assert.deepEqual(result.printing, {
    kind: 'token-definition', tokenDefinition: true, grantsPlayFromHand: false,
  });
  assert.deepEqual(result.semantics, {
    kind: 'temporary',
    abilityKind: 'triggered-ability-keyword',
    reminderBody: 'Kill me at the start of your Beginning Phase, before scoring.',
    redundantIfMultiple: true,
    trigger: { kind: 'beginning-phase-start', controllerRelative: 'controller', ordering: 'before-scoring' },
    effect: { kind: 'kill', subject: 'self' },
  });
  assert.deepEqual(Object.keys(result).sort(), KNOWN_KEYS);
});

// 3
test('recognises the real unl-t07 whole-ability [Temporary] (alt printing, same canonical identity)', () => {
  const ogn = synCard('ogn-274-298', SPRITE_TEXT, {
    canonicalCardId: 'card.hash-610cc33146e5be610b1b548bd327d47a44aba21edb081e7669cba4971753ccef',
    setCode: 'ogn', cardNumber: 'OGN-274/298', tags: ['Fae', 'Token'],
  });
  const unl = synCard('unl-t07', SPRITE_TEXT, {
    canonicalCardId: 'card.hash-610cc33146e5be610b1b548bd327d47a44aba21edb081e7669cba4971753ccef',
    setCode: 'unl', cardNumber: 'UNL-T07', tags: ['Fae', 'Token'],
  });
  const a = describeDuelTemporaryV1(env(ogn));
  const b = describeDuelTemporaryV1(env(unl));
  assert.equal(a.status, 'known');
  assert.equal(b.status, 'known');
  // Same canonical identity...
  assert.equal(a.canonicalCardId, b.canonicalCardId);
  // ...but distinct printings, so the source-bound fingerprint differs.
  assert.equal(a.sourceFingerprint.cardId, 'ogn-274-298');
  assert.equal(b.sourceFingerprint.cardId, 'unl-t07');
  assert.notDeepEqual(a.sourceFingerprint, b.sourceFingerprint);
  assert.equal(a.sourceFingerprint.setCode, 'ogn');
  assert.equal(b.sourceFingerprint.setCode, 'unl');
  assert.equal(a.sourceFingerprint.variant, 'standard');
});

// 4
test('a non-token Unit with the exact whole-ability text is a physical printing, never a token', () => {
  const card = synCard('syn-physical', SPRITE_TEXT, { tags: ['Fae'], might: 2 });
  const result = describeDuelTemporaryV1(env(card));
  assert.equal(result.status, 'known');
  assert.deepEqual(result.printing, {
    kind: 'physical-printing', tokenDefinition: false, grantsPlayFromHand: false,
  });
});

// 5
test('the second observed self-relative reminder body is recognised as DATA', () => {
  const result = describeDuelTemporaryV1(env(synCard('syn-controller', CONTROLLER_TEXT)));
  assert.equal(result.status, 'known');
  assert.equal(result.semantics.reminderBody,
    "Kill me at the start of my controller's Beginning Phase, before scoring.");
  assert.equal(result.semantics.trigger.kind, 'beginning-phase-start');
  assert.equal(result.semantics.effect.kind === 'kill' && result.semantics.effect.subject === 'self', true);
});

// 6
test('normalizes identical whole-ability text (CRLF / edge whitespace) to the same known result', () => {
  const noisy = `\r\n  ${SPRITE_TEXT}  \r\n`;
  const result = describeDuelTemporaryV1(env(synCard('syn-noise', noisy)));
  assert.equal(result.status, 'known');
  assert.equal(result.source.normalizedAbilityText, SPRITE_TEXT);
});

// 7
test('a structurally single [Temporary] (...) ability with a non-reminder body is a reminder mismatch', () => {
  const result = describeDuelTemporaryV1(env(synCard('syn-mismatch', '[Temporary] (Unknown reminder wording.)')));
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'temporary-reminder-mismatch');
  assert.equal(result.normalizedAbilityText, '[Temporary] (Unknown reminder wording.)');
  assert.deepEqual(Object.keys(result).sort(), UNKNOWN_KEYS);
});

// 8
test('a bare keyword, another keyword, a grant or any extra sentence is UNKNOWN (not pure Temporary)', () => {
  const others = [
    // bare keyword (no reminder) is never sufficient, and is never treated as
    // a prefix match into a real reminder.
    '[Temporary]',
    // prefix-only: [Temporary] followed by an extra instruction line.
    `${SPRITE_TEXT}\nWhen you play me, draw 1.`,
    `${SPRITE_TEXT}\n[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)`,
    `[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n${SPRITE_TEXT}`,
    // grant instruction (Spell-shaped) — not the printed self keyword.
    'Give a unit [Temporary]. (Kill it at the start of its controller\'s Beginning Phase, before scoring.)',
    // a stray symbol / trailing text after the reminder.
    `${SPRITE_TEXT} :rb_energy_1:`,
  ];
  for (const ability of others) {
    const result = describeDuelTemporaryV1(env(synCard('syn-other', ability)));
    assert.equal(result.status, 'unknown', `expected unknown for ${JSON.stringify(ability)}`);
    assert.equal(result.reason, 'ability-not-pure-temporary');
  }
});

// 8b
test('a structurally single [Temporary] (<body>) with a different subject/plural/phase is a reminder mismatch', () => {
  const mismatches = [
    '[Temporary] (Kill this at the start of its controller\'s Beginning Phase, before scoring.)',
    '[Temporary] (Kill them at the start of their controller\'s next Beginning Phase, before scoring.)',
    '[Temporary] (Kill me at the start of your Beginning Phase.)',
  ];
  for (const ability of mismatches) {
    const result = describeDuelTemporaryV1(env(synCard('syn-mismatch', ability)));
    assert.equal(result.status, 'unknown', `expected unknown for ${JSON.stringify(ability)}`);
    assert.equal(result.reason, 'temporary-reminder-mismatch');
  }
});

// 9
test('a non-Unit printing with the exact text is UNKNOWN (not-unit)', () => {
  for (const cardType of ['Gear', 'Spell', 'Battlefield', 'Legend']) {
    const result = describeDuelTemporaryV1(
      env(synCard(`syn-${cardType}`, SPRITE_TEXT, { cardType, tags: [], might: null })),
    );
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'not-unit');
  }
});

// 10
test('empty / no-ability text never returns a blank or no-ability template', () => {
  for (const ability of ['', null, undefined]) {
    const result = describeDuelTemporaryV1(env(synCard('syn-empty', ability)));
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'ability-not-pure-temporary');
    assert.notEqual(result.normalizedAbilityText, undefined);
  }
});

// 11
test('results are deeply frozen and the input (envelope + card) is never mutated', () => {
  const card = synCard('ogn-274-298', SPRITE_TEXT, { domains: ['Colorless'], tags: ['Fae', 'Token'] });
  const envelope = env(card);
  const before = JSON.stringify(envelope);
  const result = describeDuelTemporaryV1(envelope);
  assert.equal(JSON.stringify(envelope), before, 'input must not be mutated');
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.printing));
  assert.ok(Object.isFrozen(result.sourceFingerprint));
  assert.ok(Object.isFrozen(result.sourceFingerprint.domains));
  assert.ok(Object.isFrozen(result.source.domains));
  assert.ok(Object.isFrozen(result.semantics));
  assert.ok(Object.isFrozen(result.semantics.trigger));
  assert.throws(() => { 'use strict'; result.semantics.effect.kind = 'noop'; }, TypeError);
});

// 12
test('a known or unknown result is DATA only: no capability/authority fields', () => {
  const known = describeDuelTemporaryV1(env(synCard('ogn-274-298', SPRITE_TEXT)));
  const unknown = describeDuelTemporaryV1(env(synCard('syn-tail', `${SPRITE_TEXT}\nJinx: discard 2.`)));
  for (const result of [known, unknown]) {
    const keys = Object.keys(result);
    for (const forbidden of [
      'privateUID', 'epoch', 'mintReceipt', 'sourceProof', 'authority',
      'sourceProgramComplete', 'executable', 'encoded', 'reference', 'program',
    ]) {
      assert.ok(!keys.includes(forbidden), `result must not carry ${forbidden}`);
    }
  }
  assert.deepEqual(Object.keys(known).sort(), KNOWN_KEYS);
  assert.deepEqual(Object.keys(unknown).sort(), UNKNOWN_KEYS);
});

// 13
test('accessors are never invoked; clone works; symbol/sparse/exotic/missing fields rejected; extra fields tolerated unread', () => {
  // A spread clone of the tuple (a fresh own-data copy) describes identically.
  const original = synCard('ogn-274-298', SPRITE_TEXT, { domains: ['Colorless'], tags: ['Fae', 'Token'] });
  const clone = { ...original, domains: [...original.domains], tags: [...original.tags] };
  assert.deepEqual(describeDuelTemporaryV1(env(clone)), describeDuelTemporaryV1(env(original)));

  let invoked = 0;
  const withGetter = synCard('syn-getter', SPRITE_TEXT);
  Object.defineProperty(withGetter, 'id', { get() { invoked += 1; return 'syn-getter'; }, enumerable: true, configurable: true });
  assert.throws(() => describeDuelTemporaryV1(env(withGetter)), TypeError);
  assert.equal(invoked, 0, 'accessor must never be invoked');

  // An accessor on the ENVELOPE must also never be invoked (no fingerprint trust).
  let envInvoked = 0;
  const envWithGetter = env(synCard('syn-envget', SPRITE_TEXT));
  Object.defineProperty(envWithGetter, 'sourceCatalogDigest', {
    get() { envInvoked += 1; return DIGEST; }, enumerable: true, configurable: true,
  });
  assert.throws(() => describeDuelTemporaryV1(envWithGetter), TypeError);
  assert.equal(envInvoked, 0, 'envelope accessor must never be invoked');

  const withSymbol = synCard('syn-symbol', SPRITE_TEXT);
  withSymbol[Symbol('x')] = 1;
  assert.throws(() => describeDuelTemporaryV1(env(withSymbol)), TypeError);

  const sparse = synCard('syn-sparse', SPRITE_TEXT);
  sparse.domains = ['Colorless'];
  delete sparse.domains[0];
  sparse.domains.length = 1;
  assert.throws(() => describeDuelTemporaryV1(env(sparse)), TypeError);

  const missing = synCard('syn-missing', SPRITE_TEXT);
  delete missing.tags;
  assert.throws(() => describeDuelTemporaryV1(env(missing)), TypeError);

  const freeform = synCard('syn-free', SPRITE_TEXT);
  freeform.domains = 'Colorless';
  assert.throws(() => describeDuelTemporaryV1(env(freeform)), TypeError);

  const badNumber = synCard('syn-badnum', SPRITE_TEXT);
  badNumber.might = -1;
  assert.throws(() => describeDuelTemporaryV1(env(badNumber)), TypeError);

  const exoticCard = Object.create({ polluted: true });
  Object.assign(exoticCard, synCard('syn-exotic', SPRITE_TEXT));
  assert.throws(() => describeDuelTemporaryV1(env(exoticCard)), TypeError);

  // Extra enumerable DATA fields (as on the real catalog, e.g. imageUrl) are
  // tolerated and never read as semantics.
  const withExtra = { ...synCard('syn-extra', SPRITE_TEXT), imageUrl: 'https://example.invalid/x.png' };
  const extraResult = describeDuelTemporaryV1(env(withExtra));
  assert.equal(extraResult.status, 'known');
  assert.deepEqual(Object.keys(extraResult).sort(), KNOWN_KEYS);
});

// 14
test('a caller-supplied fingerprint on the envelope is tolerated, never read and never changes the result', () => {
  const card = synCard('ogn-274-298', SPRITE_TEXT);
  const forged = {
    ...env(card),
    fingerprint: 'forged',
    sourceFingerprint: { cardId: 'ogn-274-298', fake: true },
  };
  const honest = describeDuelTemporaryV1(env(card));
  const polluted = describeDuelTemporaryV1(forged);
  assert.deepEqual(polluted, honest, 'caller fingerprint must not authenticate anything');
  // The recomputed fingerprint is bound to the real id, not the forged one.
  assert.equal(polluted.sourceFingerprint.cardId, 'ogn-274-298');
  assert.ok(!Object.keys(polluted.sourceFingerprint).includes('fake'));
});

// 15
test('the recogniser is never registered in the official-program registry', async () => {
  const programsSpecifier =
    process.env.DUEL_OFFICIAL_PROGRAMS_MODULE ?? '../../dist/duel/official-programs.js';
  const mod = await import(programsSpecifier);
  for (const name of Object.keys(mod)) {
    assert.ok(!/temporary-description/u.test(name), `registry export ${name} must not exist`);
  }
});

// 16
test('required real catalog census (DATA only)', () => {
  const catalogPath = process.env.RIFTBOUND_TEMPORARY_CATALOG ??
    new URL('../../../card-data/data/deck-catalog.json', import.meta.url);
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  assert.equal(catalog.cards.length, 1408, 'expected the 1408-printing catalog');
  const known = [];
  const unknown = [];
  for (const card of catalog.cards) {
    const result = describeDuelTemporaryV1({
      dataVersion: catalog.dataVersion,
      sourceCatalogDigest: catalog.digest,
      card,
    });
    (result.status === 'known' ? known : unknown).push(card.id);
  }
  known.sort();
  // DATA census only: the two pure whole-ability Unit [Temporary] printings.
  assert.deepEqual(known, ['ogn-274-298', 'unl-t07']);
  assert.equal(known.length + unknown.length, catalog.cards.length);
  console.log(`[temporary-description-v1] known=${known.length} unknown=${unknown.length} total=${catalog.cards.length}`);
});
