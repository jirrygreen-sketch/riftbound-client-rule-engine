import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import type { CatalogCard } from "../../src/net/CardCatalogClient";
import { emptyDeckByZone } from "../../src/hooks/useCardCatalog";
import {
  DEFAULT_IMPORT_DECK_NAME,
  DeckImportPanel,
  EXPORT_ACTION_LABEL,
  IMPORT_ACTION_LABEL,
  IMPORT_DISABLED_REASON,
  IMPORT_REVIEW_NOTE,
  IMPORT_TEXTAREA_LABEL,
  exportDeckToJson,
  parseDeckImport,
  runDeckImport
} from "../../src/decks/DeckImportPanel";

/**
 * Minimal structural fixture: only the fields the panel actually touches.
 * No ability text, domains, cost, or availability are claimed or invented.
 */
function card(partial: Partial<CatalogCard> & Pick<CatalogCard, "id" | "canonicalCardId">): CatalogCard {
  return {
    name: partial.id,
    fullName: partial.id,
    cardType: "unit",
    domains: [],
    tags: [],
    setCode: "TST",
    cardNumber: "1",
    variant: "standard",
    imageUrl: null,
    energy: null,
    power: null,
    might: null,
    ability: "",
    ...partial
  } as CatalogCard;
}

const CARDS: readonly CatalogCard[] = [
  card({ id: "flame-warden-standard", canonicalCardId: "flame-warden" }),
  card({ id: "basic-rune-standard", canonicalCardId: "basic-rune" }),
  card({ id: "legend-hero-standard", canonicalCardId: "legend-hero" }),
  card({ id: "champ-standard", canonicalCardId: "champ" }),
  card({ id: "field-standard", canonicalCardId: "field" }),
  card({ id: "side-standard", canonicalCardId: "side" }),
  // Two printings share one canonical id -> canonical lookup is ambiguous.
  card({ id: "twin-a", canonicalCardId: "twin" }),
  card({ id: "twin-b", canonicalCardId: "twin", variant: "alternate" })
];

describe("parseDeckImport · standard record schema", () => {
  it("converts a full six-zone record into a DeckByZone and keeps the printing id", () => {
    const result = parseDeckImport(
      JSON.stringify({
        name: "我的卡组",
        deck: {
          mainDeck: { "flame-warden-standard": 3 },
          runes: { "basic-rune-standard": 12 },
          legend: { "legend-hero-standard": 1 },
          champion: { "champ-standard": 1 },
          battlefields: { "field-standard": 1 },
          sideboard: { "side-standard": 2 }
        }
      }),
      CARDS
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.name).toBe("我的卡组");
    expect(result.deck.mainDeck).toEqual({ "flame-warden-standard": 3 });
    expect(result.deck.runes).toEqual({ "basic-rune-standard": 12 });
    expect(result.deck.legend).toEqual({ "legend-hero-standard": 1 });
    expect(result.deck.champion).toEqual({ "champ-standard": 1 });
    expect(result.deck.battlefields).toEqual({ "field-standard": 1 });
    expect(result.deck.sideboard).toEqual({ "side-standard": 2 });
  });

  it("accepts the actual wire shape with array entries and normalizes to the same representation", () => {
    const result = parseDeckImport(
      JSON.stringify({
        name: "wire",
        deck: {
          mainDeck: [{ cardId: "flame-warden-standard", quantity: 3 }],
          runes: [{ cardId: "basic-rune-standard", quantity: 12 }]
        }
      }),
      CARDS
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.deck.mainDeck).toEqual({ "flame-warden-standard": 3 });
    expect(result.deck.runes).toEqual({ "basic-rune-standard": 12 });
    // Missing zones are treated as empty.
    expect(result.deck.legend).toEqual({});
    expect(result.deck.sideboard).toEqual({});
  });

  it("defaults the name and treats omitted zones as an empty draft", () => {
    const result = parseDeckImport('{"deck":{"mainDeck":{}}}', CARDS);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.name).toBe(DEFAULT_IMPORT_DECK_NAME);
    expect(result.deck).toEqual(emptyDeckByZone());
  });

  it("normalizes the name to 1..40 characters", () => {
    const long = "x".repeat(80);
    const result = parseDeckImport(JSON.stringify({ name: long, deck: {} }), CARDS);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.name.length).toBe(40);

    const blank = parseDeckImport(JSON.stringify({ name: "   ", deck: {} }), CARDS);
    expect(blank.ok).toBe(true);
    if (!blank.ok) throw new Error(blank.error);
    expect(blank.name).toBe(DEFAULT_IMPORT_DECK_NAME);
  });

  it("resolves a canonical id only when it maps to a single printing", () => {
    const unique = parseDeckImport('{"deck":{"mainDeck":{"flame-warden":2}}}', CARDS);
    expect(unique.ok).toBe(true);
    if (!unique.ok) throw new Error(unique.error);
    expect(unique.deck.mainDeck).toEqual({ "flame-warden-standard": 2 });

    const ambiguous = parseDeckImport('{"deck":{"mainDeck":{"twin":1}}}', CARDS);
    expect(ambiguous.ok).toBe(false);
  });
});

