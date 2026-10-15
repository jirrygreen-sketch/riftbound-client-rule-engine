import { describe, expect, it } from "vitest";
import {
  applyDuelResourceCommandV2,
  createDuelCommandSessionV2,
  createDuelPhaseSourceClosureJournalV2,
  enumerateDuelPhaseSourceClosureCandidatesV2,
  type DuelCanonicalPlayingStateV2,
  type DuelPhaseClosureCoreRequestV2,
  type DuelPhaseClosureRequirementV2,
  type DuelPhaseSourceClosureContextV2,
  type DuelPhaseSourceClosureJournalV2,
} from "@riftbound/engine-core/duel";
import {
  createCardProgramAuthority,
  type CardProgramAuthority,
} from "../../src/duel/card-program-authority.js";
import {
  createDuelPhaseSourceServerBridgeV2,
  type DuelPhaseSourceServerBridgeV2,
} from "../../src/duel/phase-source-bridge-v2.js";

const DATA_VERSION = "2026-10-12-official-gallery";
const DIGEST = "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10";

const RUNE_ROWS: Readonly<Record<string, {
  readonly domain: string;
  readonly number: string;
  readonly localizedName: string;
  readonly canonicalCardId: string;
}>> = {
  "ogn-007-298": { domain: "Fury", number: "007", localizedName: "炽烈符文", canonicalCardId: "card.hash-30497c69657abd1d3abf17f9b3766e7d064817473a88828ca2ef4ab9b51f7902" },
  "ogn-042-298": { domain: "Calm", number: "042", localizedName: "翠意符文", canonicalCardId: "card.hash-efe5e5f4811f4089cd86b83cd6b8385613b0f469b2c2ae9f6b74a55ceb5cf0ed" },
  "ogn-089-298": { domain: "Mind", number: "089", localizedName: "灵光符文", canonicalCardId: "card.hash-a8a4cb783649a0339782e2d3808d6144661c621634da7c9f79b4f87981fac97b" },
  "ogn-126-298": { domain: "Body", number: "126", localizedName: "摧破符文", canonicalCardId: "card.hash-a2227b03e9e13c8e2ddae7a973c746cc4243ff631dfaf462dc9823e687bbbf17" },
  "ogn-166-298": { domain: "Chaos", number: "166", localizedName: "混沌符文", canonicalCardId: "card.hash-055d9ad1c38fc05b800d053d3845209673f5397b39fb7bf76787adbc8cf42743" },
  "ogn-214-298": { domain: "Order", number: "214", localizedName: "序理符文", canonicalCardId: "card.hash-e0efe08be77e60ed68f2e43ba425b763efd364eb44b0c760d26ef1fcc1b6df67" },
  "ogn-007a-298": { domain: "Fury", number: "007a", localizedName: "炽烈符文", canonicalCardId: "card.hash-30497c69657abd1d3abf17f9b3766e7d064817473a88828ca2ef4ab9b51f7902" },
  "ogn-042a-298": { domain: "Calm", number: "042a", localizedName: "翠意符文", canonicalCardId: "card.hash-efe5e5f4811f4089cd86b83cd6b8385613b0f469b2c2ae9f6b74a55ceb5cf0ed" },
};

function rune(id: string): Record<string, unknown> {
  const row = RUNE_ROWS[id];
  if (row === undefined) throw new Error(`missing test rune ${id}`);
  return {
    id,
    canonicalCardId: row.canonicalCardId,
    name: `${row.domain} Rune`,
    fullName: `${row.domain} Rune`,
    localizedName: row.localizedName,
    cardType: "Rune",
    domains: [row.domain],
    tags: ["Basic"],
    setCode: "ogn",
    cardNumber: `OGN-${row.number}/298`,
    variant: row.number.endsWith("a") ? "alternate" : "standard",
    imageUrl: null,
    energy: null,
    power: null,
    might: null,
    ability: "",
  };
}

const CARD_IDS = Object.keys(RUNE_ROWS);
const CATALOG = {
  schemaVersion: 1,
  dataVersion: DATA_VERSION,
  digest: DIGEST,
  policy: {},
  cards: CARD_IDS.map(rune),
};

function authority(): CardProgramAuthority {
  return createCardProgramAuthority({ publicCatalog: CATALOG } as never);
}

const championId = CARD_IDS[0]!;
const legendId = CARD_IDS[1]!;
const runeId = CARD_IDS[2]!;
const battlefieldIds = new Set([CARD_IDS[3]!, CARD_IDS[4]!, CARD_IDS[5]!]);
const unitIds = new Set([CARD_IDS[6]!, CARD_IDS[7]!]);

