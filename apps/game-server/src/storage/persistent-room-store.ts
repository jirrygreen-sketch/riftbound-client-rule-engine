import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  FileEventStore,
  isJsonValue,
  isPlainRecord,
  type JsonObject,
  type OpenedFileEventStore
} from "@riftbound/replay-core/full-product";

export interface PersistentRoomArchiveEvent {
  readonly type: "room-archive";
  readonly roomId: string;
  readonly archive: JsonObject;
  readonly [key: string]: JsonObject[string];
}

export interface PersistentRoomArchiveSnapshot {
  readonly archive: JsonObject | null;
  readonly [key: string]: JsonObject[string];
}

/**
 * One durable archive record in the private append-only history. `archiveSeq`
 * is the FileEventStore log sequence (1-based, contiguous), not a game or room
 * event sequence.
 */
export interface PersistentRoomArchiveRecord {
  readonly archiveSeq: number;
  readonly archive: JsonObject;
}

/**
 * An ordered, paginated window over the private room-archive history. The
 * archive payloads are detached clones; callers may mutate them freely without
 * affecting this store's cached log or the `load` tail.
 */
export interface PersistentRoomArchivePage {
  readonly archives: readonly PersistentRoomArchiveRecord[];
  readonly hasMore: boolean;
  readonly nextCursor: number;
}

const DEFAULT_ARCHIVE_READ_LIMIT = 1000;

type ArchiveEventStore = FileEventStore<
  PersistentRoomArchiveEvent,
  PersistentRoomArchiveSnapshot
>;

function requireSafeInteger(
  value: unknown,
  field: string,
  minimum: number
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(
      `${field} must be a safe integer greater than or equal to ${minimum}`
    );
  }
  return value;
}

/**
 * Revalidates one log event as a room-archive event for the requested room.
 * The durable codec proves integrity against accidental corruption, not against
 * a full rewrite of the private log; this shape/room check therefore rejects
 * rather than silently skips foreign, mistyped, or archive-less records.
 */
function requireRoomArchiveEvent(
  value: unknown,
  roomId: string,
  archiveSeq: number
): JsonObject {
  if (!isPlainRecord(value)) {
    throw new Error(`archive log event ${archiveSeq} must be a JSON object`);
  }
  if (value.type !== "room-archive") {
    throw new Error(
      `archive log event ${archiveSeq} is not a room-archive event`
    );
  }
  if (value.roomId !== roomId) {
    throw new Error("The archive log belongs to another room");
  }
  const archive = value.archive;
  if (!isPlainRecord(archive) || !isJsonValue(archive)) {
    throw new Error(
      `archive log event ${archiveSeq} does not contain a JSON archive`
    );
  }
  return archive as JsonObject;
}

function detachArchive(archive: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(archive)) as JsonObject;
}

/**
 * Opaque durable archive storage. GameRoom owns the archive schema and state
 * restore semantics; this helper guarantees ordered checksummed writes and
 * recovery from a damaged final log record.
 */
export class PersistentRoomArchiveStore {
  private store: ArchiveEventStore | null = null;
  private opened: OpenedFileEventStore | null = null;
  private roomId: string | null = null;

  constructor(private readonly directory: string) {}

  get recovery(): OpenedFileEventStore {
    if (!this.opened) {
      throw new Error("The archive store has not been opened");
    }
    return this.opened;
  }

  async load(roomId: string): Promise<unknown | null> {
    const store = await this.openStore(roomId);
    if (store.headEventSeq === 0) return null;

    const window = await store.readEvents(0, store.headEventSeq);
    const persisted = window.events.at(-1);
    if (!persisted) return null;
    if (persisted.event.roomId !== roomId) {
      throw new Error("The archive log belongs to another room");
    }
    return persisted.event.archive;
  }

  async save(roomId: string, archive: JsonObject): Promise<void> {
    const store = await this.openStore(roomId);
    if (!isPlainRecord(archive) || !isJsonValue(archive)) {
      throw new Error("Room archive must be a JSON object");
    }
    const outcome = await store.appendEvents({
      events: [{
        eventSeq: store.headEventSeq + 1,
        event: {
          type: "room-archive",
          roomId,
          archive
        }
      }]
    });
    if (outcome.events.length !== 1) {
      throw new Error("The durable archive write did not persist an event");
    }

    // appendEvents returns only after its fsync. The room archive log is the
    // sole durability receipt; no snapshot cache is needed.
  }

  /**
   * Read the private append-only archive history for the bound room in log
   * order. This is a strictly read-only seal over `FileEventStore.readEvents`:
   * it appends nothing, mints no mutation/version/ACK, and is never exposed on
   * the HTTP or WebSocket surface. `afterArchiveSeq` is exclusive; pass the
   * previous page's `nextCursor` to continue. Every returned record is
   * revalidated as a room-archive event for `roomId`, and every archive is a
   * detached clone so caller mutation cannot pollute the cached log or tail.
   */
  async readArchives(
    roomId: string,
    afterArchiveSeq = 0,
    limit = DEFAULT_ARCHIVE_READ_LIMIT
  ): Promise<PersistentRoomArchivePage> {
    const after = requireSafeInteger(afterArchiveSeq, "afterArchiveSeq", 0);
    const eventLimit = requireSafeInteger(limit, "limit", 1);
    const store = await this.openStore(roomId);

    const window = await store.readEvents(after, eventLimit);
    const archives: PersistentRoomArchiveRecord[] = [];
    for (const persisted of window.events) {
      const archive = requireRoomArchiveEvent(
        persisted.event,
        roomId,
        persisted.eventSeq
      );
      archives.push({
        archiveSeq: persisted.eventSeq,
        archive: detachArchive(archive)
      });
    }

    const lastSeq = archives.at(-1)?.archiveSeq ?? after;
    return {
      archives,
      hasMore: lastSeq < window.headEventSeq,
      nextCursor: lastSeq
    };
  }

  async close(): Promise<void> {
    await this.store?.close();
    this.store = null;
  }

  private async openStore(roomId: string): Promise<ArchiveEventStore> {
    if (typeof roomId !== "string" || roomId.trim().length === 0) {
      throw new Error("roomId must be a non-empty string");
    }
    if (this.roomId !== null && this.roomId !== roomId) {
      throw new Error("This store is bound to another room");
    }
    if (this.store) {
      return this.store;
    }

    const eventLogPath = path.join(this.directory, "archive.log");
    const snapshotPath = path.join(this.directory, "archive.snapshot.json");
    await mkdir(this.directory, { recursive: true });
    const store = await FileEventStore.open<
      PersistentRoomArchiveEvent,
      PersistentRoomArchiveSnapshot
    >({ eventLogPath, snapshotPath, snapshotMode: "ignored" });
    this.store = store;
    this.opened = store.recovery;
    this.roomId = roomId;
    return store;
  }
}
