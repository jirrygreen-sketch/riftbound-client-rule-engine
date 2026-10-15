import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  adoptAdmittedDuelPlayingSessionV2, applyDuelSpellResourceCommandV2,
  channelDuelRunesV2, commitDuelPlayingMutationV2, createDuelMatchV2,
  finalizeDuelSpellCardPlayV2, passDuelSpellPriorityV2, playDuelSpellCardV2,
  resolveDuelMulliganV2, resolveDuelSpellCardPlayV2, resolveDuelTotalCostV2,
  type DuelCanonicalPlayingStateV2, type DuelMatchStateV2,
  type DuelSpellCommandDispatcherV2,
} from "@riftbound/engine-core/duel";
import { loadCardCatalogRuntime, type CardCatalogRuntime } from "../../src/card-catalog.js";
import {
  createCardProgramAuthority,
  type CardProgramAuthority,
} from "../../src/duel/card-program-authority.js";
import {
  createP4KillSpellServicesV1,
  createP4SpellServices,
  type P4SpellServicesOptions,
} from "../../src/duel/p4-spell-services.js";
import { createDuelNativeOperationJournalV2 } from "../../src/duel/operation-journal-v2.js";

const actualCatalogPath = fileURLToPath(new URL(
  "../../../../packages/card-data/data/deck-catalog.json", import.meta.url));
const actualCatalogAvailable = existsSync(actualCatalogPath);
const ACTUAL_IDS = {
  killOne: "ogn-229-298",
  killAll: "unl-180-219",
  eachPlayer: "ogn-209-298",
  damage: "ogn-105-298",
  unresolvedSpell: "ogn-004-298",
  unit: "ogn-001-298",
};

type ServiceCase = {
  readonly catalog: CardCatalogRuntime;
  readonly programs: CardProgramAuthority;
  readonly options: P4SpellServicesOptions;
  readonly cardId: string;
  readonly uid: string;
  readonly epoch: number;
  readonly head: DuelCanonicalPlayingStateV2;
  readonly census: {
    readonly matchId: string;
    readonly stateVersion: number;
    readonly eventSeq: number;
    readonly journalRevision: number;
    readonly candidateSetRevision: number;
    readonly unresolvedNativeHistory: false;
    readonly phaseClosed: false;
    readonly sources: readonly Record<string, unknown>[];
  };
};

// Cost-census doubles below exercise the service contract, not a public room.
async function actualRuntime() {
  if (!actualCatalogAvailable) return null;
  return loadCardCatalogRuntime();
}

function serviceCase(catalog: CardCatalogRuntime, programs: CardProgramAuthority,
  cardId: string, extraSources: readonly Record<string, unknown>[] = []): ServiceCase {
  const card = catalog.publicCatalog.cards.find(item => item.id === cardId);
  if (!card) throw new Error(`missing actual card ${cardId}`);
  const uid = `alice-hand-${cardId}`;
  const epoch = 11;
  const matchId = "p4-kill-spell-services-v1";
  const stateVersion = 17;
  const eventSeq = 29;
  const head = {
    matchId, stateVersion, eventSeq,
    dataVersion: catalog.publicCatalog.dataVersion,
    catalogDigest: catalog.publicCatalog.digest,
    physicalCardsByUID: {
      [uid]: { cardId, ownerPlayerId: "alice", origin: "submitted-deck", zoneEpoch: epoch },
    },
  } as unknown as DuelCanonicalPlayingStateV2;
  const reference = programs.resolvedProgramReference(cardId);
  const source = {
    uid, sourceEpoch: epoch, cardId, ownerPlayerId: "alice", controllerPlayerId: "alice",
    programReference: reference?.encodedReference ?? "unknown-program-reference",
    carrier: "object", zone: { kind: "hand", zonePlayerId: "alice" },
    bindingRevision: 1, status: "live",
  } as const;
  const census = {
    matchId, stateVersion, eventSeq, journalRevision: 4, candidateSetRevision: 2,
    unresolvedNativeHistory: false as const, phaseClosed: false as const,
    sources: [source, ...extraSources],
  };
  let currentHead = head;
  const journal = {
    readCostCensus: () => census,
    revision: () => census.journalRevision,
    observedHead: () => currentHead,
    listCommits: () => [],
  };
  const dispatcher = {
    notifyCommitted: () => undefined,
  } as unknown as DuelSpellCommandDispatcherV2;
  const options: P4SpellServicesOptions = {
    catalog, programs,
    getOperationHead: () => currentHead,
    setOperationHead: next => { currentHead = next; },
    currentJournal: () => journal as never,
    observeNativePath: ({ ancestor, descendant, commits }) => ({ ancestor, descendant,
      commits: commits.map(commit => ({ operationId: commit.operationId,
        eventId: commit.eventId, event: "main" as const })) }),
    dispatcher,
    sourceAttestor: () => { throw new TypeError("source attestation is not used by this cost test"); },
    closure: {},
    uidFactory: () => "test-identity",
    dispatcherSnapshot: () => ({}),
  };
  return { catalog, programs, options, cardId, uid, epoch, head, census };
}

