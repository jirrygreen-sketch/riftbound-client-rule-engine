import test from 'node:test';
import assert from 'node:assert/strict';
import { playing, oracle, index, seats, metadata, types } from './duel-phase-source-authority-v2.test.mjs';
import { runDuelStartOfTurnV2 as start, resumeDuelStartOfTurnV2 as resumeStart,
  runDuelEndOfTurnV2 as end, resumeDuelEndOfTurnV2 as resumeEnd } from '../dist/duel/turn-executor-v2.js';
import { commitDuelCommandMutationV2, applyDuelResourceCommandV2,
  issueDuelRequiredCostTaskV2, createDuelCommandSessionV2 } from '../dist/duel/canonical-session-v2.js';
import { referenceDuelPhysicalCardV2 } from '../dist/duel/core-v2.js';
import { placeDuelUnit } from '../dist/duel/battlefields.js';

const services = (sources=oracle(), extras={}) => ({sources,fepr:()=>({status:'none'}),...extras});
function main(s, srv=services()) { const r=start(s,srv); assert.equal(r.status,'main',r.reason); return r.session; }
function next(s,srv=services()) { const r=end(s,s.match.frame.turnPlayerId,srv); assert.equal(r.status,'awaiting-turn-start',r.reason); return r.session; }
const pool=(s,actor)=>s.match.resources.players.find(p=>p.playerId===actor).runePool;