function cardType(cardId: string): "Champion" | "Legend" | "Rune" | "Battlefield" | "Unit" {
  if (cardId === championId) return "Champion";
  if (cardId === legendId) return "Legend";
  if (cardId === runeId) return "Rune";
  if (battlefieldIds.has(cardId)) return "Battlefield";
  if (unitIds.has(cardId)) return "Unit";
  throw new Error(`unexpected card ${cardId}`);
}

function session(stamp: { readonly dataVersion?: string; readonly digest?: string } = {}): DuelCanonicalPlayingStateV2 {
  const seats = ["alice", "bob"].map((playerId) => ({
    playerId,
    mainDeck: Array.from({ length: 10 }, (_, index) => ({
      uid: `${playerId}-main-${index}`,
      cardId: index % 2 === 0 ? CARD_IDS[6]! : CARD_IDS[7]!,
    })),
    champion: { uid: `${playerId}-champion`, cardId: championId },
    legend: { uid: `${playerId}-legend`, cardId: legendId },
    runeDeck: Array.from({ length: 6 }, (_, index) => ({
      uid: `${playerId}-rune-${index}`,
      cardId: runeId,
      domain: "Mind" as const,
    })),
    battlefields: Array.from({ length: 3 }, (_, index) => ({
      instanceId: `${playerId}-field-${index}`,
      cardId: CARD_IDS[3 + index]!,
    })),
  }));
  const metadata = {
    matchId: "phase-source-bridge-v2",
    dataVersion: stamp.dataVersion ?? DATA_VERSION,
    catalogDigest: stamp.digest ?? DIGEST,
    roster: seats.map((seat) => ({ playerId: seat.playerId, displayName: seat.playerId })),
  };
  let current = createDuelCommandSessionV2(
    seats,
    metadata,
    () => 0,
    cardType,
  );
  for (const actor of ["alice", "bob"]) {
    const result = applyDuelResourceCommandV2(current, actor, {
      commandId: `mulligan-${actor}`,
      expectedVersion: current.match.stateVersion,
      command: { type: "mulligan", selectedUIDs: [] },
    });
    if (result.outcome.status !== "applied") throw new Error("fixture mulligan rejected");
    current = result.session;
  }
  return current.match as DuelCanonicalPlayingStateV2;
}

function contextFor(match: DuelCanonicalPlayingStateV2, event = "awaken"): DuelPhaseSourceClosureContextV2 {
  const turn = match.frame.turnNumber;
  return {
    matchId: match.matchId,
    dataVersion: match.dataVersion,
    catalogDigest: match.catalogDigest,
    turn,
    taskId: `duel-v2:${match.matchId}:turn-${turn}:${event}:0`,
    phase: event as DuelPhaseSourceClosureContextV2["phase"],
    event: event as DuelPhaseSourceClosureContextV2["event"],
    clock: { stateVersion: match.stateVersion, eventSeq: match.eventSeq },
  };
}

function emptyJournal(
  match: DuelCanonicalPlayingStateV2,
  context: DuelPhaseSourceClosureContextV2,
): DuelPhaseSourceClosureJournalV2 {
  const ledger = (name: string) => ({
    status: "empty" as const,
    ledgerId: `${name}:${match.matchId}`,
    revision: 0,
    proofId: `ledger-proof:${name}:${match.stateVersion}`,
    matchId: context.matchId,
    dataVersion: context.dataVersion,
    catalogDigest: context.catalogDigest,
    turn: context.turn,
    taskId: context.taskId,
    clock: { ...context.clock },
    entries: [],
  });
  return createDuelPhaseSourceClosureJournalV2({
    ...context,
    tokenReferences: [],
    preExitSources: [],
    drawSubjects: [],
    transitions: [],
    activeEffects: ledger("activeEffects"),
    chain: ledger("chain"),
    effectQueue: ledger("effectQueue"),
    feprOutstanding: ledger("feprOutstanding"),
  });
}

