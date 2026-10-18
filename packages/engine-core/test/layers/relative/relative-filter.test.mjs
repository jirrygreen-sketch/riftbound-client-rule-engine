import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesRelativeController, matchesRelativeExclusion, matchesRelativeLocation, matchesRelativeOwner, matchesRelativePosition } from '../../../dist/layers/relative/filter.js';
import { matchesRelativeRegion } from '../../../dist/layers/relative/filter.js';
import { sameLocation } from '../../../dist/layers/relative/location.js';
import { matchesObjectFilter } from '../../../dist/layers/filter.js';

let nextZoneEntryId = 1;
const snapshot = overrides => ({
  ref: { id: overrides?.ref?.id ?? 'unit', zoneEntryId: overrides?.ref?.zoneEntryId ?? nextZoneEntryId++ },
  cardId: 'card.unit',
  name: 'Unit',
  types: ['unit'],
  tags: [],
  keywords: [],
  owner: 'A',
  controller: 'A',
  zone: 'board',
  location: { type: 'battlefield', id: 'battlefield-1' },
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
});
const anchor = snapshot({});
const enemyAnchor = snapshot({ controller: 'B', ref: { id: 'enemy-anchor', zoneEntryId: 20 } });
const ally = snapshot({ ref: { id: 'ally', zoneEntryId: 30 } });
const enemy = snapshot({ controller: 'B', ref: { id: 'enemy', zoneEntryId: 40 } });

test('matchesRelativeController resolves self/you/controller against the anchor', () => {
  assert.equal(matchesRelativeController('self', 'A', anchor), true);
  assert.equal(matchesRelativeController('you', 'A', anchor), true);
  assert.equal(matchesRelativeController('controller', 'A', anchor), true);
  assert.equal(matchesRelativeController('self', 'B', anchor), false);
  // Relative opposition resolves to "not the anchor controller".
  assert.equal(matchesRelativeController('opponent', 'B', anchor), true);
  assert.equal(matchesRelativeController('opponent', 'A', anchor), false);
  assert.equal(matchesRelativeController('their', 'B', anchor), true);
});

test('matchesRelativeController fails closed without an anchor for relative forms', () => {
  assert.equal(matchesRelativeController('self', 'A', null), true, 'self falls back to absolute match without an anchor');
  assert.equal(matchesRelativeController('opponent', 'B', null), false, 'opponent needs a controller anchor');
  assert.equal(matchesRelativeController('opponent', 'A', undefined), false);
});

test('matchesRelativeController supports wrapped and absolute selectors', () => {
  assert.equal(matchesRelativeController({ kind: 'constant', value: 'self' }, 'A', anchor), true);
  assert.equal(matchesRelativeController({ kind: 'constant', value: 'B' }, 'B', anchor), true);
  assert.equal(matchesRelativeController({ playerId: 'B' }, 'B', anchor), true);
  assert.equal(matchesRelativeController('A', 'A', null), true, 'absolute ids match without an anchor');
  assert.equal(matchesRelativeController('any', 'B', null), true);
});

test('matchesRelativeOwner matches ownership rather than control', () => {
  const stolen = snapshot({ controller: 'B', owner: 'A' });
  assert.equal(matchesRelativeOwner('self', 'A', anchor), true, 'self resolves to the anchor controller, not owner');
  assert.equal(matchesRelativeOwner('self', 'A', stolen), false, 'the stolen unit no longer matches the anchor controller');
  assert.equal(matchesRelativeOwner('opponent', 'A', enemyAnchor), true, 'the original owner is the anchor opponent');
});

test('matchesRelativeLocation resolves here/base/battlefield through the anchor', () => {
  const base = snapshot({ location: { type: 'base', player: 'A' } });
  const battlefield = snapshot({});
  const otherField = snapshot({ location: { type: 'battlefield', id: 'battlefield-2' } });
  const selfLoc = { type: 'battlefield', id: 'battlefield-1' };
  const here = { kind: 'location', value: 'self' };
  assert.equal(matchesRelativeLocation(here, battlefield, anchor), true);
  assert.equal(matchesRelativeLocation(here, otherField, anchor), false);
  assert.equal(matchesRelativeLocation('base', base, anchor), true, 'a concrete base location matches by type');
  assert.equal(matchesRelativeLocation({ type: 'base', player: 'A' }, base, anchor), true);
  assert.equal(matchesRelativeLocation({ type: 'base', player: 'B' }, base, anchor), false);
  assert.equal(matchesRelativeLocation('battlefield', battlefield, anchor), true);
  assert.equal(matchesRelativeLocation('battlefield', base, anchor), false);
  assert.equal(matchesRelativeLocation({ source: 'self' }, battlefield, anchor), true, 'the wrapper spelling matches too');
});

