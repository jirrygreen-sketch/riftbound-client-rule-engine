import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  commitDuelPlayingMutationV2, createDuelMatchV2,
  createDuelOptionalPlayChoiceAuthorityV1,
  enumerateDuelPhaseSourceClosureCandidatesV2, resolveDuelMulliganV2,
  resolveDuelTotalCostV2,
  type DuelCanonicalPlayingStateV2, type DuelOptionalPlayReceiptV1,
  type DuelUnitEntryRequestV2,
} from "@riftbound/engine-core/duel";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { createCardProgramAuthority } from "../../src/duel/card-program-authority.js";
import { createDuelOptionalUnitProgramReader, createP4OptionalUnitServices } from
  "../../src/duel/optional-unit-services-p4.js";
import { createOptionalUnitNativeSourceP6 } from "../../src/duel/optional-unit-native-source-p6.js";
import { createDuelNativeOperationJournalV2 } from "../../src/duel/operation-journal-v2.js";
import type { DuelNativeCostCensusV2 } from "../../src/duel/operation-journal-v2.js";
import { setupAdapterFixtureCatalog } from "./fixtures/setup-adapter-catalog.js";

const stamp = { dataVersion: "2026-10-12-official-gallery",
  digest: "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10" };
const targetIds = ["ogn-001-298", "ogn-010-298"];
const otherIds = ["ogn-002-298", "ogn-214-298", "unl-176-219", "unl-187-219",
  "ogn-275-298", "ogn-277-298", "ogn-278-298"];
const cards = setupAdapterFixtureCatalog.cards.filter(card =>
  [...targetIds, ...otherIds].includes(card.id));
const catalogData = { schemaVersion: 1, ...stamp, policy: {}, cards: cards.map(card => ({
  ...card, ability: card.id === "ogn-002-298" || card.id === "unl-176-219" ? "" :
    card.id === "unl-187-219"
      ? ":rb_energy_1:, :rb_exhaust:: Play a 1 :rb_might: Recruit unit token."
      : card.cardType === "Battlefield" ? "When you hold here, draw 1." : card.ability,
})) };

