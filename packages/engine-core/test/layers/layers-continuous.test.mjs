import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ContinuousEffectRegistry,
  createCopiedObjectSnapshot,
  createDuelDerivedMightResolver,
  createLayerEngine,
  LAYER_ORDER,
} from '../../dist/layers/index.js';

function object(id, values = {}) {
  return {
    ref: { id, zoneEntryId: 1 },
    cardId: `card:${id}`,
    name: id,
    types: ['unit'],
    tags: [],
    keywords: [],
    owner: 'A',
    controller: 'A',
    zone: 'board',
    location: null,
    might: 2,
    energy: 1,
    power: ['Fury'],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
    ...values,
  };
}

function permanent(effect, timestamp) {
  return { effect, duration: { type: 'permanent' }, timestamp };
}

function engine(objects, effects, options) {
  return createLayerEngine(objects, effects, options);
}

test('layers-fiora-buff-then-recheck-ability: arithmetic Might is visible to later checks', () => {
  const unit = object('fiora', { might: 4 });
  const layerEngine = engine([unit], [
    permanent({ id: 'might', layer: 'arithmetic', filter: { objectId: 'fiora' }, effect: { kind: 'add', amount: 1 } }),
    permanent({ id: 'mighty', layer: 'ability', filter: { objectId: 'fiora', characteristics: { might: 5 } }, effect: { kind: 'grant-keyword', keyword: 'deflect' } }),
    permanent({ id: 'ganking', layer: 'ability', filter: { objectId: 'fiora', characteristics: { might: 5 } }, effect: { kind: 'grant-keyword', keyword: 'ganking' } }),
    permanent({ id: 'shield', layer: 'ability', filter: { objectId: 'fiora', characteristics: { might: 5 } }, effect: { kind: 'grant-keyword', keyword: 'shield' } }),
  ]);
  const result = layerEngine.evaluate(unit.ref);
  assert.equal(result.might, 5);
  assert.deepEqual(result.keywords.map(keyword => keyword.id), ['deflect', 'ganking', 'shield']);
});

test('layers-buff-removal-drops-conditional-abilities: removing a registration recomputes all layers', () => {
  const unit = object('unit', { might: 4 });
  const layerEngine = engine([unit], [
    permanent({ id: 'buff', layer: 'arithmetic', filter: { objectId: 'unit' }, effect: { kind: 'add', amount: 1 } }),
    permanent({ id: 'ability', layer: 'ability', filter: { objectId: 'unit', characteristics: { might: 5 } }, effect: { kind: 'grant-keyword', keyword: 'shield' } }),
  ]);
  assert.equal(layerEngine.evaluate(unit.ref).keywords[0].id, 'shield');
  layerEngine.removeContinuous('buff');
  assert.deepEqual(layerEngine.evaluate(unit.ref).keywords, []);
});

test('layers-copy-layer-precedes-trait-layer: copied traits can be overwritten afterwards', () => {
  const source = object('source', { might: 2, power: ['Fury'], keywords: [{ id: 'shield', value: 1 }] });
  const copy = object('copy', { might: 1, power: ['Chaos'] });
  const result = engine([source, copy], [
    permanent({ id: 'copy', layer: 'copy', filter: { objectId: 'copy' }, effect: { kind: 'copy-object', source: source.ref } }),
    permanent({ id: 'trait', layer: 'trait', filter: { objectId: 'copy' }, effect: { kind: 'set-domain', domain: 'Chaos' } }),
  ]).evaluate(copy.ref);
  assert.deepEqual(result.power, ['Chaos']);
  assert.equal(result.might, 2);
  assert.equal(result.keywords[0].id, 'shield');
});

test('layers-trait-layer-before-ability-layer: gained traits enable conditional abilities', () => {
  const unit = object('unit');
  const result = engine([unit], [
    permanent({ id: 'yordle', layer: 'trait', filter: { objectId: 'unit' }, effect: { kind: 'add-tag', tag: 'yordle' } }),
    permanent({ id: 'vision', layer: 'ability', filter: { objectId: 'unit', tags: ['yordle'] }, effect: { kind: 'grant-keyword', keyword: 'vision' } }),
  ]).evaluate(unit.ref);
  assert.ok(result.tags.includes('yordle'));
  assert.ok(result.keywords.some(keyword => keyword.id === 'vision'));
});

