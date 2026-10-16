import { setupAdapterFixtureCatalog } from './setup-adapter-catalog.js';

/** Synthetic finite source fixture. Modified abilities are not official coverage. */
export const p4RuntimeFixtureCatalog = { ...setupAdapterFixtureCatalog,
  dataVersion: '2026-10-15-official-gallery',
  digest: 'sha256:e9635b38044140375c33d9e5d8e12c1c2386994dfaa9ae8ae6832a127ff9f73d',
  cards: setupAdapterFixtureCatalog.cards.map(card => ({ ...card,
    ability: card.cardType === 'Unit' ? '' : card.cardType === 'Spell' ? 'Draw 4.' :
      card.cardType === 'Legend' ? ':rb_energy_1:, :rb_exhaust:: Play a 1 :rb_might: Recruit unit token.' :
        card.cardType === 'Battlefield' ? 'You may hide an additional card here.' : card.ability })),
};
