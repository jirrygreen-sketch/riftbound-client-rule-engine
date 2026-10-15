// Focused default (clean-checkout) suite for the pure-DATA `assault-description-v1`
// recogniser.
//
// These cases build COMPLETE inline synthetic printing tuples with the REAL
// catalog Assault/other whole-ability literals, so the suite runs in a clean
// checkout and never reads the gitignored official catalog. The real 1381-printing
// census lives in the separate `assault-description-v1.audit.mjs` (parent-run),
// which FAILS (not skips) when the catalog is missing.
//
// The recogniser returns DATA only: it is not an authority, is never registered
// in the official-program registry, and its result carries no capability.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const moduleSpecifier =
  process.env.DUEL_ASSAULT_DESCRIPTION_MODULE ?? '../../dist/duel/assault-description-v1.js';
const {
  DUEL_ASSAULT_DESCRIPTION_V1_KIND,
  DUEL_ASSAULT_DEFAULT_AMOUNT,
  DUEL_ASSAULT_CONDITION,
  DUEL_ASSAULT_LAYER,
  assaultReminderLiteral,
  describeDuelAssaultV1,
} = await import(moduleSpecifier);

const DATA_VERSION = '2026-10-12-official-gallery';
const DIGEST = 'sha256:06d99a589fed6046bff8072847946d5304a8ca43ef1e4e2c680c4a7a0f1df766';

const REMINDER = (n) => `[Assault ${n}] (+${n} :rb_might: while I'm an attacker.)`;