test('layers-arithmetic-increases-before-decreases: arithmetic sublayers are ordered', () => {
  const unit = object('unit', { might: 3 });
  const result = engine([unit], [
    permanent({ id: 'decrease', layer: 'arithmetic', filter: { objectId: 'unit' }, effect: { kind: 'decrease', amount: 4 } }, 1),
    permanent({ id: 'increase', layer: 'arithmetic', filter: { objectId: 'unit' }, effect: { kind: 'increase', amount: 2 } }, 2),
  ]).evaluate(unit.ref);
  assert.equal(result.might, 1);
});

test('layers-copy-game-action-object-has-copied-traits-as-printed: generated copies have no active copy effect', () => {
  const source = object('source', { cardId: 'print-source', might: 4, power: ['Mind'] });
  const copied = createCopiedObjectSnapshot(source, { ref: { id: 'token', zoneEntryId: 2 }, owner: 'A', location: null });
  assert.equal(copied.printed.might, 4);
  assert.equal(copied.might, 4);
  assert.equal(copied.cardId, 'print-source');
  assert.equal(copied.isToken, true);
});

test('layers-copy-effect-token-gains-copied-cost: copy layer carries energy', () => {
  const source = object('source', { energy: 4 });
  const token = object('token', { energy: null, isToken: true });
  const result = engine([source, token], [
    permanent({ id: 'copy', layer: 'copy', filter: { objectId: 'token' }, effect: { kind: 'copy-object', source: source.ref, properties: ['energy'] } }),
  ]).evaluate(token.ref);
  assert.equal(result.energy, 4);
});

test('layers-copyable-traits-ignore-arithmetic-buffs: copy reads before arithmetic', () => {
  const source = object('source', { might: 3 });
  const copy = object('copy', { might: 0 });
  const result = engine([source, copy], [
    permanent({ id: 'source-buff', layer: 'arithmetic', filter: { objectId: 'source' }, effect: { kind: 'increase', amount: 5 } }),
    permanent({ id: 'copy', layer: 'copy', filter: { objectId: 'copy' }, effect: { kind: 'copy-object', source: source.ref } }),
  ]).evaluate(copy.ref);
  assert.equal(result.might, 3);
});

test('layers-copy-of-copy-chains: copy dependencies resolve recursively', () => {
  const source = object('source', { might: 3, tags: ['first'] });
  const middle = object('middle', { might: 0 });
  const result = engine([source, middle, object('final', { might: 0 })], [
    permanent({ id: 'copy-middle', layer: 'copy', filter: { objectId: 'middle' }, effect: { kind: 'copy-object', source: source.ref } }),
    permanent({ id: 'copy-final', layer: 'copy', filter: { objectId: 'final' }, effect: { kind: 'copy-object', source: middle.ref } }),
  ]).evaluate({ id: 'final', zoneEntryId: 1 });
  assert.equal(result.might, 3);
  assert.deepEqual(result.tags, ['first']);
});

test('layers-trait-layer-append-not-copied: trait additions stay out of copyable values', () => {
  const source = object('source');
  const copy = object('copy');
  const result = engine([source, copy], [
    permanent({ id: 'trait', layer: 'trait', filter: { objectId: 'source' }, effect: { kind: 'add-tag', tag: 'yordle' } }),
    permanent({ id: 'copy', layer: 'copy', filter: { objectId: 'copy' }, effect: { kind: 'copy-object', source: source.ref } }),
  ]).evaluate(copy.ref);
  assert.deepEqual(result.tags, []);
});

