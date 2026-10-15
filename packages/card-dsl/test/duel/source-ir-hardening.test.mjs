// Default (clean-checkout) hardening regression suite for the source-bound
// official-program IR.
//
// These cases pin the source-independent-review fixes without re-deriving the
// whole compiler:
//   P1 check/use drift: a getter or Proxy `get` must never supply encoding data;
//      validation/encoding read one own-data-descriptor snapshot.
//   P2 Hold Recruit: the `base` destination is forced by the source text.
//   Unit event predicates: source-play-completed / controller-play-completed
//      must reject wrong controller, cardType, turn, countered or extra fields.
//   Closure: Draw 1 Hold and runtime Draw 4 need the draw-subject-journal
//      closure; the direct Main boundary is not automatically Draw.
//
// It builds its whole printing tuples from inline synthetic values (the same
// approach as draw-source-programs.test.mjs) and reads only the TRACKED fixture
// constants, so it runs in a clean checkout with no gitignored official data and
// no data-missing skip. The real 1381/64 catalog census lives in the explicit
// `*.audit.mjs` files; this file never reads generated catalog output.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DATA_VERSION, DIGEST } from '../fixtures/official-catalog.mjs';

const moduleSpecifier =
  process.env.DUEL_OFFICIAL_PROGRAMS_MODULE ?? '../../dist/duel/official-programs.js';
const {
  bindDuelOfficialProgram,
  createDuelOfficialProgramRegistry,
  decodeDuelOfficialProgramRaw,
  duelAbilitySourceFromCatalog,
  encodeDuelOfficialProgramRaw,
  queryDuelSourceProgramPhaseScope,
  validateDuelOfficialProgram,
} = await import(moduleSpecifier);

const synCard = (id, cardType, ability, extra = {}) => ({
  id,
  cardType,
  ability,
  energy: extra.energy ?? null,
  power: extra.power ?? null,
  might: extra.might ?? null,
  domains: extra.domains ?? ['Colorless'],
  tags: extra.tags ?? [],
  canonicalCardId: extra.canonicalCardId ?? `card.syn-${id}`,
  name: extra.name ?? `Syn ${id}`,
  fullName: extra.fullName ?? `Syn ${id}`,
  localizedName: extra.localizedName ?? '合成',
  setCode: extra.setCode ?? 'syn',
  cardNumber: extra.cardNumber ?? `SYN-${id}`,
  variant: extra.variant ?? 'standard',
});

// The eleven independently reviewed whole-ability templates, expressed as
// complete synthetic printing tuples.
const DRAW4 = 'syn-hard-spell-draw4';
const KILL_ONE = 'syn-hard-spell-kill-one';
const KILL_ALL = 'syn-hard-spell-kill-all';
const EACH_PLAYER = 'syn-hard-spell-each-player';
const DAMAGE_SIX = 'syn-hard-spell-damage-six';
const PLAY_ME_DRAW = 'syn-hard-unit-play-me-draw';
const PLAY_ME_KILL = 'syn-hard-unit-play-me-kill';
const PLAY_GEAR_READY = 'syn-hard-unit-play-gear-ready';
const OPP_TURN_RECRUIT = 'syn-hard-unit-opp-turn-recruit';
const TOKEN_MIGHT = 'syn-hard-unit-token-might';
const HOLD_DRAW = 'syn-hard-battlefield-hold-draw';
const HOLD_RECRUIT = 'syn-hard-battlefield-hold-recruit';

const WHOLE_TEMPLATE_IDS = [
  DRAW4, KILL_ONE, KILL_ALL, EACH_PLAYER, DAMAGE_SIX,
  PLAY_ME_DRAW, PLAY_ME_KILL, PLAY_GEAR_READY, OPP_TURN_RECRUIT, TOKEN_MIGHT, HOLD_DRAW,
];

