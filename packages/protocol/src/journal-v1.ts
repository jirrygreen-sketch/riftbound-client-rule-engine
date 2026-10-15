import type { FullProductCommand } from "./full-product-contract.js";

declare const process: {
  getBuiltinModule(name: "node:crypto"): {
    createHash(algorithm: "sha256"): {
      update(value: string, encoding: "utf8"): { digest(encoding: "hex"): string };
    };
  };
};

export const JOURNAL_FORMAT = "riftbound-journal" as const;
export const JOURNAL_FORMAT_VERSION = 1 as const;
export const JOURNAL_RULESET_VERSION = "core-1.5" as const;

export type JournalJsonValue =
  | null | boolean | number | string
  | readonly JournalJsonValue[]
  | JournalJsonObject;

export interface JournalJsonObject {
  readonly [key: string]: JournalJsonValue;
}

export type JournalEntropy =
  | { kind: "random"; bound: number; value: number }
  | { kind: "uid"; value: string };

export interface SeatInfo {
  playerId: string;
  name: string;
}

export interface JournalHeader {
  format: typeof JOURNAL_FORMAT;
  formatVersion: typeof JOURNAL_FORMAT_VERSION;
  engineVersion: string;
  rulesetVersion: typeof JOURNAL_RULESET_VERSION;
  matchId: string;
  roomId: string;
  catalogDigest: string;
  rosterDigest: string;
  trustedDeckDigest: string;
  seed: string;
  seats: SeatInfo[];
  createdAt: string;
  creation: {
    entropy: JournalEntropy[];
    deterministicSeed: string;
    uidSeed: string | null;
    creator: string;
  };
}

export interface JournalHead {
  stateVersion: number;
  eventSeq: number;
  roomVersion: number;
  parentJournalDigest: string | null;
  journalDigest: string;
  stateDigest: string;
  privateStateDigest: string;
}

export interface JournalDigestLink {
  parentDigest: string | null;
  currentDigest: string;
}

export interface JournalIntegrity extends JournalDigestLink {
  revision: number;
  nonce: string;
  protectedHeadReference: { revision: number; nonce: string };
}

// TODO: Replace FullProductCommand with the unified command union in the convergence task.
export type JournalCommand = FullProductCommand;

export interface JournalEntry {
  kind: "entry";
  seq: number;
  playerId: string;
  actor: string;
  requestId: string;
  commandId: string;
  command: JournalCommand;
  payload: JournalCommand;
  acceptedAt: string;
  expectedStateVersion: number;
  expectedRoomVersion: number;
  appliedStateVersion: number;
  roomVersion: number;
  eventSeq: number;
  result: JournalJsonObject;
  publicReceipt: JournalJsonObject;
  duplicate: boolean;
  rejection: null;
  entropyConsumed: JournalEntropy[];
  projectionDigestByViewer: Record<string, string>;
  integrity: JournalDigestLink;
}

export interface JournalOperation {
  kind: "operation";
  seq: number;
  operationId: string;
  taskId: string;
  phase: string;
  stateVersion: number;
  eventSeq: number;
  roomVersion: number;
  sourceClosureEvidence: JournalJsonObject[];
  costCensus: JournalJsonObject | null;
  paymentPlan: JournalJsonObject | null;
  paymentReceipt: JournalJsonObject | null;
  effectIRDigest: string | null;
  primitiveReceipts: JournalJsonObject[];
  tokenBirths: JournalJsonObject[];
  tokenRetirements: JournalJsonObject[];
  zoneTransitions: JournalJsonObject[];
  pendingReason: string | null;
  entropyConsumed: JournalEntropy[];
  integrity: JournalDigestLink;
}

export type JournalRecord = JournalEntry | JournalOperation;
export type JournalRecordInput =
  | Omit<JournalEntry, "integrity">
  | Omit<JournalOperation, "integrity">;

export interface Journal {
  header: JournalHeader;
  head: JournalHead;
  entries: JournalRecord[];
  integrity: JournalIntegrity;
}

