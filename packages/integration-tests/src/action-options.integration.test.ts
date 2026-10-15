import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ACTION_OPTIONS_CONTRACT,
  FOUNDATION_RULESET_ID,
  PROTOCOL_VERSION,
  type ClientSession,
  type GameProjection,
  type PlayerCommand,
  type ProjectionAction,
  type RoomDeckSubmission,
  type RoomView,
  type ServerToClientMessage
} from "@riftbound/protocol";
import type { GameServer } from "@riftbound/game-server-src";
import { ProtocolWebSocketClient } from "./test-support/websocket-client.js";
import {
  catalogFixture,
  type CardCatalogFixture
} from "./test-support/card-catalog-fixture.js";

type CreateGameServer = typeof import("@riftbound/game-server-src").createGameServer;
type Receipt = Extract<ServerToClientMessage, { type: "request-result" }>;
type ErrorMessage = Extract<ServerToClientMessage, { type: "error" }>;

/**
 * This suite's private, synthetic catalog.
 *
 * The text-free Unit keeps the baseline play path on the public foundation
 * rules. The judge fixture card deliberately keeps non-empty ability text, so
 * the server adapter still models it as `judge-required`; its energy is pinned
 * to 0 *here only* so the card is energy-affordable. That is what lets the test
 * observe an affordable card that the authority still exposes as a disabled
 * (`judge-required`) action instead of silently dropping it. The shared
 * `catalogFixture` is intentionally left untouched.
 */
const actionCatalogFixture: CardCatalogFixture = {
  ...catalogFixture,
  dataVersion: "integration-fixture-action-options-2026-10-12",
  cards: [
    ...catalogFixture.cards.map(card =>
      card.id === "integration.flame-warden.standard"
        ? { ...card, energy: 0 }
        : card
    ),
    {
      id: "integration.vanilla-unit.standard",
      canonicalCardId: "integration.vanilla-unit",
      name: "Vanilla Unit",
      fullName: "Vanilla Unit",
      cardType: "Unit",
      domains: ["Ember"],
      tags: ["integration", "no-text"],
      setCode: "unl",
      cardNumber: "003",
      variant: "standard",
      imageUrl: null,
      energy: 0,
      power: 1,
      might: null,
      ability: ""
    }
  ]
};

const actionDeck: RoomDeckSubmission = {
  mainDeck: [
    { cardId: "integration.vanilla-unit.standard", quantity: 3 },
    { cardId: "integration.flame-warden.standard", quantity: 1 },
    { cardId: "integration.tide-oracle", quantity: 2 }
  ]
};

const clients: ProtocolWebSocketClient[] = [];
const servers: GameServer[] = [];
const temporaryDirectories: string[] = [];

const expectedStoragePrefix = path.join(
  tmpdir(),
  path.sep,
  "riftbound-action-options-"
).replace(/\\/g, "/");

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const server of servers.splice(0)) await server.stop().catch(() => undefined);
  for (const directory of temporaryDirectories.splice(0)) {
    const normalized = path.resolve(directory).replace(/\\/g, "/");
    if (normalized.startsWith(expectedStoragePrefix)) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

async function loadCreateGameServer(): Promise<CreateGameServer> {
  const module = await import("@riftbound/game-server-src");
  if (typeof module.createGameServer !== "function") {
    throw new Error("The real game-server API must export createGameServer.");
  }
  return module.createGameServer;
}

async function startServer(
  storageDirectory?: string
): Promise<{ server: GameServer; url: string }> {
  const createGameServer = await loadCreateGameServer();
  const server = createGameServer({
    host: "127.0.0.1",
    port: 0,
    roomIdFactory: () => `action-options-${servers.length + 1}`,
    catalog: actionCatalogFixture,
    deckRules: { defaultMaxCopiesPerCanonical: 3 },
    ...(storageDirectory === undefined ? {} : { storageDirectory })
  });
  servers.push(server);
  await server.start();

  const address = server.httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("The game server did not expose an ephemeral TCP address.");
  }
  return { server, url: `ws://127.0.0.1:${address.port}/ws` };
}

