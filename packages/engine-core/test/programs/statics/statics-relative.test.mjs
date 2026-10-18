import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, createProgramBinding, cardProgramsById } from '../helpers.mjs';
import { staticFilter, layerFor } from '../../../dist/programs/statics.js';
import { ProgramBindingError } from '../../../dist/programs/errors.js';

const BF1 = { type: 'battlefield', id: 'battlefield-1' };
const BF2 = { type: 'battlefield', id: 'battlefield-2' };
const card = (canonicalCardId, abilities) => ({
  canonicalCardId,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: canonicalCardId,
  abilities,
});

function executableView(canonicalCardId) {
  const program = cardProgramsById.get(canonicalCardId);
  assert.equal(program.status, 'judge-required', `expected ${canonicalCardId} to stay judge-required in source data`);
  return { ...program, status: 'executable', judgeReason: undefined };
}

function sourceSnapshot(overrides = {}) {
  return {
    ref: { id: 'host', zoneEntryId: 1 },
    cardId: 'card.host',
    name: 'Host',
    types: ['unit'],
    tags: [],
    keywords: [],
    owner: 'A',
    controller: 'A',
    zone: 'board',
    location: BF1,
    might: 2,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
    ...overrides,
  };
}

function board(f, id, location = BF1) {
  f.engine.commit({ type: 'move-zone', object: f.kernel.ref(id), to: 'battlefield', location });
}

test('staticFilter resolves controller/you/caster/self to the binding-time controller', () => {
  const source = sourceSnapshot();
  assert.deepEqual(staticFilter({ filter: { controller: 'controller' } }, source), { controller: 'A' });
  assert.deepEqual(staticFilter({ filter: { controller: 'you' } }, source), { controller: 'A' });
  assert.deepEqual(staticFilter({ filter: { owner: 'caster' } }, source), { owner: 'A' });
  assert.deepEqual(staticFilter({ filter: { controller: 'self' } }, source), { controller: 'A' });
  const stolen = sourceSnapshot({ controller: 'B' });
  assert.deepEqual(staticFilter({ filter: { controller: 'controller' } }, stolen), { controller: 'B' });
});

test('staticFilter fails closed for unsupported relative fields and player anchors', () => {
  const source = sourceSnapshot();
  assert.throws(
    () => staticFilter({ filter: { controller: 'opponent' } }, source),
    error => error instanceof ProgramBindingError && error.code === 'judge-required',
    'controller:opponent needs a relative-player query',
  );
  assert.throws(
    () => staticFilter({ filter: { owner: 'their' } }, source),
    error => error.code === 'judge-required',
  );
  assert.throws(
    () => staticFilter({ filter: { sameLocationAs: 'enemy-base' } }, source),
    error => error.code === 'judge-required',
    'sameLocationAs only accepts self/source',
  );
  assert.throws(
    () => staticFilter({ filter: { other: 'yes' } }, source),
    error => error.code === 'judge-required',
  );
  assert.throws(
    () => staticFilter({ filter: { exclude: 'opponent' } }, source),
    error => error.code === 'judge-required',
  );
  assert.throws(
    () => staticFilter({ filter: { unsupportedField: true } }, source),
    error => error.code === 'judge-required',
    'unknown filter fields fail closed',
  );
});

test('staticFilter keeps symbolic anchors for per-query re-evaluation', () => {
  const source = sourceSnapshot();
  const filter = staticFilter({
    filter: { type: 'unit', zone: 'board', sameLocationAs: 'self', other: true, exclude: 'self', controller: 'controller' },
  }, source);
  assert.deepEqual(filter.location, BF1, 'board sources bind their current location as a no-anchor fallback');
  assert.deepEqual(
    { type: filter.type, zone: filter.zone, sameLocationAs: filter.sameLocationAs, other: filter.other, exclude: filter.exclude, controller: filter.controller },
    { type: 'unit', zone: 'board', sameLocationAs: 'self', other: true, exclude: 'self', controller: 'A' },
  );
  assert.deepEqual(Object.keys(filter).sort(), ['controller', 'exclude', 'location', 'other', 'sameLocationAs', 'type', 'zone']);
  const away = sourceSnapshot({ zone: 'hand', location: null });
  assert.equal(staticFilter({ filter: { sameLocationAs: 'self' } }, away).location, undefined, 'non-board sources bind no concrete location');
});

