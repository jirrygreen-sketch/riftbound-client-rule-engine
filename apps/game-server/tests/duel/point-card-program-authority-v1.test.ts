/**
 * Focused coverage for the explicitly opt-in point-damage Spell program
 * authority. The real 1,381-printing deck catalog is evidence here: the four
 * source-verified point-damage printings must resolve only through the new
 * factory, while the default and older factories stay byte-for-byte unchanged.
 *
 * This module proves SOURCE identity only. It does not claim cost settlement,
 * Might, target/Deflect costing or any public execution wiring.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeDuelProgramReferenceRaw } from "@riftbound/card-dsl/duel";
import {
  createCardProgramAuthority,
  createDuelAccelerateCardProgramAuthorityV1,
  createDuelExtendedUnitCardProgramAuthorityV1,
  createDuelFuryOptionalRosterCardProgramAuthorityV1,
  createDuelPointDamageCardProgramAuthorityV1,
  getCardProgramRegistryForRuntime,
  type CardProgramAuthority,
  type CardProgramAuthorityCensus,
} from "../../src/duel/card-program-authority.js";
import type { CardCatalogRuntime, PublicCardCatalog } from "../../src/card-catalog.js";

const catalogPath = new URL(
  "../../../../packages/card-data/data/deck-catalog.json",
  import.meta.url
);
const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as PublicCardCatalog;

const POINT_IDS = ["ogs-003-024", "ogn-009-298", "ogn-085-298", "ogs-022-024"] as const;
const POINT_AMOUNTS: Readonly<Record<string, 2 | 3 | 6 | 8>> = Object.freeze({
  "ogs-003-024": 2,
  "ogn-009-298": 3,
  "ogn-085-298": 6,
  "ogs-022-024": 8,
});

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
  return authority.resolvedProgramReferenceEntries().map((entry) => entry.cardId);
}

describe("server point-damage authority v1", () => {
  it("resolves the reviewed 81-program surface on the real 1,381-printing catalog", () => {
    const authority = createDuelPointDamageCardProgramAuthorityV1(runtimeFrom(catalog));
    expect(authority.census).toEqual(census(1381, 81));
    expect(authority.catalogStamp).toEqual({
      dataVersion: "2026-10-12-official-gallery",
      digest:
        "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10",
    });

    const ids = new Set(entryIds(authority));
    for (const cardId of POINT_IDS) {
      expect(ids.has(cardId), `point printing ${cardId} resolved`).toBe(true);
      expect(authority.resolvedProgramReference(cardId)).toBeDefined();
    }
  });

  it("binds every older factory's per-printing references unchanged", () => {
    const runtime = runtimeFrom(catalog);
    const legacy = createCardProgramAuthority(runtime);
    const accelerate = createDuelAccelerateCardProgramAuthorityV1(runtime);
    const extended = createDuelExtendedUnitCardProgramAuthorityV1(runtime);
    const fury = createDuelFuryOptionalRosterCardProgramAuthorityV1(runtime);
    const point = createDuelPointDamageCardProgramAuthorityV1(runtime);

    expect(legacy.census).toEqual(census(1381, 65));
    expect(accelerate.census).toEqual(census(1381, 67));
    expect(extended.census).toEqual(census(1381, 71));
    expect(fury.census).toEqual(census(1381, 77));

    // Every Fury77 entry (and, transitively, every earlier factory entry) is
    // byte-for-byte identical in the new opt-in surface — only four point
    // printings are added.
    for (const entry of fury.resolvedProgramReferenceEntries()) {
      expect(point.resolvedProgramReference(entry.cardId)).toEqual(entry);
    }
    const added = entryIds(point).filter((id) => !new Set(entryIds(fury)).has(id));
    expect(added.sort()).toEqual([...POINT_IDS].sort());

    // The four point printings stay unknown in the default and older factories.
    for (const cardId of POINT_IDS) {
      for (const older of [legacy, accelerate, extended, fury]) {
        expect(older.resolvedProgramReference(cardId)).toBeUndefined();
        expect(older.sourceProgramPhaseScope(cardId, "main").scope).toBe("unknown");
      }
    }
  });

  it("exposes the exact canonical reference and point amount for each printing", () => {
    const authority = createDuelPointDamageCardProgramAuthorityV1(runtimeFrom(catalog));
    const registry = getCardProgramRegistryForRuntime(authority);

    for (const cardId of POINT_IDS) {
      const entry = authority.resolvedProgramReference(cardId);
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

      const program = registry.getProgram(cardId)!;
      expect(program.semantics.kind).toBe("point-damage-spell-resolution");
      const effect = (program.semantics as {
        effects: readonly {
          kind: string;
          amount: number;
          target: { kind: string; controller: string; location: string;
            minSelections: number; maxSelections: number };
        }[];
      }).effects[0]!;
      expect(effect.kind).toBe("point-damage");
      expect(effect.amount).toBe(POINT_AMOUNTS[cardId]);
      expect(effect.target.kind).toBe("unit");
      expect(effect.target.controller).toBe("any");
      expect(effect.target.minSelections).toBe(1);
      expect(effect.target.maxSelections).toBe(1);
      // "at a battlefield" vs plain "a unit" is read from the real whole IR.
      expect(effect.target.location).toBe(
        cardId === "ogs-022-024" ? "any" : "battlefield"
      );
    }
  });

  it("reports source-program scope without claiming whole-phase readiness", () => {
    const authority = createDuelPointDamageCardProgramAuthorityV1(runtimeFrom(catalog));
    for (const cardId of POINT_IDS) {
      const scope = authority.sourceProgramPhaseScope(cardId, {
        phase: "main",
        mode: "runtime-subevents",
      });
      expect(scope.scope).toBe("source-program");
      expect(scope.directBoundaryStatus).toBe("known-no-handler");
      expect(scope.sourceApplicabilityStatus).toBe("handlers-or-modifiers");
      // This layer never promotes a resolved source into a global closure.
      expect(scope.globalClosureStatus).toBe("unverified");
      expect(scope.sourceProgramComplete).toBe(true);
      expect(scope.runtimeSubevents).toEqual([
        {
          event: "spell-resolution",
          handlers: ["spell-resolution.point-damage"],
          modifiers: [],
        },
      ]);
    }
    // A non-point-printing Spell is not silently resolved as a point program.
    expect(authority.sourceProgramPhaseScope("ogn-004-298", "main").scope).toBe(
      "unknown"
    );
  });

  it("keeps state detached and frozen while forged receivers fail closed", () => {
    const detached = JSON.parse(JSON.stringify(catalog)) as PublicCardCatalog;
    const authority = createDuelPointDamageCardProgramAuthorityV1(runtimeFrom(detached));
    const before = authority.resolvedProgramReferenceEntries();

    const first = detached.cards[0] as Record<string, unknown>;
    first.id = "forged-card-id";
    first.ability = "Deal 2 to a unit at a battlefield.";
    expect(authority.resolvedProgramReferenceEntries()).toEqual(before);
    expect(Object.isFrozen(authority)).toBe(true);
    expect(Object.isFrozen(authority.catalogStamp)).toBe(true);
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

  it("leaves a forged point-damage tuple unknown even under the point factory", () => {
    const source = catalog.cards.find((card) => card.id === "ogn-009-298")!;
    // Right id and stamp, but a tampered amount/ability: the exact whole-tuple
    // source allow-list must keep it unknown instead of resolving it.
    const forged = {
      ...catalog,
      cards: [{ ...source, ability: "Deal 4 to a unit at a battlefield." }],
    } as PublicCardCatalog;
    const authority = createDuelPointDamageCardProgramAuthorityV1(runtimeFrom(forged));
    expect(authority.census).toEqual(census(1, 0));
    expect(authority.resolvedProgramReference("ogn-009-298")).toBeUndefined();
    expect(authority.sourceProgramPhaseScope("ogn-009-298", "main").scope).toBe(
      "unknown"
    );
  });
});
