// CR v1.5 383.4.e.2 / 831.1.d.1 golden test — scenario `triggers-disarm-merged-single-trigger`
// (docs/rules/scenarios/triggers.yaml).
//
// 383.4.e.2: Attack Triggers are put on the Chain as Pending Items after the Unit
// gains the Attacker designation. 831.1.d.1: regardless of how many Disarm instances
// a Unit has, it produces one trigger whose value is the total.
//
// The executed slice drives the real merged keyword layer: `programs/keywords.ts`
// groups the printed instances, Disarm's declared stacking is `sum`, and the layer
// expands them into a single attack-declared TriggeredAbility. The end-to-end
// attack → Pending item → -Might slice stays a todo because the expanded TargetSpec
// uses `sameLocationAs`, which `programs/filters.ts` rejects as judge-required, and
// because no merged producer emits the attacker designation (see the todo note).
import test from 'node:test';
import assert from 'node:assert/strict';

import { world } from '../../../dist/effects/testing/index.js';
import { expandProgram } from '../../../dist/programs/keywords.js';
import { keywordDefinitionsById } from '../../../dist/effects/keywords/registry.generated.js';
import { program } from './harness.mjs';

const disarmInstance = (unitId, values) => world()
  .player('A', { energy: 0 })
  .player('B', { energy: 0 })
  .unit(unitId, { keywords: values, might: 3, location: { type: 'battlefield', id: 'bf1' } })
  .build();

test('triggers-disarm-merged-single-trigger (383.4.e.2 / 831.1.d.1): two printed Disarm instances expand into one summed attack trigger', () => {
  const kernel = disarmInstance('u1', [{ id: 'Disarm', value: 1 }, { id: 'Disarm', value: 2 }]);
  const expanded = expandProgram(program('card.probe-disarm', []), kernel.getObject('u1'));
  const attackTriggers = expanded.expanded.filter(ability =>
    ability.kind === 'triggered' && ability.trigger.at === 'attack-declared');

  // 831.1.d.1: one Triggered Ability, not one per instance.
  assert.equal(attackTriggers.length, 1);
  assert.equal(attackTriggers[0].optional, false);
  // 831.2: the merged value is the total of every Disarm instance: -(1 + 2).
  assert.equal(attackTriggers[0].body.length, 1);
  assert.equal(attackTriggers[0].body[0].op, 'continuous.might');
  assert.equal(attackTriggers[0].body[0].args.amount.value, -3);
  assert.deepEqual(attackTriggers[0].body[0].args.duration, { kind: 'constant', value: 'this-turn' });
});

test('triggers-disarm-merged-single-trigger (383.4.e.2 / 831.1.d.1): the merge counts keyword declarations the same way as printed keywords', () => {
  // Contract 3.7: `stacking: "sum"` merges declared and printed instances into one
  // ability. A declared [Disarm 4] plus a printed [Disarm] must stay one trigger.
  const kernel = disarmInstance('u1', [{ id: 'Disarm', value: 1 }]);
  const declared = program('card.probe-disarm', [{ kind: 'keyword', keyword: 'Disarm', value: 4 }]);
  const attackTriggers = expandProgram(declared, kernel.getObject('u1')).expanded
    .filter(ability => ability.kind === 'triggered' && ability.trigger.at === 'attack-declared');
  assert.equal(attackTriggers.length, 1);
  assert.equal(attackTriggers[0].body[0].args.amount.value, -5);
  // The merged keyword still reports its declared stacking to the generator registry.
  assert.equal(keywordDefinitionsById.get('Disarm').stacking, 'sum');
});

test('triggers-disarm-merged-single-trigger (831.1.d.1): a single instance still expands to exactly one trigger', () => {
  const kernel = disarmInstance('u1', [{ id: 'Disarm', value: 2 }]);
  const attackTriggers = expandProgram(program('card.probe-disarm', []), kernel.getObject('u1')).expanded
    .filter(ability => ability.kind === 'triggered' && ability.trigger.at === 'attack-declared');
  assert.equal(attackTriggers.length, 1);
  assert.equal(attackTriggers[0].body[0].args.amount.value, -2);
});

test.todo('triggers-disarm-merged-single-trigger (383.4.e.2, attack → Pending item → -Might): 缺 attack-declared 的生产者（合并内核没有把 Attacker designation 写入事件管线）与 TargetSpec.sameLocationAs 的目标绑定（programs/filters.ts 对 continuous.might 的 sameLocationAs 过滤器抛 judge-required）；Disarm 的合并单触发已由上面的真实展开执行验证');
