import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  rename,
  rm,
  type FileHandle,
  type FileStats
} from "node:fs/promises";
import path from "node:path";

import { IdempotencyConflictError, PersistenceClosedError, PersistenceError } from "./errors.js";
import { isPlainRecord, requireJsonObject, requireJsonValue, stableStringify } from "./json.js";
import type { JsonObject } from "./json.js";
import type { EventPersistenceStore } from "./types.js";
import {
  FILE_STORE_FORMAT_VERSION,
  type AppendEventsInput,
  type AppendEventsOutcome,
  type AppendRequestInput,
  type AppendRequestOutcome,
  type EventEntryInput,
  type EventWindow,
  type FileEventStoreOptions,
  type OpenedFileEventStore,
  type PersistedEvent,
  type RequestSignature,
  type SnapshotInput,
  type StoredRequest,
  type StoredSnapshot
} from "./types.js";

type JsonRecord = Record<string, unknown>;

const PRIVATE_FILE_MODE = 0o600;

// Numeric open(2) flags are platform-dependent (notably O_CREAT differs on
// Linux and Darwin). Always take them from the running Node binary. Windows ACL
// semantics are not covered by POSIX mode bits, so Windows is not supported.
const POSIX_PLATFORMS = new Set([
  "aix",
  "darwin",
  "freebsd",
  "linux",
  "openbsd",
  "sunos"
]);

interface LoadedLog {
  readonly handle: FileHandle;
  readonly events: PersistedEvent<JsonObject>[];
  readonly requests: Map<string, StoredRequest>;
  readonly headEventSeq: number;
  readonly tailBytes: number;
}

function fail(message: string): never {
  throw new PersistenceError(message);
}

function requireText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  if (value.length > maxLength) {
    fail(`${field} must be at most ${maxLength} characters`);
  }
  return value;
}

function requireInteger(value: unknown, field: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail(`${field} must be a safe integer greater than or equal to ${minimum}`);
  }
  return value as number;
}

function requireExactKeys(
  value: JsonRecord,
  required: readonly string[],
  optional: readonly string[] = []
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    Object.getOwnPropertySymbols(value).length !== 0 ||
    !required.every(key => Object.prototype.hasOwnProperty.call(value, key)) ||
    !Object.keys(value).every(key => allowed.has(key))
  ) {
    fail("record has an invalid shape");
  }
}

function requestSignatureJson(request: RequestSignature): {
  requestId: string;
  commandId?: string;
  command?: unknown;
} {
  requireText(request.requestId, "request.requestId", 256);
  if (request.commandId !== undefined) {
    requireText(request.commandId, "request.commandId", 256);
  }
  if (request.command !== undefined) {
    requireJsonValue(request.command, "request.command");
  }

  return {
    requestId: request.requestId,
    ...(request.commandId === undefined ? {} : { commandId: request.commandId }),
    ...(request.command === undefined ? {} : { command: request.command })
  };
}

function storedRequestSignature(request: StoredRequest): RequestSignature {
  return {
    requestId: request.requestId,
    ...(request.commandId === undefined ? {} : { commandId: request.commandId }),
    ...(request.command === undefined ? {} : { command: request.command })
  };
}

function requestSignatureKey(request: RequestSignature): string {
  return stableStringify(requestSignatureJson(request) as never);
}

function storedRequestFromJson(value: unknown): StoredRequest {
  if (!isPlainRecord(value)) {
    fail("record.request must be an object");
  }
  requireExactKeys(value, ["requestId"], ["commandId", "command"]);
  const request = requestSignatureJson({
    requestId: requireText(value.requestId, "record.request.requestId", 256),
    ...(value.commandId === undefined
      ? {}
      : { commandId: requireText(value.commandId, "record.request.commandId", 256) }),
    ...(value.command === undefined
      ? {}
      : { command: requireJsonValue(value.command, "record.request.command") })
  });

  return {
    requestId: request.requestId,
    ...(request.commandId === undefined ? {} : { commandId: request.commandId }),
    ...(request.command === undefined ? {} : { command: request.command as never }),
    eventSeq: null
  };
}

