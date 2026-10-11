import { afterEach, describe, expect, it } from "vitest";
import type { GameServer, GameServerOptions } from "@riftbound/game-server-src";
import {
  catalogFixture,
  startCatalogServer,
  type FixtureCatalogCard,
  type PublicCardCatalog
} from "./test-support/card-catalog-fixture.js";

const servers: GameServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
});

async function startServer(
  options: {
    catalog?: unknown;
    deckRules?: GameServerOptions["deckRules"];
  } = {}
): Promise<string> {
  const started = await startCatalogServer(options);
  servers.push(started.server);
  return started.baseUrl;
}

function catalogWithMaliciousCard(
  field: "canonicalCardId" | "cardPolicies",
  value: unknown
): unknown {
  const cards = catalogFixture.cards.map(card => ({ ...card }));
  (cards[0] as Record<string, unknown>)[field] = value;
  return {
    ...catalogFixture,
    cards
  };
}

function validateDeck(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/decks/validate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("real game-server card catalog HTTP integration", () => {
  it("serves a derived public catalog without implementation fields", async () => {
    const baseUrl = await startServer({
      catalog: {
        ...catalogFixture,
        groups: [
          {
            canonicalCardId: "integration.flame-warden",
            primaryPrintingId: "integration.flame-warden.standard",
            printings: [
              "integration.flame-warden.standard",
              "integration.flame-warden.alternate"
            ]
          }
        ]
      }
    });

    const response = await fetch(`${baseUrl}/api/cards`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type"))
      .toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");

    const catalog = await response.json() as PublicCardCatalog;
    expect(catalog.schemaVersion).toBe(1);
    expect(catalog.dataVersion).toBe(catalogFixture.dataVersion);
    expect(catalog.digest).toBe(catalogFixture.digest);
    expect(catalog.policy).toEqual(expect.objectContaining({
      format: expect.any(String),
      checkedAt: expect.any(String),
      cardPolicies: expect.any(Object)
    }));
    expect(catalog.cards.map(card => card.id)).toEqual(
      catalogFixture.cards.map(card => card.id)
    );
    for (const [index, card] of catalog.cards.entries()) {
      const fixtureCard: FixtureCatalogCard | undefined = catalogFixture.cards[index];
      if (fixtureCard === undefined) throw new Error(`Missing fixture card ${index}`);
      expect(card).toMatchObject(fixtureCard);
      expect(card.allowedZones).toEqual(["mainDeck", "sideboard"]);
      expect(card.maxCopies).toBe(3);
      expect(card.banned).toBe(false);
    }

    const rawBody = await (await fetch(`${baseUrl}/api/cards`)).text();
    expect(rawBody.endsWith("\n")).toBe(true);
    expect(rawBody).not.toContain("internalNotes");
    expect(rawBody).not.toContain("privateNotes");
  });

  it("accepts a valid injected deck and returns authoritative counts", async () => {
    const baseUrl = await startServer({
      catalog: catalogFixture,
      deckRules: { defaultMaxCopiesPerCanonical: 3 }
    });

    const response = await validateDeck(baseUrl, {
      deck: {
        mainDeck: [
          { cardId: "integration.flame-warden.standard", quantity: 2 },
          { cardId: "integration.tide-oracle", quantity: 3 }
        ]
      }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      valid: true,
      overflow: false,
      totalCards: 5,
      zoneCounts: {
        mainDeck: 5,
        runes: 0,
        legend: 0,
        champion: 0,
        battlefields: 0,
        sideboard: 0
      },
      canonicalCardCounts: {
        "integration.flame-warden": 2,
        "integration.tide-oracle": 3
      },
      issues: []
    });
  });

  it("counts alternate and normal printings as one copy pool", async () => {
    const baseUrl = await startServer({
      catalog: catalogFixture,
      deckRules: { defaultMaxCopiesPerCanonical: 3 }
    });

    const response = await validateDeck(baseUrl, {
      deck: {
        mainDeck: [
          { cardId: "integration.flame-warden.standard", quantity: 2 },
          { cardId: "integration.flame-warden.alternate", quantity: 2 }
        ]
      }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      valid: false,
      totalCards: 4,
      canonicalCardCounts: { "integration.flame-warden": 4 },
      issues: [{
        code: "copy_limit_exceeded",
        canonicalCardId: "integration.flame-warden",
        message: "Card Flame Warden appears 4 times; the limit is 3."
      }]
    });
  });

  it("counts normal and alternate printings across main deck and sideboard", async () => {
    const baseUrl = await startServer({
      catalog: catalogFixture,
      deckRules: {
        defaultMaxCopiesPerCanonical: 3,
        copyRules: [{
          zones: ["mainDeck", "sideboard"],
          maxCopiesPerCanonical: 3
        }]
      }
    });

    const response = await validateDeck(baseUrl, {
      deck: {
        mainDeck: [
          { cardId: "integration.flame-warden.standard", quantity: 2 },
          { cardId: "integration.flame-warden.alternate", quantity: 1 }
        ],
        sideboard: [
          { cardId: "integration.flame-warden.alternate", quantity: 1 }
        ]
      }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      valid: false,
      totalCards: 4,
      zoneCounts: {
        mainDeck: 3,
        sideboard: 1,
        runes: 0,
        legend: 0,
        champion: 0,
        battlefields: 0
      },
      canonicalCardCounts: { "integration.flame-warden": 4 },
      issues: [{
        code: "copy_limit_exceeded",
        canonicalCardId: "integration.flame-warden"
      }]
    });
  });

  it("accepts entry properties in either order and rejects unknown deck fields", async () => {
    const baseUrl = await startServer({
      catalog: catalogFixture,
      deckRules: { defaultMaxCopiesPerCanonical: 3 }
    });

    const valid = await validateDeck(baseUrl, {
      deck: {
        mainDeck: [{ quantity: 2, cardId: "integration.tide-oracle" }]
      }
    });
    expect(valid.status).toBe(200);
    await expect(valid.json()).resolves.toMatchObject({
      valid: true,
      totalCards: 2,
      canonicalCardCounts: { "integration.tide-oracle": 2 },
      issues: []
    });

    const unknownBeforeKnownZone = await validateDeck(baseUrl, {
      deck: { ignoredZone: [], mainDeck: [] }
    });
    expect(unknownBeforeKnownZone.status).toBe(400);
    await expect(unknownBeforeKnownZone.json()).resolves.toMatchObject({
      error: "invalid-deck-request"
    });

    const unknownAfterKnownZone = await validateDeck(baseUrl, {
      deck: { mainDeck: [], ignoredZone: [] }
    });
    expect(unknownAfterKnownZone.status).toBe(400);
    await expect(unknownAfterKnownZone.json()).resolves.toMatchObject({
      error: "invalid-deck-request"
    });
  });

  it("supports CORS preflight for catalog and validation routes", async () => {
    const baseUrl = await startServer({ catalog: catalogFixture });

    for (const path of ["/api/cards", "/api/decks/validate"]) {
      const preflight = await fetch(`${baseUrl}${path}`, {
        method: "OPTIONS",
        headers: {
          origin: "http://localhost:5173",
          "access-control-request-method":
            path === "/api/cards" ? "GET" : "POST",
          "access-control-request-headers": "content-type"
        }
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
      expect(preflight.headers.get("access-control-allow-methods"))
        .toBe("GET, POST, OPTIONS");
      expect(preflight.headers.get("access-control-allow-headers"))
        .toBe("content-type");
    }
  });

  it("rejects client-supplied canonical metadata before serving a catalog", async () => {
    const malicious = catalogWithMaliciousCard(
      "canonicalCardId",
      "card.attacker-controlled"
    );
    const baseUrl = await startServer({ catalog: malicious });

    const cards = await fetch(`${baseUrl}/api/cards`);
    expect(cards.status).toBe(503);
    await expect(cards.json()).resolves.toMatchObject({
      error: "catalog-unavailable",
      message: "Official English fullName Flame Warden maps to multiple canonical cards."
    });

    const validate = await validateDeck(baseUrl, { deck: { mainDeck: [] } });
    expect(validate.status).toBe(503);
  });

  it("rejects attacker-controlled policy metadata before deck validation", async () => {
    const malicious = catalogWithMaliciousCard("cardPolicies", {
      "integration.flame-warden": { type: "limited", maxCopies: 99 }
    });
    const baseUrl = await startServer({ catalog: malicious });

    const response = await validateDeck(baseUrl, {
      deck: {
        mainDeck: [
          { cardId: "integration.flame-warden.standard", quantity: 4 }
        ]
      }
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "catalog-unavailable",
      message: "Card catalog entry 0 is invalid."
    });
  });
});
