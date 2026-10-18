import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDuelBoard, placeDuelUnit, applyOpenDuelCleanup, beginDuelCombat, assertDuelBoard,
} from '../../dist/duel/battlefields.js';
import {
  createTrustedDuelBaseCombatFacts, planDuelBaseCombatDamage,
  validateDuelBaseCombatAllocation, completeDuelBaseCombatAllocation,
  deriveDuelCombatAssignmentRulesFromIR, DuelBaseCombatBlockedError,
} from '../../dist/combat/base-combat-allocation.js';

const amount = (uid, value, priority) => ({ uid, amount: value, ...(priority ? { priority } : {}) });
const blocked = (fn, code) => assert.throws(fn,
  error => error instanceof DuelBaseCombatBlockedError && error.code === code);

const tankIR = uid => ({ filter: { objectId: uid }, effect: {
  kind: 'continuous.combat', mode: 'damage-assignment', priority: 'first',
  damage: 'lethal', controllerScope: 'same-controller', excludesKeyword: 'Tank',
} });
const backlineIR = uid => ({ filter: { objectId: uid }, effect: {
  kind: 'continuous.combat', mode: 'damage-assignment', priority: 'last',
  damage: 'lethal', controllerScope: 'same-controller', excludesKeyword: 'Backline',
} });

function combat({ attackers = [{ uid: 'a', might: 9 }], defenders = [] } = {}) {
  let board = createDuelBoard({
    selected: [
      { playerId: 'P1', instanceId: 'field:1', cardId: 'field-print:1' },
      { playerId: 'P2', instanceId: 'field:2', cardId: 'field-print:2' },
    ],
    removedByPlayer: [
      { playerId: 'P1', battlefields: [
        { instanceId: 'field:3', cardId: 'field-print:3' },
        { instanceId: 'field:5', cardId: 'field-print:5' },
      ] },
      { playerId: 'P2', battlefields: [
        { instanceId: 'field:4', cardId: 'field-print:4' },
        { instanceId: 'field:6', cardId: 'field-print:6' },
      ] },
    ],
  });
  const fieldId = board.battlefields[0].locationId;
  const unitMeta = {};
  const might = new Map();
  const place = (unit, controller) => {
    board = placeDuelUnit(board, { objectId: unit.uid, controllerPlayerId: controller, locationId: fieldId });
    unitMeta[unit.uid] = {
      ownerPlayerId: controller, readied: true,
      trait: { kind: 'token', name: unit.uid, baseMight: unit.might, tags: [] },
      damageMarks: (unit.marks ?? []).map(value => ({ amount: value,
        responsiblePlayerId: controller === 'P1' ? 'P2' : 'P1', sourceObjectIds: ['scene'] })),
    };
    might.set(unit.uid, unit.might);
  };
  for (const unit of attackers) place(unit, 'P1');
  for (const unit of defenders) place(unit, 'P2');
  board = applyOpenDuelCleanup(board);
  board = beginDuelCombat(board, fieldId);
  assertDuelBoard(board);
  return { fieldId, state: { stateVersion: 7, board, unitMeta }, might };
}

function bind(scene, rules, seen = []) {
  return createTrustedDuelBaseCombatFacts(scene.state.stateVersion, scene.fieldId, {
    currentMight: input => {
      seen.push([input.uid, input.combatRole]);
      return scene.might.get(input.uid);
    },
    proveBasicCombat: () => ({ currentMight: 'validated', assignmentModifier: 'proven-none',
      preventionReplacement: 'proven-none', keywordPriority: 'validated' }),
    assignmentRules: () => rules,
  });
}

