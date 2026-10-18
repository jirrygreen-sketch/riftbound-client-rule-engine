import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, createProgramBinding, cardProgramsById } from '../helpers.mjs';
import { staticFilter, layerFor, createEngineStaticBinder } from '../../../dist/programs/statics.js';
import { ProgramBindingError } from '../../../dist/programs/errors.js';
import { restrictions } from '../../../dist/layers/rules/query.js';

const BF1 = { type: 'battlefield', id: 'battlefield-1' };
const BF2 = { type: 'battlefield', id: 'battlefield-2' };

for (const field of ['controller', 'owner']) {
  for (const selector of ['self', 'source', 'you', 'controller', 'caster', 'opponent', 'their', 'caster-opponent']) {
    test(`live ${field}:${selector} retargets after take-control without rebinding`, () => {
      const f = fixture({ cards: [
        { id: 'host', types: ['unit'], might: 5 },
        { id: 'old-ally', types: ['unit'], might: 2 },
        { id: 'new-ally', types: ['unit'], owner: 'B', controller: 'B', might: 2 },
      ] });
      for (const id of ['host', 'old-ally', 'new-ally']) board(f, id);
      createEngineStaticBinder(f.engine).bindStatic({ kind: 'static', effect: {
        kind: 'continuous.might', amount: 1,
        filter: { type: 'unit', zone: 'board', [field]: selector, other: true },
      } }, f.kernel.getObject('host'));
      const entry = f.engine.layers.registry.list()[0];
      const sourceRef = f.kernel.ref('host');
      const opposing = ['opponent', 'their', 'caster-opponent'].includes(selector);
      const might = id => f.engine.layers.snapshot(f.kernel.ref(id)).might;
      assert.equal(might('old-ally'), opposing ? 2 : 3);
      assert.equal(might('new-ally'), opposing ? 3 : 2);
      f.engine.commit({ type: 'take-control', object: sourceRef, player: 'B' });
      assert.deepEqual(f.kernel.ref('host'), sourceRef, 'control change preserves the incarnation');
      assert.equal(f.engine.layers.registry.list()[0], entry, 'the same binding is re-evaluated');
      assert.equal(might('old-ally'), opposing ? 3 : 2);
      assert.equal(might('new-ally'), opposing ? 2 : 3);
      assert.equal(might('host'), 5, 'other still excludes the stolen host');
    });
  }
}

test('sameLocationAs follows move-location on the same incarnation without rebinding', () => {
  const f = fixture({ cards: [
    { id: 'host', types: ['unit'], might: 5 },
    { id: 'old-neighbor', types: ['unit'], might: 2 },
    { id: 'new-neighbor', types: ['unit'], might: 3 },
  ] });
  board(f, 'host');
  board(f, 'old-neighbor');
  board(f, 'new-neighbor', BF2);
  createEngineStaticBinder(f.engine).bindStatic({ kind: 'static', effect: {
    kind: 'continuous.might', amount: 1,
    filter: { type: 'unit', zone: 'board', sameLocationAs: 'source', other: true },
  } }, f.kernel.getObject('host'));
  const entry = f.engine.layers.registry.list()[0];
  const ref = f.kernel.ref('host');
  assert.equal(entry.effect.filter.location, undefined);
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('old-neighbor')).might, 3);
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('new-neighbor')).might, 3);
  f.engine.commit({ type: 'move-location', object: ref, to: BF2 });
  assert.deepEqual(f.kernel.ref('host'), ref);
  assert.equal(f.engine.layers.registry.list()[0], entry);
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('old-neighbor')).might, 2);
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('new-neighbor')).might, 4);
});