test('layerFor covers supported continuous effect kinds with contract 3.4 layers', () => {
  const cases = [
    ['continuous.copy', 'copy'],
    ['continuous.set-type', 'trait'],
    ['continuous.add-tag', 'trait'],
    ['continuous.grant-keyword', 'ability'],
    ['continuous.combat', 'ability'],
    ['continuous.restrict', 'ability'],
    ['continuous.might', 'arithmetic'],
    ['continuous.bonus-damage', 'arithmetic'],
    ['continuous.lethal-threshold', 'arithmetic'],
    ['might', 'arithmetic'],
    ['buff', 'arithmetic'],
    ['grant-keyword', 'ability'],
    ['cost-modification', 'ability'],
  ];
  for (const [kind, layer] of cases) {
    assert.equal(layerFor({ kind }), layer, 'layerFor(' + kind + ')');
  }
  assert.equal(layerFor({ kind: 'continuous.might', layer: 'trait' }), 'trait');
  for (const kind of ['condition.predicate', 'play-location-permission', 'cost.reveal', 'totally-unknown-kind']) {
    assert.throws(
      () => layerFor({ kind }),
      error => error.code === 'judge-required' && /has no layer mapping/.test(error.message),
      'layerFor(' + kind + ') fails closed',
    );
  }
});

test('layerFor covers every continuous.* kind emitted by merged card programs', () => {
  const kinds = new Set();
  for (const program of cardProgramsById.values()) {
    for (const ability of program.abilities ?? []) {
      if (ability.kind !== 'static') continue;
      const kind = String(ability.effect?.kind ?? '');
      if (kind.startsWith('continuous.')) kinds.add(kind);
    }
  }
  assert.ok(kinds.size > 0, 'merged programs expose continuous kinds');
  for (const kind of kinds) {
    assert.doesNotThrow(
      () => layerFor({ kind }),
      'layerFor(' + kind + ') must map every static continuous kind used by merged cards',
    );
  }
});

test('Kinkou Temple: units here with Tank gain arithmetic might through a relative filter', () => {
  const binding = createProgramBinding({ cardPrograms: [executableView('card.hash-0148fea511f023ebe4f6e9b7dd701d1290558c9cbf8bcd877bccd4cda78e5875')] });
  const f = fixture({
    cards: [
      { id: 'temple', cardId: 'card.hash-0148fea511f023ebe4f6e9b7dd701d1290558c9cbf8bcd877bccd4cda78e5875', types: ['unit'], might: 2 },
      { id: 'tank', types: ['unit'], keywords: [{ id: 'Tank' }], might: 2 },
      { id: 'plain', types: ['unit'], might: 2 },
    ],
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(f.engine);
  board(f, 'temple');
  board(f, 'tank');
  board(f, 'plain');
  f.engine.layers.setObjects(f.kernel.objects);
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('tank')).might, 3, 'the Tank here gains +1 might');
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('plain')).might, 2, 'a unit without Tank is untouched');
  board(f, 'temple', BF2);
  f.engine.layers.setObjects(f.kernel.objects);
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('tank')).might, 2, 'the aura follows the host location');
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('temple')).might, 2, 'the host itself gains nothing');
});