test('raw continuous.combat IR becomes live Tank/normal/Backline assignment order', () => {
  const scene = combat({
    attackers: [{ uid: 'a', might: 9 }],
    defenders: [{ uid: 'tank', might: 3 }, { uid: 'plain', might: 3 }, { uid: 'back', might: 3 }],
  });
  const rules = deriveDuelCombatAssignmentRulesFromIR([
    tankIR('tank'), backlineIR('back'),
  ], ['a', 'tank', 'plain', 'back']);
  const roles = [];
  const plan = planDuelBaseCombatDamage(scene.state, scene.fieldId, bind(scene, rules, roles));
  assert.deepEqual(plan.attacker.targets.map(target => [target.uid, target.assignmentPriority]), [
    ['tank', 'first'], ['plain', 'normal'], ['back', 'last'],
  ]);
  assert.deepEqual(roles, [['a', 'attacker'], ['tank', 'defender'], ['plain', 'defender'], ['back', 'defender']]);
  blocked(() => validateDuelBaseCombatAllocation(plan, 'P1', [amount('plain', 3), amount('tank', 6)]), 'invalid-allocation');
  blocked(() => validateDuelBaseCombatAllocation(plan, 'P1', [amount('back', 3), amount('tank', 3), amount('plain', 3)]), 'invalid-allocation');
  assert.deepEqual(validateDuelBaseCombatAllocation(plan, 'P1', [
    amount('tank', 3), amount('plain', 3), amount('back', 3),
  ]).assignments, [amount('tank', 3), amount('plain', 3), amount('back', 3)]);
});

test('multiple Tank units may be chosen in either order, while non-Tank remains illegal', () => {
  const scene = combat({
    attackers: [{ uid: 'a', might: 6 }],
    defenders: [{ uid: 'tank-a', might: 3 }, { uid: 'tank-b', might: 3 }, { uid: 'plain', might: 3 }],
  });
  const rules = deriveDuelCombatAssignmentRulesFromIR([tankIR('tank-a'), tankIR('tank-b')],
    ['a', 'tank-a', 'tank-b', 'plain']);
  const plan = planDuelBaseCombatDamage(scene.state, scene.fieldId, bind(scene, rules));
  assert.deepEqual(validateDuelBaseCombatAllocation(plan, 'P1', [
    amount('tank-b', 3), amount('tank-a', 3),
  ]).assignments, [amount('tank-b', 3), amount('tank-a', 3)]);
  blocked(() => validateDuelBaseCombatAllocation(plan, 'P1', [amount('plain', 3), amount('tank-a', 3)]), 'invalid-allocation');
});

test('a Unit with both Tank and Backline resolves one exclusionary requirement', () => {
  const scene = combat({
    attackers: [{ uid: 'a', might: 6 }],
    defenders: [{ uid: 'dual', might: 3 }, { uid: 'plain', might: 3 }],
  });
  const rules = deriveDuelCombatAssignmentRulesFromIR([
    tankIR('dual'), backlineIR('dual'),
  ], ['a', 'dual', 'plain']);
  const plan = planDuelBaseCombatDamage(scene.state, scene.fieldId, bind(scene, rules));
  assert.equal(plan.attacker.targets[0].assignmentPriority, 'choice');
  assert.deepEqual(validateDuelBaseCombatAllocation(plan, 'P1', [
    amount('dual', 3), amount('plain', 3),
  ]).assignments, [amount('dual', 3), amount('plain', 3)]);
  assert.deepEqual(validateDuelBaseCombatAllocation(plan, 'P1', [
    amount('plain', 3), amount('dual', 3, 'last'),
  ]).assignments, [amount('plain', 3), amount('dual', 3)]);
  blocked(() => validateDuelBaseCombatAllocation(plan, 'P1', [
    amount('plain', 3), amount('dual', 3, 'first'),
  ]), 'invalid-allocation');
});

