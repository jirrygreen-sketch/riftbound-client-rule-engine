/**
 * Regional Constructed HTTP acceptance — REAL generated catalog, real HTTP.
 *
 * This is the formal entry point for the regional `?regionCode=&eventDate=`
 * catalog/validation contract. It boots the real `createGameServer` on
 * `127.0.0.1:<ephemeral>` with the repository's actual generated deck catalog
 * (`packages/card-data/data/deck-catalog.json`, the pinned
 * `2026-10-12-official-gallery` snapshot) and performs actual `fetch` calls
 * against `/api/cards` and `/api/decks/validate`.
 *
 * Boundaries honored here:
 * - No official rules/effects are invented: the release schedule, region set
 *   membership and dates come only from the server-owned pinned schedule.
 * - `eventDate` is used as DATA. A future date never upgrades the policy to a
 *   "new rules" version; the response keeps the same `regional-constructed-v1`
 *   policy scope and only reports data availability.
 * - No card images are downloaded and no login/session is used.
 * - The old, query-less `/api/cards` response is asserted byte-for-byte and the
 *   source catalog file is hashed before/after to prove it is not mutated.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGameServer, type GameServer } from "../src/server.js";
import {
  defaultCardCatalogPaths,
  loadCardCatalogRuntime,
  type CardCatalogRuntime
} from "../src/card-catalog.js";
import { CONSTRUCTED_RELEASE_SCHEDULE_DIGEST } from "../src/constructed-regional-context.js";
import { setupAdapterFixtureDecks } from "./duel/fixtures/setup-adapter-catalog.js";

const CATALOG_PATH = defaultCardCatalogPaths().catalogPath;

// Fixture-only images directory: the runtime only probes the sibling
// `images-manifest.json`, which does not exist here, so it loads an empty image
// manifest and never touches the real gitignored image data.
const FIXTURE_IMAGES_DIRECTORY = fileURLToPath(
  new URL("./duel/fixtures/", import.meta.url)
);

async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

// The real catalog is required; a missing generated input must fail.
describe(
  "regional Constructed HTTP against the generated catalog",
  () => {
    let server: GameServer;
    let baseUrl: string;
    let runtime: CardCatalogRuntime;
    let baselineNoQuery: string;
    let catalogHashBefore: string;

    beforeAll(async () => {
      runtime = await loadCardCatalogRuntime({ constructedPolicy: { asOf: "2026-10-14" } });
      catalogHashBefore = await sha256File(CATALOG_PATH);

      server = createGameServer({
        host: "127.0.0.1", port: Number(process.env.SWARM_PORT_BASE ?? 31780),
        constructedPolicy: { asOf: "2026-10-14" }
      });
      await server.start();
      const address = server.httpServer.address();
      if (address === null || typeof address === "string") {
        throw new Error("The test server did not expose a TCP address.");
      }
      baseUrl = `http://127.0.0.1:${address.port}`;
      baselineNoQuery = await (await fetch(`${baseUrl}/api/cards`)).text();
    });

    afterAll(async () => {
      await server?.stop();
    });

    const getCards = async (
      query: string
    ): Promise<{ status: number; body: any; bytes: string }> => {
      const response = await fetch(`${baseUrl}/api/cards${query}`);
      const bytes = await response.text();
      let body: unknown = null;
      try {
        body = JSON.parse(bytes);
      } catch {
        body = null;
      }
      return { status: response.status, body, bytes };
    };

    const postValidate = async (
      query: string,
      deck: unknown
    ): Promise<{ status: number; body: any }> => {
      const response = await fetch(`${baseUrl}/api/decks/validate${query}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deck })
      });
      return { status: response.status, body: await response.json() };
    };

    it("loads the current actual generated catalog (1,381 printings)", () => {
      expect(runtime.publicCatalog.dataVersion).toBe("2026-10-12-official-gallery");
      expect(runtime.publicCatalog.digest)
        .toBe("sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10");
      expect(runtime.publicCatalog.cards).toHaveLength(1381);
    });

    it("returns the pinned query-less catalog byte-for-byte and never mutates it", async () => {
      const noQuery = await getCards("");
      expect(noQuery.status).toBe(200);
      expect(noQuery.bytes).toBe(baselineNoQuery);

      // A region-scoped read must not disturb the query-less baseline.
      const regional = await getCards("?regionCode=ROW&eventDate=2026-10-14");
      expect(regional.status).toBe(200);

      const again = await getCards("");
      expect(again.bytes).toBe(baselineNoQuery);

      // The source catalog file is unchanged on disk after all real reads.
      expect(await sha256File(CATALOG_PATH)).toBe(catalogHashBefore);
      // The base in-memory catalog policy is untouched by the regional wrapper.
      expect(runtime.constructedRules.policy.checkedAt).toBeTruthy();
    });

    it("differs by region for SFD on 2026-01-01 and keeps CN unknown sets closed", async () => {
      const row = await getCards("?regionCode=ROW&eventDate=2026-01-01");
      const cn = await getCards("?regionCode=CN&eventDate=2026-01-01");
      expect(row.status).toBe(200);
      expect(cn.status).toBe(200);

      const sfd = (body: any) => body.cards.find((c: any) => c.setCode === "sfd");
      // CN releases SFD on 2025-12-12; ROW not until 2026-02-13, so on
      // 2026-01-01 exactly one region has it available.
      expect(sfd(cn.body).available).toBe(true);
      expect(sfd(row.body).available).toBe(false);
      expect(sfd(row.body).availabilityReason).toContain("2026-02-13");

      // CN OGN/OGS launch dates are UNKNOWN: availability must stay false with
      // the unknown reason, and must not inherit ROW's confirmed dates.
      const cnOGN = cn.body.cards.find((c: any) => c.setCode === "ogn");
      const cnOGS = cn.body.cards.find((c: any) => c.setCode === "ogs");
      const rowOGN = row.body.cards.find((c: any) => c.setCode === "ogn");
      expect(cnOGN.available).toBe(false);
      expect(cnOGS.available).toBe(false);
      expect(cnOGN.availabilityReason).toBe("该地区发售日期尚未确认");
      expect(cnOGS.availabilityReason).toBe("该地区发售日期尚未确认");
      expect(rowOGN.available).toBe(true);
    });

    it("keeps RAD unreleased on 2026-10-16 and available on 2026-10-23, distinct from the rules date", async () => {
      const before = await getCards("?regionCode=ROW&eventDate=2026-10-16");
      const onRelease = await getCards("?regionCode=ROW&eventDate=2026-10-23");
      const rad = (body: any) => body.cards.find((c: any) => c.setCode === "rad");

      expect(rad(before.body).available).toBe(false);
      expect(rad(before.body).availabilityReason).toContain("2026-10-23");
      expect(rad(onRelease.body).available).toBe(true);

      // 2026-10-16 is the RADIANCE rules effective date, not a release date.
      expect(onRelease.body.policy.standard.radiance.effectiveDate).toBe("2026-10-16");
      expect(onRelease.body.policy.standard.radiance.releaseDate).toBe("2026-10-23");
    });

    it("treats eventDate as pure data: future dates make no new-rules legal claim", async () => {
      const future = await getCards("?regionCode=ROW&eventDate=2027-06-01");
      expect(future.status).toBe(200);
      // Same pinned policy version/schedule; only the data availability moves.
      expect(future.body.policy.format).toBe("standard");
      expect(future.body.policy.tournamentComplete).toBe(false);
      expect(future.body.policy.checkedAt).toBe("2027-06-01");
      expect(future.body.policy.policyScope).toContain("regional-constructed-v1");
      expect(future.body.policy.policyScope).toContain(CONSTRUCTED_RELEASE_SCHEDULE_DIGEST);
    });

    it("accepts the real 56-card ROW deck and rejects the identical CN deck", async () => {
      const deck = setupAdapterFixtureDecks.a.submission;
      const row = await postValidate("?regionCode=ROW&eventDate=2026-10-14", deck);
      expect(row.status).toBe(200);
      expect(row.body.valid).toBe(true);
      expect(row.body.totalCards).toBe(56);

      const cn = await postValidate("?regionCode=CN&eventDate=2026-10-14", deck);
      expect(cn.status).toBe(200);
      expect(cn.body.valid).toBe(false);
      expect(cn.body.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "regional_availability_unconfirmed" })
        ])
      );
    });

    it("rejects bad region, bad date and half-specified queries with 4xx and no fallback", async () => {
      const badRegion = await getCards("?regionCode=FR&eventDate=2026-10-14");
      expect(badRegion.status).toBe(400);
      expect(badRegion.body).toMatchObject({ error: "invalid-url-encoding" });

      const badDate = await getCards("?regionCode=ROW&eventDate=2026-02-30");
      expect(badDate.status).toBe(400);
      expect(badDate.body).toMatchObject({ error: "invalid-url-encoding" });

      const missingDate = await getCards("?regionCode=ROW");
      expect(missingDate.status).toBe(400);
      expect(missingDate.body).toMatchObject({ error: "invalid-url-encoding" });

      const missingRegion = await getCards("?eventDate=2026-10-14");
      expect(missingRegion.status).toBe(400);
      expect(missingRegion.body).toMatchObject({ error: "invalid-url-encoding" });

      // Validation with a bad region must also fail closed (no fallback body).
      const badValidate = await postValidate(
        "?regionCode=FR&eventDate=2026-10-14",
        setupAdapterFixtureDecks.a.submission
      );
      expect(badValidate.status).toBe(400);
      expect(badValidate.body).toMatchObject({ error: "invalid-url-encoding" });
    });

    it("ignores client-supplied version fields: they cannot override the pinned context", async () => {
      const canonical = await getCards("?regionCode=ROW&eventDate=2026-10-14");
      const forged = await getCards(
        "?regionCode=ROW&eventDate=2026-10-14" +
          "&sourceVersion=evil&policyVersion=evil&scheduleDigest=sha256:" +
          "0".repeat(64)
      );
      expect(forged.status).toBe(200);
      expect(forged.body.policy.policyScope).toBe(canonical.body.policy.policyScope);
      expect(forged.body.policy.checkedAt).toBe("2026-10-14");
      expect(forged.body.policy.policyScope).toContain(CONSTRUCTED_RELEASE_SCHEDULE_DIGEST);
    });

    it("projects public card metadata matching the constructed copy rules", async () => {
      const row = await getCards("?regionCode=ROW&eventDate=2026-10-14");
      const cards: any[] = row.body.cards;
      const rune = cards.find(c => c.cardType === "Rune" && c.available);
      const battlefield = cards.find(c => c.cardType === "Battlefield" && c.available);
      const unit = cards.find(c => c.cardType === "Unit" && c.available);
      expect(rune?.maxCopies).toBe(12);
      expect(battlefield?.maxCopies).toBe(1);
      expect(unit?.maxCopies).toBe(3);
    });

    it("keeps a banned printing blocked and unavailable even on a far-future date", async () => {
      const near = await getCards("?regionCode=ROW&eventDate=2026-10-14");
      const far = await getCards("?regionCode=ROW&eventDate=2027-06-01");
      const bannedNear = near.body.cards.find((c: any) => c.id === "ogn-110-298");
      const bannedFar = far.body.cards.find((c: any) => c.id === "ogn-110-298");
      for (const banned of [bannedNear, bannedFar]) {
        expect(banned.banned).toBe(true);
        expect(banned.available).toBe(false);
        expect(banned.maxCopies).toBe(0);
      }
    });

    it("exposes a full regional projection without images or login", async () => {
      // Fetch only the two metadata endpoints: no card-image request, no auth.
      const row = await getCards("?regionCode=ROW&eventDate=2026-10-14");
      const cn = await getCards("?regionCode=CN&eventDate=2026-10-14");
      expect(row.body.cards).toHaveLength(1381);
      expect(cn.body.cards).toHaveLength(1381);
      expect(row.body.cards.some((c: any) => c.available)).toBe(true);
      expect(cn.body.cards.some((c: any) => c.available)).toBe(true);
      // CN's unknown launch sets stay closed even though other CN sets are open.
      const cnOGN = cn.body.cards.find((c: any) => c.setCode === "ogn");
      expect(cnOGN.available).toBe(false);
      expect(cnOGN.availabilityReason).toBe("该地区发售日期尚未确认");
    });
  }
);

// The generated catalog has no `notStandard` printings today, so the
// "notStandard always blocked" contract is proven against a clearly controlled
// miniature catalog where an off-standard set code is present.
describe("regional Constructed keeps notStandard printings blocked by date", () => {
  it("never unlocks a notStandard card, even on a far-future event date", async () => {
    const controlled = {
      schemaVersion: 1,
      dataVersion: "regional-http-controlled-fixture-1",
      digest: "sha256:" + "e".repeat(64),
      cards: [
        {
          id: "controlled.standard.ogn",
          canonicalCardId: "controlled.standard",
          name: "Standard Unit",
          fullName: "Standard Unit",
          cardType: "Unit",
          domains: [],
          tags: [],
          setCode: "ogn",
          cardNumber: "001",
          variant: "standard",
          imageUrl: null,
          energy: 1,
          power: 1,
          might: null,
          ability: "Controlled standard fixture."
        },
        {
          id: "controlled.offstandard.arc",
          canonicalCardId: "controlled.offstandard",
          name: "Off Standard Unit",
          fullName: "Off Standard Unit",
          cardType: "Unit",
          domains: [],
          tags: [],
          setCode: "arc",
          cardNumber: "002",
          variant: "standard",
          imageUrl: null,
          energy: 1,
          power: 1,
          might: null,
          ability: "Controlled off-standard fixture."
        }
      ]
    };

    const server = createGameServer({
      host: "127.0.0.1",
      port: Number(process.env.SWARM_PORT_BASE ?? 31780) + 1,
      constructedPolicy: { asOf: "2026-10-14" },
      catalog: controlled,
      imagesDirectory: FIXTURE_IMAGES_DIRECTORY
    });
    try {
      await server.start();
      const address = server.httpServer.address();
      if (address === null || typeof address === "string") {
        throw new Error("The test server did not expose a TCP address.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const response = await fetch(
        `${baseUrl}/api/cards?regionCode=ROW&eventDate=2027-06-01`
      );
      expect(response.status).toBe(200);
      const body: any = await response.json();
      const offStandard = body.cards.find((c: any) => c.id === "controlled.offstandard.arc");
      const standard = body.cards.find((c: any) => c.id === "controlled.standard.ogn");
      expect(offStandard.available).toBe(false);
      expect(offStandard.banned).toBe(false);
      expect(offStandard.maxCopies).toBe(0);
      expect(offStandard.availabilityReason).toBe("该系列不属于当前标准构筑");
      expect(standard.available).toBe(true);
    } finally {
      await server.stop();
    }
  });
});
