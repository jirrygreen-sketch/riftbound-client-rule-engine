/**
 * Reconnect acceptance over the ordinary public HTTP/WebSocket/room contract.
 *
 * Scope of this file: real `createGameServer` on port 0, two authenticated ws
 * clients in one P4 duel room, the existing controlled fixture catalog and the
 * existing legal fixture decks. No production source is changed and no GameClient
 * / owner / room code is touched.
 *
 * Baseline: current P4 profile 3 with the known synthetic fixture catalog. This
 * is NOT a new profile 4 or an official native full-rule claim. Nothing here
 * proves durable/restart recovery or official-card executability.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DUEL_RULESET_ID, PROTOCOL_VERSION, DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
  isServerMessage, isDuelProjectionV3Actions1, type ClientSession,
  type DuelCommandMessageV3Actions1, type DuelProjectionV3Actions1,
  type ServerToClientMessage } from '@riftbound/protocol';
import { createGameServer, type GameServer, type GameServerOptions } from '../../src/server.js';
import { p4RuntimeFixtureCatalog } from './fixtures/p4-runtime-catalog.js';
import { setupAdapterFixtureDecks } from './fixtures/setup-adapter-catalog.js';

const ARTIFACT_DIRECTORY = fileURLToPath(new URL(
  '../../../../outputs/coordination/resume-20261013/artifacts/duel-reconnect-wire-acceptance/',
  import.meta.url));

/** Evidence only: public counts and digests, never resume tokens, hand UIDs or archives. */
async function writeEvidence(name: string, value: unknown): Promise<void> {
  await mkdir(ARTIFACT_DIRECTORY, { recursive: true });
  await writeFile(path.join(ARTIFACT_DIRECTORY, name),
    `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

class Client {
  readonly messages: ServerToClientMessage[] = [];
  constructor(readonly socket: WebSocket) {
    socket.on('message', raw => {
      const value = JSON.parse(String(raw)); expect(isServerMessage(value)).toBe(true);
      this.messages.push(value);
    });
  }
  send(value: unknown) { this.socket.send(JSON.stringify(value)); }
  async wait<T extends ServerToClientMessage['type']>(type: T,
    predicate: (value: Extract<ServerToClientMessage, { type: T }>) => boolean = () => true) {
    // The serialized room runtime can queue commands far longer than 10s when
    // the shared runner is heavily loaded.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex(value => value.type === type &&
        predicate(value as Extract<ServerToClientMessage, { type: T }>));
      if (index >= 0) return this.messages.splice(index, 1)[0] as Extract<ServerToClientMessage, { type: T }>;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw Error(`missing ${type}`);
  }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => { this.socket.once('close', resolve); this.socket.close(); });
  }
}

const clients: Client[] = [], servers: GameServer[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const server of servers.splice(0)) await server.stop();
});

async function start(options: Partial<GameServerOptions> = {}) {
  const server = createGameServer({ port: 0, catalog: p4RuntimeFixtureCatalog,
    roomIdFactory: () => 'p4-reconnect-wire', duelRoomProfile: 'p4', ...options });
  servers.push(server); await server.start();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw Error('listening address required');
  return { server, url: `ws://127.0.0.1:${address.port}/ws`,
    http: `http://127.0.0.1:${address.port}` };
}

async function connect(url: string, resume?: ClientSession) {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve); socket.once('error', reject);
  });
  const client = new Client(socket); clients.push(client);
  client.send({ type: 'hello', protocolVersion: PROTOCOL_VERSION,
    ...(resume ? { roomId: resume.roomId, resumeToken: resume.resumeToken } : {}) });
  const welcome = await client.wait('welcome', value => resume ? value.resumed === true : !value.session);
  return { client, welcome };
}

