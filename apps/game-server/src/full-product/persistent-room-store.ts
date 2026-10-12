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

type ArchiveEventStore = FileEventStore<
  PersistentRoomArchiveEvent,
  PersistentRoomArchiveSnapshot
>;

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