async function connect(url: string): Promise<ProtocolWebSocketClient> {
  const client = await ProtocolWebSocketClient.connect(url);
  clients.push(client);
  client.send({ type: "hello", protocolVersion: PROTOCOL_VERSION });
  const welcome = await client.waitFor(
    "welcome",
    message => message.type === "welcome" && message.resumed !== true,
    "initial handshake welcome"
  );
  expect(welcome.protocolVersion).toBe("0.2.1");
  expect(PROTOCOL_VERSION).toBe("0.2.1");
  return client;
}

async function resume(
  url: string,
  session: ClientSession
): Promise<ProtocolWebSocketClient> {
  const client = await ProtocolWebSocketClient.connect(url);
  clients.push(client);
  client.send({
    type: "hello",
    protocolVersion: PROTOCOL_VERSION,
    roomId: session.roomId,
    resumeToken: session.resumeToken
  });
  const welcome = await client.waitFor(
    "welcome",
    message => message.type === "welcome" && message.resumed === true,
    `${session.playerId} resumed welcome`
  );
  expect(welcome.protocolVersion).toBe("0.2.1");
  expect(welcome.session).toEqual(session);
  return client;
}

function sessionFrom(
  welcome: Extract<ServerToClientMessage, { type: "welcome" }>
): ClientSession {
  if (!welcome.session) throw new Error("Welcome omitted its client session.");
  return welcome.session;
}

async function createRoom(
  client: ProtocolWebSocketClient,
  requestId: string
): Promise<ClientSession> {
  client.send({
    type: "create-room",
    requestId,
    playerName: "Alice",
    rulesetId: FOUNDATION_RULESET_ID
  });
  await waitForReceipt(client, requestId);
  return sessionFrom(await client.waitFor(
    "welcome",
    message => message.type === "welcome" && message.session !== undefined,
    `${requestId} welcome`
  ));
}

async function joinRoom(
  client: ProtocolWebSocketClient,
  roomId: string,
  requestId: string
): Promise<ClientSession> {
  client.send({
    type: "join-room",
    requestId,
    roomId,
    playerName: "Bob"
  });
  await waitForReceipt(client, requestId);
  return sessionFrom(await client.waitFor(
    "welcome",
    message => message.type === "welcome" && message.session !== undefined,
    `${requestId} welcome`
  ));
}

async function waitForReceipt(
  client: ProtocolWebSocketClient,
  requestId: string
): Promise<Receipt> {
  const receipt = await client.waitFor(
    "request-result",
    message => message.type === "request-result" && message.requestId === requestId,
    `${requestId} receipt`
  );
  expect(receipt.ok).toBe(true);
  return receipt;
}

async function waitForError(
  client: ProtocolWebSocketClient,
  requestId: string
): Promise<ErrorMessage> {
  return client.waitFor(
    "error",
    message => message.type === "error" && message.requestId === requestId,
    `${requestId} error`
  );
}

async function waitForRoom(
  client: ProtocolWebSocketClient,
  predicate: (room: RoomView) => boolean,
  label: string
): Promise<RoomView> {
  const message = await client.waitFor(
    "room",
    candidate => candidate.type === "room" && predicate(candidate.room),
    label
  );
  return message.room;
}

async function waitForProjection(
  client: ProtocolWebSocketClient,
  predicate: (projection: GameProjection) => boolean,
  label: string
): Promise<GameProjection> {
  const message = await client.waitFor(
    "projection",
    candidate => candidate.type === "projection" && predicate(candidate.projection),
    label
  );
  return message.projection;
}

async function submitDeck(
  client: ProtocolWebSocketClient,
  expectedRoomVersion: number,
  requestId: string
): Promise<number> {
  const receiptPromise = waitForReceipt(client, requestId);
  client.send({
    type: "submit-deck",
    requestId,
    expectedRoomVersion,
    deck: actionDeck
  });
  const receipt = await receiptPromise;
  if (receipt.roomVersion === undefined) {
    throw new Error(`${requestId} receipt omitted roomVersion.`);
  }
  return receipt.roomVersion;
}

