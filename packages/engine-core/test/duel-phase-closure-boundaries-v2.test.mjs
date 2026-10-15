import test from 'node:test';
import assert from 'node:assert/strict';
// Ordinary package test: built dist. For isolated no-emit development, point
// this one test at the TypeScript source via DUEL_PHASE_CLOSURE_MAPPER_MODULE.
const mapperModule = process.env.DUEL_PHASE_CLOSURE_MAPPER_MODULE ??
  new URL('../dist/duel/phase-closure-boundaries-v2.js', import.meta.url).href;
const {
  DUEL_PHASE_CLOSURE_EVENTS_V2,
  DUEL_PHASE_CLOSURE_NON_PHASE_EVENTS_V2,
  DUEL_PHASE_CLOSURE_STEPS_V2,
  duelPhaseClosureBoundariesForStepV2: map,
  getDuelPhaseClosureBoundariesV2,
  mapDuelPhaseClosureBoundariesV2,
} = await import(mapperModule);

const PRE = Object.freeze({ at: 'pre' });
const post = (...committedTransitions) => ({ at: 'post', committedTransitions });
const zone = (kind, id = 'P1') => kind === 'board-base' || kind === 'board-battlefield'
  ? { kind, locationId: id } : { kind, zonePlayerId: id };
const transition = (uid, from, to) => ({ uid, from: zone(from), to: zone(to) });
const channel = transition('rune-1', 'rune-deck', 'board-base');
const draw = transition('card-1', 'main-deck', 'hand');
const recycle = transition('card-2', 'trash', 'main-deck');
const lethal = transition('unit-1', 'board-battlefield', 'trash');
const lethalAtBase = transition('unit-2', 'board-base', 'trash');
const phaseEvents = [
  'awaken', 'begin', 'hold', 'channel', 'draw', 'main', 'ending',
  'expiration', 'fepr', 'required-cleanup', 'lethal-kill', 'burnout',
];
const nonPhaseEvents = [
  'pre-exit', 'zone-transition', 'draw-subject', 'continuous', 'chain',
  'effect-queue', 'fepr-outstanding',
];
const events = boundaries => boundaries.map(boundary => boundary.event);
function assertBoundary(boundary, ordinal, event, phase, step) {
  assert.deepEqual(
    { ordinal: boundary.ordinal, event: boundary.event, phase: boundary.phase },
    { ordinal, event, phase },
  );
  assert.equal(boundary.taskSuffix, `phase-closure:${step}:${ordinal}:${event}`);
}

test('exports 24 distinct cursor steps, 12 phase events and seven non-phase events', () => {
  assert.equal(DUEL_PHASE_CLOSURE_STEPS_V2.length, 24);
  assert.equal(new Set(DUEL_PHASE_CLOSURE_STEPS_V2).size, 24);
  assert.deepEqual([...DUEL_PHASE_CLOSURE_EVENTS_V2], [...phaseEvents, ...nonPhaseEvents]);
  assert.deepEqual([...DUEL_PHASE_CLOSURE_NON_PHASE_EVENTS_V2], nonPhaseEvents);
  assert.equal(new Set(DUEL_PHASE_CLOSURE_EVENTS_V2).size, 19);
  assert.equal(getDuelPhaseClosureBoundariesV2, map);
  assert.equal(mapDuelPhaseClosureBoundariesV2, map);
});

test('maps all ordinary pre checks, including lethal, FEPR, and pre-draw continuous', () => {
  const preEvents = {
    awaken: 'awaken', begin: 'begin', hold: 'hold', 'hold-effects': 'hold',
    channel: 'channel', draw: 'continuous', 'burnout-first': 'burnout',
    main: 'main', 'main-effects': 'main', ending: 'ending',
    'special-designations': 'required-cleanup', 'special-lethal': 'lethal-kill',
    'special-expiration': 'expiration', 'special-remaining': 'required-cleanup',
    'special-fepr': 'fepr', 'ordinary-designations': 'required-cleanup',
    'ordinary-lethal': 'lethal-kill', 'ordinary-remaining': 'required-cleanup',
    'ordinary-fepr': 'fepr',
  };
  for (const [step, event] of Object.entries(preEvents)) {
    const result = map(step, PRE);
    assert.equal(result.length, 1, step);
    assertBoundary(result[0], 'pre', event, step === 'draw' ? 'draw' : event, step);
  }
  assert.deepEqual(events(map('draw', PRE)), ['continuous']);
  assert.deepEqual(events(map('awaiting-turn-start', PRE)), []);
  assert.deepEqual(events(map('ended', PRE)), []);
  assert.throws(() => map('channel-effects', PRE), /only a post/);
  assert.throws(() => map('draw-effects', PRE), /only a post/);
  assert.throws(() => map('burnout-intervention', PRE), /only a post/);
});

