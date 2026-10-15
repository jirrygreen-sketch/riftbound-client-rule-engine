import { describe, expect, it } from "vitest";
import {
  commitDuelPlayingMutationV2,
  createDuelMatchV2,
  enumerateDuelPhaseSourceClosureCandidatesV2,
  resolveDuelMulliganV2,
  type DuelMatchStateV2,
} from "@riftbound/engine-core/duel";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { createCardProgramAuthority } from "../../src/duel/card-program-authority.js";
import {
  createDuelNativeOperationJournalV2,
  inspectDuelNativeOperationJournalBindingV2,
} from "../../src/duel/operation-journal-v2.js";
import { setupAdapterFixtureCatalog } from "./fixtures/setup-adapter-catalog.js";

const stamp = { dataVersion: "2026-10-12-official-gallery",
  digest: "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10" };
const cards = setupAdapterFixtureCatalog.cards.filter(card =>
  ["ogn-001-298", "ogn-002-298", "ogn-214-298", "unl-176-219", "unl-187-219",
    "ogn-275-298", "ogn-277-298", "ogn-278-298"].includes(card.id));

function cardType(cardId: string): "Unit" | "Champion" | "Legend" | "Rune" | "Battlefield" {
  if (cardId === "unl-176-219") return "Champion";
  if (cardId === "unl-187-219") return "Legend";
  if (cardId === "ogn-214-298") return "Rune";
  if (cardId.startsWith("ogn-27")) return "Battlefield";
  return "Unit";
}

