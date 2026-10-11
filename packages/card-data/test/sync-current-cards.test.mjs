import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  fetchOfficialGalleries,
  extractOfficialPage,
  fetchOfficialGallery,
  mergeCards,
  normalizeOfficialCard,
  parseArguments,
  resolveCatalogOutputPath
} from "../scripts/sync-current-cards.mjs";

function officialCard(overrides = {}) {
  return {
    id: "unl-022-219",
    collectorNumber: 22,
    name: "Jhin",
    subtitle: "Murderous Artist",
    set: { value: { id: "UNL", label: "Unleashed" } },
    cardType: {
      type: [{ id: "unit", label: "Unit" }],
      superType: [{ id: "champion", label: "Champion" }]
    },
    publicCode: "UNL-022/219",
    rarity: { value: { label: "Rare" } },
    domain: { values: [{ id: "fury", label: "Fury" }] },
    cardImage: { url: "https://cmsassets.rgpub.io/sanity/images/jhin.png" },
    illustrator: { values: [{ label: "Artist" }] },
    text: {
      richText: {
        body: "<p>[Ganking] (I can move.)<br />When I move, [Add] 1.</p>"
      }
    },
    energy: { value: { id: 4 } },
    power: { value: { id: 1 } },
    might: { value: { id: 4 } },
    tags: { tags: ["Jhin", "Ionia"] },
    ...overrides
  };
}

function response(payload) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload)
  };
}

test("extracts and validates a Publishing API page", () => {
  const page = extractOfficialPage(
    {
      data: [officialCard()],
      metadata: {
        from: 0,
        limit: 200,
        resultsUpdatedAt: "2026-10-11T08:40:19.000Z"
      }
    },
    "https://example.test/cards"
  );

  assert.equal(page.cards.length, 1);
  assert.equal(page.metadata.resultsUpdatedAt, "2026-10-11T08:40:19.000Z");
  assert.throws(
    () => extractOfficialPage({ data: [{ name: "No id" }] }, "https://example.test/cards"),
    /no stable id/
  );
});

test("pages both locales until no new stable ids are returned", async () => {
  const requests = [];
  const cards = Array.from({ length: 401 }, (_, index) =>
    officialCard({ id: `unl-${String(index).padStart(3, "0")}-219` })
  );
  const fetchImpl = async (url) => {
    requests.push(url);
    const from = Number(url.searchParams.get("from"));
    return response({
      data: cards.slice(from, from + 200),
      metadata: {
        from,
        limit: 200,
        totalItems: 10,
        resultsUpdatedAt: "2026-10-11T08:40:19.000Z"
      }
    });
  };

  const english = await fetchOfficialGallery(
    "https://example.test/cards?locale=en_US",
    1000,
    fetchImpl
  );
  const chinese = await fetchOfficialGallery(
    "https://example.test/cards?locale=zh_CN",
    1000,
    fetchImpl
  );

  assert.deepEqual(
    requests.map((url) => `${url.searchParams.get("locale")}:${url.searchParams.get("from")}`),
    [
      "en_US:0",
      "en_US:200",
      "en_US:400",
      "en_US:600",
      "en_US:0",
      "zh_CN:0",
      "zh_CN:200",
      "zh_CN:400",
      "zh_CN:600",
      "zh_CN:0"
    ]
  );
  assert.equal(english.cards.length, 401);
  assert.equal(chinese.cards.length, 401);
  assert.equal(english.byteLength > 0, true);
  assert.match(english.sha256, /^sha256:/);
});

test("keeps exact duplicate records and rejects conflicting fields", async () => {
  const exactCard = officialCard();
  const conflictingCard = officialCard({ name: "Different name" });
  const fetchExact = async (url) => {
    const from = Number(url.searchParams.get("from"));
    return response({
      data: from === 0 ? [exactCard, exactCard] : []
    });
  };
  const exact = await fetchOfficialGallery(
    "https://example.test/cards?locale=en_US",
    1000,
    fetchExact
  );
  assert.equal(exact.cards.length, 1);

  const fetchConflict = async (url) => {
    const from = Number(url.searchParams.get("from"));
    return response({
      data: from === 0 ? [conflictingCard, exactCard] : []
    });
  };
  await assert.rejects(
    () =>
      fetchOfficialGallery(
        "https://example.test/cards?locale=en_US",
        1000,
        fetchConflict
      ),
    /conflicting records/
  );
});

