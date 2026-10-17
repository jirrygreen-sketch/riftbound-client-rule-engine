import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCardProgram } from '@riftbound/card-dsl';
import { c, linked, source, resultPick, inspect, program } from './helpers.mjs';

const check = spec => validateCardProgram(program([inspect({ picks: [spec] })]));

test('IR adds ordered zone slices without reinterpreting legacy static options or changing null literals', () => {
  for (const spec of [source(), { id: 'legacy', options: ['dynamic:units'], selection: 'one', min: 1, max: 1 }]) {
    const result = check(spec);
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.deepEqual(result.value.abilities[0].body[0].picks[0], spec);
  }
  const result = validateCardProgram(program([{ id: 'read', op: 'condition.value', args: { value: c(null) } }]));
  assert.equal(result.ok, true);
  assert.equal(result.value.abilities[0].body[0].args.value.value, null);
});

test('IR accepts linked actual-result lists and dynamic Finalize counts', () => {
  const body = [inspect(), { id: 'order', op: 'effect.order', args: { destination: c('bottom'), cardsPick: c('seen') }, picks: [resultPick('seen', 'look', 'inspected-picked')] }];
  assert.equal(validateCardProgram(program(body)).ok, true);
  assert.equal(check(source('top', 5, { zoneSlice: { zone: 'deck', from: 'top', count: { kind: 'arithmetic', operator: 'add', operands: [c(2), c(3)] } } })).ok, true);
  assert.equal(check(source('top', 5, { zoneSlice: { zone: 'rune-deck', from: 'bottom' } })).ok, true);
});

for (const [name, spec, code] of [
  ['negative count', source('top', -1), 'invalid-zone-slice-count'],
  ['fractional count', source('top', 1.5), 'invalid-zone-slice-count'],
  ['null count', source('top', null), 'invalid-zone-slice-count'],
  ['null source', { ...source(), zoneSlice: null }, 'invalid-zone-slice'],
  ['unknown zone', source('top', 5, { zoneSlice: { zone: 'library', from: 'top' } }), 'invalid-zone-slice-zone'],
  ['unknown edge', source('top', 5, { zoneSlice: { zone: 'deck', from: 'middle' } }), 'invalid-zone-slice-edge'],
  ['untyped order', { ...source(), ordered: 'yes' }, 'invalid-pick-order'],
  ['unordered source', { ...source(), ordered: false }, 'invalid-ordered-pick-source'],
  ['ambiguous static options', { ...source(), options: ['top-five'] }, 'invalid-ordered-pick-source'],
  ['premature player choice', { ...source(), selection: 'one' }, 'invalid-ordered-pick-source'],
  ['filtering the source slice', { ...source(), filter: { type: 'unit' } }, 'invalid-ordered-pick-source'],
  ['minimum on source', { ...source(), min: 5 }, 'invalid-ordered-pick-source'],
  ['unknown source field', source('top', 5, { zoneSlice: { zone: 'deck', from: 'top', offset: 1 } }), 'invalid-zone-slice-field'],
  ['linked Finalize count', source('top', 5, { zoneSlice: { zone: 'deck', from: 'top', count: linked('read', 'value') } }), 'unavailable-finalize-value'],
  ['runtime identity', source('top', 5, { zoneSlice: { zone: 'deck', from: 'top', player: c({ id: 'card', zoneEntryId: 0 }) } }), 'invalid-object-selector'],
  ['two sources', { ...source(), linked: linked('read', 'value') }, 'ambiguous-pick-source'],
  ['exclusion without linked source', { ...source(), exclude: linked('read', 'value') }, 'invalid-pick-exclusion'],
  ['missing result key', { ...resultPick('seen', 'look', 'inspected-picked'), linked: { kind: 'linked', instructionId: 'read' } }, 'invalid-pick-link']
]) test(`IR rejects ${name} with a path-aware issue`, () => {
  const result = check(spec);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.code === code && issue.path.includes('.picks[0]')), JSON.stringify(result.issues));
});

test('IR linked sources must refer to a preceding instruction in the same ability', () => {
  const result = check(resultPick('later', 'future', 'revealed'));
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.code === 'linked-instruction-not-prior' && issue.path.endsWith('.linked.instructionId')));
});

test('IR ordered remainders name both prior object-list results explicitly', () => {
  const body = [inspect(), { id: 'recycle', op: 'effect.recycle', args: { objects: linked('look', 'inspected-pick') } }, {
    id: 'order', op: 'effect.order', args: { cardsPick: c('rest'), destination: c('top') },
    picks: [{ ...resultPick('rest', 'look', 'inspected-picked'), exclude: linked('recycle', 'recycled') }]
  }];
  assert.equal(validateCardProgram(program(body)).ok, true);
});