test('Windswept Hillock: units here gain Ganking through an ability-layer keyword grant', () => {
  const binding = createProgramBinding({ cardPrograms: [executableView('card.hash-ce3c166d72907a0d5807cb816eb9409a1ebc640347881bf29b083c9f4789e4de')] });
  const f = fixture({
    cards: [
      { id: 'hill', cardId: 'card.hash-ce3c166d72907a0d5807cb816eb9409a1ebc640347881bf29b083c9f4789e4de', types: ['unit'], might: 2, },
      { id: 'ally', types: ['unit'], might: 2, },
      { id: 'enemy', owner: 'B', controller: 'B', types: ['unit'], might: 2, },
    ],
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(f.engine);
  board(f, 'hill');
  board(f, 'ally');
  board(f, 'enemy');
  f.engine.layers.setObjects(f.kernel.objects);
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('ally')).keywords.some(keyword => keyword.id === 'Ganking'), 'the friendly unit here gains Ganking');
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('enemy')).keywords.some(keyword => keyword.id === 'Ganking'), 'the enemy unit here gains Ganking too');
});

test('Black Flame Altar: units here with Temporary gain Shield', () => {
  const binding = createProgramBinding({ cardPrograms: [executableView('card.hash-c4cfa13109f9e65730089b31964d83518df125baae9a5cb10592187c82a44c56')] });
  const f = fixture({
    cards: [
      { id: 'altar', cardId: 'card.hash-c4cfa13109f9e65730089b31964d83518df125baae9a5cb10592187c82a44c56', types: ['unit'], might: 2, },
      { id: 'marked', types: ['unit'], keywords: [{'id':'Temporary'}], might: 2, },
      { id: 'unmarked', types: ['unit'], might: 2, },
    ],
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(f.engine);
  board(f, 'altar');
  board(f, 'marked');
  board(f, 'unmarked');
  f.engine.layers.setObjects(f.kernel.objects);
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('marked')).keywords.some(keyword => keyword.id.toLowerCase() === 'shield' && keyword.value === 1), 'the Temporary unit gains Shield 1');
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('unmarked')).keywords.every(keyword => keyword.id !== 'Shield'), 'the unmarked unit gains nothing');
});

test('Captain Farron: other friendly units here gain Assault (other drops the host)', () => {
  const binding = createProgramBinding({ cardPrograms: [executableView('card.hash-89422400a305aba2968956c639368704e17bca94d650b959b1c78453e5095fe2')] });
  const f = fixture({
    cards: [
      { id: 'farron', cardId: 'card.hash-89422400a305aba2968956c639368704e17bca94d650b959b1c78453e5095fe2', types: ['unit'], might: 2, },
      { id: 'friend', types: ['unit'], might: 2, },
      { id: 'enemy', owner: 'B', controller: 'B', types: ['unit'], might: 2, },
    ],
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(f.engine);
  board(f, 'farron');
  board(f, 'friend');
  board(f, 'enemy');
  f.engine.layers.setObjects(f.kernel.objects);
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('friend')).keywords.some(keyword => keyword.id === 'Assault'), 'the other friendly unit gains Assault');
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('farron')).keywords.every(keyword => keyword.id !== 'Assault'), 'the host itself is excluded by other:true');
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('enemy')).keywords.every(keyword => keyword.id !== 'Assault'), 'enemy units are outside controller:controller');
});

test('Breakneck Mech: your Mechs gain Deflect and Ganking board-wide', () => {
  const binding = createProgramBinding({ cardPrograms: [executableView('card.hash-cb2ea7576d42c76d8ecf8fa3cdb082f007639b144aecc69402230df6bcc131ab')] });
  const f = fixture({
    cards: [
      { id: 'mech', cardId: 'card.hash-cb2ea7576d42c76d8ecf8fa3cdb082f007639b144aecc69402230df6bcc131ab', types: ['unit'], might: 2, },
      { id: 'ally', types: ['unit'], tags: ['Mech'], might: 2, },
      { id: 'civilian', types: ['unit'], might: 2, },
      { id: 'enemy', owner: 'B', controller: 'B', types: ['unit'], tags: ['Mech'], might: 2, },
    ],
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(f.engine);
  board(f, 'mech');
  board(f, 'ally', BF2);
  board(f, 'civilian');
  board(f, 'enemy');
  f.engine.layers.setObjects(f.kernel.objects);
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('ally')).keywords.some(keyword => keyword.id === 'Deflect'), 'the other Mech gains Deflect');
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('ally')).keywords.some(keyword => keyword.id === 'Ganking'), 'the other Mech gains Ganking');
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('civilian')).keywords.every(keyword => keyword.id !== 'Deflect'), 'non-Mech units are untouched');
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('enemy')).keywords.every(keyword => keyword.id !== 'Deflect'), 'enemy Mechs are outside controller:controller');
});

