import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createDuelBoard, placeDuelUnit, applyOpenDuelCleanup, beginDuelCombat, assertDuelBoard,
} from '../../dist/duel/battlefields.js';
import {
  fromDuelCombatObjectRef, toDuelCombatObjectRef,
} from '../../dist/combat/object-ref.js';

// Focused source tests transpile only this kernel in memory, never writing shared dist.
async function loadKernel() {
  if (process.env.DUEL_BASE_COMBAT_SOURCE !== '1') {
    return import('../../dist/combat/base-combat-allocation.js');
  }
  const ts = await import('typescript');
  const source = await readFile(new URL('../../src/combat/base-combat-allocation.ts', import.meta.url), 'utf8');
  const { outputText, diagnostics } = ts.transpileModule(source, {
    fileName: 'base-combat-allocation.ts', reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  assert.deepEqual(diagnostics, []);
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const {
  assertDuelBaseCombatPlan, createTrustedDuelBaseCombatFacts, planDuelBaseCombatDamage,
  validateDuelBaseCombatAllocation, completeDuelBaseCombatAllocation,
  inspectDuelBaseCombatCompletion,
  DuelBaseCombatBlockedError,
} = await loadKernel();

const provenBasic = () => ({
  currentMight: 'validated', assignmentModifier: 'proven-none',
  preventionReplacement: 'proven-none', keywordPriority: 'proven-none',
});
const amount = (uid, points) => ({ uid, amount: points });
const rejectCode = (callback, code) => assert.throws(callback,
  error => error instanceof DuelBaseCombatBlockedError && error.code === code,
  `expected explicit blocked code ${code}`);

test('combat object identity adapts to and from the contract ObjectRef', () => {
  const ref = toDuelCombatObjectRef('unit-1', 7);
  assert.deepEqual(ref, { id: 'unit-1', zoneEntryId: 7 });
  assert.deepEqual(fromDuelCombatObjectRef(ref), { uid: 'unit-1', zoneEpoch: 7 });
});

/** Actual compiled DuelBoard transition APIs; owner is metadata, controller/location only board. */
function combat({ attacking = [{ uid: 'a', might: 5 }],
  defending = [{ uid: 'd1', might: 3 }], otherField = [] } = {}) {
  let board = createDuelBoard({
    selected: [
      { playerId: 'P1', instanceId: 'field:1', cardId: 'field-print:1' },
      { playerId: 'P2', instanceId: 'field:2', cardId: 'field-print:2' },
    ],
    removedByPlayer: [
      { playerId: 'P1', battlefields: [
        { instanceId: 'field:3', cardId: 'field-print:3' },
        { instanceId: 'field:4', cardId: 'field-print:4' },
      ] },
      { playerId: 'P2', battlefields: [
        { instanceId: 'field:5', cardId: 'field-print:5' },
        { instanceId: 'field:6', cardId: 'field-print:6' },
      ] },
    ],
  });
  const fieldId = board.battlefields[0].locationId;
  const otherFieldId = board.battlefields[1].locationId;
  const unitMeta = {};
  const mightByUID = new Map();
  function place({ uid, might, marks = [], owner = 'P2' }, controllerPlayerId, locationId) {
    board = placeDuelUnit(board, { objectId: uid, controllerPlayerId, locationId });
    // The meta mirrors actual lifecycle metadata: mark amounts (not caller-provided total),
    // optional owner distinct from board controller, and no duplicated location/controller.
    unitMeta[uid] = { ownerPlayerId: owner, readied: false,
      trait: { kind: 'token', name: uid, baseMight: might, tags: [] },
      damageMarks: marks.map(points => ({ amount: points,
        responsiblePlayerId: controllerPlayerId === 'P1' ? 'P2' : 'P1', sourceObjectIds: ['spell:fixture'] })) };
    mightByUID.set(uid, might);
  }
  // P1 enters first and therefore applies Contested; CR 464.2.c.1 makes P1 Attacker.
  for (const unit of attacking) place(unit, 'P1', fieldId);
  for (const unit of defending) place(unit, 'P2', fieldId);
  for (const unit of otherField) place(unit, 'P1', otherFieldId);
  board = applyOpenDuelCleanup(board);
  board = beginDuelCombat(board, fieldId);
  assertDuelBoard(board);
  return { state: { stateVersion: 17, board, unitMeta }, fieldId, otherFieldId,
    mightByUID };
}

function bind({ state, fieldId, mightByUID }, serviceOverrides = {}) {
  return createTrustedDuelBaseCombatFacts(state.stateVersion, fieldId, {
    currentMight: unit => {
      assert.equal(unit.locationId, fieldId, 'only actual field residents reach Might evaluator');
      assert.equal(unit.fieldId, fieldId);
      return mightByUID.get(unit.uid);
    },
    proveBasicCombat: provenBasic,
    ...serviceOverrides,
  });
}

// Tests consume REAL compiled JavaScript from own strict/noUncheckedIndexedAccess TS
// and the existing compiled formal DuelBoard functions, without building to shared dist.
test('5 versus four 3-Might defenders: 3+2 allowed; 2+1+1+1 and early overkill forbidden', () => {
  const scene = combat({ defending: [1, 2, 3, 4].map(i => ({ uid: `d${i}`, might: 3 })) });
  const plan = planDuelBaseCombatDamage(scene.state, scene.fieldId, bind(scene));
  assert.deepEqual(plan.sideIDs, ['P1', 'P2']);
  assert.equal(plan.attacker.budget, 5);
  assert.equal(plan.defender.budget, 12);
  assert.deepEqual(plan.attacker.targets.map(t => t.lethalNeed), [3, 3, 3, 3]);
  rejectCode(() => validateDuelBaseCombatAllocation(plan, 'P1', [
    amount('d1', 2), amount('d2', 1), amount('d3', 1), amount('d4', 1),
  ]), 'invalid-allocation');
  rejectCode(() => validateDuelBaseCombatAllocation(plan, 'P1', [
    amount('d1', 4), amount('d2', 1),
  ]), 'invalid-allocation');
  const attack = validateDuelBaseCombatAllocation(plan, 'P1', [amount('d1', 3), amount('d2', 2)], 17);
  assert.equal(attack.assignedTotal, 5);
  assert.equal(attack.readyForSimultaneousDeal, false);
  rejectCode(() => validateDuelBaseCombatAllocation(plan, 'P1', [amount('d1', 3), amount('d2', 1)]), 'invalid-allocation');
  const defense = validateDuelBaseCombatAllocation(plan, 'P2', [amount('a', 12)], 17);
  assert.equal(defense.assignedTotal, 12);
  assert.equal(defense.readyForSimultaneousDeal, false);
  const completed = completeDuelBaseCombatAllocation(attack, defense, 17);
  assert.equal(completed.readyForSimultaneousDeal, true);
  assert.deepEqual(completed.attacker.assignments, [amount('d1', 3), amount('d2', 2)]);
  assert.deepEqual(completed.defender.assignments, [amount('a', 12)]);
});

test('each of four 3-Might defenders already has one marked damage: 2 is lethal need, not 3', () => {
  const scene = combat({ attacking: [{ uid: 'a', might: 5 }], defending: [1, 2, 3, 4].map(i =>
    ({ uid: `d${i}`, might: 3, marks: [1] })) });
  const plan = planDuelBaseCombatDamage(scene.state, scene.fieldId, bind(scene));
  assert.deepEqual(plan.attacker.targets.map(t => [t.existingDamage, t.lethalNeed]),
    [[1, 2], [1, 2], [1, 2], [1, 2]]);
  rejectCode(() => validateDuelBaseCombatAllocation(plan, 'P1', [amount('d1', 3), amount('d2', 2)]), 'invalid-allocation');
  assert.deepEqual(validateDuelBaseCombatAllocation(plan, 'P1', [
    amount('d1', 2), amount('d2', 2), amount('d3', 1),
  ]).assignments, [amount('d1', 2), amount('d2', 2), amount('d3', 1)]);
});

test('only the last opposing unit may receive overflow, including a lone target', () => {
  const two = combat({ attacking: [{ uid: 'a', might: 7 }],
    defending: [{ uid: 'd1', might: 3 }, { uid: 'd2', might: 3 }] });
  const plan = planDuelBaseCombatDamage(two.state, two.fieldId, bind(two));
  rejectCode(() => validateDuelBaseCombatAllocation(plan, 'P1', [amount('d1', 4), amount('d2', 3)]), 'invalid-allocation');
  assert.deepEqual(validateDuelBaseCombatAllocation(plan, 'P1', [
    amount('d1', 3), amount('d2', 4),
  ]).assignments, [amount('d1', 3), amount('d2', 4)]);
  const one = combat({ attacking: [{ uid: 'a', might: 5 }], defending: [{ uid: 'd1', might: 3 }] });
  assert.deepEqual(validateDuelBaseCombatAllocation(
    planDuelBaseCombatDamage(one.state, one.fieldId, bind(one)), 'P1', [amount('d1', 5)],
  ).assignments, [amount('d1', 5)]);
});

test('0 budget gives empty assignment; 0-Might unmarked needs positive lethal, then last-target overflow', () => {
  const bothZero = combat({ attacking: [{ uid: 'a', might: 0 }], defending: [{ uid: 'd1', might: 0 }] });
  const p0 = planDuelBaseCombatDamage(bothZero.state, bothZero.fieldId, bind(bothZero));
  assert.equal(p0.attacker.targets[0].lethalNeed, 1);
  assert.deepEqual(validateDuelBaseCombatAllocation(p0, 'P1', [], 17).assignments, []);
  assert.deepEqual(validateDuelBaseCombatAllocation(p0, 'P2', [], 17).assignments, []);
  rejectCode(() => validateDuelBaseCombatAllocation(p0, 'P1', [amount('d1', 0)]), 'invalid-allocation');
  const positive = combat({ attacking: [{ uid: 'a', might: 3 }], defending: [{ uid: 'd1', might: 0 }] });
  const plan = planDuelBaseCombatDamage(positive.state, positive.fieldId, bind(positive));
  assert.equal(plan.attacker.targets[0].lethalNeed, 1);
  assert.deepEqual(validateDuelBaseCombatAllocation(plan, 'P1', [amount('d1', 3)]).assignments,
    [amount('d1', 3)]);
  assert.deepEqual(validateDuelBaseCombatAllocation(plan, 'P2', []).assignments, []);
});

test('UID belongs to opposing controller, not owner; stolen unit Might from actual battlefield/controller', () => {
  const scene = combat({
    attacking: [{ uid: 'a', might: 4, owner: 'P2' }],
    defending: [{ uid: 'stolen', might: 2, owner: 'P1' }],
    otherField: [{ uid: 'away', might: 99, owner: 'P2' }],
  });
  const calls = [];
  const facts = bind(scene, { currentMight: unit => { calls.push(unit);
    return scene.mightByUID.get(unit.uid);
  } });
  const plan = planDuelBaseCombatDamage(scene.state, scene.fieldId, facts);
  assert.equal(plan.attacker.budget, 4);
  assert.equal(plan.defender.budget, 2);
  assert.deepEqual(plan.attacker.targets.map(x => x.uid), ['stolen']);
  assert.deepEqual(plan.defender.targets.map(x => x.uid), ['a']);
  assert.deepEqual(calls.map(x => [x.uid, x.controllerPlayerId, x.locationId]), [
    ['a', 'P1', scene.fieldId], ['stolen', 'P2', scene.fieldId],
  ]);
  rejectCode(() => validateDuelBaseCombatAllocation(plan, 'P1', [amount('away', 4)]), 'invalid-allocation');
  rejectCode(() => validateDuelBaseCombatAllocation(plan, 'P1', [amount('a', 4)]), 'invalid-allocation');
  rejectCode(() => validateDuelBaseCombatAllocation(plan, 'unknown', [amount('stolen', 4)]), 'actor-not-participant');
  assert.deepEqual(validateDuelBaseCombatAllocation(plan, 'P1', [amount('stolen', 4)]).assignments,
    [amount('stolen', 4)]);
});

test('other field and false controller/field/stale plan cannot become allocation authority', () => {
  const scene = combat();
  const facts = bind(scene);
  const plan = planDuelBaseCombatDamage(scene.state, scene.fieldId, facts);
  rejectCode(() => planDuelBaseCombatDamage(scene.state, scene.otherFieldId, facts), 'invalid-active-field');
  const staleFacts = createTrustedDuelBaseCombatFacts(16, scene.fieldId, {
    currentMight: () => 3, proveBasicCombat: provenBasic,
  });
  rejectCode(() => planDuelBaseCombatDamage(scene.state, scene.fieldId, staleFacts), 'stale-trusted-facts');
  const falseController = structuredClone(scene.state);
  falseController.board.units.find(u => u.objectId === 'd1').controllerPlayerId = 'P1';
  rejectCode(() => planDuelBaseCombatDamage(falseController, scene.fieldId, facts), 'invalid-combat-participants');
  const moved = structuredClone(scene.state);
  moved.board.units.find(u => u.objectId === 'd1').locationId = scene.otherFieldId;
  rejectCode(() => planDuelBaseCombatDamage(moved, scene.fieldId, facts), 'invalid-active-field');
  const stale = structuredClone(scene.state);
  stale.stateVersion = 18;
  rejectCode(() => planDuelBaseCombatDamage(stale, scene.fieldId, facts), 'stale-trusted-facts');
  rejectCode(() => validateDuelBaseCombatAllocation(plan, 'P1', [amount('d1', 5)], 18), 'stale-plan');
  const attack = validateDuelBaseCombatAllocation(plan, 'P1', [amount('d1', 5)]);
  const defense = validateDuelBaseCombatAllocation(plan, 'P2', [amount('a', 3)]);
  rejectCode(() => completeDuelBaseCombatAllocation(attack, defense, 18), 'stale-plan');
  rejectCode(() => validateDuelBaseCombatAllocation(structuredClone(plan), 'P1', [amount('d1', 5)]), 'invalid-plan');
  rejectCode(() => planDuelBaseCombatDamage(scene.state, scene.fieldId, {
    basedOnStateVersion: 17, fieldId: scene.fieldId, claimedMight: 99,
    proveBasicCombat: provenBasic,
  }), 'untrusted-facts');
});

test('kernel completes each real plan once across fresh, identical allocation results', () => {
  const scene = combat();
  const plan = planDuelBaseCombatDamage(scene.state, scene.fieldId, bind(scene));
  const attackerA = validateDuelBaseCombatAllocation(plan, 'P1', [amount('d1', 5)], 17);
  const attackerB = validateDuelBaseCombatAllocation(plan, 'P1', [amount('d1', 5)], 17);
  const defenderA = validateDuelBaseCombatAllocation(plan, 'P2', [amount('a', 3)], 17);
  const defenderB = validateDuelBaseCombatAllocation(plan, 'P2', [amount('a', 3)], 17);
  assert.notStrictEqual(attackerA, attackerB);
  assert.notStrictEqual(defenderA, defenderB);
  assert.equal(completeDuelBaseCombatAllocation(attackerA, defenderA, 17).readyForSimultaneousDeal, true);
  rejectCode(() => completeDuelBaseCombatAllocation(attackerA, defenderA, 17), 'plan-already-used');
  rejectCode(() => completeDuelBaseCombatAllocation(attackerB, defenderB, 17), 'plan-already-used');

  const identical = planDuelBaseCombatDamage(scene.state, scene.fieldId, bind(scene));
  assert.deepEqual(identical, plan);
  assert.notStrictEqual(identical, plan);
  const independentAttacker = validateDuelBaseCombatAllocation(identical, 'P1', [amount('d1', 5)], 17);
  const independentDefender = validateDuelBaseCombatAllocation(identical, 'P2', [amount('a', 3)], 17);
  assert.equal(completeDuelBaseCombatAllocation(independentAttacker, independentDefender, 17)
    .readyForSimultaneousDeal, true, 'one plan does not consume another equally shaped trusted plan');
});

test('kernel completion requires a present, safe, matching current state version', () => {
  const scene = combat();
  const plan = planDuelBaseCombatDamage(scene.state, scene.fieldId, bind(scene));
  const attacker = validateDuelBaseCombatAllocation(plan, 'P1', [amount('d1', 5)]);
  const defender = validateDuelBaseCombatAllocation(plan, 'P2', [amount('a', 3)]);
  for (const invalid of [undefined, null, NaN, -1, 18, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    rejectCode(() => completeDuelBaseCombatAllocation(attacker, defender, invalid), 'stale-plan');
  }
  rejectCode(() => completeDuelBaseCombatAllocation(attacker, defender), 'stale-plan');
  assert.equal(completeDuelBaseCombatAllocation(attacker, defender, 17).readyForSimultaneousDeal, true);
  rejectCode(() => completeDuelBaseCombatAllocation(attacker, defender, 17), 'plan-already-used');
});

test('failed pairing and version mismatch leave the legitimate plan retryable exactly once', () => {
  const scene = combat();
  const plan = planDuelBaseCombatDamage(scene.state, scene.fieldId, bind(scene));
  const foreignPlan = planDuelBaseCombatDamage(scene.state, scene.fieldId, bind(scene));
  const attacker = validateDuelBaseCombatAllocation(plan, 'P1', [amount('d1', 5)], 17);
  const defender = validateDuelBaseCombatAllocation(plan, 'P2', [amount('a', 3)], 17);
  const foreignDefender = validateDuelBaseCombatAllocation(foreignPlan, 'P2', [amount('a', 3)], 17);
  rejectCode(() => completeDuelBaseCombatAllocation(attacker, foreignDefender, 17), 'invalid-allocation');
  rejectCode(() => completeDuelBaseCombatAllocation(defender, attacker, 17), 'invalid-allocation');
  rejectCode(() => completeDuelBaseCombatAllocation(attacker, defender, 18), 'stale-plan');
  assert.equal(completeDuelBaseCombatAllocation(attacker, defender, 17).readyForSimultaneousDeal, true);
  rejectCode(() => completeDuelBaseCombatAllocation(attacker, defender, 17), 'plan-already-used');
  const foreignAttacker = validateDuelBaseCombatAllocation(foreignPlan, 'P1', [amount('d1', 5)], 17);
  assert.equal(completeDuelBaseCombatAllocation(foreignAttacker, foreignDefender, 17)
    .readyForSimultaneousDeal, true, 'failed mixed pairing never consumes the other plan');
});

test('completion inspection retains the genuine plan and rejects copies before reading data', () => {
  const scene = combat();
  const plan = planDuelBaseCombatDamage(scene.state, scene.fieldId, bind(scene));
  const attacker = validateDuelBaseCombatAllocation(plan, 'P1', [amount('d1', 5)], 17);
  const defender = validateDuelBaseCombatAllocation(plan, 'P2', [amount('a', 3)], 17);
  const complete = completeDuelBaseCombatAllocation(attacker, defender, 17);
  const inspected = inspectDuelBaseCombatCompletion(complete, 17);
  assert.strictEqual(inspected.plan, plan);
  assert.strictEqual(inspected.completion, complete);
  assert.equal(Object.isFrozen(inspected), true);
  assert.strictEqual(inspectDuelBaseCombatCompletion(complete, 17).completion, complete);
  for (const copy of [structuredClone(complete), { ...complete }, null, attacker, plan]) {
    rejectCode(() => inspectDuelBaseCombatCompletion(copy, 17), 'invalid-allocation');
  }
  let reads = 0;
  const forged = { get kind() { reads++; throw new Error('must not read'); } };
  rejectCode(() => inspectDuelBaseCombatCompletion(forged, 17), 'invalid-allocation');
  assert.equal(reads, 0);
  for (const version of [undefined, NaN, 18]) {
    rejectCode(() => inspectDuelBaseCombatCompletion(complete, version), 'stale-plan');
  }
});

test('all input remains untouched, including board/marks/order; plan excludes board/private/evaluator state', () => {
  const scene = combat({ attacking: [{ uid: 'a', might: 5, marks: [1] }],
    defending: [{ uid: 'd1', might: 3, marks: [1, 1] }, { uid: 'd2', might: 3 }] });
  const snapshot = structuredClone(scene.state);
  const facts = bind(scene);
  const choices = [amount('d1', 1), amount('d2', 4)];
  const choicesSnapshot = structuredClone(choices);
  const plan = planDuelBaseCombatDamage(scene.state, scene.fieldId, facts);
  const attacker = validateDuelBaseCombatAllocation(plan, 'P1', choices, 17);
  const defender = validateDuelBaseCombatAllocation(plan, 'P2', [amount('a', 6)], 17);
  const complete = completeDuelBaseCombatAllocation(attacker, defender, 17);
  assert.equal(complete.attacker.assignments[0].amount, 1);
  assert.deepEqual(scene.state, snapshot);
  assert.deepEqual(choices, choicesSnapshot);
  assert.deepEqual(Object.keys(plan), ['kind', 'basedOnStateVersion', 'fieldId', 'sideIDs', 'attacker', 'defender']);
  assert.equal(JSON.stringify(plan).includes('unitMeta'), false);
  assert.equal(JSON.stringify(plan).includes('board'), false);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.attacker.targets[0]), true);
  assert.notStrictEqual(plan.attacker.targets[0], scene.state.unitMeta.d1);
  assert.equal('state' in complete, false);
  assert.equal('damageMarks' in complete, false);
  assert.equal('score' in complete, false);
});

test('process-local plan attestation enforces mandatory current version without actor or assignment', () => {
  const scene = combat();
  const plan = planDuelBaseCombatDamage(scene.state, scene.fieldId, bind(scene));
  assert.equal(assertDuelBaseCombatPlan(plan, 17), undefined);
  rejectCode(() => assertDuelBaseCombatPlan(structuredClone(plan), 17), 'invalid-plan');
  for (const invalid of [undefined, null, 18, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    rejectCode(() => assertDuelBaseCombatPlan(plan, invalid), 'stale-plan');
  }
  assert.deepEqual(validateDuelBaseCombatAllocation(plan, 'P1', [amount('d1', 5)]).assignments,
    [amount('d1', 5)], 'ordinary kernel validation remains compatible');
});

test('allocation reads one plain ordered snapshot before lethal and budget rules', () => {
  const scene = combat({ attacking: [{ uid: 'a', might: 5 }], defending: [
    { uid: 'd1', might: 3 }, { uid: 'd2', might: 3 },
  ] });
  const plan = planDuelBaseCombatDamage(scene.state, scene.fieldId, bind(scene));
  const invalid = [amount('d1', 1), amount('d2', 4)];
  rejectCode(() => validateDuelBaseCombatAllocation(plan, 'P1', invalid), 'invalid-allocation');
  let reads = 0;
  const changingLength = new Proxy(invalid, {
    get(target, key, receiver) {
      if (key === 'length') {
        reads++;
        // Reproduce the former index < raw.length - 1 escape for nonlethal d1.
        if (reads === 2) return 1;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  rejectCode(() => validateDuelBaseCombatAllocation(plan, 'P1', changingLength), 'invalid-allocation');
  assert.ok(reads >= 1);
  const good = [amount('d1', 3), amount('d2', 2)];
  assert.deepEqual(validateDuelBaseCombatAllocation(plan, 'P1', good).assignments, good);
  // No caller-owned array/object is mutated by the snapshot process.
  assert.deepEqual(invalid, [amount('d1', 1), amount('d2', 4)]);
});

test('sparse/extra/accessor input and Proxy ownKeys timing cannot become allocation authority', () => {
  const scene = combat();
  const plan = planDuelBaseCombatDamage(scene.state, scene.fieldId, bind(scene));
  const sparse = Array(1);
  const extra = [amount('d1', 5)];
  extra.injection = true;
  for (const invalid of [sparse, extra,
    Object.defineProperty([amount('d1', 5)], '0', { get: () => amount('d1', 5), configurable: true }),
    [{ uid: 'd1', get amount() { throw Error('private getter data 999'); } }],
    [Object.defineProperty({ amount: 5 }, 'uid', { get: () => 'd1' })]]) {
    rejectCode(() => validateDuelBaseCombatAllocation(plan, 'P1', invalid), 'invalid-allocation');
  }
  let reads = 0;
  const dynamic = new Proxy([amount('d1', 5)], {
    ownKeys(target) {
      reads++;
      return reads === 1 ? ['0', 'length'] : ['length'];
    },
  });
  rejectCode(() => validateDuelBaseCombatAllocation(plan, 'P1', dynamic), 'invalid-allocation');
  assert.ok(reads >= 2);
  let itemReads = 0;
  const unstableItem = new Proxy(amount('d1', 5), {
    ownKeys() {
      itemReads++;
      return itemReads === 1 ? ['uid', 'amount'] : ['uid'];
    },
  });
  rejectCode(() => validateDuelBaseCombatAllocation(plan, 'P1', [unstableItem]), 'invalid-allocation');
  assert.ok(itemReads >= 2);
  const throwing = new Proxy([amount('d1', 5)], {
    ownKeys() { throw new Error('private trap data 123456'); },
  });
  assert.throws(() => validateDuelBaseCombatAllocation(plan, 'P1', throwing), error =>
    error instanceof DuelBaseCombatBlockedError && error.code === 'invalid-allocation' &&
    !error.message.includes('123456'));
});

test('no provider/proof, unknown effects/keyword priority, invalid Might and already-lethal board are blocked', () => {
  const scene = combat();
  rejectCode(() => planDuelBaseCombatDamage(scene.state, scene.fieldId, undefined), 'missing-trusted-facts');
  rejectCode(() => createTrustedDuelBaseCombatFacts(17, scene.fieldId, {}), 'missing-trusted-facts');
  for (const proof of [undefined, { currentMight: 'validated' },
    { ...provenBasic(), keywordPriority: 'unknown' },
    { ...provenBasic(), preventionReplacement: 'unknown' },
    { ...provenBasic(), assignmentModifier: 'unknown' }]) {
    rejectCode(() => planDuelBaseCombatDamage(scene.state, scene.fieldId,
      bind(scene, { proveBasicCombat: () => proof })),
    proof === undefined ? 'source-effect-proof-missing' : 'source-effect-proof-incomplete');
  }
  for (const might of [undefined, -1, 1.1, Number.MAX_SAFE_INTEGER + 1]) {
    rejectCode(() => planDuelBaseCombatDamage(scene.state, scene.fieldId,
      bind(scene, { currentMight: () => might })), 'current-might-invalid');
  }
  const lethal = combat({ attacking: [{ uid: 'a', might: 5 }],
    defending: [{ uid: 'd1', might: 3, marks: [2, 1] }] });
  rejectCode(() => planDuelBaseCombatDamage(lethal.state, lethal.fieldId, bind(lethal)), 'cleanup-required');
  const zeroLethal = combat({ attacking: [{ uid: 'a', might: 1 }],
    defending: [{ uid: 'd1', might: 0, marks: [1] }] });
  rejectCode(() => planDuelBaseCombatDamage(zeroLethal.state, zeroLethal.fieldId, bind(zeroLethal)), 'cleanup-required');
});
