import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDuelCommandSessionV2 } from "@riftbound/engine-core/duel";
import { loadCardCatalogRuntime, type CardCatalogRuntime } from "../../src/card-catalog.js";
import { createCatalogCardTypeResolverV2 } from "../../src/duel/catalog-card-type-v2.js";
import { createDuelRuntimeSessionV2, type DuelRuntimeSeatV2 } from "../../src/duel/runtime-v2.js";
import { buildDuelSetupSeats } from "../../src/duel/setup-seats.js";
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from "./fixtures/setup-adapter-catalog.js";

const imagesDirectory = fileURLToPath(new URL("./fixtures/", import.meta.url));
const championId = "unl-176-219";
const ordinaryId = "ogn-001-298";
const spellId = "ogn-004-298";
const runeId = "ogn-214-298";
const legendId = "unl-187-219";
const battlefieldId = "ogn-275-298";
const fixture = () => structuredClone(setupAdapterFixtureCatalog);
async function runtime(catalog: unknown = fixture()): Promise<CardCatalogRuntime> {
  return loadCardCatalogRuntime({ catalog, imagesDirectory });
}
function roster(decks = setupAdapterFixtureDecks): readonly [DuelRuntimeSeatV2, DuelRuntimeSeatV2] {
  return [
    { playerId: "alice", displayName: "Alice", deck: decks.a.submission },
    { playerId: "bob", displayName: "Bob", deck: decks.b.submission },
  ];
}
function uidFactory(): () => string {
  let index = 0;
  return () => `card-type-v2-${++index}`;
}

// Leave the official fixture itself untouched; constructed mainDeck + chosen champion
// remains 40 when this test swaps one ordinary Unit for a second Champion printing.
function championInMainDeck() {
  const a = structuredClone(setupAdapterFixtureDecks.a.submission);
  a.mainDeck = [
    { cardId: ordinaryId, quantity: 2 },
    ...a.mainDeck.filter((entry) => entry.cardId !== ordinaryId),
    { cardId: championId, quantity: 1 },
  ];
  return roster({ ...setupAdapterFixtureDecks, a: { ...setupAdapterFixtureDecks.a, submission: a } });
}

