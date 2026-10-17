import assert from 'node:assert/strict';
import { validateCardProgram } from '@riftbound/card-dsl';
import { AwaitChoice } from '../../../dist/effects/contract.js';
import { c, fixture } from '../helpers.mjs';

export { c };
export const linked = (instructionId, key) => ({ kind: 'linked-value', instructionId, key });
export const source = (id = 'top', count = 5, extra = {}) => ({
  id, options: [], ordered: true, selection: 'all',
  zoneSlice: { zone: 'deck', from: 'top', ...(count === undefined ? {} : { count: c(count) }) }, ...extra
});
export const resultPick = (id, instructionId, key) => ({
  id, options: [], ordered: true, selection: 'all', linked: linked(instructionId, key)
});
export const inspect = (extra = {}) => ({
  id: 'look', op: 'effect.inspect', args: {
    player: c('A'), scope: c('top'), amount: c(5), picksSpecId: c('top')
  }, picks: [source()], ...extra
});
export function program(body) {
  return { canonicalCardId: 'synthetic:ordered-picks', rulesetVersion: 'core-1.5', status: 'executable', sourceText: 'Synthetic ordered pick lifecycle', abilities: [{ kind: 'play', body }] };
}
export function validated(body) {
  const result = validateCardProgram(program(body));
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  return result.value.abilities[0].body;
}
export function setup(options = {}) {
  const f = fixture({ ...options, cards: [{ id: 'fifth' }, { id: 'tail' }, { id: 'incoming' }] });
  for (const id of ['fifth', 'tail']) assert.equal(f.engine.commit({ type: 'move-zone', object: f.kernel.ref(id), to: 'deck-bottom' }).status, 'done');
  // Make physical zone order differ from query insertion order before Finalize.
  assert.equal(f.engine.commit({ type: 'order-top', player: 'A', objects: ['A:deck:3', 'A:deck:1', 'A:deck:4', 'A:deck:2'].map(id => f.kernel.ref(id)) }).status, 'done');
  f.engine.advance();
  return f;
}
export const deck = (f, player = 'A') => f.kernel.zoneSlice(player, 'deck', 'top').map(object => object.ref.id);
export function requestOnResolve(f) {
  let request;
  f.engine.pass('A');
  assert.throws(() => f.engine.pass('B'), error => {
    assert.ok(error instanceof AwaitChoice); request = error.request; return true;
  });
  return request;
}
