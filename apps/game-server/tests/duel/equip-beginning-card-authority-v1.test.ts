/**
 * Focused coverage for the explicitly opt-in Equip and Beginning-Phase Legend
 * source authorities. The real 1,381-printing deck catalog is evidence here:
 * the 24 source-closed pure resource-only Equip Gear printings and the three
 * Loose Cannon Beginning-Phase conditional-draw Legends must resolve only
 * through the new factories, while every older factory stays byte-for-byte
 * unchanged.
 *
 * This module proves SOURCE identity only. It does not claim Gear/CardPlay/
 * Equip-activation execution, Beginning-draw execution, cost settlement, or any
 * public execution wiring. `SourceCompleteBeginning` stays false: there is no
 * native Beginning-phase executor here, so the trigger stays `pending`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeDuelProgramReferenceRaw } from "@riftbound/card-dsl/duel";
import {
  createCardProgramAuthority,
  createDuelAccelerateCardProgramAuthorityV1,
  createDuelBeginningPhaseCardProgramAuthorityV1,
  createDuelEquipBeginningCardProgramAuthorityV1,
  createDuelEquipCardProgramAuthorityV1,
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

const CATALOG_STAMP = {
  dataVersion: "2026-10-12-official-gallery",
  digest:
    "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10",
} as const;

/** The 24 source-closed pure resource-only Equip Gear printings. */
const EQUIP_IDS = [
  "sfd-009-221",
  "sfd-016-221",
  "sfd-030-221",
  "sfd-033-221",
  "sfd-042-221",
  "sfd-051-221",
  "sfd-073-221",
  "sfd-086-221",
  "sfd-095-221",
  "sfd-102-221",
  "sfd-108-221",
  "sfd-115-221",
  "sfd-118-221",
  "sfd-124-221",
  "sfd-133-221",
  "sfd-134-221",
  "sfd-153-221",
  "sfd-161-221",
  "sfd-172-221",
  "unl-019-219",
  "unl-039-219",
  "unl-096-219",
  "ven-011-166",
  "ven-027-166",
] as const;

/** The three Loose Cannon Beginning-Phase conditional-draw Legends. */
const BEGINNING_IDS = ["ogn-251-298", "ogn-301-298", "ogn-301-star-298"] as const;

/**
 * The two pure-Shield passive Unit printings. The DSL equip/beginning factories
 * compose the pure-Shield surface upstream, so these come along with the new
 * registries; the Server deliberately mints no dedicated Shield authority.
 */
const SHIELD_PASSIVE_IDS = ["ogn-052-298", "ogs-005-024"] as const;

/** The four Equip printings that stay `unknown` (non-resource cost or alteration). */
const UNRESOLVED_EQUIP_IDS = [
  "rad-150-167",
  "sfd-150-221",
  "sfd-178-221",
  "unl-188-219",
] as const;

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

const OLDER_FACTORIES = {
  legacy65: (runtime: CardCatalogRuntime) => createCardProgramAuthority(runtime),
  accelerate67: (runtime: CardCatalogRuntime) =>
    createDuelAccelerateCardProgramAuthorityV1(runtime),
  extended71: (runtime: CardCatalogRuntime) =>
    createDuelExtendedUnitCardProgramAuthorityV1(runtime),
  fury77: (runtime: CardCatalogRuntime) =>
    createDuelFuryOptionalRosterCardProgramAuthorityV1(runtime),
  point81: (runtime: CardCatalogRuntime) =>
    createDuelPointDamageCardProgramAuthorityV1(runtime),
} as const;

const OLDER_CENSUS = {
  legacy65: 65,
  accelerate67: 67,
  extended71: 71,
  fury77: 77,
  point81: 81,
} as const;

const NEW_FACTORIES = {
  equip107: (runtime: CardCatalogRuntime) =>
    createDuelEquipCardProgramAuthorityV1(runtime),
  beginning86: (runtime: CardCatalogRuntime) =>
    createDuelBeginningPhaseCardProgramAuthorityV1(runtime),
  combined110: (runtime: CardCatalogRuntime) =>
    createDuelEquipBeginningCardProgramAuthorityV1(runtime),
} as const;

