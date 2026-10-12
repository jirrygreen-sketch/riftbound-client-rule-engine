import type { JsonObject, JsonValue } from "./json.js";

export const FILE_STORE_FORMAT_VERSION = 1;

export interface RequestSignature {
  readonly requestId: string;
  readonly commandId?: string;
  readonly command?: JsonValue;
}

export interface StoredRequest {
  readonly requestId: string;
  readonly commandId?: string;
  readonly command?: JsonValue;
  readonly eventSeq: number | null;
  readonly response?: JsonValue;
}

export interface EventEntryInput<TEvent extends JsonObject> {
  readonly eventSeq: number;
  readonly event: TEvent;
}

export interface PersistedEvent<TEvent extends JsonObject> {
  readonly eventSeq: number;
  readonly event: TEvent;
  readonly request?: StoredRequest;
}

export interface AppendEventsInput<TEvent extends JsonObject> {
  readonly events: readonly EventEntryInput<TEvent>[];
  readonly request?: RequestSignature;
  readonly response?: JsonValue;
}

export interface AppendRequestInput {
  readonly request: RequestSignature;
  readonly response?: JsonValue;
}

export interface AppendEventsOutcome<TEvent extends JsonObject> {
  readonly events: readonly PersistedEvent<TEvent>[];
  readonly duplicate: boolean;
}

export interface AppendRequestOutcome {
  readonly request: StoredRequest;
  readonly duplicate: boolean;
}

export interface EventWindow<TEvent extends JsonObject> {
  readonly afterEventSeq: number;
  readonly headEventSeq: number;
  readonly events: readonly PersistedEvent<TEvent>[];
}

export interface SnapshotInput<TSnapshot extends JsonObject> {
  readonly eventSeq: number;
  readonly payload: TSnapshot;
}

export interface StoredSnapshot<TSnapshot extends JsonObject> {
  readonly eventSeq: number;
  readonly payload: TSnapshot;
}

export interface FileEventStoreOptions {
  readonly eventLogPath: string;
  readonly snapshotPath: string;
  readonly snapshotMode?: "authoritative" | "ignored";
}

export interface OpenedFileEventStore {
  readonly headEventSeq: number;
  readonly truncatedTailBytes: number;
}

export interface EventPersistenceStore<
  TEvent extends JsonObject,
  TSnapshot extends JsonObject
> {
  appendEvents(input: AppendEventsInput<TEvent>): Promise<AppendEventsOutcome<TEvent>>;
  appendRequest(input: AppendRequestInput): Promise<AppendRequestOutcome>;
  getRequest(requestId: string): Promise<StoredRequest | null>;
  readEvents(afterEventSeq: number, limit?: number): Promise<EventWindow<TEvent>>;
  saveSnapshot(input: SnapshotInput<TSnapshot>): Promise<StoredSnapshot<TSnapshot>>;
  readSnapshot(): Promise<StoredSnapshot<TSnapshot> | null>;
  close(): Promise<void>;
}