test('layers-cost-references-printed-or-copied-cost: copied energy is available to readers', () => {
  const source = object('source', { energy: 5 });
  const copy = object('copy', { energy: 0 });
  const result = engine([source, copy], [
    permanent({ id: 'copy', layer: 'copy', filter: { objectId: 'copy' }, effect: { kind: 'copy-object', source: source.ref } }),
    permanent({ id: 'set', layer: 'trait', filter: { objectId: 'copy' }, effect: { kind: 'set', property: 'name', value: { kind: 'object-property', object: source.ref, property: 'name' } } }),
  ]).evaluate(copy.ref);
  assert.equal(result.energy, 5);
  assert.equal(result.name, 'source');
});

test('layers-object-dependency-pause-and-evaluate: dependent objects finish before use', () => {
  const source = object('source', { name: 'printed' });
  const target = object('target');
  const result = engine([source, target], [
    permanent({ id: 'source-name', layer: 'trait', filter: { objectId: 'source' }, effect: { kind: 'set-name', name: 'derived' } }),
    permanent({ id: 'target-name', layer: 'trait', filter: { objectId: 'target' }, effect: { kind: 'set-name', value: { kind: 'object-property', object: source.ref, property: 'name' } } }),
  ]).evaluate(target.ref);
  assert.equal(result.name, 'derived');
});

test('layers-dependency-chain-evaluate-from-endpoint: dependency chains are transitive', () => {
  const first = object('first', { name: 'one' });
  const second = object('second');
  const third = object('third');
  const result = engine([first, second, third], [
    permanent({ id: 'first-name', layer: 'trait', filter: { objectId: 'first' }, effect: { kind: 'set-name', name: 'two' } }),
    permanent({ id: 'second-name', layer: 'trait', filter: { objectId: 'second' }, effect: { kind: 'set-name', value: { kind: 'object-property', object: first.ref, property: 'name' } } }),
    permanent({ id: 'third-name', layer: 'trait', filter: { objectId: 'third' }, effect: { kind: 'set-name', value: { kind: 'object-property', object: second.ref, property: 'name' } } }),
  ]).evaluate(third.ref);
  assert.equal(result.name, 'two');
});

test('layers-siphon-power-mutual-dependency: mutual references terminate at one layer', () => {
  const first = object('first', { name: 'first' });
  const second = object('second', { name: 'second' });
  const layerEngine = engine([first, second], [
    permanent({ id: 'first-name', layer: 'trait', filter: { objectId: 'first' }, effect: { kind: 'set-name', value: { kind: 'object-property', object: second.ref, property: 'name' } } }),
    permanent({ id: 'second-name', layer: 'trait', filter: { objectId: 'second' }, effect: { kind: 'set-name', value: { kind: 'object-property', object: first.ref, property: 'name' } } }),
  ]);
  assert.doesNotThrow(() => layerEngine.evaluate(first.ref));
  assert.equal(typeof layerEngine.evaluate(second.ref).name, 'string');
});

test('layers-dependency-vs-timestamp-within-layer: dependencies outrank timestamps', () => {
  const source = object('source');
  const target = object('target');
  const result = engine([source, target], [
    permanent({ id: 'target-old', layer: 'trait', filter: { objectId: 'target' }, effect: { kind: 'set-name', name: 'old' } }, 1),
    permanent({ id: 'source-new', layer: 'trait', filter: { objectId: 'source' }, effect: { kind: 'set-name', name: 'new' } }, 2),
    permanent({ id: 'target-ref', layer: 'trait', filter: { objectId: 'target' }, effect: { kind: 'set-name', value: { kind: 'object-property', object: source.ref, property: 'name' } } }, 2),
  ]).evaluate(target.ref);
  assert.equal(result.name, 'new');
});

test('layers-dependency-no-cycle-falls-back-to-timestamp: same layer is deterministic', () => {
  const unit = object('unit');
  const result = engine([unit], [
    permanent({ id: 'later', layer: 'trait', filter: { objectId: 'unit' }, effect: { kind: 'set-name', name: 'later' } }, 20),
    permanent({ id: 'earlier', layer: 'trait', filter: { objectId: 'unit' }, effect: { kind: 'set-name', name: 'earlier' } }, 10),
  ]).evaluate(unit.ref);
  assert.equal(result.name, 'later');
});

