import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGameServer, type GameServer } from "../src/server.js";

interface StartedServer {
  server: GameServer;
  baseUrl: string;
}

const servers: GameServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
  vi.restoreAllMocks();
});

const catalog = {
  schemaVersion: 1,
  dataVersion: "2026-10-11-original-fixture",
  digest: "sha256:" + "a".repeat(64),
  groups: [
    {
      canonicalCardId: "fixture.flame-warden",
      primaryPrintingId: "fixture.flame-warden.standard",
      printings: [
        "fixture.flame-warden.standard",
        "fixture.flame-warden.alternate"
      ]
    }
  ],
  cards: [
    {
      id: "fixture.flame-warden.standard",
      canonicalCardId: "fixture.flame-warden",
      name: "Flame Warden",
      fullName: "Flame Warden",
      cardType: "Unit",
      domains: ["Ember"],
      tags: ["guard", "fixture"],
      setCode: "unl",
      cardNumber: "001",
      variant: "standard",
      imageUrl: null,
      energy: 2,
      power: 3,
      might: null,
      ability: "Original guard fixture."
    },
    {
      id: "fixture.flame-warden.alternate",
      canonicalCardId: "fixture.flame-warden",
      name: "Flame Warden",
      subtitle: "Ember Guard",
      fullName: "Flame Warden",
      localizedName: "Original localized name",
      cardType: "Unit",
      domains: ["Ember"],
      tags: ["guard", "alternate-art"],
      setCode: "unl",
      cardNumber: "001-A",
      variant: "alternate",
      imageUrl: null,
      energy: 2,
      power: 3,
      might: null,
      ability: "Original guard fixture."
    },
    {
      id: "fixture.tide-oracle",
      canonicalCardId: "fixture.tide-oracle",
      name: "Tide Oracle",
      fullName: "Tide Oracle",
      cardType: "Unit",
      domains: ["Tide"],
      tags: ["oracle", "fixture"],
      setCode: "unl",
      cardNumber: "002",
      variant: "standard",
      imageUrl: null,
      energy: 1,
      power: 2,
      might: null,
      ability: "Original oracle fixture."
    }
  ]
};

const multilineAbilityCatalog = {
  ...catalog,
  cards: [
    {
      ...catalog.cards[0],
      ability: "First line\nSecond line"
    },
    {
      ...catalog.cards[1],
      ability: ""
    },
    ...catalog.cards.slice(2)
  ]
};

const publicGroupCatalog = {
  ...catalog,
  dataVersion: "2026-10-11-public-group-fixture",
  digest: "sha256:" + "d".repeat(64),
  groups: [
    {
      canonicalCardId: "fixture.flame-warden",
      identityProvenance: "official-name-rule",
      ruleReferences: ["CR 132.3", "CR 132.4"],
      fullName: "Flame Warden",
      primaryPrintingId: "fixture.flame-warden.standard",
      printings: [
        "fixture.flame-warden.standard",
        "fixture.flame-warden.alternate"
      ]
    }
  ]
};

const printingPolicyCatalog = {
  schemaVersion: 1,
  dataVersion: "2026-10-11-printing-policy-fixture",
  digest: "sha256:" + "b".repeat(64),
  cards: [
    {
      id: "fixture.released-printing.ogn",
      canonicalCardId: "fixture.released-identity",
      name: "Released Reprint",
      fullName: "Released Reprint",
      cardType: "Unit",
      domains: [],
      tags: [],
      setCode: "ogn",
      cardNumber: "200",
      variant: "standard",
      imageUrl: null,
      energy: 1,
      power: 1,
      might: null,
      ability: "Released printing fixture."
    },
    {
      id: "fixture.released-printing.rad",
      canonicalCardId: "fixture.released-identity",
      name: "Released Reprint",
      fullName: "Released Reprint",
      cardType: "Unit",
      domains: [],
      tags: [],
      setCode: "rad",
      cardNumber: "200",
      variant: "standard",
      imageUrl: null,
      energy: 1,
      power: 1,
      might: null,
      ability: "Radiance printing fixture."
    },
    {
      id: "fixture.radiance-only.rad",
      canonicalCardId: "fixture.radiance-only",
      name: "Radiance Only",
      fullName: "Radiance Only",
      cardType: "Unit",
      domains: [],
      tags: [],
      setCode: "rad",
      cardNumber: "201",
      variant: "standard",
      imageUrl: null,
      energy: 1,
      power: 1,
      might: null,
      ability: "Radiance-only fixture."
    },
    {
      id: "fixture.nonstandard-only.arc",
      canonicalCardId: "fixture.nonstandard-only",
      name: "Non-Standard Only",
      fullName: "Non-Standard Only",
      cardType: "Unit",
      domains: [],
      tags: [],
      setCode: "arc",
      cardNumber: "202",
      variant: "standard",
      imageUrl: null,
      energy: 1,
      power: 1,
      might: null,
      ability: "Non-Standard fixture."
    }
  ]
};

