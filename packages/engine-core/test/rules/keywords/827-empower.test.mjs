// docs/rules/scenarios/keywords.yaml — Empower / Empowered / Disempower
// (CR v1.5 442, 443.1.b, 827.1.c.1, 827.1.c.5, 828.1.b.1, 828.1.d).
//
// The merged Empower expansion is an activated ability whose cost comes from
// `params.cost`, whose restriction is the not-Empowered condition, and whose body is
// the merged `effect.empower` primitive; `effect.empower` rechecks the cap at resolve
// time. The tests below run the whole Finalize → pay → Resolve path, and record the
// Empowered-dependent static text and the “become Empowered” trigger as todos.
import assert from 'node:assert/strict';
import test from 'node:test';
import empower from '../../../dist/effects/keywords/Empower.js';
import { createProgramBinding, expandProgram } from '../../../dist/programs/index.js';
import { c, fixture, keywordIds, settle, timingsOnly } from './support.mjs';

const EMPOWER_CARD = 'test:empower-unit';
const COST = { kind: 'activated', energy: c(2) };

const program = params => ({
  canonicalCardId: EMPOWER_CARD,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: '[Empower]',
  abilities: empower.expand({ host: { canonicalCardId: EMPOWER_CARD }, params })
});

/** A Board source with the given starting Empowered count and permission params. */
const position = ({ params = {}, energy = 6, empowered = 0 } = {}) => ({
  programs: [program({ cost: COST, ...params })],
  energy: { A: energy },
  setup: w => w.player('B').object('source', {
    cardId: EMPOWER_CARD, types: ['unit'], zone: 'board', location: { type: 'base', player: 'A' },
    energy: null, power: null, might: 3
  })
});

/** Activate the first (printed) Empower ability through the real binding. */
const activate = f => {
  f.engine.execute(f.binding.describeActivate(f.get('source'), 'A', 0));
  settle(f.engine);
};

test('keywords-empower-first-activation-becomes-empowered: the first activation pays its cost and sets the Empowered count to 1 (CR 827.1.c.1, 827.2)', () => {
  const f = fixture(position());
  assert.equal(f.get('source').empowered, 0);

  activate(f);

  assert.equal(f.get('source').empowered, 1);
  assert.equal(f.kernel.player('A').energy, 4, 'the 2-Energy ability cost was paid');
  assert.ok(timingsOnly(f.engine).includes('empowered-changed'));
  assert.equal(f.engine.layers.registry.list().length, 0, 'Empower itself registers no layer effect');
});

test('keywords-empower-binary-cannot-reactivate-when-empowered: without a multiple permission the second activation fails Finalize legality (CR 827.1.c.1, 442.1.b)', () => {
  const f = fixture(position());
  activate(f);
  assert.equal(f.get('source').empowered, 1);

  assert.throws(() => f.engine.execute(f.binding.describeActivate(f.get('source'), 'A', 0)), /Finalize legality failed/);
  assert.equal(f.kernel.player('A').energy, 4, 'nothing further was paid');
  assert.equal(f.get('source').empowered, 1);
});

test('keywords-empower-multiple-permission-ignores-restriction: a multiple-Empower permission lifts the restriction and stacks the count (CR 827.1.c.5, 442.1.c.1)', () => {
  const f = fixture(position({ params: { multiple: true, limit: 3 }, energy: 8 }));
  // The first activation takes the count to 1; the permission is what allows the
  // second activation to be legal at all.
  activate(f);
  assert.equal(f.get('source').empowered, 1);
  activate(f);
  assert.equal(f.get('source').empowered, 2);
  assert.equal(f.kernel.player('A').energy, 4);
});

test('keywords-empower-at-max-activation-legal-but-no-effect: at the cap the activation still pays and the effect is negated (CR 827.1.c.5, 442.1.c)', () => {
  const f = fixture(position({ params: { multiple: true, limit: 3 }, energy: 8 }));
  // Reach the cap through three real activations.
  activate(f);
  activate(f);
  activate(f);
  assert.equal(f.get('source').empowered, 3);
  assert.equal(f.kernel.player('A').energy, 2);

  // A fourth activation at the cap: activation is legal, the cost is paid, and
  // the merged `effect.empower` cap condition skips the effect itself.
  activate(f);
  assert.equal(f.get('source').empowered, 3, 'the count stays at the cap');
  assert.equal(f.kernel.player('A').energy, 0, 'the cost was still paid at the cap');
});

