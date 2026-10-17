// docs/rules/scenarios/keywords.yaml — general keyword rules (CR v1.5 801.3.a.3, 803).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  c, eventsAt, fixture, keywordIds, resolvedItems, settle, timingsOnly,
} from './support.mjs';

const GRANT = 'test:keyword-general-grant';

/** “Give a unit [Assault 2].” as one continuous.grant-keyword instruction. */
const grantProgram = {
  canonicalCardId: GRANT,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: 'Give a unit [Assault 2].',
  abilities: [{
    kind: 'play',
    cost: { kind: 'printed' },
    body: [{
      id: 'grant',
      op: 'continuous.grant-keyword',
      args: { keywords: c([{ id: 'Assault', value: 2 }]), objects: c({ kind: 'target', id: 'grantee' }) },
      targets: [{ id: 'grantee', filter: { type: 'unit', controller: 'self', zone: 'board' }, min: 1, max: 1 }]
    }]
  }]
};

test('keywords-general-grant-no-duration-persists: a granted keyword with no printed duration stays on the object after the source has left', () => {
  const f = fixture({
    programs: [grantProgram],
    energy: { A: 4 },
    setup: w => w.hand('spell', { cardId: GRANT, types: ['spell'], energy: 2, power: null })
      .base('u1', { might: 3 })
  });

  f.play('spell');
  settle(f.engine);

  // The chain resolved the spell through the real interpreter and registered one
  // ability-layer effect for the chosen object (CR 801.3.a.3: no printed
  // duration means “while it remains in that zone”, modelled per-object).
  assert.deepEqual(resolvedItems(f.engine), ['play:spell:1:A:1']);
  assert.equal(f.get('spell').zone, 'trash');
  assert.deepEqual(keywordIds(f.snapshot('u1')), ['Assault:2']);
  // The granted keyword is still there with the source gone from the Board.
  assert.equal(f.engine.layers.registry.list().length, 1);
  assert.ok(timingsOnly(f.engine).includes('object-enters-trash'));
  assert.equal(eventsAt(f.engine, 'became-target').length, 1);
});

test.todo('keywords-general-execution-order (CR 803): a card with several keywords runs its functional text top-to-bottom — blocked: Temporary/other keyword triggers expand to timing points the frozen TriggerSpec/EventPattern validator rejects (`beginning-start`) and the Deathknell body op `trigger.leave` has no registered instruction, so the ordered keyword-then-trigger sequence cannot run yet');