async function setReady(
  client: ProtocolWebSocketClient,
  expectedRoomVersion: number,
  requestId: string
): Promise<number> {
  const receiptPromise = waitForReceipt(client, requestId);
  client.send({
    type: "set-ready",
    requestId,
    expectedRoomVersion,
    ready: true
  });
  const receipt = await receiptPromise;
  if (receipt.roomVersion === undefined) {
    throw new Error(`${requestId} receipt omitted roomVersion.`);
  }
  return receipt.roomVersion;
}

async function startFoundationGame(storageDirectory?: string): Promise<{
  server: GameServer;
  url: string;
  alice: ProtocolWebSocketClient;
  bob: ProtocolWebSocketClient;
  aliceSession: ClientSession;
  bobSession: ClientSession;
  aliceProjection: GameProjection;
  bobProjection: GameProjection;
}> {
  const startedServer = await startServer(storageDirectory);
  const alice = await connect(startedServer.url);
  const bob = await connect(startedServer.url);
  const aliceSession = await createRoom(alice, "alice-create");
  const bobSession = await joinRoom(bob, aliceSession.roomId, "bob-join");

  const waiting = await waitForRoom(
    bob,
    room =>
      room.roomId === aliceSession.roomId &&
      room.status === "waiting" &&
      room.players.length === 2,
    "two-seat waiting room"
  );
  let roomVersion = await submitDeck(alice, waiting.roomVersion, "alice-deck");
  roomVersion = await submitDeck(bob, roomVersion, "bob-deck");
  roomVersion = await setReady(alice, roomVersion, "alice-ready");
  await setReady(bob, roomVersion, "bob-ready");

  const aliceProjection = await waitForProjection(
    alice,
    projection =>
      projection.rulesetId === FOUNDATION_RULESET_ID &&
      projection.phase === "main" &&
      projection.actionOptions !== undefined,
    "Alice foundation action projection"
  );
  const bobProjection = await waitForProjection(
    bob,
    projection =>
      projection.rulesetId === FOUNDATION_RULESET_ID &&
      projection.version === aliceProjection.version &&
      projection.actionOptions !== undefined,
    "Bob foundation action projection"
  );
  return {
    ...startedServer,
    alice,
    bob,
    aliceSession,
    bobSession,
    aliceProjection,
    bobProjection
  };
}

function requireAction(
  projection: GameProjection,
  id: string
): ProjectionAction {
  const action = projection.actionOptions?.actions.find(candidate => candidate.id === id);
  if (!action) throw new Error(`Projection did not contain action ${id}.`);
  return action;
}

function actionForCard(
  projection: GameProjection,
  instanceId: string
): ProjectionAction {
  const action = projection.actionOptions?.actions.find(candidate =>
    candidate.command.type === "play-card" && candidate.command.instanceId === instanceId
  );
  if (!action) throw new Error(`Projection did not contain play action for ${instanceId}.`);
  return action;
}

function assertActionProjection(
  projection: GameProjection,
  viewerPlayerId: string
): NonNullable<GameProjection["actionOptions"]> {
  const options = projection.actionOptions;
  if (!options) throw new Error("Foundation projection omitted actionOptions.");

  expect(options.contract).toBe(ACTION_OPTIONS_CONTRACT);
  expect(options.stateVersion).toBe(projection.version);
  expect(options.viewerPlayerId).toBe(viewerPlayerId);
  expect(new Set(options.actions.map(action => action.id)).size)
    .toBe(options.actions.length);

  for (const action of options.actions) {
    expect(action.command).not.toHaveProperty("playerId");
    if (action.enabled) {
      expect(action).not.toHaveProperty("blockedReason");
    } else {
      expect(action.blockedReason).toBeTruthy();
    }
    expect(action.targetPolicy.minTargets)
      .toBeLessThanOrEqual(action.targetPolicy.maxTargets);
    if (action.command.type !== "play-card") {
      expect(action.targetPolicy).toEqual({
        minTargets: 0,
        maxTargets: 0,
        options: []
      });
    } else {
      expect(action.command).not.toHaveProperty("targets");
    }
  }
  return options;
}

