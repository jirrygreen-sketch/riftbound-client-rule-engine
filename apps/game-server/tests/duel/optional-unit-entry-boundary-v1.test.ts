import { describe, expect, it } from "vitest";
import {
  commitDuelPlayingMutationV2,
  createDuelMatchV2,
  enumerateDuelPhaseSourceClosureCandidatesV2,
  resolveDuelMulliganV2,
  type DuelCanonicalPlayingStateV2,
  type DuelUnitEntryRequestV2,
} from "@riftbound/engine-core/duel";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { createDuelAccelerateCardProgramAuthorityV1 } from "../../src/duel/card-program-authority.js";
import { createDuelOptionalUnitProgramReader } from "../../src/duel/optional-unit-services-p4.js";
import { createDuelNativeOperationJournalV2 } from "../../src/duel/operation-journal-v2.js";
import type { DuelNativeCostCensusV2 } from "../../src/duel/operation-journal-v2.js";
import { createP4PureAccelerateEntryBoundaryV1 } from "../../src/duel/optional-unit-entry-boundary-v1.js";
import { setupAdapterFixtureCatalog } from "./fixtures/setup-adapter-catalog.js";

const stamp = { dataVersion: "2026-10-12-official-gallery",
  digest: "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10" };
const targetId = "ogn-001-298";
const ids = [targetId, "ogn-002-298", "ogn-214-298", "unl-176-219", "unl-187-219",
  "ogn-275-298", "ogn-277-298", "ogn-278-298"];

/** Includes no-effect cards plus unresolved board sources to exercise blocking. */
async function fixture() {
  const catalogData = { schemaVersion: 1, ...stamp, policy: {},
    cards: setupAdapterFixtureCatalog.cards.filter(card => ids.includes(card.id)).map(card => ({
      ...card,
      ...(card.id === "ogn-002-298" || card.id === "unl-176-219" ||
        card.id === "unl-187-219" || card.cardType === "Battlefield"
        ? { ability: "", energy: card.energy ?? 0 } : {}),
    })) };
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
  const metadata = { matchId: "optional-entry-boundary-fixture",
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
    commits: [{ operationId: "entry-a", eventId: "entry-a", event: "mulligan" }] });
  const match = resolveDuelMulliganV2(first, "bob", []);
  current = match;
  journal.observe({ ancestor: first, descendant: match,
    commits: [{ operationId: "entry-b", eventId: "entry-b", event: "mulligan" }] });
  const head = commitDuelPlayingMutationV2(match, draft => ({ match: { ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, state]) =>
      [uid, { ...state, readiness: "ready" }])),
    frame: { ...draft.frame, phase: "main", stateOpen: true,
      priorityPlayerId: "alice", turnPlayerId: "alice" } }, transitions: [] }));
  current = head;
  journal.observe({ ancestor: match, descendant: head,
    commits: [{ operationId: "entry-main", eventId: "entry-main", event: "main" }] });
  const target = head.players[0].hand.find(card => card.cardId === targetId)!;
  const reader = createDuelOptionalUnitProgramReader({ catalog, programs });
  const source = reader.readSource(head, "alice", target.uid);
  const request: DuelUnitEntryRequestV2 = { match: head, matchId: head.matchId,
    stateVersion: head.stateVersion, eventSeq: head.eventSeq, actor: "alice", uid: target.uid,
    cardId: target.cardId, sourceEpoch: source.sourceEpoch,
    baseLocationId: head.board.bases.find(base => base.ownerPlayerId === "alice")!.locationId,
    programId: source.sourceProgramFingerprint };
  const candidates = enumerateDuelPhaseSourceClosureCandidatesV2(head);
  const original = journal.readCostCensus()!;
  const census: DuelNativeCostCensusV2 = { ...original, sources: original.sources.map(item =>
    item.uid === target.uid ? { ...item, programReference: null } : item) };
  return { head, request, candidates, census, boundary: createP4PureAccelerateEntryBoundaryV1({
    catalog, programs, currentHead: () => current as DuelCanonicalPlayingStateV2,
  }), setHead: (next: DuelCanonicalPlayingStateV2) => { current = next; } };
}

describe("P4 pure Accelerate Unit-entry boundary", () => {
  it("stays blocked when the complete Core candidate set contains unresolved sources", async () => {
    const f = await fixture();
    const proof = f.boundary(f.request, f.candidates, f.census);
    expect(proof).toBeNull();
    expect(f.request.match).toBe(f.head);
  });

  it("rejects missing/altered census, non-current head, and active source IR", async () => {
    const f = await fixture();
    expect(f.boundary(f.request, f.candidates.slice(1), f.census)).toBeNull();
    const changed = { ...f.candidates[0]!, ownerPlayerId: "bob" };
    expect(f.boundary(f.request, [changed, ...f.candidates.slice(1)], f.census)).toBeNull();
    f.setHead(structuredClone(f.head));
    expect(f.boundary({ ...f.request, match: f.head }, f.candidates, f.census)).toBeNull();
  });
});

