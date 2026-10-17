import { createHash } from "node:crypto";
import { buildM1Deck } from "../../../integration-tests/src/headless/decks.ts";
import { bindResolveContext, createActionPipelineHost } from "../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../engine-core/dist/effects/testing/test-kernel.js";
import { concede, createMatch } from "../../../engine-core/dist/game/lifecycle.js";
import { projectFor } from "../../../engine-core/dist/projection/v2/index.js";
import {
  canonicalJournalJson,
  computeJournalDigest,
  computeJournalHeaderDigest,
  createJournalRecordIntegrity,
  isJournal,
} from "../../../protocol/dist/journal-v1.js";
import { replayProjectionDigest } from "../../dist/v2/index.js";

export const ENGINE_VERSION = "@riftbound/engine-core/0.1.0+RIFT-352";
export const VIEWERS = ["A", "B", "spectator", "replay", null];
export const hash = value => createHash("sha256").update(canonicalJournalJson(value)).digest("hex");

const decks = [buildM1Deck("rumble-sfd", "A"), buildM1Deck("fiora-sfd", "B")];

/** A fresh headless state owner; every state change goes through engine actions. */
export function makeSetup({ matchDecks = decks } = {}) {
  const kernel = world(352).player("A").player("B").build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error(`Unanswered headless choice ${request.id}`); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
  });
  const options = { decks: matchDecks, host: { ...host, player: id => kernel.player(id) }, firstPlayer: 0, battlefieldChoice: [0, 0] };
  const readState = match => {
    const cards = kernel.objects.map(object => ({ ...object, id: object.ref.id }));
    const inZone = (id, zone) => kernel.objectsInZone(id, zone).map(ref => cards.find(card => card.id === ref.id));
    return {
      phase: match.flow.phase,
      turn: { number: match.flow.turn, player: match.flow.turnPlayer },
      priorityPlayerId: match.flow.chain.priority,
      focusPlayerId: match.flow.chain.focus,
      players: ["A", "B"].map(id => ({
        ...kernel.player(id), id, name: id,
        hand: inZone(id, "hand"), deck: inZone(id, "deck"), runeDeck: inZone(id, "rune-deck"),
        trash: inZone(id, "trash"), banishment: inZone(id, "banishment"),
        board: inZone(id, "board"), runeZone: inZone(id, "rune-zone"),
      })),
      objects: cards,
      chain: match.flow.chain.items,
      events: match.events(),
    };
  };
  return { options, readState, kernel };
}

export function replayOptions(viewer = "A", overrides = {}) {
  return { engineVersion: ENGINE_VERSION, viewer, resolveSetup: makeSetup, ...overrides };
}

export function seal(journal) {
  let parentDigest = computeJournalHeaderDigest(journal.header);
  for (const record of journal.entries) {
    const { integrity: _integrity, ...body } = record;
    record.integrity = createJournalRecordIntegrity(body, parentDigest);
    parentDigest = record.integrity.currentDigest;
  }
  journal.integrity.currentDigest = computeJournalDigest(journal);
  journal.head.journalDigest = journal.integrity.currentDigest;
  if (!isJournal(journal)) throw new Error("Headless recorder produced an invalid journal v1");
  return journal;
}

