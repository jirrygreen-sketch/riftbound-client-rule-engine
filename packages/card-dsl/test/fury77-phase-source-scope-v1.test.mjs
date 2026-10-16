import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { CATALOG } from './fixtures/official-catalog.mjs';

const dsl = await import(process.env.DUEL_OFFICIAL_PROGRAMS_MODULE ?? '../dist/duel/official-programs.js');
const officialCatalog = new URL('../../card-data/data/deck-catalog.json', import.meta.url);
const viText = '[Ganking] (I can move from battlefield to battlefield.)\nRecycle 1 from your trash: Give me +1 :rb_might: this turn.';
const deflectText = '[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)';
const viCanonical = 'card.hash-bcfd5b90d3252713ccfca0703a0d9aef17711a45ff2065bd68d7dd7822950b51';
const poroCanonical = 'card.hash-67d8869cd0857c707456cbffeef13e8907581ac91c85c5b70d64ee7c128db452';

// Exact reviewed printings keep the default test runnable without gitignored data.
const exactCards = [
  { id: 'ogn-036-298', cardType: 'Unit', ability: viText, energy: 2, power: 1, might: 3,
    domains: ['Fury'], tags: ['Vi', 'Piltover', 'Champion'], canonicalCardId: viCanonical,
    name: 'Vi', fullName: 'Vi, Destructive', localizedName: '蔚', setCode: 'ogn', cardNumber: 'OGN-036/298', variant: 'standard' },
  { id: 'ven-167-166', cardType: 'Unit', ability: '[Ganking]\nRecycle 1 from your trash: Give me +1 :rb_might: this turn.',
    energy: 2, power: 1, might: 3, domains: ['Fury'], tags: ['Vi', 'Champion'], canonicalCardId: viCanonical,
    name: 'Vi', fullName: 'Vi, Destructive', localizedName: '蔚', setCode: 'ven', cardNumber: 'VEN-167/166', variant: 'standard' },
  { id: 'ogn-013-298', cardType: 'Unit', ability: deflectText, energy: 2, power: null, might: 2,
    domains: ['Fury'], tags: ['Poro'], canonicalCardId: poroCanonical,
    name: 'Pouty Poro', fullName: 'Pouty Poro', localizedName: '呸呸魄罗', setCode: 'ogn', cardNumber: 'OGN-013/298', variant: 'standard' },
  { id: 'sfd-037-221', cardType: 'Unit', ability: deflectText, energy: 4, power: null, might: 4,
    domains: ['Calm'], tags: ['Yordle', 'Ionia'], canonicalCardId: 'card.hash-c75d6f4a1bbeb87090ae0f7135aac4f6a4f1062063662b9ccae6fe99f1c9bc7d',
    name: 'Navori Scout', fullName: 'Navori Scout', localizedName: '纳沃利侦察兵', setCode: 'sfd', cardNumber: 'SFD-037/221', variant: 'standard' },
  { id: 'unl-220-219', cardType: 'Unit', ability: '[Deflect]', energy: 2, power: null, might: 2,
    domains: ['Fury'], tags: ['Poro'], canonicalCardId: poroCanonical,
    name: 'Pouty Poro', fullName: 'Pouty Poro', localizedName: '呸呸魄罗', setCode: 'unl', cardNumber: 'UNL-220/219', variant: 'standard' },
  { id: 'unl-t02', cardType: 'Unit', ability: deflectText, energy: null, power: null, might: 1,
    domains: ['Colorless'], tags: ['Bird', 'Token'], canonicalCardId: 'card.hash-68b515e1903e6d629eeb25b886b6f90bb791121e70c5ea72793220dd7f70e70d',
    name: 'Bird', fullName: 'Bird', localizedName: '战鹰', setCode: 'unl', cardNumber: 'UNL-T02', variant: 'standard' },
];
const catalog = fs.existsSync(officialCatalog)
  ? JSON.parse(fs.readFileSync(officialCatalog, 'utf8'))
  : { ...CATALOG, cards: [...CATALOG.cards, ...exactCards] };
const source = dsl.duelAbilitySourceFromCatalog(catalog);
const roster = dsl.createDuelFuryOptionalRosterOfficialProgramRegistryV1(source);
const viIds = ['ogn-036-298', 'ven-167-166'];
const deflectIds = ['ogn-013-298', 'sfd-037-221', 'unl-220-219', 'unl-t02'];
const ids = [...viIds, ...deflectIds];
const viSubevents = [
  { event: 'standard-move', handlers: [], modifiers: ['static.ganking'] },
  { event: 'activate', handlers: ['compound-vi-self.activate'], modifiers: [] },
];
const deflectSubevents = [
  { event: 'play', handlers: [], modifiers: ['passive.deflect.additional-opponent-power-cost'] },
];
const baseClosure = [
  'all-source-candidate-closure', 'hidden-zone-event-subjects', 'continuous-effect-registry',
  'cleanup-queue-and-replacements', 'runtime-subevent-journal', 'recursive-conquer-event-journal',
];

