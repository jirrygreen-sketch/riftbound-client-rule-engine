// RIFT-1156: an event's player must not depend on which ResolveContext was
// built last.
//
// Official evidence block
// -----------------------
// Riftbound Core Rules v1.5, updated 2026-10-09:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// Verified local copy: /root/swarm-rift/shared/rules/CR-v1.5.txt (read 2026-10-30).
// - CR 412.1: the player that performs a Game Action is responsible for it.
// - CR 412.4: "when you do something" triggers on a Game Action that you are
//   responsible for, so the recorded player decides which abilities trigger.
// Timeline: a rule read (static condition, trigger condition, layer filter)
// builds a ResolveContext and performs nothing; a later host write is then
// snapshotted before/after and published as one event batch.
//
// Observed in room baa8215a: A's Standard Move of A's own Unit was published
// with player B because a read of one of B's static conditions was the last
// context built, and B's turn-start readying of B's Units was published with
// player A after A's effect had resolved earlier.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ChainEngine } from '../../dist/chain/engine.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { readOnlyContext } from '../../dist/events/effect-actor.js';
import { turnFixture } from '../rules/turn/harness.mjs';

function setup() {
  const kernel = world().player('A').player('B')
    .unit('a-unit', { controller: 'A', owner: 'A', might: 2, location: { type: 'base', player: 'A' } })
    .unit('b-unit', { controller: 'B', owner: 'B', might: 2, location: { type: 'base', player: 'B' } })
    .build();
  const choose = request => { throw new Error(`Unexpected choice ${request.id}`); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  return { kernel, host };
}

const exhaustedPlayer = execution =>
  execution.emissions.find(event => event.timingPoint === 'object-exhausted')?.player;

test('RIFT-1156: a read-only context never becomes the effect actor', () => {
  const { kernel, host } = setup();
  // A's effect is resolving: its context is the actor for its actions.
  host.context(kernel.getObject('a-unit'), 'A', 'chain-item-resolve');
  // Reading one of B's conditions in the middle builds a context for B.
  readOnlyContext(() => host.context(kernel.getObject('b-unit'), 'B', 'cleanup-start').query({}));
  const execution = host.execute({ type: 'exhaust', object: kernel.ref('b-unit') });
  assert.equal(exhaustedPlayer(execution), 'A');
});

test('RIFT-1156: a turn-based action does not inherit an effect that resolved earlier', () => {
  const f = turnFixture({
    setup: w => w
      .unit('a-unit', { controller: 'A', owner: 'A', exhausted: true, location: { type: 'base', player: 'A' } })
      .unit('b-unit', { controller: 'B', owner: 'B', location: { type: 'base', player: 'B' } }),
  });
  // B's effect resolved earlier and left its ResolveContext behind.
  f.flow.chain.pipeline.host.context(f.kernel.getObject('b-unit'), 'B', 'chain-item-resolve');
  // A's Awaken Step readies A's Unit as a turn-based action (CR 412.2).
  f.flow.start();
  const readied = f.flow.chain.pipeline.events.find(event =>
    event.timingPoint === 'object-readied' && event.object?.ref.id === 'a-unit');
  assert.ok(readied, 'the Awaken Step readied A\'s Unit');
  assert.equal(readied.player, 'A');
  assert.equal(readied.source, undefined);
});

test('RIFT-1156: rule reads between two writes do not change the recorded player', () => {
  const { kernel, host } = setup();
  const engine = new ChainEngine({ turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false });
  assert.equal(engine.commit({ type: 'exhaust', object: kernel.ref('a-unit') }).status, 'done');
  readOnlyContext(() => engine.pipeline.host.context(kernel.getObject('b-unit'), 'B', 'cleanup-start').query({}));
  assert.equal(engine.commit({ type: 'ready', object: kernel.ref('a-unit') }).status, 'done');
  const players = engine.pipeline.events
    .filter(item => item.timingPoint === 'object-exhausted' || item.timingPoint === 'object-readied')
    .map(item => [item.timingPoint, item.player]);
  assert.deepEqual(players, [['object-exhausted', 'A'], ['object-readied', 'A']]);
});
