import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  rename,
  rm,
  stat,
  truncate,
  type FileHandle
} from "node:fs/promises";
import path from "node:path";

import { IdempotencyConflictError, PersistenceClosedError, PersistenceError } from "./errors.js";
import { isPlainRecord, isJsonValue, requireJsonObject, requireJsonValue, stableStringify } from "./json.js";
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

interface LoadedLog {
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
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid JSON";
    fail(`log record at byte ${byteOffset} is not valid JSON: ${detail}`);
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
        fail(`duplicate requestId in log: ${request.requestId}`);
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
      fail(`duplicate requestId in log: ${request.requestId}`);
    }
    requests.set(request.requestId, request);
    return;
  }

  fail(`unsupported log record kind: ${String(record.kind)}`);
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
      `requestId ${request.requestId} was already used with a different command`
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

async function loadLog(filePath: string): Promise<LoadedLog> {
  await mkdir(path.dirname(filePath), { recursive: true });
  let exists = true;
  try {
    await stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    exists = false;
  }
  if (!exists) {
    const created = await open(filePath, "a");
    await created.close();
    return { events: [], requests: new Map(), headEventSeq: 0, tailBytes: 0 };
  }

  const handle = await open(filePath, "r");
  const events: PersistedEvent<JsonObject>[] = [];
  const requests = new Map<string, StoredRequest>();
  let buffer = Buffer.alloc(0);
  let bufferStart = 0;
  let bufferEnd = 0;
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
    if (tailBytes !== 0) {
      await handle.close();
      await truncate(filePath, bufferStart);
    }
    return {
      events,
      requests,
      headEventSeq: headEventSeqOf(events),
      tailBytes
    };
  } finally {
    await handle.close();
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
      if (snapshot.eventSeq > this.headEventSeq) {
        fail("snapshot cannot be ahead of the event log");
      }

      const record = {
        formatVersion: FILE_STORE_FORMAT_VERSION,
        eventSeq: snapshot.eventSeq,
        payload: snapshot.payload
      };
      const serialized = serializeRecord(record);
      const temporaryPath = `${this.options.snapshotPath}.${randomUUID()}.tmp`;
      let temporary: FileHandle | null = null;
      try {
        temporary = await open(temporaryPath, "wx");
        await writeAll(temporary, serialized);
        await temporary.sync();
        await temporary.close();
        temporary = null;
        await rename(temporaryPath, this.options.snapshotPath);
        await syncDirectory(path.dirname(this.options.snapshotPath));
      } catch (error) {
        await temporary?.close();
        await rm(temporaryPath, { force: true });
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

    await mkdir(path.dirname(this.options.snapshotPath), { recursive: true });
    const loaded = await loadLog(this.options.eventLogPath);
    this.handle = await open(this.options.eventLogPath, "a+");
    try {
      this.events.push(...(loaded.events as unknown as readonly PersistedEvent<TEvent>[]));
      for (const [requestId, request] of loaded.requests) {
        this.requests.set(requestId, request);
      }
      if (this.options.snapshotMode === "ignored") {
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
      await this.handle.close();
      this.handle = null;
      throw error;
    }
  }

  private async loadSnapshot(): Promise<StoredSnapshot<TSnapshot> | null> {
    let snapshotStat;
    try {
      snapshotStat = await stat(this.options.snapshotPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      return null;
    }
    if (!snapshotStat.isFile()) {
      fail("snapshot path must be a file");
    }

    const handle = await open(this.options.snapshotPath, "r");
    try {
      const size = snapshotStat.size;
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
      await writeAll(this.handle, serialized);
      await this.handle.datasync();
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
