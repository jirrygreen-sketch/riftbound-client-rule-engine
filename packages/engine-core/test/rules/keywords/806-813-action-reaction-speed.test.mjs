// docs/rules/scenarios/keywords.yaml — Action (CR 806.1.b, 806.3) and Reaction (813.1.c.1).
//
// The printed Action/Reaction keywords are merged: `programs/keywords.ts`
// `abilitySpeed()` maps them onto the ChainDraft speed, and src/layers/rules/query.ts
// `canAct()` owns the Neutral/Showdown × Open/Closed truth table. The tests below
// drive the real ChainEngine with production-bound drafts in each state;
// `describePlay` is the only way a Play enters the chain.
import assert from 'node:assert/strict';
import test from 'node:test';
import { damage, fixture, pendingItems, settle, timingsOnly } from './support.mjs';

const REACTION = 'test:reaction-spell';
const ACTION = 'test:action-spell';
const PLAIN = 'test:plain-spell';

const spell = (canonicalCardId, amount) => ({
  canonicalCardId,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: canonicalCardId,
  abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: [damage(`${canonicalCardId}:damage`, amount)] }]
});

/** A’s Reaction spell plus B holding a plain spell on the chain. */
const position = () => ({
  programs: [spell(REACTION, 1), spell(ACTION, 2), spell(PLAIN, 3)],
  energy: { A: 4, B: 4 },
  turnPlayer: 'B',
  setup: w => w
    .hand('reaction', { cardId: REACTION, types: ['spell'], energy: 1, power: null, keywords: [{ id: 'Reaction' }] })
    .hand('action', { cardId: ACTION, types: ['spell'], energy: 2, power: null, keywords: [{ id: 'Action' }] })
    .hand('plain', { cardId: PLAIN, types: ['spell'], energy: 2, power: null })
    .base('u1', { might: 6 })
});

const speedOf = (f, id) => f.binding.describePlay({ type: 'play', player: 'A', object: f.ref(id) }, f.get(id)).speed;

test('keywords-reaction-play-on-opponent-turn-closed-state: a Reaction spell is playable in the opponent’s Closed State (CR 813.1.c.1)', () => {
  const f = fixture(position());

  // 813.1.c: the printed Reaction keyword gives the card reaction speed.
  assert.equal(speedOf(f, 'reaction'), 'reaction');
  assert.equal(speedOf(f, 'action'), 'action');

  // B plays the plain spell; the chain is now in a Closed State with A holding Priority.
  f.play('plain', { player: 'B' });
  assert.equal(f.engine.turnState, 'neutral-closed');
  f.engine.pass('B');
  assert.equal(f.engine.priority, 'A');

  // 813.1.c.1 lets A play the Reaction spell, and last-in resolves first.
  f.play('reaction', { player: 'A' });
  const pending = pendingItems(f.engine);
  assert.equal(pending.length, 2, 'both spells are waiting on the chain');
  assert.match(pending[0], /^play:plain:/);
  assert.match(pending[1], /^play:reaction:/);
  settle(f.engine);

  assert.equal(f.get('u1').damage, 4, 'the Reaction spell resolved before the plain spell it answered');
  const order = f.engine.trace.filter(entry => entry.step === 'resolved').map(entry => entry.item);
  assert.equal(order.length, 2);
  assert.match(order[0], /^play:reaction:/, 'Resolve order is newest-finalized-first');
  assert.match(order[1], /^play:plain:/);
});

test('keywords-action-not-playable-in-closed-state: Action speed alone never unlocks a Closed State (CR 806.1.b, 813.1)', () => {
  const f = fixture(position());
  f.play('plain', { player: 'B' });
  f.engine.pass('B');
  assert.equal(f.engine.turnState, 'neutral-closed');

  // 806.1.b: Action grants the Showdown timing only; 813.1 reserves Closed State
  // plays for Reaction, so the engine refuses the command outright.
  assert.throws(() => f.play('action', { player: 'A' }), /not legally timed/);
  assert.equal(f.get('u1').damage, 0);
  assert.equal(f.kernel.player('A').energy, 4, 'the rejected Play paid nothing');
});

test('keywords-action-not-playable-in-closed-state: an Action spell is legal once its own turn opens the Main Phase', () => {
  const f = fixture({ ...position(), turnPlayer: 'A' });
  assert.equal(f.engine.canAct('A', 'action', f.ref('action')), true);

  f.play('action', { player: 'A' });
  settle(f.engine);
  assert.equal(f.get('u1').damage, 2);
  assert.ok(timingsOnly(f.engine).includes('damage-dealt'));
});

