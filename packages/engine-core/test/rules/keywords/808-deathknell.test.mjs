// docs/rules/scenarios/keywords.yaml — Deathknell (CR v1.5 808.1.d.2, 808.2).
//
// The merged Deathknell expansion is a `object-killed` triggered ability whose body
// is the `trigger.leave` instruction. Both halves are inspectable through the merged
// program expander; firing it end-to-end is blocked (see the todos).
import assert from 'node:assert/strict';
import test from 'node:test';
import { expandProgram } from '../../../dist/programs/index.js';
import { instructionDefinitionsById } from '../../../dist/effects/instructions/registry.generated.js';
import deathknell from '../../../dist/effects/keywords/Deathknell.js';
import { world } from './support.mjs';

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
  assert.deepEqual(one[0].trigger.filter, { self: true, cause: 'kill', destination: 'trash' });
  assert.deepEqual(one[0].body.map(instruction => instruction.op), ['trigger.leave']);
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

test.todo('keywords-deathknell-triggers-on-kill (808.1.d.2 execution): the trigger cannot fire through the production lifecycle — src/programs/lifecycle.ts calls detachSource() for every emission whose timing point is `object-killed` before the pipeline drains its scan queue, so the `program:…` registration is unregistered in the same action that should trigger it; and its body op `trigger.leave` has no registered InstructionDef (the generated instruction registry has no such op), so the resolved effect could not run either');

test.todo('keywords-deathknell-removed-when-death-replaced (808.1.d.1): replacing a combat death with heal+Recall needs the merged Combat damage task (src/combat/flow.ts dealDamage() throws the batch-4 blocked marker) plus a replacement registration for the kill action, which the merged replacement layer supports (src/replacement/bind.ts) but no card data can reach until Combat runs');

assert.equal(instructionDefinitionsById.has('trigger.leave'), false, 'documents the missing op named in the todo above');