/** Record genuine pass/concede games using the headless M1 decks and kernel. */
export function recordGame({ seed = "RIFT-352-seed-1", turns = 2, duplicate = false, operation = false,
  setupFactory = makeSetup, commands } = {}) {
  const setup = setupFactory();
  const match = createMatch({ ...setup.options, seed });
  const header = {
    format: "riftbound-journal", formatVersion: 1, engineVersion: ENGINE_VERSION, rulesetVersion: "core-1.5",
    matchId: `match:${seed}`, roomId: "room:352", catalogDigest: hash(setup.options.decks),
    rosterDigest: hash(["A", "B"]), trustedDeckDigest: hash(setup.options.decks), seed,
    seats: [{ playerId: "A", name: "A" }, { playerId: "B", name: "B" }],
    createdAt: "2026-10-17T00:00:00.000Z",
    creation: { entropy: [], deterministicSeed: seed, uidSeed: null, creator: "headless-replay-test" },
  };
  const entries = [];
  const liveSteps = [];
  let stateVersion = 0;
  function capture(kind) {
    const eventSeq = match.events().length;
    const engineProjections = VIEWERS.map(viewer => projectFor({ ...setup.readState(match), stateVersion, eventSeq }, viewer));
    // Independently specify the replay wire boundary: pipeline grouping is
    // internal, and can contain a hidden card's authoritative reference.
    const projections = engineProjections.map(projection => ({ ...projection,
      events: projection.events.map(({ simultaneousGroup: _group, ...event }) => event),
    }));
    liveSteps.push({ seq: entries.length, kind, stateVersion, eventSeq, projections });
    return Object.fromEntries(VIEWERS.map((viewer, index) => [String(viewer), replayProjectionDigest(engineProjections[index])]));
  }
  capture("initial");
  function append(playerId, command) {
    const expectedStateVersion = stateVersion;
    if (command.type === "pass") match.flow.pass(playerId);
    else if (command.type === "concede") concede(match, playerId);
    else {
      const outcome = setup.executeCommand(match, { playerId, command, commandId: `command:${entries.length + 1}` });
      if (outcome.status !== "accepted") throw new Error(outcome.reason);
    }
    stateVersion += 1;
    const record = {
      kind: "entry", seq: entries.length + 1, playerId, actor: playerId,
      requestId: `request:${entries.length + 1}`, commandId: `command:${entries.length + 1}`,
      command, payload: structuredClone(command), acceptedAt: header.createdAt,
      expectedStateVersion, expectedRoomVersion: expectedStateVersion,
      appliedStateVersion: stateVersion, roomVersion: stateVersion, eventSeq: match.events().length,
      result: { accepted: true }, publicReceipt: { accepted: true }, duplicate: false, rejection: null,
      entropyConsumed: [], projectionDigestByViewer: {},
    };
    entries.push(record);
    record.projectionDigestByViewer = capture("command");
  }
  if (commands) {
    for (const entry of commands({ match, setup })) append(entry.playerId, entry.command);
  } else {
    for (let index = 0; index < turns; index += 1) append(match.flow.turnPlayer, { type: "pass" });
  }
  if (duplicate) {
    const record = {
      ...structuredClone(entries[0]), seq: entries.length + 1, requestId: "duplicate-request",
      duplicate: true, appliedStateVersion: stateVersion, roomVersion: stateVersion, eventSeq: match.events().length,
    };
    entries.push(record);
    record.projectionDigestByViewer = capture("duplicate");
  }
  if (operation) {
    entries.push({
      kind: "operation", seq: entries.length + 1, operationId: "audit:pass", taskId: "task:pass", phase: match.flow.phase,
      stateVersion, roomVersion: stateVersion, eventSeq: match.events().length,
      sourceClosureEvidence: [], costCensus: null, paymentPlan: null, paymentReceipt: null,
      effectIRDigest: null, primitiveReceipts: [], tokenBirths: [], tokenRetirements: [], zoneTransitions: [],
      pendingReason: null, entropyConsumed: [],
    });
    capture("operation");
  }
  append(match.flow.turnPlayer, { type: "concede" });
  const final = liveSteps.at(-1);
  const journal = seal({
    header,
    head: { stateVersion, eventSeq: match.events().length, roomVersion: stateVersion,
      parentJournalDigest: null, journalDigest: "0".repeat(64),
      stateDigest: replayProjectionDigest(final.projections[2]), privateStateDigest: hash(final.projections.slice(0, 2)) },
    entries,
    integrity: { parentDigest: null, currentDigest: "0".repeat(64), revision: 0, nonce: "replay:352",
      protectedHeadReference: { revision: 0, nonce: "replay:352" } },
  });
  return { journal, liveSteps, match, setup };
}
