// Focused default (clean-checkout) suite for the pure-DATA `equip-description-v1`
// recogniser.
//
// These cases build COMPLETE inline synthetic printing tuples whose ability text,
// stats, domains, tags and identity are the REAL deck-catalog 2026-10-12 values
// for all 28 pure-[Equip] printings (the values are DATA copied from the catalog;
// they are NOT game execution). A required real-catalog census checks every printing.
// RIFTBOUND_EQUIP_CATALOG may explicitly select the input file.
//
// The recogniser returns DATA only: it is not an authority, it never grants a
// right to pay a cost or attach anything, it is never registered in the
// official-program registry, and its result carries no capability.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const moduleSpecifier =
  process.env.DUEL_EQUIP_DESCRIPTION_MODULE ?? '../../dist/duel/equip-description-v1.js';
const {
  DUEL_EQUIP_DESCRIPTION_V1_KIND,
  DUEL_EQUIP_RUNE_DOMAINS,
  describeDuelEquipV1,
  duelEquipSourceFingerprintMaterial,
} = await import(moduleSpecifier);

const DATA_VERSION = '2026-10-15-official-gallery';
const DIGEST = 'sha256:e9635b38044140375c33d9e5d8e12c1c2386994dfaa9ae8ae6832a127ff9f73d';
const ENVELOPE = { dataVersion: DATA_VERSION, catalogDigest: DIGEST };

