import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  unlink
} from "node:fs/promises";
import path from "node:path";
import {
  isJsonValue,
  isPlainRecord,
  type JsonObject
} from "@riftbound/replay-core/full-product";
import { DUEL_RULESET_ID, FOUNDATION_RULESET_ID, type RoomId } from "@riftbound/protocol";
import { GameRoom, type RoomArchive } from "./room.js";
import type { CardCatalogRuntime } from "./card-catalog.js";
import { PersistentRoomArchiveStore } from "./full-product/persistent-room-store.js";

/**
 * File-backed RoomStore. Room archives remain server-private. Each room is
 * stored under the SHA-256 of its roomId so client room ids cannot escape the
 * storage root.
 */
export class FileRoomStore {
  private readonly rooms = new Map<RoomId, GameRoom>();
  private readonly stores = new Map<RoomId, PersistentRoomArchiveStore>();
  private closed = false;
  private unavailableReason: string | null = null;

  constructor(
    private readonly directory: string,
    private readonly loadCatalog: () => Promise<CardCatalogRuntime>
  ) {}

  async create(room: GameRoom): Promise<void> {
    this.assertUsable();
    if (this.rooms.has(room.roomId)) {
      throw new Error(`Room ${room.roomId} already exists`);
    }

    try {
      const existing = await stat(this.archivePath(room.roomId));
      if (!existing.isFile()) {
        throw new Error(`Room ${room.roomId} has an invalid archive log`);
      }
      throw new Error(`Room ${room.roomId} already exists`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    this.rooms.set(room.roomId, room);
  }

  async get(roomId: RoomId): Promise<GameRoom | null> {
    this.assertUsable();
    const inProcess = this.rooms.get(roomId);
    if (inProcess) return inProcess;

    try {
      await stat(this.archivePath(roomId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }

    const store = this.storeFor(roomId);
    const archive = await store.load(roomId);
    if (archive === null) return null;
    if (!isPlainRecord(archive)) {
      throw new Error(`Room ${roomId} does not contain a JSON archive`);
    }

    const parsed = this.parseArchive(archive);
    if (parsed.roomId !== roomId) {
      throw new Error("Room archive does not match its storage directory");
    }
    const restored = await this.restoreRoom(parsed);
    this.rooms.set(roomId, restored);
    return restored;
  }

  async save(room: GameRoom): Promise<void> {
    this.assertUsable();
    const archive = room.exportArchive();
    const roundTripped = JSON.parse(JSON.stringify(archive)) as unknown;
    if (!isPlainRecord(roundTripped) || !isJsonValue(roundTripped)) {
      throw new Error("Room archive must be a JSON object");
    }

    const store = this.storeFor(room.roomId);
    try {
      await store.save(room.roomId, roundTripped as JsonObject);
      if (!this.rooms.has(room.roomId)) {
        this.rooms.set(room.roomId, room);
      }
    } catch (error) {
      // A failed durable write leaves an unknown on-disk tail. The underlying
      // FileEventStore is write-failed, so this instance cannot be reused.
      this.unavailableReason = error instanceof Error
        ? error.message
        : "The room archive write failed";
      await store.close();
      this.stores.delete(room.roomId);
      throw error;
    }
  }

  async remove(room: GameRoom): Promise<void> {
    if (this.closed) {
      throw new Error("The file room store is closed");
    }
    if (this.rooms.get(room.roomId) !== room) {
      throw new Error(`Room ${room.roomId} is not registered`);
    }

    const store = this.stores.get(room.roomId);
    if (store) {
      await store.close();
      this.stores.delete(room.roomId);
    }
    this.rooms.delete(room.roomId);

    if (this.unavailableReason !== null) return;

    const roomPath = await this.removableRoomPath(room.roomId);
    await rm(roomPath, { recursive: true, force: true });
  }

  count(): Promise<number> {
    return Promise.resolve(this.rooms.size);
  }

  async list(): Promise<readonly GameRoom[]> {
    this.assertUsable();
    await mkdir(this.directory, { recursive: true });
    await this.assertRootWritable();

    const entries = await readdir(this.directory, { withFileTypes: true });
    const roomsById = new Map(this.rooms);

    for (const entry of entries) {
      if (!entry.isDirectory() || !isHashDirectoryName(entry.name)) continue;

      const roomPath = path.join(this.directory, entry.name);
      const provisionalRoomId = await this.readArchiveRoomId(
        path.join(roomPath, "archive.log")
      );
      if (provisionalRoomId === null) continue;
      if (hashRoomId(provisionalRoomId) !== entry.name) {
        throw new Error("Room archive directory does not match its roomId");
      }

      const store = new PersistentRoomArchiveStore(roomPath);
      try {
        const archive = await store.load(provisionalRoomId);
        if (archive === null || !isPlainRecord(archive)) continue;

        const parsed = this.parseArchive(archive);
        if (parsed.roomId !== provisionalRoomId) {
          throw new Error("Room archive does not match its log event");
        }
        if (roomsById.has(parsed.roomId)) continue;
        roomsById.set(parsed.roomId, await this.restoreRoom(parsed));
      } finally {
        await store.close();
      }
    }

    this.rooms.clear();
    for (const [roomId, room] of roomsById) this.rooms.set(roomId, room);
    return [...roomsById.values()];
  }

  async close(): Promise<void> {
    this.closed = true;
    const failures: { roomId: RoomId; error: unknown }[] = [];
    for (const [roomId, store] of [...this.stores]) {
      try {
        await store.close();
        this.stores.delete(roomId);
      } catch (error) {
        failures.push({ roomId, error });
      }
    }
    const [firstFailure] = failures;
    if (failures.length === 1 && firstFailure) {
      throw firstFailure.error;
    }
    if (failures.length > 1) {
      const messages = failures.map(({ roomId, error }) => {
        const message = error instanceof Error ? error.message : String(error);
        return `${roomId}: ${message}`;
      });
      throw new Error(`Failed to close ${failures.length} room archive stores:
${messages.join("\n")}`);
    }
  }

  private async restoreRoom(archive: RoomArchive): Promise<GameRoom> {
    if (archive.rulesetId === FOUNDATION_RULESET_ID || archive.rulesetId === DUEL_RULESET_ID) {
      const catalog = await this.loadCatalog();
      return GameRoom.restore(archive, catalog);
    }
    return GameRoom.restore(archive);
  }

  private parseArchive(archive: Record<string, unknown>): RoomArchive {
    const parsed = JSON.parse(JSON.stringify(archive)) as RoomArchive;
    if (!isPlainRecord(parsed) || !isJsonValue(parsed)) {
      throw new Error("Room archive must be a JSON object");
    }
    return parsed;
  }

  private storeFor(roomId: RoomId): PersistentRoomArchiveStore {
    let store = this.stores.get(roomId);
    if (!store) {
      store = new PersistentRoomArchiveStore(this.roomPath(roomId));
      this.stores.set(roomId, store);
    }
    return store;
  }

  private roomPath(roomId: RoomId): string {
    if (typeof roomId !== "string" || roomId.length === 0) {
      throw new Error("roomId must be a non-empty string");
    }
    return path.join(this.directory, hashRoomId(roomId));
  }

  private archivePath(roomId: RoomId): string {
    return path.join(this.roomPath(roomId), "archive.log");
  }

  private async removableRoomPath(roomId: RoomId): Promise<string> {
    const root = path.resolve(this.directory);
    const roomPath = path.resolve(this.roomPath(roomId));
    const relative = path.relative(root, roomPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Refusing to remove a path outside the storage root");
    }

    const roomStats = await lstat(roomPath);
    if (roomStats.isSymbolicLink() || !roomStats.isDirectory()) {
      throw new Error("Refusing to remove a symbolic or non-directory room path");
    }

    const [realRoot, realRoom] = await Promise.all([
      realpath(root),
      realpath(roomPath)
    ]);
    const realRelative = path.relative(realRoot, realRoom);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      throw new Error("Refusing to remove a room path outside the storage root");
    }
    return roomPath;
  }

  private async assertRootWritable(): Promise<void> {
    const temporaryPath = path.join(
      this.directory,
      `.write-check-${randomUUID()}`
    );
    const handle = await open(temporaryPath, "wx");
    await handle.close();
    await unlink(temporaryPath);
  }

  /**
   * Read only the first newline-terminated log record. The durable helper then
   * reopens and checksum-validates the entire log, including damaged-tail
   * recovery; this value is provisional and never used to construct a room.
   */
  private async readArchiveRoomId(
    archiveLogPath: string
  ): Promise<string | null> {
    const log = await readFile(archiveLogPath);
    const newline = log.indexOf(0x0a);
    if (newline === -1) return null;

    const parsedLine = JSON.parse(
      log.subarray(0, newline).toString("utf8")
    ) as unknown;
    if (!isPlainRecord(parsedLine)) {
      throw new Error("Room archive log record must be an object");
    }
    const record = parsedLine.record;
    if (!isPlainRecord(record) || !Array.isArray(record.entries)) {
      throw new Error("Room archive log record has an invalid shape");
    }
    const event = record.entries.at(-1)?.event;
    if (!isPlainRecord(event) || typeof event.roomId !== "string") {
      throw new Error("Room archive event has an invalid roomId");
    }
    return event.roomId;
  }

  private assertUsable(): void {
    if (this.closed) {
      throw new Error("The file room store is closed");
    }
    if (this.unavailableReason !== null) {
      throw new Error(
        `The file room store is unavailable after a write failure: ${this.unavailableReason}`
      );
    }
  }
}

function hashRoomId(roomId: string): string {
  return createHash("sha256").update(roomId, "utf8").digest("hex");
}

function isHashDirectoryName(name: string): boolean {
  return /^[0-9a-f]{64}$/.test(name);
}