function data(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
    return Reflect.ownKeys(value).every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return typeof key === "string" && descriptor !== undefined &&
        descriptor.enumerable && "value" in descriptor;
    });
  } catch {
    return false;
  }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length &&
    expected.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function text(value: unknown, maximumLength = 512): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= maximumLength && value.trim() === value;
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function canonicalValue(value: unknown, depth: number): string {
  if (depth >= 64) throw new TypeError("Journal JSON nesting limit exceeded");
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype ||
        Reflect.ownKeys(value).length !== value.length + 1) {
      throw new TypeError("Journal JSON arrays must be dense data arrays");
    }
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError("Journal JSON array items must be data properties");
      }
      items.push(canonicalValue(descriptor.value, depth + 1));
    }
    return `[${items.join(",")}]`;
  }
  if (!data(value)) throw new TypeError("Journal values must be ordinary finite JSON data");
  return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalValue(value[key], depth + 1)}`).join(",")}}`;
}

export function canonicalJournalJson(value: unknown): string {
  return canonicalValue(value, 0);
}

function jsonData(value: unknown): boolean {
  try {
    canonicalJournalJson(value);
    return true;
  } catch {
    return false;
  }
}

function jsonObject(value: unknown): value is JournalJsonObject {
  return data(value) && jsonData(value);
}

function jsonObjects(value: unknown): value is JournalJsonObject[] {
  return Array.isArray(value) && jsonData(value) && value.every(jsonObject);
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJournalJson(left) === canonicalJournalJson(right);
}

function hash(value: unknown): string {
  return process.getBuiltinModule("node:crypto").createHash("sha256")
    .update(canonicalJournalJson(value), "utf8").digest("hex");
}

function isEntropy(value: unknown): value is JournalEntropy[] {
  return Array.isArray(value) && jsonData(value) && value.every(item =>
    data(item) && (item.kind === "uid"
      ? exactKeys(item, ["kind", "value"]) && text(item.value, 256)
      : item.kind === "random" && exactKeys(item, ["kind", "bound", "value"]) &&
        count(item.bound) && item.bound > 0 && count(item.value) && item.value < item.bound));
}

function isSeatInfo(value: unknown): value is SeatInfo {
  return data(value) && exactKeys(value, ["playerId", "name"]) &&
    text(value.playerId, 256) && text(value.name, 128);
}

function isTargetArray(value: unknown): boolean {
  if (!Array.isArray(value) || !jsonData(value)) return false;
  const keys = new Set<string>();
  for (const target of value) {
    if (!data(target) || !exactKeys(target, ["targetKind", "targetId"]) ||
        (target.targetKind !== "object" && target.targetKind !== "player") ||
        !text(target.targetId, 256)) return false;
    const key = `${target.targetKind}:${target.targetId}`;
    if (keys.has(key)) return false;
    keys.add(key);
  }
  return true;
}

function isJournalCommand(value: unknown): value is JournalCommand {
  if (!data(value)) return false;
  switch (value.type) {
    case "pass":
    case "concede":
      return exactKeys(value, ["type"]);
    case "play-card":
      return exactKeys(value, ["type", "instanceId", "targets"]) &&
        text(value.instanceId, 256) && isTargetArray(value.targets);
    case "respond-to-prompt":
      return exactKeys(value, ["type", "promptId", "optionId", "targets"]) &&
        text(value.promptId, 256) && text(value.optionId, 256) && isTargetArray(value.targets);
    default:
      return false;
  }
}

export function isJournalHeader(value: unknown): value is JournalHeader {
  if (!data(value) || !exactKeys(value, [
    "format", "formatVersion", "engineVersion", "rulesetVersion", "matchId", "roomId",
    "catalogDigest", "rosterDigest", "trustedDeckDigest", "seed", "seats", "createdAt", "creation"
  ]) || !jsonData(value)) return false;
  if (value.format !== JOURNAL_FORMAT || value.formatVersion !== JOURNAL_FORMAT_VERSION ||
      value.rulesetVersion !== JOURNAL_RULESET_VERSION ||
      ![value.engineVersion, value.matchId, value.roomId, value.catalogDigest,
        value.rosterDigest, value.trustedDeckDigest, value.seed, value.createdAt].every(item => text(item)) ||
      !Array.isArray(value.seats) || value.seats.length === 0 || !value.seats.every(isSeatInfo) ||
      !data(value.creation) || !exactKeys(value.creation, ["entropy", "deterministicSeed", "uidSeed", "creator"]) ||
      !isEntropy(value.creation.entropy) || !text(value.creation.deterministicSeed) ||
      value.creation.deterministicSeed !== value.seed ||
      (value.creation.uidSeed !== null && !text(value.creation.uidSeed)) ||
      !text(value.creation.creator, 256)) return false;
  return new Set(value.seats.map(seat => seat.playerId)).size === value.seats.length;
}