// Complete synthetic printing tuple with every DuelSourcePrintingCard field.
const synUnit = (id, ability, extra = {}) => ({
  id,
  cardType: extra.cardType ?? 'Unit',
  ability,
  energy: 'energy' in extra ? extra.energy : 4,
  power: 'power' in extra ? extra.power : null,
  might: 'might' in extra ? extra.might : 4,
  domains: extra.domains ?? ['Fury'],
  tags: extra.tags ?? ['Noxus'],
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

const KNOWN_KEYS = ['canonicalCardId', 'cardId', 'kind', 'printedMight', 'semantics', 'source', 'status'];
const UNKNOWN_KEYS = ['canonicalCardId', 'cardId', 'kind', 'normalizedAbilityText', 'reason', 'status'];

// 1
test('kind, default amount, condition and layer are fixed and frozen', () => {
  assert.equal(DUEL_ASSAULT_DESCRIPTION_V1_KIND, 'assault-description-v1');
  assert.equal(DUEL_ASSAULT_DEFAULT_AMOUNT, 1);
  assert.equal(DUEL_ASSAULT_CONDITION, 'while-attacker');
  assert.equal(DUEL_ASSAULT_LAYER, 'add-subtract-might');
  assert.equal(assaultReminderLiteral(2), "[Assault 2] (+2 :rb_might: while I'm an attacker.)");
});

// 2
test('recognises the real ogn-210-298 whole-ability [Assault] (default 1) as known', () => {
  const ability = "[Assault] (+1 :rb_might: while I'm an attacker.)";
  const card = synUnit('ogn-210-298', ability, { energy: 2, might: 2, fullName: 'Daring Poro' });
  const result = describeDuelAssaultV1(card);
  assert.equal(result.status, 'known');
  assert.equal(result.kind, 'assault-description-v1');
  assert.equal(result.cardId, 'ogn-210-298');
  assert.equal(result.canonicalCardId, card.canonicalCardId);
  assert.equal(result.source.normalizedAbilityText, ability);
  assert.equal(result.source.energy, 2);
  assert.equal(result.source.power, null);
  assert.equal(result.source.might, 2);
  assert.deepEqual(result.source.domains, ['Fury']);
  assert.deepEqual(result.source.tags, ['Noxus']);
  assert.equal(result.printedMight, 2);
  assert.deepEqual(result.semantics, {
    kind: 'assault',
    amount: 1,
    condition: 'while-attacker',
    layer: 'add-subtract-might',
  });
});

// 3
test('recognises the real sfd-156-221 [Assault 2] whole-ability (printedMight preserved)', () => {
  const card = synUnit('sfd-156-221', REMINDER(2), { energy: 4, might: 3, fullName: 'Laurent Duelist' });
  const result = describeDuelAssaultV1(card);
  assert.equal(result.status, 'known');
  assert.equal(result.printedMight, 3);
  assert.equal(result.semantics.amount, 2);
  assert.deepEqual(result.semantics, {
    kind: 'assault',
    amount: 2,
    condition: 'while-attacker',
    layer: 'add-subtract-might',
  });
});

// 4
test('recognises the real unl-225-219 bare [Assault] (no reminder) as default 1', () => {
  const card = synUnit('unl-225-219', '[Assault]', { energy: 2, might: 2, fullName: 'Daring Poro' });
  const result = describeDuelAssaultV1(card);
  assert.equal(result.status, 'known');
  assert.equal(result.semantics.amount, 1);
  assert.equal(result.semantics.condition, 'while-attacker');
});

// 5
test('recognises a bare [Assault N] (no reminder) with the printed value', () => {
  const result = describeDuelAssaultV1(synUnit('syn-bare', '[Assault 4]'));
  assert.equal(result.status, 'known');
  assert.equal(result.semantics.amount, 4);
  assert.equal(result.semantics.layer, 'add-subtract-might');
});

// 6
test('normalizes identical whole-ability text (CRLF / edge whitespace) to the same known result', () => {
  const noisy = `\r\n  ${REMINDER(3)}  \r\n`;
  const result = describeDuelAssaultV1(synUnit('syn-noise', noisy));
  assert.equal(result.status, 'known');
  assert.equal(result.source.normalizedAbilityText, REMINDER(3));
  assert.equal(result.semantics.amount, 3);
});

// 7
test('a reminder that disagrees with the printed Assault Value is UNKNOWN', () => {
  const result = describeDuelAssaultV1(synUnit('syn-mismatch', "[Assault 2] (+3 :rb_might: while I'm an attacker.)"));
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'assault-reminder-mismatch');
  assert.equal(result.normalizedAbilityText, "[Assault 2] (+3 :rb_might: while I'm an attacker.)");
  assert.deepEqual(Object.keys(result).sort(), UNKNOWN_KEYS);
});

// 8
test('whole text with a trigger, [Shield] or any other instruction is UNKNOWN', () => {
  const withOther = [
    // real ogs-007-024 / rad-088-167 shape: Assault + Shield in one ability.
    "[Assault 2], [Shield 2] (+2 :rb_might: while I'm an attacker or defender.)",
    // real unl-002-219 / unl-006-219 / unl-024-219 shapes: another keyword line.
    `[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n${REMINDER(2)}`,
    `[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n${REMINDER(4)}`,
    `${REMINDER(2)}\n[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)`,
    // real ogn-003-298 shape: pure keyword text plus a separate trigger line.
    `${REMINDER(2)}\nWhen you play me, discard 1.`,
    `${REMINDER(2)}\nWhen I attack, deal damage equal to my [Assault].`,
    '[Assault 2]\nWhen you play me, discard 1.',
    'Unknown trailing sentence.',
  ];
  for (const ability of withOther) {
    const result = describeDuelAssaultV1(synUnit('syn-other', ability));
    assert.equal(result.status, 'unknown', `expected unknown for ${JSON.stringify(ability)}`);
    assert.equal(result.reason, 'ability-not-pure-assault');
  }
});

// 9
test('granted / dynamic / conditional / aura / Spell Assault is UNKNOWN (not the printed keyword)', () => {
  const others = [
    // grant instruction (Spell): real ogn-004-298 shape.
    "Give a unit [Assault 3] this turn. (+3 :rb_might: while it's an attacker.)",
    // dynamic value: "equal to ...".
    'Give a unit [Assault] equal to the number of friendly units.',
    // conditional self-grant.
    'When I attack, I have [Assault 2] this turn.',
    // aura affecting other units.
    "Other friendly units here have [Assault 2]. (+2 :rb_might: while they're attackers.)",
    // a second Assault in the same whole text.
    `${REMINDER(2)}\n${REMINDER(3)}`,
    '[Assault] (Unknown reminder wording.)',
    '[Assault X] (+X :rb_might: while I\'m an attacker.)',
  ];
  for (const ability of others) {
    const result = describeDuelAssaultV1(synUnit('syn-other', ability));
    assert.equal(result.status, 'unknown', `expected unknown for ${JSON.stringify(ability)}`);
    assert.equal(result.reason, 'ability-not-pure-assault');
  }
});

// 10
test('a non-Unit printing with the exact reminder is UNKNOWN (not-unit)', () => {
  const result = describeDuelAssaultV1(
    synUnit('rad-162-167', REMINDER(2), { cardType: 'Battlefield', energy: null, might: null, domains: ['Colorless'] }),
  );
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'not-unit');
});