test('region board includes both Bases and Battlefields through the production binder (CR 107.1–107.2)', () => {
  const f = fixture({ cards: [
    { id: 'host', types: ['unit'], might: 5 },
    { id: 'base-unit', types: ['unit'], might: 2 },
    { id: 'field-unit', types: ['unit'], might: 3 },
    { id: 'hand-unit', types: ['unit'], might: 4 },
  ] });
  board(f, 'host');
  board(f, 'field-unit');
  f.engine.commit({ type: 'move-zone', object: f.kernel.ref('base-unit'), to: 'base', location: { type: 'base', player: 'A' } });
  createEngineStaticBinder(f.engine).bindStatic({ kind: 'static', effect: {
    kind: 'continuous.might', amount: 1, filter: { type: 'unit', region: 'board', other: true },
  } }, f.kernel.getObject('host'));
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('base-unit')).might, 3);
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('field-unit')).might, 4);
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('hand-unit')).might, 4);
});

test('unconsumed kinds fail before registration even with a declared layer', () => {
  const f = fixture();
  const binder = createEngineStaticBinder(f.engine);
  for (const kind of [
    'continuous.bonus-damage', 'continuous.lethal-threshold', 'continuous.grant-ability',
    'continuous.grant-abilities', 'continuous.modify-might-reduction',
    'cost.hidden',
    'requirement', 'applied-cost',
  ]) {
    for (const layer of [undefined, 'ability', 'arithmetic']) {
      assert.throws(() => binder.bindStatic({ kind: 'static', effect: { kind, layer } }, f.kernel.getObject('source')),
        error => error instanceof ProgramBindingError && error.code === 'judge-required' && /has no layer mapping/.test(error.message), kind);
      assert.equal(f.engine.layers.registry.list().length, 0);
    }
  }
});

test('rule-query controller filters read the stolen host controller rather than the acting player', () => {
  const f = fixture({ cards: [
    { id: 'host', types: ['unit'], might: 5 },
    { id: 'old-ally', types: ['unit'], might: 2 },
    { id: 'new-ally', types: ['unit'], owner: 'B', controller: 'B', might: 2 },
  ] });
  for (const id of ['host', 'old-ally', 'new-ally']) board(f, id);
  createEngineStaticBinder(f.engine).bindStatic({ kind: 'static', effect: {
    kind: 'continuous.restrict', actions: ['reveal'], restriction: 'cannot-reveal-friendly-units',
    filter: { type: 'unit', zone: 'board', controller: 'controller' },
  } }, f.kernel.getObject('host'));
  const applies = (id, player) => restrictions(f.engine.layers.registry, 'reveal', f.kernel.ref(id), f.engine.layers.snapshot(f.kernel.ref(id)), player).length;
  assert.equal(applies('old-ally', 'B'), 1);
  assert.equal(applies('new-ally', 'A'), 0);
  f.engine.commit({ type: 'take-control', object: f.kernel.ref('host'), player: 'B' });
  assert.equal(applies('old-ally', 'B'), 0);
  assert.equal(applies('new-ally', 'A'), 1);
});

test('rule-query filters without exclusion, opponent or keyword consumers remain judge-required', () => {
  const f = fixture();
  for (const filter of [{ controller: 'opponent' }, { sameLocationAs: 'self', location: BF2 }, { other: true }, { region: 'board' }, { keyword: 'shield' }]) {
    assert.throws(() => createEngineStaticBinder(f.engine).bindStatic({ kind: 'static', effect: {
      kind: 'continuous.restrict', actions: ['reveal'], filter,
    } }, f.kernel.getObject('source')), error => error.code === 'judge-required' && /rule-filter consumer/.test(error.message));
    assert.equal(f.engine.layers.registry.list().length, 0);
  }
});

