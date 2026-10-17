// docs/rules/scenarios/keywords.yaml — Disarm (CR v1.5 831.1.c.3, 831.1.d, 831.1.d.1, 831.2).
//
// Disarm expands to an `attack-declared` triggered ability whose body is the merged
// `continuous.might` primitive with a same-location enemy target. The expansion and
// its summed value are real and asserted below; the attack-declared producer is not
// merged (the Combat start transaction is a todo), and the authored target filter uses
// the `sameLocationAs` anchor that src/programs/filters.ts rejects.
import assert from 'node:assert/strict';
import test from 'node:test';
import disarm from '../../../dist/effects/keywords/Disarm.js';
import { expandProgram } from '../../../dist/programs/index.js';
import { instructionDefinitionsById } from '../../../dist/effects/instructions/registry.generated.js';

const DISARM_CARD = 'test:disarm-unit';

const program = {
  canonicalCardId: DISARM_CARD,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: '[Disarm 2]',
  abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: [] }]
};

test('keywords-disarm-attack-trigger-minus-might: Disarm X expands to an attack-declared trigger dealing -X Might to one same-Battlefield enemy Unit (CR 831.1.d, 831.1.c.3)', () => {
  assert.equal(disarm.keyword, 'Disarm');
  assert.equal(disarm.valued, true);
  // 831.2 / 831.1.d.1: several instances sum into one trigger.
  assert.equal(disarm.stacking, 'sum');
  assert.ok(disarm.ruleRefs.includes('831.1.d'));
  assert.ok(disarm.ruleRefs.includes('831.1.d.1'));

  const [ability] = disarm.expand({ value: 2, host: { canonicalCardId: DISARM_CARD } });
  assert.equal(ability.kind, 'triggered');
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, 'attack-declared');
  assert.deepEqual(ability.trigger.filter, { event: 'attack-declared', filter: { source: 'self' } });
  const [instruction] = ability.body;
  assert.equal(instruction.op, 'continuous.might');
  assert.equal(instruction.args.amount.value, -2, 'X Might is subtracted, never added');
  assert.equal(instruction.args.duration.value, 'this-turn');
  assert.deepEqual(instruction.targets, [{
    id: 'disarm.enemy-unit',
    filter: { type: 'unit', zone: 'board', controller: 'opponent', sameLocationAs: 'source' },
    min: 1,
    max: 1,
    selection: 'one'
  }]);
  assert.equal(instructionDefinitionsById.has('continuous.might'), true);
});

test('keywords-disarm-multiple-instances-single-trigger: printed Disarm 2 plus a declared Disarm 1 expand as one -3 Might trigger (CR 831.1.d.1, 831.2)', () => {
  // The source prints Disarm 2 and the program declares Disarm 1; the registrar sums
  // them into one expansion.
  const declared = { ...program, abilities: [...program.abilities, { kind: 'keyword', keyword: 'disarm', value: 1 }] };
  const source = { cardId: DISARM_CARD, ref: { id: 'u1', zoneEntryId: 1 }, types: ['unit'], tags: ['Mech'], keywords: [{ id: 'Disarm', value: 2 }] };
  const expanded = expandProgram(declared, source).expanded;
  assert.equal(expanded.length, 1, 'a single merged trigger');
  assert.equal(expanded[0].body[0].args.amount.value, -3);
});

test('keywords-disarm-*: an omitted Disarm value is presumed to be 1 and a zero value produces no modifier', () => {
  const [defaulted] = disarm.expand({ host: { canonicalCardId: DISARM_CARD } });
  assert.equal(defaulted.body[0].args.amount.value, -1);
  const [zero] = disarm.expand({ value: 0, host: { canonicalCardId: DISARM_CARD } });
  assert.equal(zero.body[0].args.amount.value, 0);
});

test.todo('keywords-disarm-attack-trigger-minus-might / keywords-disarm-multiple-instances-single-trigger / keywords-disarm-no-enemy-unit-trigger-fizzles (831.1.d execution): the attack trigger cannot fire — there is no committed `attack-declared` timing point (src/combat/flow.ts `advance()` throws the batch-4 blocked marker for `combat-start-transaction`, so no designation or attack event is produced), and the trigger’s target filter uses the `sameLocationAs` anchor that src/programs/filters.ts rejects as an unsupported object-filter field; the authored expansion and its summed value are asserted above');

test.todo('keywords-disarm-no-enemy-unit-trigger-fizzles (CR 831.1.d): with no opposing Unit at the Battlefield the trigger must enter the chain and then have no effect — the scenario needs the same missing `attack-declared` timing point and a registerable `sameLocationAs` target filter, so nothing can be observed yet');
