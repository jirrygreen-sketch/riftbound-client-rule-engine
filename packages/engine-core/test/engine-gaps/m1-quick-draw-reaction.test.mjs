// RIFT-884 - Quick-Draw's inherent Reaction permission through the production
// describePlay/ChainEngine path.
//
// CR v1.5 (2026-10-09), 813.1.b/813.1.c.1 and 819.1.b/819.1.c/819.1.d:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// A Quick-Draw Gear has Reaction inherently; its play and the consequent
// attach may use Reaction timing. The timing is carried by the keyword's
// expanded static continuous.timing permission, scoped to the source itself.
import assert from 'node:assert/strict';
import test from 'node:test';

import bfSword from '../../../card-dsl/dist/cards/sfd/bf-sword.js';
import longSword from '../../../card-dsl/dist/cards/sfd/long-sword.js';
import premonition from '../../../card-dsl/dist/cards/sfd/premonition.js';
import { fixture, settle } from '../rules/keywords/support.mjs';

const LONG_SWORD = longSword.canonicalCardId;

function scene(gear = longSword, gearKeywords = []) {
  return fixture({
    programs: [premonition, gear],
    energy: { A: 10, B: 10 },
    power: { A: ['Fury'], B: ['Mind', 'Mind', 'Mind'] },
    turnPlayer: 'B',
    answers: { 'target:quick-draw-unit': ['rumble'] },
    setup: w => w
      .hand('reaction', {
        cardId: premonition.canonicalCardId,
        types: ['spell'],
        energy: 2,
        power: ['Mind'],
      })
      .hand('gear', {
        cardId: gear.canonicalCardId,
        types: ['gear'],
        tags: ['Equipment'],
        energy: gear === longSword ? 2 : 4,
        power: gear === longSword ? ['Fury'] : null,
        might: gear === longSword ? 2 : 3,
        keywords: gearKeywords,
      })
      .base('rumble', { might: 2 }),
  });
}

function enterClosedState(f) {
  const reaction = f.binding.describePlay(
    { type: 'play', player: 'B', object: f.ref('reaction') },
    f.get('reaction'),
  );
  assert.equal(reaction.speed, 'reaction');
  f.engine.execute(reaction);
  assert.equal(f.engine.turnState, 'neutral-closed');
  f.engine.pass('B');
  assert.equal(f.engine.priority, 'A');
}

test('RIFT-884 CR 819.1.b/c: production describePlay lets Long Sword play in a Closed State and attach', () => {
  const f = scene();
  enterClosedState(f);

  const draft = f.binding.describePlay(
    { type: 'play', player: 'A', object: f.ref('gear') },
    f.get('gear'),
  );
  assert.equal(draft.speed, 'reaction');

  f.engine.execute(draft);
  assert.equal(f.engine.turnState, 'neutral-closed');
  const pending = f.engine.trace.filter(entry => entry.step === 'pending').map(entry => entry.item);
  assert.ok(pending.includes(draft.id), 'the production Play entered the chain');
  assert.ok(pending.includes('trigger:1'), 'the Quick-Draw card-played trigger entered the chain');
  settle(f.engine);

  assert.equal(f.get('gear').zone, 'board');
  assert.deepEqual(f.get('gear').attachedTo, f.ref('rumble'), 'CR 819.1.d triggered attach completed');
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'card-played'), true);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-attached'), true);
  assert.deepEqual(f.errors, [], 'the production lifecycle reported no binding failures');
  assert.equal(f.binding.describeActivate(f.get('gear'), 'A').speed, 'action',
    'CR 818/819: Quick-Draw does not turn the separate Equip activation into Reaction');
  assert.equal(f.kernel.player('A').energy, 8, 'only the 2 printed Energy was paid');
  assert.deepEqual(f.kernel.player('A').power, [], 'the printed Fury Power was paid');
});

test('RIFT-884 CR 819.1: An Equipment without Quick-Draw remains normal-speed and is atomically rejected', () => {
  const f = scene(bfSword);
  enterClosedState(f);

  const draft = f.binding.describePlay(
    { type: 'play', player: 'A', object: f.ref('gear') },
    f.get('gear'),
  );
  assert.equal(draft.speed, 'normal');
  const before = f.kernel.snapshot();
  assert.throws(() => f.engine.execute(draft), /Action is not legally timed/);
  assert.deepEqual(f.kernel.snapshot(), before, 'a rejected Play changed no authoritative state');
  assert.equal(f.engine.items.length, 1, 'only Premonition remains on the chain');
});

