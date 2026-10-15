import { describe, expect, it } from "vitest";
import {
  adoptAdmittedDuelPlayingSessionV2, applyDuelOptionalUnitPaymentResourceCommandV3,
  beginDuelOptionalUnitPaymentV3, channelDuelRunesV2, commitDuelPlayingMutationV2,
  createDuelMatchV2, createDuelOptionalPlayChoiceAuthorityV1, createDuelUnitPlaySessionV2,
  inspectDuelOptionalUnitPaymentV3, referenceDuelPhysicalCardV2, resolveDuelMulliganV2,
  resumeDuelOptionalUnitPaymentV3, type DuelCanonicalPlayingStateV2,
  type DuelOptionalPlayReceiptV1, type DuelSourceAttestationRequestV2,
  type DuelUnitEntryRequestV2, type DuelUnitPlaySessionV2,
} from "@riftbound/engine-core/duel";
import { loadCardCatalogRuntime, validateCatalogDeck } from "../../src/card-catalog.js";
import { buildDuelSetupSeats } from "../../src/duel/setup-seats.js";
import { createCatalogCardTypeResolverV2 } from "../../src/duel/catalog-card-type-v2.js";
import { createDuelFuryOptionalRosterCardProgramAuthorityV1, getCardProgramRegistryForRuntime } from
  "../../src/duel/card-program-authority.js";
import { createP4OptionalUnitServices } from "../../src/duel/optional-unit-services-p4.js";
import { createDuelNativeOperationJournalV2 } from "../../src/duel/operation-journal-v2.js";
import { createOptionalUnitPaymentEntryV3 } from "../../src/duel/optional-unit-payment-entry-v3.js";
import { fury77RealDecks } from "./fixtures/fury77-real-decks.js";

const runtime = await loadCardCatalogRuntime();
const targetId = "ogn-010-298";
type Programs = ReturnType<typeof createDuelFuryOptionalRosterCardProgramAuthorityV1>;
type Journal = ReturnType<typeof createDuelNativeOperationJournalV2>;
type Flow = { session: DuelUnitPlaySessionV2; head: DuelCanonicalPlayingStateV2;
  request: DuelUnitEntryRequestV2; receipt: DuelOptionalPlayReceiptV1;
  choice: ReturnType<typeof createDuelOptionalPlayChoiceAuthorityV1>; journal: Journal; programs: Programs;
  entry: (request: DuelUnitEntryRequestV2) => any;
  setOwnerHead: (next: DuelCanonicalPlayingStateV2) => void };

function observe(flow: Flow, next: DuelCanonicalPlayingStateV2, label: string): void {
  flow.journal.observe({ ancestor: flow.head, descendant: next,
    commits: [{ operationId: `entry-v3:${label}:${next.stateVersion}`,
      eventId: `entry-v3:${label}:${next.eventSeq}`, event: label.startsWith("mulligan") ? "mulligan" : label === "runes" ? "channel" : "main" }] });
  flow.head = next;
}
function sync(flow: Flow, result: { session: DuelUnitPlaySessionV2 }, label: string): void {
  const next = result.session.commandSession.match as DuelCanonicalPlayingStateV2;
  flow.journal.observe({ ancestor: flow.session.commandSession.match, descendant: next,
    commits: [{ operationId: `entry-v3:${label}:${next.stateVersion}`,
      eventId: `entry-v3:${label}:${next.eventSeq}`, event: label === "pay" ? "required-cleanup" : "channel" }] });
  flow.session = result.session; flow.head = next; flow.setOwnerHead(next);
}

