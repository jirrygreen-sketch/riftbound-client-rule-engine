import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  FileEventStore,
  isJsonValue,
  isPlainRecord,
  stableStringify,
  type JsonObject,
  type OpenedFileEventStore
} from "@riftbound/replay-core/full-product";

export interface PersistentRoomArchiveSnapshotEvent {
  readonly type: "room-archive";
  readonly roomId: string;
  readonly archive: JsonObject;
  readonly [key: string]: JsonObject[string];
}

/** `operations` is a flat triple list: path, kind (set/delete/truncate), value. */
export interface PersistentRoomArchiveDeltaEvent {
  readonly type: "room-archive-delta";
  readonly roomId: string;
  readonly formatVersion: 1;
  readonly baseArchiveSeq: number;
  readonly baseArchiveDigest: string;
  readonly archiveDigest: string;
  readonly operations: readonly string[];
  readonly [key: string]: JsonObject[string];
}

export type PersistentRoomArchiveEvent =
  | PersistentRoomArchiveSnapshotEvent
  | PersistentRoomArchiveDeltaEvent;

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
const CHECKPOINT_INTERVAL = 128;

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
function requireArchiveEvent(
  value: unknown,
  roomId: string,
  archiveSeq: number
): JsonObject {
  if (!isPlainRecord(value)) {
    throw new Error(`archive log event ${archiveSeq} must be a JSON object`);
  }
  if (value.type !== "room-archive" && value.type !== "room-archive-delta") {
    throw new Error(
      `archive log event ${archiveSeq} is not a room-archive event or delta`
    );
  }
  if (value.roomId !== roomId) {
    throw new Error("The archive log belongs to another room");
  }
  if (value.type === "room-archive") {
    const archive = value.archive;
    if (!isPlainRecord(archive) || !isJsonValue(archive)) {
      throw new Error(
        `archive log event ${archiveSeq} does not contain a JSON archive`
      );
    }
    return archive as JsonObject;
  }
  if (value.formatVersion !== 1 ||
      !Number.isSafeInteger(value.baseArchiveSeq) ||
      typeof value.baseArchiveDigest !== "string" ||
      typeof value.archiveDigest !== "string" ||
      !Array.isArray(value.operations)) {
    throw new Error(
      `archive log event ${archiveSeq} has an invalid room-archive delta`
    );
  }
  return value as JsonObject;
}

function detachArchive(archive: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(archive)) as JsonObject;
}

function archiveDigest(archive: JsonObject): string {
  return createHash("sha256").update(stableStringify(archive)).digest("hex");
}

function encodePath(path: readonly (string | number)[]): string {
  return JSON.stringify(path);
}

function decodePath(value: string): (string | number)[] {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch {
    throw new Error("Archive delta operation has an invalid path");
  }
  if (!Array.isArray(parsed) || parsed.some(segment =>
    typeof segment !== "string" &&
    !(Number.isSafeInteger(segment) && (segment as number) >= 0))) {
    throw new Error("Archive delta operation has an invalid path");
  }
  return parsed as (string | number)[];
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => sameValue(value, right[index]));
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(key => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
}

function valueAt(value: unknown, segment: string | number): unknown {
  if (value === null || typeof value !== "object") return undefined;
  return Array.isArray(value)
    ? typeof segment === "number" ? value[segment] : undefined
    : typeof segment === "string" ? (value as Record<string, unknown>)[segment] : undefined;
}

