import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  commitDuelPlayingMutationV2,
  createDuelMatchV2,
  createDuelOptionalPlayChoiceAuthorityV1,
  enumerateDuelPhaseSourceClosureCandidatesV2,
  resolveDuelMulliganV2,
  resolveDuelTotalCostV2,
  type DuelCanonicalPlayingStateV2,
  type DuelOptionalPlayReceiptV1,
  type DuelUnitEntryRequestV2,
} from "@riftbound/engine-core/duel";
import type { PublicCardCatalog, CardCatalogRuntime } from "../../src/card-catalog.js";
import { createDuelFuryOptionalRosterCardProgramAuthorityV1, getCardProgramRegistryForRuntime } from
  "../../src/duel/card-program-authority.js";
import { createDuelNativeOperationJournalV2 } from "../../src/duel/operation-journal-v2.js";
import { createP4PureAccelerateEntryBoundaryV1 } from
  "../../src/duel/optional-unit-entry-boundary-v1.js";
import { createOptionalUnitNativeSourceP6 } from
  "../../src/duel/optional-unit-native-source-p6.js";
import { createP4OptionalUnitServices, createDuelOptionalUnitProgramReader } from
  "../../src/duel/optional-unit-services-p4.js";

const catalogPath = new URL("../../../../packages/card-data/data/deck-catalog.json", import.meta.url);
const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as PublicCardCatalog;
const runtime = { publicCatalog: catalog } as unknown as CardCatalogRuntime;
const targetIds = ["ogn-001-298", "ogn-010-298"] as const;
const viId = "ogn-036-298";
const deflectId = "ogn-013-298";

function cardType(cardId: string) {
  if (cardId === viId) return "Champion" as const;
  if (cardId === "unl-187-219") return "Legend" as const;
  if (cardId === "ogn-214-298") return "Rune" as const;
  if (cardId === "ogn-275-298" || cardId === "ogn-278-298" || cardId === "ogn-280-298") {
    return "Battlefield" as const;
  }
  return "Unit" as const;
}

function seats(targetId: string) {
  return ["alice", "bob"].map(playerId => ({
    playerId,
    // randomIndex=0 keeps these first four cards in the opening hand. The
    // physical source IDs remain distinct and are never hand-constructed.
    mainDeck: [targetId, viId, deflectId, targetId, targetId, viId, deflectId, targetId]
      .map((cardId, i) => ({ uid: `${playerId}-main-${i}`, cardId })),
    champion: { uid: `${playerId}-champion`, cardId: viId },
    legend: { uid: `${playerId}-legend`, cardId: "unl-187-219" },
    runeDeck: Array.from({ length: 6 }, (_, i) => ({
      uid: `${playerId}-rune-${i}`, cardId: "ogn-214-298", domain: "Order" as const,
    })),
    battlefields: ["ogn-275-298", "ogn-278-298", "ogn-280-298"].map((cardId, i) => ({
      instanceId: `${playerId}-field-${i}`, cardId,
    })),
  }));
}

