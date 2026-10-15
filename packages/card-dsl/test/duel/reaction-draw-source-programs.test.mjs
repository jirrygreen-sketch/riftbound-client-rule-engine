import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DUEL_PREMONITION_REACTION_TEXT, createDuelOfficialProgramRegistry,
  duelAbilitySourceFromCatalog, encodeDuelOfficialProgramRaw, decodeDuelOfficialProgramRaw,
  validateDuelOfficialProgram, queryDuelSourceProgramPhaseScope,
} from '../../dist/duel/official-programs.js';

const printing = (id, ability = DUEL_PREMONITION_REACTION_TEXT, cardType = 'Spell') => ({
  id, cardType, ability, energy: 2, power: 3, might: null, domains: ['Mind'], tags: [],
  canonicalCardId: `fixture-${id}`, name: 'Premonition', fullName: 'Premonition', localizedName: '预兆',
  setCode: 'fixture', cardNumber: '087', variant: 'standard',
});
const registry = (cards) => createDuelOfficialProgramRegistry(duelAbilitySourceFromCatalog({
  dataVersion: 'reaction-fixture', digest: 'reaction-fixture-digest', cards,
}));

test('the whole Premonition source binds Reaction permission plus exactly Draw 3, with a strict codec', () => {
  const programs = registry([printing('premonition')]);
  const program = programs.getProgram('premonition');
  assert.deepEqual(program.semantics, { kind: 'spell-resolution', permission: 'reaction',
    effects: [{ kind: 'draw-cards', amount: 3, recipient: 'effect-controller' }] });
  assert.deepEqual(decodeDuelOfficialProgramRaw(encodeDuelOfficialProgramRaw(program)), program);
  const scope = queryDuelSourceProgramPhaseScope(programs, 'premonition', 'main', programs.reference('premonition'));
  assert.equal(scope.sourceProgramComplete, true);
  assert.equal(scope.runtimeSubevents.some(event => event.event === 'spell-resolution' &&
    event.handlers.includes('spell-resolution.draw-cards')), true);
  assert.equal(Object.isFrozen(program.semantics), true);
});

test('Hidden, cost modifiers, extra instructions and unsupported Reaction amounts remain whole-source unknown', () => {
  const sources = [
    '[Hidden]\n' + DUEL_PREMONITION_REACTION_TEXT,
    DUEL_PREMONITION_REACTION_TEXT + '\nDiscard 1.',
    DUEL_PREMONITION_REACTION_TEXT.replace('Draw 3.', 'Draw 2.'),
    DUEL_PREMONITION_REACTION_TEXT.replace('Draw 3.', 'If an enemy unit died, draw 3.'),
    DUEL_PREMONITION_REACTION_TEXT.replace('[Reaction]', '[Action]'),
    'Draw 3.',
  ];
  const programs = registry(sources.map((text, index) => printing(`unknown-${index}`, text)));
  for (const id of programs.cardIds()) {
    assert.equal(programs.get(id).status, 'unknown');
    assert.equal(programs.reference(id), undefined);
  }
  assert.equal(registry([printing('unit', DUEL_PREMONITION_REACTION_TEXT, 'Unit')]).get('unit').status, 'unknown');
});

test('a program cannot add Reaction to ordinary Draw 4 or remove it from the Premonition source', () => {
  const programs = registry([printing('premonition'), printing('progress', 'Draw 4.')]);
  const premonition = structuredClone(programs.getProgram('premonition'));
  delete premonition.semantics.permission;
  assert.equal(validateDuelOfficialProgram(premonition).ok, false);
  const progress = structuredClone(programs.getProgram('progress'));
  progress.semantics.permission = 'reaction';
  assert.equal(validateDuelOfficialProgram(progress).ok, false);
  for (const permission of ['action', 'any', undefined]) {
    const forged = structuredClone(programs.getProgram('premonition'));
    forged.semantics.permission = permission;
    assert.equal(validateDuelOfficialProgram(forged).ok, false);
  }
});
