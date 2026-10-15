import { describe, expect, it } from "vitest";
import {
  commitDuelPlayingMutationV2,
  createDuelMatchV2,
  createDuelOptionalPlayChoiceAuthorityV1,
  enumerateDuelPhaseSourceClosureCandidatesV2,
  resolveDuelMulliganV2,
  type DuelCanonicalPlayingStateV2,
  type DuelOptionalPlayReceiptV1,
  type DuelUnitEntryRequestV2,
} from "@riftbound/engine-core/duel";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { createDuelAccelerateCardProgramAuthorityV1 } from
  "../../src/duel/card-program-authority.js";
import { createDuelOptionalUnitProgramReader } from
  "../../src/duel/optional-unit-services-p4.js";
import { createP4PureAccelerateEntryBoundaryV1 } from
  "../../src/duel/optional-unit-entry-boundary-v1.js";
import { createOptionalUnitNativeSourceP6 } from
  "../../src/duel/optional-unit-native-source-p6.js";
import { createDuelNativeOperationJournalV2 } from
  "../../src/duel/operation-journal-v2.js";
import { setupAdapterFixtureCatalog } from "./fixtures/setup-adapter-catalog.js";

const stamp = { dataVersion: "2026-10-12-official-gallery",
  digest: "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10" };
const targetId = "ogn-001-298";
const sourceIds = [targetId, "ogn-002-298", "ogn-214-298", "unl-176-219", "unl-187-219",
  "ogn-275-298", "ogn-277-298", "ogn-278-298"];

const catalogData = { schemaVersion: 1, ...stamp, policy: {},
  cards: setupAdapterFixtureCatalog.cards.filter(card => sourceIds.includes(card.id)).map(card => ({
    ...card,
    ...(card.id === "ogn-002-298" || card.id === "unl-176-219" ? { ability: "" } : {}),
    ...(card.id === "unl-187-219"
      ? { ability: "When you conquer, if you assigned 3 or more excess damage, you may exhaust me to ready a unit." }
      : {}),
    ...(card.cardType === "Battlefield" ? { ability: "When you hold here, play a 1 :rb_might: Recruit unit token in your base." } : {}),
  })) };

async function fixture() {
  const catalog = await loadCardCatalogRuntime({ catalog: catalogData });
  const programs = createDuelAccelerateCardProgramAuthorityV1(catalog);
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
  const metadata = { matchId: "optional-entry-current-source-applicability-v1",
    dataVersion: stamp.dataVersion, catalogDigest: stamp.digest,
    roster: ["alice", "bob"].map(playerId => ({ playerId, displayName: playerId })) as
      [{ playerId: string; displayName: string }, { playerId: string; displayName: string }] };
  const typeOf = (id: string) => id === "unl-176-219" ? "Champion" as const :
    id === "unl-187-219" ? "Legend" as const : id === "ogn-214-298" ? "Rune" as const :
      id.startsWith("ogn-27") ? "Battlefield" as const : "Unit" as const;
  const genesis = createDuelMatchV2(seats, metadata, () => 0, typeOf);
  let current: DuelCanonicalPlayingStateV2 | typeof genesis = genesis;
  const journal = createDuelNativeOperationJournalV2({ genesis, currentHead: () => current, programs });
  const first = resolveDuelMulliganV2(genesis, "alice", []);
  current = first;
  journal.observe({ ancestor: genesis, descendant: first,
    commits: [{ operationId: "app-a", eventId: "app-a", event: "mulligan" }] });
  const match = resolveDuelMulliganV2(first, "bob", []);
  current = match;
  journal.observe({ ancestor: first, descendant: match,
    commits: [{ operationId: "app-b", eventId: "app-b", event: "mulligan" }] });
  if (match.stage !== "playing") throw new TypeError("fixture did not enter playing");
  const head = commitDuelPlayingMutationV2(match, draft => ({ match: { ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, state]) =>
      [uid, { ...state, readiness: "ready" }])),
    frame: { ...draft.frame, phase: "main", stateOpen: true,
      priorityPlayerId: "alice", turnPlayerId: "alice" } }, transitions: [] }));
  current = head;
  journal.observe({ ancestor: match, descendant: head,
    commits: [{ operationId: "app-main", eventId: "app-main", event: "main" }] });
  const target = head.players[0].hand.find(card => card.cardId === targetId);
  if (!target) throw new TypeError("fixture target not drawn");
  const reader = createDuelOptionalUnitProgramReader({ catalog, programs });
  const source = reader.readSource(head, "alice", target.uid);
  const request: DuelUnitEntryRequestV2 = { match: head, matchId: head.matchId,
    stateVersion: head.stateVersion, eventSeq: head.eventSeq, actor: "alice", uid: target.uid,
    cardId: target.cardId, sourceEpoch: source.sourceEpoch,
    baseLocationId: head.board.bases.find(base => base.ownerPlayerId === "alice")!.locationId,
    programId: source.sourceProgramFingerprint };
  const makeChoice = () => createDuelOptionalPlayChoiceAuthorityV1({ readHead: () => current,
    readSource: reader.readSource, nextOpaqueId: (() => { let i = 0; return () => `choice-${i += 1}`; })() });
  const choicePay = makeChoice();
  const choiceDecline = makeChoice();
  const prompt = choicePay.issue({ actor: "alice", commandId: "app-play", expectedVersion: head.stateVersion,
    uid: target.uid });
  const pay = choicePay.answer({ actor: "alice", commandId: "app-play", expectedVersion: head.stateVersion,
    choiceId: prompt.choiceId, optionId: prompt.payOptionId });
  const declinePrompt = choiceDecline.issue({ actor: "alice", commandId: "app-decline",
    expectedVersion: head.stateVersion, uid: target.uid });
  const decline = choiceDecline.answer({ actor: "alice", commandId: "app-decline", expectedVersion: head.stateVersion,
    choiceId: declinePrompt.choiceId, optionId: declinePrompt.declineOptionId });
  const boundary = createP4PureAccelerateEntryBoundaryV1({ catalog, programs,
    currentHead: () => current as DuelCanonicalPlayingStateV2 });
  const native = createOptionalUnitNativeSourceP6({ catalog, programs,
    currentHead: () => current as DuelCanonicalPlayingStateV2,
    currentJournal: () => journal,
    inspectChoice: receipt => {
      try { return choicePay.inspectReceipt(receipt); }
      catch { return choiceDecline.inspectReceipt(receipt); }
    },
    verifyEntryBoundary: boundary });
  return { catalog, programs, head, request, target, candidates: enumerateDuelPhaseSourceClosureCandidatesV2(head),
    journal, native, pay, decline, choice: choicePay, setHead: (next: DuelCanonicalPlayingStateV2) => { current = next; } };
}

