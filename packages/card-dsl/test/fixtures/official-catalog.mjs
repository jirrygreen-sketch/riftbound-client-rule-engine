// TRACKED synthetic catalog fixture for the default `@riftbound/card-dsl` Duel
// suite. It is hand-written, committed to Git, and therefore present in a clean
// checkout. The default suite MUST NOT depend on the gitignored official
// `packages/card-data/data/deck-catalog.json`; the real-catalog census lives in
// the explicit `*.audit.mjs` files run by `pnpm --filter @riftbound/card-dsl
// audit:official-catalog`.
//
// The card *texts* below are the exact whole-ability templates the compiled
// compiler recognizes (Basic Rune rule grant, `I enter ready.`, Ganking reminder,
// Poro/Vi/Altar/Bandle/Viktor whole texts). Reusing the exact literals keeps the
// default suite on the same code branches as production while the *envelope*
// (ids, counts, unrelated printings) is small and synthetic.
//
// The Basic Rune allow-list inside the compiler is keyed by both printing id and
// the verified catalog version/digest, so those two envelope strings must equal
// the compiled constants for the rule-grant branch to run.

export const DATA_VERSION = '2026-10-12-official-gallery';
export const DIGEST = 'sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10';

export const GANKING_REMINDER_TEXT = '[Ganking] (I can move from battlefield to battlefield.)';
export const ENTER_READY_TEXT = 'I enter ready.';
export const VI_TEXT =
  'When you conquer, if you assigned 3 or more excess damage, you may exhaust me to ready a unit.';
export const PORO_TEXT = 'When I conquer, play a Gold gear token exhausted.';
export const ALTAR_TEXT = 'When you hold here, play a 1 :rb_might: Recruit unit token in your base.';
export const BANDLE_TEXT = 'You may hide an additional card here.';
export const VIKTOR_TEXT = ':rb_energy_1:, :rb_exhaust:: Play a 1 :rb_might: Recruit unit token.';

// Mirrors the compiler's verified Basic Rune identity table (see
// src/duel/official-programs.ts BASIC_RUNE_IDENTITIES). Ids and canonical card
// ids stay real-shaped because the rule grant is a per-printing allow-list.
const BASIC_RUNE_IDENTITIES = [
  { domain: 'Fury', ognNumber: '007', radNumber: '01', localizedName: '炽烈符文', canonicalCardId: 'card.hash-30497c69657abd1d3abf17f9b3766e7d064817473a88828ca2ef4ab9b51f7902' },
  { domain: 'Calm', ognNumber: '042', radNumber: '02', localizedName: '翠意符文', canonicalCardId: 'card.hash-efe5e5f4811f4089cd86b83cd6b8385613b0f469b2c2ae9f6b74a55ceb5cf0ed' },
  { domain: 'Mind', ognNumber: '089', radNumber: '03', localizedName: '灵光符文', canonicalCardId: 'card.hash-a8a4cb783649a0339782e2d3808d6144661c621634da7c9f79b4f87981fac97b' },
  { domain: 'Body', ognNumber: '126', radNumber: '04', localizedName: '摧破符文', canonicalCardId: 'card.hash-a2227b03e9e13c8e2ddae7a973c746cc4243ff631dfaf462dc9823e687bbbf17' },
  { domain: 'Chaos', ognNumber: '166', radNumber: '05', localizedName: '混沌符文', canonicalCardId: 'card.hash-055d9ad1c38fc05b800d053d3845209673f5397b39fb7bf76787adbc8cf42743' },
  { domain: 'Order', ognNumber: '214', radNumber: '06', localizedName: '序理符文', canonicalCardId: 'card.hash-e0efe08be77e60ed68f2e43ba425b763efd364eb44b0c760d26ef1fcc1b6df67' },
];

function runeCards() {
  const cards = [];
  for (const { domain, ognNumber, radNumber, localizedName, canonicalCardId } of BASIC_RUNE_IDENTITIES) {
    const variants = [
      ['ogn', `ogn-${ognNumber}-298`, `OGN-${ognNumber}/298`, 'standard', ''],
      ['ogn', `ogn-${ognNumber}a-298`, `OGN-${ognNumber}a/298`, 'alternate', ''],
      ['rad', `rad-r${radNumber}`, `RAD-R${radNumber}`, 'standard', ''],
      ['rad', `rad-r${radNumber}a`, `RAD-R${radNumber}a`, 'alternate', '[NO TEXT]'],
      ['ven', `ven-r${radNumber}`, `VEN-R${radNumber}`, 'standard', ''],
    ];
    for (const [setCode, id, cardNumber, variant, ability] of variants) {
      cards.push({
        id, cardType: 'Rune', ability, energy: null, power: null, might: null,
        domains: [domain], tags: ['Basic'], canonicalCardId,
        name: `${domain} Rune`, fullName: `${domain} Rune`, localizedName,
        setCode, cardNumber, variant,
      });
    }
  }
  return cards;
}

