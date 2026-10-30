import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { assertRuntimeJournal, createEngineRuntime, digest, RuntimeJournalWriter,
  type EngineRuntimeDeck, type RuntimeJournal } from "../../src/engine-runtime/index.js";

interface M1Card {
  readonly zone: "legend" | "champion" | "mainDeck" | "battlefields" | "runes";
  readonly canonicalCardId: string;
  readonly name: string;
  readonly quantity: number;
  readonly cardType: string;
}

interface M1Candidate {
  readonly id: string;
  readonly chosenChampion: string;
  readonly officialCardList: readonly M1Card[];
}

const m1Catalog = JSON.parse(readFileSync(new URL("../../../../docs/plans/m1-decks.json", import.meta.url), "utf8")) as {
  readonly candidates: readonly M1Candidate[];
};

function m1Deck(candidateId: string): EngineRuntimeDeck {
  const candidate = m1Catalog.candidates.find(item => item.id === candidateId);
  if (candidate === undefined) throw new Error(`Unknown M1 candidate ${candidateId}`);
  const expand = (entries: readonly M1Card[], zone: string) => entries.flatMap(entry =>
    Array.from({ length: entry.quantity }, (_, index) => ({
      id: `${candidate.id}:${zone}:${index}:${entry.canonicalCardId}`,
      cardId: entry.canonicalCardId, name: entry.name, types: [entry.cardType.toLowerCase()],
      energy: null, power: null,
    })));
  const legend = candidate.officialCardList.find(entry => entry.zone === "legend");
  const chosen = candidate.officialCardList.find(entry => entry.zone === "champion" &&
    entry.name === candidate.chosenChampion);
  if (legend === undefined || chosen === undefined) throw new Error(`Incomplete M1 candidate ${candidateId}`);
  const mainDeck = expand(candidate.officialCardList.filter(entry => entry.zone === "mainDeck"), "main");
  const chosenIndex = mainDeck.findIndex(card => card.cardId === chosen.canonicalCardId);
  if (chosenIndex < 0) throw new Error(`Chosen champion is absent from M1 main deck ${candidateId}`);
  mainDeck.splice(chosenIndex, 1);
  const battlefields = expand(candidate.officialCardList.filter(entry => entry.zone === "battlefields"), "battlefield");
  return {
    mainDeck,
    runeDeck: expand(candidate.officialCardList.filter(entry => entry.zone === "runes"), "rune"),
    championLegend: { ...expand([legend], "legend")[0]! },
    chosenChampion: { ...expand([chosen], "champion")[0]! },
    battlefields: battlefields as unknown as EngineRuntimeDeck["battlefields"],
  };
}

function runtimeOptions() {
  return {
    matchId: "RIFT-1089-projection-digest", roomId: "RIFT-1089-projection-digest",
    decks: [m1Deck("rumble-sfd"), m1Deck("fiora-sfd")] as const,
    seed: "RIFT-1089-projection-digest", firstPlayer: "A" as const,
    battlefieldChoice: [0, 0] as const, mulligans: [[], []] as const,
  };
}

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

