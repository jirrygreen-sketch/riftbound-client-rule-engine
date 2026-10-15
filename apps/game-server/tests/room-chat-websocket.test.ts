import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  type ClientSession,
  type ClientToServerMessage,
  type ServerToClientMessage
} from "@riftbound/protocol";
import { createGameServer, type GameServer, type GameServerOptions } from "../src/server.js";
import { InMemoryRoomStore } from "../src/room-store.js";
import { FileRoomStore } from "../src/file-room-store.js";
import type { GameRoom } from "../src/room.js";

type MessageByType<T extends ServerToClientMessage["type"]> =
  Extract<ServerToClientMessage, { type: T }>;

class TestClient {
  private readonly queued: ServerToClientMessage[] = [];
  private readonly waiters = new Set<() => void>();

  private constructor(readonly socket: WebSocket) {
    socket.on("message", raw => {
      this.queued.push(JSON.parse(String(raw)) as ServerToClientMessage);
      for (const wake of this.waiters) wake();
    });
  }

  static async connect(url: string): Promise<TestClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return new TestClient(socket);
  }

  send(message: ClientToServerMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.socket.close();
  }

  hasChat(seq: number): boolean {
    return this.queued.some(message => message.type === "room-chat" &&
      message.messages.some(row => row.seq === seq));
  }

  async waitFor<T extends ServerToClientMessage["type"]>(
    type: T,
    predicate: (message: MessageByType<T>) => boolean,
    label: string
  ): Promise<MessageByType<T>> {
    const deadline = Date.now() + 5_000;
    while (true) {
      const index = this.queued.findIndex(
        (message): message is MessageByType<T> =>
          message.type === type && predicate(message as MessageByType<T>)
      );
      if (index !== -1) return this.queued.splice(index, 1)[0] as MessageByType<T>;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(this.queued)}`);
      }
      await new Promise<void>(resolve => {
        const wake = () => {
          this.waiters.delete(wake);
          resolve();
        };
        this.waiters.add(wake);
        setTimeout(wake, 10);
      });
    }
  }
}

const servers: GameServer[] = [];
const clients: TestClient[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const server of servers.splice(0)) await server.stop();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function startServer(options: Partial<GameServerOptions> = {}): Promise<{ server: GameServer; url: string }> {
  const server = createGameServer({
    host: "127.0.0.1",
    port: 0,
    roomIdFactory: () => "chat-ws-room",
    ...options
  });
  servers.push(server);
  await server.start();
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
  return { server, url: `ws://127.0.0.1:${address.port}/ws` };
}

async function connect(url: string): Promise<TestClient> {
  const client = await TestClient.connect(url);
  clients.push(client);
  client.send({ type: "hello", protocolVersion: PROTOCOL_VERSION });
  await client.waitFor("welcome", message => message.type === "welcome" && !message.session, "welcome");
  return client;
}

async function createRoom(client: TestClient): Promise<ClientSession> {
  client.send({ type: "create-room", requestId: "create", playerName: "Alice" });
  await client.waitFor("request-result", message => message.requestId === "create", "create receipt");
  const welcome = await client.waitFor("welcome", message => message.type === "welcome" && !!message.session, "create session");
  return welcome.session!;
}

async function joinRoom(client: TestClient, roomId: string): Promise<ClientSession> {
  client.send({ type: "join-room", requestId: "join", roomId, playerName: "Bob" });
  await client.waitFor("request-result", message => message.requestId === "join", "join receipt");
  const welcome = await client.waitFor("welcome", message => message.type === "welcome" && !!message.session, "join session");
  return welcome.session!;
}

describe("authenticated room chat websocket", () => {
  it("persists, resumes, and fills history without touching room clocks", async () => {
    const { url, server } = await startServer();
    const alice = await connect(url);
    const bob = await connect(url);
    const aliceSession = await createRoom(alice);
    const bobSession = await joinRoom(bob, aliceSession.roomId);
    const room = server.rooms.get(aliceSession.roomId)!;
    const version = room.currentRoomVersion;
    const roomEventSeq = room.currentRoomEventSeq;

    alice.send({ type: "room-chat-send", requestId: "chat-1", messageId: "m1", text: "first" });
    await alice.waitFor("room-chat-accepted", message => message.requestId === "chat-1" && message.seq === 1, "chat receipt");
    await bob.waitFor("room-chat", message => message.nextChatSeq === 1, "Bob first chat");
    expect(room.currentRoomVersion).toBe(version);
    expect(room.currentRoomEventSeq).toBe(roomEventSeq);

    bob.close();
    await new Promise(resolve => setTimeout(resolve, 30));
    alice.send({ type: "room-chat-send", requestId: "chat-2", messageId: "m2", text: "during disconnect" });
    await alice.waitFor("room-chat-accepted", message => message.requestId === "chat-2" && message.seq === 2, "second receipt");
    alice.send({ type: "room-chat-send", requestId: "chat-3", messageId: "m3", text: "also missed" });
    await alice.waitFor("room-chat-accepted", message => message.requestId === "chat-3" && message.seq === 3, "third receipt");

    const resumed = await TestClient.connect(url);
    clients.push(resumed);
    resumed.send({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      roomId: bobSession.roomId,
      resumeToken: bobSession.resumeToken
    });
    await resumed.waitFor("welcome", message => message.type === "welcome" && message.resumed === true, "resume welcome");
    const resumeRoomVersion = room.currentRoomVersion;
    const resumeRoomEventSeq = room.currentRoomEventSeq;
    resumed.send({ type: "room-chat-sync", requestId: "sync-1", afterChatSeq: 1 });
    const receipt = await resumed.waitFor("request-result", message => message.requestId === "sync-1", "chat sync receipt");
    expect(receipt).toMatchObject({ ok: true });
    expect(receipt).not.toHaveProperty("roomVersion");
    const history = await resumed.waitFor("room-chat", message => message.afterChatSeq === 1, "chat history");
    expect(history.messages.map(message => message.seq)).toEqual([2, 3]);
    expect(room.currentChatSeq).toBe(3);
    expect(room.currentRoomVersion).toBe(resumeRoomVersion);
    expect(room.currentRoomEventSeq).toBe(resumeRoomEventSeq);
  });
});

