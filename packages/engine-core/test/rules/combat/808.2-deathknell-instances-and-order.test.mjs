// Scenario: combat-deathknell-pending-before-trash (CR v1.5 808.1.d.2, 808.1.d.3, 808.2, 808.2.a)
//
// Executed here: (a) a Permanent carrying TWO Deathknell instances triggers them
// separately (808.2) and its controller chooses their chain order (808.2.a), and
// (b) each Pending item keeps the dying Permanent's pre-Trash information as the
// trigger snapshot (808.1.d.3 / 429.1.a.1.b). The kill happens through a real spell
// chain driven by TurnFlow/ChainEngine over the shared event pipeline.
//
// The strict 808.1.d.2 ordering half of the scenario (“the trigger is added to the
// chain as a Pending Item BEFORE the card is moved to the trash”) is registered as
// the todo below: the merged pipeline publishes a whole action group (killed →
// enters-trash) before it drains the suspended trigger scan, so the Pending item is
// observable only after the Trash move.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  c, drainChain, drawInstruction, eventsOf, flowFixture, killInstruction, markEvents, timingsAfter,
} from './harness.mjs';

function deathknellScene(choose) {
  const f = flowFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    setup: w => w.unit('victim', { might: 2, location: { type: 'battlefield', id: 'bf1' } })
      .hand('slay', { types: ['spell'], energy: 0 }),
    choose,
  });
  // Both instances live on the same Permanent; 808.2 keeps them separate.
  f.trigger('deathknell:victim:draw', 'object-killed', [drawInstruction('dk-draw', 1)],
    { sourceId: 'victim', controller: 'A', filter: { objectId: 'victim' } });
  f.trigger('deathknell:victim:energy', 'object-killed',
    [{ id: 'dk-energy', op: 'effect.resources', args: { energy: c(1) } }],
    { sourceId: 'victim', controller: 'A', filter: { objectId: 'victim' } });
  f.flow.start();
  return f;
}

const slayDraft = f => f.spell('slay', [killInstruction('kill', 'victim')], {
  controller: 'A', speed: 'action', cost: { id: 'cost:slay', cost: { energy: c(0), power: c([]) } },
});

test('combat-deathknell-pending-before-trash (808.2.a): the controller chooses the order of two Deathknell instances on one Permanent', () => {
  // The controller picks the SECOND offered registration: its item is added to the
  // chain first, i.e. closest to the bottom of the stack (808.2.a).
  const f = deathknellScene(request =>
    request.type === 'mode' && request.options.length === 2 ? request.options[1] : undefined);
  const mark = markEvents(f);
  f.flow.execute(slayDraft(f));
  drainChain(f);

  const events = timingsAfter(f, mark);
  assert.equal(events.filter(id => id === 'object-killed').length, 1, '429.1: one Kill really happened');
  assert.equal(events.filter(id => id === 'chain-item-pending').length, 3,
    'the kill spell plus BOTH Deathknell instances each entered the chain as a Pending item');
  const pendingIds = eventsOf(f)
    .filter(event => event.timingPoint === 'chain-item-pending')
    .map(event => event.details?.item ?? event.object?.cardId)
    .filter(Boolean);
  assert.ok(pendingIds.length >= 3);
  assert.equal(f.kernel.player('A').handSize, 2, 'the two chosen effects resolved: draw 1 + the played card left Hand');
  assert.equal(f.kernel.player('A').energy, 1, 'the second instance granted its 1 Energy');
});

test('combat-deathknell-pending-before-trash (808.2.a): the opposite order choice produces the opposite chain order', () => {
  const f = deathknellScene(request =>
    request.type === 'mode' && request.options.length === 2 ? request.options[0] : undefined);
  f.flow.execute(slayDraft(f));
  f.flow.pass(f.flow.chain.priority);
  f.flow.pass(f.flow.chain.priority);
  assert.equal(f.flow.chain.items.length, 2, 'both instances became real chain items');
  assert.deepEqual(f.flow.chain.items.map(item => item.trigger.registration.id),
    ['deathknell:victim:draw', 'deathknell:victim:energy'],
    'the controller\'s first-listed choice is the item added first (808.2.a)');
  // 808.1.d.3: the trigger snapshot is the Permanent's PRE-Trash incarnation.
  const kernelObject = f.kernel.getObject('victim');
  assert.equal(kernelObject.zone, 'trash');
  assert.equal(kernelObject.ref.zoneEntryId, 2, 'the Trash entry is a new incarnation');
  for (const item of f.flow.chain.items) {
    assert.equal(item.trigger.source.ref.id, 'victim');
    assert.equal(item.trigger.source.ref.zoneEntryId, 1, 'the trigger kept the board incarnation');
    assert.equal(item.trigger.source.zone, 'board', '808.1.d.3: location and characteristics were noted before the move');
  }
});

test.todo(
  'combat-deathknell-pending-before-trash (808.1.d.2): the trigger must be observable as a Pending chain '
  + 'item BEFORE the card is moved to the Trash. The merged event pipeline publishes one whole action group '
  + '(object-leaves-*​ → object-killed → object-enters-trash) with the trigger scan suspended, so the '
  + 'Pending item is only created after the Trash entry. Needs an atomic Kill/Cleanup transaction that '
  + 'collects the source\'s death triggers and appends their Pending items inside the action, before the '
  + 'zone-change emissions',
);