// The 28 real pure-[Equip] printings (12 distinct whole-ability texts). Values
// copied verbatim from packages/card-data/data/deck-catalog.json: DATA, not a
// claim of executable behaviour.
const REAL_EQUIP_PRINTINGS = [
  { id: "rad-150-167", canonicalCardId: "card.hash-d127ec787d0c328ab80a9aa29a656cd77a9dda6050627ec1bad17db1942c9853", energy: 3, power: 1, might: 3, domains: ["Calm","Chaos"], tags: ["Equipment","Riven","Signature"], fullName: "Blade of the Exile", ability: "[Equip] — :rb_rune_rainbow: or exhaust a friendly unit. (Pay the cost: Attach this to a unit you control.)" },
  { id: "sfd-009-221", canonicalCardId: "card.hash-2d46595233b37a0868857eab035ad4fa4dc53fc8c932d35ad32cca2c54ff06d2", energy: 1, power: null, might: 0, domains: ["Fury"], tags: ["Equipment"], fullName: "Serrated Dirk", ability: "[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)" },
  { id: "sfd-016-221", canonicalCardId: "card.hash-553d60be98d221dc71d4e71eb6ae5938143fa0c4b71e6e96d27d8570521d36eb", energy: 2, power: null, might: 0, domains: ["Fury"], tags: ["Equipment"], fullName: "Recurve Bow", ability: "[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)" },
  { id: "sfd-030-221", canonicalCardId: "card.hash-63dae663a2ca549dc4704d2814cdc3b2eea4a26845d09029e88d2c8df6ee0013", energy: 3, power: null, might: 2, domains: ["Fury"], tags: ["Equipment"], fullName: "Skyfall of Areion", ability: "[Equip] :rb_energy_1::rb_rune_fury: (:rb_energy_1::rb_rune_fury:: Attach this to a unit you control.)" },
  { id: "sfd-033-221", canonicalCardId: "card.hash-6ef5f0dfecb89d68422cd4fa23ea64d155ef384d03c974ea67ff920203e89a46", energy: 1, power: null, might: 1, domains: ["Calm"], tags: ["Equipment"], fullName: "Doran's Shield", ability: "[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)" },
  { id: "sfd-042-221", canonicalCardId: "card.hash-d5460ff7a266a84e1d15b39abe9c2fab99ba81b021a0b01c90e649cc36071665", energy: 2, power: null, might: 1, domains: ["Calm"], tags: ["Equipment"], fullName: "Brutalizer", ability: "[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)" },
  { id: "sfd-051-221", canonicalCardId: "card.hash-af3547abb5e6d69c2372b62331d6039acaf16cca337eefb27e5734bbee3fb307", energy: 2, power: null, might: 1, domains: ["Calm"], tags: ["Equipment"], fullName: "Guardian Angel", ability: "[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)" },
  { id: "sfd-073-221", canonicalCardId: "card.hash-f9773189acce6bbb236b5fe609b108079a3b1b13064783ef685543fb56e8e969", energy: 1, power: null, might: 1, domains: ["Mind"], tags: ["Equipment"], fullName: "Experimental Hexplate", ability: "[Equip] :rb_rune_mind: (:rb_rune_mind:: Attach this to a unit you control.)" },
  { id: "sfd-086-221", canonicalCardId: "card.hash-2d067a6d3e2dbc9738ed7868ad7bea2727fdc69a8074c639e913e6360798d27c", energy: 3, power: null, might: 2, domains: ["Mind"], tags: ["Equipment"], fullName: "World Atlas", ability: "[Equip] :rb_rune_mind: (:rb_rune_mind:: Attach this to a unit you control.)" },
  { id: "sfd-095-221", canonicalCardId: "card.hash-a1ee07f71d453092ab7d54f9491684e972b735b22bb1f3fda73f2641bcedbfe1", energy: 2, power: null, might: 2, domains: ["Body"], tags: ["Equipment"], fullName: "Doran's Blade", ability: "[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)" },
  { id: "sfd-102-221", canonicalCardId: "card.hash-655981631747696ba307a61ac6067d55653bb1215a56106697946c14c7da3146", energy: 2, power: null, might: 1, domains: ["Body"], tags: ["Equipment"], fullName: "Hexdrinker", ability: "[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)" },
  { id: "sfd-108-221", canonicalCardId: "card.hash-902c6a1366a1a0e653ccb65102ff621b109af3b0b40f5bbeb7d8d3a5aeae2322", energy: 1, power: null, might: 1, domains: ["Body"], tags: ["Equipment"], fullName: "Warmog's Armor", ability: "[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)" },
  { id: "sfd-115-221", canonicalCardId: "card.hash-e6073f232b1dbf7483b03684f042e36bd6c5692386fa16bce43630d890454681", energy: 4, power: null, might: 2, domains: ["Body"], tags: ["Equipment"], fullName: "Trinity Force", ability: "[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)" },
  { id: "sfd-118-221", canonicalCardId: "card.hash-fafaf203c1a2733970ae4f8f4051d2c1b16da75c5e2e637905f8fce0d6287a75", energy: 3, power: null, might: 2, domains: ["Body"], tags: ["Equipment"], fullName: "Boneshiver", ability: "[Equip] :rb_energy_1::rb_rune_body: (:rb_energy_1::rb_rune_body:: Attach this to a unit you control.)" },
  { id: "sfd-124-221", canonicalCardId: "card.hash-7cdb3acf3498b65e29a03912deb195f448b78a9da466c922703fc4edda7a0512", energy: 1, power: null, might: 1, domains: ["Chaos"], tags: ["Equipment"], fullName: "Doran's Ring", ability: "[Equip] :rb_rune_chaos: (:rb_rune_chaos:: Attach this to a unit you control.)" },
  { id: "sfd-133-221", canonicalCardId: "card.hash-a22e6e418137f242aaa2ac6403b7a752bfc243cecc9d372bc3dfc04dabced9e0", energy: 3, power: null, might: 2, domains: ["Chaos"], tags: ["Equipment"], fullName: "Boots of Swiftness", ability: "[Equip] :rb_rune_chaos: (:rb_rune_chaos:: Attach this to a unit you control.)" },
  { id: "sfd-134-221", canonicalCardId: "card.hash-bb1fcaa45b988af1dbf230e70a71fec0ff63d89d772cedb858639514745d573d", energy: 1, power: null, might: 1, domains: ["Chaos"], tags: ["Equipment"], fullName: "Cull", ability: "[Equip] :rb_rune_chaos: (:rb_rune_chaos:: Attach this to a unit you control.)" },
  { id: "sfd-150-221", canonicalCardId: "card.hash-a94953e6e26ed3d9751a4dd5e4674a587232a894999224e5ce566be1f0895d89", energy: 3, power: null, might: 2, domains: ["Chaos"], tags: ["Equipment"], fullName: "Last Rites", ability: "[Equip] — :rb_rune_chaos:, Recycle 2 cards from your trash (Pay the cost: Attach this to a unit you control.)" },
  { id: "sfd-153-221", canonicalCardId: "card.hash-67da502bedfc109e81093202c4a30a43cf37ca8aada9f1460b33bee5c979fdae", energy: 1, power: null, might: 0, domains: ["Order"], tags: ["Equipment"], fullName: "Eye of the Herald", ability: "[Equip] :rb_rune_order: (:rb_rune_order:: Attach this to a unit you control.)" },
  { id: "sfd-161-221", canonicalCardId: "card.hash-959c19d68f06f8f929625bfde93a1132701da5a5d0b49e91583db341384f0bfe", energy: 4, power: null, might: 3, domains: ["Order"], tags: ["Equipment"], fullName: "B.F. Sword", ability: "[Equip] :rb_rune_order: (:rb_rune_order:: Attach this to a unit you control.)" },
  { id: "sfd-172-221", canonicalCardId: "card.hash-d3579e6825470471f5ce05c53533806a5244c5e84364fe57b2aab0b7cc0f14e0", energy: 2, power: 1, might: 1, domains: ["Order"], tags: ["Equipment"], fullName: "Sacred Shears", ability: "[Equip] :rb_rune_order: (:rb_rune_order:: Attach this to a unit you control.)" },
  { id: "sfd-178-221", canonicalCardId: "card.hash-f9c6d6052ec4552cfcfc53a0e584e07cb232189ed89b277126630202cc188050", energy: 3, power: 1, might: 4, domains: ["Order"], tags: ["Equipment"], fullName: "Blade of the Ruined King", ability: "[Equip] — :rb_rune_order:, Kill a friendly unit (Pay the cost: Attach this to a unit you control.)" },
  { id: "unl-019-219", canonicalCardId: "card.hash-21de7fcaef3e38ea7173a7b6b370c00cc4d0e2893c34cafde3a98ee7b65ac558", energy: 4, power: null, might: 4, domains: ["Fury"], tags: ["Equipment"], fullName: "Blighted Battleaxe", ability: "[Equip] :rb_energy_1::rb_rune_fury: (:rb_energy_1::rb_rune_fury:: Attach this to a unit you control.)" },
  { id: "unl-039-219", canonicalCardId: "card.hash-87e2eedcbebff6711e1c1841d161efbe5d63d047836446fb4ececd034911f1be", energy: 1, power: null, might: 1, domains: ["Calm"], tags: ["Equipment"], fullName: "Soul Sword", ability: "[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)" },
  { id: "unl-096-219", canonicalCardId: "card.hash-d2580c0f7a993eb938c0e656fc955d9a10d34e35758dbfed9502de2a75828f9d", energy: 3, power: null, might: 2, domains: ["Body"], tags: ["Equipment"], fullName: "Hunter's Machete", ability: "[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)" },
  { id: "unl-188-219", canonicalCardId: "card.hash-955bd858659e4d3eb8edfd20347a7496c51932de05cafd32fc71d86d94f96e47", energy: 3, power: null, might: 3, domains: ["Fury","Order"], tags: ["Vi","Equipment","Signature"], fullName: "Hextech Gauntlets", ability: "[Equip] :rb_energy_3::rb_rune_rainbow:. This ability's Energy cost is reduced by the Might of the unit you choose. (Pay the cost: Attach this to a unit you control.)" },
  { id: "ven-011-166", canonicalCardId: "card.hash-cf2885ca18787660c4888723a93f4322d32c6a6fcb218d79e11353307fbbe53c", energy: 3, power: null, might: 1, domains: ["Fury"], tags: ["Equipment"], fullName: "Pendulum Blade", ability: "[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)" },
  { id: "ven-027-166", canonicalCardId: "card.hash-e38beb4c962c62133ef5050acc2896b4578a668939323e65af883d81c8ada753", energy: 2, power: null, might: 1, domains: ["Calm"], tags: ["Equipment"], fullName: "Hand Hammer", ability: "[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)" },
];