test('all six exact Vi/Deflect printings have source scope at every phase in both modes', () => {
  assert.equal(dsl.DUEL_PHASE_EVENT_NAMES.length, 12);
  if (fs.existsSync(officialCatalog)) {
    assert.equal(catalog.cards.length, 1381);
    assert.equal(roster.knownProgramCount, 77);
  }
  for (const card of exactCards) {
    assert.deepEqual(source.cards.find((entry) => entry.id === card.id), card);
  }
  for (const id of ids) {
    const program = roster.getProgram(id);
    assert.ok(program, id);
    const expected = viIds.includes(id) ? viSubevents : deflectSubevents;
    for (const phase of dsl.DUEL_PHASE_EVENT_NAMES) {
      for (const mode of ['atomic-boundary', 'runtime-subevents']) {
        const result = roster.sourceProgramPhaseScope(id, { phase, mode }, roster.reference(id));
        assert.equal(result.scope, 'source-program', `${id} ${phase} ${mode}`);
        assert.equal(result.directBoundaryStatus, 'known-no-handler');
        assert.equal(result.sourceApplicabilityStatus,
          mode === 'atomic-boundary' ? 'known-no-handler' : 'handlers-or-modifiers');
        assert.deepEqual(result.handlers, []);
        assert.deepEqual(result.modifiers, []);
        assert.deepEqual(result.runtimeSubevents, expected);
        assert.equal(result.globalClosureStatus, 'unverified');
        assert.equal(result.sourceProgramComplete, true);
        assert.deepEqual(result.reference, roster.reference(id));
        assert.equal(result.sourceCardId, id);
        assert.equal(result.sourceDataVersion, source.dataVersion);
        assert.equal(result.sourceCatalogDigest, source.sourceCatalogDigest);
        assert.deepEqual(result.requiredGlobalRuntimeClosure, [
          ...baseClosure,
          ...(phase === 'draw' ? ['draw-subject-journal'] : []),
          ...(phase === 'lethal-kill' ? ['pre-exit-event-journal', 'kill-trigger-effect-cases'] : []),
        ]);
        assert.equal(Object.isFrozen(result), true);
      }
      if (['awaken', 'begin', 'hold'].includes(phase)) {
        assert.equal(roster.phaseEventScope(id, phase).status, 'known-no-handler');
      } else {
        assert.equal(roster.phaseEventScope(id, phase).status, 'unknown');
      }
    }
  }
  assert.equal(roster.eventScope(viIds[0], 'standard-move').modifiers[0], 'static.ganking');
  assert.equal(roster.eventScope(viIds[0], 'activate').handlers[0], 'compound-vi-self.activate');
  assert.equal(roster.eventScope(deflectIds[0], 'spell-resolution').status, 'known-no-handler');
  assert.deepEqual(roster.eventScope(deflectIds[0], 'play').modifiers, ['passive.deflect.additional-opponent-power-cost']);
  assert.deepEqual(roster.getProgram(deflectIds[0]).semantics.modifier, {
    kind: 'additional-opponent-power-cost', amount: 1, powerDomain: 'wildcard', payer: 'opponent',
    timing: 'additional-play-cost', per: 'each-choice-of-source', optional: false, automaticPayment: false,
    choice: { source: 'spell-or-ability', target: 'source-unit-on-board' },
  });
});

test('every resolved printing in the full source has a local result, without global closure', () => {
  const resolved = roster.cardIds().filter((id) => roster.get(id).status === 'resolved');
  assert.equal(resolved.length, roster.knownProgramCount);
  for (const id of resolved) {
    for (const phase of dsl.DUEL_PHASE_EVENT_NAMES) {
      for (const mode of ['atomic-boundary', 'runtime-subevents']) {
        const result = roster.sourceProgramPhaseScope(id, { phase, mode });
        assert.equal(result.scope, 'source-program', `${id} ${phase} ${mode}`);
        assert.equal(result.globalClosureStatus, 'unverified');
      }
    }
  }
});

test('future events, extra shapes, foreign registries, wrong references and bare programs fail closed', () => {
  const id = viIds[0];
  const context = { phase: 'main', mode: 'runtime-subevents' };
  const unknown = roster.sourceProgramPhaseScope(id, 'future-main');
  assert.equal(unknown.scope, 'unknown');
  assert.equal(unknown.reason, 'unknown-event');
  assert.equal(unknown.eventRecognized, false);
  const extra = roster.sourceProgramPhaseScope(id, { ...context, extra: true });
  assert.equal(extra.scope, 'unknown');
  assert.equal(extra.reason, 'invalid-context');
  for (const input of [roster.getProgram(id), roster.get(id), { ...roster }]) {
    const result = dsl.queryDuelSourceProgramPhaseScope(input, id, context, roster.reference(id));
    assert.equal(result.scope, 'unknown');
    assert.equal(result.reason, 'unresolved-program');
  }
  const foreign = dsl.createDuelOfficialProgramRegistry(source);
  assert.equal(foreign.sourceProgramPhaseScope(id, context).reason, 'unresolved-program');
  const reference = roster.reference(id);
  for (const wrong of [
    roster.reference(deflectIds[0]),
    { ...reference, cardId: deflectIds[0] },
    { ...reference, programId: 'foreign' },
    { ...reference, sourceCatalogDigest: 'sha256:foreign' },
    { ...reference, dataVersion: 'future' },
    { ...reference, extra: true },
  ]) assert.throws(() => roster.sourceProgramPhaseScope(id, context, wrong), TypeError);
  const changedSource = dsl.duelAbilitySourceFromCatalog({
    ...catalog,
    cards: catalog.cards.map((card) => card.id === id ? { ...card, tags: [...card.tags, 'Forged'] } : card),
  });
  const changedRegistry = dsl.createDuelFuryOptionalRosterOfficialProgramRegistryV1(changedSource);
  assert.equal(changedRegistry.sourceProgramPhaseScope(id, context).reason, 'unresolved-program');
});
