// Official source audit is explicit; missing catalog fails rather than skips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeDuelOptionalPlayCostV1 } from '../../dist/duel/optional-play-cost-v1.js';
const catalogPath = process.env.RIFTBOUND_OPTIONAL_PLAY_COST_CATALOG ?? new URL('../../../card-data/data/deck-catalog.json', import.meta.url);
test('real catalog census (parent-run)', () => {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const known = [];
  const unknown = [];
  for (const card of catalog.cards) {
    const result = describeDuelOptionalPlayCostV1(card);
    (result.status === 'known' ? known : unknown).push(card.id);
  }
  assert.deepEqual(known.sort(), ['ogn-001-298', 'ogn-010-298']);
  assert.equal(known.length + unknown.length, catalog.cards.length);
  console.log(`[optional-play-cost-v1] known=${known.length} unknown=${unknown.length} total=${catalog.cards.length}`);
});