// The 12 distinct whole-ability texts, in first-seen order.
const DISTINCT_TEXTS = [...new Set(REAL_EQUIP_PRINTINGS.map((row) => row.ability))];

// Complete synthetic printing tuple with every DuelSourcePrintingCard field.
const synGear = (id, ability, extra = {}) => ({
  id,
  cardType: extra.cardType ?? 'Gear',
  ability,
  energy: 'energy' in extra ? extra.energy : 2,
  power: 'power' in extra ? extra.power : null,
  might: 'might' in extra ? extra.might : 2,
  domains: extra.domains ?? ['Fury'],
  tags: extra.tags ?? ['Equipment'],
  canonicalCardId: extra.canonicalCardId ?? `card.syn-${id}`,
  name: extra.name ?? `Syn ${id}`,
  fullName: extra.fullName ?? `Syn ${id}`,
  localizedName: extra.localizedName ?? '合成',
  setCode: extra.setCode ?? 'syn',
  cardNumber: extra.cardNumber ?? `SYN-${id}`,
  variant: extra.variant ?? 'standard',
});

const asTuple = (row) => ({
  id: row.id,
  cardType: 'Gear',
  ability: row.ability,
  energy: row.energy,
  power: row.power,
  might: row.might,
  domains: [...row.domains],
  tags: [...row.tags],
  canonicalCardId: row.canonicalCardId,
  name: row.fullName,
  fullName: row.fullName,
  localizedName: '本地化',
  setCode: row.id.split('-')[0],
  cardNumber: row.id,
  variant: 'standard',
});