test('Mechanized Menace: your Mechs gain Shield board-wide', () => {
  const binding = createProgramBinding({ cardPrograms: [cardProgramsById.get('card.hash-fadaa09c681d3d967954f99504cd9d3d749242dc99dbc40d60adfa60bf53cca7')] });
  const f = fixture({
    cards: [
      { id: 'menace', cardId: 'card.hash-fadaa09c681d3d967954f99504cd9d3d749242dc99dbc40d60adfa60bf53cca7', types: ['unit'], tags: ['mech'], might: 2, },
      { id: 'ally', types: ['unit'], tags: ['mech'], might: 2, },
      { id: 'civilian', types: ['unit'], might: 2, },
    ],
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(f.engine);
  board(f, 'menace');
  board(f, 'ally', BF2);
  board(f, 'civilian');
  f.engine.layers.setObjects(f.kernel.objects);
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('ally')).keywords.some(keyword => keyword.id.toLowerCase() === 'shield' && keyword.value === 1), 'the Mech gains Shield 1');
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('civilian')).keywords.every(keyword => keyword.id !== 'Shield'), 'non-Mech units are untouched');
});

test('Emperor of the Sands: your Sand Soldiers gain Weaponmaster', () => {
  const binding = createProgramBinding({ cardPrograms: [executableView('card.hash-956993968d114577bbdd0afa0d90d3d311a8e7b76415282b08d0cf69194c7dbf')] });
  const f = fixture({
    cards: [
      { id: 'emperor', cardId: 'card.hash-956993968d114577bbdd0afa0d90d3d311a8e7b76415282b08d0cf69194c7dbf', types: ['unit'], might: 2, },
      { id: 'soldier', types: ['unit'], name: 'Sand Soldier', might: 2, },
      { id: 'stranger', types: ['unit'], name: 'Sand Stranger', might: 2, },
    ],
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(f.engine);
  board(f, 'emperor');
  board(f, 'soldier', BF2);
  board(f, 'stranger');
  f.engine.layers.setObjects(f.kernel.objects);
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('soldier')).keywords.some(keyword => keyword.id.toLowerCase() === 'weaponmaster'), 'the Sand Soldier gains Weaponmaster');
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('stranger')).keywords.every(keyword => keyword.id.toLowerCase() !== 'weaponmaster'), 'other names are untouched');
});

test('Shield Defender: the shield aura excludes its own host (exclude self)', () => {
  const binding = createProgramBinding({ cardPrograms: [executableView('card.hash-28133bb22a32a90c2f06d32acb4d895d0867ae822e8e802eb227f80405c2ea6f')] });
  const f = fixture({
    cards: [
      { id: 'aura', cardId: 'card.hash-28133bb22a32a90c2f06d32acb4d895d0867ae822e8e802eb227f80405c2ea6f', types: ['unit'], might: 2, },
      { id: 'friend', types: ['unit'], might: 2, },
    ],
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(f.engine);
  board(f, 'aura');
  board(f, 'friend');
  f.engine.layers.setObjects(f.kernel.objects);
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('friend')).keywords.some(keyword => keyword.id.toLowerCase() === 'shield'), 'the friendly unit here gains Shield');
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('aura')).keywords.every(keyword => keyword.id !== 'Shield'), 'the host is excluded by exclude:self');
});

