import assert from 'node:assert/strict';
import { world } from '../../../dist/effects/testing/test-kernel.js';
import { bindResolveContext, createActionPipelineHost } from '../../../dist/events/action-adapter.js';
import { createMatch } from '../../../dist/game/lifecycle.js';
import { executeGameCommand, executeJournalGameCommand } from '../../../dist/game/commands/index.js';
import { createProgramBinding } from '../../../dist/programs/index.js';

export const constant = value => ({ kind: 'constant', value });

function deck(player, summonRecruit) {
  const card = (id, types) => ({ id, cardId: id, types });
  return {
    // Synthetic, explicitly zero-cost Units; these are not official card semantics.
    mainDeck: Array.from({ length: 40 }, (_, i) => ({
      id: `${player}:scout:${i}`, cardId: summonRecruit && player === 'A' ? 'synthetic:recruit-scout' : 'synthetic:scout', types: ['unit'], energy: 0, power: [], might: 3,
    })),
    runeDeck: Array.from({ length: 12 }, (_, i) => card(`${player}:rune:${i}`, ['rune'])),
    championLegend: card(`${player}:legend`, ['legend']),
    chosenChampion: card(`${player}:champion`, ['champion']),
    battlefields: Array.from({ length: 3 }, (_, i) => card(`${player}:field:${i}`, ['battlefield'])),
  };
}

export function setup({ firstPlayer = 0, status = 'executable', summonRecruit = false } = {}) {
  const kernel = world().player('A').player('B').build();
  const choose = request => { throw new Error(`Unexpected real choice: ${request.id}`); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const decks = [deck('A', summonRecruit), deck('B', summonRecruit)];
  const match = createMatch({
    host: { ...host, player: id => kernel.player(id) },
    decks, seed: 'RIFT-761', battlefieldChoice: [0, 1], mulligans: [[], []], firstPlayer,
  });
  const fields = match.flow.battlefields.map(field => field.id);
  const binding = createProgramBinding({ cardPrograms: [{
    canonicalCardId: 'synthetic:scout', rulesetVersion: 'core-1.5', status,
    sourceText: 'Synthetic test Unit. Activated: Move me to the named Battlefield or my Base.',
    ...(status === 'judge-required' ? { judgeReason: 'Unresolved synthetic ability' } : {}),
    abilities: [...fields.map(id => ({ type: 'battlefield', id })), { type: 'base', player: 'A' }].map((to, i) => ({
      kind: 'activated', timing: 'action', cost: { kind: 'activated' },
      body: [{ id: `scout-move-${i}`, op: 'effect.move', args: { to: constant(to) } }],
    })),
  }, ...(summonRecruit ? [{
    canonicalCardId: 'synthetic:recruit-scout', rulesetVersion: 'core-1.5', status: 'executable',
    sourceText: 'Synthetic test Unit. On play, create a Recruit at the named Battlefield.',
    abilities: [{
      kind: 'play', body: [{ id: 'create-recruit', op: 'effect.token', args: {
        token: constant('recruit'), location: constant({ type: 'battlefield', id: fields[0] }),
      } }],
    }],
  }] : [])] });
  binding.attachLifecycle(match.flow.chain);
  let stateVersion = 0;
  let nextId = 0;
  const transcript = [];
  const context = () => ({ match, binding, stateVersion });
  const submit = (actor, command) => {
    const result = executeGameCommand(context(), actor, command);
    transcript.push({ actor, command: structuredClone(command) });
    stateVersion++;
    return result;
  };
  const send = (actor, type, fields = {}) => submit(actor, { type, commandId: `command-${++nextId}`, stateVersion, ...fields });
  const submitJournal = entry => {
    const result = executeJournalGameCommand(context(), entry);
    stateVersion++;
    return result;
  };
  const settle = () => {
    let budget = 0;
    while (match.flow.chain.items.length) {
      assert.ok(++budget < 50, 'real chain must terminate');
      send(match.flow.chain.priority, 'pass');
    }
  };
  const play = (actor = match.flow.turnPlayer) => {
    const card = kernel.objects.find(object => object.controller === actor && object.zone === 'hand' && object.types.includes('unit'));
    assert.ok(card, 'a real hand card exists');
    send(actor, 'play', { cardObjectId: card.ref.id });
    settle();
    assert.equal(kernel.getObject(card.ref.id).zone, 'board');
    assert.deepEqual(kernel.getObject(card.ref.id).location, { type: 'base', player: actor });
    return card.ref.id;
  };
  const activate = (id, index) => {
    send(match.flow.turnPlayer, 'activate', { sourceObjectId: id, abilityId: String(index) });
    settle();
  };
  const nextTurn = () => send(match.flow.turnPlayer, 'pass');
  return { kernel, match, binding, fields, decks, context, submit, submitJournal, send, settle, play, activate, nextTurn, transcript };
}

export function state(f) {
  return {
    kernel: f.kernel.snapshot(), events: f.match.events(), trace: f.match.flow.chain.trace,
    phase: f.match.flow.phase, turn: f.match.flow.turn, player: f.match.flow.turnPlayer,
    priority: f.match.flow.chain.priority, focus: f.match.flow.chain.focus, turnState: f.match.flow.chain.turnState,
    chain: f.match.flow.chain.items, clock: structuredClone(f.match.flow.chain.pipeline.clock),
    scored: Object.fromEntries(f.match.turnOrder.map(player => [player, f.match.flow.scored(player)])),
    battlefields: f.match.flow.battlefields, combat: f.match.flow.combat.checkpoint(),
    registry: f.match.flow.layers.registry.snapshot(), result: f.match.result(),
  };
}

export function readyUnits(f, count = 1) {
  const units = Array.from({ length: count }, () => f.play());
  f.nextTurn(); f.nextTurn();
  for (const id of units) assert.equal(f.kernel.getObject(id).exhausted, false);
  return units;
}