test("single large snapshot repairs unstable paged sampling", async () => {
  const missing = officialCard({ id: "unl-089-219" });
  const duplicate = officialCard({ id: "sfd-230-star-221" });
  const cards = [
    officialCard({ id: "sfd-230-221" }),
    duplicate,
    duplicate,
    officialCard({ id: "sfd-230-221" }),
    missing
  ];
  const fetchImpl = async (url) => {
    const from = Number(url.searchParams.get("from"));
    const limit = Number(url.searchParams.get("limit"));
    if (limit === 2000) return response({ data: cards });

    // Simulates unstable sorting among records with the same name: the
    // duplicate pushes one card out and the last record is never sampled.
    return response({
      data: from === 0 ? [cards[0], duplicate, duplicate] : [cards[3]]
    });
  };

  const gallery = await fetchOfficialGallery(
    "https://example.test/cards?locale=en_US",
    1000,
    fetchImpl
  );

  assert.deepEqual(
    gallery.cards.map((card) => card.id),
    ["sfd-230-221", "sfd-230-star-221", "unl-089-219"]
  );
  assert.equal(gallery.reconciliation.pagedRecordCount, 2);
  assert.equal(gallery.reconciliation.snapshotRecordCount, 3);
  assert.equal(gallery.reconciliation.snapshotAddedRecordCount, 1);
  assert.equal(gallery.reconciliation.finalRecordCount, 3);
  assert.equal(gallery.pages.at(-1).purpose, "snapshot");
  assert.match(gallery.pages.at(-1).sourceUrl, /limit=2000/);
});

test("retries transient network failures and server errors", async () => {
  let failures = 0;
  const gallery = await fetchOfficialGallery(
    "https://example.test/cards?locale=en_US",
    1000,
    async (url) => {
      if (failures++ === 0) {
        throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
      }
      if (failures === 2) return { ok: false, status: 503 };
      return response({
        data: url.searchParams.get("from") === "0" ? [officialCard()] : []
      });
    }
  );
  assert.equal(gallery.cards.length, 1);
});

test("does not retry permanent HTTP errors and reports the request URL", async () => {
  let requests = 0;
  await assert.rejects(
    fetchOfficialGallery("https://example.test/cards?locale=en_US", 1000, async () => {
      requests += 1;
      return { ok: false, status: 404 };
    }),
    /https:\/\/example\.test\/cards.*404/
  );
  assert.equal(requests, 1);
});

test("retries isolated locale downloads once on cross-locale mismatch", async () => {
  const requests = [];
  const logs = [];
  const completeEnglish = [
    officialCard(),
    officialCard({ id: "unl-089-219" })
  ];
  const incompleteEnglish = [officialCard()];
  const chinese = [
    officialCard({ name: "金" }),
    officialCard({ id: "unl-089-219", name: "金 89" })
  ];
  let englishIncomplete = true;

  const fetchImpl = async (url) => {
    requests.push(url);
    const locale = url.searchParams.get("locale");
    const limit = Number(url.searchParams.get("limit"));
    const data = locale === "en_US"
      ? (englishIncomplete ? incompleteEnglish : completeEnglish)
      : chinese;
    if (limit === 2000) englishIncomplete = false;
    return response({ data });
  };

  const result = await fetchOfficialGalleries(
    {
      galleryUrl: "https://example.test/cards?locale=en_US",
      localizedGalleryUrl: "https://example.test/cards?locale=zh_CN"
    },
    1000,
    { log: (message) => logs.push(message), fetchImpl }
  );

  assert.equal(result.official.localeMismatchRetried, true);
  assert.equal(result.localized.localeMismatchRetried, true);
  assert.deepEqual(
    requests.map((url) =>
      `${url.searchParams.get("locale")}:${url.searchParams.get("from")}:${url.searchParams.get("limit")}`
    ),
    [
      "en_US:0:200",
      "en_US:200:200",
      "en_US:0:2000",
      "zh_CN:0:200",
      "zh_CN:200:200",
      "zh_CN:0:2000",
      "en_US:0:200",
      "en_US:200:200",
      "en_US:0:2000",
      "zh_CN:0:200",
      "zh_CN:200:200",
      "zh_CN:0:2000"
    ]
  );
  assert.equal(result.official.cards.length, 2);
  assert.equal(result.localized.cards.length, 2);
  assert.equal(result.official.cards[0].name, "Jhin");
  assert.equal(result.localized.cards[0].name, "金");
  assert.ok(logs.some((message) => message.includes("retrying each locale once")));
});