describe("catalog card-type authority V2", () => {
  it("classifies unique printed ids, not the caller's deck slot or card text", async () => {
    const rt = await runtime();
    const authority = createCatalogCardTypeResolverV2(rt);
    expect(authority.catalogStamp).toEqual({ dataVersion: rt.publicCatalog.dataVersion, digest: rt.publicCatalog.digest });
    expect(Object.isFrozen(authority)).toBe(true);
    expect(Object.isFrozen(authority.catalogStamp)).toBe(true);
    expect(authority).not.toHaveProperty("cardsById");
    expect(authority).not.toHaveProperty("map");
    expect(authority.resolve(championId)).toBe("Champion");
    expect(authority.resolve(ordinaryId)).toBe("Unit");
    expect(authority.resolve(spellId)).toBe("Other");
    expect(authority.resolve(runeId)).toBe("Rune");
    expect(authority.resolve(legendId)).toBe("Legend");
    expect(authority.resolve(battlefieldId)).toBe("Battlefield");
    const taggedLegend = fixture();
    taggedLegend.cards.find((card) => card.id === legendId)!.tags.push("Champion");
    expect(createCatalogCardTypeResolverV2(await runtime(taggedLegend)).resolve(legendId)).toBe("Legend");
    const gear = fixture();
    gear.cards.find((card) => card.id === ordinaryId)!.cardType = "Gear";
    expect(createCatalogCardTypeResolverV2(await runtime(gear)).resolve(ordinaryId)).toBe("Gear");
    expect(() => authority.resolve("not-in-catalog")).toThrow(/unknown cardId/);
    expect(() => authority.resolve(undefined as unknown as string)).toThrow(/unknown cardId/);
    expect(() => authority.assertMatchMetadata({ dataVersion: "forged", catalogDigest: rt.publicCatalog.digest }))
      .toThrow(/stamp mismatch/);
    expect(() => authority.assertMatchMetadata({ dataVersion: rt.publicCatalog.dataVersion, catalogDigest: "forged" }))
      .toThrow(/stamp mismatch/);
    expect(() => authority.forMatch({ dataVersion: "forged", catalogDigest: rt.publicCatalog.digest }))
      .toThrow(/stamp mismatch/);
    expect(authority.forMatch({ dataVersion: rt.publicCatalog.dataVersion, catalogDigest: rt.publicCatalog.digest }))
      .toBe(authority.resolve);
  });

  it("accepts a constructed deck with an extra Champion in main, preserving both origins in a real V2 session", async () => {
    const rt = await runtime();
    const trusted = createCatalogCardTypeResolverV2(rt);
    const deckSeats = championInMainDeck();
    const setup = buildDuelSetupSeats(rt, { matchId: "role-v2-adapter", seats: deckSeats }, uidFactory());
    expect(setup.ok).toBe(true);
    if (!setup.ok) throw new Error(JSON.stringify(setup));
    const cardType = trusted.forMatch(setup.metadata);
    expect(setup.seats[0].mainDeck.filter((card) => card.cardId === championId)).toHaveLength(1);
    const session = createDuelCommandSessionV2(setup.seats, setup.metadata, () => 0, cardType);
    expect(session.match.stage).toBe("setup");
    expect(session.match.schemaVersion).toBe(2);
    expect(session.match.provenance.originalPhysicalCards.filter((card) => card.cardId === championId))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ uid: setup.seats[0].champion.uid, cardType: "Champion" }),
        expect.objectContaining({ uid: setup.seats[0].mainDeck.find((card) => card.cardId === championId)?.uid,
          cardType: "Champion" }),
      ]));
    expect(session.match.provenance.originalPhysicalCards.find((card) =>
      card.cardId === spellId)?.cardType).toBe("Other");
    expect(() => trusted.forMatch({ ...setup.metadata, catalogDigest: "sha256:other" })).toThrow(/stamp mismatch/);
    const facade = createDuelRuntimeSessionV2(rt, deckSeats, "role-v2-facade", {
      uidFactory: uidFactory(), randomIndex: () => 0, trustedCardType: cardType,
    });
    expect(facade.match.schemaVersion).toBe(2);
    expect(facade.match.provenance.originalPhysicalCards.filter((card) => card.cardId === championId)).toHaveLength(3);
  });

  it("rejects ordinary Unit in chosen Champion slot and Rune in main even with a genuine resolver", async () => {
    const rt = await runtime();
    const trusted = createCatalogCardTypeResolverV2(rt);
    const good = buildDuelSetupSeats(rt, { matchId: "role-v2-slots", seats: roster() }, uidFactory());
    expect(good.ok).toBe(true);
    if (!good.ok) throw new Error(JSON.stringify(good));
    const ordinaryChampion = [{ ...good.seats[0], champion: { ...good.seats[0].champion, cardId: ordinaryId } },
      good.seats[1]] as const;
    expect(() => createDuelCommandSessionV2(ordinaryChampion, good.metadata, () => 0, trusted.resolve))
      .toThrow(/catalog printing kind incompatible with submitted slot/);
    const runeMain = [{ ...good.seats[0], mainDeck: [
      { ...good.seats[0].mainDeck[0]!, cardId: runeId }, ...good.seats[0].mainDeck.slice(1),
    ] }, good.seats[1]] as const;
    expect(() => createDuelCommandSessionV2(runeMain, good.metadata, () => 0, trusted.resolve))
      .toThrow(/catalog printing kind incompatible with submitted slot/);
  });

  it("fails closed on contradictory tags/type, unsupported types, ambiguous ids, and detached runtime mutation", async () => {
    const contradictory = fixture();
    const champion = contradictory.cards.find((card) => card.id === championId)!;
    champion.cardType = "Spell";
    const bad = createCatalogCardTypeResolverV2(await runtime(contradictory));
    expect(() => bad.resolve(championId)).toThrow(/invalid printing/);

    const forged = fixture();
    forged.cards.find((card) => card.id === spellId)!.tags.push("Champion");
    const forgedType = createCatalogCardTypeResolverV2(await runtime(forged));
    expect(() => forgedType.resolve(spellId)).toThrow(/invalid printing/);
    const spelling = fixture();
    spelling.cards.find((card) => card.id === ordinaryId)!.tags.push("champion");
    const noncanonical = createCatalogCardTypeResolverV2(await runtime(spelling));
    expect(() => noncanonical.resolve(ordinaryId)).toThrow(/invalid printing/);
    // Only the trusted loaded runtime can assert an official tag: assigning a
    // public, mutable card's tag after minting an authority must fail closed.
    const rt = await runtime();
    const detached = createCatalogCardTypeResolverV2(rt);
    rt.publicCatalog.cards.find((card) => card.id === ordinaryId)!.tags.push("Champion");
    expect(() => detached.resolve(ordinaryId)).toThrow(/printing changed/);
    rt.publicCatalog.cards.find((card) => card.id === ordinaryId)!.tags.pop();
    rt.publicCatalog.cards.find((card) => card.id === ordinaryId)!.cardType = "Rune";
    expect(() => detached.resolve(ordinaryId)).toThrow(/printing changed/);
    const stamped = await runtime();
    const bound = createCatalogCardTypeResolverV2(stamped);
    stamped.publicCatalog.digest = "sha256:other";
    expect(() => bound.resolve(championId)).toThrow(/runtime\/stamp changed/);
    expect(() => bound.forMatch({ dataVersion: stamped.publicCatalog.dataVersion,
      catalogDigest: stamped.publicCatalog.digest })).toThrow(/runtime\/stamp changed/);

    const tokenTagged = fixture();
    tokenTagged.cards.find((card) => card.id === ordinaryId)!.tags.push("Token");
    const tokenType = createCatalogCardTypeResolverV2(await runtime(tokenTagged));
    expect(() => tokenType.resolve(ordinaryId)).toThrow(/invalid printing/);
    for (const kind of ["Champion", "Token", "Creature", "Mystery"]) {
      const candidate = fixture();
      candidate.cards.find((card) => card.id === ordinaryId)!.cardType = kind;
      const invalid = createCatalogCardTypeResolverV2(await runtime(candidate));
      expect(() => invalid.resolve(ordinaryId)).toThrow(/invalid printing/);
    }
    const ambiguous = await runtime();
    const cards = ambiguous.publicCatalog.cards as unknown as (typeof ambiguous.publicCatalog.cards[number])[];
    cards.push({ ...cards[0]!, id: cards[1]!.id });
    const duplicateRuntime = { ...ambiguous, publicCatalogJson: `${JSON.stringify(ambiguous.publicCatalog)}\n` };
    expect(() => createCatalogCardTypeResolverV2(duplicateRuntime)).toThrow(/ambiguous cardId/);
  });
});