function trustedBridge(match: DuelCanonicalPlayingStateV2, catalogAuthority = authority()): {
  readonly bridge: DuelPhaseSourceServerBridgeV2;
  readonly context: DuelPhaseSourceClosureContextV2;
  readonly journal: DuelPhaseSourceClosureJournalV2;
} {
  let currentContext: DuelPhaseSourceClosureContextV2 | undefined;
  const candidates = enumerateDuelPhaseSourceClosureCandidatesV2(match);
  const byUID = new Map(candidates.map((candidate) => [candidate.uid, candidate]));
  const bridge = createDuelPhaseSourceServerBridgeV2(catalogAuthority, match, {
    resolveCore(locator) {
      const context = currentContext;
      const source = byUID.get(locator.uid);
      if (context === undefined || source === undefined) return null;
      const reference = catalogAuthority.resolvedProgramReference(source.cardId ?? "");
      if (reference === undefined) return null;
      return {
        context,
        source,
        expectedProgramReference: reference.encodedReference,
        referenceKind: "printing",
      } as DuelPhaseClosureCoreRequestV2;
    },
    resolveJournal(request, requirements) {
      return {
        request,
        proofId: `journal-proof:${request.context.taskId}:${request.source.uid}`,
        journalRevision: 0,
        candidateSetRevision: 1,
        coverage: requirements.map((requirement: DuelPhaseClosureRequirementV2) => ({
          requirement,
          journalRevision: 0,
          proofId: `coverage-proof:${requirement}`,
        })),
      };
    },
  });
  const context = contextFor(match);
  currentContext = context;
  return { bridge, context, journal: emptyJournal(match, context) };
}

describe("server V2 phase-source bridge", () => {
  it("binds only the real catalog authority index and produces source-local scope", () => {
    const match = session();
    const catalogAuthority = authority();
    const bridge = createDuelPhaseSourceServerBridgeV2(catalogAuthority, match);
    expect(bridge.programIndex.matchId).toBe(match.matchId);
    expect(bridge.programIndex.printings).toHaveLength(CARD_IDS.length);
    expect(bridge.resolvedProgramReference(championId)?.encodedReference).toBe(
      catalogAuthority.resolvedProgramReference(championId)?.encodedReference,
    );
    expect(bridge.sourceProgramPhaseScope(championId, "begin").scope).toBe("source-program");
    expect(bridge.sourceProgramPhaseScope("unknown-card", "begin").scope).toBe("unknown");
  });

  it("assembles a complete closure only through trusted Core and journal lookups", () => {
    const match = session();
    const { bridge, context, journal } = trustedBridge(match);
    for (const probe of enumerateDuelPhaseSourceClosureCandidatesV2(match)) {
      const probeRequest = bridge.issueClosureRequest({ matchId: match.matchId, taskId: context.taskId, uid: probe.uid });
      if (probeRequest === null) throw new Error(`probe request null: ${probe.uid}`);
      const probeResult = bridge.assembleClosureEvidence(probeRequest);
      if (probeResult.status !== "complete") throw new Error(`probe unknown ${probe.uid}: ${probeResult.reason}`);
    }
    const inspection = bridge.phaseGate(context, journal);
    if (inspection.status !== "ready") throw new Error(`bridge pending: ${inspection.reason}`);
    expect(inspection.status).toBe("ready");
    expect(inspection.candidates.length).toBeGreaterThan(0);
    expect(inspection.candidates.some((candidate) => candidate.zone.kind === "hand")).toBe(true);
    expect(inspection.candidates.some((candidate) => candidate.zone.kind === "main-deck")).toBe(true);
  });

  it("fails closed when Core/journal providers are missing, a printing drifts, or a handle is cloned", () => {
    const match = session();
    const catalogAuthority = authority();
    const bridge = createDuelPhaseSourceServerBridgeV2(catalogAuthority, match);
    const context = contextFor(match);
    const journal = emptyJournal(match, context);
    expect(bridge.inspect(context, journal).status).toBe("pending");
    expect(bridge.inspect(context, undefined).reason).toBe("missing-closure-journal");
    expect(bridge.sourceProgramPhaseScope(championId, "conquer").scope).toBe("unknown");

    const locator = { matchId: match.matchId, taskId: context.taskId, uid: "missing-uid" };
    expect(bridge.issueClosureRequest(locator)).toBeNull();
    const cloned = structuredClone(bridge.closureAuthority);
    expect(bridge.assembleClosureEvidence(cloned as never).status).toBe("unknown");
    expect(() => createDuelPhaseSourceServerBridgeV2(
      catalogAuthority,
      session({ digest: "sha256:catalog-drift" }),
    )).toThrow(/catalog and match stamps/);
  });

  it("does not turn a foreign Core response or provider exception into evidence", () => {
    const match = session();
    const catalogAuthority = authority();
    const context = contextFor(match);
    const journal = emptyJournal(match, context);
    const bridge = createDuelPhaseSourceServerBridgeV2(catalogAuthority, match, {
      resolveCore() {
        throw new Error("provider failure");
      },
    });
    expect(bridge.inspect(context, journal).status).toBe("pending");
    expect(bridge.inspect({ ...context, taskId: "foreign:task" }, journal).status).toBe("pending");
  });
});

