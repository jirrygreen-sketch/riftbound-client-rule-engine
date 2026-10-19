import { DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, DUEL_RULESET_ID, isDuelProjectionV3Actions1,
  type ClientSession, type DuelCommandMessageV3Actions1, type ServerToClientMessage } from '@riftbound/protocol';
import { loadCardCatalogRuntime } from '../../src/card-catalog.js';
import { GameRoom, type DuelOptionalRoomRuntimeProfile, type DuelRoomProfile } from '../../src/room.js';
import { p4RuntimeFixtureCatalog } from '../duel/fixtures/p4-runtime-catalog.js';
import { setupAdapterFixtureDecks } from '../duel/fixtures/setup-adapter-catalog.js';

export async function readyRoom(profile?: DuelRoomProfile, runtimeProfile?: DuelOptionalRoomRuntimeProfile) {
  const catalog = await loadCardCatalogRuntime({ catalog: p4RuntimeFixtureCatalog });
  const room = new GameRoom('current-room', DUEL_RULESET_ID, catalog, () => 0, profile, undefined, runtimeProfile, 'legacy-p4');
  const messages: ServerToClientMessage[][] = [[], []];
  const send = messages.map(list => (value: ServerToClientMessage) => { list.push(value); });
  const connections = [room.join('Alice', send[0]!, 'a'), room.join('Bob', send[1]!, 'b')];
  const sessions: ClientSession[] = connections.map(c => ({ roomId: room.roomId,
    playerId: c.playerId, resumeToken: c.resumeToken }));
  for (const i of [0, 1]) {
    room.submitDeck(sessions[i]!, connections[i]!.connectionId, room.currentRoomVersion,
      i === 0 ? setupAdapterFixtureDecks.a.submission : setupAdapterFixtureDecks.b.submission, `deck-${i}`, send[i]!);
    room.setReady(sessions[i]!, connections[i]!.connectionId, room.currentRoomVersion, true, `ready-${i}`, send[i]!);
  }
  return { catalog, room, messages, send, connections, sessions };
}

export function project(room: GameRoom, playerId = 'player-1') {
  let packet: ServerToClientMessage | undefined;
  room.sendProjection(playerId, value => { packet = value; });
  if (packet?.type !== 'duel-projection' || !isDuelProjectionV3Actions1(packet.projection))
    throw new Error('Current projection required');
  return packet.projection;
}

export function packet(id: string, version: number, command: DuelCommandMessageV3Actions1['command']): DuelCommandMessageV3Actions1 {
  return { type: 'duel-command', requestId: id, commandId: id,
    commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, expectedVersion: version, command };
}
