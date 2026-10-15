import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDuelBoard, placeDuelUnit, applyOpenDuelCleanup, beginDuelCombat } from '../dist/duel/battlefields.js';

// Focused source run transpiles both owned TS modules in memory, sharing one kernel
// identity across the scene and choice; it never writes into the shared dist tree.
async function loadModules() {
  if (process.env.DUEL_COMBAT_CHOICE_SOURCE !== '1') {
    return [await import('../dist/duel/base-combat-allocation.js'),
      await import('../dist/duel/combat-choice-v2.js'),
      await import('../dist/duel/combat-choice-v2.js?second-choice-instance')];
  }
  const ts = await import('typescript');
  const kernelSource = await readFile(new URL('../src/duel/base-combat-allocation.ts', import.meta.url), 'utf8');
  const compile = (source, fileName) => {
    const { outputText, diagnostics } = ts.transpileModule(source, {
      fileName, reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    });
    assert.deepEqual(diagnostics, []);
    return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
  };
  const kernelURL = compile(kernelSource, 'base-combat-allocation.ts');
  const choiceSource = await readFile(new URL('../src/duel/combat-choice-v2.ts', import.meta.url), 'utf8');
  const kernelImport = "from './base-combat-allocation.js'";
  assert.equal(choiceSource.split(kernelImport).length, 2, 'one base kernel dependency');
  const choiceURL = compile(choiceSource.replace(kernelImport, `from '${kernelURL}'`), 'combat-choice-v2.ts');
  return [await import(kernelURL), await import(choiceURL), await import(`${choiceURL}#second-choice-instance`)];
}
const [kernel, choice, secondChoice] = await loadModules();
const { createTrustedDuelBaseCombatFacts, planDuelBaseCombatDamage,
  validateDuelBaseCombatAllocation: validate, completeDuelBaseCombatAllocation: complete,
  DuelBaseCombatBlockedError } = kernel;
const { createDuelCombatChoiceCursorV2: create, submitDuelCombatChoiceV2: submit,
  DuelCombatChoiceV2BlockedError } = choice;
const amount = (uid, points) => ({ uid, amount: points });
const provenBasic = () => ({ currentMight: 'validated', assignmentModifier: 'proven-none',
  preventionReplacement: 'proven-none', keywordPriority: 'proven-none' });
function rejectCode(callback, ErrorType, code) {
  assert.throws(callback, error => error instanceof ErrorType && error.code === code,
    `expected ${ErrorType.name} [${code}]`);
}
const choiceError = (callback, code) => rejectCode(callback, DuelCombatChoiceV2BlockedError, code);
const kernelError = (callback, code) => rejectCode(callback, DuelBaseCombatBlockedError, code);

function scene() {
  let board = createDuelBoard({
    selected: [
      { playerId: 'P1', instanceId: 'field:1', cardId: 'battlefield:1' },
      { playerId: 'P2', instanceId: 'field:2', cardId: 'battlefield:2' },
    ],
    removedByPlayer: [
      { playerId: 'P1', battlefields: [
        { instanceId: 'field:3', cardId: 'battlefield:3' },
        { instanceId: 'field:4', cardId: 'battlefield:4' },
      ] },
      { playerId: 'P2', battlefields: [
        { instanceId: 'field:5', cardId: 'battlefield:5' },
        { instanceId: 'field:6', cardId: 'battlefield:6' },
      ] },
    ],
  });
  const fieldId = board.battlefields[0].locationId;
  for (const [uid, controllerPlayerId] of [['a', 'P1'], ['d1', 'P2'], ['d2', 'P2']]) {
    board = placeDuelUnit(board, { objectId: uid, controllerPlayerId, locationId: fieldId });
  }
  board = beginDuelCombat(applyOpenDuelCleanup(board), fieldId);
  const state = { stateVersion: 17, board,
    unitMeta: { a: { damageMarks: [] }, d1: { damageMarks: [] }, d2: { damageMarks: [] } } };
  const facts = createTrustedDuelBaseCombatFacts(17, fieldId, {
    currentMight: unit => ({ a: 5, d1: 3, d2: 3 })[unit.uid],
    proveBasicCombat: provenBasic,
  });
  return { state, plan: planDuelBaseCombatDamage(state, fieldId, facts) };
}
const attack = [amount('d1', 3), amount('d2', 2)];
const defense = [amount('a', 6)];

