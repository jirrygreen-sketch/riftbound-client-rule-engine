import { describe, expect, it } from "vitest";
import {
  commitDuelPlayingMutationV2, createDuelMatchV2,
  createDuelOptionalPlayChoiceAuthorityV1, enumerateDuelPhaseSourceClosureCandidatesV2,
  resolveDuelMulliganV2, resolveDuelTotalCostV2,
  type DuelCanonicalPlayingStateV2,
} from "@riftbound/engine-core/duel";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { createDuelAccelerateCardProgramAuthorityV1 } from "../../src/duel/card-program-authority.js";
import { createP4OptionalUnitServices } from "../../src/duel/optional-unit-services-p4.js";
import { createDuelNativeOperationJournalV2 } from "../../src/duel/operation-journal-v2.js";
import type { DuelNativeCostCensusV2 } from "../../src/duel/operation-journal-v2.js";
import { setupAdapterFixtureCatalog } from "./fixtures/setup-adapter-catalog.js";

const targetIds = ["ogn-001-298", "ogn-010-298"] as const;
const stamp = { dataVersion: "2026-10-12-official-gallery",
  digest: "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10" };
const rawCards = setupAdapterFixtureCatalog.cards.filter(card => [
  ...targetIds, "ogn-002-298", "ogn-214-298", "unl-176-219", "unl-187-219",
  "ogn-275-298", "ogn-277-298", "ogn-278-298",
].includes(card.id));
const cards = rawCards.map(card => card.id === "ogn-002-298" || card.id === "unl-176-219"
  ? { ...card, ability: "" }
  : card.id === "ogn-277-298"
    ? { ...card, ability: "When you hold here, draw 1." }
    : card);
const catalogData = { schemaVersion: 1, ...stamp, policy: {}, cards };

function typeOf(id: string) {
  if (id === "unl-176-219") return "Champion" as const;
  if (id === "unl-187-219") return "Legend" as const;
  if (id === "ogn-214-298") return "Rune" as const;
  if (id.startsWith("ogn-27")) return "Battlefield" as const;
  return "Unit" as const;
}

