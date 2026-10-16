import {
  channelDuelRunesV2, commitDuelPlayingMutationV2, createDuelMatchV2,
  referenceDuelPhysicalCardV2, resolveDuelMulliganV2, resolveDuelTotalCostV2,
  type DuelCanonicalPlayingStateV2, type DuelMatchStateV2, type DuelSpellCommandDispatcherV2,
} from "@riftbound/engine-core/duel";
import { loadCardCatalogRuntime } from "../../../src/card-catalog.js";
import { createCardProgramAuthority } from "../../../src/duel/card-program-authority.js";
import { createDuelNativeOperationJournalV2 } from "../../../src/duel/operation-journal-v2.js";
import { createP4SpellServices } from "../../../src/duel/p4-spell-services.js";
import { createDuelProductionSourceServicesV2 } from "../../../src/duel/production-source-services-v2.js";
import { setupAdapterFixtureCatalog } from "./setup-adapter-catalog.js";

const spellId = "ogn-004-298";
const ids = new Set([spellId, "unl-176-219", "unl-187-219", "ogn-214-298",
  "ogn-275-298", "ogn-277-298", "ogn-278-298"]);
const metadata = {
  // The Basic Rune program requires this source stamp. Spell text below is a
  // controlled service fixture, not a claim about the official printing.
  matchId: "p4-spell-cost-fixture", dataVersion: "2026-10-15-official-gallery",
  catalogDigest: "sha256:e9635b38044140375c33d9e5d8e12c1c2386994dfaa9ae8ae6832a127ff9f73d",
  roster: ["alice", "bob"].map(playerId => ({ playerId, displayName: playerId })) as [
    { playerId: string; displayName: string }, { playerId: string; displayName: string }],
};
const seats = ["alice", "bob"].map(playerId => ({ playerId,
  mainDeck: Array.from({ length: 8 }, (_, i) => ({ uid: `${playerId}-spell-${i}`, cardId: spellId })),
  champion: { uid: `${playerId}-champion`, cardId: "unl-176-219" },
  legend: { uid: `${playerId}-legend`, cardId: "unl-187-219" },
  runeDeck: Array.from({ length: 4 }, (_, i) => ({ uid: `${playerId}-rune-${i}`,
    cardId: "ogn-214-298", domain: "Order" as const })),
  battlefields: ["ogn-275-298", "ogn-277-298", "ogn-278-298"].map((cardId, i) =>
    ({ instanceId: `${playerId}-field-${i}`, cardId })),
}));
function typeOf(cardId: string): "Other" | "Champion" | "Legend" | "Rune" | "Battlefield" {
  if (cardId === "unl-176-219") return "Champion";
  if (cardId === "unl-187-219") return "Legend";
  if (cardId === "ogn-214-298") return "Rune";
  if (cardId.startsWith("ogn-27")) return "Battlefield";
  return "Other";
}