function storedRequestFromInput(
  request: RequestSignature,
  eventSeq: number | null,
  response: unknown
): StoredRequest {
  const normalized = requestSignatureJson(request);
  if (response !== undefined) {
    requireJsonValue(response, "response");
  }
  return {
    requestId: normalized.requestId,
    ...(normalized.commandId === undefined ? {} : { commandId: normalized.commandId }),
    ...(normalized.command === undefined ? {} : { command: normalized.command as never }),
    eventSeq,
    ...(response === undefined ? {} : { response: response as never })
  };
}

function normalizeEventEntries(value: unknown, path: string): EventEntryInput<JsonObject>[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${path} must be a non-empty array`);
  }
  return value.map((item, index) => {
    if (!isPlainRecord(item)) {
      fail(`${path}[${index}] must be an object`);
    }
    requireExactKeys(item, ["eventSeq", "event"]);
    return {
      eventSeq: requireInteger(item.eventSeq, `${path}[${index}].eventSeq`, 1),
      event: requireJsonObject(item.event, `${path}[${index}].event`)
    };
  });
}

function validateEventEntries(
  entries: readonly EventEntryInput<JsonObject>[],
  firstSeq: number
): void {
  for (const [index, entry] of entries.entries()) {
    const expected = firstSeq + index;
    if (entry.eventSeq !== expected) {
      fail(`event sequences must be contiguous; expected ${expected}`);
    }
  }
}

function recordChecksum(record: unknown): string {
  return createHash("sha256")
    .update(stableStringify(record as never))
    .digest("hex");
}

function serializeRecord(record: unknown): Buffer {
  const checksum = recordChecksum(record);
  return Buffer.from(`${JSON.stringify({ checksum, record })}\n`, "utf8");
}

function parseRecord(line: Buffer, byteOffset: number): JsonRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.toString("utf8"));
  } catch {
    fail(`log record at byte ${byteOffset} is not valid JSON`);
  }

  if (!isPlainRecord(parsed)) {
    fail(`log record at byte ${byteOffset} must be an object`);
  }
  requireExactKeys(parsed, ["checksum", "record"]);
  if (typeof parsed.checksum !== "string") {
    fail(`log record at byte ${byteOffset} has an invalid checksum`);
  }
  if (!isPlainRecord(parsed.record)) {
    fail(`log record at byte ${byteOffset} has an invalid record`);
  }
  if (recordChecksum(parsed.record) !== parsed.checksum) {
    fail(`log record at byte ${byteOffset} failed its checksum`);
  }
  return parsed.record;
}

function headEventSeqOf(events: readonly PersistedEvent<JsonObject>[]): number {
  return events.at(-1)?.eventSeq ?? 0;
}

function applyLogRecord(
  record: JsonRecord,
  events: PersistedEvent<JsonObject>[],
  requests: Map<string, StoredRequest>
): void {
  if (
    !isPlainRecord(record) ||
    !Object.prototype.hasOwnProperty.call(record, "formatVersion") ||
    typeof record.kind !== "string" ||
    !["events", "request"].includes(record.kind)
  ) {
    fail("record has an invalid shape");
  }
  const formatVersion = requireInteger(record.formatVersion, "record.formatVersion", 1);
  if (formatVersion !== FILE_STORE_FORMAT_VERSION) {
    fail(`unsupported log format version ${formatVersion}`);
  }

  if (record.kind === "events") {
    requireExactKeys(record, ["formatVersion", "kind", "entries"], [
      "request",
      "response"
    ]);
    const entries = normalizeEventEntries(record.entries, "record.entries");
    validateEventEntries(entries, headEventSeqOf(events) + 1);

    let request: StoredRequest | undefined;
    if (record.request !== undefined) {
      request = storedRequestFromJson(record.request);
      request = {
        ...request,
        eventSeq: entries.at(-1)?.eventSeq ?? null,
        ...(record.response === undefined ? {} : { response: record.response as never })
      };
      if (requests.has(request.requestId)) {
        fail("duplicate requestId in log");
      }
      requests.set(request.requestId, request);
    }

    for (const entry of entries) {
      events.push({
        eventSeq: entry.eventSeq,
        event: entry.event,
        ...(request === undefined ? {} : { request })
      });
    }
    return;
  }

  if (record.kind === "request") {
    requireExactKeys(record, ["formatVersion", "kind", "request"], ["response"]);
    const request = {
      ...storedRequestFromJson(record.request),
      eventSeq: null,
      ...(record.response === undefined ? {} : { response: record.response as never })
    };
    if (requests.has(request.requestId)) {
      fail("duplicate requestId in log");
    }
    requests.set(request.requestId, request);
    return;
  }

  fail("unsupported log record kind");
}

function normalizeInputEventEntries(
  events: readonly EventEntryInput<JsonObject>[],
  headEventSeq: number
): EventEntryInput<JsonObject>[] {
  if (events.length === 0) {
    fail("events must contain at least one event");
  }
  const normalized = events.map((entry, index) => ({
    eventSeq: requireInteger(entry.eventSeq, `events[${index}].eventSeq`, 1),
    event: requireJsonObject(entry.event, `events[${index}].event`)
  }));
  validateEventEntries(normalized, headEventSeq + 1);
  return normalized;
}

function checkRequestDuplicate(
  request: RequestSignature,
  existing: StoredRequest | undefined
): void {
  if (!existing) {
    return;
  }
  const existingSignature = requestSignatureKey(storedRequestSignature(existing));
  if (existingSignature !== requestSignatureKey(request)) {
    throw new IdempotencyConflictError(
      "requestId was already used with a different command"
    );
  }
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: FileHandle | null = null;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EINVAL" && code !== "ENOTSUP" && code !== "EPERM") {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

async function writeAll(
  handle: FileHandle,
  buffer: Buffer
): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset);
    if (bytesWritten === 0) {
      fail("filesystem write made no progress");
    }
    offset += bytesWritten;
  }
}

function isPosixPermissionsSupported(): boolean {
  const runtimePlatform = (globalThis as {
    process?: { platform?: string };
  }).process?.platform;
  return runtimePlatform !== undefined && POSIX_PLATFORMS.has(runtimePlatform);
}

function assertPosixPermissionsSupported(): void {
  if (!isPosixPermissionsSupported()) {
    fail("private file permissions are unsupported on this platform");
  }
  // Reject runtimes without no-follow/regular-file checks instead of silently
  // opening or creating files with guessed, potentially destructive flags.
  for (const flag of [
    fsConstants.O_WRONLY, fsConstants.O_RDWR, fsConstants.O_APPEND,
    fsConstants.O_CREAT, fsConstants.O_EXCL, fsConstants.O_NOFOLLOW,
    fsConstants.O_NONBLOCK, fsConstants.S_IFMT, fsConstants.S_IFREG
  ]) {
    if (!Number.isSafeInteger(flag) || flag <= 0) {
      fail("private file permissions require POSIX filesystem constants");
    }
  }
  if (fsConstants.O_RDONLY !== 0 ||
      (fsConstants.S_IFREG & fsConstants.S_IFMT) !== fsConstants.S_IFREG) {
    fail("private file permissions require POSIX filesystem constants");
  }
}

function errorCode(error: unknown): string | undefined {
  return error !== null && typeof error === "object" && "code" in error &&
    typeof error.code === "string" ? error.code : undefined;
}

function isPermissionError(error: unknown): boolean {
  return errorCode(error) === "EACCES" || errorCode(error) === "EPERM";
}

function isRegularPrivateFile(metadata: FileStats): boolean {
  return metadata.isFile() &&
    (metadata.mode & fsConstants.S_IFMT) === fsConstants.S_IFREG;
}

function hasPrivateMode(metadata: FileStats): boolean {
  return (metadata.mode & 0o7777) === PRIVATE_FILE_MODE;
}

function sameFile(left: FileStats, right: FileStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function privatePathMetadata(filePath: string): Promise<FileStats | null> {
  try {
    // lstat, not stat: a swapped-in symlink must never be treated as authority
    // for chmod, cleanup, or a successful write acknowledgement.
    return await lstat(filePath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

async function assertPathMatchesFile(
  handle: FileHandle,
  filePath: string,
  requirePrivateMode: boolean,
  expected?: FileStats
): Promise<FileStats> {
  let metadata: FileStats;
  try {
    metadata = await handle.stat();
  } catch {
    throw new PersistenceError(`could not inspect private file ${filePath}`);
  }
  if (!isRegularPrivateFile(metadata)) {
    fail(`private file path must be a regular file: ${filePath}`);
  }
  // In the fallback reopen, compare against the original descriptor BEFORE
  // fchmod; never repair the permissions of an unrelated replacement inode.
  if (expected && !sameFile(metadata, expected)) {
    fail(`private file changed while opening: ${filePath}`);
  }
  const named = await privatePathMetadata(filePath);
  if (!named || !isRegularPrivateFile(named) || !sameFile(metadata, named)) {
    fail(`private file changed while opening: ${filePath}`);
  }
  if (requirePrivateMode && (!hasPrivateMode(metadata) || !hasPrivateMode(named))) {
    fail(`private file permissions could not be established for ${filePath}`);
  }
  return metadata;
}

async function establishPrivateFile(
  handle: FileHandle,
  filePath: string,
  expected?: FileStats
): Promise<FileStats> {
  await assertPathMatchesFile(handle, filePath, false, expected);
  try {
    await handle.chmod(PRIVATE_FILE_MODE);
  } catch {
    throw new PersistenceError(`could not establish private file permissions for ${filePath}`);
  }
  // Re-check the inode/mode on the fd even if the path was exchanged during
  // chmod. A later path check also rejects the resulting stale authority.
  const verified = await handle.stat();
  if (!isRegularPrivateFile(verified) || !hasPrivateMode(verified)) {
    fail(`private file permissions could not be established for ${filePath}`);
  }
  return assertPathMatchesFile(handle, filePath, true, expected);
}

async function closeFile(handle: FileHandle | null): Promise<void> {
  if (handle) {
    await handle.close();
  }
}

async function openPrivateReadable(filePath: string): Promise<FileHandle | null> {
  assertPosixPermissionsSupported();
  let handle: FileHandle;
  try {
    // O_NONBLOCK is essential here: O_RDONLY on a FIFO waits for a writer
    // before we can inspect its type. The fd is still checked with fstat.
    handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW |
      fsConstants.O_NONBLOCK);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return null;
    }
    throw error;
  }
  try {
    await establishPrivateFile(handle, filePath);
    return handle;
  } catch (error) {
    await closeFile(handle).catch(() => undefined);
    throw error;
  }
}

async function openPrivateWritable(filePath: string): Promise<FileHandle> {
  assertPosixPermissionsSupported();

  let handle: FileHandle | null = null;
  try {
    handle = await open(filePath,
      fsConstants.O_RDWR | fsConstants.O_APPEND | fsConstants.O_NOFOLLOW |
        fsConstants.O_NONBLOCK);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      try {
        handle = await open(
          filePath,
          fsConstants.O_RDWR | fsConstants.O_APPEND | fsConstants.O_CREAT |
            fsConstants.O_EXCL | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
          PRIVATE_FILE_MODE
        );
      } catch (createError) {
        if (errorCode(createError) !== "EEXIST") {
          throw createError;
        }
        // Another creator won the race. Re-open it below without following a
        // symlink and establish permissions on the inode actually opened.
      }
    } else if (!isPermissionError(error)) {
      throw error;
    }
  }

  if (handle) {
    try {
      await establishPrivateFile(handle, filePath);
      return handle;
    } catch (error) {
      await closeFile(handle).catch(() => undefined);
      throw error;
    }
  }

  // A pre-existing file may be readable but not writable. Repair through the
  // read-only descriptor, without reading its contents; check the writable
  // reopen against that inode BEFORE its own fchmod. Never chmod(path).
  const readable = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW |
    fsConstants.O_NONBLOCK);
  let readableMetadata: FileStats;
  try {
    readableMetadata = await establishPrivateFile(readable, filePath);
  } catch (error) {
    await closeFile(readable).catch(() => undefined);
    throw error;
  }
  await closeFile(readable);

  let writable: FileHandle;
  try {
    writable = await open(filePath,
      fsConstants.O_RDWR | fsConstants.O_APPEND | fsConstants.O_NOFOLLOW |
        fsConstants.O_NONBLOCK);
  } catch (error) {
    throw new PersistenceError(`private file cannot be opened for append: ${filePath}`);
  }
  try {
    await establishPrivateFile(writable, filePath, readableMetadata);
    return writable;
  } catch (error) {
    await closeFile(writable).catch(() => undefined);
    throw error;
  }
}

async function validatePrivatePathIfPresent(filePath: string): Promise<FileStats | null> {
  const handle = await openPrivateReadable(filePath);
  if (!handle) return null;
  try {
    return await assertPathMatchesFile(handle, filePath, true);
  } finally {
    await closeFile(handle);
  }
}

async function assertSnapshotDestinationUnchanged(
  filePath: string,
  previous: FileStats | null
): Promise<void> {
  const current = await privatePathMetadata(filePath);
  if (previous === null ? current !== null :
      current === null || !isRegularPrivateFile(current) ||
      !hasPrivateMode(current) || !sameFile(previous, current)) {
    fail(`private snapshot path changed before replacement: ${filePath}`);
  }
}

async function temporaryStillOwned(
  filePath: string,
  handle: FileHandle,
  expected: FileStats
): Promise<boolean> {
  const current = await privatePathMetadata(filePath);
  const actual = await handle.stat();
  return !!current && isRegularPrivateFile(current) &&
    sameFile(current, expected) && sameFile(actual, expected);
}

async function removeOwnedTemporary(
  filePath: string,
  handle: FileHandle,
  expected: FileStats
): Promise<void> {
  // Do not unlink a name we did not create. No pathname-only rm on failure:
  // another directory writer may have replaced our temporary with a symlink.
  if (await temporaryStillOwned(filePath, handle, expected)) {
    await rm(filePath, { force: true });
  }
}

async function loadLog(filePath: string): Promise<LoadedLog> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const handle = await openPrivateWritable(filePath);
  const events: PersistedEvent<JsonObject>[] = [];
  const requests = new Map<string, StoredRequest>();
  let buffer = Buffer.alloc(0);
  let bufferStart = 0;
  let bufferEnd = 0;
  let keepOpen = false;
  try {
    const chunk = Buffer.alloc(64 * 1024);
    while (true) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, bufferEnd);
      if (bytesRead === 0) {
        break;
      }
      buffer = Buffer.concat([buffer, chunk.subarray(0, bytesRead)]);
      bufferEnd += bytesRead;

      let newline = buffer.indexOf(0x0a);
      while (newline !== -1) {
        const line = buffer.subarray(0, newline);
        const record = parseRecord(line, bufferStart);
        applyLogRecord(record, events, requests);
        bufferStart += newline + 1;
        buffer = buffer.subarray(newline + 1);
        newline = buffer.indexOf(0x0a);
      }
    }

    const tailBytes = buffer.length;
    await assertPathMatchesFile(handle, filePath, true);
    if (tailBytes !== 0) {
      await handle.truncate(bufferStart);
      await handle.datasync();
      await assertPathMatchesFile(handle, filePath, true);
    }
    keepOpen = true;
    return {
      handle,
      events,
      requests,
      headEventSeq: headEventSeqOf(events),
      tailBytes
    };
  } finally {
    if (!keepOpen) {
      await closeFile(handle);
    }
  }
}

export class FileEventStore<
  TEvent extends JsonObject = JsonObject,
  TSnapshot extends JsonObject = JsonObject
> implements EventPersistenceStore<TEvent, TSnapshot> {
  private handle: FileHandle | null = null;
  private readonly events: PersistedEvent<TEvent>[] = [];
  private readonly requests = new Map<string, StoredRequest>();
  private snapshot: StoredSnapshot<TSnapshot> | null = null;
  private writeTail: Promise<unknown> = Promise.resolve();
  private openState: "closed" | "opening" | "open" | "write-failed" | "closing" = "closed";
  private readonly options: FileEventStoreOptions;
  private recoveryValue: OpenedFileEventStore = {
    headEventSeq: 0,
    truncatedTailBytes: 0
  };

  private constructor(options: FileEventStoreOptions) {
    this.options = {
      snapshotMode: "authoritative",
      ...options
    };
  }

  static async open<
    TEvent extends JsonObject = JsonObject,
    TSnapshot extends JsonObject = JsonObject
  >(options: FileEventStoreOptions): Promise<FileEventStore<TEvent, TSnapshot>> {
    const store = new FileEventStore<TEvent, TSnapshot>(options);
    await store.open();
    return store;
  }

  get headEventSeq(): number {
    return headEventSeqOf(this.events);
  }

  get recovery(): OpenedFileEventStore {
    return this.recoveryValue;
  }

  async appendEvents(input: AppendEventsInput<TEvent>): Promise<AppendEventsOutcome<TEvent>> {
    return this.enqueue(async () => {
      this.assertOpen();
      await this.assertPrivateLog();
      if (input.request) {
        const signature = requestSignatureJson(input.request);
        const existing = this.requests.get(signature.requestId);
        checkRequestDuplicate(input.request, existing);
        if (existing) {
          return {
            events: this.events.filter(
              event => event.request?.requestId === existing.requestId
            ),
            duplicate: true
          };
        }
      }

      const entries = normalizeInputEventEntries(input.events, this.headEventSeq);
      const request = input.request === undefined
        ? undefined
        : storedRequestFromInput(
            input.request,
            entries.at(-1)?.eventSeq ?? null,
            input.response
          );

      const persisted = entries.map(entry => ({
        eventSeq: entry.eventSeq,
        event: entry.event as TEvent,
        ...(request === undefined ? {} : { request })
      }));
      const record = {
        formatVersion: FILE_STORE_FORMAT_VERSION,
        kind: "events",
        entries,
        ...(request === undefined
          ? {}
          : { request: requestSignatureJson(input.request as RequestSignature) }),
        ...(input.response === undefined ? {} : { response: input.response })
      };
      await this.writeRecord(record);
      this.events.push(...persisted);
      if (request) {
        this.requests.set(request.requestId, request);
      }
      return { events: persisted, duplicate: false };
    });
  }

  async appendRequest(input: AppendRequestInput): Promise<AppendRequestOutcome> {
    const request = storedRequestFromInput(input.request, null, input.response);
    return this.enqueue(async () => {
      this.assertOpen();
      await this.assertPrivateLog();
      const existing = this.requests.get(request.requestId);
      checkRequestDuplicate(input.request, existing);
      if (existing) {
        return { request: existing, duplicate: true };
      }

      const record = {
        formatVersion: FILE_STORE_FORMAT_VERSION,
        kind: "request",
        request: requestSignatureJson(input.request),
        ...(input.response === undefined ? {} : { response: input.response })
      };
      await this.writeRecord(record);
      this.requests.set(request.requestId, request);
      return { request, duplicate: false };
    });
  }

  async getRequest(requestId: string): Promise<StoredRequest | null> {
    this.assertOpen();
    requireText(requestId, "requestId", 256);
    return this.requests.get(requestId) ?? null;
  }

  async readEvents(afterEventSeq: number, limit = 1000): Promise<EventWindow<TEvent>> {
    this.assertOpen();
    const after = requireInteger(afterEventSeq, "afterEventSeq", 0);
    const eventLimit = requireInteger(limit, "limit", 1);
    if (after > this.headEventSeq) {
      fail("afterEventSeq is ahead of the event log");
    }
    return {
      afterEventSeq: after,
      headEventSeq: this.headEventSeq,
      events: this.events
        .filter(event => event.eventSeq > after)
        .slice(0, eventLimit)
    };
  }

  async saveSnapshot(input: SnapshotInput<TSnapshot>): Promise<StoredSnapshot<TSnapshot>> {
    const eventSeq = requireInteger(input.eventSeq, "snapshot.eventSeq", 0);
    const payload = requireJsonObject(input.payload, "snapshot.payload");
    const snapshot = { eventSeq, payload: payload as TSnapshot };
    return this.enqueue(async () => {
      this.assertOpen();
      await this.assertPrivateLog();
      if (snapshot.eventSeq > this.headEventSeq) {
        fail("snapshot cannot be ahead of the event log");
      }

      const record = {
        formatVersion: FILE_STORE_FORMAT_VERSION,
        eventSeq: snapshot.eventSeq,
        payload: snapshot.payload
      };
      const serialized = serializeRecord(record);
      assertPosixPermissionsSupported();
      const destinationBefore = await validatePrivatePathIfPresent(this.options.snapshotPath);
      const temporaryPath = `${this.options.snapshotPath}.${randomUUID()}.tmp`;
      let temporary: FileHandle | null = null;
      let ownedTemporary: FileStats | null = null;
      let renameAttempted = false;
      try {
        temporary = await open(
          temporaryPath,
          fsConstants.O_WRONLY | fsConstants.O_CREAT |
            fsConstants.O_EXCL | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
          PRIVATE_FILE_MODE
        );
        // Retain the fd through rename: the name alone cannot establish that
        // the installed snapshot is the regular 0600 inode we wrote and synced.
        ownedTemporary = await temporary.stat();
        await establishPrivateFile(temporary, temporaryPath);
        await writeAll(temporary, serialized);
        await temporary.sync();
        await assertPathMatchesFile(temporary, temporaryPath, true, ownedTemporary);
        await assertSnapshotDestinationUnchanged(this.options.snapshotPath, destinationBefore);
        renameAttempted = true;
        await rename(temporaryPath, this.options.snapshotPath);
        await assertPathMatchesFile(temporary, this.options.snapshotPath, true, ownedTemporary);
        await syncDirectory(path.dirname(this.options.snapshotPath));
        await assertPathMatchesFile(temporary, this.options.snapshotPath, true, ownedTemporary);
        await this.assertPrivateLog();
        // Closing the descriptor is also part of the success boundary: if it
        // fails, keep the old in-memory snapshot and report uncertain outcome.
        await temporary.close();
        temporary = null;
        const finalName = await privatePathMetadata(this.options.snapshotPath);
        if (!finalName || !isRegularPrivateFile(finalName) ||
            !hasPrivateMode(finalName) || !sameFile(ownedTemporary, finalName)) {
          fail(`private snapshot path changed after replacement: ${this.options.snapshotPath}`);
        }
      } catch (error) {
        if (temporary) {
          // An unperformed rename leaves our temp name intact. A failure after
          // installing it (or an unowned replacement name) makes the on-disk
          // outcome uncertain and must poison this instance, not fake an ACK.
          const stillOwned = ownedTemporary && await temporaryStillOwned(
            temporaryPath, temporary, ownedTemporary
          ).catch(() => false);
          if (renameAttempted && !stillOwned) this.openState = "write-failed";
          if (ownedTemporary && stillOwned) {
            await removeOwnedTemporary(temporaryPath, temporary, ownedTemporary)
              .catch(() => undefined);
          }
          await closeFile(temporary).catch(() => undefined);
        } else if (renameAttempted) {
          this.openState = "write-failed";
        }
        throw error;
      }

      this.snapshot = snapshot;
      return snapshot;
    });
  }

  async readSnapshot(): Promise<StoredSnapshot<TSnapshot> | null> {
    this.assertOpen();
    return this.snapshot;
  }

  async close(): Promise<void> {
    if (this.openState !== "open" && this.openState !== "write-failed") {
      return;
    }
    this.openState = "closing";
    await this.writeTail;
    await this.handle?.close();
    this.handle = null;
    this.openState = "closed";
  }

  private async open(): Promise<void> {
    if (this.openState !== "closed") {
      fail("store can only be opened once");
    }
    this.openState = "opening";

    if (path.resolve(this.options.eventLogPath) ===
        path.resolve(this.options.snapshotPath)) {
      fail("event log and snapshot paths must be different");
    }

    assertPosixPermissionsSupported();
    await mkdir(path.dirname(this.options.eventLogPath), { recursive: true });
    await mkdir(path.dirname(this.options.snapshotPath), { recursive: true });
    const loaded = await loadLog(this.options.eventLogPath);
    this.handle = loaded.handle;
    try {
      this.events.push(...(loaded.events as unknown as readonly PersistedEvent<TEvent>[]));
      for (const [requestId, request] of loaded.requests) {
        this.requests.set(requestId, request);
      }
      if (this.options.snapshotMode === "ignored") {
        // Only an actual directory is an unusable optional cache: never open,
        // read, chmod, or remove it. Keep the private-file checks for every
        // other path (including symlinks, FIFOs, and existing regular files).
        const cachePath = await privatePathMetadata(this.options.snapshotPath);
        if (!cachePath || !(cachePath as FileStats & { isDirectory(): boolean }).isDirectory()) {
          await validatePrivatePathIfPresent(this.options.snapshotPath);
        }
        this.snapshot = null;
      } else {
        this.snapshot = await this.loadSnapshot();
        if (this.snapshot && this.snapshot.eventSeq > loaded.headEventSeq) {
          fail("snapshot is ahead of the event log");
        }
      }
      this.recoveryValue = {
        headEventSeq: loaded.headEventSeq,
        truncatedTailBytes: loaded.tailBytes
      };
      this.openState = "open";
    } catch (error) {
      this.events.length = 0;
      this.requests.clear();
      this.snapshot = null;
      this.recoveryValue = {
        headEventSeq: 0,
        truncatedTailBytes: 0
      };
      this.openState = "closed";
      await this.handle?.close();
      this.handle = null;
      throw error;
    }
  }

  private async loadSnapshot(): Promise<StoredSnapshot<TSnapshot> | null> {
    const handle = await openPrivateReadable(this.options.snapshotPath);
    if (!handle) {
      return null;
    }
    try {
      const metadata = await handle.stat();
      const size = metadata.size;
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await handle.read(buffer, 0, size, 0);
      if (bytesRead !== size) {
        fail("snapshot is truncated");
      }
      const record = parseRecord(buffer.subarray(0, bytesRead), 0);
      requireExactKeys(record, ["formatVersion", "eventSeq", "payload"]);
      const formatVersion = requireInteger(record.formatVersion, "snapshot.formatVersion", 1);
      if (formatVersion !== FILE_STORE_FORMAT_VERSION) {
        fail(`unsupported snapshot format version ${formatVersion}`);
      }
      const eventSeq = requireInteger(record.eventSeq, "snapshot.eventSeq", 0);
      const payload = requireJsonObject(record.payload, "snapshot.payload");
      return { eventSeq, payload: payload as TSnapshot };
    } finally {
      await handle.close();
    }
  }

  private async assertPrivateLog(): Promise<void> {
    if (!this.handle) {
      throw new PersistenceClosedError();
    }
    try {
      await establishPrivateFile(this.handle, this.options.eventLogPath);
      await assertPathMatchesFile(this.handle, this.options.eventLogPath, true);
    } catch (error) {
      this.openState = "write-failed";
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.openState === "write-failed") {
      throw new PersistenceError(
        "persistence store has an unresolved failed write; reopen the store"
      );
    }
    if (this.openState !== "open") {
      throw new PersistenceClosedError();
    }
  }

  private async writeRecord(record: unknown): Promise<void> {
    if (!this.handle) {
      throw new PersistenceClosedError();
    }
    const serialized = serializeRecord(record);
    try {
      await assertPathMatchesFile(this.handle, this.options.eventLogPath, true);
      await writeAll(this.handle, serialized);
      await this.handle.datasync();
      await assertPathMatchesFile(this.handle, this.options.eventLogPath, true);
    } catch (error) {
      this.openState = "write-failed";
      throw error;
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeTail.then(operation);
    this.writeTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}