test('keywords-action-unit-still-restricted-to-base-or-own-battlefield (CR 806.3): Action grants an opponent-turn Showdown timing without expanding a Unit’s play destinations', () => {
  // CR v1.5 (target): https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
  // Synthetic production program: card.hash-8a2cf1027c6f770452bef4d4eacd322301ebafc77620d3a76b855446639089e8
  // is Ekko, Revolutionary's official full-name identity. The catalog records
  // its only [Action] on an activated ability; no source supports a universal
  // Action Unit Play body, so [] is the exact synthetic body under test.
  const ACTION_UNIT = 'test:action-unit';
  const OWN_FIELD = { type: 'battlefield', id: 'own-field' };
  const ENEMY_FIELD = { type: 'battlefield', id: 'enemy-field' };
  const OPEN_FIELD = { type: 'battlefield', id: 'open-field' };
  const program = {
    canonicalCardId: ACTION_UNIT,
    rulesetVersion: 'core-1.5',
    status: 'executable',
    sourceText: '[Action]',
    abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: [] }]
  };
  const opponentShowdown = () => {
    const f = fixture({
      programs: [program],
      energy: { A: 1 },
      turnPlayer: 'B',
      setup: w => w
        .hand('unit', { cardId: ACTION_UNIT, types: ['unit'], energy: 1, power: null, might: 2, keywords: [{ id: 'Action' }] })
        .battlefield('own-field-card', { controller: 'A', types: ['battlefield'], location: OWN_FIELD })
        .battlefield('enemy-field-card', { controller: 'B', types: ['battlefield'], location: ENEMY_FIELD })
        .battlefield('open-field-card', { controller: null, types: ['battlefield'], location: OPEN_FIELD })
    });
    f.engine.initializeBattlefieldControl([
      { id: OWN_FIELD.id, controller: 'A' },
      { id: ENEMY_FIELD.id, controller: 'B' },
      { id: OPEN_FIELD.id, controller: null }
    ]);
    f.engine.openShowdown('A');
    assert.equal(f.engine.turnState, 'showdown-open');
    assert.equal(f.engine.focus, 'A');
    assert.equal(f.engine.priority, 'A');
    assert.equal(f.engine.canAct('A', 'action', f.ref('unit'), f.get('unit')), true);
    assert.deepEqual(f.errors, []);
    return f;
  };

  // CR 806.3: the timing permission leaves 355.2.a’s destinations intact.
  for (const location of [{ type: 'base', player: 'A' }, OWN_FIELD]) {
    const f = opponentShowdown();
    const source = f.get('unit');
    assert.equal(f.binding.describePlay({ type: 'play', player: 'A', object: source.ref, location }, source).speed, 'action');
    const eventsBefore = f.engine.pipeline.events.length;
    const traceBefore = f.engine.trace.length;
    f.play('unit', { draft: { location } });
    assert.match(f.engine.trace.find(entry => entry.step === 'resolved')?.item, /^play:unit:/,
      'the production path finalized and resolved the Unit Play');
    settle(f.engine);
    assert.deepEqual(f.get('unit').location, location);
    assert.equal(f.engine.items.length, 0);
    assert.equal(f.engine.pipeline.events.slice(eventsBefore).filter(event => event.timingPoint === 'card-played').length, 1);
    assert.equal(f.engine.trace.slice(traceBefore).filter(entry => entry.step === 'finalized').length, 1);
    assert.equal(f.engine.trace.slice(traceBefore).filter(entry => entry.step === 'resolved').length, 1);
    f.lifecycle.detach();
  }

  // An enemy-controlled or uncontrolled Battlefield is not a valid default
  // destination. The rejected Play must roll back before paying or entering Chain.
  for (const location of [ENEMY_FIELD, OPEN_FIELD]) {
    const f = opponentShowdown();
    const before = f.kernel.snapshot();
    const events = f.engine.pipeline.events;
    const trace = f.engine.trace;
    assert.throws(() => f.play('unit', { draft: { location } }), /Play destination is not legally allowed/);
    assert.deepEqual(f.kernel.snapshot(), before);
    assert.deepEqual(f.engine.pipeline.events, events);
    assert.deepEqual(f.engine.trace, trace);
    assert.equal(f.engine.items.length, 0);
    assert.equal(f.kernel.player('A').energy, 1, 'the rejected Play paid nothing');
    f.lifecycle.detach();
  }
});
