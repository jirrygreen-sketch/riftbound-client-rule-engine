import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createDuelMatch,
  DUEL_SETUP_DOMAINS,
  resolveDuelMulligan,
  type DuelSetupSeat
} from "../../../../packages/engine-core/src/duel/index.js";
import {
  loadCardCatalogRuntime,
  type CardCatalogRuntime
} from "../../src/card-catalog.js";
import {
  buildDuelSetupSeats,
  type DuelSetupSeatsRequest,
  type DuelUidFactory
} from "../../src/duel/setup-seats.js";
import {
  setupAdapterFixtureCatalog,
  setupAdapterFixtureDecks
} from "./fixtures/setup-adapter-catalog.js";

/**
 * These are the FORMAL, fresh-checkout-safe adapter cases. They run against the
 * tracked, self-contained `fixtures/setup-adapter-catalog.ts` runtime catalog and
 * its two representative decks; they never read `outputs/coordination/**` or the
 * gitignored `packages/card-data/data/*` JSON, so a clean checkout/CI passes.
 *
 * The real generated catalog and the real `gui-valid-room-deck-fixtures` A/B
 * decks are exercised only by the opt-in actual-catalog acceptance entry point
 * kept in this task's own artifact directory (it explicitly requires the
 * generated repo data plus those original fixtures to exist).
 */

// A fixture-only images directory: the runtime only probes its sibling
// `images-manifest.json`, which does not exist here, so it loads an empty image
// manifest instead of touching the real gitignored image data.
const FIXTURE_IMAGES_DIRECTORY = fileURLToPath(new URL("./fixtures/", import.meta.url));

let runtimePromise: Promise<CardCatalogRuntime> | null = null;
function runtime(): Promise<CardCatalogRuntime> {
  runtimePromise ??= loadCardCatalogRuntime({
    catalog: setupAdapterFixtureCatalog,
    imagesDirectory: FIXTURE_IMAGES_DIRECTORY
  });
  return runtimePromise;
}

function countingFactory(
  produce?: () => string
): { readonly factory: DuelUidFactory; readonly calls: () => number } {
  let calls = 0;
  return {
    factory: () => {
      calls += 1;
      return produce === undefined ? `uid-${calls}` : produce();
    },
    calls: () => calls
  };
}