describe("server Equip + Beginning-Phase authority v1", () => {
  it("resolves the reviewed 107/86/110 surfaces on the real catalog", () => {
    const runtime = runtimeFrom(catalog);
    expect(createDuelEquipCardProgramAuthorityV1(runtime).census).toEqual(
      census(1381, 107)
    );
    expect(createDuelBeginningPhaseCardProgramAuthorityV1(runtime).census).toEqual(
      census(1381, 86)
    );
    expect(
      createDuelEquipBeginningCardProgramAuthorityV1(runtime).census
    ).toEqual(census(1381, 110));
    expect(createDuelEquipCardProgramAuthorityV1(runtime).catalogStamp).toEqual(
      CATALOG_STAMP
    );
  });

  it("keeps every older factory byte-for-byte and adds only the intended printings", () => {
    const runtime = runtimeFrom(catalog);
    const older = Object.fromEntries(
      Object.entries(OLDER_FACTORIES).map(([name, factory]) => [name, factory(runtime)])
    ) as Record<keyof typeof OLDER_FACTORIES, CardProgramAuthority>;
    for (const [name, size] of Object.entries(OLDER_CENSUS)) {
      expect(older[name as keyof typeof OLDER_CENSUS].census).toEqual(
        census(1381, size)
      );
    }

    const equip = createDuelEquipCardProgramAuthorityV1(runtime);
    const beginning = createDuelBeginningPhaseCardProgramAuthorityV1(runtime);
    const combined = createDuelEquipBeginningCardProgramAuthorityV1(runtime);

    // Machine per-printing reference comparison: every reference an older
    // factory resolved is byte-for-byte identical in every new surface.
    for (const newSurface of [equip, beginning, combined]) {
      for (const authority of Object.values(older)) {
        for (const entry of authority.resolvedProgramReferenceEntries()) {
          expect(newSurface.resolvedProgramReference(entry.cardId)).toEqual(entry);
        }
      }
    }

    const pointIds = new Set(entryIds(older.point81));
    const equipAdded = entryIds(equip).filter((id) => !pointIds.has(id));
    const beginningAdded = entryIds(beginning).filter((id) => !pointIds.has(id));
    const combinedAdded = entryIds(combined).filter((id) => !pointIds.has(id));

    // Equip adds exactly the 24 pure Equip printings plus the two pure-Shield
    // passive Units the DSL surface composes; nothing else.
    expect(
      [...equipAdded].sort()
    ).toEqual([...EQUIP_IDS, ...SHIELD_PASSIVE_IDS].sort());
    // Beginning adds exactly the three Legends plus the same two Shield passives.
    expect(
      [...beginningAdded].sort()
    ).toEqual([...BEGINNING_IDS, ...SHIELD_PASSIVE_IDS].sort());
    expect(
      [...combinedAdded].sort()
    ).toEqual([...EQUIP_IDS, ...BEGINNING_IDS, ...SHIELD_PASSIVE_IDS].sort());

    // Every new printing stays unknown in every older factory.
    for (const authority of Object.values(older)) {
      for (const cardId of [...EQUIP_IDS, ...BEGINNING_IDS]) {
        expect(authority.resolvedProgramReference(cardId)).toBeUndefined();
        expect(authority.sourceProgramPhaseScope(cardId, "main").scope).toBe(
          "unknown"
        );
      }
    }
  });

  it("exposes each resolved Equip program's exact reference and pending runtime", () => {
    const authority = createDuelEquipCardProgramAuthorityV1(runtimeFrom(catalog));
    const registry = getCardProgramRegistryForRuntime(authority);

    for (const cardId of EQUIP_IDS) {
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
        dataVersion: CATALOG_STAMP.dataVersion,
        sourceCatalogDigest: CATALOG_STAMP.digest,
      });

      const program = registry.getProgram(cardId)!;
      expect(program.semantics.kind).toBe("equip-activated-ability");
      const semantics = program.semantics as {
        event: string;
        sourceScope: string;
        abilityClass: string;
        cost: { nonResourceLiteral: string | null; literal: string };
        costAlterations: readonly unknown[];
        target: { controller: string; selection: string };
        runtime: { status: string; required: readonly string[] };
      };
      expect(semantics.event).toBe("activate");
      expect(semantics.sourceScope).toBe("source-gear-on-board");
      expect(semantics.abilityClass).toBe("activated-ability");
      expect(semantics.cost.nonResourceLiteral).toBeNull();
      expect(semantics.costAlterations).toEqual([]);
      expect(semantics.target.controller).toBe("source-controller");
      expect(semantics.target.selection).toBe("target");
      // No native Equip-activation executor exists yet: the program stays pending.
      expect(semantics.runtime.status).toBe("pending");
      expect(semantics.runtime.required).toContain("equip-activation-executor");
    }
  });

  it("reads each Beginning Legend's whole-IR fields and keeps the trigger pending", () => {
    const authority = createDuelBeginningPhaseCardProgramAuthorityV1(
      runtimeFrom(catalog)
    );
    const registry = getCardProgramRegistryForRuntime(authority);

    for (const cardId of BEGINNING_IDS) {
      const program = registry.getProgram(cardId)!;
      expect(program.semantics.kind).toBe("beginning-phase-conditional-draw");
      const semantics = program.semantics as {
        trigger: { event: string; phase: string; scope: string; timing: string };
        effect: {
          kind: string;
          amount: number;
          recipient: string;
          condition: {
            kind: string;
            maximum: number;
            scope: string;
            clauseRole: string;
            readsPublicInformationOnly: boolean;
          };
        };
        controller: { kind: string; source: string; status: string };
        runtime: { status: string; required: readonly string[] };
      };
      expect(semantics.trigger).toMatchObject({
        event: "beginning-phase",
        phase: "begin",
        scope: "controller-beginning-phase",
        timing: "start",
      });
      expect(semantics.effect.kind).toBe("draw-cards");
      expect(semantics.effect.amount).toBe(1);
      expect(semantics.effect.recipient).toBe("ability-controller");
      expect(semantics.effect.condition.kind).toBe("hand-size-at-most");
      expect(semantics.effect.condition.maximum).toBe(1);
      expect(semantics.effect.condition.scope).toBe("ability-controller-hand");
      expect(semantics.effect.condition.clauseRole).toBe("effect");
      expect(semantics.effect.condition.readsPublicInformationOnly).toBe(true);
      expect(semantics.controller.kind).toBe("ability-controller");
      expect(semantics.controller.status).toBe("pending");
      // No native Beginning executor: keep SourceCompleteBeginning false / pending.
      expect(semantics.runtime.status).toBe("pending");
      expect(semantics.runtime.required).toContain(
        "beginning-phase-trigger-executor"
      );
    }
  });

  it("keeps runtime scope and global-closure definitions unchanged", () => {
    const equip = createDuelEquipCardProgramAuthorityV1(runtimeFrom(catalog));
    for (const cardId of EQUIP_IDS) {
      const scope = equip.sourceProgramPhaseScope(cardId, {
        phase: "begin",
        mode: "runtime-subevents",
      });
      expect(scope.scope).toBe("source-program");
      expect(scope.globalClosureStatus).toBe("unverified");
      expect(scope.sourceProgramComplete).toBe(true);
      expect(scope.runtimeSubevents).toEqual([
        {
          event: "activate",
          handlers: ["activated.equip"],
          modifiers: ["activated.equip.base-cost", "activated.equip.target"],
        },
      ]);
    }

    const beginning = createDuelBeginningPhaseCardProgramAuthorityV1(
      runtimeFrom(catalog)
    );
    for (const cardId of BEGINNING_IDS) {
      const scope = beginning.sourceProgramPhaseScope(cardId, {
        phase: "begin",
        mode: "runtime-subevents",
      });
      expect(scope.scope).toBe("source-program");
      // A resolved source is never promoted into a whole-phase closure.
      expect(scope.globalClosureStatus).toBe("unverified");
      // SourceCompleteBeginning has no native executor and must stay false.
      expect(scope.sourceProgramComplete).toBe(false);
      expect(scope.runtimeSubevents).toEqual([
        { event: "begin", handlers: ["trigger.beginning-phase"], modifiers: [] },
      ]);
    }

    // A non-Equip Gear and a non-Legend are not silently resolved.
    expect(equip.sourceProgramPhaseScope("ogn-004-298", "main").scope).toBe(
      "unknown"
    );
    expect(beginning.sourceProgramPhaseScope("ogn-004-298", "main").scope).toBe(
      "unknown"
    );
  });

  it("leaves the four non-resource/cost-altering Equip printings unknown", () => {
    const authority = createDuelEquipCardProgramAuthorityV1(runtimeFrom(catalog));
    for (const cardId of UNRESOLVED_EQUIP_IDS) {
      expect(authority.resolvedProgramReference(cardId)).toBeUndefined();
      expect(authority.sourceProgramPhaseScope(cardId, "main").scope).toBe(
        "unknown"
      );
    }
  });

  it("keeps state detached and frozen while forged receivers fail closed", () => {
    for (const factory of Object.values(NEW_FACTORIES)) {
      const detached = JSON.parse(JSON.stringify(catalog)) as PublicCardCatalog;
      const authority = factory(runtimeFrom(detached));
      const before = authority.resolvedProgramReferenceEntries();

      const first = detached.cards[0] as Record<string, unknown>;
      first.id = "forged-card-id";
      first.ability = "[Equip] forged";
      expect(authority.resolvedProgramReferenceEntries()).toEqual(before);
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
    }
  });

  it("leaves a forged Equip tuple unknown even under the equip factory", () => {
    const source = catalog.cards.find((card) => card.id === "sfd-009-221")!;
    // Right id and stamp, but a tampered ability: the exact whole-tuple source
    // allow-list must keep it unknown instead of resolving it.
    const forged = {
      ...catalog,
      cards: [{ ...source, ability: "[Equip] :rb_rune_fury: (forged)" }],
    } as PublicCardCatalog;
    const authority = createDuelEquipCardProgramAuthorityV1(runtimeFrom(forged));
    expect(authority.census).toEqual(census(1, 0));
    expect(authority.resolvedProgramReference("sfd-009-221")).toBeUndefined();
    expect(authority.sourceProgramPhaseScope("sfd-009-221", "main").scope).toBe(
      "unknown"
    );
  });
});