// Explicit version at *every* entry is the caller's current stateVersion, not a client claim.
test('real plan -> Attacker -> Defender -> simultaneous deal plan, with detached immutable choices', () => {
  const { state, plan } = scene();
  const originalState = structuredClone(state);
  const originalAttack = structuredClone(attack);
  const initial = create(plan, 17);
  assert.deepEqual([initial.expectedSide, initial.expectedActorPlayerId, initial.stateVersion,
    initial.fieldId, initial.sideIDs, initial.committedAllocations],
  ['attacker', 'P1', 17, plan.fieldId, ['P1', 'P2'], []]);
  assert.equal(Object.isFrozen(initial), true);
  assert.equal(Object.isFrozen(initial.sideIDs), true);
  assert.equal(JSON.stringify(initial).includes('budget'), false);
  assert.equal(JSON.stringify(initial).includes('board'), false);
  assert.equal(JSON.stringify(initial).includes('currentMight'), false);
  const ordered = structuredClone(attack);
  const pending = submit(initial, plan, 'attacker', 'P1', ordered, 17);
  assert.notStrictEqual(pending, initial);
  assert.equal(pending.expectedSide, 'defender');
  assert.equal(pending.expectedActorPlayerId, 'P2');
  assert.deepEqual(pending.committedAllocations, [
    { side: 'attacker', actorPlayerId: 'P1', assignments: attack },
  ]);
  assert.equal(Object.isFrozen(pending.committedAllocations), true);
  assert.equal(Object.isFrozen(pending.committedAllocations[0]), true);
  assert.equal(Object.isFrozen(pending.committedAllocations[0].assignments), true);
  assert.equal(Object.isFrozen(pending.committedAllocations[0].assignments[0]), true);
  assert.notStrictEqual(pending.committedAllocations[0].assignments, ordered);
  ordered[0].amount = 99;
  assert.deepEqual(pending.committedAllocations[0].assignments, originalAttack);
  const deal = submit(pending, plan, 'defender', 'P2', defense, 17);
  assert.equal(deal.kind, 'duel-base-combat-complete-allocation');
  assert.equal(deal.readyForSimultaneousDeal, true);
  assert.equal(Object.isFrozen(deal), true);
  assert.deepEqual(deal.sideIDs, ['P1', 'P2']);
  assert.deepEqual(deal.attacker.assignments, attack);
  assert.deepEqual(deal.defender.assignments, defense);
  assert.deepEqual(state, originalState);
  assert.equal('board' in deal, false);
  assert.equal('damageMarks' in deal, false);
});

test('Defender before Attacker and Attacker twice are rejected without consuming the pending cursor', () => {
  const { plan } = scene();
  const initial = create(plan, 17);
  choiceError(() => submit(initial, plan, 'defender', 'P2', defense, 17), 'unexpected-side');
  choiceError(() => submit(initial, plan, 'attacker', 'P2', attack, 17), 'unexpected-actor');
  const pending = submit(initial, plan, 'attacker', 'P1', attack, 17);
  choiceError(() => submit(pending, plan, 'attacker', 'P1', attack, 17), 'unexpected-side');
  choiceError(() => submit(pending, plan, 'defender', 'P1', defense, 17), 'unexpected-actor');
  assert.equal(submit(pending, plan, 'defender', 'P2', defense, 17).readyForSimultaneousDeal, true);
});

test('stale versions cannot create or advance either side, with legal retry at unchanged clock', () => {
  const { plan } = scene();
  kernelError(() => create(plan, 18), 'stale-plan');
  kernelError(() => create(plan, -1), 'stale-plan');
  const initial = create(plan, 17);
  kernelError(() => submit(initial, plan, 'attacker', 'P1', attack, 18), 'stale-plan');
  const pending = submit(initial, plan, 'attacker', 'P1', attack, 17);
  kernelError(() => submit(pending, plan, 'defender', 'P2', defense, 18), 'stale-plan');
  assert.equal(submit(pending, plan, 'defender', 'P2', defense, 17).readyForSimultaneousDeal, true);
});

