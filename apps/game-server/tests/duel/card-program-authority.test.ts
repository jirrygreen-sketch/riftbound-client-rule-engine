/**
 * Focused tests for the server-local catalog -> card-dsl program authority.
 *
 * These cases are fully self-contained: they build their own tiny public
 * catalogs and never read the gitignored `packages/card-data/data` catalog. The
 * Basic Rune fixture carries the genuine printing tuple and the genuine
 * `dataVersion`/`digest` marker that the hardened card-dsl registry requires
 * before it will resolve a Rune, so a fresh checkout reproduces the same result.
 *
 * Run with an artifact-local config, e.g. under
 * `outputs/coordination/full-product-20261012/task-artifacts/server-catalog-program-authority/`
 * or `outputs/coordination/full-product-20261012/task-artifacts/card-program-authority-input-hardening/`.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DUEL_OFFICIAL_RULESET,
  decodeDuelProgramReferenceRaw,
  makeDuelOfficialProgramId,
} from "@riftbound/card-dsl/duel";
import {
  loadCardCatalogRuntime,
  type CardCatalogRuntime,
  type PublicCardCatalog,
} from "../../src/card-catalog.js";
import {
  CardProgramAuthorityError,
  createCardProgramAuthority,
  toDuelCatalogEnvelope,
  type CardProgramAuthority,
  type ResolvedProgramReferenceEntry,
} from "../../src/duel/card-program-authority.js";

const imagesDirectory = fileURLToPath(new URL("./fixtures/", import.meta.url));

// The genuine catalog stamp. The hardened registry only resolves the thirty
// physical Basic Rune printings when the source carries exactly this marker.
const REAL_DATA_VERSION = "2026-10-12-official-gallery";
const REAL_DIGEST =
  "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10";

/** Verbatim complete Basic Rune tuple for `ogn-007-298` (domain Fury). */
function genuineBasicRune(): Record<string, unknown> {
  return {
    id: "ogn-007-298",
    canonicalCardId:
      "card.hash-30497c69657abd1d3abf17f9b3766e7d064817473a88828ca2ef4ab9b51f7902",
    name: "Fury Rune",
    fullName: "Fury Rune",
    localizedName: "炽烈符文",
    cardType: "Rune",
    domains: ["Fury"],
    tags: ["Basic"],
    setCode: "ogn",
    cardNumber: "OGN-007/298",
    variant: "standard",
    imageUrl: null,
    energy: null,
    power: null,
    might: null,
    ability: "",
  };
}

/** A printing with no template in the hardened IR: it must stay unknown. */
function unmodeledUnit(): Record<string, unknown> {
  return {
    id: "ogn-999-298",
    canonicalCardId: "card.hash-unmodeled-unit-fixture",
    name: "Unmodeled Unit",
    fullName: "Unmodeled Unit",
    localizedName: "未建模单位",
    cardType: "Unit",
    domains: ["Fury"],
    tags: [],
    setCode: "ogn",
    cardNumber: "OGN-999/298",
    variant: "standard",
    imageUrl: null,
    energy: 2,
    power: 1,
    might: 3,
    ability: "When you play me, do something the official IR does not model.",
  };
}

function publicCatalog(
  cards: readonly Record<string, unknown>[],
  stamp: { dataVersion: string; digest: string } = {
    dataVersion: REAL_DATA_VERSION,
    digest: REAL_DIGEST,
  }
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    dataVersion: stamp.dataVersion,
    digest: stamp.digest,
    policy: {},
    cards,
  };
}

async function runtimeFrom(
  catalog: Record<string, unknown>
): Promise<CardCatalogRuntime> {
  return loadCardCatalogRuntime({ catalog, imagesDirectory });
}

function fakeRuntime(catalog: Record<string, unknown>): CardCatalogRuntime {
  return { publicCatalog: catalog } as unknown as CardCatalogRuntime;
}

function entryFor(
  authority: CardProgramAuthority,
  cardId: string
): ResolvedProgramReferenceEntry {
  const entry = authority.resolvedProgramReference(cardId);
  expect(entry, `resolved entry for ${cardId}`).toBeDefined();
  return entry as ResolvedProgramReferenceEntry;
}

/** The public catalog shape with an arbitrary (possibly malformed) `cards` value. */
function catalogWithCards(cards: unknown): Record<string, unknown> {
  return { ...publicCatalog([genuineBasicRune()]), cards };
}

