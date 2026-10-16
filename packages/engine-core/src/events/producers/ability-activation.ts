import type { ObjectSnapshot, PlayerId } from '../../effects/contract.js';
import type { TimingEmission } from '../pipeline-types.js';

export interface AbilityActivationProof {
  readonly status: 'committed' | 'cancelled' | 'countered' | 'invalid';
  readonly chainItemId: string;
  readonly playerId: PlayerId;
  readonly sourceId: string;
  readonly abilityId: string;
  readonly source?: ObjectSnapshot;
}

function nonEmpty(value: string, name: string): string {
  if (value.trim().length === 0) throw new TypeError(`${name} must not be empty`);
  return value;
}

/**
 * Convert a trusted post-Finalize activation result into the one activation
 * timing. Cancelled, countered and invalid attempts deliberately produce no
 * timing; activation is observed only after the legal flow commits.
 */
export function deriveAbilityActivatedEmission(
  proof: AbilityActivationProof,
): TimingEmission | null {
  nonEmpty(proof.chainItemId, 'chainItemId');
  nonEmpty(proof.playerId, 'playerId');
  nonEmpty(proof.sourceId, 'sourceId');
  nonEmpty(proof.abilityId, 'abilityId');
  if (proof.source !== undefined && proof.source.ref.id !== proof.sourceId) {
    throw new TypeError('sourceId does not match source snapshot');
  }
  if (proof.status !== 'committed') return null;
  return {
    timingPoint: 'ability-activated',
    kind: 'ability-activated',
    source: proof.source,
    player: proof.playerId,
    details: {
      chainItemId: proof.chainItemId,
      playerId: proof.playerId,
      sourceId: proof.sourceId,
      abilityId: proof.abilityId,
    },
    simultaneousGroup: proof.chainItemId,
  };
}
