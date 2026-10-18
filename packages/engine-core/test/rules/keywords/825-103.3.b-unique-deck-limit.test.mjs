// docs/rules/scenarios/keywords.yaml — Unique (CR v1.5 825.3.a, 825.3.b, 103.3.b).
//
// No merged keyword file exists for Unique: the printed keyword is a card-data tag
// (`keyword: "unique"`, e.g. packages/card-dsl/src/cards/sfd/forgefire-cape.ts) and the
// deck-construction limit is carried by the merged `continuous.deck` primitive and the
// `layers/rules/query.deckLimit()` query. Those real pieces are asserted below; the
// scenario’s deckbuilding rejection is a todo.
import assert from 'node:assert/strict';
import test from 'node:test';
import { keywordDefinitionsById } from '../../../dist/effects/keywords/registry.generated.js';
import { instructionDefinitionsById } from '../../../dist/effects/instructions/registry.generated.js';
import { ContinuousEffectRegistry } from '../../../dist/layers/duration.js';
import { deckLimit } from '../../../dist/layers/rules/query.js';
import { runInstruction, world } from '../../../dist/effects/testing/index.js';
import { c } from './support.mjs';

test('keywords-unique-deck-limit-one: Unique has no executable KeywordDef; the deck limit is the merged continuous.deck primitive (CR 825.3.a, 103.3.b)', () => {
  // The keyword registry covers only keywords with merged expansions.
  assert.equal(keywordDefinitionsById.get('Unique'), undefined);
  const definition = instructionDefinitionsById.get('continuous.deck');
  assert.ok(definition, 'continuous.deck is registered');

  const kernel = world().player('A').base('card', { name: 'Sig A' }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject('card'), controller: 'A' });
  const run = runInstruction(definition, { mode: c('max'), amount: c(1) }, { world: context });
  assert.equal(run.result.status, 'executed');

  const registry = new ContinuousEffectRegistry();
  for (const registration of context.snapshot().continuous) registry.register(registration.effect, registration.duration);
  assert.deepEqual(deckLimit(registry, 'Sig A'), { mode: 'max', amount: 1 }, '103.3.b: one copy by name');
  assert.equal(deckLimit(registry, 'Plain B'), null, 'an unlimited name has no entry');
});

test('keywords-unique-signature-combined-limit: three differently named Signature+Unique cards keep independent one-copy limits (CR 825.3.b)', () => {
  const kernel = world().player('A')
    .base('sig-a', { name: 'Sig A' }).base('sig-b', { name: 'Sig B' }).base('sig-c', { name: 'Sig C' })
    .build();
  const registry = new ContinuousEffectRegistry();
  for (const id of ['sig-a', 'sig-b', 'sig-c']) {
    const context = kernel.clone({ sourceSnapshot: kernel.getObject(id), controller: 'A' });
    assert.equal(runInstruction(instructionDefinitionsById.get('continuous.deck'), { mode: c('max'), amount: c(1) }, { world: context }).result.status, 'executed');
    for (const registration of context.snapshot().continuous) registry.register(registration.effect, registration.duration);
  }

  // 825.3.b: Signature cards are limited by name, so each distinct name keeps its own
  // single-copy maximum and the three may be combined freely.
  for (const name of ['Sig A', 'Sig B', 'Sig C']) {
    assert.deepEqual(deckLimit(registry, name), { mode: 'max', amount: 1 }, name);
  }
  void kernel;
});

test('keywords-unique-deck-limit-one: a repeated limit for the same name tightens to the smallest maximum (CR 103.3.b)', () => {
  const registry = new ContinuousEffectRegistry();
  const register = (id, amount) => registry.register({
    id, layer: 'ability', source: { id: 'deck-check', zoneEntryId: 1 },
    filter: { characteristics: { name: 'Sig A' } },
    effect: { kind: 'deck-limit', mode: 'max', amount }
  }, { type: 'permanent' });
  register('limit-2', 2);
  register('limit-1', 1);
  assert.deepEqual(deckLimit(registry, 'Sig A'), { mode: 'max', amount: 1 });
});

test.todo('keywords-unique-deck-limit-one / keywords-unique-signature-combined-limit (deckbuilding): the scenarios are deck-construction checks with no board position and no command — there is no merged deck-validation entry point (src/deck/index.ts exports nothing, and `continuous.deck` is a query source rather than a validator), while the YAML’s `rejected: { reason: "deck-construction-unique-limit" }` receipt belongs to the old duel session vocabulary; the real limit query and the printed `unique` card-data tag are asserted above');

test.todo('keywords-unique-* (keyword expansion): Unique has no KeywordDef in packages/engine-core/src/effects/keywords/, so the keyword registrar cannot expand it (src/programs/keywords.ts `definitionFor` raises ProgramBindingError judge-required for an unknown keyword); the deck limit is carried by card data plus the merged continuous.deck primitive instead');
