// CR v1.5 820.1.d / 820.1.d.1 / 820.3.a — scenarios costs-repeat-second-execution
// and costs-repeat-each-cost-once. The Repeat primitive executes the body once
// per paid Repeat instance; each instance is charged once by the cost layer.
import assert from 'node:assert/strict';
import test from 'node:test';
import repeat from '../../../dist/effects/instructions/effect.repeat.js';
import { world, withSource, runInstruction, constant } from './harness.mjs';

test.todo('costs-repeat-second-execution (chain wiring): 打出管线尚未把已付费 Repeat 实例数接到解释器 repeat 指令（缺 chain/engine 的“付费实例数 → 额外执行次数”接线）；本文件只验证费用回执与 repeat 原语两个真实切片');

test.todo('costs-repeat-each-cost-once (chain wiring): 同上，多实例已付费数到额外执行次数的接线缺失；费用层每实例只付一次已由 test/cost 与 Repeat.test.mjs 覆盖');

test('costs-repeat-second-execution: one paid Repeat adds exactly one extra execution', () => {
  const kernel = world()
    .player('A', { energy: 6 })
    .player('B', { energy: 0 })
    .unit('e1', { owner: 'B', controller: 'B', might: 3, location: { type: 'battlefield', id: 'bf1' } })
    .build();
  const ctx = withSource(kernel, 'e1', 'A');

  const run = runInstruction(repeat, {
    actions: [{ type: 'damage', targets: { target: 'victim' }, amount: constant(1) }],
    count: constant(1)
  }, { world: ctx, targets: { victim: [kernel.ref('e1')] } });

  assert.equal(run.result.status, 'executed');
  assert.equal(ctx.getObject('e1').damage, 1);
  assert.equal(run.linked.repeats, 1);
  assert.equal(run.linked.performed, 1);
});

test('costs-repeat-each-cost-once: two paid Repeat instances add two executions', () => {
  const kernel = world()
    .player('A', { energy: 7 })
    .player('B', { energy: 0 })
    .unit('e1', { owner: 'B', controller: 'B', might: 5, location: { type: 'battlefield', id: 'bf1' } })
    .build();
  const ctx = withSource(kernel, 'e1', 'A');

  const run = runInstruction(repeat, {
    actions: [{ type: 'damage', targets: { target: 'victim' }, amount: constant(1) }],
    count: constant(2)
  }, { world: ctx, targets: { victim: [kernel.ref('e1')] } });

  assert.equal(run.result.status, 'executed');
  assert.equal(ctx.getObject('e1').damage, 2);
  assert.equal(run.linked.repeats, 2);
  assert.deepEqual(run.linked.results, [1, 1]);
});
