import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { DUEL_RULESET_ID, isJournal, type ClientSession, type ServerTransport } from '@riftbound/protocol';
import { loadCardCatalogRuntime, validateCatalogDeck } from '../../src/card-catalog.js';
import { GameRoom } from '../../src/room.js';
import { DefaultPathDriver, PLAYERS } from '../../../../packages/integration-tests/src/default-path/driver.js';
import { realDecks } from '../../../../packages/integration-tests/src/default-path/decks.js';
import { scenarios } from '../../../../packages/integration-tests/src/default-path/scenarios.js';

/** Reuse the unchanged scenario/observation harness. Only its boot procedure is
 * migrated: the old static factory requires profile/schema 7. Reflection here
 * initializes test-driver bookkeeping, never engine state or runtime capabilities.
 * The coordinator can move this boot helper into the shared driver afterwards. */
async function currentDriver(seed = 77) {
  const catalog = await loadCardCatalogRuntime();
  for (const deck of Object.values(realDecks)) expect(validateCatalogDeck(catalog, deck).valid).toBe(true);
  let randomState = seed >>> 0;
  const room = new GameRoom('default-path', DUEL_RULESET_ID, catalog, bound => {
    randomState = (Math.imul(1664525, randomState) + 1013904223) >>> 0;
    return Math.floor(randomState / 0x1_0000_0000 * bound);
  });
  const driver = Reflect.construct(DefaultPathDriver, [room, seed, catalog]) as DefaultPathDriver;
  const sessions = Reflect.get(driver, 'sessions') as Map<string, ClientSession>;
  const transport = (player: typeof PLAYERS[number]): ServerTransport =>
    Reflect.apply(Reflect.get(driver, 'transport'), driver, [player]);
  for (const [index, player] of PLAYERS.entries()) {
    const connection = room.join(index === 0 ? 'Alice' : 'Bob', transport(player), player);
    sessions.set(player, { roomId: room.roomId, playerId: player, resumeToken: connection.resumeToken });
  }
  room.broadcastRoom();
  for (const [index, player] of PLAYERS.entries()) room.submitDeck(sessions.get(player)!, player,
    room.currentRoomVersion, index === 0 ? realDecks.a : realDecks.b, `deck-${player}`, transport(player));
  for (const player of PLAYERS) room.setReady(sessions.get(player)!, player, room.currentRoomVersion,
    true, `ready-${player}`, transport(player));
  const archive = room.exportArchive();
  expect(isJournal(archive.journal)).toBe(true);
  expect(archive.journal!.header.rulesetVersion).toBe('core-1.5');
  expect(archive).not.toHaveProperty('duelProfile');
  expect(archive).not.toHaveProperty('duelJournal');
  driver.checkpoint('room-ready');
  return driver;
}

describe('default path observable snapshots through the single current owner', () => {
  for (const scenario of scenarios) it(scenario.id, async () => {
    const driver = await currentDriver(scenario.seed);
    scenario.run(driver);
    const actual = driver.snapshot(scenario.id, scenario.coverage, scenario.stop);
    const baseline = JSON.parse(await readFile(new URL(
      `../../../../packages/integration-tests/test/default-path/snapshots/${scenario.id}.json`, import.meta.url), 'utf8'));
    // Profile/schema labels describe the retired boot path. Every observable
    // event, full normalized projection hash and final score is compared unchanged.
    expect(actual.steps).toEqual(baseline.steps);
    expect(actual.finalScoring).toEqual(baseline.finalScoring);
    expect(actual.source.catalogDigest).toBe(baseline.source.catalogDigest);
    expect(actual.source.dataVersion).toBe(baseline.source.dataVersion);
    expect(actual.source.decks).toEqual(baseline.source.decks);
    if (scenario.id === '05-movement-combat-conquer-hold') {
      const archive = driver.room.exportArchive();
      const allocations = archive.journal!.entries.flatMap(entry => entry.kind === 'entry'
        ? [{ kind: entry.kind, packet: entry.result.legacyPacket, stateVersion: entry.appliedStateVersion }]
        : entry.primitiveReceipts.filter(item => item.type === 'legacy-dispatch').map(item =>
          ({ kind: entry.kind, packet: item.packet, stateVersion: entry.stateVersion })))
        .filter(entry => (entry.packet as { command?: { type?: string } })?.command?.type === 'assign-combat-damage');
      expect(allocations).toHaveLength(2);
      expect(allocations[0]!.kind).toBe('operation');
      expect(allocations[0]!.stateVersion).toBe((allocations[0]!.packet as { expectedVersion: number }).expectedVersion);
      const restored = GameRoom.restore(archive, driver.catalog);
      for (const player of PLAYERS) restored.sendProjection(player, message => {
        if (message.type !== 'duel-projection') throw Error('Current projection required');
        expect(message.projection).toEqual(driver.view(player));
      });
    }
  // Scenario 05 replays the full combat chain; under parallel load its wall
  // time exceeds the previous 180s, so give the same assertions more headroom.
  }, 480_000);
});
