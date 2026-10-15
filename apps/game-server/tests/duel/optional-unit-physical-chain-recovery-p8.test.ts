import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DUEL_RULESET_ID, DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
  type ClientSession, type DuelWireCommandV3Actions1, type ServerToClientMessage } from "@riftbound/protocol";
import { loadCardCatalogRuntime, validateCatalogDeck } from "../../src/card-catalog.js";
import { FileRoomStore } from "../../src/file-room-store.js";
import { GameRoom } from "../../src/room.js";
import { DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN } from "../../src/duel/authoritative-runtime-p4.js";
import { fury77RealDecks } from "./fixtures/fury77-real-decks.js";

describe("physical Unit P8 FileRoomStore recovery", () => {
  it("restores the original Chain choice and required payment, then finishes one real entry", async () => {
    const catalog = await loadCardCatalogRuntime();
    for (const deck of Object.values(fury77RealDecks)) expect(validateCatalogDeck(catalog, deck).valid).toBe(true);
    const root = path.resolve(process.cwd(), "../../outputs/coordination/resume-20261013/artifacts/physical-unit-p8-owner-integration");
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(path.join(root, "file-room-store-"));
    let store: FileRoomStore | null = null;
    try {
      let room = new GameRoom("physical-unit-p8-file-room", DUEL_RULESET_ID, catalog, () => 0,
        "p4", undefined, DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN);
      const messages: ServerToClientMessage[][] = [[], []];
      const sends = messages.map(list => (message: ServerToClientMessage) => { list.push(message); });
      const sockets = [room.join("Alice", sends[0]!, "physical-socket-a"),
        room.join("Bob", sends[1]!, "physical-socket-b")];
      const sessions: ClientSession[] = sockets.map(socket => ({ roomId: room.roomId,
        playerId: socket.playerId, resumeToken: socket.resumeToken }));
      let generation = 0, sequence = 0;
      const connectionId = (index: number) => generation === 0
        ? sockets[index]!.connectionId : `physical-restored-${generation}-${index}`;
      const view = (index: number) => {
        room.sendProjection(sessions[index]!.playerId, sends[index]!);
        const message = messages[index]!.at(-1);
        if (message?.type !== "duel-projection") throw new TypeError("actual Duel projection required");
        return message.projection;
      };
      const submit = (index: number, command: DuelWireCommandV3Actions1) => {
        const commandId = `physical-file-command-${++sequence}`;
        room.submitDuel(sessions[index]!, connectionId(index), {
          type: "duel-command", commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
          commandId, requestId: commandId, expectedVersion: view(index).match.stateVersion,
          command }, sends[index]!);
        const ack = messages[index]!.findLast(message => (message.type === "request-result" ||
          message.type === "error") && message.requestId === commandId);
        expect(ack?.type).toBe("request-result");
      };
      const restore = async () => {
        const oldViews = [view(0), view(1)];
        const archive = room.exportArchive();
        expect(archive.duelJournal?.schemaVersion).toBe(8);
        if (!store) {
          store = new FileRoomStore(directory, async () => catalog);
          await store.create(room);
        }
        await store.save(room);
        await store.close();
        store = new FileRoomStore(directory, async () => catalog);
        const loaded = await store.get(room.roomId);
        if (!loaded) throw new TypeError("file room did not restore");
        room = loaded;
        generation++;
        sessions.forEach((session, index) => room.reconnect(session.resumeToken, sends[index]!, connectionId(index)));
        expect([view(0), view(1)]).toEqual(oldViews);
        expect(room.exportArchive().duelJournal).toEqual(archive.duelJournal);
      };
      for (const index of [0, 1]) {
        room.submitDeck(sessions[index]!, sockets[index]!.connectionId, room.currentRoomVersion,
          index === 0 ? fury77RealDecks.a : fury77RealDecks.b, `physical-deck-${index}`, sends[index]!);
        room.setReady(sessions[index]!, sockets[index]!.connectionId, room.currentRoomVersion,
          true, `physical-ready-${index}`, sends[index]!);
      }
      for (let index = 0; index < 2; index++) {
        const setup = view(0).match;
        if (setup.stage !== "setup") throw new TypeError("actual setup required");
        submit(sessions.findIndex(session => session.playerId === setup.setup.currentMulliganOwner),
          { type: "mulligan", selectedUIDs: [] });
      }
      for (let index = 0; index < 2; index++) {
        const playing = view(0).match;
        if (playing.stage !== "playing") throw new TypeError("playing required");
        const actor = sessions.findIndex(session => session.playerId === playing.frame.turnPlayerId);
        const end = view(actor).actions.find(action => action.kind === "end-turn" && action.enabled);
        if (!end || end.kind !== "end-turn") throw new TypeError("actual End required");
        submit(actor, { type: "end-turn", windowId: end.windowId });
      }
      const main = view(0);
      if (main.match.stage !== "playing") throw new TypeError("turn three required");
      expect(main.match.frame.turnNumber).toBe(3);
      const card = main.match.players[0]!.hand!.find(item => item.cardId === "ogn-010-298")!;
      const play = main.actions.find(action => action.kind === "play-card" && action.enabled && action.cardUID === card.uid);
      if (!play || play.kind !== "play-card") throw new TypeError("real Unit action required");
      submit(0, { type: "play-card", cardUID: card.uid, windowId: play.windowId });
      await restore();
      const choice = view(0).match;
      if (choice.stage !== "playing" || !choice.frame.pendingChoice ||
          !("kind" in choice.frame.pendingChoice) || choice.frame.pendingChoice.kind !== "play-choices")
        throw new TypeError("restored Chain choice required");
      const prompt = choice.frame.pendingChoice.prompts[0]!;
      submit(0, { type: "answer-pending-choice", choiceId: choice.frame.pendingChoice.choiceId,
        answers: [{ promptId: prompt.promptId, optionIds: [prompt.options[0]!.id] }] });
      await restore();
      const paymentView = view(0);
      if (paymentView.match.stage !== "playing" || !paymentView.match.frame.pendingPayment)
        throw new TypeError("restored required payment missing");
      const payment = paymentView.match.frame.pendingPayment;
      expect(payment.resolvedCost).toEqual({ energy: 3, power: [{ allowedDomains: ["Fury"], amount: 1 }] });
      for (let index = 0; index < 3; index++) {
        const action = view(0).actions.find(value => value.kind === "rune-energy" && value.enabled);
        if (!action || action.kind !== "rune-energy") throw new TypeError("real energy Rune required");
        submit(0, { type: "rune-energy", uid: action.uid });
      }
      const funded = view(0);
      if (funded.match.stage !== "playing") throw new TypeError("funded state required");
      const runes = funded.match.resources.bases[0]!.baseRunes;
      const power = funded.actions.find(action => action.kind === "rune-power" && action.enabled &&
        runes.some(rune => rune.uid === action.uid && rune.domain === "Fury"));
      if (!power || power.kind !== "rune-power") throw new TypeError("real Fury Rune required");
      submit(0, { type: "rune-power", uid: power.uid });
      submit(0, { type: "pay-pending", paymentId: payment.paymentId });
      await restore();
      const entered = view(0).match;
      if (entered.stage !== "playing") throw new TypeError("entered state required");
      expect(entered.board.units.filter(unit => unit.objectId === card.uid)).toHaveLength(1);
      expect(entered.board.units.find(unit => unit.objectId === card.uid)?.readied).toBe(true);
      expect(entered.frame.chain.active).toBe(false);
    } finally {
      await store?.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 90_000);
});
