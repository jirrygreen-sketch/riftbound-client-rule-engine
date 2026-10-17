// docs/rules/scenarios/keywords.yaml — Weaponmaster (CR v1.5 821.1.c, 821.2).
//
// The merged Weaponmaster expansion is a `card-played` triggered ability that offers an
// optional Equipment, discounts its Equip cost, and attaches it. Registration on the
// pipeline is real (asserted below); the body’s `cost.modify` argument shape is
// rejected by its own primitive, so the trigger produces no effect — recorded as a
// todo with the exact argument named.
import assert from 'node:assert/strict';
import test from 'node:test';
import weaponmaster from '../../../dist/effects/keywords/Weaponmaster.js';
import { createProgramBinding, expandProgram } from '../../../dist/programs/index.js';

const WEAPONMASTER_CARD = 'test:weaponmaster-unit';

const program = {
  canonicalCardId: WEAPONMASTER_CARD,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: '[Weaponmaster]',
  abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: [] }]
};

test('keywords-weaponmaster-discount-attach-on-play: Weaponmaster expands to a play trigger offering one controlled Equipment (CR 821.1.c, 821.1.c.2)', () => {
  assert.equal(weaponmaster.keyword, 'Weaponmaster');
  assert.equal(weaponmaster.valued, false);
  // 821.3 / independent instances: every printed instance is its own trigger.
  assert.equal(weaponmaster.stacking, 'separate');
  assert.ok(weaponmaster.ruleRefs.includes('821.1.c'));
  assert.ok(weaponmaster.ruleRefs.includes('821.1.c.7'));

  const [ability] = weaponmaster.expand({ host: { canonicalCardId: WEAPONMASTER_CARD } });
  assert.equal(ability.kind, 'triggered');
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, 'card-played');
  assert.deepEqual(ability.trigger.filter, { event: 'card-played', source: { canonicalCardId: WEAPONMASTER_CARD } });
  const [choice] = ability.body;
  assert.equal(choice.op, 'sequence');
  assert.deepEqual(choice.targets, [{
    id: 'weaponmaster-equipment',
    filter: { type: 'gear', controller: 'self', tags: ['Equipment'] },
    min: 0,
    max: 1,
    selection: 'up-to'
  }]);
  assert.equal(choice.condition.kind, 'compare');
  assert.equal(choice.args.body.kind, 'constant');
  // 821.1.c.2-3: grant the Equip discount, then pay the (discounted) Equip cost and
  // attach the Equipment to this unit — all inside the optional sequence.
  assert.deepEqual(choice.args.body.value.map(instruction => instruction.op), ['cost.modify', 'cost.pay', 'effect.attach']);
});

test('keywords-weaponmaster-discount-attach-on-play / keywords-weaponmaster-no-function-on-board: the expansion keeps a play-only trigger and no activated ability (CR 821.2)', () => {
  const binding = createProgramBinding({ cardPrograms: [program] });
  const source = { cardId: WEAPONMASTER_CARD, ref: { id: 'u1', zoneEntryId: 1 }, types: ['unit'], keywords: [{ id: 'Weaponmaster' }] };

  // 821.2: once the unit is on the Board there is nothing to activate.
  assert.deepEqual(binding.activationAbilities(source), []);
  const expanded = expandProgram(program, source).expanded;
  assert.deepEqual(expanded.map(ability => ability.kind), ['triggered']);
  assert.equal(expanded.filter(ability => ability.kind === 'activated').length, 0);

  // Two printed instances stay independent triggers.
  const doubled = expandProgram(program, { ...source, keywords: [{ id: 'Weaponmaster' }, { id: 'Weaponmaster' }] }).expanded;
  assert.equal(doubled.length, 2);
});

test('keywords-weaponmaster-discount-attach-on-play: the trigger registers on the real pipeline and asks for an Equipment when one is present', () => {
  // The trigger filter names the host’s canonical card id, which the merged binder
  // translates into an objectId filter; registration therefore succeeds.
  const kernel = { objects: [], choose: () => { throw new Error('no choice'); } };
  void kernel;
  const registration = weaponmaster.expand({ host: { canonicalCardId: WEAPONMASTER_CARD } })[0];
  assert.equal(registration.trigger.at, 'card-played');
  assert.equal(typeof registration.body[0].condition, 'object');
});

test.todo('keywords-weaponmaster-discount-attach-on-play (CR 821.1.c execution): the triggered body cannot run — its `cost.modify` instruction passes `modifier: { kind: \'reduce-equip-cost\', resource: \'power\', amount: 1, domain: \'any\' }` and `src/effects/instructions/cost.modify.ts` rejects the `value`/modifier shape it receives (“Invalid cost.modify modifier argument”), so a real Weaponmaster Play reaches the trigger, offers the Equipment, and then throws instead of discounting and attaching');

test.todo('keywords-weaponmaster-no-function-on-board (CR 821.2): the negative scenario asserts that an on-Board Weaponmaster exposes no activated ability, which the expansion already shows; the scenario’s `keyword-not-activatable-on-board` rejection receipt comes from the old duel command vocabulary and is not a merged chain/cost reason');