test('old cursor replay and second completion cannot succeed, even with immutable references', () => {
  const { plan } = scene();
  const initial = create(plan, 17);
  const pending = submit(initial, plan, 'attacker', 'P1', attack, 17);
  choiceError(() => submit(initial, plan, 'attacker', 'P1', attack, 17), 'cursor-consumed');
  const deal = submit(pending, plan, 'defender', 'P2', defense, 17);
  assert.equal(deal.readyForSimultaneousDeal, true);
  choiceError(() => submit(pending, plan, 'defender', 'P2', defense, 17), 'cursor-consumed');
  choiceError(() => submit(deal, plan, 'defender', 'P2', defense, 17), 'invalid-cursor');
});

test('cloned, spread and entirely forged cursors/plans never gain private authority', () => {
  const { plan } = scene();
  kernelError(() => create(structuredClone(plan), 17), 'invalid-plan');
  const initial = create(plan, 17);
  for (const forged of [structuredClone(initial), { ...initial }, Object.create(initial),
    { ...initial, expectedSide: 'defender', expectedActorPlayerId: 'P2' }]) {
    choiceError(() => submit(forged, plan, 'attacker', 'P1', attack, 17), 'invalid-cursor');
  }
  choiceError(() => submit(initial, structuredClone(plan), 'attacker', 'P1', attack, 17), 'plan-mismatch');
  assert.equal(submit(initial, plan, 'attacker', 'P1', attack, 17).expectedSide, 'defender');
});

test('reentrant Proxy traps cannot use the same cursor or reopen its plan before commit', () => {
  const { plan } = scene();
  const initial = create(plan, 17);
  let reentryAttempts = 0;
  const hostileAmount = new Proxy(amount('d1', 3), {
    ownKeys(target) {
      reentryAttempts++;
      choiceError(() => submit(initial, plan, 'attacker', 'P1', attack, 17), 'cursor-in-use');
      choiceError(() => create(plan, 17), 'plan-already-used');
      return Reflect.ownKeys(target);
    },
  });
  const pending = submit(initial, plan, 'attacker', 'P1', [hostileAmount, amount('d2', 2)], 17);
  assert.equal(reentryAttempts, 2);
  assert.deepEqual(pending.committedAllocations[0].assignments, attack);
  choiceError(() => submit(initial, plan, 'attacker', 'P1', attack, 17), 'cursor-consumed');
  assert.equal(submit(pending, plan, 'defender', 'P2', defense, 17).readyForSimultaneousDeal, true);
});

test('distinct trusted plans with identical field and version cannot be interchanged', () => {
  const { plan } = scene();
  const { plan: other } = scene();
  assert.deepEqual(plan, other);
  assert.notStrictEqual(plan, other);
  const initial = create(plan, 17);
  choiceError(() => submit(initial, other, 'attacker', 'P1', attack, 17), 'plan-mismatch');
  const pending = submit(initial, plan, 'attacker', 'P1', attack, 17);
  choiceError(() => submit(pending, other, 'defender', 'P2', defense, 17), 'plan-mismatch');
  assert.equal(submit(pending, plan, 'defender', 'P2', defense, 17).readyForSimultaneousDeal, true);
});

test('Proxy length timing cannot turn a nonlethal first target into an accepted choice', () => {
  const { plan } = scene();
  const initial = create(plan, 17);
  let reads = 0;
  const input = new Proxy([amount('d1', 1), amount('d2', 4)], {
    get(target, property, receiver) {
      if (property === 'length' && ++reads === 2) return 1;
      return Reflect.get(target, property, receiver);
    },
  });
  kernelError(() => submit(initial, plan, 'attacker', 'P1', input, 17), 'invalid-allocation');
  assert.ok(reads >= 1);
  const pending = submit(initial, plan, 'attacker', 'P1', attack, 17);
  assert.equal(submit(pending, plan, 'defender', 'P2', defense, 17).readyForSimultaneousDeal, true);
});