export function isJournalHead(value: unknown): value is JournalHead {
  return data(value) && exactKeys(value, [
    "stateVersion", "eventSeq", "roomVersion", "parentJournalDigest", "journalDigest", "stateDigest", "privateStateDigest"
  ]) && count(value.stateVersion) && count(value.eventSeq) && count(value.roomVersion) &&
    (value.parentJournalDigest === null || digest(value.parentJournalDigest)) &&
    digest(value.journalDigest) && digest(value.stateDigest) && digest(value.privateStateDigest);
}

function isDigestLink(value: unknown): value is JournalDigestLink {
  return data(value) && exactKeys(value, ["parentDigest", "currentDigest"]) &&
    (value.parentDigest === null || digest(value.parentDigest)) && digest(value.currentDigest);
}

export function isJournalIntegrity(value: unknown): value is JournalIntegrity {
  return data(value) && exactKeys(value, [
    "parentDigest", "currentDigest", "revision", "nonce", "protectedHeadReference"
  ]) && (value.parentDigest === null || digest(value.parentDigest)) && digest(value.currentDigest) &&
    count(value.revision) && text(value.nonce) && data(value.protectedHeadReference) &&
    exactKeys(value.protectedHeadReference, ["revision", "nonce"]) &&
    value.protectedHeadReference.revision === value.revision &&
    value.protectedHeadReference.nonce === value.nonce &&
    (value.revision === 0 ? value.parentDigest === null : value.parentDigest !== null);
}

function acceptedResult(value: unknown): value is JournalJsonObject {
  return jsonObject(value) && value.accepted !== false && value.ok !== false && value.rejected !== true &&
    (value.rejection === undefined || value.rejection === null) &&
    (value.error === undefined || value.error === null) &&
    !["rejected", "rejection", "error", "blocked"].includes(value.status as string) &&
    !["rejected", "error", "blocked"].includes(value.type as string);
}

export function isJournalEntry(value: unknown): value is JournalEntry {
  return data(value) && exactKeys(value, [
    "kind", "seq", "playerId", "actor", "requestId", "commandId", "command", "payload", "acceptedAt",
    "expectedStateVersion", "expectedRoomVersion", "appliedStateVersion", "roomVersion", "eventSeq",
    "result", "publicReceipt", "duplicate", "rejection", "entropyConsumed", "projectionDigestByViewer", "integrity"
  ]) && jsonData(value) && value.kind === "entry" && count(value.seq) && value.seq > 0 &&
    text(value.playerId, 256) && value.actor === value.playerId && text(value.requestId, 256) &&
    text(value.commandId, 256) && isJournalCommand(value.command) && isJournalCommand(value.payload) &&
    same(value.command, value.payload) && text(value.acceptedAt) && count(value.expectedStateVersion) &&
    count(value.expectedRoomVersion) && count(value.appliedStateVersion) && count(value.roomVersion) &&
    count(value.eventSeq) && value.appliedStateVersion >= value.expectedStateVersion &&
    value.roomVersion >= value.expectedRoomVersion && acceptedResult(value.result) &&
    acceptedResult(value.publicReceipt) && typeof value.duplicate === "boolean" && value.rejection === null &&
    isEntropy(value.entropyConsumed) && data(value.projectionDigestByViewer) &&
    Object.entries(value.projectionDigestByViewer).every(([viewer, item]) => text(viewer, 256) && digest(item)) &&
    isDigestLink(value.integrity) && value.integrity.parentDigest !== null;
}