describe("parseDeckImport · rejections", () => {
  it("rejects malformed JSON and non-object roots", () => {
    expect(parseDeckImport("not json", CARDS).ok).toBe(false);
    expect(parseDeckImport("[]", CARDS).ok).toBe(false);
    expect(parseDeckImport("", CARDS).ok).toBe(false);
  });

  it("rejects unknown zones and unknown card ids", () => {
    expect(parseDeckImport('{"deck":{"deck":{}}}', CARDS).ok).toBe(false);
    expect(parseDeckImport('{"deck":{"mainDeck":{"ghost-card":1}}}', CARDS).ok).toBe(false);
  });

  it("rejects duplicated cards within one zone but allows them across zones", () => {
    // The array (actual wire) shape can express a duplicate entry; it must fail.
    const dupArray = parseDeckImport(
      JSON.stringify({
        deck: {
          mainDeck: [
            { cardId: "flame-warden-standard", quantity: 1 },
            { cardId: "flame-warden-standard", quantity: 1 }
          ]
        }
      }),
      CARDS
    );
    expect(dupArray.ok).toBe(false);
    if (dupArray.ok) throw new Error("expected failure");
    expect(dupArray.error).toContain("重复");

    // Record-shape duplicate keys collapse under JSON.parse (last wins), so the
    // parser must at least keep a single, well-formed entry (no silent doubling).
    const collapsed = parseDeckImport(
      '{"deck":{"mainDeck":{"flame-warden-standard":2}}}',
      CARDS
    );
    expect(collapsed.ok).toBe(true);
    if (!collapsed.ok) throw new Error(collapsed.error);
    expect(collapsed.deck.mainDeck).toEqual({ "flame-warden-standard": 2 });

    const crossZone = parseDeckImport(
      JSON.stringify({
        deck: {
          mainDeck: { "flame-warden-standard": 1 },
          sideboard: { "flame-warden-standard": 2 }
        }
      }),
      CARDS
    );
    expect(crossZone.ok).toBe(true);
  });

  it("rejects invalid quantities: 0, fractions, unsafe integers and values over 60", () => {
    for (const quantity of [0, 1.5, 2 ** 53, 61]) {
      const result = parseDeckImport(
        JSON.stringify({ deck: { mainDeck: { "flame-warden-standard": quantity } } }),
        CARDS
      );
      expect(result.ok).toBe(false);
    }
  });

  it("rejects extra entry keys in the wire shape", () => {
    const result = parseDeckImport(
      JSON.stringify({
        deck: { mainDeck: [{ cardId: "flame-warden-standard", quantity: 1, printingId: "x" }] }
      }),
      CARDS
    );
    expect(result.ok).toBe(false);
  });

  it("rejects proto-polluting reserved keys instead of treating them as zones or cards", () => {
    // JSON.parse can carry a "__proto__" own key; the parser must reject it.
    expect(parseDeckImport('{"deck":{"__proto__":{"x":1}}}', CARDS).ok).toBe(false);
    expect(
      parseDeckImport('{"deck":{"mainDeck":{"__proto__":1}}}', CARDS).ok
    ).toBe(false);
    expect(parseDeckImport('{"__proto__":{"name":"x"},"deck":{}}', CARDS).ok).toBe(false);
  });
});

