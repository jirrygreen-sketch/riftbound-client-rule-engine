// Scenario: movement-control-preserved-during-ongoing-showdown (CR v1.5 190.4.b, 190.4.c)
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, moveInstruction, pendingItems, settle, timings } from './support.mjs';

// The YAML does not specify contestedBy. B can legally contest A's Battlefield;
// the scene needs the Combat Showdown with both players' Units present (CR 462).
// Until Combat start is available, cover only 190.3.b.1 in a Non-Combat Showdown.
test('movement-control-preserved-during-ongoing-showdown: Contested survives its applier leaving an ongoing Non-Combat Showdown', () => {
  const f = fixture({
    setup: w => w.base('u1', { might: 2 }).hand('rx', { owner: 'B', types: ['spell'] }),
  });
  f.flow.start();
  f.flow.execute(f.activated('enter', [moveInstruction('enter', 'u1', { type: 'battlefield', id: 'bf1' })]));
  settle(f.flow);
  assert.equal(f.flow.chain.turnState, 'showdown-open');
  assert.equal(f.flow.battlefields[0].controller, null);
  assert.equal(f.flow.battlefields[0].contestedBy, 'A');
  const controlLostBefore = timings(f.flow).filter(timingPoint => timingPoint === 'control-lost').length;

  // B holds Focus after A passed (347.2.b) and reacts its own enemy-removal spell.
  f.flow.pass('A');
  assert.equal(f.flow.chain.focus, 'B');
  f.flow.execute(f.reaction('rx', [moveInstruction('out', 'u1', { type: 'base', player: 'A' })]));
  settle(f.flow);

  assert.deepEqual(f.kernel.getObject('u1').location, { type: 'base', player: 'A' });
  assert.equal(timings(f.flow).filter(timingPoint => timingPoint === 'object-moved').length, 2);
  assert.equal(
    timings(f.flow).filter(timingPoint => timingPoint === 'control-lost').length,
    controlLostBefore,
    'no Control was lost in the Non-Combat Showdown',
  );
  assert.equal(f.flow.battlefields[0].controller, null);
  assert.equal(
    f.flow.battlefields[0].contestedBy,
    'A',
    '190.3.b.1: Contested is not removed because a Showdown is ongoing there',
  );
  assert.equal(f.flow.chain.turnState, 'showdown-open');
  assert.deepEqual(pendingItems(f.flow), ['enter', 'reaction-rx']);
});

test.todo(
  'movement-control-preserved-during-ongoing-showdown: retaining controller A after its last Unit ' +
  'leaves the contested Battlefield needs the real Combat Showdown (190.4.b/323.5); ' +
  'CombatFlow.advance() is blocked on combat-start-transaction (atomic start and roles, CR 466.2). ' +
  'The Non-Combat Showdown test above covers Contested retention only, not the scene\'s Control assertion',
);
