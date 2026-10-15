import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import type { Stats as FileStats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  rename,
  rm,
  type FileHandle
} from "node:fs/promises";
import path from "node:path";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const FORMAT_VERSION = 1;
const DEFAULT_BUSY_TIMEOUT_MS = 250;
const LOCK_RETRY_MS = 5;
const MAX_TEXT_LENGTH = 512;
const MAX_JSON_DEPTH = 64;

export type PrivateJournalCasJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly PrivateJournalCasJsonValue[]
  | { readonly [key: string]: PrivateJournalCasJsonValue };

export interface PrivateJournalCasHead {
  readonly revision: number;
  readonly nonce: string;
}

export interface PrivateJournalCasSnapshot<TData = PrivateJournalCasJsonValue> {
  readonly head: PrivateJournalCasHead;
  readonly data: TData;
}

export interface PrivateJournalCasCreateOptions<TData = PrivateJournalCasJsonValue> {
  readonly directory: string;
  readonly key: string;
  readonly genesisData: TData;
  readonly busyTimeoutMs?: number;
}

export interface PrivateJournalCasOpenOptions {
  readonly directory: string;
  readonly key: string;
  readonly busyTimeoutMs?: number;
}

export interface PrivateJournalCasStore<TData = PrivateJournalCasJsonValue> {
  readonly key: string;
  readonly keyHash: string;
  load(): Promise<PrivateJournalCasSnapshot<TData>>;
  compareAndSwap(
    expectedHead: PrivateJournalCasHead,
    writeId: string,
    nextData: TData
  ): Promise<PrivateJournalCasCasResult<TData>>;
  close(): Promise<void>;
}

export type PrivateJournalCasCasResult<TData = PrivateJournalCasJsonValue> =
  | (PrivateJournalCasSnapshot<TData> & {
      readonly status: "committed" | "duplicate";
      readonly writeId: string;
    })
  | {
      readonly status: "conflict";
      readonly reason: "stale-head" | "write-id-conflict";
      readonly current: PrivateJournalCasSnapshot<TData>;
      readonly currentHead: PrivateJournalCasHead;
      readonly writeId: string;
    };

export class PrivateJournalCasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivateJournalCasError";
  }
}

export class PrivateJournalCasLockBusyError extends PrivateJournalCasError {
  readonly code = "private-journal-cas-lock-busy";

  constructor(keyHash: string) {
    super(`private journal CAS lock is busy for key ${keyHash}`);
    this.name = "PrivateJournalCasLockBusyError";
  }
}

export class PrivateJournalCasConflictError extends PrivateJournalCasError {
  constructor(message: string) {
    super(message);
    this.name = "PrivateJournalCasConflictError";
  }
}

class PrivateJournalCasDurabilityError extends PrivateJournalCasError {
  constructor(message: string) {
    super(`private journal durability confirmation failed: ${message}`);
    this.name = "PrivateJournalCasDurabilityError";
  }
}

interface PrivateJournalCasReceipt {
  readonly writeId: string;
  readonly revision: number;
  readonly nonce: string;
  readonly parentNonce: string;
  readonly payloadDigest: string;
  readonly data: PrivateJournalCasJsonValue;
}

interface PrivateJournalCasBlob {
  readonly formatVersion: number;
  readonly keyHash: string;
  readonly revision: number;
  readonly nonce: string;
  readonly parentNonce: string | null;
  readonly writeId: string;
  readonly payloadDigest: string;
  readonly data: PrivateJournalCasJsonValue;
  readonly receipts: readonly PrivateJournalCasReceipt[];
}

interface BoundHead {
  readonly store: object;
  readonly revision: number;
  readonly nonce: string;
}

interface OwnedLock {
  readonly handle: FileHandle;
  readonly path: string;
  readonly metadata: FileStats;
}

const headOwners = new WeakMap<object, BoundHead>();
const inProcessQueues = new Map<string, Promise<void>>();