describe("exportDeckToJson", () => {
  it("serializes all six zones in the standard schema with numeric quantities", () => {
    const deck = {
      ...emptyDeckByZone(),
      mainDeck: { "flame-warden-standard": 3 },
      runes: { "basic-rune-standard": 12 },
      sideboard: { "side-standard": 2 }
    };
    const text = exportDeckToJson("我的卡组", deck);
    const parsed = JSON.parse(text);
    expect(parsed.name).toBe("我的卡组");
    expect(Object.keys(parsed.deck)).toEqual([
      "mainDeck",
      "runes",
      "legend",
      "champion",
      "battlefields",
      "sideboard"
    ]);
    expect(parsed.deck.mainDeck).toEqual({ "flame-warden-standard": 3 });
    expect(parsed.deck.legend).toEqual({});
  });

  it("round-trips an exported deck back through the parser", () => {
    const deck = {
      ...emptyDeckByZone(),
      mainDeck: { "flame-warden-standard": 3 },
      runes: { "basic-rune-standard": 12 }
    };
    const result = parseDeckImport(exportDeckToJson("round-trip", deck), CARDS);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.deck).toEqual(deck);
  });
});

describe("runDeckImport · onImport authority", () => {
  it("reports success only when onImport returns true", () => {
    const accepted = vi.fn(() => true);
    const status = runDeckImport('{"deck":{"mainDeck":{"flame-warden-standard":1}}}', CARDS, accepted);
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(status.kind).toBe("success");
    if (status.kind !== "success") throw new Error("expected success");
    expect(status.name).toBe(DEFAULT_IMPORT_DECK_NAME);
    expect(status.message).toContain(IMPORT_REVIEW_NOTE);
  });

  it("reports an error and never claims success when onImport returns false", () => {
    const rejected = vi.fn(() => false);
    const status = runDeckImport('{"deck":{"mainDeck":{"flame-warden-standard":1}}}', CARDS, rejected);
    expect(status.kind).toBe("error");
  });

  it("does not call onImport when parsing fails", () => {
    const onImport = vi.fn(() => true);
    const status = runDeckImport("bad json", CARDS, onImport);
    expect(onImport).not.toHaveBeenCalled();
    expect(status.kind).toBe("error");
  });
});

describe("DeckImportPanel · SSR", () => {
  it("renders the human labels, review note and a disabled import button when disabled", () => {
    const html = renderToStaticMarkup(
      <DeckImportPanel
        deck={emptyDeckByZone()}
        cards={CARDS}
        disabled={true}
        onImport={() => false}
      />
    );
    expect(html).toContain(IMPORT_TEXTAREA_LABEL);
    expect(html).toContain(IMPORT_ACTION_LABEL);
    expect(html).toContain(EXPORT_ACTION_LABEL);
    expect(html).toContain(IMPORT_REVIEW_NOTE);
    expect(html).toContain(IMPORT_DISABLED_REASON);
    // The primary import button is disabled while the parent gate says so.
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*导入卡组/);
    // Export textarea is read-only and starts empty (no optimistic content).
    expect(html).toMatch(/<textarea[^>]*readonly/);
  });

  it("does not disable the import button when enabled", () => {
    const html = renderToStaticMarkup(
      <DeckImportPanel
        deck={emptyDeckByZone()}
        cards={CARDS}
        disabled={false}
        onImport={() => true}
      />
    );
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>[^<]*导入卡组/);
    expect(html).not.toContain(IMPORT_DISABLED_REASON);
  });
});
