// Scenario: combat-deathknell-removed-when-death-replaced
// CR v1.5 808.1.d.1, 808.1.d, 429.1, 370 (replacement effect before the event).
//
// Executed: when the Kill is replaced (recall instead of death) the object-killed
// event never happens, so the Deathknell trigger is never added to the chain and the
// Permanent reaches neither Trash nor the trigger. The replacement is registered on
// the real event pipeline, which intercepts the GameAction before it is performed.
//
// Boundary: 808.1.d.1 also covers the case where the trigger was ALREADY on the chain
// and must then be removed from it. That half needs a chain-item removal path for a
// pending item whose source no longer matches the death requirement (see the todo).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  c, drainChain, drawInstruction, eventsOf, flowFixture, killInstruction, markEvents, timingsAfter,
} from './harness.mjs';

test('combat-deathknell-removed-when-death-replaced (808.1.d.1): a replaced death never adds the Deathknell trigger to the chain', () => {
  const f = flowFixture({
    // bf1 is already controlled by the Permanent's controller, so the setup Unit
    // applies no Contested state and the turn stays in a normal Main Phase.
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    setup: w => w.unit('victim', { might: 2, location: { type: 'battlefield', id: 'bf1' } })
      .hand('slay', { types: ['spell'], energy: 0 }),
  });
  f.trigger('deathknell:victim', 'object-killed', [drawInstruction('dk-draw', 1)],
    { sourceId: 'victim', controller: 'A', filter: { objectId: 'victim' } });
  // The real replacement: the death is replaced by returning the Permanent to its base.
  f.flow.chain.pipeline.registerReplacement({
    id: 'replace-death-with-recall',
    matches: action => action.type === 'kill' && action.object.id === 'victim',
    apply: action => ({
      status: 'replace',
      actions: [{ type: 'move-location', object: action.object, to: { type: 'base', player: 'A' } }],
    }),
  });
  f.flow.start();
  const handBefore = f.kernel.player('A').handSize;
  const mark = markEvents(f);

  f.flow.execute(f.spell('slay', [killInstruction('kill', 'victim')], {
    controller: 'A', speed: 'action', cost: { id: 'cost:slay', cost: { energy: c(0), power: c([]) } },
  }));
  drainChain(f);

  const events = timingsAfter(f, mark);
  assert.ok(!events.includes('object-killed'), '808.1.d.1: the death event never happened');
  const victimEvents = eventsOf(f).slice(mark)
    .filter(event => event.object?.ref?.id === 'victim' || event.target?.ref?.id === 'victim');
  assert.deepEqual(victimEvents.map(event => event.timingPoint),
    ['became-target', 'object-moved', 'object-leaves-battlefield', 'object-enters-base'],
    'the Permanent moved to base instead of being killed (Recall is not a Move)');
  assert.equal(eventsOf(f).slice(mark).filter(event => event.timingPoint === 'chain-item-pending')
    .filter(event => event.object?.ref?.id === 'victim').length, 0,
  'no Deathknell Pending item was added for the saved Permanent');
  assert.equal(f.kernel.getObject('victim').zone, 'board');
  assert.deepEqual(f.kernel.getObject('victim').location, { type: 'base', player: 'A' });
  // Only the played spell left Hand: the Deathknell draw never resolved, because
  // the replaced death produced no trigger at all.
  assert.equal(f.kernel.player('A').handSize, handBefore - 1, 'the Deathknell draw never resolved');
  assert.equal(f.flow.chain.items.length, 0);
});

test.todo(
  'combat-deathknell-removed-when-death-replaced (808.1.d.1, removal half): when the trigger was already '
  + 'added as a Pending chain item and the death is then replaced, the item must be REMOVED from the chain '
  + '(the YAML expects chain.item-removed for deathknell:#d1). Missing: no public chain-item removal path — '
  + 'ChainEngine.remove() is private and only used by its own Resolve/Finalize flow, and the trigger scan '
  + 'runs after the affected action\'s zone-change wave, so a trigger collected at object-killed can never '
  + 'be retracted by a later replacement. Needs an atomic Kill/replacement transaction that owns both the '
  + 'Pending collection and its retraction',
);