const localCards = [
  synCard(DRAW4, 'Spell', 'Draw 4.', { energy: 6, power: 1, domains: ['Mind'], tags: ['Spell'] }),
  synCard(KILL_ONE, 'Spell', 'Kill a unit.', { energy: 4, power: 2, domains: ['Order'], tags: ['Spell'] }),
  synCard(KILL_ALL, 'Spell', 'Kill all units.', { energy: 9, power: 3, domains: ['Order'], tags: ['Spell'] }),
  synCard(EACH_PLAYER, 'Spell', 'Each player kills one of their units.', { energy: 2, power: 1, domains: ['Order'], tags: ['Spell'] }),
  synCard(DAMAGE_SIX, 'Spell', 'Deal 6 to each of up to two units.', { energy: 6, power: 2, domains: ['Mind'], tags: ['Spell'] }),
  synCard(PLAY_ME_DRAW, 'Unit', 'When you play me, draw 1.', { energy: 6, might: 5, domains: ['Mind'], tags: ['Dragon'] }),
  synCard(PLAY_ME_KILL, 'Unit', 'When you play me, kill an enemy unit.', { energy: 8, power: 2, might: 6, domains: ['Order'], tags: ['Dragon'] }),
  synCard(PLAY_GEAR_READY, 'Unit', 'When you play a gear, ready me.', { energy: 3, might: 3, domains: ['Mind'], tags: ['Bandle City'] }),
  synCard(OPP_TURN_RECRUIT, 'Unit',
    "When you play a card on an opponent's turn, play a 1 :rb_might: Recruit unit token in your base.",
    { energy: 4, power: 1, might: 3, domains: ['Mind'], tags: ['Champion', 'Viktor'] }),
  synCard(TOKEN_MIGHT, 'Unit', 'Your token units have +1 :rb_might:.', { energy: 5, might: 3, domains: ['Mind'], tags: ['Shadow Isles'] }),
  synCard(HOLD_DRAW, 'Battlefield', 'When you hold here, draw 1.', { domains: ['Order'], tags: ['Altar'] }),
  synCard(HOLD_RECRUIT, 'Battlefield',
    'When you hold here, play a 1 :rb_might: Recruit unit token in your base.',
    { domains: ['Order'], tags: ['Altar'] }),
  // Deliberately-unsupported near misses; the whole-ability compiler must not
  // resolve them.
  synCard('syn-hard-spell-draw4-multiclause', 'Spell', 'Draw 4. Draw 1.', { energy: 6, power: 1, domains: ['Mind'], tags: ['Spell'] }),
  synCard('syn-hard-unit-play-me-draw-multiclause', 'Unit', 'When you play me, draw 1. Draw 1.', { energy: 6, might: 5, domains: ['Mind'], tags: ['Dragon'] }),
  synCard('syn-hard-unit-hold-draw', 'Unit', 'When you hold here, draw 1.', { energy: 2, might: 2, domains: ['Order'], tags: ['Warrior'] }),
];

const CATALOG = {
  schemaVersion: 1,
  dataVersion: DATA_VERSION,
  digest: DIGEST,
  cards: localCards,
  groups: [],
};

const source = duelAbilitySourceFromCatalog(CATALOG);
const registry = createDuelOfficialProgramRegistry(source);
const card = (id) => {
  const found = localCards.find((entry) => entry.id === id);
  assert.ok(found, `local printing ${id}`);
  return found;
};
const bind = (id) => bindDuelOfficialProgram(source, card(id));
const program = (id) => registry.getProgram(id);
const clone = (value) => structuredClone(value);
const reject = (value, label) => {
  assert.equal(validateDuelOfficialProgram(value).ok, false, label);
  assert.throws(() => encodeDuelOfficialProgramRaw(value), Error, `${label} (encode)`);
};

// ---------------------------------------------------------------------------
// P1: descriptor-only snapshot, no check/use drift.
// ---------------------------------------------------------------------------

test('P1: a getter-valued effect amount is rejected and never read by validate or encode', () => {
  const base = program(DRAW4);
  assert.deepEqual(base.semantics.effects[0], { kind: 'draw-cards', amount: 4, recipient: 'effect-controller' });

  let reads = 0;
  const forged = clone(base);
  Object.defineProperty(forged.semantics.effects[0], 'amount', {
    enumerable: true,
    configurable: true,
    get() { reads += 1; return reads <= 3 ? 4 : 5; },
  });
  assert.equal(validateDuelOfficialProgram(forged).ok, false);
  assert.throws(() => encodeDuelOfficialProgramRaw(forged), Error);
  // The getter is never invoked for validation or encoding, so a Draw 4 bound
  // program can never be re-encoded as a forged Draw 5.
  assert.equal(reads, 0);

  const frozen = validateDuelOfficialProgram(clone(base));
  assert.equal(frozen.ok, true);
  assert.equal(Object.isFrozen(frozen.value), true);
  assert.equal(Object.isFrozen(frozen.value.semantics.effects[0]), true);
});