export function isJournalOperation(value: unknown): value is JournalOperation {
  return data(value) && exactKeys(value, [
    "kind", "seq", "operationId", "taskId", "phase", "stateVersion", "eventSeq", "roomVersion",
    "sourceClosureEvidence", "costCensus", "paymentPlan", "paymentReceipt", "effectIRDigest",
    "primitiveReceipts", "tokenBirths", "tokenRetirements", "zoneTransitions", "pendingReason", "entropyConsumed", "integrity"
  ]) && jsonData(value) && value.kind === "operation" && count(value.seq) && value.seq > 0 &&
    text(value.operationId, 256) && text(value.taskId, 256) && text(value.phase, 256) &&
    count(value.stateVersion) && count(value.eventSeq) && count(value.roomVersion) &&
    jsonObjects(value.sourceClosureEvidence) && (value.costCensus === null || jsonObject(value.costCensus)) &&
    (value.paymentPlan === null || jsonObject(value.paymentPlan)) &&
    (value.paymentReceipt === null || jsonObject(value.paymentReceipt)) &&
    (value.effectIRDigest === null || digest(value.effectIRDigest)) && jsonObjects(value.primitiveReceipts) &&
    jsonObjects(value.tokenBirths) && jsonObjects(value.tokenRetirements) && jsonObjects(value.zoneTransitions) &&
    (value.pendingReason === null || text(value.pendingReason, 4096)) && isEntropy(value.entropyConsumed) &&
    isDigestLink(value.integrity) && value.integrity.parentDigest !== null;
}

export function isJournalEntries(value: unknown, seats?: readonly SeatInfo[]): value is JournalRecord[] {
  if (!Array.isArray(value) || !jsonData(value)) return false;
  const commands = new Map<string, JournalEntry>();
  const operations = new Set<string>();
  const players = seats === undefined ? null : new Set(seats.map(seat => seat.playerId));
  let stateVersion: number | undefined;
  let roomVersion: number | undefined;
  let eventSeq = 0;
  for (const [index, record] of value.entries()) {
    if (isJournalOperation(record)) {
      if (record.seq !== index + 1 || operations.has(record.operationId) ||
          record.stateVersion < (stateVersion ?? 0) || record.roomVersion < (roomVersion ?? 0) ||
          record.eventSeq < eventSeq) return false;
      operations.add(record.operationId);
      stateVersion = record.stateVersion;
      roomVersion = record.roomVersion;
    } else if (isJournalEntry(record)) {
      if (record.seq !== index + 1 || (players !== null && !players.has(record.playerId)) ||
          record.eventSeq < eventSeq) return false;
      const original = commands.get(record.commandId);
      if (record.duplicate) {
        if (!original || record.actor !== original.actor || !same(record.command, original.command) ||
            record.expectedStateVersion !== original.expectedStateVersion ||
            record.expectedRoomVersion !== original.expectedRoomVersion ||
            !same(record.result, original.result) || !same(record.publicReceipt, original.publicReceipt) ||
            record.appliedStateVersion !== stateVersion || record.roomVersion !== roomVersion ||
            record.eventSeq !== eventSeq || record.entropyConsumed.length !== 0) return false;
      } else {
        if (original || record.expectedStateVersion !== (stateVersion ?? record.expectedStateVersion) ||
            record.expectedRoomVersion !== (roomVersion ?? record.expectedRoomVersion) ||
            record.appliedStateVersion <= record.expectedStateVersion) return false;
        commands.set(record.commandId, record);
        stateVersion = record.appliedStateVersion;
        roomVersion = record.roomVersion;
      }
    } else {
      return false;
    }
    eventSeq = record.eventSeq;
  }
  return true;
}

export function computeJournalHeaderDigest(header: JournalHeader): string {
  if (!isJournalHeader(header)) throw new TypeError("Invalid journal header");
  return hash(header);
}

export function computeJournalRecordDigest(record: JournalRecordInput | JournalRecord, parentDigest: string): string {
  if (!digest(parentDigest) || !data(record) || !jsonData(record)) {
    throw new TypeError("Invalid journal digest input");
  }
  const body = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "integrity"));
  return hash({ parentDigest, record: body });
}