async function makeFlow(decision: "pay" | "decline"): Promise<Flow> {
  for (const deck of Object.values(fury77RealDecks)) expect(validateCatalogDeck(runtime, deck)).toMatchObject({ valid: true, issues: [] });
  let uid = 0;
  const setup = buildDuelSetupSeats(runtime, { matchId: `entry-v3-real-${decision}`, seats: [
    { playerId: "alice", displayName: "Alice", deck: fury77RealDecks.a },
    { playerId: "bob", displayName: "Bob", deck: fury77RealDecks.b },
  ] }, () => `entry-v3-real-${++uid}`);
  if (!setup.ok) throw new TypeError(`real setup failed: ${setup.code}`);
  const types = createCatalogCardTypeResolverV2(runtime);
  const genesis = createDuelMatchV2(setup.seats, setup.metadata, () => 0, types.forMatch(setup.metadata));
  let head: DuelCanonicalPlayingStateV2 | typeof genesis = genesis;
  let ownerHead = head;
  const programs = createDuelFuryOptionalRosterCardProgramAuthorityV1(runtime);
  const journal = createDuelNativeOperationJournalV2({ genesis, currentHead: () => ownerHead, programs });
  const root = { session: undefined as unknown as DuelUnitPlaySessionV2,
    head: undefined as unknown as DuelCanonicalPlayingStateV2,
    request: undefined as unknown as DuelUnitEntryRequestV2,
    receipt: undefined as unknown as DuelOptionalPlayReceiptV1,
    choice: undefined as unknown as ReturnType<typeof createDuelOptionalPlayChoiceAuthorityV1>, journal, programs,
    entry: undefined as unknown as (request: DuelUnitEntryRequestV2) => any,
    setOwnerHead: next => { ownerHead = next; } };
  for (const actor of ["alice", "bob"] as const) { const next = resolveDuelMulliganV2(head, actor, []); root.head = head; observe(root, next, `mulligan-${actor}`); head = next; ownerHead = next; }
  const runes = channelDuelRunesV2(head, "alice", 4); root.head = head; observe(root, runes, "runes"); head = runes; ownerHead = runes;
  const main = commitDuelPlayingMutationV2(head, draft => ({ match: { ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([id, state]) => [id, { ...state, readiness: "ready" }])),
    frame: { ...draft.frame, phase: "main", stateOpen: true, priorityPlayerId: "alice", turnPlayerId: "alice" } }, transitions: [] }));
  root.head = head; observe(root, main, "main"); head = main; ownerHead = main;
  if (head.stage !== "playing") throw new TypeError("real fixture did not enter playing");
  const target = head.players[0].hand.find(card => card.cardId === targetId); if (!target) throw new TypeError("target was not dealt");
  const bare = createP4OptionalUnitServices({ catalog: runtime, programs, getOperationHead: () => head,
    currentJournal: () => root.journal, inspectChoice: value => root.choice.inspectReceipt(value) });
  const choice = createDuelOptionalPlayChoiceAuthorityV1({ readHead: () => root.head, readSource: bare.readSource,
    nextOpaqueId: (() => { let i = 0; return () => `entry-v3-choice-${++i}`; })() }); root.choice = choice;
  const prompt = choice.issue({ actor: "alice", commandId: `entry-v3-play-${decision}`, expectedVersion: head.stateVersion, uid: target.uid });
  const receipt = choice.answer({ actor: "alice", commandId: `entry-v3-play-${decision}`, expectedVersion: head.stateVersion,
    choiceId: prompt.choiceId, optionId: decision === "pay" ? prompt.payOptionId : prompt.declineOptionId });
  const adapter = createOptionalUnitPaymentEntryV3({ catalog: runtime, programs, currentHead: () => root.head,
    currentJournal: () => root.journal, currentUnitSession: () => root.session,
    inspectChoice: value => choice.inspectReceipt(value) });
  const services = createP4OptionalUnitServices({ catalog: runtime, programs, getOperationHead: () => root.head,
    currentJournal: () => root.journal, inspectChoice: value => choice.inspectReceipt(value), entry: adapter.entryForReceipt(receipt) });
  const source = bare.readSource(head, "alice", target.uid);
  const data = choice.inspectReceipt(receipt);
  const cost = services.cost({ transactionId: JSON.stringify(["optional-unit-v3", head.matchId,
    head.stateVersion, "alice", data.commandId, target.uid, source.sourceEpoch, decision]),
    cardId: target.cardId, actor: "alice", uid: target.uid, sourceEpoch: source.sourceEpoch,
    choice: decision, description: bare.program({ match: head, matchId: head.matchId,
      dataVersion: head.dataVersion, catalogDigest: head.catalogDigest, actor: "alice", uid: target.uid,
      cardId: target.cardId, sourceEpoch: source.sourceEpoch }).description, receipt: data });
  const paymentAuthority = { sourceAttestor: (request: DuelSourceAttestationRequestV2) => {
      const sourceUID = request.sourceReference.sourceUID; const physical = request.match.physicalCardsByUID[sourceUID ?? ""];
      if (!sourceUID || !physical || physical.ownerPlayerId !== request.actor || physical.cardId !== request.sourceReference.referenceId) throw new TypeError("payment source");
      return { matchId: request.match.matchId, actor: request.actor, paymentId: request.paymentId,
        sourceReference: request.sourceReference, sourceProofId: `entry-v3-proof:${request.paymentId}`, mode: "current",
        sourceZoneEpoch: referenceDuelPhysicalCardV2(request.match, sourceUID).zoneEpoch,
        ...(request.taskId ? { taskId: request.taskId } : {}), ...(request.continuationId ? { continuationId: request.continuationId } : {}) };
    } };
  const session = createDuelUnitPlaySessionV2(adoptAdmittedDuelPlayingSessionV2(head), {
    programs: getCardProgramRegistryForRuntime(programs), cost,
    costBinding: services.costBinding,
    entry: services.entry, optional: services.unitServices,
    optionalPaymentV3: paymentAuthority,
  });
  root.session = session; root.head = head; root.entry = adapter.entryForReceipt(receipt); root.request = { match: head, matchId: head.matchId,
    stateVersion: head.stateVersion, eventSeq: head.eventSeq, actor: "alice", uid: target.uid, cardId: target.cardId,
    sourceEpoch: bare.readSource(head, "alice", target.uid).sourceEpoch, baseLocationId: head.board.bases.find(base => base.ownerPlayerId === "alice")!.locationId,
    programId: bare.readSource(head, "alice", target.uid).sourceProgramFingerprint }; root.receipt = receipt;
  return root;
}