function requestFor(value: ServiceCase, epoch = value.epoch, subjectId = value.cardId) {
  return { kind: "card-play" as const, subjectId,
    transactionId: JSON.stringify([value.head.matchId, value.head.stateVersion,
      "alice", "kill-spell-command", value.uid, epoch]) };
}

function nativeScene(catalog: CardCatalogRuntime, programs: CardProgramAuthority,
  funded = false) {
  const ids = [ACTUAL_IDS.killAll, "unl-176-219", "unl-187-219", "ogn-214-298",
    "ogn-275-298", "ogn-277-298", "ogn-278-298"];
  for (const id of ids) if (!catalog.publicCatalog.cards.some(card => card.id === id))
    throw new Error(`missing actual printing ${id}`);
  const metadata = { matchId: "p4-kill-cost-native", dataVersion: catalog.publicCatalog.dataVersion,
    catalogDigest: catalog.publicCatalog.digest,
    roster: [{ playerId: "alice", displayName: "alice" },
      { playerId: "bob", displayName: "bob" }] as [
      { playerId: string; displayName: string }, { playerId: string; displayName: string }],
  };
  const seats = ["alice", "bob"].map(playerId => ({ playerId,
    mainDeck: Array.from({ length: 8 }, (_, i) => ({ uid: `${playerId}-spell-${i}`,
      cardId: ACTUAL_IDS.killAll })),
    champion: { uid: `${playerId}-champion`, cardId: "unl-176-219" },
    legend: { uid: `${playerId}-legend`, cardId: "unl-187-219" },
    runeDeck: Array.from({ length: 4 }, (_, i) => ({ uid: `${playerId}-rune-${i}`,
      cardId: "ogn-214-298", domain: "Order" as const })),
    battlefields: ["ogn-275-298", "ogn-277-298", "ogn-278-298"].map((cardId, i) =>
      ({ instanceId: `${playerId}-field-${i}`, cardId })),
  }));
  const typeOf = (cardId: string): "Other" | "Champion" | "Legend" | "Rune" | "Battlefield" =>
    cardId === "unl-176-219" ? "Champion" : cardId === "unl-187-219" ? "Legend"
      : cardId === "ogn-214-298" ? "Rune" : cardId.startsWith("ogn-27") ? "Battlefield" : "Other";
  const genesis = createDuelMatchV2(seats, metadata, () => 0, typeOf);
  let head: DuelMatchStateV2 = genesis;
  const journal = createDuelNativeOperationJournalV2({ genesis, currentHead: () => head, programs });
  const first = resolveDuelMulliganV2(genesis, "alice", []);
  journal.observe({ ancestor: genesis, descendant: first,
    commits: [{ operationId: "mulligan-a", eventId: "mulligan-a", event: "mulligan" }] });
  head = first;
  const second = resolveDuelMulliganV2(first, "bob", []);
  journal.observe({ ancestor: first, descendant: second,
    commits: [{ operationId: "mulligan-b", eventId: "mulligan-b", event: "mulligan" }] });
  head = second;
  if (head.stage !== "playing") throw new Error("expected playing state");
  const channel = channelDuelRunesV2(head, "alice", 1);
  journal.observe({ ancestor: head, descendant: channel,
    commits: [{ operationId: "channel-a", eventId: "channel-a", event: "channel" }] });
  head = channel;
  const main = commitDuelPlayingMutationV2(channel, draft => ({ match: { ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, state]) =>
      [uid, { ...state, readiness: "ready" }])),
    frame: { ...draft.frame, phase: "main", stateOpen: true,
      priorityPlayerId: "alice", turnPlayerId: "alice" } }, transitions: [] }));
  journal.observe({ ancestor: channel, descendant: main,
    commits: [{ operationId: "main-a", eventId: "main-a", event: "main" }] });
  head = main;
  if (funded) {
    const fundedHead = commitDuelPlayingMutationV2(main, draft => ({ match: { ...draft,
      resources: { ...draft.resources, players: [
        { ...draft.resources.players[0], runePool: {
          ...draft.resources.players[0].runePool, energy: 9,
          power: { ...draft.resources.players[0].runePool.power, Order: 3 },
        } }, draft.resources.players[1],
      ] },
    }, transitions: [] }));
    journal.observe({ ancestor: main, descendant: fundedHead,
      commits: [{ operationId: "funded-fixture", eventId: "funded-fixture", event: "main" }] });
    head = fundedHead;
  }
  const playing = head as DuelCanonicalPlayingStateV2;
  const claims = new Map<unknown, string>();
  const dispatcher: DuelSpellCommandDispatcherV2 = {
    claim: request => {
      const claim = { id: request.commandId };
      claims.set(claim, request.commandId);
      return { status: "new", claim };
    },
    finish: request => { if (!claims.has(request.claim)) throw new Error("unknown claim"); },
    readCommitted: () => null,
    commitEffect: () => { throw new Error("no effect may commit in this case"); },
    notifyCommitted: () => { throw new Error("no effect may notify in this case"); },
  };
  const spell = createP4KillSpellServicesV1({ catalog, programs,
    getOperationHead: () => head as DuelCanonicalPlayingStateV2,
    setOperationHead: value => { head = value; }, currentJournal: () => journal,
    observeNativePath: ({ ancestor, descendant, commits, stage }) => ({ ancestor, descendant,
      commits: commits.map((commit, index) => ({ operationId: `${stage}:${descendant.stateVersion}:${index}`,
        eventId: `${stage}:${descendant.stateVersion}:${index}`, event: "main" as const })) }),
    dispatcher,
    sourceAttestor: request => ({ matchId: request.match.matchId, actor: request.actor,
      paymentId: request.paymentId, sourceReference: request.sourceReference,
      sourceProofId: "native-test-source", mode: "current",
      sourceZoneEpoch: request.match.physicalCardsByUID[request.sourceReference.sourceUID]!.zoneEpoch,
      ...(request.taskId ? { taskId: request.taskId } : {}),
      ...(request.continuationId ? { continuationId: request.continuationId } : {}) }),
    closure: {}, uidFactory: () => "native-test-identity",
    dispatcherSnapshot: () => ({ claims: [...claims.values()] }),
  });
  return { main: playing, spell, journal, uid: playing.players[0].hand[0]!.uid };
}

