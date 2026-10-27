import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  assertRuntimeJournal,
  canonicalJson,
  createEngineRuntime,
  digest,
  RuntimeJournalWriter,
  type EngineRuntimeDeck,
  type RuntimeJournal,
} from "../../src/engine-runtime/index.js";

import {
  createProgramBinding,
  type ProgramBinding,
} from "../../../../packages/engine-core/dist/programs/index.js";
import { ChainEngine } from "../../../../packages/engine-core/dist/chain/engine.js";
import { createActionPipelineHost } from "../../../../packages/engine-core/dist/events/action-adapter.js";

interface CatalogCard {
  readonly zone: "legend" | "champion" | "mainDeck" | "battlefields" | "runes";
  readonly canonicalCardId: string;
  readonly name: string;
  readonly quantity: number;
  readonly cardType: string;
}

interface CatalogCandidate {
  readonly id: string;
  readonly chosenChampion: string;
  readonly officialCardList: readonly CatalogCard[];
}

interface Catalog {
  readonly candidates: readonly CatalogCandidate[];
}

const catalog = await import("../../../../docs/plans/m1-decks.json", {
  with: { type: "json" },
}).then(module => module.default as Catalog);

function deck(candidateId: string): EngineRuntimeDeck {
  const candidate = catalog.candidates.find(entry => entry.id === candidateId);
  if (candidate === undefined) throw new Error(`Unknown M1 candidate ${candidateId}`);
  const expand = (entries: readonly CatalogCard[], zone: string) => entries.flatMap(entry =>
    Array.from({ length: entry.quantity }, (_, index) => ({
      id: `${candidate.id}:${zone}:${index}:${entry.canonicalCardId}`,
      cardId: entry.canonicalCardId,
      name: entry.name,
      types: [entry.cardType.toLowerCase()],
      energy: null,
      power: null,
    })));
  const legend = candidate.officialCardList.find(entry => entry.zone === "legend");
  const chosen = candidate.officialCardList.find(entry =>
    entry.zone === "champion" && entry.name === candidate.chosenChampion);
  if (legend === undefined || chosen === undefined) throw new Error(`Incomplete M1 candidate ${candidateId}`);
  const mainDeck = expand(candidate.officialCardList.filter(entry => entry.zone === "mainDeck"), "main");
  const chosenIndex = mainDeck.findIndex(entry => entry.cardId === chosen.canonicalCardId);
  if (chosenIndex < 0) throw new Error(`Chosen champion is absent from ${candidateId}`);
  mainDeck.splice(chosenIndex, 1);
  return {
    mainDeck,
    runeDeck: expand(candidate.officialCardList.filter(entry => entry.zone === "runes"), "rune"),
    championLegend: { ...expand([legend], "legend")[0]! },
    chosenChampion: { ...expand([chosen], "champion")[0]! },
    battlefields: expand(candidate.officialCardList.filter(entry => entry.zone === "battlefields"), "battlefield") as
      unknown as EngineRuntimeDeck["battlefields"],
  };
}

function runtimeOptions() {
  return {
    matchId: "RIFT-1095-canonical-digest",
    roomId: "RIFT-1095-canonical-digest",
    decks: [deck("rumble-sfd"), deck("fiora-sfd")] as const,
    seed: "RIFT-1095-canonical-digest",
    firstPlayer: "A" as const,
    battlefieldChoice: [0, 0] as const,
    mulligans: [[], []] as const,
  };
}

// This intentionally mirrors the pre-RIFT-1089 encoder byte for byte.
function legacyCanonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(legacyCanonicalJson).join(",")}]`;
  if (typeof value !== "object") throw new TypeError("Journal values must be JSON data");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key =>
    `${JSON.stringify(key)}:${legacyCanonicalJson(record[key])}`).join(",")}}`;
}

function legacyDigest(value: unknown): string {
  return createHash("sha256").update(legacyCanonicalJson(value), "utf8").digest("hex");
}

function digestWholeJournalAfterHelperChange(
  journal: RuntimeJournal,
  binding: ProgramBinding,
): string {
  // Canonical digest is deliberately an independent boundary: the production
  // CardProgram binding must not alter any journal byte it covers.
  expect(binding.registry).toBeDefined();
  const chain = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", cleanup: () => false,
    host: createActionPipelineHost({ objects: () => [] }),
  });
  const lifecycle = binding.attachLifecycle(chain);
  expect(chain.layers).toBeDefined();
  lifecycle.detach();
  return legacyDigest({
    header: journal.header,
    entries: journal.entries,
    head: journal.head,
    integrity: journal.integrity,
  });
}

