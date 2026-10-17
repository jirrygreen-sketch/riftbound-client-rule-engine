// Rules golden test — scenario `turn-pending-item-added-cleanup-before-finalize`.
//
// CR v1.5 319.3 / 320 / 334.1 / 334.2: a Cleanup is made an Outstanding Task right
// after a Pending Item is added to the Chain, and HOT FEPR handles Outstanding
// Tasks before Finalize. Lethal damage produced while resolving the earlier item
// is therefore handled by the Cleanup that the newly added Pending Item itself
// triggers — the Unit dies before that item is Finalized.
//
// Subject: src/chain/engine.ts (item append → cleanup-requested → HOT FEPR) over
// src/events/pipeline.ts and the reference kernel. The damage is a real committed
// GameAction; the trigger is registered through the public pipeline API; the kill
// is committed by the engine's Cleanup.
import test from 'node:test';
import assert from 'node:assert/strict';

import { turnFixture, timings, timingsAfter, markEvents, assertSubsequence, settle } from './harness.mjs';

test('turn-pending-item-added-cleanup-before-finalize (319.3 / 334.1): the appended trigger waits for Cleanup before Finalize', () => {
  const f = turnFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    setup: w => w.unit('u1', { location: { type: 'battlefield', id: 'bf1' }, might: 3, damage: 2 }),
  });
  // The Unit is not yet lethal; its death comes from damage dealt inside the
  // resolving activated ability, and the trigger item is appended by that timing.
  f.trigger('last-word', 'damage-dealt', [{ id: 'draw', op: 'effect.draw', args: { amount: { kind: 'constant', value: 1 } } }]);
  f.flow.start();
  assert.equal(f.kernel.getObject('u1').zone, 'board');

  const mark = markEvents(f);
  f.flow.execute(f.activated('zap', [{
    id: 'zap', op: 'effect.damage', args: { amount: { kind: 'constant', value: 1 }, target: 'target' },
    targets: [{ id: 'target', filter: { objectId: 'u1', type: 'unit', zone: 'board' }, min: 1, max: 1 }],
  }]));
  settle(f);

  // 319.3: the damage event appends the trigger, and that Pending Item requests a
  // Cleanup before it can be Finalized. The kill is committed by that Cleanup, so
  // it lands before the trigger item's own Finalize (334.1/334.2).
  const committed = timingsAfter(f, mark);
  const triggerItem = f.flow.chain.pipeline.events
    .filter(event => event.timingPoint === 'chain-item-finalize' && String(event.details?.item).startsWith('trigger:'))
    .map(event => event.details.item)[0];
  assert.ok(triggerItem, 'the appended triggered ability was placed on the Chain');
  assertSubsequence(committed, ['damage-dealt', 'chain-item-pending', 'object-killed', 'chain-item-finalize']);
  assert.equal(committed.indexOf('damage-dealt') < committed.indexOf('object-killed'), true);
  const killIndex = f.flow.chain.pipeline.events.findIndex(event => event.timingPoint === 'object-killed');
  const triggerFinalizeIndex = f.flow.chain.pipeline.events
    .findIndex(event => event.timingPoint === 'chain-item-finalize' && event.details?.item === triggerItem);
  assert.equal(killIndex < triggerFinalizeIndex, true, 'the Cleanup resolved the lethal damage before the trigger was finalized');

  // The Cleanup runs while the item is still Pending (CR 320/320.1), then the FEPR
  // finishes the item and its controller draws.
  assert.equal(f.kernel.getObject('u1').zone, 'trash');
  assert.equal(f.kernel.player('A').handCount, 2);
  assert.equal(f.flow.chain.items.length, 0);
  // A Cleanup is an Outstanding Task, so the pipeline's own markers bracket it.
  assert.equal(timings(f).includes('cleanup-start'), true);
});