function errorCode(error: unknown): string | undefined {
  if (error !== null && typeof error === "object" && "code" in error &&
      typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

function sameFile(left: FileStats, right: FileStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function isRegularFile(metadata: FileStats): boolean {
  return metadata.isFile() &&
    (metadata.mode & fsConstants.S_IFMT) === fsConstants.S_IFREG;
}

function isPrivateFile(metadata: FileStats): boolean {
  return isRegularFile(metadata) && (metadata.mode & 0o7777) === PRIVATE_FILE_MODE;
}

function isPrivateDirectory(metadata: FileStats): boolean {
  return metadata.isDirectory() &&
    (metadata.mode & 0o7777) === PRIVATE_DIRECTORY_MODE;
}

function assertPosixPrivateFs(): void {
  const platform = process.platform;
  if (!["aix", "darwin", "freebsd", "linux", "openbsd", "sunos"].includes(platform)) {
    throw new PrivateJournalCasError("private journal CAS requires POSIX file permissions");
  }
  for (const flag of [
    fsConstants.O_RDONLY, fsConstants.O_WRONLY, fsConstants.O_CREAT,
    fsConstants.O_EXCL, fsConstants.O_NOFOLLOW, fsConstants.O_NONBLOCK,
    fsConstants.O_DIRECTORY,
    fsConstants.S_IFMT, fsConstants.S_IFREG
  ]) {
    if (!Number.isSafeInteger(flag) || flag < 0) {
      throw new PrivateJournalCasError("private journal CAS requires POSIX filesystem constants");
    }
  }
}

function requireText(value: unknown, field: string, maximum = MAX_TEXT_LENGTH): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    throw new PrivateJournalCasError(`${field} must be a non-empty bounded string`);
  }
  return value;
}

function descriptorRecord(value: object, field: string): Record<string, PropertyDescriptor> {
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new PrivateJournalCasError(`${field} has unreadable own descriptors`);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new PrivateJournalCasError(`${field} cannot contain symbol keys`);
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new PrivateJournalCasError(`${field}.${key} must be a data property`);
    }
  }
  return descriptors;
}

function normalizeJson(value: unknown, field: string, depth = 0): PrivateJournalCasJsonValue {
  if (depth > MAX_JSON_DEPTH) {
    throw new PrivateJournalCasError(`${field} exceeds the maximum JSON depth`);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > 16_384) throw new PrivateJournalCasError(`${field} string is too long`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PrivateJournalCasError(`${field} must contain finite numbers`);
    return value;
  }
  if (Array.isArray(value)) {
    const descriptors = descriptorRecord(value, field);
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !("value" in lengthDescriptor) ||
        typeof lengthDescriptor.value !== "number" ||
        !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
      throw new PrivateJournalCasError(`${field} has an invalid array length`);
    }
    const length = lengthDescriptor.value;
    const keys = Object.keys(descriptors).filter(key => key !== "length");
    if (keys.length !== length || keys.some((key, index) => key !== String(index))) {
      throw new PrivateJournalCasError(`${field} must be a dense array with no extra keys`);
    }
    return Array.from({ length }, (_, index) =>
      normalizeJson(descriptors[String(index)]!.value, `${field}[${index}]`, depth + 1)
    );
  }
  if (typeof value !== "object") {
    throw new PrivateJournalCasError(`${field} must contain only plain JSON values`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new PrivateJournalCasError(`${field} must contain only plain objects`);
  }
  const descriptors = descriptorRecord(value, field);
  const normalized: Record<string, PrivateJournalCasJsonValue> = Object.create(null) as Record<string, PrivateJournalCasJsonValue>;
  for (const key of Object.keys(descriptors).sort()) {
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable) {
      throw new PrivateJournalCasError(`${field}.${key} must be enumerable`);
    }
    normalized[key] = normalizeJson(descriptor.value, `${field}.${key}`, depth + 1);
  }
  return normalized;
}