function seededRandomIndex(seed: number): (bound: number) => number {
  let state = seed >>> 0;
  return (bound: number) => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state % bound;
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function physicalIds(seat: DuelSetupSeat): readonly string[] {
  return [
    seat.champion.uid,
    seat.legend.uid,
    ...seat.mainDeck.map(card => card.uid),
    ...seat.runeDeck.map(rune => rune.uid),
    ...seat.battlefields.map(field => field.instanceId)
  ];
}

function validRequest(): DuelSetupSeatsRequest {
  return {
    matchId: "match-fixture-1",
    seats: [
      {
        playerId: "player-1",
        displayName: "Fixture A",
        deck: setupAdapterFixtureDecks.a.submission
      },
      {
        playerId: "player-2",
        displayName: "Fixture B",
        deck: setupAdapterFixtureDecks.b.submission
      }
    ]
  };
}

describe("buildDuelSetupSeats", () => {
  it("keeps the local domain tuple aligned with engine-core", () => {
    // The adapter declares `KNOWN_DUEL_DOMAINS` as
    // `as const satisfies readonly DuelSetupDomain[]`. That `satisfies` clause
    // only type-checks the tuple's MEMBERS against the engine union: an illegal
    // member is a compile error, but engine-core ADDING a new duel domain does
    // NOT error, because a narrower tuple stays assignable to a widened union.
    // Domain-SET drift is therefore detected here at runtime: the engine's
    // exported union must still equal this documented six-domain contract, which
    // is the list the adapter is expected to mirror.
    expect([...DUEL_SETUP_DOMAINS]).toEqual([
      "Fury",
      "Calm",
      "Mind",
      "Body",
      "Chaos",
      "Order"
    ]);
  });

  it("maps two validated fixture decks into 56 physical IDs each (112 total)", async () => {
    const rt = await runtime();
    const request = validRequest();
    const counter = countingFactory();

    const result = buildDuelSetupSeats(rt, request, counter.factory);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [seatA, seatB] = result.seats;
    // 39 main + 1 champion + 1 legend + 12 runes + 3 battlefields = 56.
    expect(seatA.mainDeck).toHaveLength(39);
    expect(seatB.mainDeck).toHaveLength(39);
    expect(seatA.runeDeck).toHaveLength(12);
    expect(seatB.runeDeck).toHaveLength(12);
    expect(seatA.battlefields).toHaveLength(3);
    expect(seatB.battlefields).toHaveLength(3);
    expect(counter.calls()).toBe(112);

    const ids = [...physicalIds(seatA), ...physicalIds(seatB)];
    expect(ids).toHaveLength(112);
    expect(new Set(ids).size).toBe(112);
    expect(ids.every(id => typeof id === "string" && id.length > 0)).toBe(true);

    // Same printing x3 maps to three distinct physical UIDs.
    const ogn001 = seatA.mainDeck.filter(card => card.cardId === "ogn-001-298");
    expect(ogn001).toHaveLength(3);
    expect(new Set(ogn001.map(card => card.uid)).size).toBe(3);

    // Both seats submit the same Rune printing; the 24 copies stay 24 unique UIDs.
    const runeIds = [...seatA.runeDeck, ...seatB.runeDeck].map(rune => rune.uid);
    expect(runeIds).toHaveLength(24);
    expect(new Set(runeIds).size).toBe(24);

    // Champion stays out of the Main Deck (no extra copy into main).
    expect(seatA.mainDeck.some(card => card.cardId === "unl-176-219")).toBe(false);
    expect(seatA.champion.cardId).toBe("unl-176-219");
    expect(seatA.legend.cardId).toBe("unl-187-219");
  });

  it("reads the rune domain from the fixture catalog, not a hardcoded value", async () => {
    const rt = await runtime();
    const request = validRequest();
    const result = buildDuelSetupSeats(rt, request, countingFactory().factory);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const runeCard = rt.publicCatalog.cards.find(card => card.id === "ogn-214-298");
    expect(runeCard?.cardType.toLowerCase()).toBe("rune");
    const expectedDomain = runeCard?.domains[0];
    expect(expectedDomain).toBe("Order");
    for (const rune of result.seats[0].runeDeck) {
      expect(rune.cardId).toBe("ogn-214-298");
      expect(rune.domain).toBe(expectedDomain);
    }
  });

  it("stamps metadata from the runtime catalog source and seat-order roster", async () => {
    const rt = await runtime();
    const request = validRequest();
    const result = buildDuelSetupSeats(rt, request, countingFactory().factory);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.metadata.matchId).toBe("match-fixture-1");
    expect(result.metadata.dataVersion).toBe(
      setupAdapterFixtureCatalog.dataVersion
    );
    expect(result.metadata.catalogDigest).toBe(setupAdapterFixtureCatalog.digest);
    expect(result.metadata.roster).toEqual([
      { playerId: "player-1", displayName: "Fixture A" },
      { playerId: "player-2", displayName: "Fixture B" }
    ]);
  });

  it("produces seats accepted by the formal constructor through both mulligans", async () => {
    const rt = await runtime();
    const request = validRequest();
    const result = buildDuelSetupSeats(rt, request, countingFactory().factory);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const match = createDuelMatch(result.seats, result.metadata, seededRandomIndex(7));
    expect(match.stage).toBe("setup");
    if (match.stage !== "setup") return;

    const [first, second] = match.turnOrder;
    let state = resolveDuelMulligan(match, first, []);
    state = resolveDuelMulligan(state, second, []);
    expect(state.stage).toBe("playing");
  });

  it("does not mutate its (deep-frozen) input", async () => {
    const rt = await runtime();
    const request = deepFreeze(validRequest());
    const result = buildDuelSetupSeats(rt, request, countingFactory().factory);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The input sideboard is preserved untouched and never enters a live seat.
    expect("sideboard" in result.seats[0]).toBe(false);
  });

  it("rejects an invalid deck before allocating any UID", async () => {
    const rt = await runtime();
    const request = validRequest();
    const broken: DuelSetupSeatsRequest = {
      ...request,
      seats: [
        {
          ...request.seats[0],
          deck: {
            ...request.seats[0].deck,
            mainDeck: [
              ...(request.seats[0].deck.mainDeck ?? []),
              { cardId: "no-such-printing-999", quantity: 1 }
            ]
          }
        },
        request.seats[1]
      ]
    };
    const counter = countingFactory();

    const result = buildDuelSetupSeats(rt, broken, counter.factory);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_deck");
    expect(result.seatIndex).toBe(0);
    expect(result.issues?.some(issue => issue.code === "unknown_card")).toBe(true);
    // Deck validation is an early, pre-UID failure.
    expect(counter.calls()).toBe(0);
  });

  it("rejects a missing matchId before allocating any UID", async () => {
    const rt = await runtime();
    const counter = countingFactory();

    const result = buildDuelSetupSeats(
      rt,
      { matchId: "   ", seats: validRequest().seats },
      counter.factory
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_request");
    // The server-owned metadata check is early, so it never allocates a UID.
    expect(counter.calls()).toBe(0);
  });

  it("rejects duplicate roster IDs before allocating any UID", async () => {
    const rt = await runtime();
    const request = validRequest();
    const counter = countingFactory();

    const result = buildDuelSetupSeats(
      rt,
      {
        ...request,
        seats: [
          request.seats[0],
          { ...request.seats[1], playerId: request.seats[0].playerId }
        ]
      },
      counter.factory
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_request");
    // Roster identity is checked before the UID allocator runs.
    expect(counter.calls()).toBe(0);
  });

  it("rejects a corrupt rune domain from a copied catalog without touching the shared fixture", async () => {
    const corrupted = structuredClone(setupAdapterFixtureCatalog);
    const rune = corrupted.cards.find(card => card.id === "ogn-214-298");
    expect(rune).toBeDefined();
    // Two known domains keep Deck structural/domain validation passing, so the
    // failure isolates the rune-domain adapter check.
    rune!.domains = ["Order", "Fury"];
    const corruptRuntime = await loadCardCatalogRuntime({
      catalog: corrupted,
      imagesDirectory: FIXTURE_IMAGES_DIRECTORY
    });

    // The shared fixture catalog is untouched.
    expect(
      setupAdapterFixtureCatalog.cards.find(card => card.id === "ogn-214-298")?.domains
    ).toEqual(["Order"]);

    const request = validRequest();
    const counter = countingFactory();
    const result = buildDuelSetupSeats(corruptRuntime, request, counter.factory);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_rune");
    expect(result.seatIndex).toBe(0);
    // The rune-domain read is an early, pre-UID failure.
    expect(counter.calls()).toBe(0);
  });

  it("rejects an empty or duplicate UID factory output after real allocation attempts", async () => {
    const rt = await runtime();
    const request = deepFreeze(validRequest());
    const before = JSON.stringify(request);

    // The allocator only discovers a malformed id by CALLING the factory, so these
    // cases necessarily report calls > 0; the failure still never mutates input.
    const duplicate = countingFactory(() => "collision");
    const dupResult = buildDuelSetupSeats(rt, request, duplicate.factory);
    expect(dupResult.ok).toBe(false);
    if (!dupResult.ok) expect(dupResult.code).toBe("invalid_setup_identity");
    expect(duplicate.calls()).toBeGreaterThan(0);

    const empty = countingFactory(() => "");
    const emptyResult = buildDuelSetupSeats(rt, request, empty.factory);
    expect(emptyResult.ok).toBe(false);
    if (!emptyResult.ok) expect(emptyResult.code).toBe("invalid_setup_identity");
    expect(empty.calls()).toBeGreaterThan(0);

    // Input is deep-frozen and byte-identical after both failing attempts.
    expect(JSON.stringify(request)).toBe(before);
  });

  it("rejects a UID colliding with a seat's derived base location", async () => {
    const rt = await runtime();
    const request = deepFreeze(validRequest());
    const before = JSON.stringify(request);
    let calls = 0;
    // The formal constructor derives `duel-base`/`duel-battlefield` locations;
    // a game object id must never equal one of them. The collision is only
    // detectable after the factory has been called.
    const factory: DuelUidFactory = () => {
      calls += 1;
      return calls === 1
        ? JSON.stringify(["duel-base", "player-1"])
        : `uid-${calls}`;
    };

    const result = buildDuelSetupSeats(rt, request, factory);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_setup_identity");
    expect(calls).toBeGreaterThan(0);
    expect(JSON.stringify(request)).toBe(before);
  });
});