function fund(flow: Flow, started: ReturnType<typeof beginDuelOptionalUnitPaymentV3>) {
  let current = started.session;
  flow.session = current;
  const match = current.commandSession.match;
  if (match.stage !== "playing" || !match.frame.pendingPayment) throw new Error("canonical pending payment required");
  const finalCost = match.frame.pendingPayment.resolvedCost;
  for (let index = 0; index < finalCost.energy; index++) {
    const runes = current.commandSession.match.resources.bases.find(base => base.playerId === "alice")!.baseRunes;
    const rune = runes.find(rune => rune.readied);
    if (!rune) throw new Error("real funding rune required");
    const result = applyDuelOptionalUnitPaymentResourceCommandV3(current, "alice", {
      commandId: `entry-v3-energy-${index}`, expectedVersion: current.commandSession.match.stateVersion,
      command: { type: "rune-energy", uid: rune.uid } });
    expect(result.outcome.status).toBe("applied"); sync(flow, result, "energy"); current = result.session;
  }
  for (const requirement of finalCost.power) {
    for (let index = 0; index < requirement.amount; index++) {
      const runes = current.commandSession.match.resources.bases.find(base => base.playerId === "alice")!.baseRunes;
      const rune = runes.find(rune => requirement.allowedDomains.includes(rune.domain));
      if (!rune) throw new Error("real matching-domain rune required");
      const result = applyDuelOptionalUnitPaymentResourceCommandV3(current, "alice", {
        commandId: `entry-v3-power-${rune.uid}`, expectedVersion: current.commandSession.match.stateVersion,
        command: { type: "rune-power", uid: rune.uid } });
      expect(result.outcome.status).toBe("applied"); sync(flow, result, "power"); current = result.session;
    }
  }
  const paid = applyDuelOptionalUnitPaymentResourceCommandV3(current, "alice", {
    commandId: "entry-v3-pay", expectedVersion: current.commandSession.match.stateVersion,
    command: { type: "pay-pending", paymentId: started.outcome.status === "pending" ? started.outcome.paymentId : "" } });
  expect(paid.outcome.status).toBe("applied"); sync(flow, paid, "pay"); return paid;
}