function canonicalJson(value: PrivateJournalCasJsonValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PrivateJournalCasError("non-finite number in JSON value");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as { readonly [key: string]: PrivateJournalCasJsonValue };
  return `{${Object.keys(record).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalJson(record[key]!)}`).join(",")}}`;
}

function digestData(data: PrivateJournalCasJsonValue): string {
  // This detects accidental corruption. It is neither a MAC nor proof that a
  // stored journal or its producer is authentic.
  return createHash("sha256").update(canonicalJson(data), "utf8").digest("hex");
}

function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

function createBoundHead(
  store: object,
  revision: number,
  nonce: string
): PrivateJournalCasHead {
  const head = Object.freeze({ revision, nonce });
  headOwners.set(head, { store, revision, nonce });
  return head;
}

function readBoundHead(
  store: object,
  candidate: PrivateJournalCasHead
): BoundHead {
  if (candidate === null || typeof candidate !== "object") {
    throw new PrivateJournalCasConflictError("expectedHead must be a head returned by this store");
  }
  const bound = headOwners.get(candidate as object);
  if (!bound || bound.store !== store) {
    throw new PrivateJournalCasConflictError("expectedHead is not bound to this store");
  }
  return bound;
}

function assertBlobShape(value: unknown, field: string): PrivateJournalCasBlob {
  const normalized = normalizeJson(value, field);
  if (normalized === null || Array.isArray(normalized) || typeof normalized !== "object") {
    throw new PrivateJournalCasError(`${field} must be an object`);
  }
  const record = normalized as Record<string, PrivateJournalCasJsonValue>;
  const required = [
    "formatVersion", "keyHash", "revision", "nonce", "parentNonce", "writeId",
    "payloadDigest", "data", "receipts"
  ];
  const keys = Object.keys(record).sort();
  if (keys.length !== required.length || required.some(key => !Object.prototype.hasOwnProperty.call(record, key))) {
    throw new PrivateJournalCasError(`${field} has an invalid shape`);
  }
  const formatVersion = record.formatVersion;
  const revision = record.revision;
  const nonce = record.nonce;
  const parentNonce = record.parentNonce;
  const writeId = record.writeId;
  const payloadDigest = record.payloadDigest;
  const receipts = record.receipts;
  if (typeof formatVersion !== "number" || !Number.isSafeInteger(formatVersion) || formatVersion !== FORMAT_VERSION ||
      typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0 ||
      typeof nonce !== "string" || nonce.length === 0 ||
      !(parentNonce === null || (typeof parentNonce === "string" && parentNonce.length > 0)) ||
      typeof writeId !== "string" || writeId.length === 0 ||
      typeof payloadDigest !== "string" || !/^[0-9a-f]{64}$/.test(payloadDigest) ||
      !Array.isArray(receipts)) {
    throw new PrivateJournalCasError(`${field} has invalid head fields`);
  }
  if (revision === 0 && parentNonce !== null) {
    throw new PrivateJournalCasError(`${field} genesis parentNonce must be null`);
  }
  if (revision > 0 && parentNonce === null) {
    throw new PrivateJournalCasError(`${field} non-genesis parentNonce is required`);
  }
  const data = record.data!;
  if (digestData(data) !== payloadDigest) {
    throw new PrivateJournalCasError(`${field} payload digest does not match data`);
  }
  const parsedReceipts: PrivateJournalCasReceipt[] = [];
  const seenWriteIds = new Set<string>();
  for (const [index, rawReceipt] of receipts.entries()) {
    if (rawReceipt === null || typeof rawReceipt !== "object" || Array.isArray(rawReceipt)) {
      throw new PrivateJournalCasError(`${field}.receipts[${index}] must be an object`);
    }
    const receipt = rawReceipt as Record<string, PrivateJournalCasJsonValue>;
    const receiptKeys = Object.keys(receipt).sort();
    const expectedKeys = ["data", "nonce", "parentNonce", "payloadDigest", "revision", "writeId"];
    if (receiptKeys.length !== expectedKeys.length || expectedKeys.some(key => !Object.prototype.hasOwnProperty.call(receipt, key))) {
      throw new PrivateJournalCasError(`${field}.receipts[${index}] has an invalid shape`);
    }
    const receiptData = receipt.data!;
    const receiptWriteId = receipt.writeId;
    const receiptRevision = receipt.revision;
    const receiptNonce = receipt.nonce;
    const receiptParentNonce = receipt.parentNonce;
    const receiptDigest = receipt.payloadDigest;
    if (typeof receiptWriteId !== "string" || receiptWriteId.length === 0 || seenWriteIds.has(receiptWriteId) ||
        typeof receiptRevision !== "number" || !Number.isSafeInteger(receiptRevision) || receiptRevision < 0 ||
        typeof receiptNonce !== "string" || receiptNonce.length === 0 ||
        typeof receiptParentNonce !== "string" || receiptParentNonce.length === 0 ||
        typeof receiptDigest !== "string" || !/^[0-9a-f]{64}$/.test(receiptDigest) ||
        digestData(receiptData) !== receiptDigest) {
      throw new PrivateJournalCasError(`${field}.receipts[${index}] has invalid fields`);
    }
    seenWriteIds.add(receiptWriteId);
    parsedReceipts.push({
      writeId: receiptWriteId,
      revision: receiptRevision,
      nonce: receiptNonce,
      parentNonce: receiptParentNonce,
      payloadDigest: receiptDigest,
      data: receiptData
    });
  }
  if (revision === 0 && parsedReceipts.length !== 0) {
    throw new PrivateJournalCasError(`${field} genesis cannot contain commit receipts`);
  }
  if (parsedReceipts.length > 0) {
    const last = parsedReceipts[parsedReceipts.length - 1]!;
    if (last.revision !== revision || last.nonce !== nonce || last.writeId !== writeId ||
        last.parentNonce !== parentNonce || last.payloadDigest !== payloadDigest ||
        canonicalJson(last.data) !== canonicalJson(data)) {
      throw new PrivateJournalCasError(`${field} receipts do not end at the current head`);
    }
  } else if (revision > 0) {
    throw new PrivateJournalCasError(`${field} non-genesis head requires a receipt`);
  }
  if (parsedReceipts.length !== revision) {
    throw new PrivateJournalCasError(`${field} receipt count does not match revision`);
  }
  for (let index = 0; index < parsedReceipts.length; index++) {
    const receipt = parsedReceipts[index]!;
    if (receipt.revision !== index + 1 ||
        (index > 0 && receipt.parentNonce !== parsedReceipts[index - 1]!.nonce)) {
      throw new PrivateJournalCasError(`${field} receipts are not a contiguous chain`);
    }
  }
  return {
    formatVersion,
    keyHash: record.keyHash as string,
    revision,
    nonce,
    parentNonce,
    writeId,
    payloadDigest,
    data,
    receipts: parsedReceipts
  };
}

async function writeAll(handle: FileHandle, buffer: Buffer): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const result = await handle.write(buffer, offset);
    if (result.bytesWritten === 0) throw new PrivateJournalCasError("filesystem write made no progress");
    offset += result.bytesWritten;
  }
}

async function verifyPrivateFile(
  handle: FileHandle,
  filePath: string,
  expected?: FileStats
): Promise<FileStats> {
  const descriptor = await handle.stat();
  if (!isRegularFile(descriptor) || (expected && !sameFile(descriptor, expected))) {
    throw new PrivateJournalCasError(`private file is not the expected regular file: ${filePath}`);
  }
  const named = await lstat(filePath);
  if (!isPrivateFile(named) || !sameFile(named, descriptor)) {
    throw new PrivateJournalCasError(`private file is not protected or changed: ${filePath}`);
  }
  return descriptor;
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await verifyPrivateDirectory(directory);
}

async function verifyPrivateDirectory(directory: string): Promise<void> {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new PrivateJournalCasError(`private journal path is not a directory: ${directory}`);
  }
  const handle = await open(directory, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  try {
    const descriptor = await handle.stat();
    if (!descriptor.isDirectory()) throw new PrivateJournalCasError(`private journal path is not a directory: ${directory}`);
    const named = await lstat(directory);
    if (!isPrivateDirectory(descriptor) || !isPrivateDirectory(named) || !sameFile(descriptor, named)) {
      throw new PrivateJournalCasError(`private journal directory is not protected: ${directory}`);
    }
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory: string, requirePrivate = true): Promise<void> {
  const namedBefore = await lstat(directory);
  const handle = await open(directory, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  try {
    const descriptor = await handle.stat();
    if (!descriptor.isDirectory() || !namedBefore.isDirectory() ||
        (requirePrivate && (!isPrivateDirectory(descriptor) || !isPrivateDirectory(namedBefore))) ||
        !sameFile(descriptor, namedBefore)) {
      throw new PrivateJournalCasError(`private journal directory is not protected: ${directory}`);
    }
    await handle.sync();
    const namedAfter = await lstat(directory);
    const afterDescriptor = await handle.stat();
    if (!afterDescriptor.isDirectory() || !namedAfter.isDirectory() ||
        (requirePrivate && (!isPrivateDirectory(afterDescriptor) || !isPrivateDirectory(namedAfter))) ||
        !sameFile(afterDescriptor, namedAfter) || !sameFile(afterDescriptor, descriptor)) {
      throw new PrivateJournalCasError(`private journal directory changed during sync: ${directory}`);
    }
  } finally {
    await handle.close();
  }
}

async function openPrivateReadable(filePath: string): Promise<{ handle: FileHandle; metadata: FileStats }> {
  let handle: FileHandle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  } catch (error) {
    if (errorCode(error) === "ENOENT") throw new PrivateJournalCasError(`private journal head is missing: ${filePath}`);
    throw error;
  }
  try {
    const metadata = await verifyPrivateFile(handle, filePath);
    return { handle, metadata };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function readBlobFromHandle(
  opened: { handle: FileHandle; metadata: FileStats },
  filePath: string
): Promise<PrivateJournalCasBlob> {
  const size = opened.metadata.size;
  if (!Number.isSafeInteger(size) || size <= 0 || size > 64 * 1024 * 1024) {
    throw new PrivateJournalCasError("private journal head has an invalid size");
  }
  const buffer = Buffer.alloc(size);
  const result = await opened.handle.read(buffer, 0, size, 0);
  if (result.bytesRead !== size) throw new PrivateJournalCasError("private journal head is truncated");
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new PrivateJournalCasError("private journal head is not valid JSON");
  }
  const blob = assertBlobShape(parsed, "private journal head");
  await verifyPrivateFile(opened.handle, filePath, opened.metadata);
  return blob;
}

async function readDurableBlob(
  filePath: string,
  directory: string
): Promise<PrivateJournalCasBlob> {
  const opened = await openPrivateReadable(filePath);
  try {
    const blob = await readBlobFromHandle(opened, filePath);
    // The same protected inode that supplied the bytes must be synced before
    // the directory entry is synced and before its snapshot is exposed.
    try {
      await opened.handle.sync();
      await verifyPrivateFile(opened.handle, filePath, opened.metadata);
      await syncDirectory(directory);
      await verifyPrivateFile(opened.handle, filePath, opened.metadata);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new PrivateJournalCasDurabilityError(message);
    }
    return blob;
  } finally {
    await opened.handle.close();
  }
}

async function acquireLock(lockPath: string, keyHash: string, timeoutMs: number): Promise<OwnedLock> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    let handle: FileHandle | null = null;
    let metadata: FileStats | null = null;
    try {
      handle = await open(lockPath,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL |
          fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
        PRIVATE_FILE_MODE
      );
      metadata = await handle.stat();
      const owner = Buffer.from(`${process.pid}:${randomUUID()}\n`, "utf8");
      await writeAll(handle, owner);
      await handle.sync();
      await verifyPrivateFile(handle, lockPath, metadata);
      return { handle, path: lockPath, metadata };
    } catch (error) {
      if (handle && metadata) {
        const named = await lstat(lockPath).catch(() => null);
        if (named && sameFile(named, metadata)) await rm(lockPath, { force: true }).catch(() => undefined);
      }
      if (handle) await handle.close().catch(() => undefined);
      if (errorCode(error) !== "EEXIST" && errorCode(error) !== "EACCES") throw error;
      if (Date.now() >= deadline) throw new PrivateJournalCasLockBusyError(keyHash);
      await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
}

async function releaseLock(lock: OwnedLock): Promise<void> {
  const current = await lstat(lock.path);
  const actual = await lock.handle.stat();
  if (!isPrivateFile(current) || !sameFile(current, lock.metadata) || !sameFile(actual, lock.metadata)) {
    throw new PrivateJournalCasError("private journal lock ownership changed");
  }
  await rm(lock.path, { force: false });
  await lock.handle.close();
}

function enqueue<T>(queueKey: string, operation: () => Promise<T>): Promise<T> {
  const previous = inProcessQueues.get(queueKey) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const settled = result.then(() => undefined, () => undefined);
  inProcessQueues.set(queueKey, settled);
  return result.finally(() => {
    if (inProcessQueues.get(queueKey) === settled) inProcessQueues.delete(queueKey);
  });
}

class PrivateJournalCasStoreImpl<TData extends PrivateJournalCasJsonValue>
  implements PrivateJournalCasStore<TData> {
  private closed = false;
  private failed = false;

  constructor(
    readonly directory: string,
    readonly key: string,
    readonly keyHash: string,
    private readonly busyTimeoutMs: number,
    private readonly headPath: string,
    private readonly lockPath: string
  ) {}

  async load(): Promise<PrivateJournalCasSnapshot<TData>> {
    this.assertUsable();
    await this.verifyDirectories();
    let blob: PrivateJournalCasBlob;
    try {
      blob = await readDurableBlob(this.headPath, path.dirname(this.headPath));
    } catch (error) {
      if (error instanceof PrivateJournalCasDurabilityError) this.failed = true;
      throw error;
    }
    await this.verifyDirectories();
    this.assertKey(blob);
    return this.snapshot(blob);
  }

  async compareAndSwap(
    expectedHead: PrivateJournalCasHead,
    writeIdInput: string,
    nextDataInput: TData
  ): Promise<PrivateJournalCasCasResult<TData>> {
    this.assertUsable();
    const expected = readBoundHead(this, expectedHead);
    const writeId = requireText(writeIdInput, "writeId");
    if (writeId === "__genesis__") throw new PrivateJournalCasError("writeId is reserved");
    const nextData = normalizeJson(nextDataInput, "nextData") as TData;
    const payloadDigest = digestData(nextData);
    return enqueue(this.lockPath, async () => {
      this.assertUsable();
      await this.verifyDirectories();
      const lock = await acquireLock(this.lockPath, this.keyHash, this.busyTimeoutMs);
      try {
        await this.verifyDirectories();
        let current: PrivateJournalCasBlob;
        try {
          current = await readDurableBlob(this.headPath, path.dirname(this.headPath));
        } catch (error) {
          if (error instanceof PrivateJournalCasDurabilityError) this.failed = true;
          throw error;
        }
        await this.verifyDirectories();
        this.assertKey(current);
        const oldReceipt = current.receipts.find(receipt => receipt.writeId === writeId);
        if (oldReceipt) {
          if (oldReceipt.payloadDigest !== payloadDigest ||
              canonicalJson(oldReceipt.data) !== canonicalJson(nextData)) {
            return this.conflict(current, writeId, "write-id-conflict");
          }
          return {
            status: "duplicate" as const,
            writeId,
            head: createBoundHead(this, oldReceipt.revision, oldReceipt.nonce),
            data: cloneData(oldReceipt.data) as TData
          };
        }
        if (current.revision !== expected.revision || current.nonce !== expected.nonce) {
          return this.conflict(current, writeId, "stale-head");
        }
        const nextRevision = current.revision + 1;
        if (!Number.isSafeInteger(nextRevision)) throw new PrivateJournalCasError("journal revision overflow");
        const nextNonce = randomUUID();
        const receipt: PrivateJournalCasReceipt = {
          writeId,
          revision: nextRevision,
          nonce: nextNonce,
          parentNonce: current.nonce,
          payloadDigest,
          data: nextData
        };
        const nextBlob: PrivateJournalCasBlob = {
          formatVersion: FORMAT_VERSION,
          keyHash: this.keyHash,
          revision: nextRevision,
          nonce: nextNonce,
          parentNonce: current.nonce,
          writeId,
          payloadDigest,
          data: nextData,
          receipts: [...current.receipts, receipt]
        };
        await this.installBlob(nextBlob);
        return {
          status: "committed" as const,
          writeId,
          head: createBoundHead(this, nextRevision, nextNonce),
          data: cloneData(nextData) as TData
        };
      } finally {
        try {
          await releaseLock(lock);
        } catch (error) {
          this.failed = true;
          throw error;
        }
      }
    });
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private async installBlob(blob: PrivateJournalCasBlob): Promise<void> {
    const serialized = `${canonicalJson(normalizeJson(blob, "private journal blob"))}\n`;
    if (Buffer.byteLength(serialized, "utf8") > 64 * 1024 * 1024) {
      throw new PrivateJournalCasError("private journal head exceeds the supported size");
    }
    const temporaryPath = `${this.headPath}.${randomUUID()}.tmp`;
    let temporary: FileHandle | null = null;
    let owned: FileStats | null = null;
    try {
      temporary = await open(temporaryPath,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL |
          fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
        PRIVATE_FILE_MODE
      );
      owned = await temporary.stat();
      await verifyPrivateFile(temporary, temporaryPath, owned);
      await writeAll(temporary, Buffer.from(serialized, "utf8"));
      await temporary.sync();
      await verifyPrivateFile(temporary, temporaryPath, owned);
      const oldNamed = await lstat(this.headPath);
      if (!isPrivateFile(oldNamed)) throw new PrivateJournalCasError("private journal head changed before replacement");
      await rename(temporaryPath, this.headPath);
      await verifyPrivateFile(temporary, this.headPath, owned);
      await syncDirectory(path.dirname(this.headPath));
      await verifyPrivateFile(temporary, this.headPath, owned);
      await temporary.close();
      temporary = null;
    } catch (error) {
      this.failed = true;
      if (temporary && owned) {
        const current = await lstat(temporaryPath).catch(() => null);
        if (current && sameFile(current, owned)) {
          await rm(temporaryPath, { force: true }).catch(() => undefined);
        }
        await temporary.close().catch(() => undefined);
      }
      throw error;
    }
  }

  private snapshot(blob: PrivateJournalCasBlob): PrivateJournalCasSnapshot<TData> {
    return {
      head: createBoundHead(this, blob.revision, blob.nonce),
      data: cloneData(blob.data) as TData
    };
  }

  private conflict(
    blob: PrivateJournalCasBlob,
    writeId: string,
    reason: "stale-head" | "write-id-conflict"
  ): PrivateJournalCasCasResult<TData> {
    const current = this.snapshot(blob);
    return { status: "conflict", reason, current, currentHead: current.head, writeId };
  }

  private assertKey(blob: PrivateJournalCasBlob): void {
    if (blob.keyHash !== this.keyHash) throw new PrivateJournalCasError("private journal key identity mismatch");
  }

  private async verifyDirectories(): Promise<void> {
    await verifyPrivateDirectory(this.directory);
    await verifyPrivateDirectory(path.dirname(this.headPath));
  }

  private assertUsable(): void {
    if (this.failed) throw new PrivateJournalCasError("private journal CAS has an unresolved failed write; reopen it");
    if (this.closed) throw new PrivateJournalCasError("private journal CAS is closed");
  }
}

function cloneData<TData extends PrivateJournalCasJsonValue>(value: TData): TData {
  return normalizeJson(value, "stored data") as TData;
}

function normalizeOptions<TData>(options: PrivateJournalCasCreateOptions<TData> | PrivateJournalCasOpenOptions): {
  directory: string;
  key: string;
  keyHash: string;
  keyDirectory: string;
  headPath: string;
  lockPath: string;
  busyTimeoutMs: number;
} {
  const directory = requireText(options.directory, "directory", 4096);
  const key = requireText(options.key, "key", 4096);
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0 || busyTimeoutMs > 10_000) {
    throw new PrivateJournalCasError("busyTimeoutMs must be a safe integer from 0 through 10000");
  }
  const keyHash = hashKey(key);
  const keyDirectory = path.join(directory, keyHash);
  return {
    directory,
    key,
    keyHash,
    keyDirectory,
    headPath: path.join(keyDirectory, "head.json"),
    lockPath: path.join(keyDirectory, ".cas.lock"),
    busyTimeoutMs
  };
}

async function openStore<TData extends PrivateJournalCasJsonValue>(
  options: PrivateJournalCasOpenOptions
): Promise<PrivateJournalCasStoreImpl<TData>> {
  assertPosixPrivateFs();
  const normalized = normalizeOptions(options);
  await ensurePrivateDirectory(normalized.directory);
  await ensurePrivateDirectory(normalized.keyDirectory);
  const store = new PrivateJournalCasStoreImpl<TData>(
    normalized.directory,
    normalized.key,
    normalized.keyHash,
    normalized.busyTimeoutMs,
    normalized.headPath,
    normalized.lockPath
  );
  const blob = await readDurableBlob(normalized.headPath, normalized.keyDirectory);
  if (blob.keyHash !== normalized.keyHash) throw new PrivateJournalCasError("private journal key identity mismatch");
  return store;
}

export async function createPrivateJournalCasStore<TData extends PrivateJournalCasJsonValue = PrivateJournalCasJsonValue>(
  options: PrivateJournalCasCreateOptions<TData>
): Promise<PrivateJournalCasStore<TData>> {
  assertPosixPrivateFs();
  const normalized = normalizeOptions(options);
  await ensurePrivateDirectory(normalized.directory);
  await ensurePrivateDirectory(normalized.keyDirectory);
  await syncDirectory(path.dirname(path.resolve(normalized.directory)), false);
  // A newly created key directory must itself survive a crash before its head
  // can serve as a durable genesis for later commits.
  await syncDirectory(normalized.directory);
  const data = normalizeJson(options.genesisData, "genesisData") as TData;
  return enqueue(normalized.lockPath, async () => {
    const lock = await acquireLock(normalized.lockPath, normalized.keyHash, normalized.busyTimeoutMs);
    try {
      const existing = await lstat(normalized.headPath).catch(error => {
        if (errorCode(error) === "ENOENT") return null;
        throw error;
      });
      if (existing) throw new PrivateJournalCasConflictError("private journal key already exists");
      const genesis: PrivateJournalCasBlob = {
        formatVersion: FORMAT_VERSION,
        keyHash: normalized.keyHash,
        revision: 0,
        nonce: randomUUID(),
        parentNonce: null,
        writeId: "__genesis__",
        payloadDigest: digestData(data),
        data,
        receipts: []
      };
      const temporaryPath = `${normalized.headPath}.${randomUUID()}.tmp`;
      let temporary: FileHandle | null = null;
      let owned: FileStats | null = null;
      try {
        temporary = await open(temporaryPath,
          fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL |
            fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
          PRIVATE_FILE_MODE
        );
        owned = await temporary.stat();
        await verifyPrivateFile(temporary, temporaryPath, owned);
        await writeAll(temporary, Buffer.from(`${canonicalJson(normalizeJson(genesis, "genesis"))}\n`, "utf8"));
        await temporary.sync();
        await verifyPrivateFile(temporary, temporaryPath, owned);
        await rename(temporaryPath, normalized.headPath);
        await verifyPrivateFile(temporary, normalized.headPath, owned);
        await syncDirectory(normalized.keyDirectory);
        await verifyPrivateFile(temporary, normalized.headPath, owned);
        await temporary.close();
        temporary = null;
      } catch (error) {
        if (temporary && owned) {
          const current = await lstat(temporaryPath).catch(() => null);
          if (current && sameFile(current, owned)) await rm(temporaryPath, { force: true }).catch(() => undefined);
          await temporary.close().catch(() => undefined);
        }
        throw error;
      }
      return new PrivateJournalCasStoreImpl<TData>(
        normalized.directory,
        normalized.key,
        normalized.keyHash,
        normalized.busyTimeoutMs,
        normalized.headPath,
        normalized.lockPath
      );
    } finally {
      await releaseLock(lock);
    }
  });
}

export async function openPrivateJournalCasStore<TData extends PrivateJournalCasJsonValue = PrivateJournalCasJsonValue>(
  options: PrivateJournalCasOpenOptions
): Promise<PrivateJournalCasStore<TData>> {
  return openStore<TData>(options);
}

