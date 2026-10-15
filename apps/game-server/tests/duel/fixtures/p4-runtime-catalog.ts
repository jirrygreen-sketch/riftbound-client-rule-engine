import { setupAdapterFixtureCatalog } from './setup-adapter-catalog.js';

/** Synthetic finite source fixture. Modified abilities are not official coverage. */
export const p4RuntimeFixtureCatalog = { ...setupAdapterFixtureCatalog,
  dataVersion: '2026-10-12-official-gallery',
  digest: 'sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10',
  cards: setupAdapterFixtureCatalog.cards.map(card => ({ ...card,
    ability: card.cardType === 'Unit' ? '' : card.cardType === 'Spell' ? 'Draw 4.' :
      card.cardType === 'Legend' ? ':rb_energy_1:, :rb_exhaust:: Play a 1 :rb_might: Recruit unit token.' :
        card.cardType === 'Battlefield' ? 'You may hide an additional card here.' : card.ability })),
};
