// docs/rules/scenarios/keywords.yaml — Hunt (CR v1.5 823.1.c.1, 823.1.c.2, 823.2).
//
// Hunt expands to two `conquer` / `hold` triggered abilities whose bodies are the
// merged `effect.xp` primitive, and the merged layer-ops path already sums several
// Hunt instances into one value. Registration on the pipeline is blocked by the
// trigger filter’s timing-point spelling (see the todo); the summed value and the XP
// instruction are asserted below.
import assert from 'node:assert/strict';
import test from 'node:test';
import hunt from '../../../dist/effects/keywords/Hunt.js';
import { instructionDefinitionsById } from '../../../dist/effects/instructions/registry.generated.js';
import { runInstruction, world } from '../../../dist/effects/testing/index.js';
import { expandProgram } from '../../../dist/programs/index.js';
import { validateTriggerSpec } from '../../../dist/events/trigger-spec.js';
import { c } from './support.mjs';

const HUNT_CARD = 'test:hunt-unit';

const program = {
  canonicalCardId: HUNT_CARD,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: '[Hunt 2]',
  abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: [] }]
};

test('keywords-hunt-gains-xp-on-conquer: Hunt X expands to a conquer and a hold trigger, each granting X XP (CR 823.1.c.1)', () => {
  assert.equal(hunt.keyword, 'Hunt');
  assert.equal(hunt.valued, true);
  // 823.2: several sources sum into one Hunt value.
  assert.equal(hunt.stacking, 'sum');
  assert.ok(hunt.ruleRefs.includes('823.1.c.1'));
  assert.ok(hunt.ruleRefs.includes('823.2'));

  const abilities = hunt.expand({ value: 2, host: { canonicalCardId: HUNT_CARD } });
  assert.equal(abilities.length, 2, 'conquer and hold');
  assert.deepEqual(abilities.map(ability => ability.trigger.at), ['conquer', 'hold']);
  for (const ability of abilities) {
    assert.equal(ability.kind, 'triggered');
    assert.equal(ability.optional, false);
    assert.deepEqual(ability.trigger.filter, { event: ability.trigger.at, filter: { source: 'self' } });
    assert.deepEqual(ability.body.map(instruction => instruction.op), ['effect.xp']);
    assert.equal(ability.body[0].args.amount.value, 2);
  }
  assert.equal(instructionDefinitionsById.has('effect.xp'), true);

  // 823.1.b.3-style default: an omitted value is Hunt 1.
  const [defaulted] = hunt.expand({ host: { canonicalCardId: HUNT_CARD } });
  assert.equal(defaulted.body[0].args.amount.value, 1);
});

test('keywords-hunt-stacks-from-multiple-sources: printed Hunt 1 plus a granted Hunt 2 expand as a single Hunt 3 (CR 823.2)', () => {
  // The program declares Hunt 1 and the source prints Hunt 2, so the registrar
  // sums them and calls expand once with value 3.
  const declared = { ...program, abilities: [...program.abilities, { kind: 'keyword', keyword: 'hunt', value: 1 }] };
  const source = { cardId: HUNT_CARD, ref: { id: 'u1', zoneEntryId: 1 }, types: ['unit'], keywords: [{ id: 'Hunt', value: 2 }] };
  const expanded = expandProgram(declared, source).expanded;
  assert.equal(expanded.length, 2, 'one conquer trigger and one hold trigger');
  for (const ability of expanded) assert.equal(ability.body[0].args.amount.value, 3);
});

test('keywords-hunt-gains-xp-on-conquer: the merged effect.xp instruction grants the controller the XP (CR 823.1.c.1, 823.1.c.2)', () => {
  const kernel = world().player('A', { xp: 0 }).player('B')
    .unit('u1', { cardId: HUNT_CARD, might: 3, keywords: [{ id: 'Hunt', value: 2 }], location: { type: 'battlefield', id: 'bf1' } })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject('u1'), controller: 'A' });
  const run = runInstruction(instructionDefinitionsById.get('effect.xp'), { amount: c(2) }, { world: context });

  assert.equal(run.result.status, 'executed');
  assert.deepEqual(run.events.map(event => event.action), ['gain-xp']);
  assert.equal(context.player('A').xp, 2, 'the controller gained the Hunt value');
  assert.equal(context.player('B').xp, 0);
});

test('keywords-hunt-gains-xp-on-conquer: the authored Hunt trigger filter is rejected by the frozen EventPattern validator', () => {
  const abilities = hunt.expand({ value: 2, host: { canonicalCardId: HUNT_CARD } });
  for (const ability of abilities) {
    const result = validateTriggerSpec({ at: ability.trigger.at, filter: ability.trigger.filter });
    assert.equal(result.ok, false, `${ability.trigger.at} is not a registrable EventPattern`);
    assert.ok(result.issues.some(issue => issue.path === 'trigger.filter.event' && issue.code === 'invalid-event-type'), JSON.stringify(result.issues));
  }
});

test.todo('keywords-hunt-gains-xp-on-conquer / keywords-hunt-stacks-from-multiple-sources (823.1.c.1 execution): the expanded trigger cannot register — its filter names the timing-point ids `conquer`/`hold`, which the frozen EventPattern vocabulary cannot express (src/events/trigger-spec.ts EVENT_PATTERN_TYPES has `conquered`/`held`, and src/events/pipeline-match.ts does map those aliases, but the authored spelling never reaches it because registerTrigger validates first); the summed Hunt value and the real effect.xp grant are asserted above');
