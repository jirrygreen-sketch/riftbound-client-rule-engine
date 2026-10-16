import { loadCardCatalogRuntime } from '../../../src/card-catalog.js';
import { DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1 } from '@riftbound/protocol';
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from '../fixtures/setup-adapter-catalog.js';

export async function options(directory: string) {
  const cards = setupAdapterFixtureCatalog.cards.map(card => ({ ...card,
    ability: card.cardType === 'Unit' ? '' : card.cardType === 'Spell' ? 'Draw 4.' :
      card.cardType === 'Legend' ? ':rb_energy_1:, :rb_exhaust:: Play a 1 :rb_might: Recruit unit token.' :
        card.cardType === 'Battlefield' ? 'You may hide an additional card here.' : card.ability }));
  const catalog = await loadCardCatalogRuntime({ catalog: { ...setupAdapterFixtureCatalog, cards,
    dataVersion: '2026-10-12-official-gallery', digest: 'sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10' } });
  let uid = 0;
  return { directory, catalog, matchId: 'persistent-p4-fixture', randomIndex: () => 0,
    uidFactory: () => `persistent-p4-${++uid}`, roster: [
      { playerId: 'alice', displayName: 'Alice', deck: setupAdapterFixtureDecks.a.submission },
      { playerId: 'bob', displayName: 'Bob', deck: setupAdapterFixtureDecks.b.submission }] as const };
}
export function packet(version: number, id: string, command: unknown) {
  return { type: 'duel-command', commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
    requestId: id, commandId: id, expectedVersion: version, command };
}
