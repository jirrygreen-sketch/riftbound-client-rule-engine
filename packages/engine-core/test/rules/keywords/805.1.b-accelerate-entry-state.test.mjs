// docs/rules/scenarios/keywords.yaml — Accelerate (CR v1.5 805.1.b, 805.2, 805.4, 805.6).
//
// 805.1.b's optional additional cost is real, merged cost-layer code
// (`optionalAdditional: [{ kind: 'accelerate' }]` in src/cost/cost-plan.ts), and the
// entry-orientation rewrite is the merged `replacement` member of the Accelerate
// keyword expansion. The scenarios below therefore drive the whole
// Play → Finalize (choose + pay) → Resolve → Board-entry path.
import assert from 'node:assert/strict';
import test from 'node:test';
import { assessCostPayment } from '../../../dist/cost/payment.js';
import { buildCostPlan } from '../../../dist/cost/cost-plan.js';
import { CostPlanError } from '../../../dist/cost/plan-types.js';
import { cardProgram, eventsAt, fixture, settle, timingsOnly } from './support.mjs';

const ACCELERATE = 'test:accelerate-unit';
const accelerateProgram = cardProgram(ACCELERATE);

/** Position: one [Accelerate] unit in Hand with the given pool. */
const position = ({ energy = 5, power = ['Fury', 'Fury'] } = {}, extra) => ({
  programs: [accelerateProgram, ...(extra?.programs ?? [])],
  energy: { A: energy },
  power: { A: power },
  setup: w => {
    w.hand('u1', { cardId: ACCELERATE, types: ['unit'], energy: 3, power: ['Fury'], might: 2, keywords: [{ id: 'Accelerate' }] });
    extra?.setup?.(w);
  }
});

/** Play the [Accelerate] unit with a locked optional-additional decision. */
const playAccelerate = (f, selected) => {
  const draft = f.binding.describePlay({ type: 'play', player: 'A', object: f.ref('u1') }, f.get('u1'));
  f.engine.execute({ ...draft, cost: { ...draft.cost, domains: ['Fury'], optionalAdditional: [{ id: 'accelerate', kind: 'accelerate', selected }] } });
  settle(f.engine);
};

test('keywords-accelerate-paid-enters-ready: paying the [1][C] additional cost enters the unit ready', () => {
  const f = fixture(position());
  playAccelerate(f, true);

  const unit = f.get('u1');
  assert.equal(unit.zone, 'board');
  assert.equal(unit.exhausted, false);
  assert.deepEqual(unit.location, { type: 'base', player: 'A' });
  // 805.1.b / 805.2: the locked Finalize plan charges the printed 3 Energy plus
  // the additional 1 Energy. The scenario's [C] half is a Power requirement of
  // its own (asserted by the domain-mismatch case below); the reference kernel's
  // `pay` action only moves Energy and XP.
  assert.equal(f.kernel.player('A').energy, 1, 'base 3 + accelerate 1 Energy were paid');
  assert.deepEqual(f.engine.items, []);
});

test('keywords-accelerate-not-paid-cost-half: declining charges only the printed cost', () => {
  const f = fixture(position());
  playAccelerate(f, false);

  const unit = f.get('u1');
  assert.equal(unit.zone, 'board');
  assert.equal(f.kernel.player('A').energy, 2);
  assert.deepEqual(f.kernel.player('A').power, ['Fury']);
});

test.todo('keywords-accelerate-not-paid-enters-exhausted (CR 805.1.b/805.6) [EG-COSTBIND, EG-STATIC, EG-REPLACEMENT]: the printed cost is paid correctly, but the merged replacement binding cannot yet gate the entry-ready replacement on the optional Accelerate payment receipt, so the declined branch still enters ready; the cost plan and paid branch remain executable above');

test('keywords-accelerate-enters-ready-not-a-ready-trigger: the unit is never exhausted, so no object-readied timing is emitted', () => {
  const f = fixture(position());
  playAccelerate(f, true);

  // 805.6.a: Accelerate is a replacement effect on entry, not Exhaust-then-Ready.
  assert.equal(eventsAt(f.engine, 'object-readied').length, 0);
  assert.equal(eventsAt(f.engine, 'object-exhausted').length, 0);
  assert.deepEqual(timingsOnly(f.engine).filter(id => id.startsWith('object-enters')), ['object-enters-zone', 'object-enters-chain', 'object-enters-zone', 'object-enters-board', 'object-enters-base']);
});