async function fixture() {
  const catalog = await loadCardCatalogRuntime({ catalog: { schemaVersion: 1, ...stamp,
    policy: {}, cards: cards.map(card => ({ ...card, ability: card.cardType === "Battlefield"
      ? "When you hold here, draw 1." : card.cardType === "Legend"
        ? ":rb_energy_1:, :rb_exhaust:: Play a 1 :rb_might: Recruit unit token." : card.ability })) } });
  const programs = createCardProgramAuthority(catalog);
  const seats = ["alice", "bob"].map(playerId => ({ playerId,
    mainDeck: Array.from({ length: 8 }, (_, i) => ({ uid: `${playerId}-main-${i}`,
      cardId: i === 1 ? "ogn-001-298" : "ogn-002-298" })),
    champion: { uid: `${playerId}-champion`, cardId: "unl-176-219" },
    legend: { uid: `${playerId}-legend`, cardId: "unl-187-219" },
    runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`,
      cardId: "ogn-214-298", domain: "Order" as const })),
    battlefields: ["ogn-275-298", "ogn-277-298", "ogn-278-298"].map((cardId, i) =>
      ({ instanceId: `${playerId}-field-${i}`, cardId })),
  }));
  const metadata = { matchId: "optional-native-journal-nominal-binding",
    dataVersion: stamp.dataVersion, catalogDigest: stamp.digest,
    roster: ["alice", "bob"].map(playerId => ({ playerId, displayName: playerId })) as
      [{ playerId: string; displayName: string }, { playerId: string; displayName: string }] };
  const genesis = createDuelMatchV2(seats, metadata, () => 0, cardType);
  let head: DuelMatchStateV2 = genesis;
  const states: DuelMatchStateV2[] = [genesis];
  const journal = createDuelNativeOperationJournalV2({ genesis, currentHead: () => head, programs });
  const first = resolveDuelMulliganV2(genesis, "alice", []);
  head = first;
  states.push(first);
  journal.observe({ ancestor: genesis, descendant: first,
    commits: [{ operationId: "nominal-mulligan-a", eventId: "nominal-mulligan-a", event: "mulligan" }] });
  while (head.stage === "setup") {
    const actor = head.turnOrder.find(id =>
      head.setup.players.find(player => player.playerId === id)?.mulliganStatus === "pending")!;
    const next = resolveDuelMulliganV2(head, actor, []);
    journal.observe({ ancestor: head, descendant: next,
      commits: [{ operationId: `nominal-mulligan-${next.stateVersion}`,
        eventId: `nominal-mulligan-${next.stateVersion}`, event: "mulligan" }] });
    head = next;
    states.push(next);
  }
  if (head.stage !== "playing") throw new TypeError("fixture did not enter playing");
  const opened = commitDuelPlayingMutationV2(head, draft => ({ match: { ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, state]) =>
      [uid, { ...state, readiness: "ready" }])),
    frame: { ...draft.frame, phase: "main", stateOpen: true,
      priorityPlayerId: "alice", turnPlayerId: "alice" } }, transitions: [] }));
  journal.observe({ ancestor: head, descendant: opened,
    commits: [{ operationId: "nominal-main", eventId: "nominal-main", event: "main" }] });
  head = opened;
  states.push(opened);
  return { journal, genesis, head, states, programs,
    candidates: enumerateDuelPhaseSourceClosureCandidatesV2(head) };
}

describe("nominal native journal binding", () => {
  it("accepts the genuine journal and a same-authority fork, but rejects coherent wrappers and foreign objects", async () => {
    const f = await fixture();
    expect(f.candidates).toHaveLength(34);
    const genuine = inspectDuelNativeOperationJournalBindingV2(f.journal);
    expect(genuine?.head).toBe(f.head);
    expect(genuine?.observed).toBe(f.head);
    expect(genuine?.census.sources).toHaveLength(34);

    const fake = Object.freeze({
      currentHead: f.journal.currentHead,
      observedHead: f.journal.observedHead,
      listCommits: f.journal.listCommits,
      revision: f.journal.revision,
      readCostCensus: f.journal.readCostCensus,
    });
    expect(inspectDuelNativeOperationJournalBindingV2(fake)).toBeNull();
    expect(inspectDuelNativeOperationJournalBindingV2({ ...f.journal })).toBeNull();
    expect(inspectDuelNativeOperationJournalBindingV2(new Proxy(f.journal, {}))).toBeNull();

    let forkHead = f.head;
    const fork = f.journal.fork(() => forkHead);
    expect(inspectDuelNativeOperationJournalBindingV2(fork)?.authority)
      .toBe(genuine?.authority);
    let foreignHead = f.genesis;
    const foreign = createDuelNativeOperationJournalV2({ genesis: f.genesis,
      currentHead: () => foreignHead, programs: f.programs });
    for (let i = 1; i < f.states.length; i += 1) {
      const next = f.states[i]!;
      foreignHead = next;
      foreign.observe({ ancestor: f.states[i - 1]!, descendant: next,
        commits: [{ operationId: `foreign-${i}`, eventId: `foreign-${i}`,
          event: next.stage === "playing" ? "main" : "mulligan" }] });
    }
    const foreignBinding = inspectDuelNativeOperationJournalBindingV2(foreign);
    expect(foreignBinding?.head).toBe(f.head);
    expect(foreignBinding?.authority).not.toBe(genuine?.authority);
  });

  it("fails closed when the owner re-enters with a changed journal view and leaves the Core head untouched", async () => {
    const f = await fixture();
    const before = f.head;
    let calls = 0;
    const fake = Object.freeze({
      currentHead: f.journal.currentHead,
      observedHead: f.journal.observedHead,
      listCommits: () => [...f.journal.listCommits(), {
        before, after: before, label: { operationId: "reentry", eventId: "reentry", event: "unknown" },
      }],
      revision: f.journal.revision,
      readCostCensus: f.journal.readCostCensus,
    });
    expect(inspectDuelNativeOperationJournalBindingV2(fake)).toBeNull();
    const ownerJournal = () => {
      calls += 1;
      return calls === 1 ? f.journal : fake as never;
    };
    const first = ownerJournal();
    expect(inspectDuelNativeOperationJournalBindingV2(first)).not.toBeNull();
    expect(ownerJournal()).not.toBe(f.journal);
    expect(f.head).toBe(before);
  });
});
