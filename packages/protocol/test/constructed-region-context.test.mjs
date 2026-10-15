import test from 'node:test';
import assert from 'node:assert/strict';
import { isConstructedRegionSelection, isConstructedRegionContext, isConstructedEventDate,
  isClientMessage, isRoomView, DUEL_RULESET_ID } from '../dist/index.js';
const selection = {regionCode:'CN',eventDate:'2026-10-14'};
const context = {...selection,policyVersion:'regional-constructed-v1',scheduleVersion:'source-v1',scheduleDigest:`sha256:${'a'.repeat(64)}`};
test('explicit local date and region have strict public DATA guards', () => {
  assert.equal(isConstructedRegionSelection(selection),true);
  assert.equal(isConstructedRegionSelection({...selection,regionCode:'ROW'}),true);
  assert.equal(isConstructedEventDate('2024-02-29'),true);
  for(const d of ['2026-02-29','2026-02-30','0000-01-01','2026-10-14T00:00:00Z']) assert.equal(isConstructedEventDate(d),false);
  assert.equal(isConstructedRegionContext(context),true);
  assert.equal(isConstructedRegionContext({...context,schedule:[]}),false);
  let touched=0; const getter={...selection}; Object.defineProperty(getter,'regionCode',{get(){touched++;return 'CN'},enumerable:true});
  assert.equal(isConstructedRegionSelection(getter),false);assert.equal(touched,0);
});
test('create-room optionally carries selection while old packets retain their contract', () => {
  const old={type:'create-room',requestId:'r',playerName:'Alice',rulesetId:DUEL_RULESET_ID};
  assert.equal(isClientMessage(old),true);
  assert.equal(isClientMessage({...old,constructedRegion:selection}),true);
  assert.equal(isClientMessage({...old,constructedRegion:context}),false);
});

test('room region projection includes only pinned public context and accepts old room views', () => {
  const room={roomId:'r',status:'waiting',rulesetId:DUEL_RULESET_ID,version:0,roomVersion:2,roomEventSeq:1,
    players:[{id:'player-1',name:'Alice',connected:true,ready:false,deckSubmitted:false}]};
  assert.equal(isRoomView(room),true);
  assert.equal(isRoomView({...room,constructedRegion:context}),true);
  assert.equal(isRoomView({...room,constructedRegion:{...context,schedule:[]}}),false);
});
