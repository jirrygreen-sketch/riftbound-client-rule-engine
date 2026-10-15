import { describe, expect, it } from "vitest";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import {
  applyDuelResourceCommandV2, createDuelCommandSessionV2,
  enumerateDuelPhaseSourceClosureCandidatesV2, inspectDuelPhaseSourcesV2,
  commitDuelPlayingMutationV2, placeDuelUnit,
  type DuelCanonicalPlayingStateV2, type DuelPhaseClosureRequirementV2,
  type DuelPhaseSourceClosureContextV2,
} from "@riftbound/engine-core/duel";
import { createCardProgramAuthority } from "../../src/duel/card-program-authority.js";
import { createDuelProductionSourceServicesV2 } from "../../src/duel/production-source-services-v2.js";
import { setupAdapterFixtureCatalog } from "./fixtures/setup-adapter-catalog.js";

const stamp = {
  dataVersion: "production-source-services-fixture-1",
  digest: "sha256:production-source-services-fixture-1",
};
const card = {
  id: "fixture-unit-1", canonicalCardId: "fixture-unit-1", name: "Fixture Unit",
  fullName: "Fixture Unit", localizedName: "Fixture Unit", cardType: "Unit",
  domains: ["Fury"], tags: [], setCode: "fixture", cardNumber: "001/001",
  variant: "standard", imageUrl: null, energy: 1, power: null, might: 2,
  ability: "",
};
const catalog = { schemaVersion: 1, ...stamp, policy: {}, cards: [card] };
const runtime = { publicCatalog: catalog } as never;