test('layers-inactive-text-loses-timestamp: removed effects no longer contribute', () => {
  const unit = object('unit');
  const layerEngine = engine([unit], [permanent({ id: 'name', layer: 'trait', filter: { objectId: 'unit' }, effect: { kind: 'set-name', name: 'active' } })]);
  assert.equal(layerEngine.evaluate(unit.ref).name, 'active');
  layerEngine.removeContinuous('name');
  assert.equal(layerEngine.evaluate(unit.ref).name, 'unit');
});

test('layers-arithmetic-min-limit-snapshots: lower bound is applied after arithmetic', () => {
  const unit = object('unit', { might: 1 });
  const result = engine([unit], [permanent({ id: 'debuff', layer: 'arithmetic', filter: { objectId: 'unit' }, effect: { kind: 'decrease', amount: 9 } })]).evaluate(unit.ref);
  assert.equal(result.might, 0);
});

test('layers-arithmetic-passive-set-to-five-not-snapshotted: set is recalculated each read', () => {
  const unit = object('unit', { might: 1 });
  const layerEngine = engine([unit], [permanent({ id: 'set', layer: 'arithmetic', filter: { objectId: 'unit' }, effect: { kind: 'set-might', amount: 5 } })]);
  assert.equal(layerEngine.evaluate(unit.ref).might, 5);
  layerEngine.setObjects([object('unit', { might: 8 })]);
  assert.equal(layerEngine.evaluate(unit.ref).might, 5);
});

test('layers-last-stand-double-negative-becomes-zero: multiple negative effects never expose negative Might', () => {
  const unit = object('unit', { might: 2 });
  const result = engine([unit], [
    permanent({ id: 'a', layer: 'arithmetic', filter: { objectId: 'unit' }, effect: { kind: 'decrease', amount: 5 } }),
    permanent({ id: 'b', layer: 'arithmetic', filter: { objectId: 'unit' }, effect: { kind: 'decrease', amount: 5 } }),
  ]).evaluate(unit.ref);
  assert.equal(result.might, 0);
});

test('layers-negative-might-treated-as-zero: a direct negative increase is clamped', () => {
  const unit = object('unit', { might: 1 });
  const result = engine([unit], [permanent({ id: 'a', layer: 'arithmetic', filter: { objectId: 'unit' }, effect: { kind: 'add', amount: -5 } })]).evaluate(unit.ref);
  assert.equal(result.might, 0);
});

test('layers-ahri-discipline-stunned-one-might: condition can inspect current state', () => {
  const unit = object('unit', { stunned: true, might: 2 });
  const result = engine([unit], [permanent({ id: 'a', layer: 'arithmetic', filter: { objectId: 'unit' }, effect: { kind: 'decrease', amount: 1, condition: current => current.stunned } })]).evaluate(unit.ref);
  assert.equal(result.might, 1);
});

test('layers-ahri-discipline-stunned-three-might-no-trigger: false conditions do not apply', () => {
  const unit = object('unit', { stunned: false, might: 3 });
  const result = engine([unit], [permanent({ id: 'a', layer: 'arithmetic', filter: { objectId: 'unit' }, effect: { kind: 'decrease', amount: 1, condition: current => current.stunned } })]).evaluate(unit.ref);
  assert.equal(result.might, 3);
});

test('layers-ahri-direct-debuff-triggers: a direct arithmetic debuff applies', () => {
  const unit = object('unit', { might: 5 });
  const result = engine([unit], [permanent({ id: 'a', layer: 'arithmetic', filter: { objectId: 'unit' }, effect: { kind: 'decrease', amount: 2 } })]).evaluate(unit.ref);
  assert.equal(result.might, 3);
});

test('layers-attached-might-bonus-in-arithmetic-layer: attached effects add Might', () => {
  const unit = object('unit', { might: 3 });
  const result = engine([unit], [permanent({ id: 'a', layer: 'arithmetic', filter: { objectId: 'unit' }, effect: { kind: 'increase', amount: 2 } })]).evaluate(unit.ref);
  assert.equal(result.might, 5);
});

