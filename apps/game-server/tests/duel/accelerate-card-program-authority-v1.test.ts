/**
 * Server authority coverage for the explicitly opt-in Unit Accelerate profiles.
 * The real 1,381-printing deck catalog is evidence here; production profiles
 * remain unchanged because these factories are not wired into a runtime.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeDuelProgramReferenceRaw } from "@riftbound/card-dsl/duel";
import {
  getCardProgramRegistryForRuntime,
  type CardProgramAuthority,
  type CardProgramAuthorityCensus,
  createCardProgramAuthority,
  createDuelAccelerateCardProgramAuthorityV1,
  createDuelExtendedUnitCardProgramAuthorityV1,
  createDuelFuryOptionalRosterCardProgramAuthorityV1,
} from "../../src/duel/card-program-authority.js";
import type { CardCatalogRuntime, PublicCardCatalog } from "../../src/card-catalog.js";

const catalogPath = new URL(
  "../../../../packages/card-data/data/deck-catalog.json",
  import.meta.url
);
const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as PublicCardCatalog;

function runtimeFrom(value: PublicCardCatalog): CardCatalogRuntime {
  return { publicCatalog: value } as unknown as CardCatalogRuntime;
}

function census(
  catalogPrintings: number,
  resolvedPrograms: number
): CardProgramAuthorityCensus {
  return {
    catalogPrintings,
    resolvedPrograms,
    unresolvedPrintings: catalogPrintings - resolvedPrograms,
  };
}

function entryIds(authority: CardProgramAuthority): string[] {
  return authority
    .resolvedProgramReferenceEntries()
    .map((entry) => entry.cardId);
}

describe("server Accelerate authority v1", () => {
  it("binds the explicit 77-program roster while preserving every legacy reference", () => {
    const legacy = createCardProgramAuthority(runtimeFrom(catalog));
    const roster = createDuelFuryOptionalRosterCardProgramAuthorityV1(runtimeFrom(catalog));
    expect(roster.census).toEqual(census(1381, 77));
    for (const entry of legacy.resolvedProgramReferenceEntries()) {
      expect(roster.resolvedProgramReference(entry.cardId)).toEqual(entry);
    }
    const registry = getCardProgramRegistryForRuntime(roster);
    const deflect = registry.getProgram("ogn-013-298")!;
    expect(deflect.semantics).toMatchObject({ kind: "deflect", modifier: {
      timing: "additional-play-cost", per: "each-choice-of-source", optional: false,
    } });
    expect(registry.sourceProgramPhaseScope("ogn-013-298", "main")).toMatchObject({
      scope: "source-program", directBoundaryStatus: "known-no-handler",
      sourceApplicabilityStatus: "known-no-handler", sourceProgramComplete: true,
      globalClosureStatus: "unverified", handlers: [], modifiers: [],
      runtimeSubevents: [{ event: "play", handlers: [],
        modifiers: ["passive.deflect.additional-opponent-power-cost"] }],
    });
    expect(() => getCardProgramRegistryForRuntime({ ...roster })).toThrow();
  });

  it("keeps the default 65 surface and opts into 67/71 on the real 1,381-printing catalog", () => {
    const runtime = runtimeFrom(catalog);
    const legacy = createCardProgramAuthority(runtime);
    const accelerate = createDuelAccelerateCardProgramAuthorityV1(runtime);
    const extended = createDuelExtendedUnitCardProgramAuthorityV1(runtime);

    expect(legacy.census).toEqual(census(1381, 65));
    expect(accelerate.census).toEqual(census(1381, 67));
    expect(extended.census).toEqual(census(1381, 71));
    expect(legacy.catalogStamp).toEqual({
      dataVersion: "2026-10-12-official-gallery",
      digest:
        "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10",
    });

    const addedByAccelerate = entryIds(accelerate).filter(
      (id) => !new Set(entryIds(legacy)).has(id)
    );
    const addedByExtended = entryIds(extended).filter(
      (id) => !new Set(entryIds(accelerate)).has(id)
    );
    expect(addedByAccelerate).toEqual(["ogn-001-298", "ogn-010-298"]);
    expect(addedByExtended).toHaveLength(4);
    expect(addedByExtended).toEqual([
      "ogn-210-298",
      "ogn-215-298",
      "sfd-156-221",
      "unl-225-219",
    ]);
  });

  it("exposes exact canonical references and source stamps for both pure Accelerate printings", () => {
    const authority = createDuelAccelerateCardProgramAuthorityV1(
      runtimeFrom(catalog)
    );
    const registry = getCardProgramRegistryForRuntime(authority);

    for (const cardId of ["ogn-001-298", "ogn-010-298"]) {
      const entry = authority.resolvedProgramReference(cardId);
      expect(entry).toBeDefined();
      expect(entry).toEqual({
        cardId,
        programId: `riftbound-duel-official-v1:${cardId}`,
        encodedReference: expect.any(String),
      });
      expect(decodeDuelProgramReferenceRaw(entry!.encodedReference)).toEqual({
        kind: "duel-official-program-reference",
        schemaVersion: 1,
        programId: `riftbound-duel-official-v1:${cardId}`,
        cardId,
        dataVersion: "2026-10-12-official-gallery",
        sourceCatalogDigest:
          "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10",
      });
      expect(registry.getProgram(cardId)?.semantics).toEqual({
        kind: "accelerate",
        choiceTiming: "card-play-choices",
        optional: true,
        additionalCost: {
          energy: 1,
          power: [{ allowedDomains: ["Fury"], amount: 1 }],
        },
        paidEffect: {
          kind: "enter-ready-replacement",
          timing: "unit-entry",
        },
      });
    }

    expect(authority.resolvedProgramReference("ogn-030-298")).toBeUndefined();
    expect(authority.sourceProgramPhaseScope("ogn-001-298", {
      phase: "begin",
      mode: "runtime-subevents",
    })).toMatchObject({
      scope: "source-program",
      sourceProgramComplete: true,
      globalClosureStatus: "unverified",
      runtimeSubevents: [
        {
          event: "unit-enter",
          handlers: ["optional.accelerate.unit-entry"],
          modifiers: [],
        },
      ],
    });
  });

  it("keeps authority state detached and frozen, while forged receivers fail closed", () => {
    const detachedCatalog = JSON.parse(
      JSON.stringify(catalog)
    ) as PublicCardCatalog;
    const authority = createDuelAccelerateCardProgramAuthorityV1(
      runtimeFrom(detachedCatalog)
    );
    const before = authority.resolvedProgramReferenceEntries();

    const first = detachedCatalog.cards[0] as Record<string, unknown>;
    first.id = "forged-card-id";
    first.ability = "[Accelerate] forged";
    expect(authority.resolvedProgramReferenceEntries()).toEqual(before);
    expect(authority.resolvedProgramReference("ogn-001-298")).toEqual(
      before.find((entry) => entry.cardId === "ogn-001-298")
    );
    expect(Object.isFrozen(authority)).toBe(true);
    expect(Object.isFrozen(authority.catalogStamp)).toBe(true);
    expect(Object.isFrozen(authority.census)).toBe(true);
    expect(Object.isFrozen(before)).toBe(true);

    const spread = { ...authority } as CardProgramAuthority;
    const json = JSON.parse(JSON.stringify(authority)) as CardProgramAuthority;
    const foreign = {
      ...authority,
      resolvedProgramReferenceEntries: authority.resolvedProgramReferenceEntries,
    } as CardProgramAuthority;
    for (const forged of [spread, json, foreign]) {
      expect(() => getCardProgramRegistryForRuntime(forged)).toThrow(
        /genuine authority|live authority/
      );
    }
  });

  it("leaves compound Accelerate text unknown in every explicit profile", () => {
    const sourceCard = catalog.cards.find(
      (card) => card.id === "ogn-001-298"
    );
    expect(sourceCard).toBeDefined();
    const compoundCatalog = {
      ...catalog,
      cards: [
        {
          ...sourceCard!,
          ability: `${sourceCard!.ability}\nWhen you play me, draw 1.`,
        },
      ],
    } as PublicCardCatalog;

    for (const factory of [
      createCardProgramAuthority,
      createDuelAccelerateCardProgramAuthorityV1,
      createDuelExtendedUnitCardProgramAuthorityV1,
    ]) {
      const authority = factory(runtimeFrom(compoundCatalog));
      expect(authority.census).toEqual(census(1, 0));
      expect(authority.resolvedProgramReference("ogn-001-298")).toBeUndefined();
      expect(
        authority.sourceProgramPhaseScope("ogn-001-298", "unit-enter").scope
      ).toBe("unknown");
    }
  });
});