const zoneMappingCatalog = {
  schemaVersion: 1,
  dataVersion: "2026-10-11-zone-fixture",
  digest: "sha256:" + "c".repeat(64),
  cards: [
    {
      id: "fixture.normal-unit",
      canonicalCardId: "fixture.normal-unit",
      name: "Normal Unit",
      fullName: "Normal Unit",
      cardType: "Unit",
      domains: [],
      tags: [],
      setCode: "unl",
      cardNumber: "100",
      variant: "standard",
      imageUrl: null,
      energy: 1,
      power: 1,
      might: null,
      ability: "Normal unit fixture."
    },
    {
      id: "fixture.champion-unit",
      canonicalCardId: "fixture.champion-unit",
      name: "Champion Unit",
      fullName: "Champion Unit",
      cardType: "Unit",
      domains: [],
      tags: ["Champion"],
      setCode: "unl",
      cardNumber: "101",
      variant: "standard",
      imageUrl: null,
      energy: 1,
      power: 1,
      might: null,
      ability: "Champion unit fixture."
    },
    {
      id: "fixture.gear",
      canonicalCardId: "fixture.gear",
      name: "Fixture Gear",
      fullName: "Fixture Gear",
      cardType: "Gear",
      domains: [],
      tags: [],
      setCode: "unl",
      cardNumber: "102",
      variant: "standard",
      imageUrl: null,
      energy: 1,
      power: null,
      might: null,
      ability: "Gear fixture."
    },
    {
      id: "fixture.spell",
      canonicalCardId: "fixture.spell",
      name: "Fixture Spell",
      fullName: "Fixture Spell",
      cardType: "Spell",
      domains: [],
      tags: [],
      setCode: "unl",
      cardNumber: "103",
      variant: "standard",
      imageUrl: null,
      energy: 1,
      power: null,
      might: null,
      ability: "Spell fixture."
    },
    {
      id: "fixture.rune",
      canonicalCardId: "fixture.rune",
      name: "Fixture Rune",
      fullName: "Fixture Rune",
      cardType: "Rune",
      domains: [],
      tags: [],
      setCode: "unl",
      cardNumber: "104",
      variant: "standard",
      imageUrl: null,
      energy: null,
      power: null,
      might: null,
      ability: "Rune fixture."
    },
    {
      id: "fixture.legend",
      canonicalCardId: "fixture.legend",
      name: "Fixture Legend",
      fullName: "Fixture Legend",
      cardType: "Legend",
      domains: [],
      tags: [],
      setCode: "unl",
      cardNumber: "105",
      variant: "standard",
      imageUrl: null,
      energy: null,
      power: null,
      might: null,
      ability: "Legend fixture."
    },
    {
      id: "fixture.battlefield",
      canonicalCardId: "fixture.battlefield",
      name: "Fixture Battlefield",
      fullName: "Fixture Battlefield",
      cardType: "Battlefield",
      domains: [],
      tags: [],
      setCode: "unl",
      cardNumber: "106",
      variant: "standard",
      imageUrl: null,
      energy: null,
      power: null,
      might: null,
      ability: "Battlefield fixture."
    },
    {
      id: "fixture.token",
      canonicalCardId: "fixture.token",
      name: "Fixture Token",
      fullName: "Fixture Token",
      cardType: "Token",
      domains: [],
      tags: [],
      setCode: "unl",
      cardNumber: "107",
      variant: "standard",
      imageUrl: null,
      energy: 1,
      power: 1,
      might: null,
      ability: "Token fixture."
    }
  ]
};