test('layers-attach-unit-to-permanent-nothing-happens: attachment is preserved for non-units', () => {
  const gear = object('gear', { types: ['gear'], attachedTo: { id: 'host', zoneEntryId: 1 } });
  assert.deepEqual(engine([gear], []).evaluate(gear.ref).attachedTo, { id: 'host', zoneEntryId: 1 });
});

test('layers-attached-equipment-becomes-unit-detaches: unitization immediately detaches', () => {
  const gear = object('gear', { types: ['gear'], attachedTo: { id: 'host', zoneEntryId: 1 } });
  const result = engine([gear], [permanent({ id: 'unitize', layer: 'trait', filter: { objectId: 'gear' }, effect: { kind: 'set-types', types: ['unit'] } })]).evaluate(gear.ref);
  assert.deepEqual(result.types, ['unit']);
  assert.equal(result.attachedTo, null);
});

test('layers-unitized-gear-cannot-be-reattached: attachment remains absent after later layers', () => {
  const gear = object('gear', { types: ['gear'], attachedTo: { id: 'host', zoneEntryId: 1 } });
  const result = engine([gear], [
    permanent({ id: 'unitize', layer: 'trait', filter: { objectId: 'gear' }, effect: { kind: 'set-types', types: ['unit'] } }),
    permanent({ id: 'attach', layer: 'ability', filter: { objectId: 'gear' }, effect: { kind: 'set', property: 'attachedTo', value: { id: 'host', zoneEntryId: 1 } } }),
  ]).evaluate(gear.ref);
  assert.equal(result.attachedTo, null);
});

test('layers-stops-being-unit-equipment-stays-attached: gear remains attached when unit trait is removed', () => {
  const gear = object('gear', { types: ['gear'], attachedTo: { id: 'host', zoneEntryId: 1 } });
  const result = engine([gear], [permanent({ id: 'keep-gear', layer: 'trait', filter: { objectId: 'gear' }, effect: { kind: 'set-types', types: ['gear'] } })]).evaluate(gear.ref);
  assert.deepEqual(result.attachedTo, { id: 'host', zoneEntryId: 1 });
});

test('layers-showoff-locks-might-at-finalization: a copied snapshot can be locked independently', () => {
  const unit = object('unit', { might: 4 });
  const locked = createCopiedObjectSnapshot(unit, { ref: { id: 'locked', zoneEntryId: 1 }, owner: 'A', isToken: false });
  const layerEngine = engine([unit, locked], [permanent({ id: 'buff', layer: 'arithmetic', filter: { objectId: 'unit' }, effect: { kind: 'increase', amount: 3 } })]);
  assert.equal(layerEngine.evaluate(unit.ref).might, 7);
  assert.equal(layerEngine.evaluate(locked.ref).might, 4);
});

test('layers-showoff-locked-info-survives-zone-change: copied identity keeps its locked value', () => {
  const source = object('source', { might: 4 });
  const locked = createCopiedObjectSnapshot(source, { ref: { id: 'locked', zoneEntryId: 1 }, zone: 'trash', owner: 'A' });
  assert.equal(locked.might, 4);
  assert.equal(locked.zone, 'trash');
});

test('layers-showoff-locked-value-references-not-identity: copied ref is distinct', () => {
  const source = object('source', { might: 4 });
  const locked = createCopiedObjectSnapshot(source, { ref: { id: 'locked', zoneEntryId: 1 } });
  assert.notDeepEqual(locked.ref, source.ref);
  assert.equal(locked.might, source.might);
});

test('layers-copy-granted-ability-not-carried: ability layer additions are not copied', () => {
  const source = object('source');
  const copy = object('copy');
  const result = engine([source, copy], [
    permanent({ id: 'ability', layer: 'ability', filter: { objectId: 'source' }, effect: { kind: 'grant-keyword', keyword: 'shield' } }),
    permanent({ id: 'copy', layer: 'copy', filter: { objectId: 'copy' }, effect: { kind: 'copy-object', source: source.ref } }),
  ]).evaluate(copy.ref);
  assert.deepEqual(result.keywords, []);
});