const KNOWN_KEYS = [
  'canonicalCardId', 'cardId', 'catalogDigest', 'dataVersion', 'kind', 'semantics',
  'source', 'sourceFingerprint', 'status',
];
const UNKNOWN_KEYS = ['canonicalCardId', 'cardId', 'kind', 'normalizedAbilityText', 'reason', 'status'];

const CALM = '[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)';
const PURE_TEXT = REAL_EQUIP_PRINTINGS[0].ability;

test('kind and the six Rune domains are fixed and frozen', () => {
  assert.equal(DUEL_EQUIP_DESCRIPTION_V1_KIND, 'equip-description-v1');
  assert.deepEqual([...DUEL_EQUIP_RUNE_DOMAINS], ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order']);
  assert.ok(Object.isFrozen(DUEL_EQUIP_RUNE_DOMAINS));
  assert.ok(!DUEL_EQUIP_RUNE_DOMAINS.includes('Colorless'));
});

test('the 28 real pure-[Equip] printings collapse to exactly 12 distinct whole-ability texts', () => {
  assert.equal(REAL_EQUIP_PRINTINGS.length, 28);
  assert.equal(DISTINCT_TEXTS.length, 12);
  assert.equal(new Set(REAL_EQUIP_PRINTINGS.map((row) => row.canonicalCardId)).size, 28);
});

test('every real pure-[Equip] printing is recognised as known and binds its own identity', () => {
  for (const row of REAL_EQUIP_PRINTINGS) {
    const result = describeDuelEquipV1(asTuple(row), ENVELOPE);
    assert.equal(result.status, 'known', row.id + ' should be known');
    assert.equal(result.kind, 'equip-description-v1');
    assert.equal(result.cardId, row.id);
    assert.equal(result.canonicalCardId, row.canonicalCardId);
    assert.equal(result.dataVersion, DATA_VERSION);
    assert.equal(result.catalogDigest, DIGEST);
    assert.equal(result.source.normalizedAbilityText, row.ability);
    assert.equal(result.source.cardType, 'Gear');
    assert.equal(result.source.might, row.might);
    assert.deepEqual([...result.source.domains], row.domains);
    assert.equal(result.semantics.kind, 'equip');
    assert.equal(result.semantics.abilityClass, 'activated-ability');
    assert.equal(result.semantics.cost.literal, row.ability);
    assert.equal(result.semantics.attachTarget, 'unknown');
    assert.equal(result.semantics.timing, 'unknown');
    assert.match(result.sourceFingerprint, /^sha256:[a-f0-9]{64}$/u);
  }
});

test('alt-art / multi-set printings of the same whole text bind distinct identities', () => {
  const calm = REAL_EQUIP_PRINTINGS.filter((row) => row.ability === CALM);
  assert.equal(calm.length, 5);
  const fingerprints = new Set(calm.map((row) => describeDuelEquipV1(asTuple(row), ENVELOPE).sourceFingerprint));
  const canonicals = new Set(calm.map((row) => row.canonicalCardId));
  // Same text, distinct printing identity => distinct canonical ids and fingerprints.
  assert.equal(canonicals.size, 5);
  assert.equal(fingerprints.size, 5);
});

test('the printed Equip cost distinguishes energy, specific-domain power and any-domain power', () => {
  const byId = new Map(REAL_EQUIP_PRINTINGS.map((row) => [row.id, row]));
  const bodyEnergy = describeDuelEquipV1(asTuple(byId.get('sfd-118-221')), ENVELOPE).semantics.cost;
  assert.deepEqual(bodyEnergy.power, { kind: 'specific-domain', domain: 'Body' });
  assert.equal(bodyEnergy.energy, 1);

  const calmCost = describeDuelEquipV1(asTuple(byId.get('sfd-033-221')), ENVELOPE).semantics.cost;
  assert.deepEqual(calmCost.power, { kind: 'specific-domain', domain: 'Calm' });
  assert.equal(calmCost.energy, 0);

  const exile = describeDuelEquipV1(asTuple(byId.get('rad-150-167')), ENVELOPE).semantics.cost;
  assert.deepEqual(exile.power, { kind: 'any-domain' });
  assert.equal(exile.nonResourceLiteral, 'exhaust a friendly unit');
  assert.equal(exile.energy, 0);

  const lastRites = describeDuelEquipV1(asTuple(byId.get('sfd-150-221')), ENVELOPE).semantics.cost;
  assert.equal(lastRites.nonResourceLiteral, 'Recycle 2 cards from your trash');

  const ruinedKing = describeDuelEquipV1(asTuple(byId.get('sfd-178-221')), ENVELOPE).semantics.cost;
  assert.equal(ruinedKing.nonResourceLiteral, 'Kill a friendly unit');
});

test('the printed CardPlay energy is carried SEPARATELY and never merged into the Equip cost', () => {
  const byId = new Map(REAL_EQUIP_PRINTINGS.map((row) => [row.id, row]));
  const boneshiver = byId.get('sfd-118-221'); // printed CardPlay energy 3, Equip cost 1B
  const result = describeDuelEquipV1(asTuple(boneshiver), ENVELOPE);
  assert.equal(result.source.energy, 3);
  assert.equal(result.semantics.cost.energy, 1);
  // The printed base energy is source metadata; the Equip cost is the ability cost.
  assert.notEqual(result.source.energy, result.semantics.cost.energy);
});

test('the cost-altered Hextech Gauntlets line is recognised as DATA with its alteration recorded', () => {
  const byId = new Map(REAL_EQUIP_PRINTINGS.map((row) => [row.id, row]));
  const result = describeDuelEquipV1(asTuple(byId.get('unl-188-219')), ENVELOPE);
  assert.equal(result.status, 'known');
  assert.equal(result.semantics.cost.energy, 3);
  assert.deepEqual(result.semantics.cost.power, { kind: 'any-domain' });
  assert.deepEqual(result.semantics.costAlterations, [
    "This ability's Energy cost is reduced by the Might of the unit you choose.",
  ]);
  // The alteration is recorded verbatim, never applied.
  assert.equal(result.semantics.costAlterations.length, 1);
});

test('the reminder form backend differs between cost-colon and pay-the-cost-colon wording', () => {
  const byId = new Map(REAL_EQUIP_PRINTINGS.map((row) => [row.id, row]));
  assert.equal(describeDuelEquipV1(asTuple(byId.get('sfd-033-221')), ENVELOPE).semantics.reminderForm, 'cost-colon');
  assert.equal(describeDuelEquipV1(asTuple(byId.get('rad-150-167')), ENVELOPE).semantics.reminderForm, 'pay-the-cost-colon');
});

test('results are deeply frozen and the input tuple is never mutated', () => {
  const row = REAL_EQUIP_PRINTINGS.find((item) => item.id === 'sfd-033-221');
  const tuple = asTuple(row);
  const before = JSON.stringify(tuple);
  const result = describeDuelEquipV1(tuple, ENVELOPE);
  assert.equal(JSON.stringify(tuple), before, 'input tuple must not be mutated');
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.source));
  assert.ok(Object.isFrozen(result.source.domains));
  assert.ok(Object.isFrozen(result.semantics));
  assert.ok(Object.isFrozen(result.semantics.cost));
  assert.ok(Object.isFrozen(result.semantics.cost.power));
  assert.ok(Object.isFrozen(result.semantics.costAlterations));
  assert.throws(() => {
    'use strict';
    result.semantics.cost.energy = 99;
  }, TypeError);
});