test('rule-query here follows the current host location and applies to both players', () => {
  const f = fixture({ cards: [
    { id: 'host', types: ['unit'], might: 5 },
    { id: 'old-neighbor', types: ['unit'], might: 2 },
    { id: 'new-neighbor', types: ['unit'], owner: 'B', controller: 'B', might: 2 },
  ] });
  board(f, 'host');
  board(f, 'old-neighbor');
  board(f, 'new-neighbor', BF2);
  createEngineStaticBinder(f.engine).bindStatic({ kind: 'static', effect: {
    kind: 'continuous.restrict', actions: ['reveal'], restriction: 'cannot-reveal-here',
    filter: { type: 'unit', zone: 'board', sameLocationAs: 'self' },
  } }, f.kernel.getObject('host'));
  const entry = f.engine.layers.registry.list()[0];
  const applies = id => restrictions(f.engine.layers.registry, 'reveal', f.kernel.ref(id), f.engine.layers.snapshot(f.kernel.ref(id)), 'A').length;
  assert.deepEqual(entry.effect.filter.location, BF1);
  assert.equal(applies('old-neighbor'), 1);
  assert.equal(applies('new-neighbor'), 0);
  f.engine.commit({ type: 'move-location', object: f.kernel.ref('host'), to: BF2 });
  assert.equal(f.engine.layers.registry.list()[0], entry);
  assert.deepEqual(entry.effect.filter.location, BF2, 'the rule adapter location is live');
  assert.equal(applies('old-neighbor'), 0);
  assert.equal(applies('new-neighbor'), 1);
});

test('unconsumed string movement permissions remain judge-required', () => {
  const f = fixture();
  assert.throws(() => createEngineStaticBinder(f.engine).bindStatic({ kind: 'static', effect: {
    kind: 'continuous.movement', permission: 'battlefield-to-battlefield', addsPermission: true,
  } }, f.kernel.getObject('source')), error => error.code === 'judge-required' && /structured movement-permission consumer/.test(error.message));
  assert.equal(f.engine.layers.registry.list().length, 0);
});

test('trait mappings transform characteristics through real layer consumers', () => {
  for (const [effect, check] of [
    [{ kind: 'continuous.base-might', amount: 6 }, object => assert.equal(object.might, 6)],
    [{ kind: 'continuous.set-type', type: 'gear' }, object => assert.deepEqual(object.types, ['gear'])],
    [{ kind: 'continuous.set-types', types: ['unit', 'gear'] }, object => assert.deepEqual(object.types, ['unit', 'gear'])],
    [{ kind: 'continuous.add-type', type: 'gear' }, object => assert.deepEqual(object.types, ['unit', 'gear'])],
    [{ kind: 'continuous.add-tag', tag: 'Mech' }, object => assert.deepEqual(object.tags, ['Original', 'Mech'])],
    [{ kind: 'continuous.remove-tag', tag: 'Original' }, object => assert.deepEqual(object.tags, [])],
  ]) {
    const f = fixture({ cards: [{ id: 'host', types: ['unit'], tags: ['Original'], might: 2 }] });
    board(f, 'host');
    createEngineStaticBinder(f.engine).bindStatic({ kind: 'static', effect: { ...effect, appliesTo: 'self' } }, f.kernel.getObject('host'));
    const object = f.engine.layers.snapshot(f.kernel.ref('host'));
    check(object);
    assert.equal(object.printed.might, 2, `${effect.kind} preserves printed characteristics`);
  }
});

test('static numeric modes reach their actual arithmetic consumers and reject unconsumed expressions', () => {
  for (const [mode, expected] of [['add', 5], ['set', 3], ['multiply', 6]]) {
    const f = fixture({ cards: [{ id: 'host', types: ['unit'], might: 2 }] });
    board(f, 'host');
    createEngineStaticBinder(f.engine).bindStatic({ kind: 'static', effect: {
      kind: 'continuous.might', mode, amount: { kind: 'constant', value: 3 }, appliesTo: 'self',
    } }, f.kernel.getObject('host'));
    assert.equal(f.engine.layers.snapshot(f.kernel.ref('host')).might, expected, mode);
  }
  const f = fixture();
  for (const effect of [
    { kind: 'continuous.might', mode: 'guess', amount: 1 },
    { kind: 'continuous.might', amount: { kind: 'count', filter: { type: 'unit' } } },
    { kind: 'continuous.base-might', amount: { kind: 'unimplemented-value' } },
  ]) {
    assert.throws(() => createEngineStaticBinder(f.engine).bindStatic({ kind: 'static', effect }, f.kernel.getObject('source')),
      error => error.code === 'judge-required');
    assert.equal(f.engine.layers.registry.list().length, 0);
  }
});

