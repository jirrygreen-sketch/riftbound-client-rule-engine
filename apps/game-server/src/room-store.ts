import type { RoomId, RoomPlayer, RoomView } from "@riftbound/protocol";
import type { GameRoom } from "./room.js";

/**
 * Persistence boundary for a room. The default implementation is an in-memory
 * map; a database-backed implementation can replace it without changing the
 * WebSocket workflow.
 */
export interface RoomStore {
  create(room: GameRoom): Promise<void>;
  get(roomId: RoomId): Promise<GameRoom | null>;
  remove(room: GameRoom): Promise<void>;
  count(): Promise<number>;
}

export class InMemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<RoomId, GameRoom>();

  create(room: GameRoom): Promise<void> {
    if (this.rooms.has(room.roomId)) {
      return Promise.reject(new Error(`Room ${room.roomId} already exists`));
    }
    this.rooms.set(room.roomId, room);
    return Promise.resolve();
  }

  get(roomId: RoomId): Promise<GameRoom | null> {
    return Promise.resolve(this.rooms.get(roomId) ?? null);
  }

  remove(room: GameRoom): Promise<void> {
    this.rooms.delete(room.roomId);
    return Promise.resolve();
  }

  count(): Promise<number> {
    return Promise.resolve(this.rooms.size);
  }
}

export function roomStoreView(store: {
  entries(): IterableIterator<readonly [RoomId, GameRoom]>;
}): readonly RoomView[] {
  return [...store.entries()].map(([, room]) => room.roomView());
}

export function roomPlayersView(players: readonly RoomPlayer[]): readonly RoomPlayer[] {
  return players.map(player => ({ ...player }));
}