test('Steadfast Outrider: while another unit is here the host itself gains might', () => {
  const binding = createProgramBinding({ cardPrograms: [cardProgramsById.get('card.hash-88c1812cc994f155d1a08ed94e9690205a48e0ecd3e4d827b49d468bc6f8e69f')] });
  const f = fixture({
    cards: [
      { id: 'outrider', cardId: 'card.hash-88c1812cc994f155d1a08ed94e9690205a48e0ecd3e4d827b49d468bc6f8e69f', types: ['unit'], might: 2, },
      { id: 'friend', types: ['unit'], might: 2, },
      { id: 'lonely', cardId: 'card.hash-88c1812cc994f155d1a08ed94e9690205a48e0ecd3e4d827b49d468bc6f8e69f', types: ['unit'], might: 2, },
    ],
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(f.engine);
  board(f, 'outrider');
  board(f, 'friend');
  board(f, 'lonely', BF2);
  f.engine.layers.setObjects(f.kernel.objects);
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('outrider')).might, 3, 'the host gains +1 while another unit is here');
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('lonely')).might, 2, 'without another unit here the host gains nothing');
});

test('Trifarian War Camp: units here gain arithmetic might', () => {
  const binding = createProgramBinding({ cardPrograms: [executableView('card.hash-ca6330500fc019b19ccf0df937fc22945cc8bf28a51c21eaef572c53cc31387f')] });
  const f = fixture({
    cards: [
      { id: 'camp', cardId: 'card.hash-ca6330500fc019b19ccf0df937fc22945cc8bf28a51c21eaef572c53cc31387f', types: ['unit'], might: 2, },
      { id: 'ally', types: ['unit'], might: 2, },
      { id: 'enemy', owner: 'B', controller: 'B', types: ['unit'], might: 2, },
    ],
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(f.engine);
  board(f, 'camp');
  board(f, 'ally');
  board(f, 'enemy');
  f.engine.layers.setObjects(f.kernel.objects);
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('ally')).might, 3, 'the unit here gains +1 might');
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('enemy')).might, 3, 'the enemy unit here gains +1 might too');
});

test('Packed Amphitheater: Champion units here gain arithmetic might', () => {
  const binding = createProgramBinding({ cardPrograms: [cardProgramsById.get('card.hash-7e95acea2b29696bcdb29e7def854dacdbb55f72f5160fb4bc3e9c872950af6e')] });
  const f = fixture({
    cards: [
      { id: 'amphi', cardId: 'card.hash-7e95acea2b29696bcdb29e7def854dacdbb55f72f5160fb4bc3e9c872950af6e', types: ['unit'], might: 2, },
      { id: 'champ', types: ['champion', 'unit'], might: 2, },
      { id: 'rank', types: ['unit'], might: 2, },
    ],
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(f.engine);
  board(f, 'amphi');
  board(f, 'champ');
  board(f, 'rank');
  f.engine.layers.setObjects(f.kernel.objects);
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('champ')).might, 3, 'the Champion here gains +1 might');
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('rank')).might, 2, 'a non-Champion unit here is untouched');
});

test('Banner of Conquest: friendly units on this battlefield gain Assault', () => {
  const binding = createProgramBinding({ cardPrograms: [executableView('card.hash-d0b3281a9fa74bb53091f97ba42c80b0e2e28e4604f24e8ea9af80e1316c03d9')] });
  const f = fixture({
    cards: [
      { id: 'banner', cardId: 'card.hash-d0b3281a9fa74bb53091f97ba42c80b0e2e28e4604f24e8ea9af80e1316c03d9', types: ['unit'], might: 2, },
      { id: 'troop', types: ['unit'], might: 2, },
      { id: 'enemy', owner: 'B', controller: 'B', types: ['unit'], might: 2, },
    ],
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(f.engine);
  board(f, 'banner');
  board(f, 'troop');
  board(f, 'enemy');
  f.engine.layers.setObjects(f.kernel.objects);
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('troop')).keywords.some(keyword => keyword.id === 'Assault'), 'the friendly unit on this battlefield gains Assault');
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('enemy')).keywords.every(keyword => keyword.id !== 'Assault'), 'the enemy unit is not affected');
});
