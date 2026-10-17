import { describe, expect, it } from "vitest";
import { DUEL_RULESET_ID, DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1, isJournal, isServerMessage,
  type ClientSession, type ServerToClientMessage, type DuelWireCommandV3Actions1 } from "@riftbound/protocol";
import { loadCardCatalogRuntime, validateCatalogDeck } from "../../src/card-catalog.js";
import { GameRoom } from "../../src/room.js";
import { DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT, DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK } from "../../src/duel/authoritative-runtime-p4.js";
import { fury77RealDecks } from "./fixtures/fury77-real-decks.js";

async function boot(profile: typeof DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT | typeof DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK) {
  const catalog = await loadCardCatalogRuntime();
  for (const deck of Object.values(fury77RealDecks)) expect(validateCatalogDeck(catalog, deck).valid).toBe(true);
  let room = new GameRoom("optional-room-p4", DUEL_RULESET_ID, catalog, () => 0, "p4", undefined,
    profile);
  const messages: ServerToClientMessage[][] = [[], []];
  const sends = messages.map(list => (message: ServerToClientMessage) => {
    expect(isServerMessage(message)).toBe(true); list.push(message);
  });
  const sockets = [room.join("Alice", sends[0]!, "optional-socket-0"), room.join("Bob", sends[1]!, "optional-socket-1")];
  const sessions: ClientSession[] = sockets.map(socket => ({ roomId: room.roomId,
    playerId: socket.playerId, resumeToken: socket.resumeToken }));
  let generation = 0, sequence = 0;
  const connectionId = (index: number) => generation === 0 ? sockets[index]!.connectionId : `optional-restored-${generation}-${index}`;
  const view = (index: number) => {
    room.sendProjection(sessions[index]!.playerId, sends[index]!);
    const message = messages[index]!.at(-1);
    if (message?.type !== "duel-projection" || message.projection.projectionSchema !== DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1)
      throw new Error("actual P4 view required");
    return message.projection;
  };
  const submit = (index: number, command: DuelWireCommandV3Actions1) => {
    const id = `optional-room-command-${++sequence}`;
    const packet = { type: "duel-command" as const, commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
      commandId: id, requestId: id, expectedVersion: view(index).match.stateVersion, command };
    room.submitDuel(sessions[index]!, connectionId(index), packet, sends[index]!);
    const ack = messages[index]!.findLast(message => (message.type === "request-result" || message.type === "error") && message.requestId === id);
    expect(ack?.type).toBe("request-result");
    return packet;
  };
  const restore = () => {
    const oldViews = [view(0), view(1)];
    const archive = room.exportArchive();
    room = GameRoom.restore(JSON.parse(JSON.stringify(archive)), catalog);
    generation++;
    sessions.forEach((session, index) => room.reconnect(session.resumeToken, sends[index]!, connectionId(index)));
    expect([view(0), view(1)]).toEqual(oldViews);
    expect(room.exportArchive().journal).toEqual(archive.journal);
  };
  for (const index of [0, 1]) {
    room.submitDeck(sessions[index]!, sockets[index]!.connectionId, room.currentRoomVersion,
      index === 0 ? fury77RealDecks.a : fury77RealDecks.b, `deck-${index}`, sends[index]!);
    room.setReady(sessions[index]!, sockets[index]!.connectionId, room.currentRoomVersion, true, `ready-${index}`, sends[index]!);
  }
  for (let index = 0; index < 2; index++) {
    const p = view(0); if (p.match.stage !== "setup") throw new Error("real setup required");
    const actor = sessions.findIndex(session => session.playerId === p.match.setup.currentMulliganOwner);
    submit(actor, { type: "mulligan", selectedUIDs: [] });
  }
  for (let index = 0; index < 2; index++) {
    const p = view(0); if (p.match.stage !== "playing") throw new Error("real Main required");
    const actor = sessions.findIndex(session => session.playerId === p.match.frame.turnPlayerId);
    const action = view(actor).actions.find(action => action.kind === "end-turn" && action.enabled);
    if (!action || action.kind !== "end-turn") throw new Error("enabled End required");
    submit(actor, { type: "end-turn", windowId: action.windowId });
  }
  return { catalog, view, submit, restore, room: () => room };
}

