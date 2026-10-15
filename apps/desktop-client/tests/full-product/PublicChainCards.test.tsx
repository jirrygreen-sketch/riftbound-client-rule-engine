import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server.node';
import { DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1, isDuelProjectionV3Actions1,
  type DuelProjectionV3Actions1 } from '@riftbound/protocol';
import { DuelMatchBoard, duelPreviewTarget, duelPublicChainCards } from '../../src/full-product/DuelMatchBoard';

describe('public Chain card display contract', () => {
  it('reads duplicate public entries in order without exposing physical identity', () => {
    const projection = {
      projectionSchema: 'riftbound-duel-v3-actions-1',
      viewerPlayerId: 'alice',
      match: {
        stage: 'playing',
        frame: {
          chain: {
            active: true,
            itemCount: 2,
            pendingCount: 1,
            cards: [
              { cardId: 'premonition', controllerPlayerId: 'alice', status: 'pending' },
              { cardId: 'premonition', controllerPlayerId: 'alice', status: 'finalized' }
            ]
          }
        }
      }
    } as any;
    expect(duelPublicChainCards(projection)).toHaveLength(2);
    expect(duelPublicChainCards(projection)[0]).toEqual({
      cardId: 'premonition', controllerPlayerId: 'alice', status: 'pending'
    });
    expect(JSON.stringify(duelPublicChainCards(projection))).not.toContain('uid');
  });

  it('renders public catalog card faces and permits their read-only preview target', () => {
    const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL(
      '../../../../packages/protocol/test/fixtures/duel-v2-projection.json', import.meta.url
    )), 'utf8')) as Record<string, Record<string, unknown>>;
    const source = structuredClone(fixtures.changed!.null) as any;
    source.projectionSchema = DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1;
    source.match.schemaVersion = 3;
    for (const player of source.match.players) player.legend = {
      cardId: player.legend.cardId, controllerPlayerId: player.playerId, readiness: 'ready'
    };
    source.match.board.gears = [];
    source.match.frame.stateOpen = false;
    source.match.frame.chain = { active: true, itemCount: 2, pendingCount: 0, cards: [
      { cardId: 'public-spell', controllerPlayerId: 'p2', status: 'finalized' },
      { cardId: 'public-spell', controllerPlayerId: 'p2', status: 'finalized' }
    ] };
    source.match.frame.pendingChoice = null;
    source.match.frame.execution = { status: 'ready' };
    source.actions = [];
    const projection = source as DuelProjectionV3Actions1;
    expect(isDuelProjectionV3Actions1(projection)).toBe(true);
    expect(duelPreviewTarget(projection, 'public-spell')).toBe('public-spell');
    const html = renderToStaticMarkup(<DuelMatchBoard projection={projection}
      connectionStatus="connected" commandPending={false} onCommand={() => {}}
      resolveCardTitle={id => id === 'public-spell' ? '预言' : id}
      resolveCardImage={id => id === 'public-spell' ? '/cards/public-spell.png' : null} />);
    expect(html.split('full-product-duel-chain-card').length - 1).toBe(2);
    expect(html).toContain('预言');
    expect(html).toContain('/cards/public-spell.png');
    expect(html).toContain('Player 2');
  });
});