let seed = 0;
function card(id, cardType, ability, extra = {}) {
  seed += 1;
  const tag = String(seed).padStart(2, '0');
  return {
    id, cardType, ability,
    energy: extra.energy ?? null, power: extra.power ?? null, might: extra.might ?? null,
    domains: extra.domains ?? ['Colorless'], tags: extra.tags ?? [],
    canonicalCardId: extra.canonicalCardId ?? `card.syn-${tag}`,
    name: extra.name ?? `Syn ${id}`, fullName: extra.fullName ?? `Syn ${id}`,
    localizedName: extra.localizedName ?? '合成',
    setCode: extra.setCode ?? 'syn', cardNumber: extra.cardNumber ?? `SYN-${tag}`,
    variant: extra.variant ?? 'standard',
  };
}

export const TEMPLATE_CARDS = [
  card('syn-unit-static-both', 'Unit', `${GANKING_REMINDER_TEXT}\n${ENTER_READY_TEXT}`,
    { energy: 2, power: 0, might: 3, domains: ['Fury'], tags: ['Warrior'] }),
  card('syn-unit-static-ganking', 'Unit', GANKING_REMINDER_TEXT,
    { energy: 1, power: 0, might: 2, domains: ['Chaos'], tags: ['Warrior'] }),
  card('syn-unit-static-enter-ready', 'Unit', ENTER_READY_TEXT,
    { energy: 1, power: 0, might: 2, domains: ['Order'], tags: ['Warrior'] }),
  card('syn-unit-poro', 'Unit', PORO_TEXT,
    { energy: 1, power: 0, might: 2, domains: ['Chaos'], tags: ['Poro'], canonicalCardId: 'card.syn-poro' }),
  card('syn-unit-poro-alt', 'Unit', PORO_TEXT,
    { energy: 1, power: 0, might: 2, domains: ['Chaos'], tags: ['Poro'], canonicalCardId: 'card.syn-poro',
      setCode: 'syn2', cardNumber: 'SYN-PORO-2' }),
  card('syn-unit-printed-empty', 'Unit', '',
    { energy: 3, power: 0, might: 4, domains: ['Fury'], tags: ['Warrior'] }),
  card('syn-unit-recruit-empty', 'Unit', '',
    { energy: null, power: null, might: 1, domains: ['Colorless'], tags: ['Recruit', 'Token'] }),
  card('syn-legend-vi', 'Legend', VI_TEXT,
    { domains: ['Fury', 'Order'], tags: ['Vi'] }),
  card('syn-legend-viktor', 'Legend', VIKTOR_TEXT,
    { domains: ['Order'], tags: ['Viktor'] }),
  card('syn-battlefield-altar', 'Battlefield', ALTAR_TEXT,
    { domains: ['Order'], tags: ['Altar'] }),
  card('syn-battlefield-hide', 'Battlefield', BANDLE_TEXT,
    { domains: ['Calm'], tags: ['Tree'] }),
  card('syn-unit-partial', 'Unit', `${GANKING_REMINDER_TEXT}\nExtra body text.`,
    { energy: 2, power: 0, might: 2, domains: ['Fury'], tags: ['Warrior'] }),
  card('syn-unit-ganking-bare', 'Unit', 'Ganking (I can move from battlefield to battlefield.)',
    { energy: 2, power: 0, might: 2, domains: ['Fury'], tags: ['Warrior'] }),
  card('syn-spell-unknown', 'Spell', 'Deal 1 damage to a unit.',
    { domains: ['Fury'], tags: ['Spell'] }),
  card('syn-spell-empty', 'Spell', '',
    { domains: ['Fury'], tags: ['Spell'] }),
  card('syn-spell-ganking', 'Spell', GANKING_REMINDER_TEXT,
    { domains: ['Fury'], tags: ['Spell'] }),
  card('syn-legend-grant-ganking', 'Legend', ':rb_exhaust:: Give a unit [Ganking] this turn.',
    { domains: ['Order'], tags: ['Legend'] }),
];

export const CARDS = [...runeCards(), ...TEMPLATE_CARDS];

/** Strict catalog envelope accepted by `duelAbilitySourceFromCatalog`. */
export const CATALOG = Object.freeze({
  schemaVersion: 1,
  dataVersion: DATA_VERSION,
  digest: DIGEST,
  cards: CARDS,
  groups: [],
});

export const cardById = (id) => CARDS.find((entry) => entry.id === id);

// Fixture census used by the default assertions (kept explicit so a silent
// fixture edit that changes the expected counts fails loudly).
export const RUNE_IDS = runeCards().map((entry) => entry.id);
export const RESOLVED_IDS = [
  ...RUNE_IDS,
  'syn-unit-static-both', 'syn-unit-static-ganking', 'syn-unit-static-enter-ready',
  'syn-unit-poro', 'syn-unit-poro-alt', 'syn-unit-printed-empty', 'syn-unit-recruit-empty',
  'syn-legend-vi', 'syn-legend-viktor', 'syn-battlefield-altar', 'syn-battlefield-hide',
];
export const UNKNOWN_IDS = [
  'syn-unit-partial', 'syn-unit-ganking-bare', 'syn-spell-unknown', 'syn-spell-empty',
  'syn-spell-ganking', 'syn-legend-grant-ganking',
];
export const CENSUS = Object.freeze({
  size: CARDS.length,
  known: RESOLVED_IDS.length,
  unknown: UNKNOWN_IDS.length,
  runes: RUNE_IDS.length,
});
