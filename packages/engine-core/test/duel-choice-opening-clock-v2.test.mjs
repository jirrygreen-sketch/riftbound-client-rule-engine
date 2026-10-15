import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDuelCommandSessionV2,
  applyDuelResourceCommandV2,
  adoptAdmittedDuelPlayingSessionV2,
  commitDuelChoiceOpeningEventV2, commitDuelCommandMutationV2,
} from '../dist/duel/canonical-session-v2.js';
import {
  commitDuelPlayingMutationV2,
  inspectDuelNativeCommitPathV2,
} from '../dist/duel/core-v2.js';
import {withDuelPlayingV2SemanticEventClock} from '../dist/duel/canonical-transaction.js';

const seats = ['alice', 'bob'].map(playerId => ({
  playerId,
  mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-main-${i}`, cardId: `print-main-${i}` })),
  champion: { uid: `${playerId}-champion`, cardId: 'print-champion' },
  legend: { uid: `${playerId}-legend`, cardId: 'print-legend' },
  runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`, cardId: `print-rune-${i}`,
    domain: i % 2 === 0 ? 'Fury' : 'Calm' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`, cardId: `print-field-${i}` })),
}));
const metadata = { matchId: 'choice-opening-clock-v2', dataVersion: 'catalog-v2', catalogDigest: 'sha256:test',
  roster: seats.map(s => ({ playerId: s.playerId, displayName: s.playerId })) };
const types = cardId => cardId === 'print-champion' ? 'Champion'
  : cardId === 'print-legend' ? 'Legend'
    : cardId.startsWith('print-rune-') ? 'Rune'
      : cardId.startsWith('print-field-') ? 'Battlefield' : 'Unit';
const create = () => createDuelCommandSessionV2(seats, metadata, () => 0, types);
// Mechanism fixture: trusted Core setup and explicit Main admission; not a public match.
function mainSession() {
  let session = create();
  session = applyDuelResourceCommandV2(session, 'alice',
    { commandId: 'mulligan-a', expectedVersion: session.match.stateVersion,
      command: { type: 'mulligan', selectedUIDs: [] } }, { randomIndex: () => 0 }).session;
  session = applyDuelResourceCommandV2(session, 'bob',
    { commandId: 'mulligan-b', expectedVersion: session.match.stateVersion,
      command: { type: 'mulligan', selectedUIDs: [] } }, { randomIndex: () => 0 }).session;
  const match = commitDuelPlayingMutationV2(session.match, draft => ({ match: { ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates)
      .map(([uid, old]) => [uid, { ...old, readiness: 'ready' }])),
    frame: { ...draft.frame, phase: 'main', priorityPlayerId: 'alice', stateOpen: true } }, transitions: [] }));
  return adoptAdmittedDuelPlayingSessionV2(match);
}
test('choice opening allocates one native clock while preserving carriers and rejects reuse', () => {
  const session = mainSession();
  const match = session.match;
  const target = match.players.find(player => player.playerId === 'alice').hand[0];
  const carriers = JSON.stringify({ board: match.board, resources: match.resources, players: match.players,
    scoring: match.scoring, physicalCardsByUID: match.physicalCardsByUID, frame: match.frame });
  const result = commitDuelChoiceOpeningEventV2(session, {
    actor: 'alice', cardUID: target.uid, commandId: 'choice-event-1', expectedVersion: match.stateVersion,
  });
  assert.equal(result.persistRequired, true);
  assert.equal(result.session.match.stateVersion, match.stateVersion + 1);
  assert.equal(result.session.match.eventSeq, match.eventSeq + 1);
  assert.equal(JSON.stringify({ board: result.session.match.board, resources: result.session.match.resources,
    players: result.session.match.players, scoring: result.session.match.scoring,
    physicalCardsByUID: result.session.match.physicalCardsByUID, frame: result.session.match.frame }), carriers);
  assert.equal(inspectDuelNativeCommitPathV2(match, result.session.match).length, 1);
  assert.throws(() => commitDuelChoiceOpeningEventV2(session, {
    actor: 'alice', cardUID: target.uid, commandId: 'choice-event-1', expectedVersion: match.stateVersion,
  }), /already consumed/);
  assert.throws(() => commitDuelChoiceOpeningEventV2(session, {
    actor: 'bob', cardUID: target.uid, commandId: 'choice-event-foreign', expectedVersion: match.stateVersion,
  }), /current Main owner|current hand/);
  assert.throws(() => commitDuelChoiceOpeningEventV2(structuredClone(session), {
    actor: 'alice', cardUID: target.uid, commandId: 'choice-event-clone', expectedVersion: match.stateVersion,
  }), /unadmitted/);
});

test('each new event advances once; ordinary no-op and conflicting event identity stay unchanged', () => {
  const session = mainSession(); const match = session.match;
  const cards = match.players.find(p => p.playerId === 'alice').hand;
  assert.equal(commitDuelCommandMutationV2(session, draft => ({match:draft,transitions:[]})).session, session);
  const first = commitDuelChoiceOpeningEventV2(session, {actor:'alice',cardUID:cards[0].uid,commandId:'one',expectedVersion:match.stateVersion});
  assert.throws(() => commitDuelChoiceOpeningEventV2(first.session,{actor:'alice',cardUID:cards[1].uid,commandId:'one',expectedVersion:first.session.match.stateVersion}), /already consumed/);
  const second=commitDuelChoiceOpeningEventV2(first.session,{actor:'alice',cardUID:cards[1].uid,commandId:'two',expectedVersion:first.session.match.stateVersion});
  assert.equal(second.session.match.stateVersion,match.stateVersion+2);
  assert.equal(inspectDuelNativeCommitPathV2(match,second.session.match).length,2);
  assert.deepEqual(second.session.match.players,match.players);
  assert.equal(Object.hasOwn(second.session.match,'chainCards'),Object.hasOwn(match,'chainCards'));
});

test('choice event rejects accessors, extra fields, stale versions and non-hand sources before mutation', () => {
  const session=mainSession(); const m=session.match;const uid=m.players[0].hand[0].uid;
  const good={actor:'alice',cardUID:uid,commandId:'valid',expectedVersion:m.stateVersion};
  let accessed=0;
  assert.throws(()=>commitDuelChoiceOpeningEventV2(session,{...good,get actor(){accessed++;return 'alice';}}), /accessor|keys/);
  assert.equal(accessed,0);
  assert.throws(()=>commitDuelChoiceOpeningEventV2(session,{...good,extra:true}), /keys/);
  assert.throws(()=>commitDuelChoiceOpeningEventV2(session,{...good,expectedVersion:m.stateVersion-1}), /version/);
  assert.throws(()=>commitDuelChoiceOpeningEventV2(session,{...good,cardUID:m.players[0].remainingMainDeck[0].uid}), /current hand/);
  assert.throws(()=>commitDuelChoiceOpeningEventV2(session,{...good,actor:'bob'}), /Main owner/);
  assert.equal(commitDuelCommandMutationV2(session,draft=>({match:draft,transitions:[]})).session,session);
  assert.equal(commitDuelChoiceOpeningEventV2(session,good).session.match.stateVersion,m.stateVersion+1);
});

test('swallowed semantic reentry poisons its outer event and cleanup preserves later no-op behavior', () => {
  const session=mainSession();const before=session.match;
  assert.throws(()=>withDuelPlayingV2SemanticEventClock(before,()=>{
    try {withDuelPlayingV2SemanticEventClock(before,()=>null);} catch {}
    return commitDuelCommandMutationV2(session,draft=>({match:draft,transitions:[]}));
  }), /poisoned|mismatch/);
  assert.throws(()=>withDuelPlayingV2SemanticEventClock(before,()=>{throw new Error('failed before commit');}), /failed before commit/);
  const foreign=mainSession();
  assert.throws(()=>withDuelPlayingV2SemanticEventClock(before,()=>{
    try {commitDuelCommandMutationV2(foreign,draft=>({match:draft,transitions:[]}));} catch {}
    return commitDuelCommandMutationV2(session,draft=>({match:draft,transitions:[]}));
  }), /poisoned|mismatch/);
  assert.equal(commitDuelCommandMutationV2(session,draft=>({match:draft,transitions:[]})).session,session);
  const target=before.players[0].hand[0];
  assert.equal(commitDuelChoiceOpeningEventV2(session,{actor:'alice',cardUID:target.uid,commandId:'after-failure',expectedVersion:before.stateVersion}).session.match.stateVersion,before.stateVersion+1);
});