test('a clone with the same source values describes identically; the fingerprint is source-stable', () => {
  const row = REAL_EQUIP_PRINTINGS.find((item) => item.id === 'sfd-095-221');
  const tuple = asTuple(row);
  const clone = { ...tuple, domains: [...tuple.domains], tags: [...tuple.tags] };
  assert.deepEqual(describeDuelEquipV1(clone, ENVELOPE), describeDuelEquipV1(tuple, ENVELOPE));
  assert.equal(
    describeDuelEquipV1(tuple, ENVELOPE).sourceFingerprint,
    describeDuelEquipV1(clone, { ...ENVELOPE }).sourceFingerprint,
  );
});

test('a known or unknown result is DATA only: no capability fields, no executable reference', () => {
  const row = REAL_EQUIP_PRINTINGS.find((item) => item.id === 'sfd-033-221');
  const known = describeDuelEquipV1(asTuple(row), ENVELOPE);
  const unknown = describeDuelEquipV1(synGear('syn-tail', PURE_TEXT + '\nUnknown trailing.'), ENVELOPE);
  for (const result of [known, unknown]) {
    const keys = Object.keys(result);
    for (const forbidden of [
      'privateUID', 'epoch', 'mintReceipt', 'sourceProof', 'authority', 'encoded',
      'reference', 'program', 'sourceProgramComplete', 'permission', 'attach',
    ]) {
      assert.ok(!keys.includes(forbidden), 'result must not carry ' + forbidden);
    }
  }
  assert.deepEqual(Object.keys(known).sort(), KNOWN_KEYS);
  assert.deepEqual(Object.keys(unknown).sort(), UNKNOWN_KEYS);
});