test('static count amounts reach the merged expression consumer and track real buff actions', () => {
  const f = fixture({ cards: [
    { id: 'host', types: ['unit'], might: 4 },
    { id: 'ally', types: ['unit'], might: 2 },
    { id: 'enemy', types: ['unit'], owner: 'B', controller: 'B', might: 2 },
  ] });
  for (const id of ['host', 'ally', 'enemy']) board(f, id);
  createEngineStaticBinder(f.engine).bindStatic({ kind: 'static', effect: {
    kind: 'continuous.might', appliesTo: 'self', amount: {
      kind: 'count', subject: 'objects',
      filter: { type: 'unit', zone: 'board', controller: 'controller', sameLocationAs: 'self', buffed: true },
    },
  } }, f.kernel.getObject('host'));
  const might = () => f.engine.layers.snapshot(f.kernel.ref('host')).might;
  const sync = () => f.engine.layers.setObjects(f.kernel.objects);
  assert.equal(might(), 4);
  assert.equal(f.engine.commit({ type: 'buff', object: f.kernel.ref('ally'), amount: 1 }).status, 'done');
  sync();
  assert.equal(might(), 5);
  assert.equal(f.engine.commit({ type: 'buff', object: f.kernel.ref('enemy'), amount: 1 }).status, 'done');
  sync();
  assert.equal(might(), 5, 'opposing buffed units do not contribute');
  assert.equal(f.engine.commit({ type: 'move-location', object: f.kernel.ref('ally'), to: BF2 }).status, 'done');
  sync();
  assert.equal(might(), 4, 'counts follow current locations');
});
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

test('staticFilter preserves relative controller and owner selectors', () => {
  for (const field of ['controller', 'owner']) {
    for (const selector of ['self', 'source', 'you', 'controller', 'caster', 'opponent', 'their', 'caster-opponent']) {
      assert.deepEqual(staticFilter({ filter: { [field]: selector } }, sourceSnapshot()), { [field]: selector });
      assert.deepEqual(staticFilter({ filter: { [field]: selector } }, sourceSnapshot({ controller: 'B' })), { [field]: selector });
    }
  }
});

test('staticFilter fails closed for unsupported relative fields and player anchors', () => {
  const source = sourceSnapshot();
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
  assert.equal(filter.location, undefined, 'relative anchors never capture a stale location');
  assert.deepEqual(
    { type: filter.type, zone: filter.zone, sameLocationAs: filter.sameLocationAs, other: filter.other, exclude: filter.exclude, controller: filter.controller },
    { type: 'unit', zone: 'board', sameLocationAs: 'self', other: true, exclude: 'self', controller: 'controller' },
  );
  assert.deepEqual(Object.keys(filter).sort(), ['controller', 'exclude', 'other', 'sameLocationAs', 'type', 'zone']);
  const away = sourceSnapshot({ zone: 'hand', location: null });
  assert.equal(staticFilter({ filter: { sameLocationAs: 'self' } }, away).location, undefined, 'non-board sources bind no concrete location');
});

test('layerFor covers supported continuous effect kinds with contract 3.4 layers', () => {
  const cases = [
    ['continuous.copy', 'copy'],
    ['continuous.set-type', 'trait'],
    ['continuous.add-tag', 'trait'],
    ['continuous.grant-keyword', 'ability'],
    ['continuous.restrict', 'ability'],
    ['continuous.deck', 'ability'],
    ['continuous.permission', 'ability'],
    ['continuous.location', 'ability'],
    ['continuous.ability-count', 'ability'],
    ['continuous.resource', 'ability'],
    ['continuous.combat', 'ability'],
    ['continuous.cost-modification', 'ability'],
    ['cost.additional', 'ability'],
    ['cost.modify', 'ability'],
    ['target.tax', 'ability'],
    ['continuous.might', 'arithmetic'],
    ['might', 'arithmetic'],
    ['buff', 'arithmetic'],
    ['grant-keyword', 'ability'],
  ];
  for (const [kind, layer] of cases) {
    assert.equal(layerFor({ kind }), layer, 'layerFor(' + kind + ')');
  }
  assert.throws(() => layerFor({ kind: 'continuous.might', layer: 'trait' }), error => error.code === 'judge-required');
  for (const kind of ['condition.predicate', 'play-location-permission', 'cost.reveal', 'totally-unknown-kind', 'continuous.bonus-damage', 'continuous.lethal-threshold', 'continuous.grant-ability', 'continuous.grant-abilities', 'continuous.modify-might-reduction', 'cost.hidden']) {
    assert.throws(
      () => layerFor({ kind }),
      error => error.code === 'judge-required' && /has no layer mapping/.test(error.message),
      'layerFor(' + kind + ') fails closed',
    );
  }
});