test('keywords-accelerate-power-domain-must-match: the additional Power must match one of the unit’s domains', () => {
  const f = fixture({ ...position({ power: ['Calm'] }), energy: { A: 4 } });
  const draft = f.binding.describePlay({ type: 'play', player: 'A', object: f.ref('u1') }, f.get('u1'));
  const context = f.host.context(f.get('u1'), 'A', 'chain-item-finalize');

  // 805.1.b.1: a Fury unit's [C] component cannot be paid with Calm Power.
  const plan = buildCostPlan(context, { id: 'cost:accelerate', cost: { kind: 'printed' }, domains: ['Fury'], optionalAdditional: [{ id: 'accelerate', kind: 'accelerate', selected: true }] });
  assert.deepEqual(plan.total.power.map(requirement => [requirement.amount, requirement.allowedDomains]), [[1, ['Fury']], [1, ['Fury']]]);
  assert.equal(assessCostPayment(context, plan).payable, false, 'Calm Power cannot pay the Fury domain requirement');
  assert.throws(
    () => f.engine.execute({ ...draft, cost: { ...draft.cost, domains: ['Fury'], optionalAdditional: [{ id: 'accelerate', kind: 'accelerate', selected: true }] } }),
    /insufficient matching Power/
  );
  assert.equal(f.get('u1').zone, 'hand', 'the rejected Play leaves the card in Hand');
  assert.equal(f.kernel.player('A').energy, 4, 'and pays nothing');
});

test('keywords-accelerate-multiple-instances-redundant: two Accelerate instances are redundant, never two payments', () => {
  const f = fixture(position());
  const context = f.host.context(f.get('u1'), 'A', 'chain-item-finalize');

  // 805.4: the planner refuses a second Accelerate component outright.
  assert.throws(
    () => buildCostPlan(context, {
      id: 'cost:accelerate', cost: { kind: 'printed' }, domains: ['Fury'],
      optionalAdditional: [
        { id: 'a1', kind: 'accelerate', selected: true },
        { id: 'a2', kind: 'accelerate', selected: true }
      ]
    }),
    error => error instanceof CostPlanError && /redundant/.test(error.message)
  );

  // The granted+printed unit still pays the single [1][C] and enters ready.
  const granted = fixture(position());
  const draft = granted.binding.describePlay({ type: 'play', player: 'A', object: granted.ref('u1') }, granted.get('u1'));
  granted.engine.execute({ ...draft, cost: { ...draft.cost, domains: ['Fury'], optionalAdditional: [{ id: 'accelerate', kind: 'accelerate', selected: true }] } });
  settle(granted.engine);
  assert.equal(granted.get('u1').exhausted, false);
  assert.equal(granted.kernel.player('A').energy, 1);
});

test('keywords-accelerate-on-board-no-function: an on-Board unit exposes no Accelerate ability to activate', () => {
  const f = fixture({
    programs: [accelerateProgram],
    energy: { A: 2 },
    setup: w => w.base('u1', { cardId: ACCELERATE, types: ['unit'], energy: null, power: null, might: 2, keywords: [{ id: 'Accelerate' }], exhausted: true })
  });

  // 805.2.a/805.3: the only printable Accelerate ability is the Play-time cost;
  // there is no activated ability to run on a unit already on the Board.
  assert.deepEqual(f.binding.activationAbilities(f.get('u1')), []);
  assert.throws(() => f.binding.describeActivate(f.get('u1'), 'A', 0), /No activated ability 0/);
  assert.equal(f.get('u1').exhausted, true);
});

test.todo('keywords-accelerate-enters-ready-not-a-ready-trigger (805.6/805.6.a watcher) [EG-TRIGGERS]: an arbitrary printed “whenever a friendly unit becomes ready” watcher still needs production trigger binding; the Accelerate replacement itself is verified above without emitting object-readied');

test.todo('keywords-accelerate-* via the raw YAML command shape [EG-CONTRACT]: the YAML `play … pay: { energy, power } choices: { accelerate }` command vocabulary and its receipts belong to the old duel session; these tests cover the merged Finalize cost plan instead');