export function createJournalRecordIntegrity(record: JournalRecordInput, parentDigest: string): JournalDigestLink {
  return { parentDigest, currentDigest: computeJournalRecordDigest(record, parentDigest) };
}

export function verifyJournalDigestChain(header: unknown, entries: unknown): boolean {
  if (!isJournalHeader(header) || !isJournalEntries(entries, header.seats)) return false;
  let parentDigest = computeJournalHeaderDigest(header);
  for (const record of entries) {
    if (record.integrity.parentDigest !== parentDigest ||
        record.integrity.currentDigest !== computeJournalRecordDigest(record, parentDigest)) return false;
    parentDigest = record.integrity.currentDigest;
  }
  return true;
}

export function computeJournalDigest(journal: Journal): string {
  if (!data(journal) || !jsonData(journal) || !isJournalHeader(journal.header) ||
      !isJournalHead(journal.head) || !isJournalIntegrity(journal.integrity) ||
      !isJournalEntries(journal.entries, journal.header.seats)) {
    throw new TypeError("Invalid journal digest input");
  }
  const { journalDigest: _journalDigest, ...head } = journal.head;
  const { currentDigest: _currentDigest, ...integrity } = journal.integrity;
  return hash({ header: journal.header, head, entries: journal.entries, integrity });
}

export function isJournal(value: unknown): value is Journal {
  if (!data(value) || !exactKeys(value, ["header", "head", "entries", "integrity"]) ||
      !jsonData(value) || !isJournalHeader(value.header) || !isJournalHead(value.head) ||
      !isJournalIntegrity(value.integrity) || !isJournalEntries(value.entries, value.header.seats) ||
      value.head.parentJournalDigest !== value.integrity.parentDigest ||
      value.head.journalDigest !== value.integrity.currentDigest ||
      !verifyJournalDigestChain(value.header, value.entries)) return false;
  const last = value.entries.at(-1);
  if (last && (value.head.stateVersion !== (last.kind === "entry" ? last.appliedStateVersion : last.stateVersion) ||
      value.head.eventSeq !== last.eventSeq || value.head.roomVersion !== last.roomVersion)) return false;
  return value.integrity.currentDigest === computeJournalDigest(value as unknown as Journal);
}

export const validateJournalHeader = isJournalHeader;
export const validateJournalHead = isJournalHead;
export const validateJournalIntegrity = isJournalIntegrity;
export const validateJournalEntry = isJournalEntry;
export const validateJournalOperation = isJournalOperation;
export const validateJournalEntries = isJournalEntries;
export const validateJournal = isJournal;

function parseJsonLine(line: string, lineNumber: number): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch (error) {
    throw new SyntaxError(`Invalid journal JSON on line ${lineNumber}: ${
      error instanceof Error ? error.message : String(error)
    }`);
  }
}

export function parseJournalJsonl(serialized: string): Journal {
  if (typeof serialized !== "string") throw new TypeError("Journal JSONL must be a string");
  const lines = serialized.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0 || lines.some(line => line.trim() === "")) {
    throw new SyntaxError("Journal JSONL must contain one JSON value per line");
  }
  const first = parseJsonLine(lines[0]!, 1);
  if (!data(first) || first.kind !== "header") throw new TypeError("Journal JSONL must start with a header");
  const { kind: _kind, head, integrity, ...header } = first;
  const entries = lines.slice(1).map((line, index) => parseJsonLine(line, index + 2));
  const journal = { header, head, entries, integrity };
  if (!isJournal(journal)) throw new TypeError("Journal JSONL does not match journal format v1");
  return journal;
}

export function serializeJournalJsonl(journal: Journal): string {
  if (!isJournal(journal)) throw new TypeError("Journal does not match journal format v1");
  return [
    canonicalJournalJson({ kind: "header", ...journal.header, head: journal.head, integrity: journal.integrity }),
    ...journal.entries.map(record => canonicalJournalJson(record))
  ].join("\n") + "\n";
}