test('layerFor explicitly blocks unconsumed continuous kinds emitted by merged card programs', () => {
  const kinds = new Set();
  for (const program of cardProgramsById.values()) {
    for (const ability of program.abilities ?? []) {
      if (ability.kind !== 'static') continue;
      const kind = String(ability.effect?.kind ?? '');
      if (kind.startsWith('continuous.')) kinds.add(kind);
    }
  }
  assert.ok(kinds.size > 0, 'merged programs expose continuous kinds');
  const supported = new Set(['continuous.might', 'continuous.grant-keyword', 'continuous.keyword', 'continuous.movement', 'continuous.restrict', 'continuous.combat', 'continuous.cost-modification']);
  const blocked = new Set([
    'continuous.bonus-damage',
    'continuous.facedown-capacity', 'continuous.grant-abilities', 'continuous.grant-ability',
    'continuous.ignore-abilities', 'continuous.ignore-ability', 'continuous.ignore-target-tax',
    'continuous.lethal-threshold', 'continuous.modify-might-reduction', 'continuous.play-permission',
    'continuous.target-restriction', 'continuous.trigger-multiplicity', 'continuous.trigger-suppression',
  ]);
  for (const kind of kinds) {
    assert.ok(supported.has(kind) || blocked.has(kind), `classify new kind ${kind} before enabling it`);
    if (supported.has(kind)) assert.doesNotThrow(() => layerFor({ kind }));
    else assert.throws(() => layerFor({ kind }), error => error.code === 'judge-required' && /has no layer mapping/.test(error.message));
  }
});

test('merged rule and Finalize collectors receive layerFor-supported static declarations', () => {
  const f = fixture({ cards: [{ id: 'host', types: ['unit'], might: 5 }] });
  board(f, 'host');
  const binder = createEngineStaticBinder(f.engine);
  for (const effect of [
    { kind: 'continuous.combat', flags: ['tank'] },
    { kind: 'continuous.cost-modification', resource: 'energy', amount: -1 },
    { kind: 'cost.additional', id: 'extra', optional: false, stage: 'mandatory-additional', payments: [{ kind: 'energy', amount: { kind: 'constant', value: 1 } }] },
    { kind: 'cost.modify', resource: 'energy', amount: 1, stage: 'increase' },
    { kind: 'target.tax', value: { kind: 'constant', value: 1 } },
  ]) {
    const before = f.engine.layers.registry.list().length;
    binder.bindStatic({ kind: 'static', effect }, f.kernel.getObject('host'));
    assert.equal(f.engine.layers.registry.list().length, before + 1, effect.kind);
  }
});