function assertPrivateProjection(
  ownerProjection: GameProjection,
  opponentProjection: GameProjection,
  ownerSession: ClientSession,
  opponentSession: ClientSession
): void {
  const owner = ownerProjection.players.find(player => player.id === ownerSession.playerId);
  const hiddenOwner = opponentProjection.players.find(
    player => player.id === ownerSession.playerId
  );
  const opponent = opponentProjection.players.find(
    player => player.id === opponentSession.playerId
  );
  if (!owner || !hiddenOwner || !opponent) {
    throw new Error("Both projections must contain both seats.");
  }

  const ownerHandIds = owner.hand.map(card => card.instanceId);
  expect(owner.hand.length).toBe(owner.handCount);
  expect(hiddenOwner.hand).toEqual([]);
  expect(hiddenOwner.handCount).toBe(owner.handCount);
  expect(opponent.hand.length).toBe(opponent.handCount);
  expect(opponentProjection.objects?.some(object =>
    object.zone === "hand" && object.ownerPlayerId === ownerSession.playerId
  )).toBe(false);
  expect(opponentProjection.objects?.some(object =>
    object.zone === "deck" || object.zone === "rune-deck"
  )).toBe(false);

  const serializedActions = JSON.stringify(opponentProjection.actionOptions);
  for (const instanceId of ownerHandIds) {
    expect(serializedActions).not.toContain(instanceId);
  }
}

function sendCommand(
  client: ProtocolWebSocketClient,
  requestId: string,
  commandId: string,
  expectedVersion: number,
  command: PlayerCommand
): void {
  client.send({
    type: "command",
    requestId,
    commandId,
    expectedVersion,
    command
  });
}