test('matchesRelativeLocation fails closed without an anchor for relative forms', () => {
  const battlefield = snapshot({});
  assert.equal(matchesRelativeLocation('self', battlefield, null), false);
  assert.equal(matchesRelativeLocation('here', battlefield, undefined), false);
});

test('sameLocation compares structured battlefield and base locations', () => {
  assert.equal(sameLocation({ type: 'battlefield', id: 'battlefield-1' }, { type: 'battlefield', id: 'battlefield-1' }), true);
  assert.equal(sameLocation({ type: 'battlefield', id: 'battlefield-1' }, { type: 'battlefield', id: 'battlefield-2' }), false);
  assert.equal(sameLocation({ type: 'base', player: 'A' }, { type: 'base', player: 'A' }), true);
  assert.equal(sameLocation({ type: 'base', player: 'A' }, { type: 'base', player: 'B' }), false);
  assert.equal(sameLocation({ type: 'battlefield', id: 'x' }, { type: 'base', player: 'A' }), false);
  assert.equal(sameLocation(null, { type: 'battlefield', id: 'x' }), false);
  assert.equal(sameLocation(undefined, undefined), false, 'missing locations are not comparable');
  assert.equal(sameLocation(null, null), false, 'null locations are not identifiable');
  assert.equal(sameLocation(null, undefined), false);
});

test('matchesRelativePosition resolves here against the anchor location', () => {
  const here = snapshot({});
  const elsewhere = snapshot({ location: { type: 'battlefield', id: 'battlefield-2' } });
  assert.equal(matchesRelativePosition('here', here, anchor), true);
  assert.equal(matchesRelativePosition('here', elsewhere, anchor), false);
  assert.equal(matchesRelativePosition('self', here, anchor), true);
  assert.equal(matchesRelativePosition('here', here, null), false, 'here needs an anchor');
});

test('matchesRelativeRegion matches board and battlefield kinds without an anchor', () => {
  const battlefield = snapshot({});
  const base = snapshot({ location: { type: 'base', player: 'A' } });
  assert.equal(matchesRelativeRegion('board', battlefield), true);
  assert.equal(matchesRelativeRegion('board', base), false);
  assert.equal(matchesRelativeRegion('battlefield', battlefield), true);
  assert.equal(matchesRelativeRegion('battlefield', base), false);
});

test('matchesRelativeExclusion drops only the anchor object itself', () => {
  const self = snapshot({ ref: { id: 'unit', zoneEntryId: 1 } });
  const other = snapshot({ ref: { id: 'other', zoneEntryId: 2 } });
  assert.equal(matchesRelativeExclusion('self', self, anchor), false, 'the anchor is excluded');
  assert.equal(matchesRelativeExclusion('self', other, anchor), true);
  assert.equal(matchesRelativeExclusion(true, other, anchor), true, 'true excludes the anchor only');
  assert.equal(matchesRelativeExclusion(true, self, anchor), false);
  assert.equal(matchesRelativeExclusion(undefined, self, anchor), true, 'undefined keeps everything');
  assert.equal(matchesRelativeExclusion(false, self, anchor), true);
  assert.equal(matchesRelativeExclusion(true, other, null), false, 'exclusion needs an anchor');
});

test('matchesObjectFilter applies relative selectors only through the anchor', () => {
  const filter = { type: 'unit', controller: 'opponent', other: true };
  assert.equal(matchesObjectFilter(filter, enemy, anchor), true);
  assert.equal(matchesObjectFilter(filter, ally, anchor), false, 'the anchor controller is not an opponent');
  assert.equal(matchesObjectFilter(filter, enemy, null), false, 'opponent needs an anchor');
  assert.equal(matchesObjectFilter({ type: 'unit', controller: 'self' }, ally, null), true, 'absolute self falls back to historical behavior');
});