test('layers-svellsongur-copies-text-to-equipment: copy-text updates effectText', () => {
  const unit = object('unit', { text: 'attack: draw 1' });
  const gear = object('gear', { types: ['gear'], attachedTo: unit.ref });
  const result = engine([unit, gear], [permanent({ id: 'text', layer: 'copy', filter: { objectId: 'gear' }, effect: { kind: 'copy-text', source: unit.ref } })]).evaluate(gear.ref);
  assert.equal(result.effectText, 'attack: draw 1');
});

test('layers-copied-token-gains-domain: copy layer can copy a domain', () => {
  const source = object('source', { power: ['Fury'] });
  const token = object('token', { power: null, isToken: true });
  const result = engine([source, token], [permanent({ id: 'domain', layer: 'copy', filter: { objectId: 'token' }, effect: { kind: 'copy-object', source: source.ref, properties: ['power'] } })]).evaluate(token.ref);
  assert.deepEqual(result.power, ['Fury']);
});

test('layers-duration-end-of-turn: effects expire at turn-end', () => {
  const unit = object('unit');
  const layerEngine = engine([unit], [{ effect: { id: 'turn', layer: 'trait', filter: { objectId: 'unit' }, effect: { kind: 'add-tag', tag: 'temporary' } }, duration: { type: 'end-of-turn' } }]);
  assert.ok(layerEngine.evaluate(unit.ref).tags.includes('temporary'));
  assert.deepEqual(layerEngine.advance({ id: 'turn-end' }), ['turn']);
  assert.deepEqual(layerEngine.evaluate(unit.ref).tags, []);
});

test('layers-duration-end-of-combat: effects expire at combat-end', () => {
  const unit = object('unit');
  const layerEngine = engine([unit], [{ effect: { id: 'combat', layer: 'arithmetic', filter: { objectId: 'unit' }, effect: { kind: 'increase', amount: 2 } }, duration: { type: 'end-of-combat' } }]);
  assert.equal(layerEngine.evaluate(unit.ref).might, 4);
  layerEngine.advance({ id: 'combat-end' });
  assert.equal(layerEngine.evaluate(unit.ref).might, 2);
});

test('layers-duration-until-timing-point: arbitrary closed timing IDs drive expiry', () => {
  const unit = object('unit');
  const layerEngine = engine([unit], [{ effect: { id: 'until', layer: 'trait', filter: { objectId: 'unit' }, effect: { kind: 'add-tag', tag: 'until' } }, duration: { type: 'until', at: 'showdown-close' } }]);
  layerEngine.advance({ id: 'showdown-open' });
  assert.ok(layerEngine.evaluate(unit.ref).tags.includes('until'));
  layerEngine.advance({ id: 'showdown-close' });
  assert.deepEqual(layerEngine.evaluate(unit.ref).tags, []);
});

test('layers-duration-until-player: player-qualified expiry waits for matching player', () => {
  const unit = object('unit');
  const layerEngine = engine([unit], [{ effect: { id: 'player', layer: 'trait', filter: { objectId: 'unit' }, effect: { kind: 'add-tag', tag: 'player' } }, duration: { type: 'until', at: 'turn-end', player: 'A' } }]);
  layerEngine.advance({ id: 'turn-end', player: 'B' });
  assert.ok(layerEngine.evaluate(unit.ref).tags.includes('player'));
  layerEngine.advance({ id: 'turn-end', player: 'A' });
  assert.deepEqual(layerEngine.evaluate(unit.ref).tags, []);
});

