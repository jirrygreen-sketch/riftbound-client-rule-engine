import { describe, expect, it } from "vitest";
import { resolveDuelTotalCostV2 } from "@riftbound/engine-core/duel";
import { createDuelProductionSourceServicesV2 } from "../../src/duel/production-source-services-v2.js";
import { costFixture } from "./fixtures/p4-spell-service-fixture.js";

describe("P4 Spell native cost census", () => {
  it("enumerates actual hidden/live sources without closing the phase", async () => {
    const f = await costFixture();
    const census = f.journal.readCostCensus()!;
    expect(census.phaseClosed).toBe(false);
    expect(census.sources.length).toBeGreaterThan(20);
    expect(census.sources.some(source => source.uid === f.uid && source.sourceEpoch === f.epoch &&
      source.zone.kind === "hand")).toBe(true);
    const verified = f.spell.verifiedCostSource(f.request);
    expect(verified.candidates.length).toBe(census.sources.length);
    expect(verified.base.sourceUid).toBe(f.uid);
    expect(f.spell.privateFingerprintData().costCensus).toBeDefined();
  });

  it("blocks an unresolved hidden program before payment", async () => {
    const f = await costFixture(true);
    expect(f.journal.readCostCensus()!.sources.some(source => source.cardId === "unl-176-219" &&
      source.programReference === null)).toBe(true);
    expect(() => f.spell.verifiedCostSource(f.request)).toThrow(/unbound native cost source/);
  });

  it("rejects wrong actor, UID, source epoch, and subject", async () => {
    const f = await costFixture();
    const tuple = JSON.parse(f.request.transactionId) as unknown[];
    for (const [index, value] of [[2, "bob"], [4, "foreign-uid"], [5, f.epoch + 1]] as const) {
      const changed = [...tuple]; changed[index] = value;
      expect(() => f.spell.verifiedCostSource({ ...f.request,
        transactionId: JSON.stringify(changed) })).toThrow();
    }
    expect(() => f.spell.verifiedCostSource({ ...f.request, subjectId: "unl-176-219" })).toThrow();
  });

  it("binds the six-part Spell transaction and independent printed cost proofs", async () => {
    const f = await costFixture();
    const resolved = resolveDuelTotalCostV2(f.spell.coreServices.cost, f.request);
    const request = { matchId: f.main.matchId, stateVersion: f.main.stateVersion,
      actor: "alice", uid: f.uid, cardId: f.request.subjectId, sourceEpoch: f.epoch,
      transactionId: f.request.transactionId, baseProofId: resolved.baseProofId,
      coverageProofId: resolved.coverageProofId };
    expect(f.spell.coreServices.costBinding(request).status).toBe("complete");
    const source = createDuelProductionSourceServicesV2({ catalog: f.catalog,
      programs: f.programs, matchId: f.main.matchId, currentHead: f.head,
      globalJournal: f.journal,
      verifySpellCostBinding: bound => f.spell.coreServices.costBinding(bound).status === "complete" });
    expect(source.spellCostBinding(request).status).toBe("complete");
    expect(source.spellCostBinding({ ...request, sourceEpoch: f.epoch + 1 }).status).toBe("unknown");
    expect(source.spellCostBinding({ ...request, baseProofId: "forged" }).status).toBe("unknown");
    expect(source.spellCostBinding({ ...request, actor: "bob" }).status).toBe("unknown");
  });
});