function createDeltaOperations(
  previous: unknown,
  next: unknown,
  path: readonly (string | number)[] = [],
  operations: string[] = []
): string[] {
  if (sameValue(previous, next)) return operations;
  if (path.length === 0 && previous === null) {
    if (!isPlainRecord(next)) throw new Error("Room archive delta target must be a JSON object");
    for (const [key, value] of Object.entries(next)) {
      operations.push(encodePath([key]), "set", JSON.stringify(value));
    }
    return operations;
  }
  if (Array.isArray(previous) && Array.isArray(next)) {
    const shared = Math.min(previous.length, next.length);
    if (previous.length > shared) {
      operations.push(encodePath(path), "truncate", JSON.stringify(shared));
    }
    for (let index = shared; index < next.length; index += 1) {
      operations.push(encodePath([...path, index]), "set", JSON.stringify(next[index]));
    }
    for (let index = 0; index < shared; index += 1) {
      createDeltaOperations(previous[index], next[index], [...path, index], operations);
    }
    return operations;
  }
  if (isPlainRecord(previous) && isPlainRecord(next)) {
    for (const key of Object.keys(next)) {
      if (Object.hasOwn(previous, key)) {
        const childPath = [...path, key];
        const previousChild = previous[key];
        const nextChild = next[key];
        const replacedParent = path.length > 0 &&
          previousChild !== null && previousChild !== undefined &&
          nextChild !== null && nextChild !== undefined &&
          typeof previousChild === "object" && typeof nextChild === "object" &&
          (Array.isArray(previousChild) !== Array.isArray(nextChild) ||
            (isPlainRecord(previousChild) !== isPlainRecord(nextChild)));
        if (replacedParent) {
          operations.push(encodePath(childPath), "set", JSON.stringify(nextChild));
        } else {
          createDeltaOperations(previousChild, nextChild, childPath, operations);
        }
      } else {
        operations.push(encodePath([...path, key]), "set", JSON.stringify(next[key]));
      }
    }
    for (const key of Object.keys(previous)) {
      if (!Object.hasOwn(next, key)) operations.push(encodePath([...path, key]), "delete");
    }
    return operations;
  }
  operations.push(encodePath(path), "set", JSON.stringify(next));
  return operations;
}

function deleteAtPath(target: unknown, path: readonly (string | number)[]): void {
  const segments = [...path];
  const last = segments.pop();
  if (last === undefined) throw new Error("Archive delta deletion path is empty");
  let cursor = target;
  for (const segment of segments) {
    cursor = valueAt(cursor, segment);
    if (cursor === null || typeof cursor !== "object") {
      throw new Error("Archive delta deletion path does not exist");
    }
  }
  if (cursor === null || typeof cursor !== "object") {
    throw new Error("Archive delta deletion path does not exist");
  }
  if (Array.isArray(cursor)) {
    if (typeof last !== "number" || last >= cursor.length) {
      throw new Error("Archive delta array deletion is invalid");
    }
    cursor.splice(last, 1);
  } else {
    if (typeof last !== "string" || !Object.hasOwn(cursor, last)) {
      throw new Error("Archive delta object deletion is invalid");
    }
    delete (cursor as Record<string, unknown>)[last];
  }
}

function setJsonPath(target: unknown, path: readonly (string | number)[], value: unknown): void {
  const segments = [...path];
  const last = segments.pop();
  if (last === undefined) throw new Error("Archive delta set path is empty");
  let cursor = target;
  for (const segment of segments) {
    let next = valueAt(cursor, segment);
    if (next === null || typeof next !== "object") {
      const parent = cursor as Record<string | number, unknown>;
      next = {};
      parent[segment] = next;
    }
    cursor = next;
  }
  if (cursor === null || typeof cursor !== "object") {
    throw new Error("Archive delta set parent is invalid");
  }
  (cursor as Record<string | number, unknown>)[last] = value;
}

function assertNoDuplicateOperations(operations: readonly unknown[]): void {
  const seen = new Set<string>();
  for (let index = 0; index < operations.length; index += 3) {
    const rawPath = operations[index];
    const kind = operations[index + 1];
    if (typeof rawPath !== "string" || typeof kind !== "string") {
      throw new Error("Archive delta operation shape is invalid");
    }
    const path = encodePath(decodePath(rawPath));
    const key = `${kind}\0${path}`;
    if (kind !== "truncate" && seen.has(key)) {
      throw new Error("Archive delta contains a duplicate mutation");
    }
    seen.add(key);
  }
}

function truncateAtPath(target: unknown, path: readonly (string | number)[], length: number): void {
  let cursor = target;
  for (const segment of path) {
    cursor = valueAt(cursor, segment);
    if (cursor === null || typeof cursor !== "object") {
      throw new Error("Archive delta truncation path does not exist");
    }
  }
  if (!Array.isArray(cursor) || length > cursor.length) {
    throw new Error("Archive delta truncation path is not a valid array");
  }
  cursor.splice(length);
}