// 11
test('empty / no-ability text never returns blank, a no-ability template or a default 1', () => {
  for (const ability of ['', null, undefined]) {
    const result = describeDuelAssaultV1(synUnit('syn-empty', ability));
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'ability-not-pure-assault');
    assert.notEqual(result.normalizedAbilityText, undefined);
  }
});

// 12
test('a non-numeric source Might is reported UNKNOWN', () => {
  const result = describeDuelAssaultV1(synUnit('syn-null-might', REMINDER(2), { might: null }));
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'non-numeric-source-stat');
});

// 13
test('results are deeply frozen and the input is never mutated', () => {
  const card = synUnit('ogn-210-298', REMINDER(1), { domains: ['Fury'], tags: ['Noxus'] });
  const before = JSON.stringify(card);
  const result = describeDuelAssaultV1(card);
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

// 14
test('a known or unknown result is DATA only: no capability fields, no executable reference', () => {
  const known = describeDuelAssaultV1(synUnit('ogn-210-298', REMINDER(2)));
  const unknown = describeDuelAssaultV1(synUnit('syn-tail', `${REMINDER(2)}\nJinx: discard 2.`));
  for (const result of [known, unknown]) {
    const keys = Object.keys(result);
    for (const forbidden of ['privateUID', 'epoch', 'mintReceipt', 'sourceProof', 'authority', 'encoded', 'reference', 'program']) {
      assert.ok(!keys.includes(forbidden), `result must not carry ${forbidden}`);
    }
  }
  assert.deepEqual(Object.keys(known).sort(), KNOWN_KEYS);
  assert.deepEqual(Object.keys(unknown).sort(), UNKNOWN_KEYS);
});

// 15
test('accessors are never invoked; clone works; symbol/sparse/missing fields are rejected; extra data fields tolerated unread', () => {
  // A spread clone of the tuple (a fresh own-data copy) describes identically.
  const original = synUnit('ogn-210-298', REMINDER(2), { domains: ['Fury'], tags: ['Noxus'] });
  const clone = { ...original, domains: [...original.domains], tags: [...original.tags] };
  assert.deepEqual(describeDuelAssaultV1(clone), describeDuelAssaultV1(original));

  let invoked = 0;
  const withGetter = synUnit('syn-getter', REMINDER(2));
  Object.defineProperty(withGetter, 'id', { get() { invoked += 1; return 'syn-getter'; }, enumerable: true, configurable: true });
  assert.throws(() => describeDuelAssaultV1(withGetter), TypeError);
  assert.equal(invoked, 0, 'accessor must never be invoked');

  const withSymbol = synUnit('syn-symbol', REMINDER(2));
  withSymbol[Symbol('x')] = 1;
  assert.throws(() => describeDuelAssaultV1(withSymbol), TypeError);

  const sparse = synUnit('syn-sparse', REMINDER(2));
  sparse.domains = ['Fury'];
  delete sparse.domains[0];
  sparse.domains.length = 1;
  assert.throws(() => describeDuelAssaultV1(sparse), TypeError);

  const missing = synUnit('syn-missing', REMINDER(2));
  delete missing.tags;
  assert.throws(() => describeDuelAssaultV1(missing), TypeError);

  // Extra enumerable DATA fields (as on the real catalog, e.g. imageUrl) are
  // tolerated and never read as semantics.
  const withExtra = { ...synUnit('syn-extra', REMINDER(2)), imageUrl: 'https://example.invalid/x.png' };
  const extraResult = describeDuelAssaultV1(withExtra);
  assert.equal(extraResult.status, 'known');
  assert.deepEqual(Object.keys(extraResult).sort(), KNOWN_KEYS);
});

// 16
test('a real catalog Unit with NO Assault (ogn-036-298 Vi, Destructive) is UNKNOWN', () => {
  const ability = "[Ganking] (I can move from battlefield to battlefield.)\nRecycle 1 from your trash: Give me +1 :rb_might: this turn.";
  const result = describeDuelAssaultV1(synUnit('ogn-036-298', ability, { energy: 2, power: 1, might: 3, fullName: 'Vi, Destructive' }));
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'ability-not-pure-assault');
});

// 17
test('the recogniser is never registered in the official-program registry', async () => {
  const programsSpecifier =
    process.env.DUEL_OFFICIAL_PROGRAMS_MODULE ?? '../../dist/duel/official-programs.js';
  const mod = await import(programsSpecifier);
  for (const name of Object.keys(mod)) {
    assert.ok(!/assault-description/u.test(name), `registry export ${name} must not exist`);
  }
});
