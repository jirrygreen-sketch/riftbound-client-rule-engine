import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelCommandSessionV2, applyDuelResourceCommandV2 } from '../dist/duel/canonical-session-v2.js';
import { createDuelPhaseSourceRegistryV2, inspectDuelPhaseSourcesV2 } from '../dist/duel/phase-source-authority-v2.js';

export const seats = ['alice','bob'].map(playerId => ({ playerId,
  mainDeck: Array.from({length:10}, (_,i) => ({uid:`${playerId}-card-${i}`,cardId:'plain-unit'})),
  champion: {uid:`${playerId}-champion`,cardId:'plain-champion'},
  legend: {uid:`${playerId}-legend`,cardId:'plain-legend'},
  runeDeck: Array.from({length:6},(_,i) => ({uid:`${playerId}-rune-${i}`,cardId:'plain-rune',domain:'Fury'})),
  battlefields: Array.from({length:3},(_,i) => ({instanceId:`${playerId}-field-${i}`,cardId:`plain-field-${i}`})),
}));
export const metadata = {matchId:'phase-v2',dataVersion:'catalog-v2',catalogDigest:'sha256:phase-v2',
  roster: seats.map(s => ({playerId:s.playerId,displayName:s.playerId}))};
export const types = id => id === 'plain-champion' ? 'Champion' : id === 'plain-legend' ? 'Legend' :
  id === 'plain-rune' ? 'Rune' : id.startsWith('plain-field-') ? 'Battlefield' : 'Unit';
export function playing() {
  let s = createDuelCommandSessionV2(seats,metadata,()=>0,types);
  for (const actor of ['alice','bob']) {
    const result = applyDuelResourceCommandV2(s,actor,{commandId:`m-${actor}`,
      expectedVersion:s.match.stateVersion,command:{type:'mulligan',selectedUIDs:[]}});
    assert.equal(result.outcome.status,'applied'); s=result.session;
  }
  return s;
}
export function index(s = null, omitted = []) {
  const meta = s?.match ?? metadata;
  const printings = [...new Set(seats.flatMap(seat => [seat.champion.cardId,
    seat.legend.cardId, ...seat.mainDeck.map(card => card.cardId),
    ...seat.runeDeck.map(card => card.cardId), ...seat.battlefields.map(card => card.cardId)]))]
    .filter(cardId => !omitted.includes(cardId))
    .map(cardId => ({cardId,programReference:`test-only-whole-program:${cardId}`}));
  return {matchId:meta.matchId,dataVersion:meta.dataVersion,catalogDigest:meta.catalogDigest,printings};
}
export function oracle(modifier = () => ({}), catalog = index()) {
  return createDuelPhaseSourceRegistryV2(catalog, request => ({
    status:'complete', matchId:request.matchId, dataVersion:request.dataVersion,
    catalogDigest:request.catalogDigest, turn:request.turn,taskId:request.taskId,
    uid:request.source.uid,zoneEpoch:request.source.zoneEpoch,
    controllerPlayerId:request.source.controllerPlayerId,cardId:request.source.cardId,
    programReference:`test-only-whole-program:${request.source.cardId ?? request.source.uid}`,
    event:request.event,eventSupported:true,scope:'known-no-handler',
    replacementsCovered:true,staticCovered:true,continuousCovered:true,triggersCovered:true,
    ...modifier(request),
  }));
}
const inspect = (s, registry, event='awaken', task=`duel-v2:${s.match.matchId}:turn-${s.match.frame.turnNumber}:awaken:0`) =>
  inspectDuelPhaseSourcesV2(s.match,event,s.match.frame.turnNumber,task,registry);

test('test oracle enumerates actual current Legend/Battlefield at constructor frame', () => {
  const s=playing(), out=inspect(s,oracle());
  assert.equal(out.status,'ready'); assert.equal(out.sources.filter(x=>x.kind==='legend').length,2);
  assert.equal(out.sources.filter(x=>x.kind==='battlefield').length,2);
  assert.equal(out.handlers.length,0);
});
test('unknown whole program is pending, not known-no-handler', () => {
  const s=playing(); assert.equal(inspect(s,oracle(() => ({status:'unknown'}))).status,'pending');
});
test('missing and bare verified-no-effect fail closed', () => {
  const s=playing();
  assert.equal(inspect(s,createDuelPhaseSourceRegistryV2(index(), () => undefined)).status,'pending');
  assert.equal(inspect(s,createDuelPhaseSourceRegistryV2(index(), () => ({status:'verified-no-effect'}))).status,'pending');
});
test('foreign UID, wrong epoch or mismatched reference cannot certify sources', () => {
  const s=playing();
  for (const fault of [{uid:'foreign'}, {zoneEpoch:53}, {programReference:'foreign-printing'}])
    assert.equal(inspect(s,oracle(() => fault)).status,'pending');
});
test('unsupported event, missing coverage, wrong stage task and provider throw stay pending', () => {
  const s=playing();
  assert.equal(inspect(s,oracle(() => ({eventSupported:false}))).status,'pending');
  assert.equal(inspect(s,oracle(() => ({staticCovered:false}))).status,'pending');
  assert.equal(inspect(s,oracle(), 'channel', 'wrong-task').status,'pending');
  assert.equal(inspect(s,createDuelPhaseSourceRegistryV2(index(), () => { throw Error('offline'); })).status,'pending');
});
test('independent catalog index rejects missing printing and spoofed string-overlap reference', () => {
  const s=playing();
  assert.equal(inspect(s,oracle(()=>({}),index(s,['plain-legend']))).status,'pending');
  assert.equal(inspect(s,oracle(()=>({programReference:'prefix-plain-legend-but-not-index'}))).status,'pending');
  assert.equal(inspect(s,oracle(()=>({}),{...index(s),catalogDigest:'foreign'})).status,'pending');
});
test('actual handler is reported, not equated to a no-op', () => {
  const s=playing(), out=inspect(s,oracle(r => r.source.kind === 'battlefield'
    ? {scope:'handlers-or-modifiers'} : {}));
  assert.equal(out.status,'ready'); assert.equal(out.handlers.length,2);
});