async function scene() {
  const catalog = await loadCardCatalogRuntime({ catalog: catalogData });
  const programs = createDuelAccelerateCardProgramAuthorityV1(catalog);
  const seats = ["alice", "bob"].map(playerId => ({ playerId,
    mainDeck: Array.from({ length: 8 }, (_, i) => ({ uid: `${playerId}-main-${i}`,
      cardId: playerId === "alice" ? targetIds[i % targetIds.length] : "ogn-002-298" })),
    champion: { uid: `${playerId}-champion`, cardId: "unl-176-219" },
    legend: { uid: `${playerId}-legend`, cardId: "unl-187-219" },
    runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`,
      cardId: "ogn-214-298", domain: "Order" as const })),
    battlefields: ["ogn-275-298", "ogn-277-298", "ogn-278-298"].map((cardId, i) =>
      ({ instanceId: `${playerId}-field-${i}`, cardId })),
  }));
  const metadata = { matchId: "optional-cost-source-applicability-v1",
    dataVersion: stamp.dataVersion, catalogDigest: stamp.digest,
    roster: ["alice", "bob"].map(playerId => ({ playerId, displayName: playerId })) as
      [{ playerId: string; displayName: string }, { playerId: string; displayName: string }] };
  const genesis = createDuelMatchV2(seats, metadata, () => 0, typeOf);
  let current: DuelCanonicalPlayingStateV2 | typeof genesis = genesis;
  const journal = createDuelNativeOperationJournalV2({ genesis, currentHead: () => current, programs });
  current = resolveDuelMulliganV2(genesis, "alice", []);
  journal.observe({ ancestor: genesis, descendant: current,
    commits: [{ operationId: "mulligan-a", eventId: "mulligan-a", event: "mulligan" }] });
  const afterBob = resolveDuelMulliganV2(current, "bob", []);
  journal.observe({ ancestor: current, descendant: afterBob,
    commits: [{ operationId: "mulligan-b", eventId: "mulligan-b", event: "mulligan" }] });
  current = afterBob;
  const head = commitDuelPlayingMutationV2(current, draft => ({ match: { ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, state]) =>
      [uid, { ...state, readiness: "ready" }])),
    frame: { ...draft.frame, phase: "main", stateOpen: true,
      priorityPlayerId: "alice", turnPlayerId: "alice" } }, transitions: [] }));
  journal.observe({ ancestor: current, descendant: head,
    commits: [{ operationId: "main", eventId: "main", event: "main" }] });
  current = head;
  const target = head.players[0]!.hand.find(card => card.cardId === targetIds[0])!;
  let visibleCensus = journal.readCostCensus();
  if (!visibleCensus) throw new TypeError("expected complete factory67 cost census");
  const journalView = Object.freeze({ ...journal, readCostCensus: () => visibleCensus });
  const reader = createP4OptionalUnitServices({ catalog, programs, getOperationHead: () => current,
    currentJournal: () => journalView, inspectChoice: receipt => choice.inspectReceipt(receipt) });
  const source = reader.readSource(head, "alice", target.uid);
  const bound = reader.program({ match: head, matchId: head.matchId, dataVersion: head.dataVersion,
    catalogDigest: head.catalogDigest, actor: "alice", uid: target.uid, cardId: target.cardId,
    sourceEpoch: source.sourceEpoch });
  const choice = createDuelOptionalPlayChoiceAuthorityV1({ readHead: () => current,
    readSource: reader.readSource, nextOpaqueId: (() => { let index = 0; return () => `choice-${++index}`; })() });
  const prompt = choice.issue({ actor: "alice", commandId: "play-1", expectedVersion: head.stateVersion,
    uid: target.uid });
  const receipt = choice.answer({ actor: "alice", commandId: "play-1", expectedVersion: head.stateVersion,
    choiceId: prompt.choiceId, optionId: prompt.payOptionId });
  const transaction = (decision: "pay" | "decline") => JSON.stringify([
    head.matchId, head.stateVersion, "alice", "play-1", target.uid, source.sourceEpoch,
    "play-1", decision,
  ]);
  const request = (decision: "pay" | "decline") => ({ transactionId: transaction(decision),
    cardId: target.cardId, actor: "alice", uid: target.uid, sourceEpoch: source.sourceEpoch,
    choice: decision, description: bound.description, receipt: { ...source, commandId: "play-1",
      stateVersion: head.stateVersion, decision } } as const);
  return { catalog, programs, head, current: () => current, target, source, bound, reader,
    choice, receipt, request, transaction, census: visibleCensus, journal: journalView,
    setCensus: (next: DuelNativeCostCensusV2) => {
      visibleCensus = next;
    },
  };
}

describe("P4 CardPlay-COST source applicability for factory67", () => {
  it("accepts pay and decline while counting only the subject's chosen modifier", async () => {
    const f = await scene();
    expect(f.programs.census.resolvedPrograms).toBeGreaterThanOrEqual(2);
    expect(f.programs.resolvedProgramReference(targetIds[0])).toBeDefined();
    const paid = resolveDuelTotalCostV2(f.reader.cost(f.request("pay")), {
      transactionId: f.transaction("pay"), subjectId: f.target.cardId, kind: "card-play",
    });
    expect(paid.finalResolvedCost.energy).toBe(f.bound.description.printedBaseCost.energy! + 1);
    expect(paid.finalResolvedCost.power).toEqual([{ allowedDomains: ["Fury"], amount: 1 }]);
    const declined = resolveDuelTotalCostV2(f.reader.cost(f.request("decline")), {
      transactionId: f.transaction("decline"), subjectId: f.target.cardId, kind: "card-play",
    });
    expect(declined.finalResolvedCost).toEqual({ energy: f.bound.description.printedBaseCost.energy!, power: [] });
  });

  it("does not double count another same or different pure Accelerate source", async () => {
    const f = await scene();
    const otherObjects = enumerateDuelPhaseSourceClosureCandidatesV2(f.head)
      .filter(item => item.cardId === targetIds[0] || item.cardId === targetIds[1]);
    expect(otherObjects.length).toBeGreaterThan(1);
    const handAccelerates = otherObjects.filter(item => item.zone.kind === "hand");
    expect(handAccelerates.length).toBeGreaterThan(2);
    expect(new Set(handAccelerates.map(item => item.cardId))).toEqual(new Set(targetIds));
    const paid = resolveDuelTotalCostV2(f.reader.cost(f.request("pay")), {
      transactionId: f.transaction("pay"), subjectId: f.target.cardId, kind: "card-play",
    });
    expect(paid.applications).toHaveLength(1);
    expect(paid.finalResolvedCost.energy).toBe(f.bound.description.printedBaseCost.energy! + 1);
  });

  it("fails closed for unknown, missing, duplicate, stale epoch, and changed state census", async () => {
    const f = await scene();
    const source = f.census.sources;
    const checks: readonly DuelNativeCostCensusV2[] = [
      { ...f.census, sources: source.filter(item => item.uid !== f.target.uid) },
      { ...f.census, sources: [...source, source[0]!] },
      { ...f.census, sources: source.map(item => item.uid === f.target.uid
        ? { ...item, sourceEpoch: item.sourceEpoch! + 1 } : item) },
      { ...f.census, sources: source.map((item, index) => index === 0
        ? { ...item, programReference: "unknown-program" } : item) },
      { ...f.census, stateVersion: f.head.stateVersion + 1 },
    ];
    for (const census of checks) {
      f.setCensus(census);
      expect(() => f.reader.cost(f.request("pay"))).toThrow();
    }
  });
});