test('factory + two real mulligans run Awaken→Beginning→Hold→Channel→Draw→Main on admitted V2', () => {
  const initial=playing(), s=main(initial);
  assert.equal(s.match.schemaVersion,2); assert.equal(s.match.frame.phase,'main');
  assert.equal(s.match.frame.priorityPlayerId,'alice'); assert.equal(s.match.scoring.turnNumber,1);
  assert.equal(s.match.resources.bases[0].baseRunes.length,2);
  assert.equal(s.match.players[0].hand.length,5);
  assert.equal(s.match.provenance.transitions.filter(x=>x.from.kind==='rune-deck').length,2);
  assert.equal(s.match.provenance.transitions.filter(x=>x.uid==='alice-rune-0').length,0);
  assert.equal(s.match.resources.bases[0].baseRunes.every(r =>
    referenceDuelPhysicalCardV2(s.match,r.uid).zoneEpoch === 1),true);
  assert.deepEqual(s.receipts,initial.receipts);
});
test('first channel +1 belongs to second seat once, remains across turns', () => {
  let s=main(playing()); s=main(next(s));
  assert.equal(s.match.frame.turnPlayerId,'bob');
  assert.equal(s.match.resources.bases[1].baseRunes.length,3);
  assert.deepEqual(s.turnCursorV2.firstChannelProcessedPlayerIDs,['bob']);
  s=main(next(s)); s=main(next(s));
  assert.equal(s.match.frame.turnPlayerId,'bob');
  assert.equal(s.match.resources.bases[1].baseRunes.length,5);
});
test('two Ending/Start cycles advance turn and never reuse stale Ending cursor', () => {
  let s=main(playing());
  for (const turn of [2,3]) {
    s=next(s); assert.equal(s.match.frame.turnNumber,turn);
    s=main(s); assert.equal(s.match.frame.phase,'main');
    assert.equal(s.turnCursorV2.turn,turn);
  }
  assert.equal(s.match.players[0].hand.length,6);
  assert.equal(s.match.players[1].hand.length,5);
});
test('unknown program at Awaken and missing/bare evidence cannot advance match', () => {
  const s=playing();
  for (const bad of [oracle(() => ({status:'unknown'})),
    oracle(() => ({eventSupported:false}))]) {
    const r=start(s,services(bad)); assert.equal(r.status,'pending');
    assert.strictEqual(r.session.match,s.match); assert.equal(r.session.match.frame.phase,'awaiting-turn-start');
  }
});
test('pending cursor retries exact task; consumed/wrong/old tasks never re-run clocks', () => {
  const s=playing(), pending=start(s,services(oracle(() => ({status:'unknown'}))));
  assert.equal(pending.status,'pending');
  const pendingId=pending.pending.taskId;
  const wrong=resumeStart(pending.session,`${pendingId}-stale`,{},services());
  assert.equal(wrong.status,'rejected'); assert.strictEqual(wrong.session,pending.session);
  const valid=resumeStart(pending.session,pendingId,
    {status:'retry',matchId:s.match.matchId,turn:1,taskId:pendingId},services());
  assert.equal(valid.status,'main',valid.reason);
  assert.equal(resumeStart(valid.session,pendingId,{},services()).status,'duplicate');
  assert.strictEqual(resumeStart(valid.session,pendingId,{},services()).session,valid.session);
});
test('issued paid-task capability exclusively blocks phase mutation and Ending', () => {
  let s=main(playing());
  const source=s.match.players[0].hand[0].uid;
  const task={matchId:s.match.matchId,expectedVersion:s.match.stateVersion,taskId:'cost-1',paymentId:'p1',
    actor:'alice',finalResolvedCost:{energy:0,power:[]},opaqueSource:{kind:'card',referenceId:'test-cost',sourceUID:source},
    continuationId:'continuation-1'};
  const issued=issueDuelRequiredCostTaskV2(s,task,request=> ({matchId:request.match.matchId,
    actor:request.actor,paymentId:request.paymentId,sourceReference:request.sourceReference,
    sourceProofId:'test-source',mode:'current',sourceZoneEpoch:referenceDuelPhysicalCardV2(request.match,source).zoneEpoch,
    taskId:request.taskId,continuationId:request.continuationId}));
  s=issued.session;
  assert.throws(()=>commitDuelCommandMutationV2(s,draft=>({match:draft,transitions:[]})),/issued|pending/);
  assert.equal(end(s,'alice',services()).status,'rejected');
  assert.equal(start(s,services()).status,'rejected');
});
test('paid pool balance is retained until next Main reset; Ending resets after expiration', () => {
  let s=main(playing());
  const uid=s.match.resources.bases[0].baseRunes[0].uid;
  const activated=applyDuelResourceCommandV2(s,'alice',{commandId:'energy',expectedVersion:s.match.stateVersion,
    command:{type:'rune-energy',uid}});
  assert.equal(activated.outcome.status,'applied'); s=activated.session;
  assert.equal(pool(s,'alice').energy,1);
  s=next(s); assert.equal(pool(s,'alice').energy,0);
});
function unitMain({gear=false,damage=1}={}) {
  const modified=seats.map(seat=>({...seat,mainDeck:seat.mainDeck.map((card,i)=>({
    ...card,cardId:seat.playerId==='alice'&&i===9?'test-gear':card.cardId}))}));
  const cardTypes=id=>id==='test-gear'?'Gear':types(id);
  let s=createDuelCommandSessionV2(modified,metadata,()=>0,cardTypes);
  for(const actor of ['alice','bob']) s=applyDuelResourceCommandV2(s,actor,
    {commandId:`m-${actor}`,expectedVersion:s.match.stateVersion,command:{type:'mulligan',selectedUIDs:[]}}).session;
  s=main(s,services(oracle(()=>({}),{...index(),printings:[...index().printings,
    {cardId:'test-gear',programReference:'test-only-whole-program:test-gear'}]})));
  const actor='alice', uid=s.match.players[0].hand.find(card=>card.cardId==='plain-unit').uid;
  const base=s.match.board.bases[0].locationId;
  s=commitDuelCommandMutationV2(s,d=>({match:{...d,
    board:placeDuelUnit(d.board,{objectId:uid,controllerPlayerId:actor,locationId:base}),
    players:d.players.map(p=>p.playerId===actor?{...p,hand:p.hand.filter(c=>c.uid!==uid)}:p),
    unitMeta:{...d.unitMeta,[uid]:{ownerPlayerId:actor,readied:true,
      damageMarks:damage?[{amount:damage,responsiblePlayerId:'bob',sourceObjectIds:['bob-legend']}]:[],
      trait:{kind:'card',cardId:'plain-unit'}}}},transitions:[{uid,
      from:{kind:'hand',zonePlayerId:actor},to:{kind:'board-base',locationId:base}}]})).session;
  if(gear){
    const gearUID=s.match.players[0].remainingMainDeck.find(card=>card.cardId==='test-gear').uid;
    const owner=s.match.players[0];
    const handUID=owner.hand[0].uid;
    s=commitDuelCommandMutationV2(s,d=>({match:{...d,
      players:d.players.map(p=>p.playerId===actor?{...p,
        hand:[...p.hand.filter(c=>c.uid!==handUID),p.remainingMainDeck.find(c=>c.uid===gearUID)],
        remainingMainDeck:[...p.remainingMainDeck.filter(c=>c.uid!==gearUID),p.hand[0]]}:p)},
      transitions:[{uid:gearUID,from:{kind:'main-deck',zonePlayerId:actor},
        to:{kind:'hand',zonePlayerId:actor}},{uid:handUID,
        from:{kind:'hand',zonePlayerId:actor},to:{kind:'main-deck',zonePlayerId:actor}}]})).session;
    s=commitDuelCommandMutationV2(s,d=>({match:{...d,
      players:d.players.map(p=>p.playerId===actor?{...p,hand:p.hand.filter(c=>c.uid!==gearUID)}:p),
      gears:[...d.gears,{uid:gearUID,controllerPlayerId:actor,locationId:base,
        readied:true,attachedToUID:uid}]},transitions:[{uid:gearUID,
      from:{kind:'hand',zonePlayerId:actor},to:{kind:'board-base',locationId:base}}]})).session;
  }
  return {s,uid,source:oracle(()=>({}),{...index(),printings:[...index().printings,
    {cardId:'test-gear',programReference:'test-only-whole-program:test-gear'}]})};
}
test('lethal candidates never use printed Might and await trusted evaluators and approval', () => {
  const {s,uid,source}=unitMain();
  const noEval=end(s,'alice',services(source));
  assert.equal(noEval.status,'pending');
  assert.equal(noEval.pending.step,'special-lethal');
  assert.equal(noEval.session.match.board.units.length,1);
  const evaluators={currentMight:()=>1,lethalDamageThreshold:()=>1};
  const pending=resumeEnd(noEval.session,noEval.pending.taskId,
    {status:'retry',matchId:s.match.matchId,turn:1,taskId:noEval.pending.taskId},
    services(source,{lethalEvaluators:evaluators}));
  assert.equal(pending.status,'pending');
  assert.equal(pending.session.match.board.units.length,1);
  const resolved=resumeEnd(pending.session,pending.pending.taskId,
    {status:'retry',matchId:s.match.matchId,turn:1,taskId:pending.pending.taskId},
    services(source,{lethalEvaluators:evaluators,
      approveLethal:plan=>({status:'approved',approvedUnitUIDs:plan.snapshots.map(u=>u.objectId)})}));
  assert.equal(resolved.status,'awaiting-turn-start',resolved.reason);
  assert.equal(resolved.session.match.board.units.length,0);
  assert.equal(resolved.session.match.players[0].trash.some(c=>c.uid===uid),true);
  assert.equal(resolved.session.match.provenance.transitions.at(-1).uid,uid);
  assert.equal(referenceDuelPhysicalCardV2(resolved.session.match,uid).zoneEpoch,2);
});
test('real depleted Main Deck opens Burn Out, prevents point one, and settles intervention', () => {
  let s=main(playing());
  for(let turn=2;turn<=12;turn++){
    s=next(s); s=main(s); assert.equal(s.match.frame.turnNumber,turn);
  }
  assert.equal(s.match.players[0].remainingMainDeck.length,0);
  s=next(s);
  const burnoutTurn=s.match.frame.turnNumber;
  const incomplete=start(s,services());
  assert.equal(incomplete.status,'pending');
  assert.equal(incomplete.pending.step,'burnout-first');
  assert.equal(incomplete.session.match.frame.phase,'draw');
  const taskId=incomplete.pending.taskId;
  const first=resumeStart(incomplete.session,taskId,
    {status:'retry',matchId:s.match.matchId,turn:burnoutTurn,taskId},
    services(oracle(),{firstBurnout:()=>({status:'prevented'})}));
  assert.equal(first.status,'pending');
  assert.equal(first.pending.step,'burnout-intervention');
  const settled=resumeStart(first.session,first.pending.taskId,
    {status:'retry',matchId:s.match.matchId,turn:burnoutTurn,taskId:first.pending.taskId},
    services(oracle(),{burnoutIntervention:()=>({status:'settled'})}));
  assert.equal(settled.status,'ended',settled.reason);
  assert.equal(settled.session.match.scoring.players.find(p=>p.playerId==='bob').points,8);
  assert.equal(settled.session.match.frame.phase,'ended');
});
test('attached Gear and active source survive lethal planning; unsupported pre-exit remains pending', () => {
  const {s,uid,source}=unitMain({gear:true});
  assert.equal(s.match.gears[0].attachedToUID,uid);
  const result=end(s,'alice',services(source,{lethalEvaluators:{currentMight:()=>1,
    lethalDamageThreshold:()=>1},approveLethal:()=>{throw Error('approval must not run');}}));
  assert.equal(result.status,'pending');
  assert.equal(result.pending.step,'special-lethal');
  assert.equal(result.session.match.board.units.some(u=>u.objectId===uid),true);
  assert.equal(result.session.match.gears[0].attachedToUID,uid);
});
test('handler evidence is not silently accepted as no-effect', () => {
  const s=playing(), before=JSON.stringify(s);
  const r=start(s,services(oracle(x=>x.source.kind==='legend'?{scope:'handlers-or-modifiers'}:{})));
  assert.equal(r.status,'pending'); assert.strictEqual(r.session.match,s.match);
  assert.equal(JSON.stringify(s),before);
});
test('provider throwing or returning foreign admission cannot change input bytes or ledger', () => {
  const s=playing(), bytes=JSON.stringify(s);
  const faulty=oracle(()=>{throw Error('failed');});
  assert.equal(start(s,services(faulty)).status,'pending');
  assert.equal(JSON.stringify(s),bytes);
  assert.throws(()=>commitDuelCommandMutationV2(structuredClone(s),d=>({match:d,transitions:[]})),
    /unadmitted/);
  assert.equal(JSON.stringify(s),bytes);
});
test('FEPR must be checked and a concrete handler result repeats cleanup', () => {
  let calls=0;
  const s=main(playing());
  const r=end(s,'alice',services(oracle(),{fepr:(m,taskId)=>{
    calls++;
    if(calls===1) return {status:'processed',match:{...m,
      scoring:{...m.scoring,players:m.scoring.players.map(p=>p.playerId==='bob'
        ?{...p,points:p.points+1}:p)}},transitions:[]};
    return {status:'none'};
  }}));
  assert.equal(r.status,'awaiting-turn-start',r.reason);
  assert.ok(calls>1);
  assert.equal(r.session.match.scoring.players.find(p=>p.playerId==='bob').points,1);
  assert.equal(r.session.match.frame.turnNumber,2);
  const noService=end(s,'alice',{sources:oracle()});
  assert.equal(noService.status,'pending');
  assert.equal(noService.pending.step,'special-fepr');
});
test('resolved handler executes exactly once before pending intrinsic phase task', () => {
  let count=0;
  const sources=oracle(r=>r.event==='awaken'&&r.source.kind==='legend'
    ?{scope:'handlers-or-modifiers'}:{});
  const s=playing(), r=start(s,services(sources,{resolveHandlers:({match:m})=>{
    count++;
    return {status:'applied',match:{...m,scoring:{...m.scoring,
      players:m.scoring.players.map(p=>p.playerId==='bob'?{...p,points:p.points+1}:p)}},transitions:[]};
  }}));
  assert.equal(r.status,'main',r.reason);
  assert.equal(count,1);
  assert.equal(r.session.match.scoring.players.find(p=>p.playerId==='bob').points,1);
});
test('Ending pending task accepts only exact current turn and retry; previous turn cannot block second', () => {
  let s=main(playing());
  const pending=end(s,'alice',services(oracle(x=>x.event==='ending'?{status:'unknown'}:{})));
  assert.equal(pending.status,'pending');
  const taskId=pending.pending.taskId;
  assert.equal(resumeEnd(pending.session,'old-id',{},services()).status,'rejected');
  const resumed=resumeEnd(pending.session,taskId,{status:'retry',matchId:s.match.matchId,turn:1,taskId},services());
  assert.equal(resumed.status,'awaiting-turn-start',resumed.reason);
  assert.equal(resumeEnd(resumed.session,taskId,{},services()).status,'rejected');
  s=main(resumed.session); assert.equal(s.match.frame.turnNumber,2);
});
