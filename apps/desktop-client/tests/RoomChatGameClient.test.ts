import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { PROTOCOL_VERSION, type RoomChatMessage } from '@riftbound/protocol';
import { GameClient } from '../src/net/GameClient';
class Socket {
 static OPEN=1; static CLOSED=3; static instances:Socket[]=[];
 readyState=0; sent:Record<string,unknown>[]=[];
 listeners=new Map<string,((event:{data?:string})=>void)[]>();
 constructor(_url:string){Socket.instances.push(this);}
 addEventListener(type:string,fn:(event:{data?:string})=>void){this.listeners.set(type,[...(this.listeners.get(type)??[]),fn]);}
 send(raw:string){this.sent.push(JSON.parse(raw));}
 close(){this.readyState=3;}
 emit(type:string,data?:unknown){for(const fn of this.listeners.get(type)??[])fn({data:data===undefined?undefined:JSON.stringify(data)});}
 open(){this.readyState=1;this.emit('open');}
 receive(data:unknown){this.emit('message',data);}
 serverClose(){this.readyState=3;this.emit('close');}
}
const session={roomId:'room-1',playerId:'p1',resumeToken:'private'};
const one:RoomChatMessage={seq:1,messageId:'server-1',playerId:'p2',playerName:'玩家 B',text:'你好'};
let client:GameClient;
let messages:readonly RoomChatMessage[]=[];
let pending=false;
let chatError:string|null=null;
function setup(){
 client=new GameClient({onStatus(){},onSession(){},onProjection(){},onError(){},onRoom(){},onHandshake(){},
 onChatMessages:next=>{messages=next;},onChatPending:next=>{pending=next;},onChatError:next=>{chatError=next;}});
 client.connect('ws://127.0.0.1:8787/ws');
 const socket=Socket.instances[0]!;socket.open();socket.receive({type:'welcome',protocolVersion:PROTOCOL_VERSION});
 client.createRoom('玩家 A');socket.receive({type:'welcome',protocolVersion:PROTOCOL_VERSION,session});return socket;
}
beforeEach(()=>{vi.useFakeTimers();Socket.instances=[];messages=[];pending=false;chatError=null;
 const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)});
 vi.stubGlobal('WebSocket',Socket);vi.stubGlobal('crypto',{randomUUID:()=> 'message-client-1'});
});
afterEach(()=>{client?.disconnect();vi.useRealTimers();vi.unstubAllGlobals();});
describe('real GameClient room and match chat transport',()=>{
 it('syncs after authenticated welcome, sends actor-free text and waits for server echo',()=>{
 const socket=setup();expect(socket.sent.at(-1)).toMatchObject({type:'room-chat-sync',afterChatSeq:0});
 expect(client.sendChat('  你好  ')).toBe(true);const packet=socket.sent.at(-1)!;
 expect(packet).toMatchObject({type:'room-chat-send',text:'你好'});expect(packet).not.toHaveProperty('playerId');expect(messages).toEqual([]);expect(pending).toBe(true);
 socket.receive({type:'room-chat-accepted',roomId:'wrong',requestId:packet.requestId,messageId:packet.messageId,seq:1,duplicate:false});expect(pending).toBe(true);
 socket.receive({type:'room-chat-accepted',roomId:session.roomId,requestId:packet.requestId,messageId:packet.messageId,seq:1,duplicate:false});expect(pending).toBe(false);expect(messages).toEqual([]);
 });
 it('merges contiguous overlap and ignores wrong rooms without duplicating rows',()=>{
 const socket=setup();const history={type:'room-chat',roomId:session.roomId,afterChatSeq:0,nextChatSeq:1,messages:[one]};
 socket.receive({...history,roomId:'wrong'});expect(messages).toEqual([]);
 socket.receive(history);socket.receive(history);expect(messages).toEqual([one]);
 socket.receive({type:'room-chat',roomId:session.roomId,afterChatSeq:1,nextChatSeq:2,messages:[{...one,seq:2,messageId:'server-2',playerId:'p1'}]});expect(messages).toHaveLength(2);
 socket.receive({...history,messages:[{...one,text:'tampered'}]});expect(messages[0]?.text).toBe('你好');expect(chatError).toContain('校验失败');
 });
 it('recovers a gap by syncing its own confirmed cursor',()=>{
 const socket=setup();socket.receive({type:'room-chat',roomId:session.roomId,afterChatSeq:1,nextChatSeq:2,messages:[{...one,seq:2}]});
 expect(messages).toEqual([]);expect(socket.sent.at(-1)).toMatchObject({type:'room-chat-sync',afterChatSeq:0});
 });
 it('retries a timed-out send with the same message identity and no local echo',()=>{
 const socket=setup();client.sendChat('重试');const first=socket.sent.at(-1)!;
 vi.advanceTimersByTime(10000);const second=socket.sent.at(-1)!;
 expect(second).toMatchObject({type:'room-chat-send',messageId:first.messageId,text:first.text});expect(second.requestId).not.toEqual(first.requestId);expect(messages).toEqual([]);
 socket.receive({type:'room-chat-accepted',roomId:session.roomId,requestId:first.requestId,messageId:first.messageId,seq:1,duplicate:false});expect(pending).toBe(true);
 socket.receive({type:'room-chat-accepted',roomId:session.roomId,requestId:second.requestId,messageId:first.messageId,seq:1,duplicate:true});expect(pending).toBe(false);
 });
 it('resumes chat independently of game commands with a confirmed history cursor',()=>{
 const socket=setup();socket.receive({type:'room-chat',roomId:session.roomId,afterChatSeq:0,nextChatSeq:1,messages:[one]});
 client.sendChat('断线前');const first=socket.sent.at(-1)!;socket.serverClose();vi.advanceTimersByTime(1000);
 const replacement=Socket.instances[1]!;replacement.open();replacement.receive({type:'welcome',protocolVersion:PROTOCOL_VERSION,session,resumed:true});
 expect(replacement.sent).toContainEqual(expect.objectContaining({type:'room-chat-sync',afterChatSeq:1}));
 expect(replacement.sent.at(-1)).toMatchObject({type:'room-chat-send',messageId:first.messageId,text:'断线前'});
 socket.receive({type:'room-chat',roomId:session.roomId,afterChatSeq:1,nextChatSeq:2,messages:[{...one,seq:2}]});expect(messages).toHaveLength(1);
 });
 it('leaves the session, clears chat, and rejects empty or unconnected sends',()=>{
 const socket=setup();expect(client.sendChat(' ')).toBe(false);expect(client.sendChat('x'.repeat(501))).toBe(false);
 socket.receive({type:'room-chat',roomId:session.roomId,afterChatSeq:0,nextChatSeq:1,messages:[one]});client.leaveSession();
 expect(messages).toEqual([]);expect(client.sendChat('退出之后')).toBe(false);expect(localStorage.getItem('riftbound.desktop-client.session')).toBeNull();
 });
});
