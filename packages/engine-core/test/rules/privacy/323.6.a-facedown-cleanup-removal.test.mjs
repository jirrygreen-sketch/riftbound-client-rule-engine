// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-facedown-removed-on-cleanup-still-hidden-then-revealed (CR v1.5 323.6.a, 107.3.d, 422.4)
//
// CR v1.5 422.4 requires the owner to reveal the facedown card to all players
// before the zone change. The real cleanup therefore commits Reveal and then
// Move-Zone; either failure rolls back both under the surrounding Chain atomic.
import test from "node:test";
import assert from "node:assert/strict";
import { bindResolveContext, createActionPipelineHost } from "../../../dist/events/action-adapter.js";
import { world } from "../../../dist/effects/testing/test-kernel.js";
import { TurnFlow } from "../../../dist/turn/flow.js";
import { createHiddenState, hideCard } from "../../../dist/zones/hidden/index.js";

function fixture({ fields, hiddenController }) {
  const kernel = world().player('A').player('B')
    .base('source', { might: 4 }).deck(['A:d'], { owner: 'A' }).deck(['B:d'], { owner: 'B' })
    .rune(['A:r'], { owner: 'A' }).rune(['B:r'], { owner: 'B' })
    .hand('hidden', { keywords: [{ id: 'Hidden' }] }).build();
  const hidden = kernel.getObject('hidden');
  const state = hideCard(createHiddenState(fields.map(({ id }) => ({
    battlefieldId: id, controller: hiddenController,
  }))), {
    card: hidden, player: hiddenController, battlefieldId: 'bf1', openState: true,
  }).state;
  kernel.addObject({ ...hidden, controller: hiddenController, faceDown: true, zone: 'board',
    location: { type: 'battlefield', id: 'bf1' } }, 'board');
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => { throw new Error('cleanup requires no choice'); },
    context: (source, controller, timing) => bindResolveContext(kernel, { source, controller, timingPoint: timing }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const flow = new TurnFlow({
    host, player: id => kernel.player(id), turnOrder: ['A', 'B'],
    battlefields: fields, hiddenState: state,
  });
  return { kernel, hidden, state, flow };
}

test("privacy-facedown-removed-on-cleanup-still-hidden-then-revealed", () => {
  const success = fixture({ fields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }], hiddenController: 'A' });
  const { kernel, hidden, flow } = success;
  flow.start();
  assert.equal(kernel.getObject('hidden').zone, 'trash');
  const revealed = flow.chain.pipeline.events.find(event => event.timingPoint === 'card-revealed');
  assert.ok(revealed, 'CR422.4 requires a real public Reveal when Hidden changes zones');
  assert.deepEqual(revealed.object.ref, { id: 'hidden', zoneEntryId: hidden.ref.zoneEntryId });
  assert.equal(revealed.details.visibility, 'all');
  const timings = flow.chain.pipeline.events.map(event => event.timingPoint);
  assert.ok(timings.indexOf('card-revealed') < timings.indexOf('object-enters-trash'));
  assert.equal(flow.hidden().zones.bf1.cards.length, 0);
  assert.ok(kernel.events.some(event => event.action === 'reveal'));

  // A failed zone change cannot leave the earlier Reveal committed or silently
  // remove the sidecar entry. TurnFlow itself records the real A -> B control
  // loss during the first Cleanup, then the outer transaction restores host,
  // pipeline, Hidden sidecar, and every turn-owned checkpoint together.
  const rollback = fixture({ fields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }], hiddenController: 'A' });
  const rollbackFlow = rollback.flow;
  const rollbackBefore = rollback.kernel.snapshot();
  rollback.flow.chain.pipeline.registerReplacement({ id: 'reject-trash',
    matches: action => action.type === 'move-zone' && action.to === 'trash',
    apply: () => ({ status: 'prevent' }) });
  assert.throws(() => rollback.flow.start(), /Hidden cleanup Move-Zone was rejected/);
  assert.deepEqual(rollback.kernel.snapshot(), rollbackBefore);
  assert.equal(rollbackFlow.hidden().zones.bf1.cards.length, 1);
  assert.equal(rollbackFlow.chain.pipeline.events.some(event => event.timingPoint === 'card-revealed'), false,
    'the Reveal preceding the rejected Move-Zone must roll back too');
});

