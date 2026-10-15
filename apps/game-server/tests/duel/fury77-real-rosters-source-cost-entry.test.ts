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
import { loadCardCatalogRuntime, validateCatalogDeck } from "../../src/card-catalog.js";
import { buildDuelSetupSeats } from "../../src/duel/setup-seats.js";
import { createCatalogCardTypeResolverV2 } from "../../src/duel/catalog-card-type-v2.js";
import { fury77RealDecks } from "./fixtures/fury77-real-decks.js";
import { createDuelFuryOptionalRosterCardProgramAuthorityV1, getCardProgramRegistryForRuntime } from
  "../../src/duel/card-program-authority.js";
import { createDuelNativeOperationJournalV2 } from "../../src/duel/operation-journal-v2.js";
import { createP4PureAccelerateEntryBoundaryV1 } from
  "../../src/duel/optional-unit-entry-boundary-v1.js";
import { createOptionalUnitNativeSourceP6 } from
  "../../src/duel/optional-unit-native-source-p6.js";
import { createP4OptionalUnitServices, createDuelOptionalUnitProgramReader } from
  "../../src/duel/optional-unit-services-p4.js";

const runtime = await loadCardCatalogRuntime();
const catalog = runtime.publicCatalog;
const targetIds = ["ogn-001-298", "ogn-010-298"] as const;
const viId = "ogn-036-298";
const deflectId = "ogn-013-298";

async function scene(targetId: string, deckName: "a" | "b" = "a") {
  const programs = createDuelFuryOptionalRosterCardProgramAuthorityV1(runtime);
  let current: DuelCanonicalPlayingStateV2 | ReturnType<typeof createDuelMatchV2>;
  for (const deck of Object.values(fury77RealDecks)) {
    const validation = validateCatalogDeck(runtime, deck);
    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);
  }
  let uid = 0;
  const setup = buildDuelSetupSeats(runtime, {
    matchId: `fury77-real-rosters-${deckName}-${targetId}`,
    seats: [{ playerId: "alice", displayName: "alice", deck: fury77RealDecks[deckName] },
      { playerId: "bob", displayName: "bob", deck: fury77RealDecks[deckName] }],
  }, () => `fury77-real-${++uid}`);
  if (!setup.ok) throw new TypeError(`actual setup failed: ${setup.code}`);
  const types = createCatalogCardTypeResolverV2(runtime);
  const genesis = createDuelMatchV2(setup.seats, setup.metadata, () => 0, types.forMatch(setup.metadata));
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

const cases = ["a", "b"].flatMap(deckName => targetIds.map(targetId => ({ deckName: deckName as "a" | "b", targetId })));

// This test proves current source/cost/entry callbacks, not public turn execution.
describe("validated full56 factory77 source, cost, and entry composition", () => {
  it.each(cases)("admits $deckName/$targetId with all108 physical sources", async ({ targetId, deckName }) => {
    const f = await scene(targetId, deckName);
    expect(f.candidates).toHaveLength(108);
    expect(f.programs.census).toMatchObject({ catalogPrintings: 1381, resolvedPrograms: 77 });
    const registry = getCardProgramRegistryForRuntime(f.programs);
    expect(registry.sourceProgramPhaseScope(viId, "main").globalClosureStatus).toBe("unverified");
    expect(registry.sourceProgramPhaseScope(deflectId, "main").globalClosureStatus).toBe("unverified");
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

  it.each(cases)("adds only the selected Accelerate cost for $deckName/$targetId", async ({ targetId, deckName }) => {
    const f = await scene(targetId, deckName);
    expect(f.candidates).toHaveLength(108);
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
      const v3Transaction = ["optional-unit-v3", f.head.matchId, f.head.stateVersion,
        "alice", `fury77-${choice}`, f.target.uid, f.request.sourceEpoch, choice];
      const v3Request = { ...request, transactionId: JSON.stringify(v3Transaction) };
      const v3Resolved = resolveDuelTotalCostV2(services.cost(v3Request), {
        transactionId: v3Request.transactionId, subjectId: f.target.cardId, kind: "card-play",
      });
      expect(v3Resolved.finalResolvedCost).toEqual(resolved.finalResolvedCost);
      expect(v3Resolved.applications).toEqual(resolved.applications);
      for (const [index, foreign] of [[1, "foreign-match"], [2, f.head.stateVersion + 1],
        [3, "bob"], [4, "foreign-choice"], [5, "foreign-uid"],
        [6, f.request.sourceEpoch + 1], [7, choice === "pay" ? "decline" : "pay"]] as const) {
        const forged = [...v3Transaction];
        forged[index] = foreign;
        expect(() => services.cost({ ...request, transactionId: JSON.stringify(forged) })).toThrow();
      }
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