test('P1: non-enumerable and symbol program fields are rejected', () => {
  const nonEnumerable = clone(program(DRAW4));
  Object.defineProperty(nonEnumerable.semantics, 'hidden', { value: 'undetected', enumerable: false });
  assert.equal(validateDuelOfficialProgram(nonEnumerable).ok, false);

  const symbolic = clone(program(DRAW4));
  symbolic.semantics[Symbol('hidden')] = 'undetected';
  assert.equal(validateDuelOfficialProgram(symbolic).ok, false);

  const symbolicSource = clone(program(PLAY_ME_DRAW));
  symbolicSource.source[Symbol('hidden')] = true;
  assert.equal(validateDuelOfficialProgram(symbolicSource).ok, false);
});

test('P1: a Proxy get trap cannot inject encoding data; snapshot returns an own-data frozen value', () => {
  const base = program(DRAW4);
  let getCalls = 0;
  const trap = new Proxy(clone(base), {
    get(target, key, receiver) {
      getCalls += 1;
      if (key === 'semantics') return { kind: 'spell-resolution', effects: [{ kind: 'draw-cards', amount: 9, recipient: 'effect-controller' }] };
      return Reflect.get(target, key, receiver);
    },
    set() { throw new Error('snapshot must not write through the Proxy'); },
  });
  const checked = validateDuelOfficialProgram(trap);
  assert.equal(checked.ok, true);
  // The dynamic getter value is ignored: reads use own data descriptors only.
  assert.equal(getCalls, 0);
  assert.deepEqual(Object.keys(checked.value.semantics), ['kind', 'effects']);
  assert.equal(checked.value.semantics.effects[0].amount, 4);
  assert.equal(Object.isFrozen(checked.value), true);
  assert.equal(encodeDuelOfficialProgramRaw(trap).includes('"amount":9'), false);
});

test('P1: mutating caller input after binding/registry construction cannot change registered programs', () => {
  // Use a private tuple so the shared fixture is never touched.
  const mutCard = clone(card(DRAW4));
  const scopedSource = duelAbilitySourceFromCatalog({ ...CATALOG, cards: [mutCard] });
  const scopedRegistry = createDuelOfficialProgramRegistry(scopedSource);
  const bound = bindDuelOfficialProgram(scopedSource, mutCard);
  assert.deepEqual(scopedRegistry.getProgram(DRAW4).source.domains, ['Mind']);

  mutCard.tags.push('Mutated');
  mutCard.domains.push('Fury');
  assert.deepEqual(bound.program.source.tags, ['Spell']);
  assert.deepEqual(bound.program.source.domains, ['Mind']);
  assert.deepEqual(scopedRegistry.getProgram(DRAW4).source.domains, ['Mind']);
  assert.equal(Object.isFrozen(scopedRegistry.getProgram(DRAW4)), true);

  // A source-envelope mutation likewise cannot retroactively alter the
  // registry's detached snapshot.
  scopedSource.cards[0].tags.push('Mutated');
  assert.deepEqual(scopedRegistry.getProgram(DRAW4).source.tags, ['Spell']);
});

// ---------------------------------------------------------------------------
// P2: Hold Recruit destination is forced by the source instruction.
// ---------------------------------------------------------------------------

test('P2: the Hold Recruit destination must stay base and round-trip', () => {
  const binding = bind(HOLD_RECRUIT);
  assert.equal(binding.status, 'resolved');
  assert.equal(binding.program.semantics.effects[0].destination, 'base');
  assert.deepEqual(decodeDuelOfficialProgramRaw(encodeDuelOfficialProgramRaw(binding.program)), binding.program);

  const forged = clone(binding.program);
  forged.semantics.effects[0].destination = 'executor-defined';
  reject(forged, 'Hold Recruit destination drift');

  const missingDestination = clone(binding.program);
  delete missingDestination.semantics.effects[0].destination;
  reject(missingDestination, 'Hold Recruit missing destination');
});

// ---------------------------------------------------------------------------
// Unit event predicates.
// ---------------------------------------------------------------------------