describe('chat durable commit and restart', () => {
  it('rolls back a failed save without an ACK or phantom peer broadcast', async () => {
    class FailingStore extends InMemoryRoomStore {
      failChat = false;
      override save(room: GameRoom): Promise<void> {
        if (this.failChat && room.currentChatSeq > 0) {
          this.failChat = false;
          return Promise.reject(new Error('controlled chat persistence failure'));
        }
        return super.save(room);
      }
    }
    const store = new FailingStore();
    const {url,server} = await startServer({roomStore:store});
    const alice = await connect(url);const bob = await connect(url);
    const session = await createRoom(alice);await joinRoom(bob,session.roomId);
    const room = server.rooms.get(session.roomId)!;
    const clocks = [room.currentRoomVersion,room.currentRoomEventSeq];
    store.failChat = true;
    alice.send({type:'room-chat-send',requestId:'failed-chat',messageId:'stable-id',text:'saved once'});
    await alice.waitFor('error',message=>message.requestId==='failed-chat','failed persistence response');
    expect(room.currentChatSeq).toBe(0);expect(bob.hasChat(1)).toBe(false);
    expect([room.currentRoomVersion,room.currentRoomEventSeq]).toEqual(clocks);
    alice.send({type:'room-chat-send',requestId:'retry-chat',messageId:'stable-id',text:'saved once'});
    const receipt=await alice.waitFor('room-chat-accepted',message=>message.requestId==='retry-chat','retry receipt');
    expect(receipt).toMatchObject({seq:1,duplicate:false});
    await bob.waitFor('room-chat',message=>message.nextChatSeq===1,'committed peer message');
    expect(room.chatMessages().map(message=>message.text)).toEqual(['saved once']);
  });

  it('restores file-backed chat and original duplicate sequence after server restart', async () => {
    const directory = await mkdtemp(path.join(tmpdir(),'riftbound-chat-restart-'));
    directories.push(directory);
    const catalogNotUsed = async (): Promise<never> => {throw new Error('Synthetic chat must not load a card catalog');};
    const original = await startServer({roomStore:new FileRoomStore(directory,catalogNotUsed)});
    const alice=await connect(original.url);const bob=await connect(original.url);
    const session=await createRoom(alice);await joinRoom(bob,session.roomId);
    alice.send({type:'room-chat-send',requestId:'before-restart',messageId:'durable-id',text:'persistent history'});
    await alice.waitFor('room-chat-accepted',message=>message.requestId==='before-restart','durable receipt');
    await bob.waitFor('room-chat',message=>message.nextChatSeq===1,'durable peer message');
    for (const client of clients.splice(0)) client.close();
    await original.server.stop();servers.splice(servers.indexOf(original.server),1);
    const replacement=await startServer({roomStore:new FileRoomStore(directory,catalogNotUsed)});
    const restored=await TestClient.connect(replacement.url);clients.push(restored);
    restored.send({type:'hello',protocolVersion:PROTOCOL_VERSION,roomId:session.roomId,resumeToken:session.resumeToken});
    await restored.waitFor('welcome',message=>message.resumed===true,'restart authenticated resume');
    restored.send({type:'room-chat-sync',requestId:'restart-sync',afterChatSeq:0});
    const history=await restored.waitFor('room-chat',message=>message.nextChatSeq===1,'restored history');
    expect(history.messages.map(message=>message.text)).toEqual(['persistent history']);
    restored.send({type:'room-chat-send',requestId:'after-restart',messageId:'durable-id',text:'persistent history'});
    const duplicate=await restored.waitFor('room-chat-accepted',message=>message.requestId==='after-restart','restored duplicate');
    expect(duplicate).toMatchObject({seq:1,duplicate:true});
    expect(replacement.server.rooms.get(session.roomId)?.currentChatSeq).toBe(1);
  });
});
