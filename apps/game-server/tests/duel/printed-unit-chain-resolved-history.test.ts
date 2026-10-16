import { describe, expect, it } from "vitest";
import {
  advanceDuelCommandSessionNativeV2,
  answerDuelPrintedUnitPhysicalChainV4,
  applyDuelPrintedUnitPhysicalChainResourceV4,
  applyDuelResourceCommandV2,
  beginDuelPrintedUnitPhysicalChainV4,
  channelDuelRunesV2,
  commitDuelPlayingMutationV2,
  createDuelCommandSessionV2,
  createDuelPrintedUnitChainSessionV4,
  inspectDuelNativeCommitPathV2,
  resumeDuelPrintedUnitPhysicalChainV4,
  type DuelCanonicalPlayingStateV2,
  type DuelCommandSessionV2,
} from "@riftbound/engine-core/duel";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { createDuelFuryOptionalRosterCardProgramAuthorityV1 } from "../../src/duel/card-program-authority.js";
import { createCatalogCardTypeResolverV2 } from "../../src/duel/catalog-card-type-v2.js";
import { createDuelNativeOperationJournalV2 } from "../../src/duel/operation-journal-v2.js";
import { createDuelPrintedUnitChainServicesP8 } from "../../src/duel/printed-unit-chain-services-p8.js";
import { buildDuelSetupSeats } from "../../src/duel/setup-seats.js";
import { fury77RealDecks } from "./fixtures/fury77-real-decks.js";

const catalog = await loadCardCatalogRuntime();