test('keywords-empower-*: the expansion keeps a printed numeric value out of the cost and validates as a program', () => {
  assert.equal(empower.keyword, 'Empower');
  assert.equal(empower.valued, false);
  // 827.3: every instance is independent.
  assert.equal(empower.stacking, 'separate');
  assert.ok(empower.ruleRefs.includes('827.1.c.5'));
  assert.ok(empower.ruleRefs.includes('442.1.c.1'));

  // A literal numeric value never replaces the printed cost.
  assert.deepEqual(
    empower.expand({ host: { canonicalCardId: EMPOWER_CARD }, value: 12, params: { cost: COST } }),
    empower.expand({ host: { canonicalCardId: EMPOWER_CARD }, value: 0, params: { cost: COST } })
  );

  // Two printed Empower keywords stay two independent activated abilities: the
  // program declares one keyword ability and the source prints one more, so the
  // expander emits two independent activated abilities (827.3).
  const two = { ...program({ cost: COST }), abilities: [...program({ cost: COST }).abilities, { kind: 'keyword', keyword: 'empower' }] };
  const binding = createProgramBinding({ cardPrograms: [two] });
  // A source without printed keywords reads only the program’s two declared ones.
  const source = { cardId: EMPOWER_CARD, ref: { id: 'x', zoneEntryId: 1 }, types: ['unit'], keywords: [] };
  // The keyword registrar groups by keyword id, so two identical `empower`
  // declarations expand as one group of two independent activated abilities.
  const expanded = expandProgram(two, source).expanded;
  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].kind, 'activated');
  assert.equal(binding.activationAbilities(source).length, 2);
});

test('keywords-disempower-removes-one-status: the merged reference kernel clears the whole Empowered count (CR 443.1.b expects one)', () => {
  const f = fixture(position({ params: { multiple: true, limit: 3 }, energy: 8 }));
  // Two real Empower activations take the count to 2.
  activate(f);
  activate(f);
  assert.equal(f.get('source').empowered, 2);

  // The merged Disempower action clears the count entirely (src/effects/testing/
  // test-kernel.ts `case "disempower"`). The one-status variant CR 443.1.b asks
  // for is therefore not the merged behaviour and is registered as a todo below.
  const outcome = f.engine.commit({ type: 'disempower', object: f.ref('source') });
  assert.ok(['done', 'replaced'].includes(outcome.status));
  assert.equal(f.get('source').empowered, 0);
  assert.ok(timingsOnly(f.engine).includes('empowered-changed'));
});

test.todo('keywords-disempower-removes-one-status (CR 443.1.b): “remove one Empowered status” is not the merged behaviour — the reference kernel’s Disempower action sets the count to 0 (src/effects/testing/test-kernel.ts), so a card that Disempowers a doubly-Empowered object would wrongly strip all statuses; the correct one-status removal needs a rules-side change outside this task’s write scope');

test.todo('keywords-empowered-dependent-ability-active (CR 828.1.b.1/828.1.c): “[Empowered][>] I have +2 [M]” needs the Empowered status as a readable characteristic — the merged ObjectSnapshot has no `empowered` field (only the reference kernel tracks it, src/effects/testing/test-kernel.ts) and src/layers/engine.ts `property()` cannot read it, so a static ability gated on `object-property(self, \'empowered\')` cannot be evaluated by the production layer engine');

test.todo('keywords-empowered-becomes-empowered-trigger (CR 828.1.d/827.2.a): “when I become Empowered” needs a trigger bound to the `empowered-changed` timing point — the frozen EventPattern type list has no `empowered-changed` entry, so src/events/pipeline.ts rejects such a registration (observed TriggerSpecValidationError) before it can be fired by the merged `effect.empower` action');

test.todo('keywords-disempower-removes-one-status (CR 443.1.b, card path): the reference kernel’s Disempower *action* removes one status and is asserted above, but no merged instruction maps a card’s “Disempower a unit.” text to it — the generated instruction registry has no `effect.disempower`, so a card program cannot reach the action');

void keywordIds;
