// Scenario: targeting-legend-you-control-not-target (CR v1.5 355.10.g)
//
// "Ready your legend" does not target: nothing is locked at Finalize and the
// spell readies a legend while it resolves.
import assert from 'node:assert/strict';
import test from 'node:test';
import { constant, placeLegend, scene, spend } from './harness.mjs';

test('targeting-legend-you-control-not-target: "your legend" is chosen during resolution', () => {
  const s = scene(builder => builder
    .player('A', { energy: 1 })
    .player('B', { energy: 0 })
    .hand('spell', { owner: 'A', types: ['spell'] }));
  placeLegend(s.kernel, 'lg1', 'A');
  const spell = s.draft('spell', {
    // "Ready your legend.": a set-based query, not a target (355.10.d/.g).
    body: [{ id: 'ready-legend', op: 'effect.ready', args: { objects: constant({ kind: 'query', filter: { type: 'legend', controller: 'A' } }) } }],
    cost: { id: 'cost:spell', cost: { energy: constant(1), power: constant([]) } }
  });
  s.engine.execute(spell);

  assert.deepEqual(s.engine.items[0].targetPlans, [], '355.10.g: "your legend" targets nothing');
  assert.equal(s.kernel.getObject('lg1').exhausted, true, 'the legend is still exhausted at Finalize');
  assert.deepEqual(s.engine.pipeline.events.filter(event => event.timingPoint === 'became-target'), []);

  spend(s.engine);
  assert.equal(s.kernel.getObject('lg1').exhausted, false, 'the legend was readied during resolution');
  assert.equal(s.kernel.getObject('spell').zone, 'trash');
});