describe("optional entry current-source applicability V1", () => {
  it("proves a genuine factory67 target with complete source census and six clear scopes", async () => {
    const f = await fixture();
    const inspection = f.native.inspect(f.request);
    expect(inspection.status).toBe("complete");
    expect(inspection.census?.sources).toHaveLength(f.candidates.length);
    expect(inspection.census?.sources.find(source => source.uid === f.request.uid)?.programReference)
      .not.toBeNull();
    for (const receipt of [f.pay, f.decline]) {
      const entry = f.native.entryForReceipt(receipt)(f.request);
      expect(entry.sourceCensus).toBe("complete");
      expect(entry.sources).toHaveLength(f.candidates.length);
      expect(entry.scopes).toEqual({ play: "clear", replacement: "clear", static: "clear",
        trigger: "clear", pendingTasks: "clear", chain: "clear" });
    }
  });

  it("does not promote BF Hold or Legend Conquer potential subevents into this Unit entry", async () => {
    const f = await fixture();
    const kinds = new Map(f.candidates.map(candidate => [candidate.cardId, candidate.kind]));
    expect(kinds.get("unl-187-219")).toBe("legend");
    expect(kinds.get("ogn-275-298")).toBe("battlefield");
    expect(f.native.entryForReceipt(f.pay)(f.request).sourceCensus).toBe("complete");
  });

  it("keeps receipt, actor, base, source UID and cloned head bindings private and exact", async () => {
    const f = await fixture();
    expect(f.native.entryForReceipt(structuredClone(f.pay) as DuelOptionalPlayReceiptV1)(f.request).sourceCensus)
      .toBe("unknown");
    expect(f.native.entryForReceipt(f.pay)({ ...f.request, actor: "bob" }).sourceCensus).toBe("unknown");
    expect(f.native.entryForReceipt(f.pay)({ ...f.request, uid: `${f.request.uid}-other` }).sourceCensus)
      .toBe("unknown");
    expect(f.native.entryForReceipt(f.pay)({ ...f.request, baseLocationId: "not-alice-base" }).sourceCensus)
      .toBe("unknown");
    expect(f.native.inspect({ ...f.request, match: structuredClone(f.head) }).status).toBe("unknown");
  });

  it("fails closed on journal re-entry and does not claim clear scopes without the proof callback", async () => {
    const f = await fixture();
    const foreign = Object.freeze({}) as never;
    const reentrant = createOptionalUnitNativeSourceP6({ catalog: f.catalog, programs: f.programs,
      currentHead: () => f.head, currentJournal: () => foreign,
      inspectChoice: receipt => f.choice.inspectReceipt(receipt) });
    expect(reentrant.inspect(f.request).status).toBe("unknown");
    const noProof = createOptionalUnitNativeSourceP6({ catalog: f.catalog, programs: f.programs,
      currentHead: () => f.head, currentJournal: () => f.journal,
      inspectChoice: receipt => f.choice.inspectReceipt(receipt) });
    expect(noProof.entryForReceipt(f.pay)(f.request).sourceCensus).toBe("unknown");
  });
});
