import { describe, expect, it } from 'vitest';
import { DUEL_RULESET_ID, DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
  isDuelProjectionV3Actions1, isJournal, isServerMessage, type ClientSession,
  type DuelCommandMessageV3Actions1, type ServerToClientMessage } from '@riftbound/protocol';
import { loadCardCatalogRuntime } from '../../src/card-catalog.js';
import { GameRoom } from '../../src/room.js';
import { p4RuntimeFixtureCatalog } from './fixtures/p4-runtime-catalog.js';
import { setupAdapterFixtureDecks } from './fixtures/setup-adapter-catalog.js';

async function boot() {
  const catalog = await loadCardCatalogRuntime({ catalog: p4RuntimeFixtureCatalog });
  const room = new GameRoom('public-p4-test', DUEL_RULESET_ID, catalog, () => 0, 'p4');
  const messages: ServerToClientMessage[][] = [[], []];
  const send = messages.map(list => (value: ServerToClientMessage) => { expect(isServerMessage(value)).toBe(true); list.push(value); });
  const sockets = [room.join('Alice', send[0]!, 'a'), room.join('Bob', send[1]!, 'b')];
  const sessions: ClientSession[] = sockets.map(socket => ({ roomId: room.roomId,
    playerId: socket.playerId, resumeToken: socket.resumeToken }));
  for (const i of [0, 1]) {
    room.submitDeck(sessions[i]!, sockets[i]!.connectionId, room.currentRoomVersion,
      i === 0 ? setupAdapterFixtureDecks.a.submission : setupAdapterFixtureDecks.b.submission, `deck-${i}`, send[i]!);
    room.setReady(sessions[i]!, sockets[i]!.connectionId, room.currentRoomVersion, true, `ready-${i}`, send[i]!);
  }
  const project = (i: number, target = room) => {
    target.sendProjection(sessions[i]!.playerId, send[i]!);
    const message = messages[i]!.at(-1);
    if (message?.type !== 'duel-projection' || !isDuelProjectionV3Actions1(message.projection)) throw Error('P4 projection required');
    return message.projection;
  };
  const command = (id: string, body: DuelCommandMessageV3Actions1['command'], version = room.roomView().version): DuelCommandMessageV3Actions1 => ({
    type: 'duel-command', requestId: id, commandId: id, commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
    expectedVersion: version, command: body });
  const submit = (i: number, packet: DuelCommandMessageV3Actions1, target = room) => {
    target.submitDuel(sessions[i]!, target === room ? sockets[i]!.connectionId : `restored-${i}`, packet, send[i]!);
    return messages[i]!.findLast(message => (message.type === 'request-result' || message.type === 'error') && message.requestId === packet.requestId);
  };
  const enterMain = () => {
    for (let n = 0; n < 2; n++) {
      const p = project(0);
      if (p.match.stage !== 'setup') throw Error('setup required');
      const i = sessions.findIndex(session => session.playerId === p.match.setup.currentMulliganOwner);
      expect(submit(i, command(`m-${n}`, { type: 'mulligan', selectedUIDs: [] }))?.type).toBe('request-result');
    }
  };
  return { catalog, room, messages, send, sockets, sessions, project, command, submit, enterMain };
}
describe('public P4 room ownership', () => {
  it('reaches actual Main and carries only the viewer hand through the public projection', async () => {
    const h = await boot(); h.enterMain();
    const a = h.project(0), b = h.project(1);
    expect(a.match.stage).toBe('playing');
    if (a.match.stage !== 'playing' || b.match.stage !== 'playing') throw Error('playing required');
    expect(a.match.frame.phase).toBe('main');
    expect(a.match.board.battlefields).toEqual(b.match.board.battlefields);
    expect(a.match.board.battlefields).toHaveLength(2);
    const other = b.match.players.find(player => player.playerId === h.sessions[1]!.playerId);
    for (const card of other?.hand ?? []) expect(JSON.stringify(a)).not.toContain(card.uid);
    expect(JSON.stringify(h.messages[0])).not.toContain(h.sessions[1]!.resumeToken);
    const archive = h.room.exportArchive();
    expect(isJournal(archive.journal)).toBe(true);
    expect(archive.journal?.entries).toHaveLength(2);
    expect(a.actions.some(action => action.kind === 'end-turn' && action.enabled)).toBe(true);
  }, 30_000);

  it('reconstructs an actual P4 owner and continues with a restored duplicate and next turn', async () => {
    const h = await boot(); h.enterMain();
    const before = h.project(0), actor = before.match.turnOrder[0] === h.sessions[0]!.playerId ? 0 : 1;
    const p = h.project(actor), action = p.actions.find(action => action.kind === 'end-turn');
    if (!action || action.kind !== 'end-turn') throw Error('real End required');
    const end = h.command('end-1', { type: 'end-turn', windowId: action.windowId });
    expect(h.submit(actor, end)?.type).toBe('request-result');
    const saved = h.project(0), restored = GameRoom.restore(JSON.parse(JSON.stringify(h.room.exportArchive())), h.catalog);
    for (let i = 0; i < 2; i++) restored.reconnect(h.sessions[i]!.resumeToken, h.send[i]!, `restored-${i}`);
    expect(h.project(0, restored)).toEqual(saved);
    expect(h.submit(actor, end, restored)).toMatchObject({ type: 'request-result', duplicate: true });
    const nextActor = actor === 0 ? 1 : 0, next = h.project(nextActor, restored);
    const nextEnd = next.actions.find(action => action.kind === 'end-turn');
    if (!nextEnd || nextEnd.kind !== 'end-turn') throw Error('next End required');
    expect(h.submit(nextActor, h.command('end-2', { type: 'end-turn', windowId: nextEnd.windowId }, next.match.stateVersion), restored)?.type).toBe('request-result');
  }, 30_000);

  it('restores a failed transaction using a fresh native branch while preserving current sockets', async () => {
    const h = await boot(); h.enterMain();
    const p = h.project(0), actor = p.match.turnOrder[0] === h.sessions[0]!.playerId ? 0 : 1;
    const action = h.project(actor).actions.find(action => action.kind === 'end-turn');
    if (!action || action.kind !== 'end-turn') throw Error('real End required');
    const archive = h.room.exportArchive(), sockets = [...h.room.players];
    const end = h.command('rolled-back-end', { type: 'end-turn', windowId: action.windowId });
    h.submit(actor, end); h.room.restoreArchive(archive);
    expect(h.project(0)).toEqual(p); expect([...h.room.players]).toEqual(sockets);
    expect(h.submit(actor, end)).toMatchObject({ type: 'request-result', duplicate: false });
    const forged = { ...archive, duelProfile: undefined, duelJournal: undefined, duelSession: null };
    expect(() => h.room.restoreArchive(forged)).toThrow('Invalid private duel archive');
  }, 30_000);

  it('rejects legacy packets and replaced sockets without mutating the P4 history', async () => {
    const h = await boot(), before = h.room.exportArchive();
    expect(() => h.room.submitDuel(h.sessions[0]!, 'a', {
      type: 'duel-command', requestId: 'legacy', commandId: 'legacy', expectedVersion: 0,
      command: { type: 'mulligan', selectedUIDs: [] } }, h.send[0]!)).toThrow('P4');
    h.room.reconnect(h.sessions[0]!.resumeToken, h.send[0]!, 'replacement');
    expect(() => h.submit(0, h.command('old-socket', { type: 'mulligan', selectedUIDs: [] }))).toThrow('replaced');
    expect(h.room.exportArchive().duelJournal).toEqual(before.duelJournal);
  }, 30_000);
});