test("fails after one mismatch retry and keeps locales isolated", async () => {
  const english = [officialCard()];
  const chinese = [
    officialCard({ name: "金" }),
    officialCard({ id: "unl-089-219", name: "金 89" })
  ];
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    return response({
      data: url.searchParams.get("locale") === "en_US" ? english : chinese
    });
  };

  await assert.rejects(
    () =>
      fetchOfficialGalleries(
        {
          galleryUrl: "https://example.test/cards?locale=en_US",
          localizedGalleryUrl: "https://example.test/cards?locale=zh_CN"
        },
        1000,
        { fetchImpl }
      ),
    (error) => {
      assert.match(error.message, /ID mismatch/);
      assert.match(error.message, /locale=en_US/);
      assert.match(error.message, /locale=zh_CN/);
      assert.match(error.message, /unl-089-219/);
      return true;
    }
  );
  assert.equal(requests.length, 12);
  assert.equal(
    new Set(requests.map((url) => url.searchParams.get("locale"))).size,
    2
  );
});

test("normalizes an official card without losing its printed fields", () => {
  const normalized = normalizeOfficialCard(officialCard(), "2026-10-11T00:00:00.000Z");

  assert.deepEqual(normalized, {
    cardCode: "unl-022-219",
    name: "Jhin",
    subtitle: "Murderous Artist",
    fullName: "Jhin, Murderous Artist",
    setCode: "unl",
    cardSet: "Unleashed",
    cardNumber: "022-219",
    rarity: "Rare",
    domain: "Fury",
    domains: ["Fury"],
    cardType: "Unit",
    cardTypeLabels: ["Unit", "Champion"],
    tags: ["Jhin", "Ionia"],
    energy: 4,
    power: 1,
    might: 4,
    abilityOriginal: "[Ganking] (I can move.)\nWhen I move, [Add] 1.",
    artist: "Artist",
    imageUrl: "https://cmsassets.rgpub.io/sanity/images/jhin.png",
    sourceUrl:
      "https://playriftbound.com/en-us/card-gallery/#card-gallery--unl-022-219",
    scrapedAt: "2026-10-11T00:00:00.000Z",
    abilityCorrected: null,
    abilityEffective: "[Ganking] (I can move.)\nWhen I move, [Add] 1.",
    hasErrata: false,
    matchedErrataCode: null
  });
});

test("uses community corrections and fills official-only records", () => {
  const official = [officialCard(), officialCard({
    id: "unl-023-219",
    name: "Official Only",
    subtitle: null,
    publicCode: "UNL-023/219"
  })];
  const community = [{
    ...normalizeOfficialCard(official[0], "2026-10-11T00:00:00.000Z"),
    abilityEffective: "Community corrected text",
    hasErrata: true
  }];

  const merged = mergeCards(official, community, "2026-10-11T00:00:00.000Z");

  assert.deepEqual(merged.missingFromCommunity, ["unl-023-219"]);
  assert.deepEqual(merged.communityOnly, []);
  assert.equal(merged.cards.length, 2);
  assert.equal(merged.cards[0].abilityEffective, "Community corrected text");
  assert.equal(merged.cards[1].fullName, "Official Only");
});

test("rejects invalid or duplicate community card codes", () => {
  const community = normalizeOfficialCard(
    officialCard(),
    "2026-10-11T00:00:00.000Z"
  );

  assert.throws(
    () => mergeCards([], [community, community]),
    /duplicate cardCode unl-022-219/
  );
  assert.throws(
    () => mergeCards([], [{ ...community, cardCode: "" }]),
    /missing a non-empty cardCode/
  );
  assert.throws(
    () => mergeCards([], [null]),
    /missing a non-empty cardCode/
  );
});

test("rejects duplicate official IDs and exact CLI options", () => {
  assert.equal(parseArguments(["--", "--dry-run"]).dryRun, true);
  assert.throws(
    () =>
      extractOfficialPage(
        { data: [{ name: "No id" }] },
        "https://example.test/gallery"
      ),
    /no stable id/
  );
  assert.throws(
    () => parseArguments(["--gallery-url-junk"]),
    /Unknown option/
  );
  assert.equal(
    resolveCatalogOutputPath(undefined),
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../data/catalog.json"
    )
  );
});
