import test from 'node:test';
import assert from 'node:assert/strict';
import { isClientMessage, isServerMessage, isRoomChatMessage } from '../dist/index.js';
const message={seq:1,messageId:'message-1',playerId:'player-1',playerName:'玩家 A',text:'你好 <script>'};
test('room chat wire validates exact actor-free commands and contiguous history',()=>{
 assert.equal(isClientMessage({type:'room-chat-send',requestId:'request-1',messageId:'message-1',text:'你好'}),true);
 assert.equal(isClientMessage({type:'room-chat-sync',requestId:'request-2',afterChatSeq:0}),true);
 assert.equal(isServerMessage({type:'room-chat',roomId:'room-1',afterChatSeq:0,nextChatSeq:1,messages:[message]}),true);
 assert.equal(isServerMessage({type:'room-chat-accepted',roomId:'room-1',requestId:'request-1',messageId:'message-1',seq:1,duplicate:false}),true);
});
test('chat rejects spoofed actor, excess fields, empty/long/control text and gaps',()=>{
 const send={type:'room-chat-send',requestId:'r',messageId:'m',text:'你好'};
 for(const text of ['', ' ', ' 你好', 'x'.repeat(501), '\u0000']) assert.equal(isClientMessage({...send,text}),false);
 assert.equal(isClientMessage({...send,playerId:'player-2'}),false);
 assert.equal(isRoomChatMessage({...message,resumeToken:'secret'}),false);
 assert.equal(isServerMessage({type:'room-chat',roomId:'r',afterChatSeq:0,nextChatSeq:2,messages:[message]}),false);
 assert.equal(isServerMessage({type:'room-chat',roomId:'r',afterChatSeq:0,nextChatSeq:1,messages:[{...message,seq:2}]}),false);
});
test('chat boundary rejects getters without invoking them',()=>{
 let reads=0;
 const payload={type:'room-chat-send',requestId:'r',messageId:'m',get text(){reads++;return '你好';}};
 assert.equal(isClientMessage(payload),false);assert.equal(reads,0);
 const response={type:'room-chat',roomId:'r',afterChatSeq:0,nextChatSeq:1,messages:[{...message,get text(){reads++;return '你好';}}]};
 assert.equal(isServerMessage(response),false);assert.equal(reads,0);
});