export async function costFixture(unknown = false, loseAppliedAck = false, privateSnapshot?: () => unknown) {
  const cards = setupAdapterFixtureCatalog.cards.filter(card => ids.has(card.id)).map(card => ({
    ...card, ability: card.id === spellId ? "Draw 4." : card.cardType === "Legend"
      ? ":rb_energy_1:, :rb_exhaust:: Play a 1 :rb_might: Recruit unit token."
      : card.cardType === "Battlefield" ? "When you hold here, draw 1."
      : card.cardType === "Rune" ? card.ability : unknown && card.id === "unl-176-219"
        ? "Unverified source text." : "",
  }));
  const catalog = await loadCardCatalogRuntime({ catalog: { schemaVersion: 1,
    dataVersion: metadata.dataVersion, digest: metadata.catalogDigest, policy: {}, cards } });
  const programs = createCardProgramAuthority(catalog);
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
  if (head.stage !== "playing") throw new TypeError("fixture did not enter playing");
  const channel = channelDuelRunesV2(head, "alice", 1);
  journal.observe({ ancestor: head, descendant: channel,
    commits: [{ operationId: "channel-a", eventId: "channel-a", event: "channel" }] });
  head = channel;
  const main = commitDuelPlayingMutationV2(channel, draft => ({
    match: { ...draft,
      legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, state]) =>
        [uid, { ...state, readiness: "ready" }])),
      frame: { ...draft.frame, phase: "main", stateOpen: true,
      priorityPlayerId: "alice", turnPlayerId: "alice" } }, transitions: [],
  }));
  journal.observe({ ancestor: channel, descendant: main,
    commits: [{ operationId: "main-a", eventId: "main-a", event: "main" }] });
  head = main;
  const commands = new Map<string, { fingerprint: string; outcome?: unknown; claim: object }>();
  const committed = new Map<string, unknown>();
  let notificationCount = 0;
  let lastNotification: Parameters<NonNullable<DuelSpellCommandDispatcherV2["notifyCommitted"]>>[0] | null = null;
  const dispatcher = {
    claim: (request: { readonly actor: string; readonly commandId: string;
      readonly payloadFingerprint: string }) => {
      const key = `${request.actor}:${request.commandId}`;
      const old = commands.get(key);
      if (old) return old.fingerprint === request.payloadFingerprint
        ? { status: "duplicate" as const, outcome: old.outcome as never }
        : { status: "conflict" as const };
      const claim = { key };
      commands.set(key, { fingerprint: request.payloadFingerprint, claim });
      return { status: "new" as const, claim };
    },
    finish: (request: { readonly claim: unknown; readonly outcome: unknown }) => {
      const row = [...commands.values()].find(item => item.claim === request.claim);
      if (!row) throw new TypeError("unknown claim");
      row.outcome = request.outcome;
      if (loseAppliedAck && (request.outcome as { status?: string; cardUID?: string }).status === "applied" &&
          (request.outcome as { cardUID?: string }).cardUID !== undefined) {
        loseAppliedAck = false;
        throw new TypeError("simulated lost applied ACK");
      }
    },
    readCommitted: (ticket: { readonly idempotencyKey: string }) =>
      (committed.get(ticket.idempotencyKey) ?? null) as never,
    commitEffect: (request: { readonly ticket: { readonly idempotencyKey: string };
      readonly receipt: unknown }) => { committed.set(request.ticket.idempotencyKey, request.receipt); },
    notifyCommitted: (request: NonNullable<typeof lastNotification>) => {
      notificationCount += 1; lastNotification = request;
    },
  };
  const spell = createP4SpellServices({ catalog, programs,
    getOperationHead: () => head as DuelCanonicalPlayingStateV2,
    setOperationHead: value => { head = value; }, currentJournal: () => journal,
    observeNativePath: ({ ancestor, descendant, commits, stage }) => ({ ancestor, descendant,
      commits: commits.map((commit, index) => ({ operationId: `${stage}:${descendant.stateVersion}:${index}`,
        eventId: `${stage}:${descendant.stateVersion}:${index}`,
        event: commit.transitions.some(step => step.from.kind === "chain" && step.to.kind === "trash")
          ? "pre-exit" as const : commit.transitions.some(step =>
            step.from.kind === "main-deck" && step.to.kind === "hand")
            ? "draw" as const : "main" as const })) }),
    dispatcher, sourceAttestor: request => ({ matchId: request.match.matchId,
      actor: request.actor, paymentId: request.paymentId, sourceReference: request.sourceReference,
      sourceProofId: "test-source", mode: "current", sourceZoneEpoch: request.match.physicalCardsByUID[
        request.sourceReference.sourceUID]!.zoneEpoch,
      ...(request.taskId ? { taskId: request.taskId } : {}),
      ...(request.continuationId ? { continuationId: request.continuationId } : {}) }),
    closure: { draw: { randomIndex: upper => upper - 1 } },
    uidFactory: (() => { let index = 0; return () => `fixture-identity-${++index}`; })(),
    dispatcherSnapshot: privateSnapshot ?? (() => ({ commands: [...commands.entries()].map(([key, row]) =>
      ({ key, fingerprint: row.fingerprint, outcome: row.outcome ?? null })),
      committed: [...committed.keys()], notificationCount })) });
  const uid = main.players[0].hand[0]!.uid;
  const epoch = referenceDuelPhysicalCardV2(main, uid).zoneEpoch;
  const request = { kind: "card-play" as const, subjectId: spellId,
    transactionId: JSON.stringify([main.matchId, main.stateVersion, "alice", "spell-command", uid, epoch]) };
  return { catalog, programs, journal, spell, main, uid, epoch, request,
    head: () => head as DuelCanonicalPlayingStateV2,
    notificationCount: () => notificationCount,
    lastNotification: () => lastNotification };
}