async function fixture(allowResolvedPreExitCostHistory?: boolean, falseExit = false) {
  const programs = createDuelFuryOptionalRosterCardProgramAuthorityV1(catalog);
  let entropy = 0;
  const setup = buildDuelSetupSeats(catalog, {
    matchId: `resolved-history-${allowResolvedPreExitCostHistory ?? "default"}`,
    seats: [{ playerId: "alice", displayName: "alice", deck: fury77RealDecks.a },
      { playerId: "bob", displayName: "bob", deck: fury77RealDecks.b }],
  }, () => `resolved-history-${++entropy}`);
  if (!setup.ok) throw new TypeError(`setup failed: ${setup.code}`);
  const types = createCatalogCardTypeResolverV2(catalog);
  let command = createDuelCommandSessionV2(setup.seats, setup.metadata, () => 0,
    types.forMatch(setup.metadata));
  const genesis = command.match;
  let current: DuelCanonicalPlayingStateV2 = command.match;
  const journal = createDuelNativeOperationJournalV2({ genesis, currentHead: () => current, programs });
  let serial = 0;
  const adopt = (next: DuelCommandSessionV2, event: "mulligan" | "main" | "pre-exit" | "chain" | "intrinsic-step",
    sourceUID?: string) => {
    const before = command.match;
    const after = next.match;
    const native = inspectDuelNativeCommitPathV2(before, after);
    current = after;
    command = next;
    if (native.length) {
      journal.observe({ ancestor: before, descendant: after, commits: native.map((_, index) => {
        const id = `resolved-history-${++serial}`;
        return { operationId: id, eventId: id, event, phase: "main" as const,
          ...(index === 0 && sourceUID ? { sourceUID } : {}) };
      }) });
    }
    if (event === "pre-exit") journal.bindContext({
      matchId: after.matchId, dataVersion: after.dataVersion, catalogDigest: after.catalogDigest,
      turn: after.frame.turnNumber,
      taskId: `duel-v2:${after.matchId}:turn-${after.frame.turnNumber}:native:${after.stateVersion}`,
      phase: "main", event: "pre-exit",
      clock: { stateVersion: after.stateVersion, eventSeq: after.eventSeq },
    });
    const chainUID = after.chainCards?.[0]?.uid;
    if (chainUID && !after.frame.stateOpen) journal.bindContext({
      matchId: after.matchId, dataVersion: after.dataVersion, catalogDigest: after.catalogDigest,
      turn: after.frame.turnNumber,
      taskId: `duel-v4:${after.matchId}:turn-${after.frame.turnNumber}:printed-unit:${chainUID}:${after.stateVersion}`,
      phase: "main", event: "chain", clock: { stateVersion: after.stateVersion, eventSeq: after.eventSeq },
    });
  };
  for (const actor of ["alice", "bob"]) {
    const applied = applyDuelResourceCommandV2(command, actor, {
      commandId: `resolved-history-mulligan-${actor}`, expectedVersion: command.match.stateVersion,
      command: { type: "mulligan", selectedUIDs: [] },
    });
    expect(applied.outcome.status).toBe("applied");
    adopt(applied.session, "mulligan");
  }
  const channeled = channelDuelRunesV2(command.match, "alice", 2);
  adopt(advanceDuelCommandSessionNativeV2(command, channeled).session, falseExit ? "pre-exit" : "main");
  // Synthetic Main frame isolates the cost adapter. The original native Main5
  // battle is a separate replay gate owned by the parent profile integration.
  const opened = commitDuelPlayingMutationV2(command.match, draft => ({ match: { ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, state]) =>
      [uid, { ...state, readiness: "ready" }])),
    frame: { ...draft.frame, phase: "main", stateOpen: true,
      priorityPlayerId: "alice", turnPlayerId: "alice" } }, transitions: [] }));
  adopt(advanceDuelCommandSessionNativeV2(command, opened).session, "main");
  const target = command.match.players[0]!.hand.find(card => card.cardId === "ogn-010-298");
  if (!target) throw new TypeError("Accelerate Unit was not dealt");
  const retired = command.match.players[0]!.hand.filter(card => card.uid !== target.uid).slice(0, 2);
  if (retired.length !== 2) throw new TypeError("two pre-exit sources required");
  const beforeExit = command.match;
  const exited = commitDuelPlayingMutationV2(beforeExit, draft => ({ match: { ...draft,
    players: [{ ...draft.players[0],
      hand: draft.players[0]!.hand.filter(card => !retired.some(item => item.uid === card.uid)),
      trash: [...draft.players[0]!.trash, ...retired] }, draft.players[1]!] },
    transitions: retired.map(card => ({ uid: card.uid,
      from: { kind: "hand" as const, zonePlayerId: "alice" },
      to: { kind: "trash" as const, zonePlayerId: "alice" } })) }));
  adopt(advanceDuelCommandSessionNativeV2(command, exited).session, "pre-exit");
  const services = createDuelPrintedUnitChainServicesP8({ catalog, programs,
    currentHead: () => current, currentJournal: () => journal,
    currentSession: () => command, nextOpaqueId: () => `resolved-choice-${++entropy}`,
    allowResolvedPreExitCostHistory });
  const beginning = beginDuelPrintedUnitPhysicalChainV4(
    createDuelPrintedUnitChainSessionV4(command, services), "alice", {
      commandId: "resolved-second-unit", expectedVersion: command.match.stateVersion,
      command: { cardUID: target.uid },
    });
  expect(beginning.outcome.status).toBe("choice");
  if (beginning.outcome.status !== "choice") throw new TypeError("choice required");
  adopt(beginning.session.commandSession, "chain", target.uid);
  const census = journal.readCostCensus();
  expect(census?.unresolvedNativeHistory).toBe(false);
  expect(census?.sources.filter(source => source.carrier === "pre-exit")).toHaveLength(falseExit ? 4 : 2);
  return { beginning, target, journal, services, get command() { return command; }, adopt };
}