/** Same construction as the existing public P4 tests: real room, fixture decks, real Main. */
async function pair(options: Partial<GameServerOptions> = {}) {
  const running = await start(options);
  const a = (await connect(running.url)).client;
  const b = (await connect(running.url)).client;
  a.send({ type: 'create-room', requestId: 'create', playerName: 'Alice', rulesetId: DUEL_RULESET_ID });
  const sessionA = (await a.wait('welcome', value => Boolean(value.session))).session!;
  await a.wait('request-result', value => value.requestId === 'create');
  b.send({ type: 'join-room', requestId: 'join', roomId: sessionA.roomId, playerName: 'Bob' });
  const sessionB = (await b.wait('welcome', value => Boolean(value.session))).session!;
  await b.wait('request-result', value => value.requestId === 'join');
  const sockets = [a, b], sessions = [sessionA, sessionB];
  let version = (await a.wait('room', value => value.room.players.length === 2)).room.roomVersion;
  for (let i = 0; i < 2; i++) {
    sockets[i]!.send({ type: 'submit-deck', requestId: `deck-${i}`, expectedRoomVersion: version,
      deck: i === 0 ? setupAdapterFixtureDecks.a.submission : setupAdapterFixtureDecks.b.submission });
    version = (await sockets[i]!.wait('request-result', value => value.requestId === `deck-${i}`)).roomVersion!;
    sockets[i]!.send({ type: 'set-ready', requestId: `ready-${i}`, expectedRoomVersion: version, ready: true });
    version = (await sockets[i]!.wait('request-result', value => value.requestId === `ready-${i}`)).roomVersion!;
  }
  const setup = await a.wait('duel-projection');
  if (!isDuelProjectionV3Actions1(setup.projection)) throw Error('P4 setup required');
  return { ...running, a, b, sockets, sessions, setup: setup.projection,
    roomId: sessionA.roomId };
}

function packet(requestId: string, p: DuelProjectionV3Actions1,
  command: DuelCommandMessageV3Actions1['command'],
  expectedVersion = p.match.stateVersion): DuelCommandMessageV3Actions1 {
  return { type: 'duel-command', requestId, commandId: requestId,
    commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, expectedVersion, command };
}

async function enterMain(h: Awaited<ReturnType<typeof pair>>) {
  let p = h.setup;
  for (let n = 0; n < 2; n++) {
    if (p.match.stage !== 'setup') throw Error('setup required');
    const actor = p.match.setup.currentMulliganOwner;
    const client = actor === h.sessions[0]!.playerId ? h.a : h.b;
    client.send(packet(`m-${n}`, p, { type: 'mulligan', selectedUIDs: [] }));
    const ack = await client.wait('request-result', value => value.requestId === `m-${n}`);
    const next = (await client.wait('duel-projection', value =>
      value.projection.match.stateVersion >= ack.appliedVersion! &&
      value.projection.match.stateVersion > p.match.stateVersion)).projection;
    if (!isDuelProjectionV3Actions1(next)) throw Error('P4 projection required');
    p = next;
  }
  if (p.match.stage !== 'playing' || p.match.frame.phase !== 'main') throw Error('real Main required');
  const client = p.match.frame.turnPlayerId === h.sessions[0]!.playerId ? h.a : h.b;
  const main = (await client.wait('duel-projection', value =>
    value.projection.match.stateVersion === p.match.stateVersion)).projection;
  if (!isDuelProjectionV3Actions1(main)) throw Error('P4 Main projection required');
  return { p: main, client, other: client === h.a ? h.b : h.a };
}

/** Public sync path: ask the server for the latest viewer-bound projection. */
async function syncProjection(client: Client): Promise<DuelProjectionV3Actions1> {
  // Drop already-buffered broadcast projections so we read the fresh one the
  // server sends after this request-result, not a stale queued frame.
  for (let i = client.messages.length - 1; i >= 0; i--)
    if (client.messages[i]!.type === 'duel-projection') client.messages.splice(i, 1);
  const requestId = `sync-${Math.random().toString(36).slice(2, 10)}`;
  client.send({ type: 'sync-events', requestId });
  await client.wait('request-result', value => value.requestId === requestId);
  const message = await client.wait('duel-projection');
  if (!isDuelProjectionV3Actions1(message.projection)) throw Error('P4 projection required');
  return message.projection;
}

/** A named player's public energy/ready-rune counts, readable from either viewer. */
function energyFor(p: DuelProjectionV3Actions1, playerId: string) {
  const match = playing(p);
  const pool = match.resources.players.find(item => item.playerId === playerId);
  const base = match.resources.bases.find(item => item.playerId === playerId);
  if (!pool || !base) throw Error('player resources required');
  return { energy: pool.runePool.energy,
    readyRunes: base.baseRunes.filter(rune => rune.readied).length };
}

function playing(p: DuelProjectionV3Actions1) {
  if (p.match.stage !== 'playing') throw Error('playing projection required');
  return p.match;
}

function ownHand(p: DuelProjectionV3Actions1): readonly string[] {
  const match = playing(p);
  return match.players.find(player => player.playerId === p.viewerPlayerId)?.hand?.map(card => card.uid) ?? [];
}