/** An array subclass: still `Array.isArray`, but not an ordinary array. */
class ArraySubclass extends Array<string> {}

/**
 * Malformed array shapes. Each factory returns a value for which
 * `Array.isArray` is `true` while the value is NOT an ordinary dense
 * data-property array — exactly the shapes `[...value]` would have normalized
 * away (holes become `undefined` entries, extras/symbols are dropped, an own
 * `Symbol.iterator` or an accessor supplies foreign values).
 */
const MALFORMED_ARRAYS: ReadonlyArray<readonly [string, () => unknown]> = [
  [
    "a hole",
    () => {
      const value: unknown[] = ["Fury", "Calm"];
      Reflect.deleteProperty(value, "1");
      return value;
    },
  ],
  [
    "a leading hole",
    () => {
      const value: unknown[] = new Array(2);
      value[1] = "Fury";
      return value;
    },
  ],
  [
    "an extra string key",
    () => {
      const value: unknown[] = ["Fury"];
      (value as unknown as Record<string, unknown>).note = "smuggled";
      return value;
    },
  ],
  [
    "a non-canonical index key",
    () => {
      const value: unknown[] = ["Fury"];
      (value as unknown as Record<string, unknown>)["01"] = "smuggled";
      return value;
    },
  ],
  [
    "a symbol key",
    () => {
      const value: unknown[] = ["Fury"];
      (value as unknown as Record<symbol, unknown>)[Symbol("smuggled")] = "x";
      return value;
    },
  ],
  [
    "an own Symbol.iterator override",
    () => {
      const value: unknown[] = ["Fury"];
      Object.defineProperty(value, Symbol.iterator, {
        value: function* injectedValues() {
          yield "Fury";
          yield "Smuggled";
        },
        configurable: true,
      });
      return value;
    },
  ],
  [
    "an accessor at index 0",
    () => {
      const value: unknown[] = ["Fury"];
      Object.defineProperty(value, "0", {
        get: () => "Fury",
        enumerable: true,
        configurable: true,
      });
      return value;
    },
  ],
  ["an array subclass", () => new ArraySubclass("Fury")],
  ["a foreign prototype", () => Object.setPrototypeOf(["Fury"], null)],
];

describe("toDuelCatalogEnvelope fail-closed mapping", () => {
  it("projects the complete Basic Rune tuple field-by-field, detached from the input", () => {
    const catalog = publicCatalog([genuineBasicRune()]) as unknown as PublicCardCatalog;
    const envelope = toDuelCatalogEnvelope(catalog);

    expect(envelope.dataVersion).toBe(REAL_DATA_VERSION);
    expect(envelope.digest).toBe(REAL_DIGEST);
    expect(envelope.cards).toHaveLength(1);
    const card = envelope.cards[0]!;
    expect(card).toEqual({
      id: "ogn-007-298",
      cardType: "Rune",
      ability: "",
      energy: null,
      power: null,
      might: null,
      domains: ["Fury"],
      tags: ["Basic"],
      canonicalCardId:
        "card.hash-30497c69657abd1d3abf17f9b3766e7d064817473a88828ca2ef4ab9b51f7902",
      name: "Fury Rune",
      fullName: "Fury Rune",
      localizedName: "炽烈符文",
      setCode: "ogn",
      cardNumber: "OGN-007/298",
      variant: "standard",
    });
    // Detached: arrays are fresh copies, not the catalog's own references.
    expect(card.domains).not.toBe(catalog.cards[0]!.domains);
    expect(card.tags).not.toBe(catalog.cards[0]!.tags);
  });

  it("fails closed when localizedName is missing instead of guessing one", () => {
    const { localizedName: _omitted, ...withoutLocalizedName } = genuineBasicRune();
    expect(() =>
      toDuelCatalogEnvelope(
        publicCatalog([withoutLocalizedName]) as unknown as PublicCardCatalog
      )
    ).toThrow(CardProgramAuthorityError);
  });

  it("fails closed on a non-string ability, a malformed stat, or a missing id", () => {
    const badAbility = { ...genuineBasicRune(), ability: 7 };
    const badEnergy = { ...genuineBasicRune(), energy: -1 };
    const badFraction = { ...genuineBasicRune(), might: 1.5 };
    const missingId = { ...genuineBasicRune(), id: "" };
    const badDomains = { ...genuineBasicRune(), domains: ["Fury", 3] };
    for (const card of [badAbility, badEnergy, badFraction, missingId, badDomains]) {
      expect(() =>
        toDuelCatalogEnvelope(publicCatalog([card]) as unknown as PublicCardCatalog)
      ).toThrow(CardProgramAuthorityError);
    }
  });

  it("rejects a catalog whose schemaVersion/stamp/cards are not the strict shape", () => {
    expect(() =>
      toDuelCatalogEnvelope(
        { ...publicCatalog([genuineBasicRune()]), schemaVersion: 2 } as unknown as PublicCardCatalog
      )
    ).toThrow(CardProgramAuthorityError);
    expect(() =>
      toDuelCatalogEnvelope(
        { ...publicCatalog([genuineBasicRune()]), digest: "" } as unknown as PublicCardCatalog
      )
    ).toThrow(CardProgramAuthorityError);
    expect(() =>
      toDuelCatalogEnvelope(
        { ...publicCatalog([genuineBasicRune()]), cards: "nope" } as unknown as PublicCardCatalog
      )
    ).toThrow(CardProgramAuthorityError);
  });
});

