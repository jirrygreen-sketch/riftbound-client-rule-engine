import { describe, expect, it, vi } from "vitest";
import {
  canSubmitRoomDeck,
  isCardAbilityImplemented,
  buildCardLimits,
  allowedZonesFor,
  limitFor,
  sharedLimitZones,
  zoneCanonicalCount
} from "../src/App";
import {
  emptyDeckByZone,
  readStoredDeck,
  toDeckSubmission,
  writeStoredDeck
} from "../src/hooks/useCardCatalog";
import {
  CardCatalogClient,
  CardCatalogClientErrorImpl,
  DEFAULT_CARD_SERVER_URL,
  cardImageServerUrl,
  normalizeCardServerUrl
} from "../src/net/CardCatalogClient";

const catalog = {
  schemaVersion: 1,
  dataVersion: "2026-10-11",
  digest: "sha256:test-digest",
  cards: [
    {
      id: "flame-warden-standard",
      canonicalCardId: "flame-warden",
      name: "Flame Warden",
      fullName: "Flame Warden",
      cardType: "Unit",
      domains: ["fire"],
      tags: ["guard"],
      setCode: "RB1",
      cardNumber: "001",
      variant: "standard",
      imageUrl: null,
      energy: 2,
      power: 3,
      might: null,
      ability: "Guard."
    }
  ]
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("CardCatalogClient", () => {
  it("normalizes configurable HTTP server URLs and defaults to the local server", () => {
    expect(DEFAULT_CARD_SERVER_URL).toBe("http://127.0.0.1:8787");
    expect(normalizeCardServerUrl("")).toBe("http://127.0.0.1:8787");
    expect(normalizeCardServerUrl("127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    expect(normalizeCardServerUrl("http://127.0.0.1:8787/ws?x=1#top"))
      .toBe("http://127.0.0.1:8787/ws");
    expect(normalizeCardServerUrl("ftp://example.com")).toBeNull();
    expect(cardImageServerUrl("http://127.0.0.1:8787", "card/alt 1"))
      .toBe("http://127.0.0.1:8787/api/card-images/card%2Falt%201");
  });

  it("loads and validates the official server catalog", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(catalog));
    const client = new CardCatalogClient({ fetchImpl });

    const result = await client.loadCatalog("127.0.0.1:8787");

    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:8787/api/cards", undefined);
    expect(result).toEqual(catalog);
  });

  it("uses a default fetch wrapper that preserves the browser receiver", async () => {
    const originalFetch = globalThis.fetch;
    let receiver: unknown = "unset";
    try {
      globalThis.fetch = function(this: unknown) {
        receiver = this;
        return Promise.resolve(jsonResponse(catalog));
      } as typeof fetch;

      const client = new CardCatalogClient();
      await expect(client.loadCatalog(DEFAULT_CARD_SERVER_URL)).resolves.toEqual(catalog);
      expect(receiver).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("accepts empty and multiline ability text and optional policy metadata", async () => {
    const runeCatalog = {
      ...catalog,
      cards: [
        {
          ...catalog.cards[0],
          cardType: "Rune",
          ability: "",
          allowedZones: ["runes"],
          maxCopies: 12
        },
        {
          ...catalog.cards[0],
          id: "banned-standard",
          banned: true,
          available: true,
          availabilityReason: "available",
          ability: "Line one\nLine two"
        }
      ]
    };
    const client = new CardCatalogClient({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(runeCatalog))
    });

    const result = await client.loadCatalog(DEFAULT_CARD_SERVER_URL);

    expect(result.cards[0].ability).toBe("");
    expect(result.cards[1].banned).toBe(true);
  });

  it("preserves valid optional Chinese ability display fields", async () => {
    const source = {
      url: "https://content.example/riftbound_gallery_cards?locale=zh_CN",
      locale: "zh-CN",
      updatedAt: "2026-10-28T14:49:37Z",
      syncedAt: "2026-10-28T15:00:00Z"
    };
    const localizedCatalog = {
      ...catalog,
      cards: [{
        ...catalog.cards[0],
        localizedAbilityRulesText: "<p>[反应] 支付:rb_energy_1:。</p>",
        localizedAbilityEffectText: "<p>获得2点战力。</p>",
        localizedAbilityLanguage: "zh-CN",
        localizedAbilityStatus: "official-structured",
        localizedAbilitySource: source
      }]
    };
    const client = new CardCatalogClient({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(localizedCatalog))
    });

    const result = await client.loadCatalog(DEFAULT_CARD_SERVER_URL);

    expect(result.cards[0]).toMatchObject({
      localizedAbilityRulesText: "<p>[反应] 支付:rb_energy_1:。</p>",
      localizedAbilityEffectText: "<p>获得2点战力。</p>",
      localizedAbilityLanguage: "zh-CN",
      localizedAbilityStatus: "official-structured",
      localizedAbilitySource: source
    });
  });

  it("drops malformed optional Chinese fields without rejecting the catalog", async () => {
    const localizedCatalog = {
      ...catalog,
      cards: [{
        ...catalog.cards[0],
        localizedAbilityRulesText: 42,
        localizedAbilityEffectText: null,
        localizedAbilityLanguage: "fr-FR",
        localizedAbilityStatus: "machine-translated",
        localizedAbilitySource: {
          url: "javascript:alert(1)",
          locale: "zh-CN",
          updatedAt: "2026-10-28T14:49:37Z",
          syncedAt: "2026-10-28T15:00:00Z"
        }
      }]
    };
    const client = new CardCatalogClient({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(localizedCatalog))
    });

    const result = await client.loadCatalog(DEFAULT_CARD_SERVER_URL);

    expect(result.cards[0]).not.toHaveProperty("localizedAbilityRulesText");
    expect(result.cards[0]).not.toHaveProperty("localizedAbilityEffectText");
    expect(result.cards[0]).not.toHaveProperty("localizedAbilityLanguage");
    expect(result.cards[0]).not.toHaveProperty("localizedAbilityStatus");
    expect(result.cards[0]).not.toHaveProperty("localizedAbilitySource");
    expect(result.cards[0].ability).toBe("Guard.");
  });

  it("accepts the zero-copy policy returned for unavailable cards", async () => {
    const unavailableCatalog = {
      ...catalog,
      cards: [
        {
          ...catalog.cards[0],
          allowedZones: [],
          maxCopies: 0,
          banned: true
        }
      ]
    };
    const client = new CardCatalogClient({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(unavailableCatalog))
    });

    const result = await client.loadCatalog(DEFAULT_CARD_SERVER_URL);

    expect(result.cards[0]).toMatchObject({
      allowedZones: [],
      maxCopies: 0,
      banned: true
    });
  });

  it("retries transient catalog connection failures before surfacing an error", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("server not ready"))
      .mockResolvedValueOnce(jsonResponse(catalog));
    const client = new CardCatalogClient({ fetchImpl, retryDelaysMs: [0] });

    const result = await client.loadCatalog(DEFAULT_CARD_SERVER_URL);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.cards).toHaveLength(1);
  });

  it("keeps printing availability separate from canonical ban state", async () => {
    const printingCatalog = {
      ...catalog,
      cards: [
        {
          ...catalog.cards[0],
          id: "released-printing",
          available: true,
          availabilityReason: "available",
          banned: false
        },
        {
          ...catalog.cards[0],
          id: "unreleased-printing",
          available: false,
          availabilityReason: "previewNotReleased",
          banned: false
        }
      ]
    };
    const client = new CardCatalogClient({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(printingCatalog))
    });

    const result = await client.loadCatalog(DEFAULT_CARD_SERVER_URL);

    expect(result.cards).toEqual([
      expect.objectContaining({
        id: "released-printing",
        available: true,
        availabilityReason: "available",
        banned: false
      }),
      expect.objectContaining({
        id: "unreleased-printing",
        available: false,
        availabilityReason: "previewNotReleased",
        banned: false
      })
    ]);
  });


  it("rejects malformed catalog data instead of rendering server fields", async () => {
    const client = new CardCatalogClient({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({
        ...catalog,
        cards: [{ ...catalog.cards[0], variant: "promo" }]
      }))
    });

    await expect(client.loadCatalog(DEFAULT_CARD_SERVER_URL)).rejects
      .toMatchObject({ kind: "invalid-catalog" });
  });

  it("maps fetch and HTTP failures to actionable errors", async () => {
    const networkClient = new CardCatalogClient({
      fetchImpl: vi.fn().mockRejectedValue(new Error("offline"))
    });
    const serverClient = new CardCatalogClient({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ error: "unavailable" }, 500))
    });

    await expect(networkClient.loadCatalog(DEFAULT_CARD_SERVER_URL)).rejects
      .toMatchObject({ kind: "network", message: expect.stringContaining("无法连接") });
    await expect(serverClient.loadCatalog(DEFAULT_CARD_SERVER_URL)).rejects
      .toMatchObject({ kind: "network", message: "仓库服务返回错误 500。" });
  });

  it("submits all six zones under the server deck wrapper", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      valid: true,
      overflow: false,
      totalCards: 18,
      zoneCounts: {
        mainDeck: 1,
        runes: 12,
        legend: 1,
        champion: 1,
        battlefields: 1,
        sideboard: 2
      },
      canonicalCardCounts: { "flame-warden": 1 },
      issues: [],
      printingIssues: []
    }));
    const client = new CardCatalogClient({ fetchImpl });

    const result = await client.validateDeck("http://127.0.0.1:8787", {
      mainDeck: [{ cardId: "flame-warden-standard", quantity: 1 }],
      runes: [{ cardId: "basic-rune-standard", quantity: 12 }],
      legend: [{ cardId: "legend-standard", quantity: 1 }],
      champion: [{ cardId: "champion-standard", quantity: 1 }],
      battlefields: [{ cardId: "battlefield-standard", quantity: 1 }],
      sideboard: [
        { cardId: "flame-warden-art", quantity: 2 },
        { cardId: "unused-card", quantity: 0 }
      ]
    });

    const body = JSON.parse(vi.mocked(fetchImpl).mock.calls[0][1]?.body as string);
    expect(body).toEqual({
      deck: {
        mainDeck: [{ cardId: "flame-warden-standard", quantity: 1 }],
        runes: [{ cardId: "basic-rune-standard", quantity: 12 }],
        legend: [{ cardId: "legend-standard", quantity: 1 }],
        champion: [{ cardId: "champion-standard", quantity: 1 }],
        battlefields: [{ cardId: "battlefield-standard", quantity: 1 }],
        sideboard: [{ cardId: "flame-warden-art", quantity: 2 }]
      }
    });
    expect(Object.keys(body)).toEqual(["deck"]);
    expect(Object.keys(body.deck)).not.toContain("policy");
    expect(Object.keys(body.deck)).not.toContain("identity");
    expect(Object.keys(body.deck)).not.toContain("digest");
    expect(result.overflow).toBe(false);
    expect(result.zoneCounts.runes).toBe(12);
    expect(result.printingIssues).toEqual([]);
  });

  it("rejects malformed validation responses", async () => {
    const client = new CardCatalogClient({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ valid: true }))
    });

    await expect(client.validateDeck(DEFAULT_CARD_SERVER_URL, {})).rejects
      .toMatchObject({ kind: "network", message: "卡组校验响应格式无效。" });
  });

  it("preserves server printing issues for unavailable printings", async () => {
    const response = {
      valid: false,
      overflow: false,
      totalCards: 1,
      zoneCounts: { mainDeck: 1 },
      canonicalCardCounts: { "released-identity": 1 },
      issues: [],
      printingIssues: [
        {
          cardId: "unreleased-printing",
          canonicalCardId: "released-identity",
          zone: "mainDeck",
          status: "previewNotReleased",
          message:
            "Printing unreleased-printing is a Radiance preview printing and is not released."
        }
      ]
    };
    const client = new CardCatalogClient({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(response))
    });

    const result = await client.validateDeck(DEFAULT_CARD_SERVER_URL, {
      mainDeck: [{ cardId: "unreleased-printing", quantity: 1 }]
    });

    expect(result.valid).toBe(false);
    expect(result.printingIssues).toEqual([response.printingIssues[0]]);
  });

  it("migrates the v1 deck to mainDeck and persists six zones", () => {
    const storage = new MemoryStorage();
    storage.setItem("riftbound.desktop-client.deck", JSON.stringify({
      schemaVersion: 1,
      entries: { "flame-standard": 2, "flame-art": 1 }
    }));

    const migrated = readStoredDeck(storage);
    expect(migrated).toEqual({
      ...emptyDeckByZone(),
      mainDeck: { "flame-standard": 2, "flame-art": 1 }
    });

    const next = {
      ...migrated,
      runes: { "basic-rune": 12 },
      battlefields: { "hall-of-fire": 1 },
      legend: { "ancient-legend": 1 },
      champion: { "flame-champion": 1 },
      sideboard: { "flame-standard": 1 }
    };
    writeStoredDeck(storage, next);
    expect(readStoredDeck(storage)).toEqual(next);
    expect(JSON.parse(storage.getItem("riftbound.desktop-client.deck") ?? "{}").schemaVersion)
      .toBe(2);
  });

  it("recovers to an empty six-zone deck when storage is corrupt", () => {
    const storage = new MemoryStorage();
    storage.setItem("riftbound.desktop-client.deck", "{broken");

    expect(readStoredDeck(storage)).toEqual(emptyDeckByZone());
  });

  it("builds the six-zone submission input for the network client", () => {
    const deck = {
      ...emptyDeckByZone(),
      mainDeck: { "flame-standard": 2 },
      sideboard: { "flame-art": 1 }
    };

    expect(toDeckSubmission(deck)).toEqual({
      mainDeck: [{ cardId: "flame-standard", quantity: 2 }],
      runes: [],
      legend: [],
      champion: [],
      battlefields: [],
      sideboard: [{ cardId: "flame-art", quantity: 1 }]
    });
  });

  it("uses zone-specific limits and shared main, champion, and sideboard counting", () => {
    const flame = {
      ...catalog.cards[0],
      id: "flame-standard",
      canonicalCardId: "flame-warden"
    };
    const flameArt = { ...flame, id: "flame-art" };
    const rune = { ...flame, id: "basic-rune", cardType: "Rune" };
    const battlefield = { ...flame, id: "hall", cardType: "Battlefield" };
    const legend = { ...flame, id: "legend", cardType: "Legend" };
    const cards = [flame, flameArt, rune, battlefield, legend];

    expect(limitFor(rune, "runes")).toBe(12);
    expect(limitFor(battlefield, "battlefields")).toBe(1);
    expect(limitFor(legend, "legend")).toBe(1);
    expect(limitFor(flame, "mainDeck")).toBe(3);
    expect(allowedZonesFor({ ...flame, cardType: "Champion" }))
      .toEqual(["mainDeck", "champion", "sideboard"]);
    expect(sharedLimitZones("mainDeck")).toEqual([
      "mainDeck",
      "champion",
      "sideboard"
    ]);
    expect(sharedLimitZones("runes")).toEqual(["runes"]);

    const deck = {
      ...emptyDeckByZone(),
      champion: { "flame-standard": 1 },
      sideboard: { "flame-art": 2 }
    };
    expect(zoneCanonicalCount(deck, "champion", "flame-warden", cards)).toBe(1);
    expect(zoneCanonicalCount(deck, "sideboard", "flame-warden", cards)).toBe(2);

    const cardsWithAlternates = [
      { ...flame, allowedZones: ["mainDeck", "champion", "sideboard"] as const },
      { ...flameArt, allowedZones: ["mainDeck", "champion", "sideboard"] as const }
    ];
    expect(buildCardLimits(cardsWithAlternates, "mainDeck", {
      ...emptyDeckByZone(),
      champion: { "flame-standard": 1 }
    }).get("flame-warden")).toBe(2);

    expect(buildCardLimits(cardsWithAlternates, "sideboard", {
      ...emptyDeckByZone(),
      mainDeck: { "flame-standard": 1 },
      champion: { "flame-art": 1 }
    }).get("flame-warden")).toBe(1);

    expect(buildCardLimits(cardsWithAlternates, "champion", {
      ...emptyDeckByZone(),
      mainDeck: { "flame-standard": 2 },
      sideboard: { "flame-art": 1 }
    }).get("flame-warden")).toBe(0);

    const bannedAlternate = {
      ...flameArt,
      id: "flame-banned-art",
      banned: true
    };
    expect(buildCardLimits(
      [...cardsWithAlternates, bannedAlternate],
      "mainDeck",
      emptyDeckByZone()
    ).get("flame-warden")).toBe(3);
  });

  it("keeps catalog presence separate from implemented card abilities", () => {
    const effectFree = { ...catalog.cards[0], ability: "" };
    const withAbility = catalog.cards[0];
    const gear = {
      ...catalog.cards[0],
      id: "basic-gear",
      cardType: "Gear",
      ability: ""
    };
    const basicRune = {
      ...catalog.cards[0],
      id: "basic-rune",
      cardType: "Rune",
      ability: ""
    };
    const unknownType = {
      ...catalog.cards[0],
      id: "unknown-card",
      cardType: "Relic",
      ability: ""
    };

    expect(isCardAbilityImplemented(effectFree)).toBe(true);
    expect(isCardAbilityImplemented(withAbility)).toBe(false);
    expect(isCardAbilityImplemented(gear)).toBe(false);
    expect(isCardAbilityImplemented(basicRune)).toBe(false);
    expect(isCardAbilityImplemented(unknownType)).toBe(false);
    expect(withAbility.name).toBe("Flame Warden");
    expect(withAbility.imageUrl).toBeNull();
  });

  it("allows resubmitting a submitted deck while the room is still waiting", () => {
    expect(canSubmitRoomDeck({ requestPending: false, roomStatus: "waiting" }))
      .toBe(true);
    expect(canSubmitRoomDeck({ requestPending: true, roomStatus: "waiting" }))
      .toBe(false);
    expect(canSubmitRoomDeck({ requestPending: false, roomStatus: "playing" }))
      .toBe(false);
    expect(canSubmitRoomDeck({ requestPending: false, roomStatus: null }))
      .toBe(false);
  });

  it("exposes a stable error class for callers", () => {
    const error = new CardCatalogClientErrorImpl("network", "offline");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("CardCatalogClientError");
  });
});

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}