test('channel checks its real rune transfer after commit, not an exhausted rune deck', () => {
  const committed = map('channel', post(channel));
  assert.equal(committed.length, 1);
  assertBoundary(committed[0], 'post', 'zone-transition', 'channel', 'channel');
  assert.deepEqual(map('channel', post()), []);
  assert.deepEqual(events(map('channel-effects', post(channel))), ['zone-transition']);
  assert.deepEqual(map('channel-effects', post()), []);
  assert.notEqual(committed[0].taskSuffix, map('channel-effects', post(channel))[0].taskSuffix);
});

test('draw checks both draw phase event and draw-subject after each committed draw', () => {
  for (const step of ['draw', 'draw-effects', 'burnout-intervention']) {
    const committed = map(step, post(draw));
    assert.deepEqual(events(committed), ['draw', 'draw-subject'], step);
    assertBoundary(committed[0], 'post', 'draw', 'draw', step);
    assertBoundary(committed[1], 'post', 'draw-subject', step === 'burnout-intervention' ? 'burnout' : 'draw', step);
    assert.deepEqual(map(step, post(recycle)), [], `${step}: recycle without drawing`);
    assert.deepEqual(map(step, post()), [], `${step}: no draw and no recycle`);
    assert.deepEqual(events(map(step, post(draw, recycle))), ['draw', 'draw-subject'], `${step}: partial draw then Burn Out`);
  }
  assertBoundary(map('burnout-first', PRE)[0], 'pre', 'burnout', 'burnout', 'burnout-first');
  assert.deepEqual(events(map('draw', PRE)), ['continuous']);
  assert.notEqual(map('draw', PRE)[0].taskSuffix, map('draw', post(draw))[0].taskSuffix);
});

test('both lethal steps enable post pre-exit and zone-transition only for committed kills', () => {
  for (const step of ['special-lethal', 'ordinary-lethal']) {
    assert.deepEqual(events(map(step, PRE)), ['lethal-kill']);
    assert.deepEqual(map(step, post()), [], `${step}: legal no-kill cleanup`);
    for (const trace of [[lethal], [lethalAtBase], [lethal, lethalAtBase]]) {
      const committed = map(step, post(...trace));
      assert.deepEqual(events(committed), ['pre-exit', 'zone-transition']);
      assertBoundary(committed[0], 'post', 'pre-exit', 'lethal-kill', step);
      assertBoundary(committed[1], 'post', 'zone-transition', 'lethal-kill', step);
    }
  }
});

test('FEPR checks outstanding ledger only for a genuinely processed mutation', () => {
  for (const step of ['special-fepr', 'ordinary-fepr']) {
    assert.deepEqual(events(map(step, PRE)), ['fepr']);
    assert.deepEqual(map(step, { at: 'post', outcome: 'none' }), []);
    const processed = map(step, { at: 'post', outcome: 'processed' });
    assert.equal(processed.length, 1);
    assertBoundary(processed[0], 'post', 'fepr-outstanding', 'fepr', step);
  }
  assert.throws(() => map('special-fepr', { at: 'post', outcome: 'pending' }), TypeError);
});

test('known terminal cursor states are distinct from unknown steps and incorrect timing', () => {
  for (const step of ['awaiting-turn-start', 'ended']) {
    assert.deepEqual(map(step, PRE), []);
    assert.throws(() => map(step, post()), /no post boundary/);
  }
  for (const step of ['', 'future', 'draw-future', 'ordinary-future', 'channel-post',
    'special-designations-future', 'not-a-step', 'undefined', 'draw-effects-v2', null, undefined]) {
    assert.throws(() => map(step, PRE), { name: 'RangeError', message: /unknown Duel V2 phase-closure step/ });
  }
  assert.throws(() => map('begin', post()), /no post boundary/);
  assert.throws(() => map('burnout-first', post()), /no post boundary/);
});