describe("public foundation action-options integration", () => {
  it("projects private authoritative actions, executes an enabled action, and preserves command identity", async () => {
    const started = await startFoundationGame();
    const { alice, bob, aliceSession, bobSession } = started;
    const aliceOptions = assertActionProjection(
      started.aliceProjection,
      aliceSession.playerId
    );
    const bobOptions = assertActionProjection(
      started.bobProjection,
      bobSession.playerId
    );

    assertPrivateProjection(
      started.aliceProjection,
      started.bobProjection,
      aliceSession,
      bobSession
    );
    assertPrivateProjection(
      started.bobProjection,
      started.aliceProjection,
      bobSession,
      aliceSession
    );

    const alicePlayer = started.aliceProjection.players.find(
      player => player.id === aliceSession.playerId
    );
    if (!alicePlayer) throw new Error("Alice is missing from her projection.");
    expect(alicePlayer.playableInstanceIds).toBeDefined();

    const naturalCard = alicePlayer.hand.find(card =>
      card.cardId === "integration.vanilla-unit.standard"
    );
    if (!naturalCard) throw new Error("Alice did not receive the text-free Unit.");
    const naturalPlay = actionForCard(started.aliceProjection, naturalCard.instanceId);
    expect(naturalPlay.enabled).toBe(true);
    expect(naturalPlay.id).toBe(`play:${naturalCard.instanceId}`);
    expect(naturalPlay.targetPolicy).toEqual({
      minTargets: 0,
      maxTargets: 0,
      options: []
    });
    expect(alicePlayer.playableInstanceIds).toContain(naturalCard.instanceId);

    const judgeCard = alicePlayer.hand.find(card =>
      card.cardId === "integration.flame-warden.standard"
    );
    if (!judgeCard) throw new Error("Alice did not receive the judge fixture card.");
    // The judge fixture is energy-affordable in this suite, so the authority
    // must surface a *disabled* play action for it rather than hiding it. The
    // authoritative `enabled` flag is the final executability standard: a
    // judge-required card can never be selected as an enabled command. The
    // legacy `playableInstanceIds` affordance reflects affordability only, so
    // this assertion intentionally targets the action options.
    const judgePlay = actionForCard(started.aliceProjection, judgeCard.instanceId);
    expect(judgePlay.enabled).toBe(false);
    expect(judgePlay.blockedReason).toBe("judge-required");
    const enabledJudgeCommands = aliceOptions.actions.filter(action =>
      action.enabled &&
      action.command.type === "play-card" &&
      action.command.instanceId === judgeCard.instanceId
    );
    expect(enabledJudgeCommands).toEqual([]);

    const alicePass = requireAction(started.aliceProjection, "pass");
    expect(alicePass.enabled).toBe(true);
    expect(requireAction(started.aliceProjection, "concede").enabled).toBe(true);
    expect(bobOptions.actions.some(action => action.id === "pass")).toBe(false);
    expect(bobOptions.actions.map(action => action.id)).toEqual(["concede"]);

    const initialVersion = started.aliceProjection.version;
    sendCommand(
      alice,
      "alice-play-request",
      "alice-play-command",
      initialVersion,
      naturalPlay.command
    );
    const playReceipt = await waitForReceipt(alice, "alice-play-request");
    expect(playReceipt.commandId).toBe("alice-play-command");
    expect(playReceipt.duplicate).not.toBe(true);
    expect(playReceipt.appliedVersion).toBeGreaterThan(initialVersion);

    const afterPlay = await waitForProjection(
      alice,
      projection => projection.version === playReceipt.appliedVersion,
      "Alice projection after enabled play"
    );
    const afterPlayOptions = assertActionProjection(afterPlay, aliceSession.playerId);
    expect(afterPlayOptions.stateVersion).toBeGreaterThan(initialVersion);

    sendCommand(
      alice,
      "alice-play-retry",
      "alice-play-command",
      initialVersion,
      naturalPlay.command
    );
    const duplicate = await waitForReceipt(alice, "alice-play-retry");
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.appliedVersion).toBe(playReceipt.appliedVersion);
    expect(duplicate.eventSeq).toBe(playReceipt.eventSeq);

    sendCommand(
      alice,
      "alice-play-conflict",
      "alice-play-command",
      afterPlay.version,
      { type: "pass" }
    );
    const conflict = await waitForError(alice, "alice-play-conflict");
    expect(conflict.code).toBe("idempotency-conflict");

    sendCommand(
      alice,
      "alice-stale-pass",
      "alice-stale-pass-command",
      initialVersion,
      { type: "pass" }
    );
    const stale = await waitForError(alice, "alice-stale-pass");
    expect(stale.code).toBe("stale-version");

    const passProjection = await waitForProjection(
      alice,
      projection => projection.version === afterPlay.version &&
        projection.actionOptions?.stateVersion === projection.version,
      "Alice projection before pass"
    );
    expect(passProjection.version).toBeGreaterThan(initialVersion);
    sendCommand(
      alice,
      "alice-pass-request",
      "alice-pass-command",
      passProjection.version,
      requireAction(passProjection, "pass").command
    );
    const passReceipt = await waitForReceipt(alice, "alice-pass-request");
    expect(passReceipt.appliedVersion).toBeGreaterThan(passProjection.version);

    const bobAfterPass = await waitForProjection(
      bob,
      projection => projection.version === passReceipt.appliedVersion &&
        projection.actionOptions?.viewerPlayerId === bobSession.playerId,
      "Bob projection after Alice pass"
    );
    const bobPass = requireAction(bobAfterPass, "pass");
    expect(bobPass.enabled).toBe(true);
    expect(assertActionProjection(bobAfterPass, bobSession.playerId).stateVersion)
      .toBeGreaterThan(passProjection.version);

    sendCommand(
      bob,
      "bob-concede-request",
      "bob-concede-command",
      bobAfterPass.version,
      requireAction(bobAfterPass, "concede").command
    );
    const concedeReceipt = await waitForReceipt(bob, "bob-concede-request");
    expect(concedeReceipt.appliedVersion).toBeGreaterThan(bobAfterPass.version);

    const aliceEnded = await waitForProjection(
      alice,
      projection => projection.phase === "ended" &&
        projection.actionOptions?.actions.length === 0,
      "Alice ended action projection"
    );
    const bobEnded = await waitForProjection(
      bob,
      projection => projection.phase === "ended" &&
        projection.actionOptions?.actions.length === 0,
      "Bob ended action projection"
    );
    expect(aliceEnded.version).toBe(concedeReceipt.appliedVersion);
    expect(bobEnded.version).toBe(aliceEnded.version);
    expect(aliceEnded.actionOptions?.stateVersion).toBe(aliceEnded.version);
    expect(bobEnded.actionOptions?.stateVersion).toBe(bobEnded.version);
    expect(aliceEnded.actionOptions?.viewerPlayerId).toBe(aliceSession.playerId);
    expect(bobEnded.actionOptions?.viewerPlayerId).toBe(bobSession.playerId);
  });

  it("rebuilds action options after a durable restart for each current viewer and state", async () => {
    const storageDirectory = await mkdtemp(
      path.join(tmpdir(), "riftbound-action-options-")
    );
    temporaryDirectories.push(storageDirectory);

    const first = await startFoundationGame(storageDirectory);
    const { alice, bob, aliceSession, bobSession } = first;
    const naturalCard = first.aliceProjection.players
      .find(player => player.id === aliceSession.playerId)
      ?.hand.find(card => card.cardId === "integration.vanilla-unit.standard");
    if (!naturalCard) throw new Error("Alice did not receive the text-free Unit.");

    sendCommand(
      alice,
      "restart-play-request",
      "restart-play-command",
      first.aliceProjection.version,
      actionForCard(first.aliceProjection, naturalCard.instanceId).command
    );
    const playReceipt = await waitForReceipt(alice, "restart-play-request");
    const afterPlay = await waitForProjection(
      alice,
      projection => projection.version === playReceipt.appliedVersion,
      "restart flow projection after play"
    );
    sendCommand(
      alice,
      "restart-pass-request",
      "restart-pass-command",
      afterPlay.version,
      requireAction(afterPlay, "pass").command
    );
    const passReceipt = await waitForReceipt(alice, "restart-pass-request");
    const beforeRestartAlice = await waitForProjection(
      alice,
      projection => projection.version === passReceipt.appliedVersion,
      "Alice projection before durable restart"
    );
    const beforeRestartBob = await waitForProjection(
      bob,
      projection => projection.version === beforeRestartAlice.version,
      "Bob projection before durable restart"
    );
    const beforeAliceOptions = assertActionProjection(
      beforeRestartAlice,
      aliceSession.playerId
    );
    const beforeBobOptions = assertActionProjection(
      beforeRestartBob,
      bobSession.playerId
    );
    expect(beforeAliceOptions.actions.map(action => action.id)).toEqual(["concede"]);
    expect(beforeBobOptions.actions.some(action => action.id === "pass")).toBe(true);

    await first.server.stop();
    const firstServerIndex = servers.indexOf(first.server);
    if (firstServerIndex !== -1) servers.splice(firstServerIndex, 1);
    alice.close();
    bob.close();

    const second = await startServer(storageDirectory);
    const resumedAlice = await resume(second.url, aliceSession);
    const resumedBob = await resume(second.url, bobSession);
    const restoredAlice = await waitForProjection(
      resumedAlice,
      projection => projection.version === beforeRestartAlice.version &&
        projection.actionOptions?.viewerPlayerId === aliceSession.playerId,
      "Alice restored action projection"
    );
    const restoredBob = await waitForProjection(
      resumedBob,
      projection => projection.version === beforeRestartBob.version &&
        projection.actionOptions?.viewerPlayerId === bobSession.playerId,
      "Bob restored action projection"
    );

    expect(restoredAlice.actionOptions).toEqual(beforeAliceOptions);
    expect(restoredBob.actionOptions).toEqual(beforeBobOptions);
    expect(assertActionProjection(restoredAlice, aliceSession.playerId).actions)
      .toEqual([requireAction(restoredAlice, "concede")]);
    expect(requireAction(restoredBob, "pass").enabled).toBe(true);
    expect(restoredBob.actionOptions?.stateVersion).toBe(restoredBob.version);
    assertPrivateProjection(
      restoredAlice,
      restoredBob,
      aliceSession,
      bobSession
    );
  });
});
