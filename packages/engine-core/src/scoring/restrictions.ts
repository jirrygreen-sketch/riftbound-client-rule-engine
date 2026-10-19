import type { ObjectSnapshot, PlayerId } from '../effects/contract.js';
import type { ContinuousEffectRegistry } from '../layers/duration.js';
import { restrictions } from '../layers/rules/query.js';

export interface ScoreRestrictionInput {
  readonly registry: ContinuousEffectRegistry;
  readonly player: PlayerId;
  readonly battlefield: ObjectSnapshot;
}

export interface ScorePermission {
  readonly allowed: boolean;
  readonly restrictions: readonly import('../layers/rules/types.js').RuleRestrictionQuery[];
}

/** CR 470-471 / 054.1: every active prohibition is a real Scoring consumer. */
export function scorePermission(input: ScoreRestrictionInput): ScorePermission {
  const found = restrictions(input.registry, 'score', input.battlefield.ref, input.battlefield, input.player);
  return Object.freeze({ allowed: found.length === 0, restrictions: found });
}