describe("RIFT-1095 canonical digest equivalence", () => {
  it("matches the legacy encoder for primitive and nested JSON bytes", () => {
    const values = [
      null, true, false, 0, -0, 1.5, "text", "a\\\"b\n", [], {},
      [null, { z: 1, a: [true, "x"] }],
      { z: null, a: { nested: [{ b: 2, a: 1 }] }, middle: false },
      { "10": "ten", "2": "two", é: "escaped by JSON", __proto__: null },
    ];
    for (const value of values) {
      const expected = legacyCanonicalJson(value);
      expect(canonicalJson(value)).toBe(expected);
      expect(digest(value)).toBe(legacyDigest(value));
    }
  });

  it("keeps production journal, entry, and three-viewer projection digests byte-identical", () => {
    const runtime = createEngineRuntime(runtimeOptions()).start();
    const actor = runtime.projectFor(null).activePlayerId;
    const accepted = runtime.submit(actor, { type: "pass", commandId: "canonical-pass-1", stateVersion: 0 });
    expect(accepted.receipt.status, JSON.stringify(accepted.receipt)).toBe("accepted");
    const journal = runtime.journal();
    const projections = [runtime.projectFor("A"), runtime.projectFor("B"), runtime.projectFor(null)];
    for (const value of [journal, ...journal.entries, ...projections]) {
      expect(canonicalJson(value)).toBe(legacyCanonicalJson(value));
      expect(digest(value)).toBe(legacyDigest(value));
    }
    expect(() => assertRuntimeJournal(journal)).not.toThrow();
    const writer = new RuntimeJournalWriter(journal as RuntimeJournal);
    expect(writer.snapshot()).toEqual(journal);
  }, 120_000);

  it("preserves append digests through the production replay chain", () => {
    const original = createEngineRuntime(runtimeOptions()).start();
    const firstActor = original.projectFor(null).activePlayerId;
    expect(original.submit(firstActor, {
      type: "pass", commandId: "canonical-pass-1", stateVersion: 0,
    }).receipt.status).toBe("accepted");

    const checkpoint = original.journal();
    const restored = createEngineRuntime(runtimeOptions()).restore(checkpoint);
    const nextActor = restored.projectFor(null).activePlayerId;
    const submitted = restored.submit(nextActor, {
      type: "pass", commandId: "canonical-pass-2", stateVersion: checkpoint.head.stateVersion,
    });
    expect(submitted.receipt.status, JSON.stringify(submitted.receipt)).toBe("accepted");
    const journal = restored.journal();
    const latest = journal.entries.at(-1)!;
    expect(latest.integrity.currentDigest).toBe(legacyDigest({
      ...latest,
      integrity: { parentDigest: latest.integrity.parentDigest, currentDigest: "0".repeat(64) },
    }));
    expect(journal.head.journalDigest).toBe(legacyDigest({
      header: journal.header,
      head: { ...journal.head, journalDigest: "0".repeat(64) },
      entries: journal.entries,
      integrity: { ...journal.integrity, currentDigest: "0".repeat(64) },
    }));
    expect(() => assertRuntimeJournal(journal)).not.toThrow();
  }, 120_000);

  it("keeps journal bytes and digests stable through the ChainEngine lifecycle", () => {
    const runtime = createEngineRuntime(runtimeOptions()).start();
    const actor = runtime.projectFor(null).activePlayerId;
    expect(runtime.submit(actor, {
      type: "pass", commandId: "canonical-pass-1", stateVersion: 0,
    }).receipt.status).toBe("accepted");
    const journal = runtime.journal();
    const canonical = digestWholeJournalAfterHelperChange(journal, createProgramBinding({ cardPrograms: [] }));
    expect(digest({
      header: journal.header,
      entries: journal.entries,
      head: journal.head,
      integrity: journal.integrity,
    })).toBe(canonical);
    expect(canonical).toBe(legacyDigest({
      header: journal.header,
      entries: journal.entries,
      head: journal.head,
      integrity: journal.integrity,
    }));
  }, 120_000);
});