describe("printed Unit Chain resolved native cost history", () => {
  it.skip.each([undefined, false])("keeps historical P8 replay blocked when option is %s [legacy-replay-e2cbcdf]", async enabled => {
    const f = await fixture(enabled);
    const chain = f.beginning.session.commandSession.match;
    const answered = answerDuelPrintedUnitPhysicalChainV4(f.beginning.session, "alice", {
      commandId: "resolved-second-unit", expectedVersion: chain.stateVersion,
      command: { choiceId: f.beginning.outcome.prompt.choiceId,
        optionId: f.beginning.outcome.prompt.declineOptionId },
    });
    expect(answered.outcome).toMatchObject({ status: "blocked", reason: "cost-or-payment-unproved" });
    expect(answered.session.commandSession.requiredTasks).toHaveLength(0);
  });

  it("accepts exactly witnessed history, declines Accelerate, pays 2E and enters Base", async () => {
    const f = await fixture(true);
    const chain = f.beginning.session.commandSession.match;
    const answered = answerDuelPrintedUnitPhysicalChainV4(f.beginning.session, "alice", {
      commandId: "resolved-second-unit", expectedVersion: chain.stateVersion,
      command: { choiceId: f.beginning.outcome.prompt.choiceId,
        optionId: f.beginning.outcome.prompt.declineOptionId },
    });
    expect(answered.outcome.status).toBe("pending");
    if (answered.outcome.status !== "pending") return;
    f.adopt(answered.session.commandSession, "intrinsic-step");
    expect(f.command.match.frame.pendingPayment?.resolvedCost).toEqual({ energy: 2, power: [] });
    let physical = answered.session;
    for (let index = 0; index < 2; index++) {
      const rune = f.command.match.resources.bases.find(base => base.playerId === "alice")!.baseRunes
        .find(item => item.readied);
      if (!rune) throw new TypeError("ready rune required");
      const funded = applyDuelPrintedUnitPhysicalChainResourceV4(physical, "alice", {
        commandId: `resolved-fund-${index}`, expectedVersion: f.command.match.stateVersion,
        command: { type: "rune-energy", uid: rune.uid },
      });
      expect(funded.outcome.status).toBe("pending");
      physical = funded.session;
      f.adopt(physical.commandSession, "intrinsic-step");
    }
    const paymentId = f.command.match.frame.pendingPayment?.paymentId;
    if (!paymentId) throw new TypeError("payment task required");
    const paid = applyDuelPrintedUnitPhysicalChainResourceV4(physical, "alice", {
      commandId: "resolved-pay", expectedVersion: f.command.match.stateVersion,
      command: { type: "pay-pending", paymentId },
    });
    expect(paid.outcome.status).toBe("paid");
    f.adopt(paid.session.commandSession, "intrinsic-step");
    const entered = resumeDuelPrintedUnitPhysicalChainV4(paid.session, "alice", {
      commandId: "resolved-enter", expectedVersion: f.command.match.stateVersion,
      command: { cardUID: f.target.uid },
    });
    expect(entered.outcome.status).toBe("applied");
    expect(entered.session.commandSession.match.board.units.filter(unit => unit.objectId === f.target.uid))
      .toHaveLength(1);
    expect(entered.session.commandSession.match.unitMeta[f.target.uid]?.readied).toBe(false);
    expect(entered.session.commandSession.match.board.units.find(unit => unit.objectId === f.target.uid)?.locationId)
      .toBe(entered.session.commandSession.match.board.bases.find(base => base.ownerPlayerId === "alice")?.locationId);
  });

  it("rejects additional source-work even when the pre-exit history is resolved", async () => {
    const f = await fixture(true);
    const chain = f.beginning.session.commandSession.match;
    const source = f.journal.readCostCensus()!.sources.find(item => item.carrier === "object" && item.uid === f.target.uid)!;
    const context = { matchId: chain.matchId, dataVersion: chain.dataVersion,
      catalogDigest: chain.catalogDigest, turn: chain.frame.turnNumber,
      taskId: `duel-v4:${chain.matchId}:turn-${chain.frame.turnNumber}:printed-unit:${f.target.uid}:${chain.stateVersion}`,
      phase: "main" as const, event: "chain" as const,
      clock: { stateVersion: chain.stateVersion, eventSeq: chain.eventSeq } };
    const last = f.journal.listCommits().at(-1)!;
    f.journal.registerSourceWork({ operationId: last.label.operationId, context,
      sourceUID: source.uid, zoneEpoch: source.sourceEpoch!, controllerPlayerId: source.controllerPlayerId,
      programReference: source.programReference!, status: "resolved" });
    const answered = answerDuelPrintedUnitPhysicalChainV4(f.beginning.session, "alice", {
      commandId: "resolved-second-unit", expectedVersion: chain.stateVersion,
      command: { choiceId: f.beginning.outcome.prompt.choiceId,
        optionId: f.beginning.outcome.prompt.declineOptionId },
    });
    expect(answered.outcome.status).toBe("blocked");
    expect(answered.session.commandSession.requiredTasks).toHaveLength(0);
  });

  it("rejects a resolved pre-exit label whose native transition does not leave play", async () => {
    const f = await fixture(true, true);
    const chain = f.beginning.session.commandSession.match;
    const answered = answerDuelPrintedUnitPhysicalChainV4(f.beginning.session, "alice", {
      commandId: "resolved-second-unit", expectedVersion: chain.stateVersion,
      command: { choiceId: f.beginning.outcome.prompt.choiceId,
        optionId: f.beginning.outcome.prompt.declineOptionId },
    });
    expect(answered.outcome).toMatchObject({ status: "blocked", reason: "cost-or-payment-unproved" });
    expect(answered.session.commandSession.requiredTasks).toHaveLength(0);
  });
});
