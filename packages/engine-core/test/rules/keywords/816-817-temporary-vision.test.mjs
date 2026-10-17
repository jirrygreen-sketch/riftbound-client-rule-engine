// docs/rules/scenarios/keywords.yaml — Temporary (CR v1.5 816.1.b, 816.2.a) and Vision
// (817.1.b, 817.1.c, 817.2, 817.2.b).
//
// Temporary expands to a `beginning-start` trigger; Vision expands to an
// `object-enters-board` trigger whose body is a real `effect.inspect` + `effect.recycle`
// pair. Both are inspectable through the merged program expander; registration is
// blocked for named reasons recorded as todos.
import assert from 'node:assert/strict';
import test from 'node:test';
import temporary from '../../../dist/effects/keywords/Temporary.js';
import vision from '../../../dist/effects/keywords/Vision.js';
import { expandProgram, createProgramBinding } from '../../../dist/programs/index.js';
import { instructionDefinitionsById } from '../../../dist/effects/instructions/registry.generated.js';
import { validateTriggerSpec } from '../../../dist/events/trigger-spec.js';
import { world } from './support.mjs';

const TEMPORARY_CARD = 'test:temporary-unit';
const VISION_CARD = 'test:vision-unit';

const program = canonicalCardId => ({
  canonicalCardId,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: canonicalCardId,
  abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: [] }]
});

test('keywords-temporary-killed-at-controller-beginning-phase: Temporary expands to one mandatory beginning-start self-kill (CR 816.1.b, 816.1.c)', () => {
  assert.equal(temporary.keyword, 'Temporary');
  assert.equal(temporary.valued, false);
  // 816.2.a: any number of Temporary instances still trigger the ability once.
  assert.equal(temporary.stacking, 'single');
  assert.ok(temporary.ruleRefs.includes('816.1.b'));
  assert.ok(temporary.ruleRefs.includes('816.2.a'));

  const [ability] = temporary.expand({ host: { canonicalCardId: TEMPORARY_CARD } });
  assert.equal(ability.kind, 'triggered');
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, 'beginning-start');
  assert.deepEqual(ability.trigger.filter, { event: 'beginning-start', player: 'self' });
  assert.deepEqual(ability.body.map(instruction => [instruction.op, instruction.args]), [['effect.kill', { self: { kind: 'constant', value: true } }]]);
  // 816.1.b places the kill before the Beginning Step’s Scoring.
  assert.equal(instructionDefinitionsById.has('effect.kill'), true);
});

test('keywords-vision-trigger-on-played: Vision expands to one object-enters-board trigger that inspects then recycles (CR 817.1.b, 817.1.c)', () => {
  assert.equal(vision.keyword, 'Vision');
  assert.equal(vision.valued, false);
  // 817.2: each instance keeps its own trigger and its own decision.
  assert.equal(vision.stacking, 'separate');
  assert.ok(vision.ruleRefs.includes('817.1.b'));
  assert.ok(vision.ruleRefs.includes('817.2'));

  const [ability] = vision.expand({ host: { canonicalCardId: VISION_CARD } });
  assert.equal(ability.kind, 'triggered');
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, 'object-enters-board');
  assert.deepEqual(ability.body.map(instruction => instruction.op), ['effect.inspect', 'effect.recycle']);
  const [look, recycle] = ability.body;
  assert.equal(look.args.zone.value, 'deck', 'Predict looks at the top of the Rune-free Main Deck');
  assert.equal(look.args.amount.value, 1, '437.3.a defaults Predict to one card');
  assert.deepEqual(look.args.chooseCount.value, { min: 0, max: 1 });
  assert.equal(recycle.linkedTo, 'vision-look');
  assert.equal(recycle.args.objects.kind, 'linked');
  assert.equal(instructionDefinitionsById.has('effect.inspect'), true);
  assert.equal(instructionDefinitionsById.has('effect.recycle'), true);
});

test('keywords-temporary-multiple-instances-trigger-once: two printed Temporary instances still expand to one ability (CR 816.2.a)', () => {
  const kernel = world().unit('u1', { cardId: TEMPORARY_CARD, zone: 'board', keywords: [{ id: 'Temporary' }, { id: 'Temporary' }] }).build();
  const expanded = expandProgram(program(TEMPORARY_CARD), kernel.getObject('u1')).expanded;
  assert.equal(expanded.length, 1, 'the registrar merges the duplicates by keyword id');
});

test('keywords-vision-multiple-instances-trigger-separately: two printed Vision instances stay two triggered abilities (CR 817.2, 817.2.b)', () => {
  const kernel = world().unit('u1', { cardId: VISION_CARD, zone: 'board', keywords: [{ id: 'Vision' }, { id: 'Vision' }] }).build();
  const expanded = expandProgram(program(VISION_CARD), kernel.getObject('u1')).expanded;
  assert.equal(expanded.length, 2, 'separate stacking keeps both instances');
});

test('keywords-temporary-killed-at-controller-beginning-phase: the production trigger registration rejects the authored Temporary filter', () => {
  const [ability] = temporary.expand({ host: { canonicalCardId: TEMPORARY_CARD } });
  // The trigger’s timing id is a real TimingPointId, but the frozen EventPattern
  // type vocabulary cannot name it, so a registered spec is rejected.
  const result = validateTriggerSpec({ at: ability.trigger.at, filter: ability.trigger.filter });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.path === 'trigger.filter.event' && issue.code === 'invalid-event-type'), JSON.stringify(result.issues));

  const kernel = world().unit('u1', { cardId: TEMPORARY_CARD, zone: 'board', keywords: [{ id: 'Temporary' }] }).build();
  const binding = createProgramBinding({ cardPrograms: [program(TEMPORARY_CARD)] });
  assert.throws(
    () => binding.registerProgramTriggers({ pipeline: { registerTrigger: () => { throw new Error('unreachable'); } } }, kernel.getObject('u1'))
  );
});

test.todo('keywords-temporary-killed-at-controller-beginning-phase / keywords-temporary-multiple-instances-trigger-once (CR 816.1.b): the authored trigger uses the timing-point id `beginning-start`, which the frozen EventPattern type vocabulary cannot express (src/events/trigger-spec.ts EVENT_PATTERN_TYPES starts at zone-entered/zone-left), so src/events/pipeline.ts `registerTrigger` raises a validation error and the ability never reaches the pipeline; the Beginning Step producer exists (src/turn/flow.ts) but no merged adapter maps the timing id to a registrable pattern. The authored shape is asserted above');

test.todo('keywords-vision-trigger-on-played / keywords-vision-multiple-instances-trigger-separately (817.1.c, 817.2.b): the trigger filter uses the key `object.id`, which src/programs/filters.ts rejects (“Unsupported filter field object.id”), so the ability cannot register through the production binder even though its body primitives (`effect.inspect` + `effect.recycle`) are merged; the authored body shape is asserted above');