test('a non-Gear card is rejected as not-gear', () => {
  const result = describeDuelEquipV1(synGear('syn-unit', PURE_TEXT, { cardType: 'Unit', tags: ['Equipment'] }), ENVELOPE);
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'not-gear');
});

test('a Gear whose tags omit Equipment is rejected as not-equipment-tag', () => {
  const result = describeDuelEquipV1(synGear('syn-no-tag', PURE_TEXT, { tags: ['Gear'] }), ENVELOPE);
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'not-equipment-tag');
});

test('a pure [Equip] gear with non-numeric energy or might is rejected as non-numeric-source-stat', () => {
  const noEnergy = describeDuelEquipV1(synGear('syn-no-energy', PURE_TEXT, { energy: null }), ENVELOPE);
  assert.equal(noEnergy.status, 'unknown');
  assert.equal(noEnergy.reason, 'non-numeric-source-stat');
  const noMight = describeDuelEquipV1(synGear('syn-no-might', PURE_TEXT, { might: null }), ENVELOPE);
  assert.equal(noMight.status, 'unknown');
  assert.equal(noMight.reason, 'non-numeric-source-stat');
});

test('a rune-symbol / domain mismatch is rejected, not silently accepted', () => {
  const row = REAL_EQUIP_PRINTINGS.find((item) => item.id === 'sfd-033-221'); // Calm symbol
  const wrongDomain = { ...asTuple(row), domains: ['Fury'] };
  const result = describeDuelEquipV1(wrongDomain, ENVELOPE);
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'equip-rune-symbol-domain-mismatch');
  const colorless = { ...asTuple(row), domains: ['Colorless'] };
  assert.equal(describeDuelEquipV1(colorless, ENVELOPE).reason, 'equip-rune-symbol-domain-mismatch');
});