test('unit event predicates take the exact source/controller completion tuple', () => {
  const drake = program(PLAY_ME_DRAW);
  assert.deepEqual(drake.semantics.eventPredicate, {
    kind: 'source-play-completed', source: 'ability-source', countered: false,
  });
  const gear = program(PLAY_GEAR_READY);
  assert.deepEqual(gear.semantics.eventPredicate, {
    kind: 'controller-play-completed', actor: 'source-controller-at-event',
    cardType: 'Gear', turn: 'any', countered: false,
  });
  const viktor = program(OPP_TURN_RECRUIT);
  assert.deepEqual(viktor.semantics.eventPredicate, {
    kind: 'controller-play-completed', actor: 'source-controller-at-event',
    cardType: 'any', turn: 'opponent', countered: false,
  });
});

test('a forged eventPredicate is rejected for wrong controller, cardType, turn, countered, missing or extra fields', () => {
  const drake = program(PLAY_ME_DRAW);
  for (const mutate of [
    (p) => { p.semantics.eventPredicate.kind = 'controller-play-completed'; },
    (p) => { p.semantics.eventPredicate.source = 'source-controller-at-event'; },
    (p) => { p.semantics.eventPredicate.countered = true; },
    (p) => { delete p.semantics.eventPredicate.countered; },
    (p) => { p.semantics.eventPredicate.turn = 'opponent'; },
  ]) {
    const forged = clone(drake);
    mutate(forged);
    reject(forged, 'unit-enter predicate drift');
  }

  const gear = program(PLAY_GEAR_READY);
  for (const mutate of [
    (p) => { p.semantics.eventPredicate.actor = 'ability-source'; },
    (p) => { p.semantics.eventPredicate.cardType = 'any'; },
    (p) => { p.semantics.eventPredicate.turn = 'opponent'; },
    (p) => { p.semantics.eventPredicate.countered = true; },
    (p) => { delete p.semantics.eventPredicate.actor; },
    (p) => { p.semantics.eventPredicate.extra = true; },
  ]) {
    const forged = clone(gear);
    mutate(forged);
    reject(forged, 'play-gear predicate drift');
  }

  const viktor = program(OPP_TURN_RECRUIT);
  for (const mutate of [
    (p) => { p.semantics.eventPredicate.cardType = 'Gear'; },
    (p) => { p.semantics.eventPredicate.turn = 'any'; },
    (p) => { p.semantics.eventPredicate.countered = true; },
  ]) {
    const forged = clone(viktor);
    mutate(forged);
    reject(forged, 'opponent-turn predicate drift');
  }
});

// ---------------------------------------------------------------------------
// Draw closure.
// ---------------------------------------------------------------------------

test('Draw 1 Hold and runtime Draw 4 require draw-subject-journal; direct Main stays known-no-handler', () => {
  const holdDraw = registry.sourceProgramPhaseScope(HOLD_DRAW, 'hold');
  assert.equal(holdDraw.sourceApplicabilityStatus, 'handlers-or-modifiers');
  assert.deepEqual(holdDraw.handlers, ['trigger.hold']);
  assert.equal(holdDraw.requiredGlobalRuntimeClosure.includes('draw-subject-journal'), true);
  assert.equal(holdDraw.globalClosureStatus, 'unverified');

  // Main is not the Draw phase: the atomic boundary has no handler and no draw
  // closure obligation, but a potential runtime spell-resolution Draw does.
  const direct = registry.sourceProgramPhaseScope(DRAW4, 'main');
  assert.equal(direct.directBoundaryStatus, 'known-no-handler');
  assert.equal(direct.sourceApplicabilityStatus, 'known-no-handler');
  assert.equal(direct.requiredGlobalRuntimeClosure.includes('draw-subject-journal'), false);

  const nested = registry.sourceProgramPhaseScope(DRAW4, { phase: 'main', mode: 'runtime-subevents' });
  assert.equal(nested.directBoundaryStatus, 'known-no-handler');
  assert.equal(nested.sourceApplicabilityStatus, 'handlers-or-modifiers');
  assert.equal(nested.requiredGlobalRuntimeClosure.includes('draw-subject-journal'), true);
  assert.deepEqual(nested.runtimeSubevents.map((event) => event.event), ['spell-resolution']);

  // The draw phase always names the closure for every printing.
  assert.equal(registry.sourceProgramPhaseScope(DRAW4, 'draw').requiredGlobalRuntimeClosure.includes('draw-subject-journal'), true);
});

// ---------------------------------------------------------------------------
// Whole templates and scope non-widening.
// ---------------------------------------------------------------------------