describe("createCardProgramAuthority resolved/unknown boundary", () => {
  it("resolves the genuine Basic Rune and reports a stamp-bound census", async () => {
    const runtime = await runtimeFrom(
      publicCatalog([genuineBasicRune(), unmodeledUnit()])
    );
    const authority = createCardProgramAuthority(runtime);

    expect(authority.catalogStamp).toEqual({
      dataVersion: REAL_DATA_VERSION,
      digest: REAL_DIGEST,
    });
    expect(authority.census).toEqual({
      catalogPrintings: 2,
      resolvedPrograms: 1,
      unresolvedPrintings: 1,
    });

    const entries = authority.resolvedProgramReferenceEntries();
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(Object.keys(entry).sort()).toEqual([
      "cardId",
      "encodedReference",
      "programId",
    ]);
    expect(entry.cardId).toBe("ogn-007-298");
    expect(entry.programId).toBe(
      `${DUEL_OFFICIAL_RULESET}:ogn-007-298`
    );
    expect(entry.programId).toBe(makeDuelOfficialProgramId("ogn-007-298"));

    // The encoded reference is canonical and decodes back to the stamp.
    const reference = decodeDuelProgramReferenceRaw(entry.encodedReference);
    expect(reference.cardId).toBe("ogn-007-298");
    expect(reference.programId).toBe(entry.programId);
    expect(reference.dataVersion).toBe(authority.catalogStamp.dataVersion);
    expect(reference.sourceCatalogDigest).toBe(authority.catalogStamp.digest);
  });

  it("keeps the unknown printing out of the index and answers unknown", async () => {
    const runtime = await runtimeFrom(
      publicCatalog([genuineBasicRune(), unmodeledUnit()])
    );
    const authority = createCardProgramAuthority(runtime);

    expect(authority.resolvedProgramReference("ogn-999-298")).toBeUndefined();
    expect(
      authority
        .resolvedProgramReferenceEntries()
        .some((entry) => entry.cardId === "ogn-999-298")
    ).toBe(false);

    const unknown = authority.sourceProgramPhaseScope("ogn-999-298", "begin");
    expect(unknown.scope).toBe("unknown");
    expect(unknown.reason).toBe("unresolved-program");
    expect(unknown.programId).toBeNull();
    expect(unknown.reference).toBeNull();
    expect(unknown.sourceProgramComplete).toBe(false);
    expect(unknown.globalClosureStatus).toBe("unverified");
    expect(unknown.sourceCardId).toBeNull();
  });

  it("answers the hardened source-local phase scope for the resolved Rune", async () => {
    const runtime = await runtimeFrom(publicCatalog([genuineBasicRune()]));
    const authority = createCardProgramAuthority(runtime);

    const scope = authority.sourceProgramPhaseScope("ogn-007-298", "begin");
    expect(scope.scope).toBe("source-program");
    expect(scope.directBoundaryStatus).toBe("known-no-handler");
    expect(scope.sourceApplicabilityStatus).toBe("known-no-handler");
    // Never a whole-phase proof: the closure stays unverified at this layer.
    expect(scope.globalClosureStatus).toBe("unverified");
    expect(scope.sourceProgramComplete).toBe(true);
    expect(scope.eventRecognized).toBe(true);
    expect(scope.programId).toBe(makeDuelOfficialProgramId("ogn-007-298"));
    expect(scope.requiredGlobalRuntimeClosure).toContain(
      "all-source-candidate-closure"
    );

    // A non-phase vocabulary word must not become a proven absence.
    const notAPhase = authority.sourceProgramPhaseScope("ogn-007-298", "conquer");
    expect(notAPhase.scope).toBe("unknown");
    expect(notAPhase.reason).toBe("unknown-event");
  });

  it("does not resolve a forged Basic Rune tuple against the stamp", () => {
    // Right id and stamp, but a forged domain/ability tuple: the hardened tuple
    // check keeps it unknown rather than resolving unrelated semantics.
    const forged = {
      ...genuineBasicRune(),
      domains: ["Calm"],
      localizedName: "伪造符文",
    };
    const authority = createCardProgramAuthority(
      fakeRuntime(publicCatalog([forged]))
    );
    expect(authority.census.resolvedPrograms).toBe(0);
    expect(authority.resolvedProgramReferenceEntries()).toHaveLength(0);
    expect(authority.sourceProgramPhaseScope("ogn-007-298", "begin").scope).toBe(
      "unknown"
    );
  });

  it("stays bound to the catalog stamp (a different stamp does not resolve)", () => {
    const differentDigest = `sha256:${"0".repeat(64)}`;
    const authority = createCardProgramAuthority(
      fakeRuntime(
        publicCatalog([genuineBasicRune()], {
          dataVersion: REAL_DATA_VERSION,
          digest: differentDigest,
        })
      )
    );
    expect(authority.catalogStamp.digest).toBe(differentDigest);
    expect(authority.census.resolvedPrograms).toBe(0);
    expect(authority.resolvedProgramReferenceEntries()).toHaveLength(0);
    expect(authority.sourceProgramPhaseScope("ogn-007-298", "begin").scope).toBe(
      "unknown"
    );

    const differentVersion = createCardProgramAuthority(
      fakeRuntime(
        publicCatalog([genuineBasicRune()], {
          dataVersion: "2026-10-12-not-the-official-gallery",
          digest: REAL_DIGEST,
        })
      )
    );
    expect(differentVersion.census.resolvedPrograms).toBe(0);
  });

  it("produces a stable index for identical catalogs", async () => {
    const catalog = publicCatalog([genuineBasicRune(), unmodeledUnit()]);
    const a = createCardProgramAuthority(await runtimeFrom(catalog));
    const b = createCardProgramAuthority(await runtimeFrom(catalog));
    expect(a.resolvedProgramReferenceEntries()).toEqual(
      b.resolvedProgramReferenceEntries()
    );
    // Frozen, so a caller cannot mutate another consumer's view.
    expect(Object.isFrozen(a.resolvedProgramReferenceEntries())).toBe(true);
    expect(Object.isFrozen(entryFor(a, "ogn-007-298"))).toBe(true);
  });

  it("refuses a spread/clone authority and exposes no executable program", async () => {
    const runtime = await runtimeFrom(publicCatalog([genuineBasicRune()]));
    const authority = createCardProgramAuthority(runtime);

    // No registry, no program, no capability leak on the facade itself.
    expect((authority as unknown as Record<string, unknown>).registry).toBeUndefined();
    expect((authority as unknown as Record<string, unknown>).program).toBeUndefined();

    const spread = { ...authority } as CardProgramAuthority;
    expect(() => spread.resolvedProgramReferenceEntries()).toThrow(
      CardProgramAuthorityError
    );
    expect(() => spread.resolvedProgramReference("ogn-007-298")).toThrow(
      CardProgramAuthorityError
    );
    expect(() => spread.sourceProgramPhaseScope("ogn-007-298", "begin")).toThrow(
      CardProgramAuthorityError
    );

    // A clone that never went through the factory cannot query either.
    const forged = {
      ...authority,
      sourceProgramPhaseScope: authority.sourceProgramPhaseScope,
    } as CardProgramAuthority;
    expect(() => forged.sourceProgramPhaseScope("ogn-007-298", "begin")).toThrow(
      CardProgramAuthorityError
    );
  });

  it("fails closed when the loaded runtime catalog omits localizedName", async () => {
    const { localizedName: _omitted, ...withoutLocalizedName } = genuineBasicRune();
    const runtime = await runtimeFrom(publicCatalog([withoutLocalizedName]));
    expect(() => createCardProgramAuthority(runtime)).toThrow(
      CardProgramAuthorityError
    );
  });

  it("rejects a forged runtime and duplicate printing ids", () => {
    expect(() =>
      createCardProgramAuthority(undefined as unknown as CardCatalogRuntime)
    ).toThrow(CardProgramAuthorityError);
    expect(() =>
      createCardProgramAuthority({} as unknown as CardCatalogRuntime)
    ).toThrow(CardProgramAuthorityError);
    expect(() =>
      createCardProgramAuthority(
        fakeRuntime(publicCatalog([genuineBasicRune(), genuineBasicRune()]))
      )
    ).toThrow();
  });
});