async function scene(targetId: string) {
  const programs = createDuelFuryOptionalRosterCardProgramAuthorityV1(runtime);
  let current: DuelCanonicalPlayingStateV2 | ReturnType<typeof createDuelMatchV2>;
  const metadata = {
    matchId: `fury77-source-cost-entry-${targetId}`,
    dataVersion: catalog.dataVersion,
    catalogDigest: catalog.digest,
    roster: ["alice", "bob"].map(playerId => ({ playerId, displayName: playerId })) as
      [{ playerId: string; displayName: string }, { playerId: string; displayName: string }],
  };
  const genesis = createDuelMatchV2(seats(targetId), metadata, () => 0, cardType);
  current = genesis;
  const journal = createDuelNativeOperationJournalV2({ genesis, currentHead: () => current, programs });
  const afterAlice = resolveDuelMulliganV2(genesis, "alice", []);
  current = afterAlice;
  journal.observe({ ancestor: genesis, descendant: afterAlice,
    commits: [{ operationId: "fury77-mulligan-a", eventId: "fury77-mulligan-a", event: "mulligan" }] });
  const afterBob = resolveDuelMulliganV2(afterAlice, "bob", []);
  current = afterBob;
  journal.observe({ ancestor: afterAlice, descendant: afterBob,
    commits: [{ operationId: "fury77-mulligan-b", eventId: "fury77-mulligan-b", event: "mulligan" }] });
  const head = commitDuelPlayingMutationV2(afterBob, draft => ({
    match: { ...draft,
      legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, state]) =>
        [uid, { ...state, readiness: "ready" }])),
      frame: { ...draft.frame, phase: "main", stateOpen: true,
        priorityPlayerId: "alice", turnPlayerId: "alice" } },
    transitions: [],
  }));
  current = head;
  journal.observe({ ancestor: afterBob, descendant: head,
    commits: [{ operationId: "fury77-main", eventId: "fury77-main", event: "main" }] });
  if (head.stage !== "playing") throw new TypeError("factory77 scene did not enter playing");
  const target = head.players[0].hand.find(card => card.cardId === targetId);
  if (!target) throw new TypeError(`target ${targetId} was not dealt`);
  const reader = createDuelOptionalUnitProgramReader({ catalog: runtime, programs });
  const source = reader.readSource(head, "alice", target.uid);
  const request: DuelUnitEntryRequestV2 = {
    match: head, matchId: head.matchId, stateVersion: head.stateVersion, eventSeq: head.eventSeq,
    actor: "alice", uid: target.uid, cardId: target.cardId, sourceEpoch: source.sourceEpoch,
    baseLocationId: head.board.bases.find(base => base.ownerPlayerId === "alice")!.locationId,
    programId: source.sourceProgramFingerprint,
  };
  const makeChoice = (commandId: string, option: "pay" | "decline") => {
    const authority = createDuelOptionalPlayChoiceAuthorityV1({ readHead: () => current,
      readSource: reader.readSource, nextOpaqueId: (() => { let i = 0; return () => `fury77-choice-${++i}`; })() });
    const prompt = authority.issue({ actor: "alice", commandId, expectedVersion: head.stateVersion, uid: target.uid });
    const receipt = authority.answer({ actor: "alice", commandId, expectedVersion: head.stateVersion,
      choiceId: prompt.choiceId, optionId: option === "pay" ? prompt.payOptionId : prompt.declineOptionId });
    return { authority, receipt };
  };
  const pay = makeChoice("fury77-pay", "pay");
  const decline = makeChoice("fury77-decline", "decline");
  const inspectChoice = (receipt: DuelOptionalPlayReceiptV1) => {
    try { return pay.authority.inspectReceipt(receipt); } catch {
      return decline.authority.inspectReceipt(receipt);
    }
  };
  const boundary = createP4PureAccelerateEntryBoundaryV1({ catalog: runtime, programs,
    currentHead: () => current as DuelCanonicalPlayingStateV2 });
  const native = createOptionalUnitNativeSourceP6({ catalog: runtime, programs,
    currentHead: () => current as DuelCanonicalPlayingStateV2,
    currentJournal: () => journal, inspectChoice, verifyEntryBoundary: boundary });
  const entryFor = (receipt: DuelOptionalPlayReceiptV1) => native.entryForReceipt(receipt)(request);
  const description = reader.describe({ match: head, matchId: head.matchId,
    dataVersion: head.dataVersion, catalogDigest: head.catalogDigest,
    actor: "alice", uid: target.uid, cardId: target.cardId, sourceEpoch: source.sourceEpoch }).description;
  return { programs, head, target, request, reader, journal, native, boundary, pay, decline, entryFor, description,
    candidates: enumerateDuelPhaseSourceClosureCandidatesV2(head), census: journal.readCostCensus() };
}