test('layers-duration-source-lifetime: effects end when their source reference leaves', () => {
  const source = object('source');
  const unit = object('unit');
  const layerEngine = engine([source, unit], [{ effect: { id: 'source-life', layer: 'trait', source: source.ref, filter: { objectId: 'unit' }, effect: { kind: 'add-tag', tag: 'source' } }, duration: { type: 'while-source-in-zone', source: source.ref } }]);
  assert.ok(layerEngine.evaluate(unit.ref).tags.includes('source'));
  layerEngine.setObjects([unit]);
  layerEngine.advance({ id: 'object-leaves-zone' });
  assert.deepEqual(layerEngine.evaluate(unit.ref).tags, []);
});

test('layers-continuous-registry-order: timestamp and registration sequence are stable', () => {
  const registry = new ContinuousEffectRegistry();
  const first = registry.register({ id: 'first', layer: 'trait', filter: {}, effect: { kind: 'add-tag', tag: 'first' } }, { type: 'permanent' }, 3);
  const second = registry.register({ id: 'second', layer: 'trait', filter: {}, effect: { kind: 'add-tag', tag: 'second' } }, { type: 'permanent' }, 3);
  assert.deepEqual(registry.list().map(entry => entry.effect.id), ['first', 'second']);
  assert.equal(second.sequence, first.sequence + 1);
});

test('layers-filter-types-and-states: filter matching sees derived object characteristics', () => {
  const unit = object('unit', { exhausted: true });
  const result = engine([unit], [permanent({ id: 'wrong', layer: 'trait', filter: { type: 'gear' }, effect: { kind: 'add-tag', tag: 'wrong' } }), permanent({ id: 'right', layer: 'trait', filter: { type: 'unit', states: 'exhausted' }, effect: { kind: 'add-tag', tag: 'right' } })]).evaluate(unit.ref);
  assert.deepEqual(result.tags, ['right']);
});

test('layers-action-timing: ability layer exposes Action and Reaction windows', () => {
  const unit = object('unit');
  const result = engine([unit], [
    permanent({ id: 'action', layer: 'ability', filter: { objectId: 'unit' }, effect: { kind: 'grant-timing', timing: 'action' } }),
    permanent({ id: 'reaction', layer: 'ability', filter: { objectId: 'unit' }, effect: { kind: 'grant-timing', timing: 'reaction' } }),
  ]).evaluate(unit.ref);
  assert.deepEqual(result.availableTimings, ['action', 'reaction']);
});

test('layers-movement: ability layer exposes movement permissions', () => {
  const unit = object('unit');
  const result = engine([unit], [permanent({ id: 'gank', layer: 'ability', filter: { objectId: 'unit' }, effect: { kind: 'grant-movement', movement: { canMove: true, canGank: true } } })]).evaluate(unit.ref);
  assert.equal(result.movement.canMove, true);
  assert.equal(result.movement.canGank, true);
});

test('layers-movement-restriction: restrictions can disable movement', () => {
  const unit = object('unit');
  const result = engine([unit], [permanent({ id: 'stop', layer: 'ability', filter: { objectId: 'unit' }, effect: { kind: 'restrict-movement', movement: { allowed: false }, restriction: 'cannot-move' } })]).evaluate(unit.ref);
  assert.equal(result.movement.allowed, false);
  assert.ok(result.movement.restrictions.includes('cannot-move'));
});

test('layers-derived-might-bridge: blocked strict Duel results leave layer Might unchanged', () => {
  const unit = object('unit', { might: 3 });
  const resolver = createDuelDerivedMightResolver({ evaluate: () => ({ status: 'blocked' }) });
  assert.equal(engine([unit], [], { derivedMight: resolver }).evaluate(unit.ref).might, 3);
});

test('layers-derived-might-bridge-complete: complete strict Duel results replace derived Might', () => {
  const unit = object('unit', { might: 3 });
  const resolver = createDuelDerivedMightResolver({ evaluate: () => ({ status: 'complete', currentMight: 6 }) });
  assert.equal(engine([unit], [], { derivedMight: resolver }).evaluate(unit.ref).might, 6);
});

test('layers-order-is-copy-trait-ability-arithmetic: contract order is exported', () => {
  assert.deepEqual(LAYER_ORDER, ['copy', 'trait', 'ability', 'arithmetic']);
});
