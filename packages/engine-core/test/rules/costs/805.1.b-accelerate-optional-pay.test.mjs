// CR v1.5 805.1.b / 805.2 / 805.6 — scenario costs-accelerate-optional-pay.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, makeEngine, unitDraft, printedCost } from './harness.mjs';

test('costs-accelerate-optional-pay: paying [1][C] makes the unit enter ready', () => {
  const kernel = world()
    .player('A', { energy: 3, power: ['Fury'] })
    .player('B', { energy: 0 })
    .hand('unit', { types: ['unit'], energy: 2, power: [], might: 3 })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const { engine } = makeEngine(kernel);

  engine.execute(unitDraft(kernel, 'unit', {
    cost: {
      ...printedCost('cost:unit'),
      domains: ['Fury'],
      optionalAdditional: [{ id: 'accelerate', kind: 'accelerate', selected: true }]
    }
  }));

  const unit = kernel.getObject('unit');
  assert.equal(unit.zone, 'board');
  assert.equal(unit.exhausted, false);
  assert.equal(kernel.player('A').energy, 0);
  assert.ok(engine.trace.some(event => event.step === 'finalized' && event.item === 'unit'));
});

test('costs-accelerate-declined-exhausted: declining Accelerate enters exhausted and keeps Power', () => {
  const kernel = world()
    .player('A', { energy: 2, power: ['Fury'] })
    .player('B', { energy: 0 })
    .hand('unit', { types: ['unit'], energy: 2, power: [], might: 3 })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const { engine } = makeEngine(kernel);

  engine.execute(unitDraft(kernel, 'unit', {
    cost: {
      ...printedCost('cost:unit'),
      domains: ['Fury'],
      optionalAdditional: [{ id: 'accelerate', kind: 'accelerate', selected: false }]
    }
  }));

  const unit = kernel.getObject('unit');
  assert.equal(unit.zone, 'board');
  assert.equal(unit.exhausted, true);
  assert.equal(kernel.player('A').energy, 0);
  assert.deepEqual(kernel.player('A').power, ['Fury']);
});

test('costs-accelerate-power-domain-match: a Fury+Chaos unit may pay the Power partly with Chaos', () => {
  const kernel = world()
    .player('A', { energy: 3, power: ['Chaos'] })
    .player('B', { energy: 0 })
    .hand('unit', { types: ['unit'], energy: 2, power: [], might: 3 })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const { engine } = makeEngine(kernel);

  engine.execute(unitDraft(kernel, 'unit', {
    cost: {
      ...printedCost('cost:unit'),
      domains: ['Fury', 'Chaos'],
      optionalAdditional: [{ id: 'accelerate', kind: 'accelerate', selected: true }]
    }
  }));

  assert.equal(kernel.getObject('unit').exhausted, false);
  assert.equal(kernel.player('A').energy, 0);
});