describe("array shape is validated, never spread-normalized", () => {
  it.each(MALFORMED_ARRAYS)(
    "fails closed on a domains array carrying %s",
    (_label, makeArray) => {
      const card = { ...genuineBasicRune(), domains: makeArray() };
      expect(() =>
        toDuelCatalogEnvelope(
          publicCatalog([card]) as unknown as PublicCardCatalog
        )
      ).toThrow(CardProgramAuthorityError);
    }
  );

  it.each(MALFORMED_ARRAYS)(
    "fails closed on a tags array carrying %s",
    (_label, makeArray) => {
      const card = { ...genuineBasicRune(), tags: makeArray() };
      expect(() =>
        toDuelCatalogEnvelope(
          publicCatalog([card]) as unknown as PublicCardCatalog
        )
      ).toThrow(CardProgramAuthorityError);
    }
  );

  it.each(MALFORMED_ARRAYS)(
    "fails closed on the top-level cards array carrying %s",
    (_label, makeArray) => {
      // `Array.prototype.map` would have skipped a hole and silently dropped a
      // printing; the mapper must refuse the shape instead of shrinking it.
      expect(() =>
        toDuelCatalogEnvelope(
          catalogWithCards(makeArray()) as unknown as PublicCardCatalog
        )
      ).toThrow(CardProgramAuthorityError);
    }
  );

  it("never launders a hole into an undefined list entry", () => {
    const holey: unknown[] = ["Fury", "Calm"];
    Reflect.deleteProperty(holey, "1");
    // A spread invents the missing entry and keeps the length: `[...value]` used
    // to yield ["Fury", undefined] typed as `string[]`.
    expect(holey.length).toBe(2);
    expect([...holey]).toEqual(["Fury", undefined]);

    const card = { ...genuineBasicRune(), domains: holey };
    expect(() =>
      createCardProgramAuthority(fakeRuntime(publicCatalog([card])))
    ).toThrow(CardProgramAuthorityError);

    const holeyCards: unknown[] = [genuineBasicRune(), genuineBasicRune()];
    Reflect.deleteProperty(holeyCards, "1");
    expect(() =>
      createCardProgramAuthority(fakeRuntime(catalogWithCards(holeyCards)))
    ).toThrow(CardProgramAuthorityError);
  });

  it("does not honour a forged own Symbol.iterator over a plain spread", () => {
    const value = ["Fury"] as unknown[];
    Object.defineProperty(value, Symbol.iterator, {
      value: function* injectedValues() {
        yield "Calm";
        yield "Injected";
      },
      configurable: true,
    });
    // A spread of this array would contain two entries it never declares.
    expect([...value]).toEqual(["Calm", "Injected"]);

    const card = { ...genuineBasicRune(), domains: value };
    expect(() =>
      toDuelCatalogEnvelope(
        publicCatalog([card]) as unknown as PublicCardCatalog
      )
    ).toThrow(CardProgramAuthorityError);
  });

  it("still accepts an ordinary dense array from a frozen catalog", () => {
    // `loadCardCatalogRuntime` hands over plain arrays; freezing them (as any
    // later consumer may) must not trip the hardening.
    const card = Object.freeze({
      ...genuineBasicRune(),
      domains: Object.freeze(["Fury"]),
      tags: Object.freeze(["Basic"]),
    });
    const catalog = Object.freeze({
      ...publicCatalog([card]),
      cards: Object.freeze([card]),
    });
    const envelope = toDuelCatalogEnvelope(
      catalog as unknown as PublicCardCatalog
    );
    expect(envelope.cards[0]!.domains).toEqual(["Fury"]);
    expect(envelope.cards[0]!.tags).toEqual(["Basic"]);
    expect(Object.isFrozen(envelope.cards)).toBe(false);
  });
});