test('one real plan creates one active cursor chain and never produces a second completion', () => {
  const { plan } = scene();
  const initial = create(plan, 17);
  choiceError(() => create(plan, 17), 'plan-already-used');
  kernelError(() => submit(initial, plan, 'attacker', 'P1', [amount('d1', 2), amount('d2', 3)], 17),
    'invalid-allocation');
  choiceError(() => create(plan, 17), 'plan-already-used');
  const pending = submit(initial, plan, 'attacker', 'P1', attack, 17);
  choiceError(() => create(plan, 17), 'plan-already-used');
  assert.equal(submit(pending, plan, 'defender', 'P2', defense, 17).readyForSimultaneousDeal, true);
  choiceError(() => create(plan, 17), 'plan-already-used');
  const { plan: independent } = scene();
  assert.equal(create(independent, 17).expectedSide, 'attacker');
});

test('two choice module instances share the kernel one-shot completion authority', () => {
  const { plan } = scene();
  assert.notStrictEqual(choice, secondChoice);
  const first = create(plan, 17);
  const second = secondChoice.createDuelCombatChoiceCursorV2(plan, 17);
  const firstPending = submit(first, plan, 'attacker', 'P1', attack, 17);
  const secondPending = secondChoice.submitDuelCombatChoiceV2(
    second, plan, 'attacker', 'P1', attack, 17);
  assert.equal(submit(firstPending, plan, 'defender', 'P2', defense, 17)
    .readyForSimultaneousDeal, true);
  assert.throws(() => secondChoice.submitDuelCombatChoiceV2(
    secondPending, plan, 'defender', 'P2', defense, 17), error =>
    error instanceof DuelBaseCombatBlockedError && error.code === 'plan-already-used' &&
    error.message === 'Duel base combat allocation blocked [plan-already-used]: combat choice cannot be accepted');
  kernelError(() => secondChoice.submitDuelCombatChoiceV2(
    secondPending, plan, 'defender', 'P2', defense, 17), 'plan-already-used');
  choiceError(() => create(plan, 17), 'plan-already-used');
  assert.throws(() => submit(secondPending, plan, 'defender', 'P2', defense, 17), error =>
    error instanceof DuelCombatChoiceV2BlockedError && error.code === 'invalid-cursor',
    'cursors cannot cross choice module instances');
});

test('direct kernel completion and choice completion cannot each complete one plan', () => {
  const { plan } = scene();
  const pending = submit(create(plan, 17), plan, 'attacker', 'P1', attack, 17);
  const directAttacker = validate(plan, 'P1', attack, 17);
  const directDefender = validate(plan, 'P2', defense, 17);
  kernelError(() => complete(directAttacker, directDefender, 18), 'stale-plan');
  assert.equal(complete(directAttacker, directDefender, 17).readyForSimultaneousDeal, true);
  assert.throws(() => submit(pending, plan, 'defender', 'P2', defense, 17), error =>
    error instanceof DuelBaseCombatBlockedError && error.code === 'plan-already-used' &&
    error.message === 'Duel base combat allocation blocked [plan-already-used]: combat choice cannot be accepted');

  const { plan: freshPlan } = scene();
  const freshPending = submit(create(freshPlan, 17), freshPlan, 'attacker', 'P1', attack, 17);
  assert.equal(submit(freshPending, freshPlan, 'defender', 'P2', defense, 17)
    .readyForSimultaneousDeal, true);
  const freshAttacker = validate(freshPlan, 'P1', attack, 17);
  const freshDefender = validate(freshPlan, 'P2', defense, 17);
  kernelError(() => complete(freshAttacker, freshDefender, 17), 'plan-already-used');
});