describe("card HTTP API", () => {
  it("returns only the server-owned public catalog", async () => {
    const { baseUrl } = await startServer({
      catalog,
      imagesDirectory: (await emptyImagesDirectory()).imagesDirectory
    });

    const response = await fetch(`${baseUrl}/api/cards`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type"))
      .toBe("application/json; charset=utf-8");

    const body = await response.json();
    const expectedCards = catalog.cards.map(card => ({
      ...card,
      allowedZones: ["mainDeck", "sideboard"],
      maxCopies: 3,
      banned: false,
      available: true,
      availabilityReason: "available"
    }));
    expect(body).toEqual({
      ...catalog,
      cards: expectedCards,
      policy: expect.any(Object)
    });
  });

  it("returns only verified public group provenance", async () => {
    const { baseUrl } = await startServer({
      catalog: publicGroupCatalog,
      imagesDirectory: (await emptyImagesDirectory()).imagesDirectory
    });

    const response = await fetch(`${baseUrl}/api/cards`);
    if (response.status !== 200) console.error(await response.text());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.groups).toEqual([
      {
        canonicalCardId: "fixture.flame-warden",
        primaryPrintingId: "fixture.flame-warden.standard",
        printings: [
          "fixture.flame-warden.standard",
          "fixture.flame-warden.alternate"
        ],
        identityProvenance: "official-name-rule",
        ruleReferences: ["CR 132.3", "CR 132.4"],
        fullName: "Flame Warden"
      }
    ]);
  });

  it("rejects groups with private provenance fields", async () => {
    const { baseUrl } = await startServer({
      catalog: {
        ...catalog,
        groups: [
          {
            ...catalog.groups[0],
            privateNotes: "Internal identity notes."
          }
        ]
      },
      imagesDirectory: (await emptyImagesDirectory()).imagesDirectory
    });

    const response = await fetch(`${baseUrl}/api/cards`);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "catalog-unavailable"
    });
  });

  it("accepts deck and entry fields in any key order but rejects unknown deck fields", async () => {
    const { baseUrl } = await startServer({
      catalog,
      imagesDirectory: (await emptyImagesDirectory()).imagesDirectory
    });

    const valid = await fetch(`${baseUrl}/api/decks/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deck: {
          mainDeck: [
            { quantity: 1, cardId: "fixture.tide-oracle" }
          ]
        }
      })
    });
    expect(valid.status).toBe(200);
    expect((await valid.json()).issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "card_not_allowed_in_zone" })
      ])
    );

    const invalidBeforeKnownKey = await fetch(
      `${baseUrl}/api/decks/validate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deck: {
            ignoredZone: [],
            mainDeck: []
          }
        })
      }
    );
    expect(invalidBeforeKnownKey.status).toBe(400);
    expect(await invalidBeforeKnownKey.json()).toMatchObject({
      error: "invalid-deck-request"
    });

    const invalidAfterKnownKey = await fetch(
      `${baseUrl}/api/decks/validate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deck: {
            mainDeck: [],
            ignoredZone: []
          }
        })
      }
    );
    expect(invalidAfterKnownKey.status).toBe(400);
    expect(await invalidAfterKnownKey.json()).toMatchObject({
      error: "invalid-deck-request"
    });
  });

  it("rejects deck requests that use client-owned legality fields", async () => {
    const { baseUrl } = await startServer({
      catalog,
      imagesDirectory: (await emptyImagesDirectory()).imagesDirectory
    });

    const response = await fetch(`${baseUrl}/api/decks/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deck: {
          mainDeck: [{ cardId: "fixture.tide-oracle", quantity: 1 }]
        },
        ignoredClientBanlist: { "fixture.tide-oracle": "banned" }
      })
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "invalid-deck-request"
    });
  });

  it("supports public browser CORS requests and rejects malformed URL encoding", async () => {
    const { baseUrl } = await startServer({
      catalog,
      imagesDirectory: (await emptyImagesDirectory()).imagesDirectory
    });

    const preflight = await fetch(`${baseUrl}/api/cards`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET"
      }
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");

    const cards = await fetch(`${baseUrl}/api/cards`, {
      headers: { origin: "http://localhost:5173" }
    });
    expect(cards.status).toBe(200);
    expect(cards.headers.get("access-control-allow-origin")).toBe("*");

    const invalidPath = await fetch(
      `${baseUrl}/api/card-images/%e0%a4%a`,
      { headers: { origin: "http://localhost:5173" } }
    );
    expect(invalidPath.status).toBe(400);
    expect(await invalidPath.json()).toEqual({
      error: "invalid-url-encoding"
    });
  });

  it("loads official-style cards with empty or multiline ability text", async () => {
    const { baseUrl } = await startServer({
      catalog: multilineAbilityCatalog,
      imagesDirectory: (await emptyImagesDirectory()).imagesDirectory
    });

    const response = await fetch(`${baseUrl}/api/cards`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.cards[0].ability).toBe("First line\nSecond line");
    expect(body.cards[1].ability).toBe("");
  });

  it("serves each manifest image type only when its id, filename, size, and digest match", async () => {
    const { imagesDirectory } = await emptyImagesDirectory();
    const pngBytes = Buffer.from(
      "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
      "01f15c4890000000a49444154789c6360000002000154a24f5f0" +
      "0000049454e44ae426082",
      "hex"
    );
    const avifBytes = Buffer.from([
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70,
      0x61, 0x76, 0x69, 0x66, 0x00, 0x00, 0x00, 0x00,
      0x61, 0x76, 0x69, 0x66, 0x6d, 0x69, 0x66, 0x31,
      0x00, 0x00, 0x00, 0x00, 0x6d, 0x64, 0x61, 0x74
    ]);
    await writeFile(
      path.join(imagesDirectory, "fixture.flame-warden.standard.avif"),
      avifBytes
    );
    await writeFile(
      path.join(imagesDirectory, "unlisted-secret.png"),
      pngBytes
    );
    await writeFile(
      path.join(path.dirname(imagesDirectory), "images-manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        images: [
          {
            id: "fixture.flame-warden.standard",
            file: "fixture.flame-warden.standard.avif",
            url: "https://example.invalid/fixture.avif",
            sha256: `sha256:${createHash("sha256").update(avifBytes).digest("hex")}`,
            bytes: avifBytes.byteLength,
            contentType: "image/avif"
          }
        ]
      })
    );

    const { baseUrl } = await startServer({
      catalog,
      imagesDirectory
    });

    const image = await fetch(
      `${baseUrl}/api/card-images/fixture.flame-warden.standard`
    );
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/avif");
    expect(Buffer.from(await image.arrayBuffer()).toString("hex"))
      .toBe(avifBytes.toString("hex"));

    const unlisted = await fetch(`${baseUrl}/api/card-images/unlisted-secret`);
    expect(unlisted.status).toBe(404);

    const traversal = await fetch(
      `${baseUrl}/api/card-images/%2e%2e%2funlisted-secret`
    );
    expect(traversal.status).toBe(404);
  });

  it("counts alternate and normal printings against one server-owned canonical identity", async () => {
    const { baseUrl } = await startServer({
      catalog,
      imagesDirectory: (await emptyImagesDirectory()).imagesDirectory,
      deckRules: {
        defaultMaxCopiesPerCanonical: 3,
        cardPolicies: {
          "fixture.tide-oracle": { type: "limited", maxCopies: 1 }
        }
      }
    });

    const response = await fetch(`${baseUrl}/api/decks/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deck: {
          mainDeck: [
            { cardId: "fixture.flame-warden.standard", quantity: 2 },
            { cardId: "fixture.flame-warden.alternate", quantity: 2 },
            { cardId: "fixture.tide-oracle", quantity: 2 }
          ]
        }
      })
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.valid).toBe(false);
    expect(result.totalCards).toBe(6);
    expect(result.canonicalCardCounts).toEqual({
      "fixture.flame-warden": 4,
      "fixture.tide-oracle": 2
    });
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]).toMatchObject({
      code: "copy_limit_exceeded",
      canonicalCardId: "fixture.flame-warden"
    });
    expect(result.issues[1]).toMatchObject({
      code: "copy_limit_exceeded",
      canonicalCardId: "fixture.tide-oracle"
    });
  });

  it("does not ignore authoritative catalog legality policies", async () => {
    const { baseUrl } = await startServer({
      catalog,
      imagesDirectory: (await emptyImagesDirectory()).imagesDirectory,
      deckRules: {
        defaultMaxCopiesPerCanonical: 3,
        cardPolicies: {
          "fixture.flame-warden": { type: "banned" },
          "fixture.tide-oracle": { type: "limited", maxCopies: 1 }
        }
      }
    });

    const response = await fetch(`${baseUrl}/api/decks/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deck: {
          mainDeck: [
            { cardId: "fixture.flame-warden.standard", quantity: 1 },
            { cardId: "fixture.flame-warden.alternate", quantity: 1 },
            { cardId: "fixture.tide-oracle", quantity: 2 }
          ]
        }
      })
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "banned_card",
        canonicalCardId: "fixture.flame-warden"
      }),
      expect.objectContaining({
        code: "copy_limit_exceeded",
        canonicalCardId: "fixture.tide-oracle"
      })
    ]);
  });

  it("projects limited card policies into the public catalog maxCopies", async () => {
    const { baseUrl } = await startServer({
      catalog,
      imagesDirectory: (await emptyImagesDirectory()).imagesDirectory,
      deckRules: {
        defaultMaxCopiesPerCanonical: 3,
        cardPolicies: {
          "fixture.flame-warden": { type: "restricted" },
          "fixture.tide-oracle": { type: "limited", maxCopies: 1 }
        }
      }
    });

    const response = await fetch(`${baseUrl}/api/cards`);
    expect(response.status).toBe(200);
    const body = await response.json();
    const cardsById = new Map(
      body.cards.map((card: { id: string }) => [card.id, card])
    );

    expect(cardsById.get("fixture.flame-warden.standard")?.maxCopies).toBe(1);
    expect(cardsById.get("fixture.flame-warden.alternate")?.maxCopies).toBe(1);
    expect(cardsById.get("fixture.tide-oracle")?.maxCopies).toBe(1);
  });

  it("rejects unreleased printings without banning released same-identity printings", async () => {
    const { baseUrl } = await startServer({
      catalog: printingPolicyCatalog,
      imagesDirectory: (await emptyImagesDirectory()).imagesDirectory
    });

    const cardsResponse = await fetch(`${baseUrl}/api/cards`);
    expect(cardsResponse.status).toBe(200);
    const body = await cardsResponse.json();
    const cards = body.cards as Array<{
      id: string;
      canonicalCardId: string;
      maxCopies: number;
      available: boolean;
      availabilityReason: string;
      banned: boolean;
    }>;
    expect(cards).toEqual([
      expect.objectContaining({
        id: "fixture.released-printing.ogn",
        canonicalCardId: "fixture.released-identity",
        available: true,
        availabilityReason: "available",
        banned: false
      }),
      expect.objectContaining({
        id: "fixture.released-printing.rad",
        canonicalCardId: "fixture.released-identity",
        available: false,
        availabilityReason: "previewNotReleased",
        banned: false
      }),
      expect.objectContaining({
        id: "fixture.radiance-only.rad",
        canonicalCardId: "fixture.radiance-only",
        maxCopies: 0,
        available: false,
        availabilityReason: "previewNotReleased",
        banned: false
      }),
      expect.objectContaining({
        id: "fixture.nonstandard-only.arc",
        canonicalCardId: "fixture.nonstandard-only",
        maxCopies: 0,
        available: false,
        availabilityReason: "notStandard",
        banned: false
      })
    ]);

    const validateWithReleased = await fetch(
      `${baseUrl}/api/decks/validate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deck: {
            mainDeck: [
              { cardId: "fixture.released-printing.ogn", quantity: 1 }
            ]
          }
        })
      }
    );
    expect(validateWithReleased.status).toBe(200);
    const releasedResult = await validateWithReleased.json();
    expect(releasedResult.printingIssues).toEqual([]);
    expect(releasedResult.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "banned_card" })
      ])
    );

    const validateWithRadiance = await fetch(
      `${baseUrl}/api/decks/validate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deck: {
            mainDeck: [
              { cardId: "fixture.released-printing.rad", quantity: 1 }
            ]
          }
        })
      }
    );
    expect(validateWithRadiance.status).toBe(200);
    const radianceResult = await validateWithRadiance.json();
    expect(radianceResult.valid).toBe(false);
    expect(radianceResult.printingIssues).toEqual([
      expect.objectContaining({
        cardId: "fixture.released-printing.rad",
        canonicalCardId: "fixture.released-identity",
        status: "previewNotReleased"
      })
    ]);
    expect(radianceResult.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "banned_card" }),
        expect.objectContaining({ code: "copy_limit_exceeded" })
      ])
    );
  });

  it.each([
    { asOf: "2026-10-15T23:59:59.999Z", available: false },
    { asOf: "2026-10-16T00:00:00.000Z", available: false },
    { asOf: "2026-10-22T23:59:59.999Z", available: false },
    { asOf: "2026-10-23T00:00:00.000Z", available: true },
    { asOf: "2026-10-24T00:00:00.000Z", available: true }
  ].flatMap(boundary => ["2000-01-01", "2030-01-01"].flatMap(systemDate =>
    ["asOf", "now"].map(source => ({ ...boundary, systemDate, source }))
  )))("serves Radiance at $asOf via $source under wall clock $systemDate", async ({ asOf, available, systemDate, source }) => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(systemDate));
    const { baseUrl } = await startServer({
      catalog: printingPolicyCatalog,
      imagesDirectory: (await emptyImagesDirectory()).imagesDirectory,
      constructedPolicy: source === "asOf" ? { asOf } : { now: () => Date.parse(asOf) }
    });
    const response = await fetch(`${baseUrl}/api/cards`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.policy.checkedAt).toBe(asOf.slice(0, 10));
    expect(body.policy.standard.radiance).toEqual({
      status: available ? "active" : "preview-not-released",
      effectiveDate: "2026-10-16",
      releaseDate: "2026-10-23"
    });
    expect(body.policy.standard.legalSetCodes.includes("rad")).toBe(available);
    for (const cardId of ["fixture.released-printing.rad", "fixture.radiance-only.rad"]) {
      expect(body.cards.find((card: { id: string }) => card.id === cardId)).toMatchObject({
        available,
        availabilityReason: available ? "available" : "previewNotReleased",
        banned: false,
        maxCopies: cardId === "fixture.radiance-only.rad" && !available ? 0 : 3
      });
    }
    expect(body.cards.find((card: { id: string }) => card.id === "fixture.released-printing.ogn"))
      .toMatchObject({ available: true, availabilityReason: "available", banned: false, maxCopies: 3 });
    expect(body.cards.find((card: { id: string }) => card.id === "fixture.nonstandard-only.arc"))
      .toMatchObject({ available: false, availabilityReason: "notStandard", banned: false, maxCopies: 0 });

    for (const cardId of ["fixture.released-printing.ogn", "fixture.released-printing.rad", "fixture.radiance-only.rad"]) {
      const validation = await fetch(`${baseUrl}/api/decks/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deck: { mainDeck: [{ cardId, quantity: 1 }] } })
      });
      expect(validation.status).toBe(200);
      const result = await validation.json();
      expect(result.printingIssues).toEqual(available || cardId.endsWith(".ogn") ? [] : [
        expect.objectContaining({ cardId, status: "previewNotReleased" })
      ]);
      expect(result.issues).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "banned_card" })
      ]));
    }
  });

  it("uses one zone mapping for public cards and deck validation", async () => {
    const { baseUrl } = await startServer({
      catalog: zoneMappingCatalog,
      imagesDirectory: (await emptyImagesDirectory()).imagesDirectory
    });

    const cardsResponse = await fetch(`${baseUrl}/api/cards`);
    expect(cardsResponse.status).toBe(200);
    const cards = (await cardsResponse.json()).cards as Array<{
      id: string;
      allowedZones: string[];
      maxCopies: number;
      banned: boolean;
    }>;
    const zonesById = new Map(cards.map(card => [card.id, card.allowedZones]));
    expect(zonesById.get("fixture.normal-unit")).toEqual([
      "mainDeck",
      "sideboard"
    ]);
    expect(zonesById.get("fixture.champion-unit")).toEqual([
      "mainDeck",
      "champion",
      "sideboard"
    ]);
    expect(zonesById.get("fixture.gear")).toEqual(["mainDeck", "sideboard"]);
    expect(zonesById.get("fixture.spell")).toEqual(["mainDeck", "sideboard"]);
    expect(zonesById.get("fixture.rune")).toEqual(["runes"]);
    expect(zonesById.get("fixture.legend")).toEqual(["legend"]);
    expect(zonesById.get("fixture.battlefield")).toEqual(["battlefields"]);
    expect(zonesById.get("fixture.token")).toEqual([]);
    const expectedMaxCopies = new Map([
      ["fixture.rune", 12],
      ["fixture.battlefield", 1]
    ]);
    expect(cards.every(card =>
      card.maxCopies === (expectedMaxCopies.get(card.id) ?? 3) &&
      !card.banned
    )).toBe(true);

    const validationResponse = await fetch(
      `${baseUrl}/api/decks/validate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deck: {
            mainDeck: [
              { cardId: "fixture.normal-unit", quantity: 1 },
              { cardId: "fixture.champion-unit", quantity: 1 },
              { cardId: "fixture.gear", quantity: 1 },
              { cardId: "fixture.spell", quantity: 1 }
            ],
            champion: [{ cardId: "fixture.champion-unit", quantity: 1 }],
            sideboard: [
              { cardId: "fixture.normal-unit", quantity: 1 },
              { cardId: "fixture.champion-unit", quantity: 1 }
            ],
            runes: [{ cardId: "fixture.rune", quantity: 1 }],
            legend: [{ cardId: "fixture.legend", quantity: 1 }],
            battlefields: [{ cardId: "fixture.battlefield", quantity: 1 }]
          }
        })
      }
    );
    expect(validationResponse.status).toBe(200);
    const result = await validationResponse.json();
    expect(result.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "card_not_allowed_in_zone" })
      ])
    );
  });

  it("rejects malformed and oversized deck validation requests", async () => {
    const { baseUrl } = await startServer({
      catalog,
      imagesDirectory: (await emptyImagesDirectory()).imagesDirectory
    });

    const malformed = await fetch(`${baseUrl}/api/decks/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{"
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: "invalid-json" });

    const tooLarge = await fetch(`${baseUrl}/api/decks/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: `{"padding":"${"x".repeat(70_000)}"}`
    });
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toMatchObject({ error: "payload-too-large" });
  });

  it("preserves the existing health route and rejects unknown HTTP routes", async () => {
    const { baseUrl, server } = await startServer({
      catalog,
      imagesDirectory: (await emptyImagesDirectory()).imagesDirectory
    });

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok", rooms: server.rooms.size });

    const unknown = await fetch(`${baseUrl}/api/not-found`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "not found" });
  });
});

async function startServer(options: Parameters<typeof createGameServer>[0]): Promise<StartedServer> {
  const server = createGameServer({
    constructedPolicy: { asOf: "2026-10-11T00:00:00.000Z" },
    ...options, host: "127.0.0.1", port: Number(process.env.SWARM_PORT_BASE ?? 31780)
  });
  servers.push(server);
  await server.start();

  const address = server.httpServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("The test server did not expose a TCP address.");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function emptyImagesDirectory(): Promise<{
  imagesDirectory: string;
  rootDirectory: string;
}> {
  const directory = path.join(
    tmpdir(),
    process.env.SWARM_TASK ?? "RIFT-79-gatefix-radiance-availability-clock",
    `riftbound-card-api-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(directory, { recursive: true });
  const imagesDirectory = path.join(directory, "images");
  await mkdir(imagesDirectory, { recursive: true });
  return { imagesDirectory, rootDirectory: directory };
}
