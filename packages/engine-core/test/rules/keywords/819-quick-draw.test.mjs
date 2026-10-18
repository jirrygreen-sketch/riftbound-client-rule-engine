// docs/rules/scenarios/keywords.yaml — Quick-Draw (CR v1.5 819.1.c, 819.1.d).
//
// The merged Quick-Draw expansion is a static `continuous.timing` grant plus a
// `card-played` triggered ability; src/programs/triggers.ts registers the trigger on
// the real EventPipeline and src/programs/statics.ts binds the timing grant into the
// layer engine. The attach-on-play half executes end-to-end below.
import assert from 'node:assert/strict';
import test from 'node:test';
import quickDraw from '../../../dist/effects/keywords/Quick-Draw.js';
import { eventsAt, fixture, pendingItems, settle } from './support.mjs';

const QUICK_DRAW = 'test:quick-draw-gear';

const program = {
  canonicalCardId: QUICK_DRAW,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: '[Quick-Draw]',
  abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: [] }]
};

/** The gear in Hand plus the friendly Unit the attach trigger will pick. */
const position = () => ({
  programs: [program],
  energy: { A: 4 },
  answers: { 'target:quick-draw-unit': ['u1'] },
  setup: w => w
    .hand('gear', { cardId: QUICK_DRAW, types: ['gear'], energy: 2, power: [], keywords: [{ id: 'Quick-Draw' }] })
    .base('u1', { might: 3 })
});

test('keywords-quickdraw-attach-on-play: playing the Gear attaches it to a friendly Unit without a separate activation (CR 819.1.d)', () => {
  const f = fixture(position());
  f.play('gear');
  settle(f.engine);

  const gear = f.get('gear');
  assert.equal(gear.zone, 'board');
  assert.deepEqual(gear.attachedTo, f.ref('u1'));
  assert.equal(eventsAt(f.engine, 'object-attached').length, 1);
  const pending = pendingItems(f.engine);
  assert.equal(pending.length, 2, 'the Play item plus the attach trigger');
  assert.match(pending[1], /^trigger:/);
  assert.equal(f.kernel.player('A').energy, 2, 'the printed Energy cost was paid, not the Equip cost');
});

test('keywords-quickdraw-attach-on-play: the trigger is limited to the Quick-Draw host and a friendly Unit (CR 819.1.d, 819.1.a)', () => {
  const abilities = quickDraw.expand({ host: { canonicalCardId: QUICK_DRAW } });
  assert.equal(abilities.length, 2);
  const [timing, triggered] = abilities;
  assert.equal(timing.kind, 'static');
  assert.equal(timing.effect.kind, 'continuous.timing');
  assert.equal(triggered.kind, 'triggered');
  assert.equal(triggered.trigger.at, 'card-played');
  assert.deepEqual(triggered.body[0].targets, [{
    id: 'quick-draw-unit',
    filter: { type: 'unit', controller: 'self' },
    min: 1,
    max: 1,
    selection: 'one'
  }]);
  assert.equal(quickDraw.stacking, 'single');
  assert.ok(quickDraw.ruleRefs.includes('819.1.c'));
});

test('keywords-quickdraw-attach-on-play: with no friendly Unit the attach trigger has no legal target and the Gear stays unattached', () => {
  const f = fixture({
    programs: [program],
    energy: { A: 4 },
    setup: w => w.hand('gear', { cardId: QUICK_DRAW, types: ['gear'], energy: 2, power: [], keywords: [{ id: 'Quick-Draw' }] })
  });

  // The trigger enters the chain but its required ≥1 target cannot be selected.
  assert.throws(() => { f.play('gear'); settle(f.engine); });
  assert.equal(f.get('gear').attachedTo, null);
});

test.todo('keywords-quickdraw-playable-with-reaction-timing (CR 819.1.b/819.1.c): the printed keyword must let the Gear be played in a Closed State — blocked: `programs/keywords.ts abilitySpeed()` only maps the literal keyword ids `reaction`/`action`, and the Quick-Draw timing grant is a *static* ability that src/programs/lifecycle.ts binds only when the object enters the Board, so a Quick-Draw card in Hand still drafts at normal speed and the ChainEngine rejects it in a Closed State; the attach half above is real execution');