describe("production source services V2", () => {
  it("requires the loaded catalog and genuine authority to share the match stamp", () => {
    const authority = createCardProgramAuthority(runtime);
    expect(() => createDuelProductionSourceServicesV2({
      catalog: runtime,
      matchId: "fixture-match",
      currentHead: () => null,
      programs: authority,
      globalJournal: { read: () => null, tokenBirth: () => null },
    })).toThrow(/admitted current head/);
  });

  it("rejects a program authority from a different catalog before reading Core", () => {
    const authority = createCardProgramAuthority(runtime);
    let reads = 0;
    expect(() => createDuelProductionSourceServicesV2({
      catalog: { publicCatalog: { ...catalog, digest: "sha256:drift" } } as never,
      matchId: "fixture-match",
      currentHead: () => { reads += 1; return null; },
      programs: authority,
      globalJournal: { read: () => null, tokenBirth: () => null },
    })).toThrow(/loaded catalog/);
    expect(reads).toBe(0);
    expect(() => createDuelProductionSourceServicesV2({
      catalog: runtime, matchId: "fixture-match", currentHead: () => null,
      programs: { ...authority },
      globalJournal: { read: () => null, tokenBirth: () => null },
    })).toThrow();
  });

  it("loads a catalog, binds current Core and checks the entire hidden/global census", async () => {
    const ids = ["ogn-001-298", "unl-176-219", "unl-187-219",
      "ogn-275-298", "ogn-277-298", "ogn-278-298", "ogn-214-298"];
    const cards = setupAdapterFixtureCatalog.cards.filter(item => ids.includes(item.id))
      .map(item => item.id === "ogn-001-298" || item.id === "unl-176-219"
        ? { ...item, ability: "" } : item.id === "ogn-277-298"
          ? { ...item, ability: "When you hold here, draw 1." } : item);
    const loaded = await loadCardCatalogRuntime({
      catalog: { schemaVersion: 1, dataVersion: "2026-10-12-official-gallery",
        digest: "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10",
        policy: {}, cards },
    });
    const authority = createCardProgramAuthority(loaded);
    const seats = ["alice", "bob"].map(playerId => ({
      playerId,
      mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-unit-${i}`,
        cardId: "ogn-001-298" })),
      champion: { uid: `${playerId}-champion`, cardId: "unl-176-219" },
      legend: { uid: `${playerId}-legend`, cardId: "unl-187-219" },
      runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`,
        cardId: "ogn-214-298", domain: "Order" as const })),
      battlefields: ["ogn-275-298", "ogn-277-298", "ogn-278-298"]
        .map((cardId, i) => ({ instanceId: `${playerId}-field-${i}`, cardId })),
    }));
    const type = (id: string): "Unit" | "Champion" | "Legend" | "Battlefield" | "Rune" =>
      id === "unl-176-219" ? "Champion" : id === "unl-187-219" ? "Legend" :
      id.startsWith("ogn-27") ? "Battlefield" : id === "ogn-214-298" ? "Rune" : "Unit";
    let session = createDuelCommandSessionV2(seats, {
      matchId: "source-services-loaded-catalog", dataVersion: loaded.publicCatalog.dataVersion,
      catalogDigest: loaded.publicCatalog.digest,
      roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })),
    }, () => 0, type);
    for (const actor of ["alice", "bob"]) {
      const result = applyDuelResourceCommandV2(session, actor, {
        commandId: `mulligan-${actor}`, expectedVersion: session.match.stateVersion,
        command: { type: "mulligan", selectedUIDs: [] },
      });
      expect(result.outcome.status).toBe("applied");
      session = result.session;
    }
    let head = session.match as DuelCanonicalPlayingStateV2;
    const context = (event: "awaken" | "hold" | "continuous"): DuelPhaseSourceClosureContextV2 => ({
      matchId: head.matchId, dataVersion: head.dataVersion, catalogDigest: head.catalogDigest,
      turn: head.frame.turnNumber,
      taskId: `duel-v2:${head.matchId}:turn-${head.frame.turnNumber}:${event}:0`,
      phase: event, event, clock: { stateVersion: head.stateVersion, eventSeq: head.eventSeq },
    });
    const requirements: DuelPhaseClosureRequirementV2[] = [
      "all-source-candidate-closure", "hidden-zone-event-subjects",
      "continuous-effect-registry", "cleanup-queue-and-replacements",
      "runtime-subevent-journal", "recursive-conquer-event-journal",
      "draw-subject-journal", "pre-exit-event-journal", "kill-trigger-effect-cases",
      "zone-transition-journal",
    ];
    let omitCandidate = false;
    let omitCoverage = false;
    let exact = true;
    let runtimeKind: "continuous-effect" | "chain-effect" | "queued-effect" | "fepr-outstanding" | null = null;
    const globalJournal = {
      read(c: DuelPhaseSourceClosureContextV2) {
        const source = enumerateDuelPhaseSourceClosureCandidatesV2(head)[0]!;
        const runtimeEntry = runtimeKind && {
          effectId: "runtime-1", kind: runtimeKind, eventId: "event-runtime-1",
          sourceUID: source.uid, sourceZoneEpoch: source.zoneEpoch!,
          cardId: source.cardId, controllerPlayerId: source.controllerPlayerId,
          zone: source.zone,
          programReference: authority.resolvedProgramReference(source.cardId!)!.encodedReference,
        };
        const ledger = (name: string) => ({
          status: (runtimeEntry && (
            name === "activeEffects" && runtimeKind === "continuous-effect" ||
            name === "chain" && runtimeKind === "chain-effect" ||
            name === "effectQueue" && runtimeKind === "queued-effect" ||
            name === "feprOutstanding" && runtimeKind === "fepr-outstanding")
            ? "entries" : "empty") as "entries" | "empty",
          ledgerId: `${name}:${head.matchId}`, revision: head.stateVersion,
          proofId: `ledger:${name}:${head.stateVersion}`, matchId: c.matchId,
          dataVersion: c.dataVersion, catalogDigest: c.catalogDigest, turn: c.turn,
          taskId: c.taskId, clock: { ...c.clock },
          entries: runtimeEntry && (
            name === "activeEffects" && runtimeKind === "continuous-effect" ||
            name === "chain" && runtimeKind === "chain-effect" ||
            name === "effectQueue" && runtimeKind === "queued-effect" ||
            name === "feprOutstanding" && runtimeKind === "fepr-outstanding")
            ? [runtimeEntry] : [],
        });
        const candidates = enumerateDuelPhaseSourceClosureCandidatesV2(head).map(source =>
          JSON.stringify([source.carrier, source.uid, source.zoneEpoch, source.zone.kind,
            "locationId" in source.zone ? source.zone.locationId : source.zone.zonePlayerId]));
        if (runtimeEntry) candidates.push(JSON.stringify(["runtime-effect", "effect:runtime-1",
          runtimeEntry.sourceZoneEpoch, runtimeEntry.zone.kind,
          "locationId" in runtimeEntry.zone ? runtimeEntry.zone.locationId : runtimeEntry.zone.zonePlayerId]));
        return {
          scope: exact ? "exact" as const : "partial" as "exact",
          status: "resolved" as const,
          input: { ...c, tokenReferences: [], preExitSources: [], drawSubjects: [], transitions: [],
            activeEffects: ledger("activeEffects"), chain: ledger("chain"),
            effectQueue: ledger("effectQueue"), feprOutstanding: ledger("feprOutstanding") },
          candidateKeys: omitCandidate ? candidates.slice(1) : candidates,
          journalRevision: head.stateVersion, candidateSetRevision: head.stateVersion,
          proofId: `global:${c.taskId}`,
          coverage: (omitCoverage ? requirements.slice(1) : requirements).map(requirement => ({
            requirement, journalRevision: head.stateVersion, proofId: `coverage:${requirement}` })),
        };
      },
      tokenBirth: () => null,
    };
    const services = createDuelProductionSourceServicesV2({
      catalog: loaded, matchId: head.matchId, currentHead: () => head,
      programs: authority, globalJournal,
    });
    const awaken = context("awaken");
    const inspection = services.inspect(awaken);
    expect(inspection.status).toBe("ready");
    expect(inspection.candidates.some(source => source.zone.kind === "hand")).toBe(true);
    expect(inspection.candidates.some(source => source.zone.kind === "main-deck")).toBe(true);
    expect(inspectDuelPhaseSourcesV2(head, "awaken", awaken.turn,
      awaken.taskId, services.phaseRegistry).status).toBe("ready");
    const hold = context("hold");
    expect(services.inspect(hold).handlers.length).toBeGreaterThan(0);
    expect(inspectDuelPhaseSourcesV2(head, "hold", hold.turn,
      hold.taskId, services.phaseRegistry).status).toBe("ready");
    const physical = inspection.candidates.find(source => source.kind === "card" &&
      source.zone.kind === "main-deck" && source.cardId === "ogn-001-298")!;
    expect(services.entry({ match: head, matchId: head.matchId,
      stateVersion: head.stateVersion, eventSeq: head.eventSeq,
      actor: physical.ownerPlayerId!, uid: physical.uid, cardId: physical.cardId!,
      sourceEpoch: physical.zoneEpoch!, baseLocationId: "alice-base",
      programId: authority.resolvedProgramReference(physical.cardId!)!.programId,
    }).sourceCensus).toBe("unknown");
    expect(services.costBinding({ matchId: head.matchId, stateVersion: head.stateVersion,
      actor: physical.ownerPlayerId!, uid: physical.uid, cardId: physical.cardId!,
      sourceEpoch: physical.zoneEpoch!, baseLocationId: "alice-base",
      transactionId: "txn-1", baseProofId: "base-1", coverageProofId: "coverage-1",
    }).status).toBe("unknown");
    expect(services.derivedMight(physical.uid, context("continuous")).status).toBe("blocked");
    for (const kind of ["continuous-effect", "chain-effect", "queued-effect", "fepr-outstanding"] as const) {
      runtimeKind = kind;
      expect(services.inspect(awaken).status, kind).toBe("pending");
    }
    runtimeKind = null;
    omitCandidate = true;
    expect(services.inspect(awaken).status).toBe("pending");
    omitCandidate = false;
    omitCoverage = true;
    expect(services.inspect(awaken).status).toBe("pending");
    omitCoverage = false;
    exact = false;
    expect(services.inspect(awaken).status).toBe("pending");
    exact = true;
    const unknownLoaded = await loadCardCatalogRuntime({
      catalog: { schemaVersion: 1, dataVersion: loaded.publicCatalog.dataVersion,
        digest: loaded.publicCatalog.digest, policy: {}, cards: cards.map(item =>
          item.id === "ogn-001-298" ? { ...item, ability: "Unmodeled ability." } : item) },
    });
    const unresolved = createDuelProductionSourceServicesV2({
      catalog: unknownLoaded, matchId: head.matchId, currentHead: () => head,
      programs: createCardProgramAuthority(unknownLoaded), globalJournal,
    });
    expect(unresolved.inspect(awaken).status).toBe("pending");
    const stale = { ...awaken, clock: { ...awaken.clock, stateVersion: awaken.clock.stateVersion - 1 } };
    expect(services.inspect(stale).status).toBe("pending");
    const holderField = services.inspect(hold).handlers.find(source => source.kind === "battlefield")!;
    if (!("locationId" in holderField.zone)) throw Error("battlefield required");
    const locationId = holderField.zone.locationId;
    const unit = head.players[0].hand[0]!;
    head = commitDuelPlayingMutationV2(head, draft => {
      const placed = placeDuelUnit(draft.board, { objectId: unit.uid, controllerPlayerId: "alice", locationId });
      return { match: { ...draft, board: { ...placed, battlefields: placed.battlefields.map(field =>
        field.locationId === locationId ? { ...field, controllerPlayerId: "alice", contestingPlayerId: null,
          contested: false, combat: "none", showdown: "none" } : field) },
        players: [{ ...draft.players[0], hand: draft.players[0].hand.filter(card => card.uid !== unit.uid) }, draft.players[1]],
        unitMeta: { ...draft.unitMeta, [unit.uid]: { ownerPlayerId: "alice", readied: false, damageMarks: [],
          trait: { kind: "card", cardId: unit.cardId } } } },
        transitions: [{ uid: unit.uid, from: { kind: "hand", zonePlayerId: "alice" },
          to: { kind: "board-battlefield", locationId } }] };
    });
    const actualHold = context("hold");
    expect(inspectDuelPhaseSourcesV2(head, "hold", actualHold.turn,
      actualHold.taskId, services.phaseRegistry).status).toBe("pending");
    head = structuredClone(head);
    expect(services.inspect(awaken).status).toBe("pending");
  });
});