describe.skipIf(!actualCatalogAvailable)("P4 Kill Spell services V1 actual catalog opt-in", () => {
  it("binds the genuine Vengeance and The Ruination tuples and exact numeric costs", async () => {
    const catalog = await actualRuntime();
    if (!catalog) return;
    const programs = createCardProgramAuthority(catalog);
    for (const [cardId, cost, power] of [[ACTUAL_IDS.killOne, 4, 2], [ACTUAL_IDS.killAll, 9, 3]] as const) {
      const value = serviceCase(catalog, programs, cardId);
      const service = createP4KillSpellServicesV1(value.options);
      const verified = service.verifiedCostSource(requestFor(value));
      expect(verified.base).toEqual({ cost: { energy: cost,
        power: [{ allowedDomains: ["Order"], amount: power }] },
        sourceUid: value.uid, sourceEpoch: value.epoch });
      expect(verified.candidates).toEqual([{ sourceUid: value.uid, sourceEpoch: value.epoch,
        choice: "not-applicable", modifierIds: [] }]);
      const request = requestFor(value);
      const resolved = resolveDuelTotalCostV2(service.coreServices.cost, request);
      expect(resolved.baseCost).toEqual(verified.base.cost);
      expect(resolved.finalResolvedCost).toEqual(verified.base.cost);
      expect(resolved.applications).toEqual([]);
      const binding = { matchId: value.head.matchId, stateVersion: value.head.stateVersion,
        actor: "alice", uid: value.uid, cardId, sourceEpoch: value.epoch,
        transactionId: request.transactionId, baseProofId: resolved.baseProofId,
        coverageProofId: resolved.coverageProofId };
      expect(service.coreServices.costBinding(binding).status).toBe("complete");
      expect(service.coreServices.costBinding({ ...binding, sourceEpoch: value.epoch + 1 }).status)
        .toBe("unknown");
      expect(service.coreServices.programs.getProgram(cardId)?.semantics).toEqual({ kind: "spell-resolution",
        effects: [cardId === ACTUAL_IDS.killOne
          ? { kind: "kill-unit", controller: "any", selection: "target" }
          : { kind: "kill-units", controller: "any", selection: "all" }] });
    }
  });

  it("keeps the archived factory draw-only and rejects each-player and damage effects", async () => {
    const catalog = await actualRuntime();
    if (!catalog) return;
    const programs = createCardProgramAuthority(catalog);
    for (const cardId of [ACTUAL_IDS.killOne, ACTUAL_IDS.killAll, ACTUAL_IDS.eachPlayer, ACTUAL_IDS.damage]) {
      const value = serviceCase(catalog, programs, cardId);
      expect(() => createP4SpellServices(value.options).verifiedCostSource(requestFor(value)))
        .toThrow(/unsupported Spell cost slice/);
    }
  });

  it("rejects unresolved, non-Spell and compound sources before cost approval", async () => {
    const catalog = await actualRuntime();
    if (!catalog) return;
    const programs = createCardProgramAuthority(catalog);
    const unknown = serviceCase(catalog, programs, ACTUAL_IDS.killOne);
    expect(() => createP4KillSpellServicesV1(unknown.options)
      .verifiedCostSource(requestFor(unknown, unknown.epoch, "unknown-printing")))
      .toThrow(/current owned Hand card/);
    const unresolved = serviceCase(catalog, programs, ACTUAL_IDS.unresolvedSpell);
    expect(programs.resolvedProgramReference(ACTUAL_IDS.unresolvedSpell)).toBeUndefined();
    expect(() => createP4KillSpellServicesV1(unresolved.options)
      .verifiedCostSource(requestFor(unresolved))).toThrow(/unsupported Spell cost slice/);
    const unit = serviceCase(catalog, programs, ACTUAL_IDS.unit);
    expect(() => createP4KillSpellServicesV1(unit.options)
      .verifiedCostSource(requestFor(unit))).toThrow(/unsupported Spell cost slice/);

    const raw = JSON.parse(readFileSync(actualCatalogPath, "utf8")) as {
      readonly cards: readonly { readonly id: string; readonly ability: string }[];
    };
    const compoundCatalog = await loadCardCatalogRuntime({ catalog: {
      ...raw,
      cards: raw.cards.map(card => card.id === ACTUAL_IDS.killOne
        ? { ...card, ability: "Kill a unit. Draw 1." } : card),
    } });
    const compoundPrograms = createCardProgramAuthority(compoundCatalog);
    const compound = serviceCase(compoundCatalog, compoundPrograms, ACTUAL_IDS.killOne);
    expect(() => createP4KillSpellServicesV1(compound.options)
      .verifiedCostSource(requestFor(compound))).toThrow(/unsupported Spell cost slice/);
  });

  it("rejects stale head/epoch, unknown census source, cloned authority and wrong catalog binding", async () => {
    const catalog = await actualRuntime();
    if (!catalog) return;
    const programs = createCardProgramAuthority(catalog);
    const value = serviceCase(catalog, programs, ACTUAL_IDS.killOne);
    const service = createP4KillSpellServicesV1(value.options);
    const staleEpoch = requestFor(value, value.epoch + 1);
    expect(() => service.verifiedCostSource(staleEpoch)).toThrow(/current owned Hand card/);

    const foreignHead = { ...value.head, stateVersion: value.head.stateVersion + 1 } as DuelCanonicalPlayingStateV2;
    const stale = { ...value.options, getOperationHead: () => foreignHead };
    expect(() => createP4KillSpellServicesV1(stale).verifiedCostSource(requestFor(value)))
      .toThrow(/stale or foreign Spell cost transaction/);

    const unknownSource = serviceCase(catalog, programs, ACTUAL_IDS.killOne, [{
      uid: "unbound", sourceEpoch: 1, cardId: ACTUAL_IDS.killOne, ownerPlayerId: "alice",
      controllerPlayerId: "alice", programReference: "not-the-authority-reference",
      carrier: "object", zone: { kind: "hand", zonePlayerId: "alice" }, bindingRevision: 1, status: "live",
    }]);
    expect(() => createP4KillSpellServicesV1(unknownSource.options)
      .verifiedCostSource(requestFor(unknownSource))).toThrow(/unknown source program/);

    const clone = { ...programs } as CardProgramAuthority;
    expect(() => createP4KillSpellServicesV1({ ...value.options, programs: clone }))
      .toThrow(/genuine authority|live authority/);
    const wrongCatalog = { ...catalog, publicCatalog: {
      ...catalog.publicCatalog, dataVersion: `${catalog.publicCatalog.dataVersion}-wrong`,
    } } as CardCatalogRuntime;
    expect(() => createP4KillSpellServicesV1({ ...value.options, catalog: wrongCatalog }))
      .toThrow(/not bound to the current catalog/);
  });

  it("retains the numeric body and lets Core block insufficient resources", async () => {
    const catalog = await actualRuntime();
    if (!catalog) return;
    const programs = createCardProgramAuthority(catalog);
    const value = serviceCase(catalog, programs, ACTUAL_IDS.killAll);
    const service = createP4KillSpellServicesV1(value.options);
    expect(service.verifiedCostSource(requestFor(value)).base.cost).toEqual({
      energy: 9, power: [{ allowedDomains: ["Order"], amount: 3 }],
    });
    expect(service.coreServices.closure.killDamage).toBeUndefined();
    // The real Champion/Battlefield text is unresolved. This controlled Core
    // fixture keeps the actual Kill Spell tuple but is not public-room E2E.
    const raw = JSON.parse(readFileSync(actualCatalogPath, "utf8")) as {
      readonly schemaVersion: 1; readonly dataVersion: string; readonly digest: string;
      readonly cards: readonly { readonly id: string; readonly cardType: string;
        readonly ability: string }[];
    };
    const supportIds = new Set([ACTUAL_IDS.killAll, "unl-176-219", "unl-187-219",
      "ogn-214-298", "ogn-275-298", "ogn-277-298", "ogn-278-298"]);
    const supportCatalog = await loadCardCatalogRuntime({ catalog: {
      schemaVersion: raw.schemaVersion, dataVersion: raw.dataVersion, digest: raw.digest,
      policy: {}, cards: raw.cards.filter(card => supportIds.has(card.id)).map(card => ({
        ...card, ability: card.id === "unl-176-219" ? ""
          : card.id === "ogn-277-298" ? "When you hold here, draw 1." : card.ability,
      })),
    } });
    const native = nativeScene(supportCatalog, createCardProgramAuthority(supportCatalog));
    const nativeCostRequest = { kind: "card-play" as const, subjectId: ACTUAL_IDS.killAll,
      transactionId: JSON.stringify([native.main.matchId, native.main.stateVersion,
        "alice", "kill-cost", native.uid, native.main.physicalCardsByUID[native.uid]!.zoneEpoch]) };
    expect(native.spell.verifiedCostSource(nativeCostRequest).base.cost.energy).toBe(9);
    let result = playDuelSpellCardV2(native.spell.createSession(
      adoptAdmittedDuelPlayingSessionV2(native.main)), "alice", {
      commandId: "kill-cost", expectedVersion: native.main.stateVersion,
      command: { cardUID: native.uid },
    });
    expect(result.outcome.status).toBe("pending");
    native.spell.handoff(result);
    result = applyDuelSpellResourceCommandV2(result.session, "alice", {
      commandId: "kill-pay", expectedVersion: result.session.commandSession.match.stateVersion,
      command: { type: "pay-pending", paymentId: `spell-payment:${JSON.stringify(["alice", "kill-cost"])}` },
    });
    expect(result.outcome.status).not.toBe("applied");
    expect(result.session.commandSession.match.resources.players[0].runePool.energy).toBe(0);
    expect(result.session.commandSession.match.frame.pendingPayment).not.toBeNull();

    const funded = nativeScene(supportCatalog, createCardProgramAuthority(supportCatalog), true);
    let resolving = playDuelSpellCardV2(funded.spell.createSession(
      adoptAdmittedDuelPlayingSessionV2(funded.main)), "alice", {
      commandId: "funded-kill", expectedVersion: funded.main.stateVersion,
      command: { cardUID: funded.uid },
    });
    expect(resolving.outcome.status).toBe("pending");
    funded.spell.handoff(resolving);
    resolving = applyDuelSpellResourceCommandV2(resolving.session, "alice", {
      commandId: "funded-pay", expectedVersion: resolving.session.commandSession.match.stateVersion,
      command: { type: "pay-pending",
        paymentId: `spell-payment:${JSON.stringify(["alice", "funded-kill"])}` },
    });
    expect(resolving.outcome).toMatchObject({ status: "pending", step: "priority" });
    funded.spell.handoff(resolving);
    resolving = finalizeDuelSpellCardPlayV2(resolving.session, "alice");
    funded.spell.handoff(resolving);
    resolving = passDuelSpellPriorityV2(resolving.session, "alice");
    funded.spell.handoff(resolving);
    resolving = passDuelSpellPriorityV2(resolving.session, "bob");
    funded.spell.handoff(resolving);
    const blocked = resolveDuelSpellCardPlayV2(resolving.session, "alice");
    expect(blocked.outcome).toMatchObject({ status: "pending", step: "effect",
      reason: "effect-proof-pending" });
    const afterAttempt = blocked.session.commandSession.match;
    expect(afterAttempt.chainCards?.some(card => card.uid === funded.uid)).toBe(true);
    expect(afterAttempt.players[0].trash.some(card => card.uid === funded.uid)).toBe(false);
  });
});