test('Kinkou Temple: units here with Tank gain arithmetic might through a relative filter', () => {
  const binding = createProgramBinding({ cardPrograms: [executableView('card.hash-0148fea511f023ebe4f6e9b7dd701d1290558c9cbf8bcd877bccd4cda78e5875')] });
  const f = fixture({
    cards: [
      { id: 'temple', cardId: 'card.hash-0148fea511f023ebe4f6e9b7dd701d1290558c9cbf8bcd877bccd4cda78e5875', types: ['unit'], might: 2 },
      { id: 'tank', types: ['unit'], keywords: [{ id: 'Tank' }], might: 2 },
      { id: 'second-tank', types: ['unit'], keywords: [{ id: 'Tank' }], might: 2 },
      { id: 'plain', types: ['unit'], might: 2 },
    ],
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(f.engine);
  board(f, 'temple');
  board(f, 'tank');
  board(f, 'second-tank', BF2);
  board(f, 'plain');
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('tank')).might, 3, 'the Tank here gains +1 might');
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('plain')).might, 2, 'a unit without Tank is untouched');
  const registrations = f.engine.layers.registry.list();
  const ref = f.kernel.ref('temple');
  f.engine.commit({ type: 'move-location', object: ref, to: BF2 });
  assert.deepEqual(f.kernel.ref('temple'), ref);
  assert.deepEqual(f.engine.layers.registry.list(), registrations, 'the official static follows movement without rebinding');
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('tank')).might, 2, 'the aura follows the host location');
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('second-tank')).might, 3, 'the Tank at the new location now gains the bonus');
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
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('marked')).keywords.some(keyword => keyword.id.toLowerCase() === 'shield' && keyword.value === 1), 'the Temporary unit gains Shield 1');
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('unmarked')).keywords.every(keyword => keyword.id.toLowerCase() !== 'shield'), 'the unmarked unit gains nothing');
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
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('friend')).keywords.some(keyword => keyword.id === 'Assault'), 'the other friendly unit gains Assault');
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('farron')).keywords.every(keyword => keyword.id.toLowerCase() !== 'assault'), 'the host itself is excluded by other:true');
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('enemy')).keywords.every(keyword => keyword.id.toLowerCase() !== 'assault'), 'enemy units are outside controller:controller');
  const registrations = f.engine.layers.registry.list();
  const ref = f.kernel.ref('farron');
  f.engine.commit({ type: 'take-control', object: ref, player: 'B' });
  assert.deepEqual(f.kernel.ref('farron'), ref);
  assert.deepEqual(f.engine.layers.registry.list(), registrations, 'the official aura retargets without rebinding');
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('friend')).keywords.every(keyword => keyword.id.toLowerCase() !== 'assault'), 'former allies lose Assault');
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('enemy')).keywords.some(keyword => keyword.id === 'Assault'), 'new allies gain Assault');
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('farron')).keywords.every(keyword => keyword.id.toLowerCase() !== 'assault'), 'other still excludes the stolen host');
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
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('ally')).keywords.some(keyword => keyword.id === 'Deflect'), 'the other Mech gains Deflect');
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('ally')).keywords.some(keyword => keyword.id === 'Ganking'), 'the other Mech gains Ganking');
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('civilian')).keywords.every(keyword => keyword.id.toLowerCase() !== 'deflect'), 'non-Mech units are untouched');
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('enemy')).keywords.every(keyword => keyword.id.toLowerCase() !== 'deflect'), 'enemy Mechs are outside controller:controller');
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
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('ally')).keywords.some(keyword => keyword.id.toLowerCase() === 'shield' && keyword.value === 1), 'the Mech gains Shield 1');
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('civilian')).keywords.every(keyword => keyword.id.toLowerCase() !== 'shield'), 'non-Mech units are untouched');
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
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('soldier')).keywords.some(keyword => keyword.id.toLowerCase() === 'weaponmaster'), 'the Sand Soldier gains Weaponmaster');
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('stranger')).keywords.every(keyword => keyword.id.toLowerCase() !== 'weaponmaster'), 'other names are untouched');
});

test('Taric, Protector: the shield aura excludes its own host (exclude self)', () => {
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
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('friend')).keywords.some(keyword => keyword.id.toLowerCase() === 'shield'), 'the friendly unit here gains Shield');
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('aura')).keywords.every(keyword => keyword.id.toLowerCase() !== 'shield'), 'the host is excluded by exclude:self');
});

test('Trusty Ramhound: while another unit is here the host itself gains might', () => {
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
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('troop')).keywords.some(keyword => keyword.id === 'Assault'), 'the friendly unit on this battlefield gains Assault');
  assert.ok(f.engine.layers.snapshot(f.kernel.ref('enemy')).keywords.every(keyword => keyword.id.toLowerCase() !== 'assault'), 'the enemy unit is not affected');
});