describe("optional Unit payment entry adapter V3", () => {
  it.each(["pay", "decline"] as const)("completes genuine Fury 56-card %s payment and entry", async decision => {
    const flow = await makeFlow(decision);
    expect(flow.journal.readCostCensus()!.sources.filter(source => source.carrier === "object")).toHaveLength(108);
    const started = beginDuelOptionalUnitPaymentV3(flow.session, "alice", {
      commandId: `entry-v3-play-${decision}`, expectedVersion: flow.head.stateVersion,
      command: { cardUID: flow.request.uid, choiceReceipt: flow.receipt } });
    expect(started.outcome.status).toBe("pending");
    expect(inspectDuelOptionalUnitPaymentV3(started.session)?.applications).toHaveLength(decision === "pay" ? 1 : 0);
    sync(flow, started, "begin");
    flow.journal = flow.journal.fork(() => flow.head);
    const paid = fund(flow, started);
    expect(flow.head.stateVersion).toBeGreaterThan(flow.request.stateVersion);
    expect(() => flow.choice.inspectReceipt(flow.receipt)).toThrow(/stale receipt/);
    const currentRequest = { ...flow.request, match: flow.head, stateVersion: flow.head.stateVersion,
      eventSeq: flow.head.eventSeq };
    expect(flow.entry(currentRequest)).toMatchObject({ sourceCensus: "complete", scopes: {
      play: "clear", replacement: "clear", static: "clear", trigger: "clear", pendingTasks: "clear", chain: "clear" } });
    const envelope = { commandId: `entry-v3-resume-${decision}`,
      expectedVersion: paid.session.commandSession.match.stateVersion, command: { cardUID: flow.request.uid } };
    const resumed = resumeDuelOptionalUnitPaymentV3(paid.session, "alice", envelope);
    expect(resumed.outcome.status).toBe("applied");
    expect((resumed.session.commandSession.match as DuelCanonicalPlayingStateV2).unitMeta[flow.request.uid]!.readied).toBe(decision === "pay");
    expect(resumed.session.commandSession.match.board.units.filter(unit => unit.objectId === flow.request.uid)).toHaveLength(1);
    const repeated = resumeDuelOptionalUnitPaymentV3(resumed.session, "alice", envelope);
    expect(repeated.duplicate).toBe(true);
    expect(repeated.persistRequired).toBe(false);
    expect(repeated.session).toBe(resumed.session);
    expect(repeated.outcome).toEqual(resumed.outcome);
  });
  it("fails closed for cloned receipt, cloned session, foreign head, and preserves initial Core admission", async () => {
    const flow = await makeFlow("pay");
    const adapter = createOptionalUnitPaymentEntryV3({ catalog: runtime, programs: flow.programs, currentHead: () => flow.head,
      currentJournal: () => flow.journal, currentUnitSession: () => flow.session, inspectChoice: value => flow.choice.inspectReceipt(value) });
    expect(adapter.entryForReceipt(flow.receipt)(flow.request).sourceCensus).toBe("complete");
    expect(adapter.entryForReceipt(structuredClone(flow.receipt) as DuelOptionalPlayReceiptV1)(flow.request).sourceCensus).toBe("unknown");
    expect(adapter.entryForReceipt(flow.receipt)({ ...flow.request, match: structuredClone(flow.head) }).sourceCensus).toBe("unknown");
    expect(adapter.entryForReceipt(flow.receipt)({ ...flow.request, actor: "bob" }).sourceCensus).toBe("unknown");
    expect(inspectDuelOptionalUnitPaymentV3(flow.session)).toBeNull();
  });
  it("rejects copied sessions and journals, permits a genuine same-generation fork, and poisons outer reentry", async () => {
    const flow = await makeFlow("pay");
    let currentSession = flow.session;
    let currentJournal = flow.journal;
    let nested = false;
    let service: typeof flow.entry;
    const adapter = createOptionalUnitPaymentEntryV3({ catalog: runtime, programs: flow.programs,
      currentHead: () => flow.head, currentJournal: () => currentJournal,
      currentUnitSession: () => {
        if (nested) { nested = false; service(flow.request); }
        return currentSession;
      }, inspectChoice: value => flow.choice.inspectReceipt(value) });
    service = adapter.entryForReceipt(flow.receipt);
    expect(service(flow.request).sourceCensus).toBe("complete");
    currentSession = { ...flow.session };
    expect(service(flow.request).sourceCensus).toBe("unknown");
    currentSession = flow.session;
    currentJournal = flow.journal.fork(() => flow.head);
    expect(service(flow.request).sourceCensus).toBe("complete");
    const fork = currentJournal;
    currentJournal = { ...fork };
    expect(service(flow.request).sourceCensus).toBe("unknown");
    currentJournal = (await makeFlow("pay")).journal;
    expect(service(flow.request).sourceCensus).toBe("unknown");
    currentJournal = fork;
    nested = true;
    expect(service(flow.request).sourceCensus).toBe("unknown");
    expect(service(flow.request).sourceCensus).toBe("complete");
  });

});