/** Public counts only: no hand UIDs, no resume token, no private journal. */
function publicCounts(p: DuelProjectionV3Actions1) {
  const match = playing(p);
  const pool = match.resources.players.find(item => item.playerId === p.viewerPlayerId);
  const base = match.resources.bases.find(item => item.playerId === p.viewerPlayerId);
  if (!pool || !base) throw Error('viewer resources required');
  return {
    viewerPlayerId: p.viewerPlayerId,
    stateVersion: match.stateVersion,
    phase: match.frame.phase,
    energy: pool.runePool.energy,
    power: Object.values(pool.runePool.power).reduce((total, value) => total + value, 0),
    runeDeckCount: pool.runeDeckCount,
    baseRunes: base.baseRunes.length,
    readyRunes: base.baseRunes.filter(rune => rune.readied).length,
    goldTokens: base.goldTokens.length,
    points: match.scoring.players.find(item => item.playerId === p.viewerPlayerId)?.points ?? 0,
    handCount: match.players.find(player => player.playerId === p.viewerPlayerId)?.handCount ?? 0,
    actionCount: p.actions.length,
  };
}

/** SHA-256 over the public board/resources/scoring shape; UIDs are hashed, never printed. */
function publicDigest(p: DuelProjectionV3Actions1): string {
  const match = playing(p);
  return createHash('sha256').update(JSON.stringify({
    board: match.board,
    resources: {
      players: match.resources.players.map(item => ({ playerId: item.playerId,
        runePool: item.runePool, runeDeckCount: item.runeDeckCount })),
      bases: match.resources.bases.map(item => ({ playerId: item.playerId,
        locationId: item.locationId,
        baseRunes: item.baseRunes.map(rune => ({ cardId: rune.cardId, domain: rune.domain,
          readied: rune.readied, controllerPlayerId: rune.controllerPlayerId })),
        goldTokens: item.goldTokens.map(token => ({ readied: token.readied,
          controllerPlayerId: token.controllerPlayerId })) })),
    },
    scoring: match.scoring,
    frame: { phase: match.frame.phase, turnNumber: match.frame.turnNumber },
  })).digest('hex');
}

function realRuneAction(p: DuelProjectionV3Actions1) {
  const action = p.actions.find(value => value.kind === 'rune-energy' && value.enabled);
  if (!action || action.kind !== 'rune-energy') throw Error('real Rune action required');
  return action;
}