test('current-layer lethal threshold, no-damage exemption, and retry/rollback boundaries are enforced', () => {
  const scene = combat({
    attackers: [{ uid: 'a', might: 4 }],
    defenders: [{ uid: 'immune', might: 7 }, { uid: 'marked', might: 3, marks: [1] }],
  });
  const rules = {
    status: 'validated',
    units: [
      { uid: 'a' },
      { uid: 'immune', canReceiveDamage: false },
      // A sourced prevention effect makes five total damage lethal; one is already marked.
      { uid: 'marked', lethalDamage: 5 },
    ],
  };
  const plan = planDuelBaseCombatDamage(scene.state, scene.fieldId, bind(scene, rules));
  assert.equal(plan.attacker.targets.find(target => target.uid === 'marked').lethalNeed, 4);
  blocked(() => validateDuelBaseCombatAllocation(plan, 'P1', [amount('immune', 4)]), 'invalid-allocation');
  blocked(() => validateDuelBaseCombatAllocation(plan, 'P1', [amount('marked', 2), amount('immune', 2)]), 'invalid-allocation');
  const attack = validateDuelBaseCombatAllocation(plan, 'P1', [amount('marked', 4)], 7);
  const defense = validateDuelBaseCombatAllocation(plan, 'P2', [amount('a', 10)], 7);
  blocked(() => completeDuelBaseCombatAllocation(attack, defense, 8), 'stale-plan');
  const complete = completeDuelBaseCombatAllocation(attack, defense, 7);
  assert.equal(complete.readyForSimultaneousDeal, true);
  blocked(() => completeDuelBaseCombatAllocation(attack, defense, 7), 'plan-already-used');
});

test('explicit assignment bounds are consumed and inconsistent validated proofs stay blocked', () => {
  const scene = combat({
    attackers: [{ uid: 'a', might: 5 }],
    defenders: [{ uid: 'd1', might: 2 }, { uid: 'd2', might: 3 }],
  });
  const rules = {
    status: 'validated',
    units: [
      { uid: 'a' },
      { uid: 'd1', minAssignable: 2, maxAssignable: 2 },
      { uid: 'd2', minAssignable: 1, maxAssignable: 3 },
    ],
  };
  const plan = planDuelBaseCombatDamage(scene.state, scene.fieldId, bind(scene, rules));
  assert.deepEqual(validateDuelBaseCombatAllocation(plan, 'P1', [
    amount('d1', 2), amount('d2', 3),
  ]).assignments, [amount('d1', 2), amount('d2', 3)]);
  blocked(() => validateDuelBaseCombatAllocation(plan, 'P1', [
    amount('d1', 1), amount('d2', 4),
  ]), 'invalid-allocation');

  const inconsistent = createTrustedDuelBaseCombatFacts(scene.state.stateVersion, scene.fieldId, {
    currentMight: input => scene.might.get(input.uid),
    proveBasicCombat: () => ({ currentMight: 'validated', assignmentModifier: 'proven-none',
      preventionReplacement: 'proven-none', keywordPriority: 'validated' }),
    assignmentRules: () => ({ status: 'proven-none', units: [] }),
  });
  blocked(() => planDuelBaseCombatDamage(scene.state, scene.fieldId, inconsistent),
    'source-effect-proof-incomplete');
});

test('unknown assignment semantics stay blocked instead of being treated as proven-none', () => {
  const scene = combat({ defenders: [{ uid: 'd1', might: 3 }] });
  const noRules = {
    currentMight: input => scene.might.get(input.uid),
    proveBasicCombat: () => ({ currentMight: 'validated', assignmentModifier: 'proven-none',
      preventionReplacement: 'proven-none', keywordPriority: 'validated' }),
  };
  const facts = createTrustedDuelBaseCombatFacts(scene.state.stateVersion, scene.fieldId, noRules);
  blocked(() => planDuelBaseCombatDamage(scene.state, scene.fieldId, facts), 'source-effect-proof-missing');
  blocked(() => deriveDuelCombatAssignmentRulesFromIR([{
    effect: { kind: 'continuous.combat', mode: 'unknown', priority: 'first', damage: 'lethal',
      controllerScope: 'same-controller', excludesKeyword: 'Tank' }, filter: { objectId: 'd1' },
  }], ['a', 'd1']), 'source-effect-proof-incomplete');
});

