import { describe, expect, it } from "vitest";
import {
  channelDuelRunesV2,
  commitDuelPlayingMutationV2,
  enumerateDuelPhaseSourceClosureCandidatesV2,
  createDuelMatchV2,
  resolveDuelMulliganV2,
  appendDuelChainItemV2, createDuelChainExecutorV2, createDuelChainResolutionAuthorityV2,
  createDuelChainV2, finalizeDuelChainItemV2, passDuelChainPriorityV2,
  requestDuelChainResolutionV2, queryDuelChainCommittedProofV2,
  type DuelCanonicalPlayingStateV2,
  type DuelMatchStateV2,
  type DuelPhaseSourceClosureContextV2,
} from "@riftbound/engine-core/duel";
import {
  createDuelNativeOperationJournalV2,
} from "../../src/duel/operation-journal-v2.js";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { createCardProgramAuthority } from "../../src/duel/card-program-authority.js";
import { setupAdapterFixtureCatalog } from "./fixtures/setup-adapter-catalog.js";

const seats = ["alice", "bob"].map(playerId => ({
  playerId,
  mainDeck: Array.from({ length: 8 }, (_, i) => ({ uid: `${playerId}-card-${i}`, cardId: "ogn-001-298" })),
  champion: { uid: `${playerId}-champion`, cardId: "unl-176-219" },
  legend: { uid: `${playerId}-legend`, cardId: "unl-187-219" },
  runeDeck: Array.from({ length: 4 }, (_, i) => ({ uid: `${playerId}-rune-${i}`, cardId: "ogn-214-298", domain: "Order" as const })),
  battlefields: ["ogn-275-298", "ogn-277-298", "ogn-278-298"].map((cardId, i) => ({ instanceId: `${playerId}-field-${i}`, cardId })),
}));

const metadata = {
  matchId: "native-operation-journal-fixture",
  // Matches the intrinsic Basic Rune source stamp. Other abilities below are controlled test programs.
  dataVersion: "2026-10-12-official-gallery",
  catalogDigest: "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10",
  roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })) as [
    { playerId: string; displayName: string }, { playerId: string; displayName: string }
  ],
};

function typeOf(cardId: string): "Unit" | "Champion" | "Legend" | "Rune" | "Battlefield" {
  if (cardId === "unl-176-219") return "Champion";
  if (cardId === "unl-187-219") return "Legend";
  if (cardId === "ogn-214-298") return "Rune";
  if (cardId.startsWith("ogn-27")) return "Battlefield";
  return "Unit";
}

function create() {
  return createDuelMatchV2(seats, metadata, () => 0, typeOf);
}

function playing(setup: DuelMatchStateV2): DuelCanonicalPlayingStateV2 {
  let current = setup;
  while (current.stage === "setup") {
    const actor = current.turnOrder.find(id => current.stage === "setup" &&
      current.setup.players.find(player => player.playerId === id)?.mulliganStatus === "pending")!;
    current = resolveDuelMulliganV2(current, actor, []);
  }
  return current;
}

function context(head: DuelCanonicalPlayingStateV2, event: "channel" | "main" = "channel"):
    DuelPhaseSourceClosureContextV2 {
  return {
    matchId: head.matchId,
    dataVersion: head.dataVersion,
    catalogDigest: head.catalogDigest,
    turn: head.frame.turnNumber,
    taskId: `duel-v2:${head.matchId}:turn-${head.frame.turnNumber}:${event}:0`,
    phase: event,
    event,
    clock: { stateVersion: head.stateVersion, eventSeq: head.eventSeq },
  };
}

async function observedFixture() {
  const cards = setupAdapterFixtureCatalog.cards
    .filter(card => ["ogn-001-298", "unl-176-219", "unl-187-219", "ogn-214-298", "ogn-275-298", "ogn-277-298", "ogn-278-298"].includes(card.id))
    .map(card => ({ ...card, ability: card.cardType === "Rune" ? card.ability :
      card.cardType === "Legend" ? ":rb_energy_1:, :rb_exhaust:: Play a 1 :rb_might: Recruit unit token." :
        card.cardType === "Battlefield" ? "When you hold here, draw 1." : "" }));
  const loaded = await loadCardCatalogRuntime({ catalog: { schemaVersion: 1,
    dataVersion: metadata.dataVersion, digest: metadata.catalogDigest, policy: {}, cards } });
  const programs = createCardProgramAuthority(loaded);
  const genesis = create();
  let head: DuelMatchStateV2 = genesis;
  const journal = createDuelNativeOperationJournalV2({ genesis, currentHead: () => head, programs });
  const first = resolveDuelMulliganV2(genesis, "alice", []);
  head = first;
  journal.observe({ ancestor: genesis, descendant: first, commits: [{ operationId: "m-1", eventId: "m-1", event: "mulligan" }] });
  const second = playing(first);
  head = second;
  journal.observe({ ancestor: first, descendant: second, commits: [{ operationId: "m-2", eventId: "m-2", event: "mulligan" }] });
  const ready = channelDuelRunesV2(second, "alice", 1);
  head = ready;
  journal.observe({ ancestor: second, descendant: ready, commits: [{ operationId: "channel", eventId: "channel", event: "channel" }] });
  journal.bindContext(context(ready));
  return { journal, programs, genesis, head: () => head as DuelCanonicalPlayingStateV2,
    setHead: (value: DuelMatchStateV2) => { head = value; } };
}