test('a trailing unknown sentence is never swallowed: whole-text equality only', () => {
  const tail = describeDuelEquipV1(synGear('syn-tail-2', PURE_TEXT + '\nDeal 1.'), ENVELOPE);
  assert.equal(tail.status, 'unknown');
  assert.equal(tail.reason, 'ability-not-pure-equip');
  const prefix = describeDuelEquipV1(synGear('syn-prefix', 'Equip this to a unit. ' + PURE_TEXT), ENVELOPE);
  assert.equal(prefix.status, 'unknown');
  assert.equal(prefix.reason, 'ability-not-pure-equip');
});

test('known composite real printings stay UNKNOWN (no prefix match, no truncation)', () => {
  const cases = [
    ['sfd-059-221', '[Equip] :rb_energy_1::rb_rune_calm: (:rb_energy_1::rb_rune_calm:: Attach this to a unit you control.)\nAs this is attached to a unit, copy that unit text.'],
    ['sfd-022-221', '[Quick-Draw] (This has [Reaction]. When you play it, attach it to a unit you control.)\n[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)'],
    ['unl-158-219', "When you play this, gain 1 XP.\n[Equip] — Spend 1 XP (Pay the cost: Attach this to a unit you control.)"],
    ['ven-137-166', '[Equip] :rb_energy_1::rb_rune_order: (:rb_energy_1::rb_rune_order:: Attach this to a unit you control.)\nAs this is attached to a unit, choose another friendly unit.'],
    ['sfd-002-221', '[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it already attached.)'],
  ];
  for (const [id, ability] of cases) {
    const result = describeDuelEquipV1(synGear(id, ability, { cardType: id === 'sfd-002-221' ? 'Unit' : 'Gear' }), ENVELOPE);
    assert.equal(result.status, 'unknown', id + ' must stay unknown');
    assert.ok(
      result.reason === 'not-gear' || result.reason === 'ability-not-pure-equip' || result.reason === 'not-equipment-tag',
      id + ' reason ' + result.reason,
    );
  }
});

test('a malformed (sparse) domains array, symbol key, accessor or missing field is rejected', () => {
  let invoked = 0;
  const withGetter = synGear('syn-getter', PURE_TEXT);
  Object.defineProperty(withGetter, 'id', { get() { invoked += 1; return 'syn-getter'; }, enumerable: true, configurable: true });
  assert.throws(() => describeDuelEquipV1(withGetter, ENVELOPE), TypeError);
  assert.equal(invoked, 0, 'accessor must never be invoked');

  const withSymbol = synGear('syn-symbol', PURE_TEXT);
  withSymbol[Symbol('x')] = 1;
  assert.throws(() => describeDuelEquipV1(withSymbol, ENVELOPE), TypeError);

  const sparse = synGear('syn-sparse', PURE_TEXT);
  sparse.domains = ['Calm'];
  delete sparse.domains[0];
  sparse.domains.length = 1;
  assert.throws(() => describeDuelEquipV1(sparse, ENVELOPE), TypeError);

  const missing = synGear('syn-missing', PURE_TEXT);
  delete missing.tags;
  assert.throws(() => describeDuelEquipV1(missing, ENVELOPE), TypeError);

  const exotic = synGear('syn-exotic', PURE_TEXT);
  Object.setPrototypeOf(exotic, { hacked: true });
  assert.throws(() => describeDuelEquipV1(exotic, ENVELOPE), TypeError);
});

test('a malformed numeric stat (negative, non-integer, non-number) is rejected', () => {
  assert.throws(() => describeDuelEquipV1(synGear('syn-neg', PURE_TEXT, { energy: -1 }), ENVELOPE), TypeError);
  assert.throws(() => describeDuelEquipV1(synGear('syn-frac', PURE_TEXT, { might: 1.5 }), ENVELOPE), TypeError);
  assert.throws(() => describeDuelEquipV1(synGear('syn-str', PURE_TEXT, { energy: '2' }), ENVELOPE), TypeError);
});