test('missing/undefined version, invalid plan, and failed submissions do not consume a fresh plan', () => {
  const { plan } = scene();
  for (const invalid of [undefined, null, -1, 18, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    kernelError(() => create(plan, invalid), 'stale-plan');
  }
  kernelError(() => create(structuredClone(plan), 17), 'invalid-plan');
  const initial = create(plan, 17);
  kernelError(() => submit(initial, plan, 'attacker', 'P1', attack, undefined), 'stale-plan');
  kernelError(() => submit(initial, plan, 'attacker', 'P1', [amount('d1', 4), amount('d2', 1)], 17),
    'invalid-allocation');
  const pending = submit(initial, plan, 'attacker', 'P1', attack, 17);
  kernelError(() => submit(pending, plan, 'defender', 'P2', defense, undefined), 'stale-plan');
  assert.equal(submit(pending, plan, 'defender', 'P2', defense, 17).readyForSimultaneousDeal, true);
});

test('hostile Proxy input is normalized and can retry without leaking trap text or digits', () => {
  const { plan } = scene();
  const initial = create(plan, 17);
  let ownKeysReads = 0;
  const hostile = new Proxy([amount('d1', 3), amount('d2', 2)], {
    ownKeys(target) {
      ownKeysReads++;
      if (ownKeysReads === 2) throw new Error('private threshold 123456');
      return Reflect.ownKeys(target);
    },
  });
  assert.throws(() => submit(initial, plan, 'attacker', 'P1', hostile, 17), error =>
    error instanceof DuelBaseCombatBlockedError && error.code === 'invalid-allocation' &&
    !/123456|\d/.test(error.message));
  const pending = submit(initial, plan, 'attacker', 'P1', attack, 17);
  const explodingDefender = new Proxy(defense, {
    ownKeys() { throw new Error('defender private 987654'); },
  });
  assert.throws(() => submit(pending, plan, 'defender', 'P2', explodingDefender, 17), error =>
    error instanceof DuelBaseCombatBlockedError && error.code === 'invalid-allocation' &&
    !/987654|\d/.test(error.message));
  assert.equal(submit(pending, plan, 'defender', 'P2', defense, 17).readyForSimultaneousDeal, true);
});

test('public allocation error messages do not reveal budget, lethal need, UID or raw input', () => {
  const { plan } = scene();
  const initial = create(plan, 17);
  for (const invalid of [[], [amount('d1', 1), amount('d2', 4)],
    [amount('private uid 4321', 5)]]) {
    assert.throws(() => submit(initial, plan, 'attacker', 'P1', invalid, 17), error =>
      error instanceof DuelBaseCombatBlockedError && error.code === 'invalid-allocation' &&
      error.message === 'Duel base combat allocation blocked [invalid-allocation]: combat choice cannot be accepted' &&
      !/\d|d1|private uid/.test(error.message));
  }
  const pending = submit(initial, plan, 'attacker', 'P1', attack, 17);
  assert.throws(() => submit(pending, plan, 'defender', 'P2', [], 17), error =>
    error instanceof DuelBaseCombatBlockedError && error.code === 'invalid-allocation' &&
    !/\d/.test(error.message));
  assert.equal(submit(pending, plan, 'defender', 'P2', defense, 17).readyForSimultaneousDeal, true);
});

test('kernel budget and lethal order validation applies to both sides; failure does not spend cursor', () => {
  const { plan } = scene();
  const initial = create(plan, 17);
  for (const invalid of [
    [amount('d1', 3), amount('d2', 1)], // wrong total
    [amount('d1', 2), amount('d2', 3)], // nonlethal before next target
    [amount('d1', 4), amount('d2', 1)], // early overkill
  ]) {
    kernelError(() => submit(initial, plan, 'attacker', 'P1', invalid, 17), 'invalid-allocation');
  }
  const pending = submit(initial, plan, 'attacker', 'P1', attack, 17);
  kernelError(() => submit(pending, plan, 'defender', 'P2', [amount('a', 5)], 17), 'invalid-allocation');
  kernelError(() => submit(pending, plan, 'defender', 'P2', [amount('d1', 6)], 17), 'invalid-allocation');
  assert.equal(submit(pending, plan, 'defender', 'P2', defense, 17).readyForSimultaneousDeal, true);
});