test('all eleven reviewed whole templates bind and round-trip canonically', () => {
  for (const id of WHOLE_TEMPLATE_IDS) {
    const binding = bind(id);
    assert.equal(binding.status, 'resolved', id);
    assert.deepEqual(validateDuelOfficialProgram(binding.program), { ok: true, value: binding.program, issues: [] }, id);
    assert.deepEqual(decodeDuelOfficialProgramRaw(encodeDuelOfficialProgramRaw(binding.program)), binding.program, id);
  }
  // Extra whole clauses are never silently absorbed into a resolved program.
  for (const id of ['syn-hard-spell-draw4-multiclause', 'syn-hard-unit-play-me-draw-multiclause']) {
    const binding = bind(id);
    assert.equal(binding.status, 'unknown', id);
    assert.equal(binding.program, null, id);
    assert.equal(binding.unresolvedReason, 'unsupported-whole-ability', id);
  }
  assert.equal(bind('syn-hard-unit-hold-draw').status, 'unknown');
});

test('Kill, Damage and continuous semantics do not widen selection, each-6, each-player or own-token scope', () => {
  const damage = program(DAMAGE_SIX);
  assert.deepEqual(damage.semantics.effects[0].targets, {
    kind: 'unit', controller: 'any', minSelections: 0, maxSelections: 2,
  });
  for (const mutate of [
    (p) => { p.semantics.effects[0].targets.maxSelections = 3; },
    (p) => { p.semantics.effects[0].targets.minSelections = 1; },
    (p) => { p.semantics.effects[0].amount = 7; },
    (p) => { p.semantics.effects[0].distribution = 'split'; },
  ]) {
    const forged = clone(damage);
    mutate(forged);
    reject(forged, 'damage widening');
  }

  const killAll = program(KILL_ALL);
  assert.equal(killAll.semantics.effects[0].selection, 'all');
  for (const mutate of [
    (p) => { p.semantics.effects[0].selection = 'target'; },
    (p) => { p.semantics.effects[0].controller = 'enemy'; },
  ]) {
    const forged = clone(killAll);
    mutate(forged);
    reject(forged, 'kill-all selection widening');
  }

  const each = program(EACH_PLAYER);
  assert.deepEqual(each.semantics.effects[0], { kind: 'each-player-kills-unit', selection: 'each-player-choice' });
  for (const mutate of [
    (p) => { p.semantics.effects[0].selection = 'target'; },
    (p) => { p.semantics.effects[0].controller = 'any'; },
  ]) {
    const forged = clone(each);
    mutate(forged);
    reject(forged, 'each-player targeting widening');
  }

  const continuous = program(TOKEN_MIGHT);
  assert.deepEqual(continuous.semantics.modifier, {
    kind: 'token-unit-might', amount: 1, controller: 'ability-controller', scope: 'board',
  });
  for (const mutate of [
    (p) => { p.semantics.modifier.amount = 2; },
    (p) => { p.semantics.modifier.scope = 'all-units'; },
    (p) => { p.semantics.sourceScope = 'all-token-units'; },
  ]) {
    const forged = clone(continuous);
    mutate(forged);
    reject(forged, 'continuous scope widening');
  }
});

// ---------------------------------------------------------------------------
// Bare authority.
// ---------------------------------------------------------------------------

test('bare programs and copied registries are never whole-phase authority; closure stays unverified', () => {
  const bare = bind(DRAW4).program;
  const context = { phase: 'main', mode: 'runtime-subevents' };
  for (const input of [bare, bind(DRAW4), { ...registry }]) {
    const result = queryDuelSourceProgramPhaseScope(input, DRAW4, context);
    assert.equal(result.scope, 'unknown');
    assert.equal(result.reason, 'unresolved-program');
    assert.equal(result.globalClosureStatus, 'unverified');
    assert.equal(result.sourceProgramComplete, false);
  }
  const authoritative = registry.sourceProgramPhaseScope(DRAW4, context);
  assert.equal(authoritative.sourceProgramComplete, true);
  assert.equal(authoritative.globalClosureStatus, 'unverified');

  const unknown = registry.sourceProgramPhaseScope('not-in-catalog-999', 'main');
  assert.equal(unknown.reason, 'unresolved-program');
  assert.equal(unknown.globalClosureStatus, 'unverified');
});