describe('public reconnect wire acceptance (P4 baseline profile 3, fixture)', () => {
  it('resumes both authenticated sockets with the original tokens and restores the same private hand and public board', async () => {
    const h = await pair();
    const health = await fetch(`${h.http}/health`);
    expect(health.status).toBe(200);
    const healthBody = await health.json() as { status: string; rooms: number };
    expect(healthBody.status).toBe('ok');
    expect(healthBody.rooms).toBeGreaterThanOrEqual(1);

    const main = await enterMain(h);
    const otherView = await syncProjection(main.other);
    expect(otherView.match.stateVersion).toBe(main.p.match.stateVersion);
    const before = main.client === h.a
      ? { a: main.p, b: otherView } : { a: otherView, b: main.p };
    const handA = ownHand(before.a), handB = ownHand(before.b);
    expect(handA.length).toBeGreaterThan(0); expect(handB.length).toBeGreaterThan(0);
    expect(before.a.match.stage).toBe('playing');
    // Public board is shared; private hands are viewer-bound.
    expect(playing(before.a).board).toEqual(playing(before.b).board);
    expect(JSON.stringify(before.a)).not.toContain(h.sessions[1]!.resumeToken);
    expect(JSON.stringify(before.b)).not.toContain(h.sessions[0]!.resumeToken);

    await h.a.close(); await h.b.close();
    const resumedA = await connect(h.url, h.sessions[0]!);
    const resumedB = await connect(h.url, h.sessions[1]!);
    expect(resumedA.welcome.resumed).toBe(true);
    expect(resumedB.welcome.resumed).toBe(true);
    const afterA = (await resumedA.client.wait('duel-projection')).projection;
    const afterB = (await resumedB.client.wait('duel-projection')).projection;
    if (!isDuelProjectionV3Actions1(afterA) || !isDuelProjectionV3Actions1(afterB))
      throw Error('P4 restored projection required');
    expect(afterA).toEqual(before.a);
    expect(afterB).toEqual(before.b);
    // Own private hand is restored exactly...
    expect(ownHand(afterA)).toEqual(handA);
    expect(ownHand(afterB)).toEqual(handB);
    // ...and no actor sees the other actor's hidden hand UIDs.
    for (const uid of handB) expect(JSON.stringify(afterA)).not.toContain(uid);
    for (const uid of handA) expect(JSON.stringify(afterB)).not.toContain(uid);
    expect(JSON.stringify(afterA)).not.toContain(h.sessions[1]!.resumeToken);
    expect(JSON.stringify(afterB)).not.toContain(h.sessions[0]!.resumeToken);

    await writeEvidence('reconnect-restore-verification.json', {
      generatedAt: new Date().toISOString(),
      profile: 'p4-baseline-profile-3-fixture',
      check: 'resume-original-token-restores-private-hand-and-public-board',
      httpHealth: { status: health.status, rooms: healthBody.rooms },
      resumed: { a: resumedA.welcome.resumed === true, b: resumedB.welcome.resumed === true },
      selected: { stateVersionA: playing(afterA).stateVersion, stateVersionB: playing(afterB).stateVersion,
        handCountA: ownHand(afterA).length, handCountB: ownHand(afterB).length,
        actionsA: afterA.actions.length, actionsB: afterB.actions.length },
      digests: { actorA: publicDigest(afterA), actorB: publicDigest(afterB) },
      counts: { a: publicCounts(afterA), b: publicCounts(afterB) },
      noCrossActorHandLeak: true,
    });
  }, 30_000);

  it('resends the same accepted Rune packet over the resumed socket and applies it exactly once', async () => {
    await mkdir(ARTIFACT_DIRECTORY, { recursive: true });
    const directory = await mkdtemp(path.join(ARTIFACT_DIRECTORY, 'store-'));
    try {
      const h = await pair({ storageDirectory: directory });
      const main = await enterMain(h);
      if (playing(main.p).stateVersion < 1) throw Error('non-zero Main stateVersion required');
      const actorSession = main.p.viewerPlayerId === h.sessions[0]!.playerId ? h.sessions[0]! : h.sessions[1]!;
      const actorClient = main.client;
      const otherClient = main.other;

      const before = publicCounts(main.p);

      const rune = realRuneAction(main.p);
      const original = packet('rune-once', main.p, { type: 'rune-energy', uid: rune.uid });
      actorClient.send(original);
      const ack = await actorClient.wait('request-result', value => value.requestId === 'rune-once');
      expect(ack).toMatchObject({ ok: true, duplicate: false });
      expect(ack.appliedVersion).toBe(playing(main.p).stateVersion + 1);
      const applied = (await actorClient.wait('duel-projection', value =>
        value.projection.match.stateVersion >= ack.appliedVersion!)).projection;
      if (!isDuelProjectionV3Actions1(applied)) throw Error('P4 projection required');
      const afterFirst = publicCounts(applied);
      expect(afterFirst.energy).toBe(before.energy + 1);
      expect(afterFirst.readyRunes).toBe(before.readyRunes - 1);
      // The opponent sees the same public board/balance through the public contract.
      const otherApplied = await syncProjection(otherClient);
      expect(otherApplied.match.stateVersion).toBe(playing(applied).stateVersion);
      expect(energyFor(otherApplied, main.p.viewerPlayerId!)).toEqual(
        energyFor(applied, main.p.viewerPlayerId!));

      // Disconnect the acting socket and resume it with the original real client token.
      await actorClient.close();
      const resumed = await connect(h.url, actorSession);
      expect(resumed.welcome.resumed).toBe(true);
      const restored = (await resumed.client.wait('duel-projection')).projection;
      if (!isDuelProjectionV3Actions1(restored)) throw Error('P4 restored projection required');
      expect(restored.match.stateVersion).toBe(playing(applied).stateVersion);
      expect(publicCounts(restored)).toEqual(afterFirst);
      expect(ownHand(restored)).toEqual(ownHand(applied));

      const versionBeforeRetry = h.server.rooms.get(h.roomId)!.roomView().version;
      // Resend the byte-identical original packet (same commandId AND requestId)
      // over the resumed socket.
      resumed.client.send(original);
      const retry = await resumed.client.wait('request-result', value => value.requestId === 'rune-once');
      expect(retry).toMatchObject({ ok: true, duplicate: true, appliedVersion: ack.appliedVersion });
      const afterRetry = (await resumed.client.wait('duel-projection', value =>
        value.projection.match.stateVersion === playing(applied).stateVersion)).projection;
      if (!isDuelProjectionV3Actions1(afterRetry)) throw Error('P4 projection required');
      const finalCounts = publicCounts(afterRetry);
      // Exactly once: balance/ready/token/score are identical after the duplicate.
      expect(finalCounts).toEqual(afterFirst);
      expect(h.server.rooms.get(h.roomId)!.roomView().version).toBe(versionBeforeRetry);
      // The duplicate changed nothing visible to the opponent either.
      const otherRetry = await syncProjection(otherClient);
      expect(otherRetry.match.stateVersion).toBe(playing(applied).stateVersion);
      expect(otherRetry).toEqual(otherApplied);

      await writeEvidence('duplicate-after-reconnect-verification.json', {
        generatedAt: new Date().toISOString(),
        profile: 'p4-baseline-profile-3-fixture',
        check: 'duplicate-same-commandId-after-reconnect-applies-once',
        store: 'temp-file-store-under-artifact-directory (removed in finally)',
        resumedActor: resumed.welcome.resumed === true,
        command: { kind: 'rune-energy', appliedVersion: ack.appliedVersion,
          duplicate: retry.duplicate === true },
        selected: { energyBefore: before.energy, energyAfter: finalCounts.energy,
          readyRunesBefore: before.readyRunes, readyRunesAfter: finalCounts.readyRunes,
          goldTokens: finalCounts.goldTokens, points: finalCounts.points,
          stateVersion: afterRetry.match.stateVersion },
        digests: { actorPublic: publicDigest(afterRetry), otherPublic: publicDigest(otherRetry) },
        counts: { before, afterFirst, afterDuplicate: finalCounts },
        roomVersionStableAcrossDuplicate: true,
        otherActorProjectionUnchanged: true,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects a stale expectedVersion without side effects, then applies the corrected packet', async () => {
    const h = await pair();
    const main = await enterMain(h);
    const stateVersion = playing(main.p).stateVersion;
    if (stateVersion < 1) throw Error('non-zero Main stateVersion required');
    const before = publicCounts(main.p);
    const rune = realRuneAction(main.p);
    const versionBefore = h.server.rooms.get(h.roomId)!.roomView().version;

    main.client.send(packet('stale-rune', main.p, { type: 'rune-energy', uid: rune.uid },
      stateVersion - 1));
    const error = await main.client.wait('error', value => value.requestId === 'stale-rune');
    expect(error.code).toBe('command-rejected');
    expect(h.server.rooms.get(h.roomId)!.roomView().version).toBe(versionBefore);
    const unchanged = (await main.client.wait('duel-projection', value =>
      value.projection.match.stateVersion === stateVersion)).projection;
    if (!isDuelProjectionV3Actions1(unchanged)) throw Error('P4 projection required');
    expect(publicCounts(unchanged)).toEqual(before);

    // A corrected, fresh commandId still applies on the real owner.
    main.client.send(packet('corrected-rune', main.p,
      { type: 'rune-energy', uid: rune.uid }, stateVersion));
    const ack = await main.client.wait('request-result', value => value.requestId === 'corrected-rune');
    expect(ack).toMatchObject({ ok: true, duplicate: false });
    const applied = (await main.client.wait('duel-projection', value =>
      value.projection.match.stateVersion >= ack.appliedVersion!)).projection;
    if (!isDuelProjectionV3Actions1(applied)) throw Error('P4 projection required');
    const after = publicCounts(applied);
    expect(after.energy).toBe(before.energy + 1);
    expect(after.readyRunes).toBe(before.readyRunes - 1);

    await writeEvidence('stale-version-verification.json', {
      generatedAt: new Date().toISOString(),
      profile: 'p4-baseline-profile-3-fixture',
      check: 'stale-expectedVersion-rejected-without-side-effect',
      stale: { rejectedCode: error.code, roomVersionStable: true,
        countsUnchanged: JSON.stringify(publicCounts(unchanged)) === JSON.stringify(before) },
      corrected: { appliedVersion: ack.appliedVersion, energyBefore: before.energy,
        energyAfter: after.energy, readyRunesBefore: before.readyRunes,
        readyRunesAfter: after.readyRunes },
      selected: { stateVersionBefore: stateVersion, stateVersionAfter: applied.match.stateVersion,
        goldTokens: after.goldTokens, points: after.points },
      digests: { actorPublic: publicDigest(applied) },
      counts: { before, after },
    });
  }, 30_000);
});