function applyArchiveDelta(base: JsonObject, event: JsonObject): JsonObject {
  const version = event.formatVersion;
  const baseArchiveSeq = event.baseArchiveSeq;
  const baseArchiveDigest = event.baseArchiveDigest;
  const nextDigest = event.archiveDigest;
  const operations = event.operations;
  if (event.type !== "room-archive-delta" || version !== 1 ||
      !Number.isSafeInteger(baseArchiveSeq) || (baseArchiveSeq as number) < 1 ||
      typeof baseArchiveDigest !== "string" || !/^[0-9a-f]{64}$/u.test(baseArchiveDigest) ||
      typeof nextDigest !== "string" || !/^[0-9a-f]{64}$/u.test(nextDigest) ||
      !Array.isArray(operations) || operations.length % 3 !== 0 ||
      !operations.every(operation => typeof operation === "string")) {
    throw new Error("Room archive delta has an invalid shape");
  }
  if (archiveDigest(base) !== baseArchiveDigest) {
    throw new Error("Room archive delta base digest mismatch");
  }
  assertNoDuplicateOperations(operations);
  const nextRoot = detachArchive(base) as JsonObject & Record<string, unknown>;
  for (let index = 0; index < operations.length; index += 3) {
    const path = decodePath(operations[index]!);
    const kind = operations[index + 1]!;
    let value: unknown;
    try { value = JSON.parse(operations[index + 2]!); } catch {
      throw new Error("Archive delta operation value is not JSON");
    }
    if (kind === "set") {
      if (!isJsonValue(value)) throw new Error("Archive delta set value is not JSON data");
      setJsonPath(nextRoot, path, value);
    } else if (kind === "delete") {
      deleteAtPath(nextRoot, path);
    } else if (kind === "truncate") {
      if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new Error("Archive delta truncation length is invalid");
      }
      truncateAtPath(nextRoot, path, value as number);
    } else {
      throw new Error("Archive delta operation kind is invalid");
    }
  }
  const next = nextRoot;
  if (archiveDigest(next) !== nextDigest) {
    throw new Error("Room archive delta result digest mismatch");
  }
  return next;
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
  private currentArchive: JsonObject | null = null;
  private currentArchiveSeq = 0;
  private lastCheckpointSeq = 0;
  private saveTail: Promise<void> = Promise.resolve();

  constructor(private readonly directory: string) {}

  get recovery(): OpenedFileEventStore {
    if (!this.opened) {
      throw new Error("The archive store has not been opened");
    }
    return this.opened;
  }

  async load(roomId: string): Promise<unknown | null> {
    const archive = await this.loadLatest(roomId);
    return archive === null ? null : detachArchive(archive);
  }

  async save(roomId: string, archive: JsonObject): Promise<void> {
    const pending = this.saveTail.then(() => this.appendArchive(roomId, archive));
    this.saveTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async appendArchive(roomId: string, archive: JsonObject): Promise<void> {
    const store = await this.openStore(roomId);
    if (!isPlainRecord(archive) || !isJsonValue(archive)) {
      throw new Error("Room archive must be a JSON object");
    }
    const prior = await this.loadLatest(roomId);
    const shouldCheckpoint = prior === null ||
      store.headEventSeq - this.lastCheckpointSeq >= CHECKPOINT_INTERVAL;
    const operations = prior === null ? [] : createDeltaOperations(prior, archive);
    const prototypeDelta = prior === null ? null : {
      type: "room-archive-delta" as const,
      roomId,
      formatVersion: 1 as const,
      baseArchiveSeq: this.currentArchiveSeq,
      baseArchiveDigest: archiveDigest(prior),
      archiveDigest: archiveDigest(archive),
      operations
    };
    // Checkpoints make recovery bounded. Individual changes stay deltas even
    // when a small replacement encodes larger, so small-room history remains
    // append-only rather than silently turning back into full snapshots.
    const event: PersistentRoomArchiveEvent = shouldCheckpoint
      ? { type: "room-archive", roomId, archive: detachArchive(archive) }
      : prototypeDelta!;
    const outcome = await store.appendEvents({
      events: [{
        eventSeq: store.headEventSeq + 1,
        event
      }]
    });
    if (outcome.events.length !== 1) {
      throw new Error("The durable archive write did not persist an event");
    }

    // appendEvents returns only after its fsync. A delta becomes load-visible
    // only after that receipt and its applied archive is known to match.
    this.currentArchive = detachArchive(archive);
    this.currentArchiveSeq = store.headEventSeq;
    if (event.type === "room-archive") this.lastCheckpointSeq = store.headEventSeq;
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

    if (after === 0) await this.loadLatest(roomId);

    const window = await store.readEvents(after, eventLimit);
    const starting = after === 0 ? null : await this.archiveAt(roomId, after);
    let current: { archiveSeq: number; archive: JsonObject | null } =
      starting ?? { archiveSeq: 0, archive: null };
    const archives: PersistentRoomArchiveRecord[] = [];
    for (const persisted of window.events) {
      const archive = requireArchiveEvent(persisted.event, roomId, persisted.eventSeq);
      if (persisted.event.type === "room-archive") {
        current = { archiveSeq: persisted.eventSeq, archive };
      } else {
        const baseSeq = persisted.event.baseArchiveSeq;
        if (current.archive === null || current.archiveSeq !== baseSeq) {
          throw new Error("Room archive delta base sequence mismatch");
        }
        current = { archiveSeq: persisted.eventSeq, archive: applyArchiveDelta(current.archive, archive) };
      }
      archives.push({ archiveSeq: persisted.eventSeq, archive: detachArchive(current.archive!) });
    }

    const lastSeq = archives.at(-1)?.archiveSeq ?? after;
    return {
      archives,
      hasMore: lastSeq < window.headEventSeq,
      nextCursor: lastSeq
    };
  }

  async close(): Promise<void> {
    await this.saveTail;
    await this.store?.close();
    this.store = null;
    this.currentArchive = null;
    this.currentArchiveSeq = 0;
    this.lastCheckpointSeq = 0;
  }

  private async loadLatest(roomId: string): Promise<JsonObject | null> {
    const store = await this.openStore(roomId);
    if (store.headEventSeq === 0) {
      this.currentArchive = null;
      this.currentArchiveSeq = 0;
      this.lastCheckpointSeq = 0;
      return null;
    }
    if (this.currentArchive !== null && this.currentArchiveSeq === store.headEventSeq) {
      return this.currentArchive;
    }
    const replayingFromStart = this.currentArchive === null;
    const startingSeq = replayingFromStart ? 0 : this.currentArchiveSeq;
    const window = await store.readEvents(startingSeq, store.headEventSeq - startingSeq);
    if (replayingFromStart) {
      this.lastCheckpointSeq = 0;
    }
    let archive = this.currentArchive;
    let archiveSeq = this.currentArchiveSeq;
    for (const persisted of window.events) {
      if (persisted.eventSeq !== archiveSeq + 1) {
        throw new Error("Room archive log contains a gap");
      }
      const event = requireArchiveEvent(persisted.event, roomId, persisted.eventSeq);
      if (persisted.event.type === "room-archive") {
        archive = event;
        this.lastCheckpointSeq = persisted.eventSeq;
      } else {
        if (archive === null || archiveSeq !== persisted.event.baseArchiveSeq) {
          throw new Error("Room archive delta base sequence mismatch");
        }
        archive = applyArchiveDelta(archive, event);
      }
      archiveSeq = persisted.eventSeq;
    }
    this.currentArchive = archive === null ? null : detachArchive(archive);
    this.currentArchiveSeq = archiveSeq;
    return this.currentArchive;
  }

  private async archiveAt(
    roomId: string,
    archiveSeq: number
  ): Promise<{ archiveSeq: number; archive: JsonObject | null }> {
    const store = await this.openStore(roomId);
    const cached = await this.loadLatest(roomId);
    if (archiveSeq === this.currentArchiveSeq) {
      return { archiveSeq, archive: cached === null ? null : detachArchive(cached) };
    }
    if (store.headEventSeq === 0 || archiveSeq < 1) return { archiveSeq, archive: null };
    const window = await store.readEvents(0, archiveSeq);
    let archive: JsonObject | null = null;
    let currentSeq = 0;
    for (const persisted of window.events) {
      const value = requireArchiveEvent(persisted.event, roomId, persisted.eventSeq);
      archive = persisted.event.type === "room-archive"
        ? value
        : applyArchiveDelta(archive!, value);
      currentSeq = persisted.eventSeq;
    }
    if (currentSeq !== archiveSeq) throw new Error("Archive history cursor does not resolve");
    return { archiveSeq, archive: archive === null ? null : detachArchive(archive) };
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
