// docs/rules/scenarios/keywords.yaml — Deathknell (CR v1.5 808.1.d.2, 808.2).
//
// The merged Deathknell expansion is a `object-killed` triggered ability whose body
// starts with the executable `trigger.leave` boundary. The production binding and
// lifecycle now collect and resolve the Pending item before the source reaches Trash.
import assert from 'node:assert/strict';
import test from 'node:test';
import { expandProgram } from '../../../dist/programs/index.js';
import { instructionDefinitionsById } from '../../../dist/effects/instructions/registry.generated.js';
import deathknell from '../../../dist/effects/keywords/Deathknell.js';
import { fixture, settle, world } from './support.mjs';

const CARD = 'test:deathknell-unit';

const program = {
  canonicalCardId: CARD,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: '[Deathknell][>] Draw 1.',
  abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: [] }]
};

test('keywords-deathknell-triggers-on-kill: the keyword expands to one object-killed trigger per instance (CR 808.1.d.2)', () => {
  assert.equal(deathknell.keyword, 'Deathknell');
  assert.equal(deathknell.valued, false);
  // 808.2: each printed instance is its own triggered ability, never merged.
  assert.equal(deathknell.stacking, 'separate');
  assert.ok(deathknell.ruleRefs.includes('808.1.d.2'));
  assert.ok(deathknell.ruleRefs.includes('808.2'));

  const one = deathknell.expand({ host: { canonicalCardId: CARD } });
  assert.equal(one.length, 1);
  assert.equal(one[0].kind, 'triggered');
  assert.equal(one[0].optional, false);
  assert.equal(one[0].trigger.at, 'object-killed');
  assert.deepEqual(one[0].trigger.filter, { self: true });
  assert.deepEqual(one[0].body.map(instruction => instruction.op), ['trigger.leave']);
  assert.ok(instructionDefinitionsById.has('trigger.leave'));
});

test('keywords-deathknell-multiple-instances-trigger-separately: two printed Deathknell texts stay two independent abilities (CR 808.2)', () => {
  const kernel = world().unit('u1', { cardId: CARD, keywords: [{ id: 'Deathknell' }, { id: 'Deathknell' }] }).build();
  const abilities = expandProgram(program, kernel.getObject('u1')).abilities.filter(ability => ability.kind === 'triggered');
  assert.equal(abilities.length, 2, 'the expander keeps both instances');
  // Each instance is a separate ability with its own body. Trigger registration
  // ids are derived per ability index (`program:…:N`), so the two instances stay
  // independent even though the keyword expansion reuses one body id per host.
  assert.ok(abilities.every(ability => ability.body.length === 1 && ability.body[0].op === 'trigger.leave'));
});

test('keywords-deathknell-triggers-on-kill: production lifecycle resolves the leave boundary and body', () => {
  const body = [{ id: 'deathknell.draw', op: 'effect.draw', args: { amount: { kind: 'constant', value: 1 } } }];
  const f = fixture({ programs: [program], setup: w => w.unit('u1', {
    cardId: CARD,
    location: { type: 'battlefield', id: 'bf1' },
    keywords: [{ id: 'Deathknell', params: { body } }]
  }) });
  const ids = f.binding.registerProgramTriggers(f.engine, f.get('u1'));
  assert.equal(ids.length, 1);

  assert.equal(f.engine.commit({ type: 'kill', object: f.ref('u1') }).status, 'done');
  assert.equal(f.engine.items.length, 1);
  assert.deepEqual(f.engine.items[0].body.map(instruction => instruction.op), ['trigger.leave', 'effect.draw']);

  f.engine.advance();
  settle(f.engine);
  assert.equal(f.get('u1').zone, 'trash');
  assert.equal(f.kernel.player('A').handCount, 1);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === 'object-killed').length, 1);
});

test('keywords-deathknell-removed-when-death-replaced (808.1.d.1): a replaced kill leaves no Deathknell item', () => {
  const f = fixture({ programs: [program], setup: w => w.unit('u1', {
    cardId: CARD,
    location: { type: 'battlefield', id: 'bf1' },
    keywords: [{ id: 'Deathknell' }]
  }) });
  f.binding.registerProgramTriggers(f.engine, f.get('u1'));
  f.engine.pipeline.registerReplacement({
    id: 'replace-kill',
    source: f.get('u1'),
    matches: action => action.type === 'kill' && action.object.id === 'u1',
    apply: action => ({ status: 'replace', actions: [{ type: 'move-location', object: action.object, to: { type: 'base', player: 'A' } }] })
  });

  assert.equal(f.engine.commit({ type: 'kill', object: f.ref('u1') }).status, 'replaced');
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-killed'), false);
  assert.equal(f.get('u1').zone, 'board');
  assert.deepEqual(f.get('u1').location, { type: 'base', player: 'A' });
});