describe("native operation journal V2", () => {
  it.each(["draw", "pre-exit"] as const)("cannot hide a playing %s transfer behind a setup label", async event => {
    const f = await observedFixture(), before = f.head();
    const card = event === "draw" ? before.players[0].remainingMainDeck[0]! : before.players[0].hand[0]!;
    const from = event === "draw" ? "main-deck" as const : "hand" as const;
    const to = event === "draw" ? "hand" as const : "trash" as const;
    const after = commitDuelPlayingMutationV2(before, draft => ({
      match: { ...draft, players: [{ ...draft.players[0],
        remainingMainDeck: event === "draw" ? draft.players[0].remainingMainDeck.slice(1) : draft.players[0].remainingMainDeck,
        hand: event === "draw" ? [...draft.players[0].hand, card] : draft.players[0].hand.filter(c => c.uid !== card.uid),
        trash: event === "pre-exit" ? [...draft.players[0].trash, card] : draft.players[0].trash }, draft.players[1]] },
      transitions: [{ uid: card.uid, from: { kind: from, zonePlayerId: "alice" }, to: { kind: to, zonePlayerId: "alice" } }],
    }));
    f.setHead(after);
    expect(() => f.journal.observe({ ancestor: before, descendant: after,
      commits: [{ operationId: `mislabel-${event}`, eventId: `mislabel-${event}`, event: "mulligan" }] })).toThrow(/setup/);
    expect(f.journal.observedHead()).toBe(before);
    expect(f.journal.read(context(after))).toBeNull();
  });

  it("does not close runtime work with a proof string, a copied capability or a foreign Chain", async () => {
    const f = await observedFixture(), current = f.head(), c = context(current);
    const source = enumerateDuelPhaseSourceClosureCandidatesV2(current).find(s => s.cardId === "ogn-001-298")!;
    const effectId = "runtime-draw-effect";
    const authority = createDuelChainResolutionAuthorityV2(ticket => ({ status: "committed",
      idempotencyKey: ticket.idempotencyKey, chainId: ticket.chainId, itemId: ticket.itemId,
      executorId: ticket.executorId, produced: [] }));
    const executor = createDuelChainExecutorV2();
    const makeProof = (chainAuthority: typeof authority, chainId: string) => {
      let chain = createDuelChainV2({ chainId, turnOrder: ["alice", "bob"],
        closeContext: { kind: "main-phase", returnPriorityPlayerId: "alice" }, resolutionAuthority: chainAuthority });
      chain = appendDuelChainItemV2(chain, { actor: "alice", expectedVersion: chain.stateVersion,
        item: { id: effectId, kind: "opaque-effect", controllerPlayerId: "alice", resolutionMode: "fepr" }, executor });
      chain = finalizeDuelChainItemV2(chain, { actor: "alice", expectedVersion: chain.stateVersion });
      chain = passDuelChainPriorityV2(chain, { actor: "alice", expectedVersion: chain.stateVersion });
      chain = passDuelChainPriorityV2(chain, { actor: "bob", expectedVersion: chain.stateVersion });
      const selected = requestDuelChainResolutionV2(chain, { expectedVersion: chain.stateVersion, executor });
      return queryDuelChainCommittedProofV2(chainAuthority, selected.ticket)!;
    };
    f.journal.registerRuntimeEffect({ ledger: "effectQueue", operationId: "channel", context: c,
      entry: { effectId, eventId: "channel", kind: "queued-effect", sourceUID: source.uid,
        sourceZoneEpoch: source.zoneEpoch!, cardId: source.cardId, controllerPlayerId: source.controllerPlayerId,
        zone: source.zone, programReference: f.programs.resolvedProgramReference(source.cardId!)!.encodedReference },
      resolutionBinding: { authority, chainId: "owned-effect-chain", executorId: executor.executorId },
      resolution: { eventId: "channel", proofId: "self-signed-text" },
    });
    expect(f.journal.read(c)).toBeNull();
    const retirement = { ledger: "effectQueue" as const, operationId: "channel", context: c, effectId };
    expect(() => f.journal.retireRuntimeEffect(retirement)).toThrow(/committed executor proof/);
    const foreign = createDuelChainResolutionAuthorityV2(ticket => ({ status: "committed",
      idempotencyKey: ticket.idempotencyKey, chainId: ticket.chainId, itemId: ticket.itemId,
      executorId: ticket.executorId, produced: [] }));
    expect(() => f.journal.retireRuntimeEffect({ ...retirement, committedProof: makeProof(foreign, "owned-effect-chain") })).toThrow(/this effect/);
    const proof = makeProof(authority, "owned-effect-chain");
    expect(() => f.journal.retireRuntimeEffect({ ...retirement, committedProof: { ...proof } })).toThrow(/untrusted-proof/);
    expect(f.journal.read(c)).toBeNull();
    f.journal.retireRuntimeEffect({ ...retirement, committedProof: proof });
    expect(f.journal.read(c)?.input.effectQueue.status).toBe("empty");
  });

  it("records every intermediate physical epoch in a single native round trip", async () => {
    const f = await observedFixture(), before = f.head(), uid = before.players[0].hand[0]!.uid;
    const after = commitDuelPlayingMutationV2(before, draft => ({ match: draft, transitions: [
      { uid, from: { kind: "hand", zonePlayerId: "alice" }, to: { kind: "chain", zonePlayerId: "alice" } },
      { uid, from: { kind: "chain", zonePlayerId: "alice" }, to: { kind: "hand", zonePlayerId: "alice" } },
    ] }));
    f.setHead(after);
    f.journal.observe({ ancestor: before, descendant: after, commits: [{ operationId: "round-trip", eventId: "round-trip", event: "zone-transition" }] });
    const c = { ...context(after, "main"), event: "zone-transition" as const };
    f.journal.bindContext(c);
    const trace = f.journal.read(c)!.input.transitions;
    expect(trace.map(t => [t.fromZoneEpoch, t.toZoneEpoch])).toEqual([[0, 1], [1, 2]]);
  });

  it("keeps a pending source obligation outstanding when another context and head are observed", async () => {
    const f = await observedFixture(), before = f.head();
    const source = enumerateDuelPhaseSourceClosureCandidatesV2(before).find(s => s.cardId === "ogn-001-298")!;
    f.journal.registerSourceWork({ operationId: "channel", context: context(before), sourceUID: source.uid,
      zoneEpoch: source.zoneEpoch!, controllerPlayerId: source.controllerPlayerId,
      programReference: f.programs.resolvedProgramReference(source.cardId!)!.encodedReference });
    const after = channelDuelRunesV2(before, "alice", 1);
    f.setHead(after);
    f.journal.observe({ ancestor: before, descendant: after, commits: [{ operationId: "channel-2", eventId: "channel-2", event: "channel" }] });
    f.journal.bindContext(context(after, "main"));
    expect(f.journal.read(context(after, "main"))).toBeNull();
  });

  it("forks an owned proposal without advancing or aliasing the published journal", async () => {
    const f = await observedFixture(), before = f.head();
    let proposalHead = before;
    const fork = f.journal.fork(() => proposalHead);
    const after = channelDuelRunesV2(before, "alice", 1);
    proposalHead = after;
    fork.observe({ ancestor: before, descendant: after, commits: [{ operationId: "proposal", eventId: "proposal", event: "channel" }] });
    fork.bindContext(context(after));
    expect(fork.read(context(after))?.status).toBe("resolved");
    expect(f.journal.observedHead()).toBe(before);
    expect(f.journal.read(context(before))?.status).toBe("resolved");
    expect(f.journal.listCommits()).toHaveLength(3);
    expect(fork.listCommits()).toHaveLength(4);
  });

  it("requires a genuine program facade and allows a before-Draw boundary with no fabricated Draw subject", async () => {
    const f = await observedFixture();
    expect(() => createDuelNativeOperationJournalV2({ genesis: f.genesis, programs: { ...f.programs } })).toThrow();
    const c = { ...context(f.head(), "main"), phase: "draw" as const, event: "draw" as const };
    f.journal.bindContext(c);
    expect(f.journal.read(c)?.input.drawSubjects).toEqual([]);
    const subject = { ...c, event: "draw-subject" as const };
    f.journal.bindContext(subject);
    expect(f.journal.read(subject)).toBeNull();
  });
  it("observes every native commit and exposes an exact current bound read", async () => {
    const genesis = create();
    let head: DuelMatchStateV2 = genesis;
    const cards = setupAdapterFixtureCatalog.cards
      .filter(card => ["ogn-001-298", "unl-176-219", "unl-187-219", "ogn-214-298", "ogn-275-298", "ogn-277-298", "ogn-278-298"].includes(card.id))
      // Controlled complete programs for fact-journal tests; this is not official effect execution.
      .map(card => ({ ...card, ability: card.cardType === "Rune" ? card.ability :
        card.cardType === "Legend" ? ":rb_energy_1:, :rb_exhaust:: Play a 1 :rb_might: Recruit unit token." :
          card.cardType === "Battlefield" ? "When you hold here, draw 1." : "" }));
    const loaded = await loadCardCatalogRuntime({ catalog: {
      schemaVersion: 1,
      dataVersion: metadata.dataVersion,
      digest: metadata.catalogDigest,
      policy: {}, cards,
    } });
    const authority = createCardProgramAuthority(loaded);
    const journal = createDuelNativeOperationJournalV2({
      genesis,
      currentHead: () => head,
      programs: authority,
    });
    const first = resolveDuelMulliganV2(genesis, "alice", []);
    head = first;
    journal.observe({ ancestor: genesis, descendant: first, commits: [{
      operationId: "mulligan-alice", eventId: "mulligan-alice", event: "mulligan",
    }] });
    const main = playing(first);
    head = main;
    journal.observe({ ancestor: first, descendant: main, commits: [{
      operationId: "mulligan-bob", eventId: "mulligan-bob", event: "mulligan",
    }] });
    const channelled = channelDuelRunesV2(main, "alice", 2);
    head = channelled;
    journal.observe({ ancestor: main, descendant: channelled, commits: [{
      operationId: "channel-alice", eventId: "channel-alice", event: "channel",
      phase: "channel", taskId: `duel-v2:${main.matchId}:turn-${channelled.frame.turnNumber}:channel:0`,
    }] });
    const bound = context(channelled);
    journal.bindContext(bound, "channel-alice");
    const snapshot = journal.read(bound);
    expect(snapshot?.status).toBe("resolved");
    expect(snapshot?.input.transitions.length).toBe(2);
    expect(snapshot?.input.transitions.every(item => item.from.kind === "rune-deck" && item.to.kind === "board-base")).toBe(true);
    expect(snapshot?.candidateKeys.length).toBeGreaterThan(0);
    expect(journal.listCommits()).toHaveLength(3);
  });

  it("refuses cloned, sibling, stale and unbound reads", () => {
    const genesis = create();
    let head: DuelMatchStateV2 = genesis;
    const journal = createDuelNativeOperationJournalV2({ genesis, currentHead: () => head });
    const first = resolveDuelMulliganV2(genesis, "alice", []);
    head = first;
    journal.observe({ ancestor: genesis, descendant: first, commits: [{
      operationId: "mulligan-alice", eventId: "mulligan-alice", event: "mulligan",
    }] });
    expect(() => journal.observe({ ancestor: structuredClone(genesis), descendant: first, commits: [] })).toThrow(/ancestor/);
    expect(() => journal.observe({ ancestor: genesis, descendant: structuredClone(first), commits: [{
      operationId: "clone", eventId: "clone", event: "mulligan",
    }] })).toThrow(/ancestor/);
    const main = playing(first);
    head = main;
    journal.observe({ ancestor: first, descendant: main, commits: [{
      operationId: "mulligan-bob", eventId: "mulligan-bob", event: "mulligan",
    }] });
    const stale: DuelCanonicalPlayingStateV2 = structuredClone(main) as never;
    expect(journal.read(context(stale))).toBeNull();
    expect(journal.read({ ...context(main), taskId: "foreign-task" })).toBeNull();
  });

  it("does not let pending source work or unknown events certify closure", () => {
    const genesis = create();
    let head: DuelMatchStateV2 = genesis;
    const journal = createDuelNativeOperationJournalV2({ genesis, currentHead: () => head });
    const first = resolveDuelMulliganV2(genesis, "alice", []);
    head = first;
    journal.observe({ ancestor: genesis, descendant: first, commits: [{
      operationId: "mulligan-alice", eventId: "mulligan-alice", event: "unknown",
    }] });
    const main = playing(first);
    head = main;
    journal.observe({ ancestor: first, descendant: main, commits: [{
      operationId: "mulligan-bob", eventId: "mulligan-bob", event: "mulligan",
    }] });
    const channelled = channelDuelRunesV2(main, "alice", 1);
    head = channelled;
    journal.observe({ ancestor: main, descendant: channelled, commits: [{
      operationId: "unknown-channel", eventId: "unknown-channel", event: "unknown",
    }] });
    const unknown = context(channelled);
    journal.bindContext(unknown, "unknown-channel");
    expect(journal.read(unknown)).toBeNull();
    expect(journal.tokenBirth("missing-token")).toBeNull();
  });
});

