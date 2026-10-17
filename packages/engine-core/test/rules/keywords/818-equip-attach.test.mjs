// docs/rules/scenarios/keywords.yaml — Equip (CR v1.5 818.1.b.1, 818.1.c.2, 818.2) and
// attachment rules (435.1.h, 435.1.h.2).
//
// The merged Equip expansion is an action-speed activated ability whose body is the
// merged `effect.attach` primitive and whose target spec is “a Unit you control”.
// Those two real pieces execute below; the activation itself is blocked in the
// combined cost plan (see the todo), because the merged cost layer has no `equip`
// payment kind yet.
import assert from 'node:assert/strict';
import test from 'node:test';
import equip from '../../../dist/effects/keywords/Equip.js';
import { instructionDefinitionsById } from '../../../dist/effects/instructions/registry.generated.js';
import { runInstruction, world } from '../../../dist/effects/testing/index.js';
import { createLayerEngine } from '../../../dist/layers/index.js';
import { TargetSelectionError } from '../../../dist/target/target-plan.js';
import { c, fixture, settle } from './support.mjs';

const EQUIP_CARD = 'test:equip-gear';

const [equipAbility] = equip.expand({ host: { canonicalCardId: EQUIP_CARD } });
const equipTarget = equipAbility.body[0].targets[0];

/** A's Equipment on the Board plus an own and an opposing Unit. */
const position = () => world().player('A').player('B')
  .object('gear', { cardId: EQUIP_CARD, types: ['gear'], tags: ['Equipment'], zone: 'board', location: { type: 'base', player: 'A' }, energy: null, power: null })
  .base('ally', { might: 2 })
  .unit('enemy', { owner: 'B', controller: 'B', might: 2 })
  .build();

test('keywords-equip-target-must-be-friendly-unit: the Equip target spec is exactly “a Unit you control” (CR 818.1.b.1, 818.1.c.2)', () => {
  assert.deepEqual(equipTarget, {
    id: 'equip-target',
    filter: { type: 'unit', controller: 'self' },
    min: 1,
    max: 1,
    selection: 'one'
  });
  assert.equal(equipAbility.kind, 'activated');
  assert.equal(equipAbility.timing, 'action');
  assert.deepEqual(equipAbility.body.map(instruction => instruction.op), ['effect.attach']);
});

test('keywords-equip-target-must-be-friendly-unit: the opposing Unit is rejected when the chain Finalizes the Equip target (CR 818.1.c.2)', () => {
  const setup = { programs: [], setup: w => w.player('A').player('B')
    .object('gear', { cardId: EQUIP_CARD, types: ['gear'], tags: ['Equipment'], zone: 'board', location: { type: 'base', player: 'A' } })
    .base('ally', { might: 2 })
    .unit('enemy', { owner: 'B', controller: 'B', might: 2 }) };

  const rejected = fixture(setup);
  rejected.answers.set('target:equip-target', ['enemy']);
  assert.throws(
    () => rejected.engine.execute({ id: 'equip-enemy', controller: 'A', source: rejected.get('gear'), kind: 'activated', speed: 'action', body: equipAbility.body }),
    error => error instanceof TargetSelectionError && error.code === 'invalid-target-choice'
  );
  assert.deepEqual(rejected.asked.map(request => request.id), ['target:equip-target']);
  assert.equal(rejected.get('gear').attachedTo, null);

  // The own Unit is offered and accepted, and the attachment really happens.
  const accepted = fixture(setup);
  accepted.answers.set('target:equip-target', ['ally']);
  accepted.engine.execute({ id: 'equip-ally', controller: 'A', source: accepted.get('gear'), kind: 'activated', speed: 'action', body: equipAbility.body });
  settle(accepted.engine);
  assert.deepEqual(accepted.get('gear').attachedTo, accepted.ref('ally'));
});

test('keywords-equip-attach-gear-to-unit: the merged attach primitive attaches the Equipment to the chosen Unit and the layer engine reads the new attachment (CR 818.1.c.2, 818.2)', () => {
  const kernel = position();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject('gear'), controller: 'A' });
  const run = runInstruction(instructionDefinitionsById.get('effect.attach'), equipAbility.body[0].args, {
    world: context,
    targets: { 'equip-target': [kernel.ref('ally')] }
  });

  assert.equal(run.result.status, 'executed');
  assert.deepEqual(run.events.map(event => event.action), ['attach']);
  assert.deepEqual(context.getObject('gear').attachedTo, kernel.ref('ally'));

  // 718.2-4 / 719.1: attachment is observable in the layered snapshot, which is
  // what the attached equipment’s continuous text will be evaluated against.
  const layer = createLayerEngine(context.objects);
  assert.deepEqual(layer.evaluate(kernel.ref('gear')).attachedTo, kernel.ref('ally'));
});

test('keywords-equip-unit-cannot-be-attached: making a Unit the *attached* object is impossible (CR 435.1.h)', () => {
  const kernel = world().base('u1', { might: 2 }).base('u2', { might: 3 }).player('A').build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject('u1'), controller: 'A' });

  // 435.1.h: the source is a Unit, so the attach action is impossible; the
  // primitive reports `negated/impossible` and nothing is attached.
  const run = runInstruction(instructionDefinitionsById.get('effect.attach'), {
    objects: c({ kind: 'source' }),
    host: c({ kind: 'target', id: 'host' })
  }, { world: context, targets: { host: [kernel.ref('u2')] } });

  assert.equal(run.result.status, 'negated');
  assert.equal(run.result.reason, 'impossible');
  assert.equal(context.getObject('u1').attachedTo, null);
  assert.equal(context.getObject('u2').attachedTo, null);
});

test('keywords-equip-attached-equipment-detaches-when-becomes-unit: the layer engine detaches an attached Gear the moment it becomes a Unit (CR 435.1.h.2)', () => {
  // Orianna-style ruling: `add-type unit` on the attached Gear clears attachedTo in
  // the trait layer, before any ability layer re-reads it.
  const kernel = position();
  const gear = kernel.getObject('gear');
  const attached = { ...gear, attachedTo: kernel.ref('ally') };
  const engine = createLayerEngine([attached, kernel.getObject('ally'), kernel.getObject('enemy')]);
  engine.register({
    id: 'unitize',
    layer: 'trait',
    source: kernel.ref('ally'),
    filter: { objectId: 'gear' },
    effect: { kind: 'add-type', types: ['unit'] }
  }, { type: 'permanent' });

  const snapshot = engine.evaluate(kernel.ref('gear'));
  assert.ok(snapshot.types.includes('unit'));
  assert.equal(snapshot.attachedTo, null, 'the Gear detaches as soon as it is a Unit');

  // Removing the effect restores the attachment (the layer is not destructive).
  engine.removeContinuous('unitize');
  const reverted = engine.evaluate(kernel.ref('gear'));
  assert.deepEqual(reverted.types, ['gear']);
  assert.deepEqual(reverted.attachedTo, kernel.ref('ally'));
});

test.todo('keywords-equip-attach-gear-to-unit (CR 818.1.c.2 activation): paying the printed Equip cost and running the activated ability end-to-end — blocked: the merged cost layer has no `equip` payment kind (`src/cost/plan-values.ts` raises “Unsupported payment kind: equip”), so `describeActivate` cannot build a payable plan and src/programs/activate.ts would surface it as a blocked ability');
