import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import {
  isJsonValue,
  isPlainRecord,
  type JsonObject
} from "@riftbound/replay-core/full-product";
import {
  DUEL_RULESET_ID,
  FOUNDATION_RULESET_ID,
  PROTOCOL_VERSION,
  type RoomId
} from "@riftbound/protocol";
import { GameRoom, type RoomArchive } from "./room.js";
import type { CardCatalogRuntime } from "./card-catalog.js";
import { PersistentRoomArchiveStore } from "./storage/persistent-room-store.js";

const QUARANTINE_DIRECTORY = "quarantine";
const QUARANTINE_MARKER = "quarantine.json";

export interface QuarantinedRoom {
  readonly roomId: RoomId;
  readonly rulesetId: string;
  readonly rulesetVersion: string;
  readonly engineVersion: string;
  readonly protocolVersion: string;
  readonly reason: string;
  readonly quarantinedAt: string;
}

export interface QuarantinedRoomRecord extends QuarantinedRoom {
  readonly quarantinePath: string;
}

export class QuarantinedRoomError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuarantinedRoomError";
  }
}

class SharedRestoreDependencyError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "SharedRestoreDependencyError";
  }
}

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
    if (this.rooms.has(room.roomId) || await this.readQuarantine(room.roomId) !== null) {
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

    const quarantined = await this.readQuarantine(roomId);
    if (quarantined !== null) {
      this.rooms.delete(roomId);
      throw new QuarantinedRoomError(
        `Room ${roomId} could not be restored and is quarantined at ` +
          `${quarantined.quarantinePath}: ${quarantined.reason}`
      );
    }

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
    if (await this.readQuarantine(room.roomId) !== null) {
      throw new Error(`Room ${room.roomId} is quarantined and cannot be saved`);
    }
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
    if (this.rooms.get(room.roomId) !== room || await this.readQuarantine(room.roomId) !== null) {
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

  async quarantined(): Promise<readonly QuarantinedRoomRecord[]> {
    this.assertUsable();
    return this.listQuarantined();
  }

  /** Read the quarantine index without requiring the room store to be open. */
  async inspectQuarantined(): Promise<readonly QuarantinedRoomRecord[]> {
    return this.listQuarantined();
  }

  private async listQuarantined(): Promise<readonly QuarantinedRoomRecord[]> {
    const root = path.join(this.directory, QUARANTINE_DIRECTORY);
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }

    const result: QuarantinedRoomRecord[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !isHashDirectoryName(entry.name)) continue;
      const quarantinePath = path.join(root, entry.name);
      const markerPath = path.join(quarantinePath, QUARANTINE_MARKER);
      let source: unknown;
      try {
        source = JSON.parse(await readFile(markerPath, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          console.error(`[room-restore] quarantine record ${quarantinePath} has no marker; review required`);
        } else {
          console.error(`[room-restore] invalid quarantine marker at ${markerPath}: ${errorMessage(error)}; review required`);
        }
        continue;
      }
      if (!isQuarantineMarker(source, entry.name)) {
        console.error(`[room-restore] invalid quarantine marker at ${markerPath}; review required`);
        continue;
      }
      result.push({ ...source, quarantinePath });
    }
    return result.sort((left, right) => left.quarantinedAt.localeCompare(right.quarantinedAt));
  }

  async list(): Promise<readonly GameRoom[]> {
    this.assertUsable();
    await mkdir(this.directory, { recursive: true });
    await this.assertRootWritable();

    const entries = await readdir(this.directory, { withFileTypes: true });
    const quarantined = await this.listQuarantined();
    const retainedQuarantine = new Set(quarantined.map(record =>
      hashRoomId(record.roomId)
    ));
    for (const roomId of [...this.rooms.keys()]) {
      if (retainedQuarantine.has(hashRoomId(roomId))) this.rooms.delete(roomId);
    }
    const roomsById = new Map(this.rooms);

    let catalog: CardCatalogRuntime | null = null;
    const failures: {
      readonly roomId: RoomId;
      readonly roomPath: string;
      readonly archive: RoomArchive | null;
      readonly error: unknown;
      readonly quarantineError?: unknown;
    }[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !isHashDirectoryName(entry.name)) continue;

      const roomPath = path.join(this.directory, entry.name);
      let provisionalRoomId: string | null;
      try {
        provisionalRoomId = await this.readArchiveRoomId(path.join(roomPath, "archive.log"));
      } catch (error) {
        // The first record is needed to prove room identity. A malformed
        // archive cannot be diagnosed or retried by room id and therefore is
        // not mislabeled as a room-specific quarantine. Fail startup closed.
        throw new Error(
          `Cannot identify room archive ${roomPath}: ${errorMessage(error)}`,
          { cause: error }
        );
      }
      if (provisionalRoomId === null) continue;
      if (hashRoomId(provisionalRoomId) !== entry.name) {
        throw new Error("Room archive directory does not match its roomId");
      }
      await this.restoreRoomPath(provisionalRoomId, roomPath, roomsById, failures,
        () => catalog, loaded => { catalog = loaded; });
    }

    const quarantineFailures = failures.filter(failure => failure.quarantineError !== undefined);
    if (quarantineFailures.length > 0) {
      const details = quarantineFailures.map(failure =>
        `${failure.roomId}: restore failed (${errorMessage(failure.error)}); ` +
          `quarantine failed (${errorMessage(failure.quarantineError)})`
      );
      throw new Error(`Failed to quarantine ${quarantineFailures.length} unrestorable room(s):\n${details.join("\n")}`);
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

  private async restoreRoom(
    archive: RoomArchive,
    catalog?: CardCatalogRuntime
  ): Promise<GameRoom> {
    if (needsCardCatalog(archive)) {
      return GameRoom.restore(archive, catalog ?? await this.loadCatalog());
    }
    return GameRoom.restore(archive);
  }

  private async restoreRoomPath(
    roomId: RoomId,
    roomPath: string,
    roomsById: Map<RoomId, GameRoom>,
    failures: {
      readonly roomId: RoomId;
      readonly roomPath: string;
      readonly archive: RoomArchive | null;
      readonly error: unknown;
      readonly quarantineError?: unknown;
    }[],
    getCatalog: () => CardCatalogRuntime | null,
    setCatalog: (catalog: CardCatalogRuntime) => void
  ): Promise<void> {
    let archiveForDiagnostics: RoomArchive | null = null;
    const store = new PersistentRoomArchiveStore(roomPath);
    try {
      const archive = await store.load(roomId);
      if (archive === null) return;
      if (!isPlainRecord(archive)) return;
      archiveForDiagnostics = parsedArchiveForDiagnostics(archive);
      const parsed = this.parseArchive(archive);
      if (parsed.roomId !== roomId) throw new Error("Room archive does not match its log event");
      if (roomsById.has(parsed.roomId)) return;

      let catalog = getCatalog();
      if (needsCardCatalog(parsed) && catalog === null) {
        try {
          catalog = await this.loadCatalog();
          setCatalog(catalog);
        } catch (error) {
          throw new SharedRestoreDependencyError(
            `Could not load the shared card catalog required to restore room ${parsed.roomId}: ${errorMessage(error)}`,
            error
          );
        }
      }
      roomsById.set(parsed.roomId, await this.restoreRoom(parsed, catalog ?? undefined));
    } catch (error) {
      if (error instanceof SharedRestoreDependencyError) throw error;
      let quarantineError: unknown;
      try {
        await this.quarantineRoom(roomId, roomPath, archiveForDiagnostics, error);
      } catch (caught) {
        quarantineError = caught;
      }
      failures.push({
        roomId,
        roomPath,
        archive: archiveForDiagnostics,
        error,
        ...(quarantineError === undefined ? {} : { quarantineError })
      });
    } finally {
      await store.close();
    }
  }

  private async quarantineRoom(
    roomId: RoomId,
    sourcePath: string,
    archive: RoomArchive | null,
    error: unknown
  ): Promise<void> {
    const root = path.join(this.directory, QUARANTINE_DIRECTORY);
    const destination = path.join(root, hashRoomId(roomId));
    await mkdir(root, { recursive: true });

    try {
      const existing = await stat(destination);
      if (!existing.isDirectory()) throw new Error(`Quarantine path ${destination} is not a directory`);
      const marker = await this.readQuarantine(roomId);
      if (marker !== null) {
        throw new Error(
          `Room ${roomId} has both a live archive and an existing quarantine record`
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    await rename(sourcePath, destination);
    const reason = normalizeQuarantineReason(error);
    const marker: QuarantinedRoom = {
      roomId,
      rulesetId: typeof archive?.rulesetId === "string" ? archive.rulesetId : "unknown",
      rulesetVersion: archive === null ? "unknown" : runtimeRulesetVersion(archive),
      engineVersion: archive === null ? "unknown" : runtimeEngineVersion(archive),
      protocolVersion: archive?.runtimeMode === "engine-v2"
        ? "2.0.0"
        : PROTOCOL_VERSION,
      reason,
      quarantinedAt: new Date().toISOString()
    };
    try {
      await writeFile(
        path.join(destination, QUARANTINE_MARKER),
        `${JSON.stringify(marker, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" }
      );
    } catch (writeError) {
      await rename(destination, sourcePath).catch(() => undefined);
      throw writeError;
    }
    console.error(
      `[room-restore] quarantined room ${roomId} (ruleset=${marker.rulesetId}, ` +
        `rules=${marker.rulesetVersion}, engine=${marker.engineVersion}, ` +
        `protocol=${marker.protocolVersion}) ` +
        `to ${destination}: ${reason}`
    );
  }

  private async readQuarantine(roomId: RoomId): Promise<QuarantinedRoomRecord | null> {
    const quarantinePath = path.join(this.directory, QUARANTINE_DIRECTORY, hashRoomId(roomId));
    const markerPath = path.join(quarantinePath, QUARANTINE_MARKER);
    let source: unknown;
    try {
      source = JSON.parse(await readFile(markerPath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const incomplete = await stat(quarantinePath).catch(caught =>
          (caught as NodeJS.ErrnoException).code === "ENOENT" ? null : Promise.reject(caught)
        );
        if (incomplete === null) return null;
        throw new QuarantinedRoomError(
          `Room ${roomId} is in an incomplete quarantine record at ${quarantinePath}`
        );
      }
      throw new QuarantinedRoomError(
        `Room ${roomId} has an unreadable quarantine marker at ${markerPath}: ${errorMessage(error)}`
      );
    }
    if (!isQuarantineMarker(source, hashRoomId(roomId)) || source.roomId !== roomId) {
      throw new QuarantinedRoomError(
        `Room ${roomId} has an invalid quarantine marker at ${markerPath}`
      );
    }
    return { ...source, quarantinePath };
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeQuarantineReason(error: unknown): string {
  return errorMessage(error).replace(/\s+/g, " ").trim().slice(0, 2000).trimEnd();
}

function parsedArchiveForDiagnostics(archive: Record<string, unknown>): RoomArchive {
  return JSON.parse(JSON.stringify(archive)) as RoomArchive;
}

function runtimeEngineVersion(archive: RoomArchive): string {
  if (archive.engineRuntimeJournal?.header.engineVersion !== undefined) {
    return archive.engineRuntimeJournal.header.engineVersion;
  }
  if (archive.journal !== undefined && archive.journal !== null &&
      typeof archive.journal === "object" &&
      typeof (archive.journal as { readonly header?: { readonly engineVersion?: unknown } })
        .header?.engineVersion === "string") {
    return (archive.journal as { readonly header: { readonly engineVersion: string } })
      .header.engineVersion;
  }
  if (archive.rulesetId === DUEL_RULESET_ID && archive.runtimeMode === "engine-v2") {
    return "@riftbound/engine-core/current";
  }
  return "unknown";
}

function needsCardCatalog(archive: RoomArchive): boolean {
  return archive.rulesetId === FOUNDATION_RULESET_ID ||
    archive.rulesetId === DUEL_RULESET_ID;
}

function runtimeRulesetVersion(archive: RoomArchive): string {
  if (archive.engineRuntimeJournal?.header.rulesetVersion !== undefined) {
    return archive.engineRuntimeJournal.header.rulesetVersion;
  }
  if (archive.journal !== undefined && archive.journal !== null &&
      typeof archive.journal === "object" &&
      typeof (archive.journal as { readonly header?: { readonly rulesetVersion?: unknown } })
        .header?.rulesetVersion === "string") {
    return (archive.journal as { readonly header: { readonly rulesetVersion: string } })
      .header.rulesetVersion;
  }
  if (archive.rulesetId === DUEL_RULESET_ID && archive.runtimeMode === "engine-v2") {
    return "core-1.5";
  }
  // Pre-journal Duel archives do not carry an explicit rules version. Mark
  // that as unknown instead of applying any current-version assumption.
  return archive.rulesetId === DUEL_RULESET_ID ? "legacy-unversioned" : "unknown";
}

function isQuarantineMarker(
  value: unknown,
  directoryHash: string
): value is QuarantinedRoom {
  if (!isPlainRecord(value) || !isJsonValue(value)) return false;
  return typeof value.roomId === "string" && value.roomId.length > 0 &&
    hashRoomId(value.roomId) === directoryHash &&
    typeof value.rulesetId === "string" && value.rulesetId.length > 0 &&
    typeof value.rulesetVersion === "string" && value.rulesetVersion.length > 0 &&
    typeof value.engineVersion === "string" && value.engineVersion.length > 0 &&
    typeof value.protocolVersion === "string" && value.protocolVersion.length > 0 &&
    typeof value.reason === "string" && value.reason.length > 0 &&
    typeof value.quarantinedAt === "string" &&
    !Number.isNaN(Date.parse(value.quarantinedAt));
}