test('matchesObjectFilter ignores relative fields without an anchor', () => {
  const here = snapshot({});
  const elsewhere = snapshot({ location: { type: 'battlefield', id: 'battlefield-2' } });
  const selfSnapshot = snapshot({ ref: { id: 'unit', zoneEntryId: 1 } });
  const otherObject = snapshot({ ref: { id: 'other', zoneEntryId: 2 } });
  // Historical no-anchor behavior: relative position/location forms are skipped.
  assert.equal(matchesObjectFilter({ type: 'unit', sameLocationAs: 'self' }, here, null), true);
  assert.equal(matchesObjectFilter({ type: 'unit', sameLocationAs: 'self' }, elsewhere, null), true, 'the field is neither applied nor failed');
  assert.equal(matchesObjectFilter({ type: 'unit', here: true }, elsewhere, undefined), true);
  assert.equal(matchesObjectFilter({ type: 'unit', position: 'here' }, elsewhere, null), true);
  // Historical exclusion behavior: without an anchor nothing is excluded.
  assert.equal(matchesObjectFilter({ type: 'unit', other: true }, selfSnapshot, null), true, 'other:true keeps the object without an anchor');
  assert.equal(matchesObjectFilter({ type: 'unit', exclude: 'self' }, selfSnapshot, null), true, 'exclude:self keeps the object without an anchor');
  // With an anchor the same filters still apply.
  assert.equal(matchesObjectFilter({ type: 'unit', other: true }, selfSnapshot, selfSnapshot), false);
  assert.equal(matchesObjectFilter({ type: 'unit', other: true }, otherObject, selfSnapshot), true);
  assert.equal(matchesObjectFilter({ type: 'unit', here: true }, here, selfSnapshot), true);
  assert.equal(matchesObjectFilter({ type: 'unit', here: true }, elsewhere, selfSnapshot), false);
  // Structured object locations keep matching without an anchor.
  assert.equal(matchesObjectFilter({ type: 'unit', location: { type: 'battlefield', id: 'battlefield-1' } }, here, null), true);
  assert.equal(matchesObjectFilter({ type: 'unit', location: { type: 'battlefield', id: 'battlefield-2' } }, here, null), false);
});

test('matchesObjectFilter supports here, sameLocationAs, and keywords', () => {
  const nearby = snapshot({});
  const far = snapshot({ location: { type: 'battlefield', id: 'battlefield-2' } });
  const shielded = snapshot({ keywords: [{ id: 'shield', value: 1 }] });
  assert.equal(matchesObjectFilter({ type: 'unit', here: true }, nearby, anchor), true);
  assert.equal(matchesObjectFilter({ type: 'unit', here: true }, far, anchor), false);
  assert.equal(matchesObjectFilter({ type: 'unit', sameLocationAs: 'self' }, nearby, anchor), true);
  assert.equal(matchesObjectFilter({ type: 'unit', sameLocationAs: 'self' }, far, anchor), false);
  assert.equal(matchesObjectFilter({ type: 'unit', keywords: ['shield'] }, shielded, anchor), true);
  assert.equal(matchesObjectFilter({ type: 'unit', keywords: ['shield'] }, nearby, anchor), false);
  assert.equal(matchesObjectFilter({ type: 'unit', zone: 'trash' }, snapshot({ zone: 'trash' }), anchor), true, 'discard aliases to trash');
});

test('matchesObjectFilter supports region and position', () => {
  const battlefield = snapshot({});
  const base = snapshot({ location: { type: 'base', player: 'A' } });
  assert.equal(matchesObjectFilter({ region: 'battlefield' }, battlefield, anchor), true);
  assert.equal(matchesObjectFilter({ region: 'battlefield' }, base, anchor), false);
  assert.equal(matchesObjectFilter({ region: 'board' }, battlefield, anchor), true);
  assert.equal(matchesObjectFilter({ position: 'here' }, battlefield, anchor), true);
  assert.equal(matchesObjectFilter({ position: 'here' }, base, anchor), false);
});
