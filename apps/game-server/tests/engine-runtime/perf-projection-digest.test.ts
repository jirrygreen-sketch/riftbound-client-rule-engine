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

function currentRuntimeOptions() {
  return {
    ...runtimeOptions(),
    engineVersion: "@riftbound/engine-core/current+RIFT-1165.setup-battlefield-board-v1",
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
    const runtime = createEngineRuntime(currentRuntimeOptions()).start();
    const initial = runtime.journal();
    expect(initial.head).toMatchObject({
      stateDigest: "14a01ab863504e0e4232fb5ac30eafb58000d8864e6f089300de5d0bc178427e",
      privateStateDigest: "60ac9b5db730a160ae4e48b81006fa551e3384f61c1c58797bfed6bd8cae3525",
      journalDigest: "8ad0f9f93e140269d46cc5f5b9eb97361d46908ec27b258cddeb8b40d94aeaf1",
    });
    const actor = runtime.projectFor(null).activePlayerId;
    const result = runtime.submit(actor, { type: "pass", commandId: "digest-pass-1", stateVersion: 0 });
    expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("accepted");
    const journal = runtime.journal();
    const entry = journal.entries.at(-1)!;
    expect(Object.keys(entry.projectionDigestByViewer)).toEqual(["spectator", "A", "B"]);
    expect(entry.projectionDigestByViewer).toEqual({
      spectator: "acfc2d0d1c885a281613018fe7d199e3f3fccd19c94fc81539f145c1e0f423c5",
      A: "bc5c5e61197acd41e13112e6e01d8066555134fa51563d51fde1ac558f0f24e3",
      B: "13ca3e7b136a305b47d0739b692741d79032c4036286f76ff1e2e63cd82f0f29",
    });
    expect(journal.head.stateDigest).toBe(entry.projectionDigestByViewer.spectator);
    expect(journal.head).toMatchObject({
      journalDigest: "5fa87bfa07c05064352e9246b85dcbeaddf9c601c143b50961a3dd3888b74f9c",
      privateStateDigest: "acbc71730a17d98e0ebc49d53cc360195261ca2a6b9b612c52e5ed1bdd745443",
    });
    expect(entry.integrity.currentDigest).toBe("a51e9ae5033dd647e89276acc6c8861a8d078be50255ee97f1c07ba688ffc511");
    assertRuntimeJournal(journal);
    expect(() => assertRuntimeJournal({ ...journal, head: { ...journal.head, stateDigest: "f".repeat(64) } }))
      .toThrow(/digest mismatch/i);

    const restored = createEngineRuntime(currentRuntimeOptions()).restore(journal);
    expect(restored.projectFor("A")).toEqual(runtime.projectFor("A"));
    expect(restored.projectFor("B")).toEqual(runtime.projectFor("B"));
    expect(restored.projectFor(null)).toEqual(runtime.projectFor(null));
    expect(restored.journal().head).toMatchObject({
      stateDigest: journal.head.stateDigest, privateStateDigest: journal.head.privateStateDigest,
      journalDigest: journal.head.journalDigest,
    });
  }, 120_000);

  it("preserves the pre-RIFT-1165 engine-version digest tuple for historical replay", () => {
    const runtime = createEngineRuntime({
      ...runtimeOptions(),
      engineVersion: "@riftbound/engine-core/current",
    }).start();
    expect(runtime.journal().head).toMatchObject({
      stateDigest: "886c50cf14da639940817af5cff90f0be56e6ec4c093a0e35f55a04e05d7e4f3",
      privateStateDigest: "f92706477c7f71e68a114284a8c2d2f3b6baf71c6820380f4f159553c6f4d878",
      journalDigest: "5d2c8953f375f021bb0423e53035b70ec35ef66f644fa47463c6f7f1ae1bd343",
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