async function scene(targetId = targetIds[0]!, data = catalogData) {
  const catalog = await loadCardCatalogRuntime({ catalog: data });
  const programs = createCardProgramAuthority(catalog);
  const seats = ["alice", "bob"].map(playerId => ({ playerId,
    mainDeck: Array.from({ length: 8 }, (_, i) => ({ uid: `${playerId}-main-${i}`,
      cardId: playerId === "alice" && i === 1 ? targetId : "ogn-002-298" })),
    champion: { uid: `${playerId}-champion`, cardId: "unl-176-219" },
    legend: { uid: `${playerId}-legend`, cardId: "unl-187-219" },
    runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`,
      cardId: "ogn-214-298", domain: "Order" as const })),
    battlefields: ["ogn-275-298", "ogn-277-298", "ogn-278-298"].map((cardId, i) =>
      ({ instanceId: `${playerId}-field-${i}`, cardId })),
  }));
  const metadata = { matchId: `optional-p6-fixture-${targetId}`,
    dataVersion: stamp.dataVersion, catalogDigest: stamp.digest,
    roster: ["alice", "bob"].map(playerId => ({ playerId, displayName: playerId })) as
      [{ playerId: string; displayName: string }, { playerId: string; displayName: string }] };
  const typeOf = (id: string) => id === "unl-176-219" ? "Champion" as const :
    id === "unl-187-219" ? "Legend" as const :
    id === "ogn-214-298" ? "Rune" as const : id.startsWith("ogn-27") ? "Battlefield" as const :
      "Unit" as const;
  const genesis = createDuelMatchV2(seats, metadata, () => 0, typeOf);
  let current: DuelCanonicalPlayingStateV2 | typeof genesis = genesis;
  const journal = createDuelNativeOperationJournalV2({ genesis, currentHead: () => current, programs });
  const first = resolveDuelMulliganV2(genesis, "alice", []);
  current = first;
  journal.observe({ ancestor: genesis, descendant: first,
    commits: [{ operationId: "p6-mulligan-a", eventId: "p6-mulligan-a", event: "mulligan" }] });
  const match = resolveDuelMulliganV2(first, "bob", []);
  current = match;
  journal.observe({ ancestor: first, descendant: match,
    commits: [{ operationId: "p6-mulligan-b", eventId: "p6-mulligan-b", event: "mulligan" }] });
  if (match.stage !== "playing") throw new TypeError("fixture did not enter playing");
  const head = commitDuelPlayingMutationV2(match, draft => ({ match: { ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, state]) =>
      [uid, { ...state, readiness: "ready" }])),
    frame: { ...draft.frame, phase: "main", stateOpen: true,
      priorityPlayerId: "alice", turnPlayerId: "alice" } }, transitions: [] }));
  current = head;
  journal.observe({ ancestor: match, descendant: head,
    commits: [{ operationId: "p6-main", eventId: "p6-main", event: "main" }] });
  const target = head.players[0].hand.find(card => card.cardId === targetId)!;
  if (!target) throw new TypeError("fixture target not drawn");
  const reader = createDuelOptionalUnitProgramReader({ catalog, programs });
  const source = reader.readSource(head, "alice", target.uid);
  const request: DuelUnitEntryRequestV2 = { match: head, matchId: head.matchId,
    stateVersion: head.stateVersion, eventSeq: head.eventSeq, actor: "alice", uid: target.uid,
    cardId: target.cardId, sourceEpoch: source.sourceEpoch,
    baseLocationId: head.board.bases.find(base => base.ownerPlayerId === "alice")!.locationId,
    programId: source.sourceProgramFingerprint };
  const candidates = enumerateDuelPhaseSourceClosureCandidatesV2(head);
  const originalCensus = journal.readCostCensus();
  if (!originalCensus) throw new TypeError("fixture journal did not publish a cost census");
  let census: DuelNativeCostCensusV2 = originalCensus;
  let journalView: unknown = journal;
  let reenterCurrentJournal: (() => void) | null = null;
  let boundary = true;
  let sourceFacts = (actual: typeof candidates) => actual.map(candidate => ({ candidate,
    programId: candidate.uid === target.uid ? request.programId :
      programs.resolvedProgramReference(candidate.cardId!)?.programId ?? "unknown",
    disposition: "known-no-effect" as const }));
  const native = createOptionalUnitNativeSourceP6({ catalog, programs,
    currentHead: () => current as DuelCanonicalPlayingStateV2,
    currentJournal: () => {
      const value = journalView;
      reenterCurrentJournal?.();
      reenterCurrentJournal = null;
      return value as never;
    },
    inspectChoice: receipt => choice.inspectReceipt(receipt),
    verifyEntryBoundary: (entry, actual) => boundary ? {
      matchId: entry.matchId, stateVersion: entry.stateVersion, eventSeq: entry.eventSeq,
      actor: entry.actor, uid: entry.uid, cardId: entry.cardId,
      sourceEpoch: entry.sourceEpoch, baseLocationId: entry.baseLocationId,
      programId: entry.programId, sources: sourceFacts(actual),
      scopes: { play: "clear", replacement: "clear", static: "clear", trigger: "clear",
        pendingTasks: "clear", chain: "clear" },
    } : null });
  const choice = createDuelOptionalPlayChoiceAuthorityV1({ readHead: () => current,
    readSource: reader.readSource, nextOpaqueId: (() => { let i = 0; return () => `choice-${++i}`; })() });
  const prompt = choice.issue({ actor: "alice", commandId: "play-1",
    expectedVersion: head.stateVersion, uid: target.uid });
  const receipt = choice.answer({ actor: "alice", commandId: "play-1",
    expectedVersion: head.stateVersion, choiceId: prompt.choiceId, optionId: prompt.payOptionId });
  return { catalog, programs, head, target, request, native, receipt, choice, originalCensus,
    setCensus: (next: DuelNativeCostCensusV2) => {
      census = next;
      journalView = Object.freeze({
        readCostCensus: () => census,
        revision: journal.revision,
        currentHead: journal.currentHead,
        observedHead: journal.observedHead,
        listCommits: journal.listCommits,
      });
    },
    journal,
    armJournalReentry: (next: unknown) => {
      reenterCurrentJournal = () => { journalView = next; };
    },
    setHead: (next: DuelCanonicalPlayingStateV2) => { current = next; },
    readHead: () => current,
    setBoundary: (next: boolean) => { boundary = next; },
    setSourceFacts: (next: typeof sourceFacts) => { sourceFacts = next; } };
}

describe("optional Unit P6 native source gate", () => {
  it("closes only a self-consistent fixture with a bound pay receipt and supplied whole-entry proof", async () => {
    const f = await scene();
    expect(f.native.inspect(f.request).status).toBe("complete");
    expect(f.native.verifiedCostCensus(f.request)?.sources).toHaveLength(f.originalCensus.sources.length);
    const entry = f.native.entryForReceipt(f.receipt)(f.request);
    expect(entry.sourceCensus).toBe("complete");
    expect(entry.sources).toHaveLength(f.originalCensus.sources.length);
    expect(entry.scopes).toEqual({ play: "clear", replacement: "clear", static: "clear",
      trigger: "clear", pendingTasks: "clear", chain: "clear" });
    f.setBoundary(false);
    expect(f.native.entryForReceipt(f.receipt)(f.request).sourceCensus).toBe("unknown");
  });

  it("feeds a fixture verified census and receipt entry into the existing P4 cost service", async () => {
    const f = await scene();
    const helper = createP4OptionalUnitServices({ catalog: f.catalog, programs: f.programs,
      getOperationHead: () => f.head,
      currentJournal: () => ({ readCostCensus: () => f.native.verifiedCostCensus(f.request) }) as never,
      inspectChoice: receipt => f.choice.inspectReceipt(receipt),
      entry: f.native.entryForReceipt(f.receipt) });
    const description = helper.program({ match: f.head, matchId: f.request.matchId,
      dataVersion: f.head.dataVersion, catalogDigest: f.head.catalogDigest,
      actor: f.request.actor, uid: f.request.uid, cardId: f.request.cardId,
      sourceEpoch: f.request.sourceEpoch }).description;
    const receiptData = f.choice.inspectReceipt(f.receipt);
    const transactionId = JSON.stringify([f.head.matchId, f.head.stateVersion,
      "alice", "play-1", f.target.uid, f.request.sourceEpoch, "play-1", "pay"]);
    const resolved = resolveDuelTotalCostV2(helper.cost({ transactionId,
      cardId: f.target.cardId, actor: "alice", uid: f.target.uid,
      sourceEpoch: f.request.sourceEpoch, choice: "pay", description,
      receipt: receiptData }), { transactionId, subjectId: f.target.cardId,
      kind: "card-play" });
    expect(resolved.finalResolvedCost.energy).toBe(description.printedBaseCost.energy! + 1);
    expect(helper.costBinding({ matchId: f.head.matchId, stateVersion: f.head.stateVersion,
      actor: "alice", uid: f.target.uid, cardId: f.target.cardId,
      sourceEpoch: f.request.sourceEpoch, baseLocationId: f.request.baseLocationId,
      transactionId, baseProofId: resolved.baseProofId,
      coverageProofId: resolved.coverageProofId }).status).toBe("complete");
  });

  it("rejects forged journal and candidate revisions without changing the current Core head", async () => {
    const f = await scene();
    const before = f.readHead();
    const forgedRevision = 9999;
    f.setCensus({ ...f.originalCensus,
      journalRevision: forgedRevision, candidateSetRevision: 7777,
      sources: f.originalCensus.sources.map(source => ({ ...source, bindingRevision: 424242 })) });
    expect(f.native.inspect(f.request).status).toBe("unknown");
    expect(f.native.inspect(f.request).reason).toBe("native-census-unavailable");
    expect(f.native.verifiedCostCensus(f.request)).toBeNull();
    expect(f.native.entryForReceipt(f.receipt)(f.request).sourceCensus).toBe("unknown");
    expect(f.readHead()).toBe(before);
  });

  it("fails closed when the owner journal changes during the binding read", async () => {
    const f = await scene();
    const before = f.readHead();
    const foreignView = Object.freeze({
      readCostCensus: f.journal.readCostCensus,
      revision: f.journal.revision,
      currentHead: f.journal.currentHead,
      observedHead: f.journal.observedHead,
      listCommits: f.journal.listCommits,
    });
    f.armJournalReentry(foreignView);
    expect(f.native.inspect(f.request).status).toBe("unknown");
    expect(f.readHead()).toBe(before);
  });

  it("rejects cloned/stale match and any missing, extra, or altered Core candidate", async () => {
    const f = await scene();
    expect(f.native.inspect({ ...f.request, match: structuredClone(f.head) }).status).toBe("unknown");
    expect(f.native.inspect({ ...f.request, sourceEpoch: f.request.sourceEpoch + 1 }).status).toBe("unknown");
    const sources = f.originalCensus.sources;
    for (const changed of [sources.slice(1), [...sources, sources[0]!],
      sources.map((source, i) => i === 0 ? { ...source, sourceEpoch: source.sourceEpoch! + 1 } : source),
      sources.map((source, i) => i === 0 ? { ...source, ownerPlayerId: "bob" } : source),
      sources.map((source, i) => i === 0 ? { ...source, controllerPlayerId: "bob" } : source)]) {
      f.setCensus({ ...f.originalCensus, sources: changed });
      expect(f.native.inspect(f.request).status).toBe("unknown");
      expect(f.native.verifiedCostCensus(f.request)).toBeNull();
      expect(f.native.entryForReceipt(f.receipt)(f.request).sourceCensus).toBe("unknown");
    }
  });

  it("blocks pending native work, unknown programs and cloned or incomplete supplied source facts", async () => {
    const f = await scene();
    f.setCensus({ ...f.originalCensus, sources: [...f.originalCensus.sources,
      { ...f.originalCensus.sources[0]!, carrier: "source-work" as const, status: "pending" as const }] });
    expect(f.native.inspect(f.request).status).toBe("unknown");
    f.setCensus(f.originalCensus);
    f.setSourceFacts(actual => actual.map((candidate, i) => ({
      candidate: i === 0 ? structuredClone(candidate) : candidate,
      programId: candidate.uid === f.target.uid ? f.request.programId :
        f.programs.resolvedProgramReference(candidate.cardId!)?.programId ?? "unknown",
      disposition: "known-no-effect" as const })));
    expect(f.native.entryForReceipt(f.receipt)(f.request).sourceCensus).toBe("unknown");
    f.setSourceFacts(actual => actual.slice(1).map(candidate => ({ candidate,
      programId: candidate.uid === f.target.uid ? f.request.programId :
        f.programs.resolvedProgramReference(candidate.cardId!)?.programId ?? "unknown",
      disposition: "known-no-effect" as const })));
    expect(f.native.entryForReceipt(f.receipt)(f.request).sourceCensus).toBe("unknown");
    const unresolved = f.originalCensus.sources.map(source => source.uid === f.target.uid ? source :
      { ...source, programReference: null });
    f.setCensus({ ...f.originalCensus, sources: unresolved });
    expect(f.native.inspect(f.request).status).toBe("unknown");
  });

  it("requires the current process-local receipt for this exact target and epoch", async () => {
    const f = await scene();
    const cloned = structuredClone(f.receipt) as DuelOptionalPlayReceiptV1;
    expect(f.native.entryForReceipt(cloned)(f.request).sourceCensus).toBe("unknown");
    expect(f.native.entryForReceipt(f.receipt)({ ...f.request, actor: "bob" }).sourceCensus).toBe("unknown");
    expect(f.native.entryForReceipt(f.receipt)({ ...f.request,
      stateVersion: f.request.stateVersion + 1 }).sourceCensus).toBe("unknown");
    const closed = commitDuelPlayingMutationV2(f.head, draft => ({ match: { ...draft,
      frame: { ...draft.frame, stateOpen: false } }, transitions: [] }));
    f.setHead(closed);
    expect(f.native.inspect({ ...f.request, match: closed,
      stateVersion: closed.stateVersion, eventSeq: closed.eventSeq }).reason)
      .toBe("optional-play-phase-or-priority");
  });
});

const realCatalogPath = new URL("../../../../packages/card-data/data/deck-catalog.json", import.meta.url);
it.skipIf(!existsSync(realCatalogPath))("real catalog ogn-001/010 retain pure Accelerate but no native source closure", async () => {
  const real = JSON.parse(readFileSync(realCatalogPath, "utf8"));
  const target = real.cards.filter((card: { id: string }) => targetIds.includes(card.id));
  expect(target.map((card: { id: string }) => card.id).sort()).toEqual([...targetIds].sort());
  for (const card of target) {
    const f = await scene(card.id, { ...catalogData, cards: catalogData.cards.map(item =>
      item.id === card.id ? card : item) });
    expect(f.programs.resolvedProgramReference(card.id)).toBeUndefined();
    expect(f.native.inspect(f.request).status).toBe("complete");
    f.setCensus({ ...f.originalCensus, sources: f.originalCensus.sources.map(source =>
      source.uid === f.target.uid ? source : { ...source, programReference: null }) });
    expect(f.native.entryForReceipt(f.receipt)(f.request).sourceCensus).toBe("unknown");
  }
});