test('invalid context, missing outcome, extra keys, accessors, and malformed traces reject', () => {
  for (const value of [undefined, null, true, '', [], { }, { at: 'before' },
    { at: 'pre', outcome: 'processed' }, { at: 'post' },
    { at: 'post', committedTransitions: [], outcome: 'none' },
    { at: 'pre', irrelevant: false },
    Object.create({ at: 'pre' }),
    Object.defineProperty({}, 'at', { enumerable: true, get: () => 'pre' }),
    { at: 'pre', [Symbol('extra')]: 1 }]) {
    assert.throws(() => map('draw', value), TypeError);
  }
  assert.throws(() => map('special-fepr', post()), TypeError);
  assert.throws(() => map('special-fepr', { at: 'post', outcome: 'processed', extra: 1 }), TypeError);
  assert.throws(() => map('channel-effects', { at: 'post', outcome: 'processed' }), TypeError);
  assert.throws(() => map('draw', { at: 'post', committedTransitions: null }), TypeError);
  assert.throws(() => map('draw', { at: 'post', committedTransitions: { 0: draw, length: 1 } }), TypeError);
  assert.throws(() => map('draw', { at: 'post', committedTransitions: Array(1) }), TypeError);
  assert.throws(() => map('draw', { at: 'post', committedTransitions: [draw, , recycle] }), TypeError);
  assert.throws(() => map('draw', { at: 'post', committedTransitions: Object.assign([draw], { extra: true }) }), TypeError);
  assert.throws(() => map('draw', { at: 'post', committedTransitions: [Object.defineProperty({}, 'uid', { get: () => 'card-1' })] }), TypeError);
  assert.throws(() => map('draw', post({ ...draw, extra: 'untrusted' })), TypeError);
  assert.throws(() => map('draw', post({ ...draw, uid: '' })), TypeError);
  assert.throws(() => map('draw', post({ ...draw, to: { kind: 'hand' } })), TypeError);
  assert.throws(() => map('draw', post({ ...draw, from: zone('unknown') })), TypeError);
  assert.throws(() => map('draw', post(transition('card-1', 'hand', 'hand'))), TypeError);
  assert.throws(() => map('draw', post(transition('card-1', 'hand', 'main-deck'))), /foreign committed transition/);
  assert.throws(() => map('draw', post({ ...draw, to: zone('hand', 'P2') })), /foreign committed transition/);
  assert.throws(() => map('draw', post({ ...recycle, to: zone('main-deck', 'P2') })), /foreign committed transition/);
  assert.throws(() => map('channel', post(draw)), /foreign committed transition/);
  assert.throws(() => map('special-lethal', post(channel)), /foreign committed transition/);
  assert.throws(() => map('burnout-intervention', post(lethal)), /foreign committed transition/);
});

test('all records are frozen, use valid events/phases, and have globally unique suffixes', () => {
  const all = [];
  const outcomes = {
    channel: post(channel), 'channel-effects': post(channel), draw: post(draw),
    'draw-effects': post(draw), 'burnout-intervention': post(draw),
    'special-lethal': post(lethal), 'ordinary-lethal': post(lethal),
    'special-fepr': { at: 'post', outcome: 'processed' },
    'ordinary-fepr': { at: 'post', outcome: 'processed' },
  };
  for (const step of DUEL_PHASE_CLOSURE_STEPS_V2) {
    if (!['channel-effects', 'draw-effects', 'burnout-intervention'].includes(step))
      all.push(...map(step, PRE));
    if (step in outcomes) all.push(...map(step, outcomes[step]));
  }
  const suffixes = all.map(boundary => boundary.taskSuffix);
  assert.equal(all.length, 33, 'complete pre/post map for all 24 steps');
  assert.equal(new Set(suffixes).size, suffixes.length);
  assert.ok(all.some(boundary => boundary.event === 'draw' && boundary.ordinal === 'post'));
  for (const boundary of all) {
    assert.ok(Object.isFrozen(boundary));
    assert.ok(phaseEvents.includes(boundary.phase), boundary.phase);
    assert.ok(DUEL_PHASE_CLOSURE_EVENTS_V2.includes(boundary.event), boundary.event);
    if (phaseEvents.includes(boundary.event)) assert.equal(boundary.event, boundary.phase);
    if (boundary.ordinal === 'post' && boundary.event !== 'draw') assert.ok(nonPhaseEvents.includes(boundary.event));
  }
  const frozen = map('draw', post(draw));
  assert.ok(Object.isFrozen(frozen));
  assert.throws(() => { frozen[0].event = 'continuous'; }, TypeError);
  assert.deepEqual(events(map('draw', post(draw))), ['draw', 'draw-subject']);
});