describe("factory77 source, cost, and entry composition", () => {
  it.each(targetIds)("admits %s with Vi and Deflect whole IR sources", async targetId => {
    const f = await scene(targetId);
    expect(f.programs.census).toMatchObject({ catalogPrintings: 1381, resolvedPrograms: 77 });
    const registry = getCardProgramRegistryForRuntime(f.programs);
    for (const sourceId of [viId, deflectId]) {
      const scope = registry.sourceProgramPhaseScope(sourceId, "main");
      expect(scope.scope).toBe("source-program");
      expect(scope.sourceProgramComplete).toBe(true);
      expect(scope.globalClosureStatus).toBe("unverified");
    }
    const inspection = f.native.inspect(f.request);
    expect(inspection.status).toBe("complete");
    const sourceCards = inspection.candidates.map(candidate => candidate.cardId);
    expect(sourceCards).toContain(viId);
    expect(sourceCards).toContain(deflectId);
    expect(f.entryFor(f.pay.receipt).sourceCensus).toBe("complete");
    expect(f.entryFor(f.decline.receipt).sourceCensus).toBe("complete");
    expect(f.entryFor(f.pay.receipt).scopes).toEqual({ play: "clear", replacement: "clear",
      static: "clear", trigger: "clear", pendingTasks: "clear", chain: "clear" });
  });

  it.each(targetIds)("adds only the selected Accelerate modifier for %s", async targetId => {
    const f = await scene(targetId);
    const transaction = (choice: "pay" | "decline") => JSON.stringify([
      f.head.matchId, f.head.stateVersion, "alice", `fury77-${choice}`, f.target.uid,
      f.request.sourceEpoch, `fury77-${choice}`, choice,
    ]);
    const servicesFor = (choice: "pay" | "decline") => {
      const receipt = choice === "pay" ? f.pay.receipt : f.decline.receipt;
      const authority = choice === "pay" ? f.pay.authority : f.decline.authority;
      const services = createP4OptionalUnitServices({ catalog: runtime, programs: f.programs,
        getOperationHead: () => f.head, currentJournal: () => f.journal,
        inspectChoice: value => authority.inspectReceipt(value),
        entry: f.native.entryForReceipt(receipt) });
      return { services, request: {
        transactionId: transaction(choice), cardId: f.target.cardId, actor: "alice", uid: f.target.uid,
        sourceEpoch: f.request.sourceEpoch, choice, description: f.description,
        receipt: authority.inspectReceipt(receipt),
      } };
    };
    for (const choice of ["pay", "decline"] as const) {
      const { services, request } = servicesFor(choice);
      const resolved = resolveDuelTotalCostV2(services.cost(request), {
        transactionId: request.transactionId, subjectId: f.target.cardId, kind: "card-play",
      });
      expect(resolved.applications).toHaveLength(choice === "pay" ? 1 : 0);
      expect(resolved.finalResolvedCost.energy).toBe(f.description.printedBaseCost.energy! +
        (choice === "pay" ? 1 : 0));
      expect(resolved.finalResolvedCost.power).toEqual(choice === "pay"
        ? [{ allowedDomains: ["Fury"], amount: 1 }] : []);
    }
  });

  it("keeps malformed source carriers blocked", async () => {
    const f = await scene(targetIds[0]);
    const registry = getCardProgramRegistryForRuntime(f.programs);
    const vi = registry.getProgram(viId);
    const deflect = registry.getProgram(deflectId);
    expect(vi?.semantics).toMatchObject({ kind: "compound-vi-self" });
    expect(deflect?.semantics).toMatchObject({ kind: "deflect" });
    const viIndex = f.candidates.findIndex(candidate => candidate.cardId === viId);
    const malformed = { ...f.candidates[viIndex]!, futureOpcode: true };
    const candidates = f.candidates.map((candidate, index) => index === viIndex ? malformed : candidate);
    expect(f.boundary(f.request, candidates, f.census!)).toBeNull();
    expect(f.entryFor(f.pay.receipt).sources.every(source => source.disposition === "known-no-effect"))
      .toBe(true);
  });
});