describe("RIFT-1089 projection and journal digest equivalence", () => {
  it("preserves three-viewer bytes and journal integrity across replay", () => {
    const runtime = createEngineRuntime(runtimeOptions()).start();
    const initial = runtime.journal();
    expect(initial.head).toMatchObject({
      stateDigest: "886c50cf14da639940817af5cff90f0be56e6ec4c093a0e35f55a04e05d7e4f3",
      privateStateDigest: "f92706477c7f71e68a114284a8c2d2f3b6baf71c6820380f4f159553c6f4d878",
      journalDigest: "5d2c8953f375f021bb0423e53035b70ec35ef66f644fa47463c6f7f1ae1bd343",
    });
    const actor = runtime.projectFor(null).activePlayerId;
    const result = runtime.submit(actor, { type: "pass", commandId: "digest-pass-1", stateVersion: 0 });
    expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("accepted");
    const journal = runtime.journal();
    const entry = journal.entries.at(-1)!;
    expect(Object.keys(entry.projectionDigestByViewer)).toEqual(["spectator", "A", "B"]);
    expect(entry.projectionDigestByViewer).toEqual({
      spectator: "91432262dbcb560b48e00a01f89d508f0df590ee7bd1d144fe98dfe753da7a48",
      A: "966611af746f6cdab78a947f9379403134a408e293f44b67ce474fdab4b4dc83",
      B: "59a3e947d5d6c1d12ad294819cd7a47d70086908183715e92dadd1b5b11ebbe3",
    });
    expect(journal.head.stateDigest).toBe(entry.projectionDigestByViewer.spectator);
    expect(journal.head).toMatchObject({
      journalDigest: "c62a4f09561915cae16819384b4db82683ae808e8aed07707b29a3df88c53c81",
      privateStateDigest: "3088ad58a64ad2b71c37030458b04f666e4799ac2ea6a7acb0a01fec567faf26",
    });
    expect(entry.integrity.currentDigest).toBe("6310da73d5fedcab6ebcf25c1e3bbbe3994532a559d5cc715084fdd1b818868f");
    assertRuntimeJournal(journal);
    expect(() => assertRuntimeJournal({ ...journal, head: { ...journal.head, stateDigest: "f".repeat(64) } }))
      .toThrow(/digest mismatch/i);

    const restored = createEngineRuntime(runtimeOptions()).restore(journal);
    expect(restored.projectFor("A")).toEqual(runtime.projectFor("A"));
    expect(restored.projectFor("B")).toEqual(runtime.projectFor("B"));
    expect(restored.projectFor(null)).toEqual(runtime.projectFor(null));
    expect(restored.journal().head).toMatchObject({
      stateDigest: journal.head.stateDigest, privateStateDigest: journal.head.privateStateDigest,
      journalDigest: journal.head.journalDigest,
    });
  }, 120_000);

  it("keeps the canonical digest bytes identical to the legacy encoder", () => {
    const runtime = createEngineRuntime(runtimeOptions()).start();
    const actor = runtime.projectFor(null).activePlayerId;
    runtime.submit(actor, { type: "pass", commandId: "digest-pass-1", stateVersion: 0 });
    const journal = runtime.journal();
    const projections = [runtime.projectFor("A"), runtime.projectFor("B"), runtime.projectFor(null)];
    for (const value of [journal, ...journal.entries, ...projections]) {
      expect(digest(value)).toBe(digest(JSON.parse(legacyCanonicalJson(value))));
    }
  }, 120_000);

  it("accepts an otherwise identical strict journal rewrite", () => {
    const runtime = createEngineRuntime(runtimeOptions()).start();
    const actor = runtime.projectFor(null).activePlayerId;
    runtime.submit(actor, { type: "pass", commandId: "digest-pass-1", stateVersion: 0 });
    const journal = runtime.journal();
    const writer = new RuntimeJournalWriter(journal as RuntimeJournal);
    expect(writer.snapshot()).toEqual(journal);
  }, 120_000);

  it("uses the real production runtime binding and lifecycle for three lenses", () => {
    const runtime = createEngineRuntime(runtimeOptions()).start();
    const own = runtime.projectFor("A");
    const opponent = runtime.projectFor("B");
    const spectator = runtime.projectFor(null);
    expect(own.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === "A")?.objects?.length)
      .toBe(own.players.find(player => player.playerId === "A")?.handCount);
    expect(opponent.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === "A")?.objects)
      .toBeUndefined();
    expect(opponent.objects.filter(object => object.ownerPlayerId === "A" && object.zone === "facedown")
      .every(object => object.cardId === undefined && object.name === undefined && object.faceDown)).toBe(true);
    expect(spectator.objects.filter(object => object.ownerPlayerId === "A" && object.zone === "facedown")
      .every(object => object.cardId === undefined && object.name === undefined && object.faceDown)).toBe(true);
  }, 120_000);
});
