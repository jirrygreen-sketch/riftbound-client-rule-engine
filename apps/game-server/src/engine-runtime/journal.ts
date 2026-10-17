import { createHash } from "node:crypto";
import type { V2Command } from "../../../../packages/protocol/dist/v2/commands.js";

export const ENGINE_RUNTIME_JOURNAL_FORMAT = "riftbound-journal" as const;
export const ENGINE_RUNTIME_JOURNAL_VERSION = 1 as const;
export const ENGINE_RUNTIME_RULESET_VERSION = "core-1.5" as const;

export interface RuntimeJournalSeat { readonly playerId: string; readonly name: string }

export interface RuntimeJournalHeader {
  readonly format: typeof ENGINE_RUNTIME_JOURNAL_FORMAT;
  readonly formatVersion: typeof ENGINE_RUNTIME_JOURNAL_VERSION;
  readonly engineVersion: string;
  readonly rulesetVersion: typeof ENGINE_RUNTIME_RULESET_VERSION;
  readonly matchId: string;
  readonly roomId: string;
  readonly catalogDigest: string;
  readonly rosterDigest: string;
  readonly trustedDeckDigest: string;
  readonly seed: string;
  readonly seats: readonly RuntimeJournalSeat[];
  readonly createdAt: string;
  readonly creation: {
    readonly entropy: readonly { readonly kind: "random" | "uid"; readonly bound?: number; readonly value: string | number }[];
    readonly deterministicSeed: string;
    readonly uidSeed: string | null;
    readonly creator: string;
  };
}

export interface RuntimeJournalHead {
  readonly stateVersion: number;
  readonly eventSeq: number;
  readonly roomVersion: number;
  readonly parentJournalDigest: string | null;
  readonly journalDigest: string;
  readonly stateDigest: string;
  readonly privateStateDigest: string;
}

export interface RuntimeJournalEntry {
  readonly kind: "entry";
  readonly seq: number;
  readonly playerId: string;
  readonly actor: string;
  readonly requestId: string;
  readonly commandId: string;
  readonly command: V2Command;
  readonly payload: V2Command;
  readonly acceptedAt: string;
  readonly expectedStateVersion: number;
  readonly expectedRoomVersion: number;
  readonly appliedStateVersion: number;
  readonly roomVersion: number;
  readonly eventSeq: number;
  readonly result: Record<string, unknown>;
  readonly publicReceipt: Record<string, unknown>;
  readonly duplicate: boolean;
  readonly rejection: null;
  /** Present when the command was accepted far enough to suspend on a choice. */
  readonly pendingReason?: Readonly<Record<string, unknown>>;
  readonly entropyConsumed: readonly unknown[];
  readonly projectionDigestByViewer: Readonly<Record<string, string>>;
  readonly integrity: { readonly parentDigest: string; readonly currentDigest: string };
}

export interface RuntimeJournal {
  readonly header: RuntimeJournalHeader;
  readonly head: RuntimeJournalHead;
  readonly entries: readonly RuntimeJournalEntry[];
  readonly integrity: {
    readonly parentDigest: string | null;
    readonly currentDigest: string;
    readonly revision: number;
    readonly nonce: string;
    readonly protectedHeadReference: { readonly revision: number; readonly nonce: string };
  };
}

export interface RuntimeJournalInput {
  readonly header: Omit<RuntimeJournalHeader, "format" | "formatVersion" | "rulesetVersion">;
  readonly stateDigest: string;
  readonly privateStateDigest: string;
}

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") throw new TypeError("Journal values must be JSON data");
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export class RuntimeJournalWriter {
  private value: RuntimeJournal;

  constructor(input: RuntimeJournalInput | RuntimeJournal) {
    if (isRuntimeJournal(input)) this.value = structuredClone(input);
    else {
      const header = {
        format: ENGINE_RUNTIME_JOURNAL_FORMAT,
        formatVersion: ENGINE_RUNTIME_JOURNAL_VERSION,
        rulesetVersion: ENGINE_RUNTIME_RULESET_VERSION,
        ...structuredClone(input.header),
      } as RuntimeJournalHeader;
      const nonce = digest([header.matchId, header.seed, header.engineVersion]);
      const head = {
        stateVersion: 0, eventSeq: 0, roomVersion: 0, parentJournalDigest: null,
        journalDigest: "0".repeat(64), stateDigest: input.stateDigest, privateStateDigest: input.privateStateDigest,
      } as RuntimeJournalHead;
      const integrity = { parentDigest: null, currentDigest: "0".repeat(64), revision: 0, nonce, protectedHeadReference: { revision: 0, nonce } };
      const currentDigest = digest({ header, head, entries: [], integrity: { ...integrity, currentDigest: "0".repeat(64) } });
      this.value = { header, head: { ...head, journalDigest: currentDigest }, entries: [], integrity: { ...integrity, currentDigest } };
    }
  }

  snapshot(): RuntimeJournal { return structuredClone(this.value); }

  append(input: Omit<RuntimeJournalEntry, "kind" | "seq" | "integrity">): RuntimeJournalEntry {
    const parentDigest = this.value.integrity.currentDigest;
    const seq = this.value.entries.length + 1;
    const base = { kind: "entry" as const, seq, ...structuredClone(input) };
    const currentDigest = digest({ ...base, integrity: { parentDigest, currentDigest: "0".repeat(64) } });
    const entry = { ...base, integrity: { parentDigest, currentDigest } };
    const head = {
      ...this.value.head,
      stateVersion: entry.appliedStateVersion,
      eventSeq: entry.eventSeq,
      roomVersion: entry.roomVersion,
      parentJournalDigest: parentDigest,
      journalDigest: "0".repeat(64),
      stateDigest: digest(entry.result),
      privateStateDigest: digest({ entry, prior: this.value.head.privateStateDigest }),
    };
    const integrity = {
      ...this.value.integrity,
      parentDigest,
      currentDigest: "0".repeat(64),
      revision: this.value.integrity.revision + 1,
      protectedHeadReference: { revision: this.value.integrity.revision + 1, nonce: this.value.integrity.nonce },
    };
    const journalDigest = digest({ header: this.value.header, head, entries: [...this.value.entries, entry], integrity });
    this.value = { header: this.value.header, head: { ...head, journalDigest }, entries: [...this.value.entries, entry], integrity: { ...integrity, currentDigest: journalDigest } };
    return structuredClone(entry);
  }
}

export function isRuntimeJournal(value: unknown): value is RuntimeJournal {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RuntimeJournal>;
  return candidate.header?.format === ENGINE_RUNTIME_JOURNAL_FORMAT && candidate.header.formatVersion === 1 &&
    candidate.header.rulesetVersion === ENGINE_RUNTIME_RULESET_VERSION && Array.isArray(candidate.entries) &&
    candidate.head !== undefined && candidate.integrity !== undefined;
}