describe("optional Unit room profile and actual restore", () => {
  async function run(profile: typeof DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT | typeof DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK) {
    const f = await boot(profile);
    let p = f.view(0); if (p.match.stage !== "playing") throw new Error("playing required");
    const card = p.match.players[0]!.hand!.find(card => card.cardId === "ogn-010-298")!;
    const action = p.actions.find(action => action.kind === "play-card" && action.cardUID === card.uid && action.enabled);
    if (!action || action.kind !== "play-card") throw new Error("optional Play required");
    const beforeChoiceVersion = p.match.stateVersion;
    const beforeChoiceSeq = p.match.eventSeq;
    f.submit(0, { type: "play-card", cardUID: card.uid, windowId: action.windowId });
    const opened = f.view(0);
    expect(opened.match.stateVersion).toBe(beforeChoiceVersion + (profile === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK ? 1 : 0));
    expect(opened.match.eventSeq).toBe(beforeChoiceSeq + (profile === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK ? 1 : 0));
    const archive = f.room().exportArchive();
    expect(isJournal(archive.journal)).toBe(true);
    expect(GameRoom.restore({ ...archive, duelRuntimeProfile: undefined }, f.catalog)).toBeInstanceOf(GameRoom);
    expect(() => GameRoom.restore({ ...archive, duelRuntimeProfile: "future-profile" }, f.catalog)).toThrow(/Historical room archives/);
    f.restore();
    p = f.view(0); if (p.match.stage !== "playing") throw new Error("restored playing required");
    const choice = p.match.frame.pendingChoice;
    if (!choice || !('kind' in choice) || choice.kind !== "play-choices") throw new Error("restored choice required");
    const prompt = choice.prompts[0]!;
    f.submit(0, { type: "answer-pending-choice", choiceId: choice.choiceId,
      answers: [{ promptId: prompt.promptId, optionIds: [prompt.options[0]!.id] }] });
    f.restore();
    p = f.view(0); if (p.match.stage !== "playing") throw new Error("restored payment required");
    const payment = p.match.frame.pendingPayment;
    if (!payment?.paymentId || !payment.resolvedCost) throw new Error("canonical payment required");
    expect(payment.resolvedCost).toEqual({ energy: f.catalog.publicCatalog.cards.find(printing => printing.id === card.cardId)!.energy! + 1, power: [{ allowedDomains: ["Fury"], amount: 1 }] });
    for (let index = 0; index < payment.resolvedCost.energy; index++) {
      const action = f.view(0).actions.find(action => action.kind === "rune-energy" && action.enabled);
      if (!action || action.kind !== "rune-energy") throw new Error("actual funding Rune required");
      f.submit(0, { type: "rune-energy", uid: action.uid });
    }
    p = f.view(0); if (p.match.stage !== "playing") throw new Error("funded playing required");
    const runes = p.match.resources.bases[0]!.baseRunes;
    const power = p.actions.find(action => action.kind === "rune-power" && action.enabled &&
      runes.some(rune => rune.uid === action.uid && rune.domain === "Fury"));
    if (!power || power.kind !== "rune-power") throw new Error("actual Fury Rune required");
    f.submit(0, { type: "rune-power", uid: power.uid });
    f.restore();
    f.submit(0, { type: "pay-pending", paymentId: payment.paymentId });
    f.restore();
    p = f.view(0); if (p.match.stage !== "playing") throw new Error("actual entered playing required");
    expect(p.match.frame.pendingPayment).toBeNull();
    expect(p.match.board.units).toHaveLength(1);
    expect(p.match.board.units[0]).toMatchObject({ objectId: card.uid, readied: true });
    expect(p.actions.some(action => action.kind === "end-turn" && action.enabled)).toBe(true);
  }

  it.skip("keeps historical schema 6 choice and payment across fresh room restores [legacy-replay-e2cbcdf]",
    async () => run(DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT), 90_000);
  it("optional-unit-choice-clock-v4 retains choice and payment across fresh room restores",
    async () => run(DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK), 300_000);
});