test('extra enumerable DATA fields (e.g. imageUrl) are tolerated and never read as semantics', () => {
  const row = REAL_EQUIP_PRINTINGS.find((item) => item.id === 'sfd-033-221');
  const withExtra = { ...asTuple(row), imageUrl: 'https://example.invalid/x.png' };
  const result = describeDuelEquipV1(withExtra, ENVELOPE);
  assert.equal(result.status, 'known');
  assert.deepEqual(Object.keys(result).sort(), KNOWN_KEYS);
});

test('the caller cannot inject a fingerprint or envelope authority: it is recomputed from source', () => {
  const row = REAL_EQUIP_PRINTINGS.find((item) => item.id === 'sfd-033-221');
  const tuple = { ...asTuple(row), sourceFingerprint: 'sha256:' + 'f'.repeat(64), dataVersion: 'forged', catalogDigest: 'forged' };
  const result = describeDuelEquipV1(tuple, ENVELOPE);
  assert.equal(result.status, 'known');
  assert.notEqual(result.sourceFingerprint, 'sha256:' + 'f'.repeat(64));
  assert.equal(result.dataVersion, DATA_VERSION);
  assert.equal(result.catalogDigest, DIGEST);
  // The source-level fingerprint is derived from the printed tuple, not the caller.
  const material = duelEquipSourceFingerprintMaterial(asTuple(row), ENVELOPE);
  assert.equal(result.sourceFingerprint, 'sha256:' + createHash('sha256').update(material, 'utf8').digest('hex'));
});

test('the add-a-field envelope is source-stamped: absent envelope yields null metadata and a distinct fingerprint', () => {
  const row = REAL_EQUIP_PRINTINGS.find((item) => item.id === 'sfd-033-221');
  const withEnv = describeDuelEquipV1(asTuple(row), ENVELOPE);
  const withoutEnv = describeDuelEquipV1(asTuple(row));
  assert.equal(withoutEnv.status, 'known');
  assert.equal(withoutEnv.dataVersion, null);
  assert.equal(withoutEnv.catalogDigest, null);
  assert.notEqual(withoutEnv.sourceFingerprint, withEnv.sourceFingerprint);
});

test('the recogniser is never registered in the official-program registry', async () => {
  const programsSpecifier =
    process.env.DUEL_OFFICIAL_PROGRAMS_MODULE ?? '../../dist/duel/official-programs.js';
  const mod = await import(programsSpecifier);
  for (const name of Object.keys(mod)) {
    assert.ok(!/equip-description/u.test(name), 'registry export ' + name + ' must not exist');
  }
});

// Required real-catalog DATA census; missing input fails, never implies execution.
const catalogPath = process.env.RIFTBOUND_EQUIP_CATALOG ??
  new URL('../../../card-data/data/deck-catalog.json', import.meta.url);
{
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  test('real catalog: exactly the 28 pure-[Equip] printings are known; every composite stays unknown', () => {
    const catalogEnvelope = { dataVersion: catalog.dataVersion, catalogDigest: catalog.digest };
    const pureTexts = new Set(DISTINCT_TEXTS);
    let pureKnown = 0;
    let compositeUnknown = 0;
    for (const card of catalog.cards) {
      const result = describeDuelEquipV1({
        id: card.id, cardType: card.cardType, ability: card.ability, energy: card.energy,
        power: card.power, might: card.might, domains: card.domains, tags: card.tags,
        canonicalCardId: card.canonicalCardId, name: card.name, fullName: card.fullName,
        localizedName: card.localizedName, setCode: card.setCode, cardNumber: card.cardNumber,
        variant: card.variant,
      }, catalogEnvelope);
      const isPure = typeof card.ability === 'string' && pureTexts.has(card.ability);
      if (isPure) {
        assert.equal(result.status, 'known', card.id + ' pure printing must be known');
        pureKnown += 1;
      } else if (result.status === 'known') {
        assert.fail('non-pure printing ' + card.id + ' must not be known');
      } else if (typeof card.ability === 'string' && card.ability.includes('[Equip]')) {
        compositeUnknown += 1;
      }
    }
    assert.equal(pureKnown, 28);
    assert.ok(compositeUnknown >= 20, 'composite [Equip] printings must stay unknown');
  });
}
