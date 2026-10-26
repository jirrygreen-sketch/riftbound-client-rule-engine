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
      stateDigest: "704a87f97ffdc62cbf72b1b37bd30c06ad6a9d3d3acd287790e355e1e0ecb447",
      privateStateDigest: "07a276df77061cc2b061ec42f0db061d719b726a875a29f7cd82a57aebc1e08c",
      journalDigest: "ec939df20fff3e8f0368618780bd79d8e67c0424008442e9becf611d39f5c648",
    });
    const actor = runtime.projectFor(null).activePlayerId;
    const result = runtime.submit(actor, { type: "pass", commandId: "digest-pass-1", stateVersion: 0 });
    expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("accepted");
    const journal = runtime.journal();
    const entry = journal.entries.at(-1)!;
    expect(Object.keys(entry.projectionDigestByViewer)).toEqual(["spectator", "A", "B"]);
    expect(entry.projectionDigestByViewer).toEqual({
      spectator: "61abc6158b583b25a4a84a6a5793418f0a8aa2d815979aba2b88fec84ce0c89f",
      A: "49db60f66653dc08ecbb589bf3c9ec4415639780c93ab104bcb4989ac3c04bb2",
      B: "1610f9ebdf19d377aa5b076e2a6b1cd56da22dcc1b0e825119d9423777d0442c",
    });
    expect(journal.head.stateDigest).toBe(entry.projectionDigestByViewer.spectator);
    expect(journal.head).toMatchObject({
      journalDigest: "510dae486754fedbf2aa75bddef4325afb26c2dc62942e92d786f71c60057af8",
      privateStateDigest: "354bdce2d5b53f1ba86435da8a7dcc7b5edd181f8fbcaf323c65b11db4acc25b",
    });
    expect(entry.integrity.currentDigest).toBe("1ab1d2918dcf6734dedbd4c6f9c57e734976aadf49886a5bc995215bee058885");
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