test('RIFT-884 CR 819.1.b/c: only an exact source-bound play permission grants speed', () => {
  const f = scene(longSword, [{ id: 'Quick-Draw' }]);
  const inspect = f.binding.inspect(f.get('gear'));
  const timings = inspect.abilities.filter(ability =>
    ability.kind === 'static' && ability.effect.kind === 'continuous.timing');
  assert.equal(timings.length, 1);
  assert.deepEqual(timings[0].effect.value, { kind: 'constant', value: 'reaction' });
  assert.equal(timings[0].effect.scope, 'source');
  assert.deepEqual(timings[0].effect.source, { canonicalCardId: LONG_SWORD });
  assert.deepEqual(timings[0].effect.permissions, ['play', 'attach']);

  const draft = f.binding.describePlay(
    { type: 'play', player: 'A', object: f.ref('gear') },
    { ...f.get('gear'), keywords: [] },
  );
  assert.equal(draft.speed, 'reaction', 'the printed program keyword expansion supplies the permission');

  const permissionProgram = (permissions, source = 'test:eg-timing-source') => ({
    canonicalCardId: 'test:eg-timing-source',
    rulesetVersion: 'core-1.5',
    status: 'executable',
    sourceText: 'synthetic permission regression',
    abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: [] }, {
      kind: 'static',
      effect: {
        kind: 'continuous.timing',
        value: { kind: 'constant', value: 'reaction' },
        source: { canonicalCardId: source },
        scope: 'source',
        permissions,
      },
    }],
  });
  const limitedProgram = permissionProgram(['attach']);
  const attachOnlyFixture = fixture({
    programs: [limitedProgram],
    setup: w => w.hand('gear', { cardId: limitedProgram.canonicalCardId, types: ['gear'], energy: 2, power: ['Fury'] }),
  });
  assert.equal(attachOnlyFixture.binding.describePlay(
    { type: 'play', player: 'A', object: attachOnlyFixture.ref('gear') },
    attachOnlyFixture.get('gear'),
  ).speed, 'normal', 'the attach-only permission does not authorize the Play itself');

  const wrongSourceProgram = permissionProgram(['play'], 'test:another-card');
  const wrongSourceFixture = fixture({
    programs: [wrongSourceProgram],
    setup: w => w.hand('gear', { cardId: wrongSourceProgram.canonicalCardId, types: ['gear'], energy: 2, power: ['Fury'] }),
  });
  assert.equal(wrongSourceFixture.binding.describePlay(
    { type: 'play', player: 'A', object: wrongSourceFixture.ref('gear') },
    wrongSourceFixture.get('gear'),
  ).speed, 'normal', 'another source\'s permission cannot raise this card\'s speed');
});

test('RIFT-884 fail-closed: an unknown play speed cannot become a Chain speed', () => {
  const program = {
    canonicalCardId: 'test:eg-unknown-play-speed',
    rulesetVersion: 'core-1.5',
    status: 'executable',
    sourceText: 'synthetic timing regression',
    abilities: [
      { kind: 'play', cost: { kind: 'printed' }, body: [] },
      {
        kind: 'static',
        effect: {
          kind: 'continuous.timing',
          value: { kind: 'constant', value: 'instant' },
          source: { canonicalCardId: 'test:eg-unknown-play-speed' },
          scope: 'source',
          permissions: ['play'],
        },
      },
    ],
  };
  const f = fixture({
    programs: [program],
    setup: w => w.hand('gear', { cardId: program.canonicalCardId, types: ['gear'], energy: 0, power: null }),
  });
  const before = f.kernel.snapshot();
  assert.throws(
    () => f.binding.describePlay(
      { type: 'play', player: 'A', object: f.ref('gear') },
      f.get('gear'),
    ),
    error => error?.code === 'judge-required' && /unknown speed instant/.test(error.message),
  );
  assert.equal(f.engine.items.length, 0);
  assert.deepEqual(f.kernel.snapshot(), before, 'rejecting an unknown speed changed no authority');
});
