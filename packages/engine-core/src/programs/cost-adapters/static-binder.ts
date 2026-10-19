import type { Ability } from '@riftbound/card-dsl';
import type { ObjectSnapshot } from '../../effects/contract.js';
import type { ProgramStaticBinder, StaticBindingHandle } from '../statics.js';

const COST_ONLY_STATIC_KINDS = new Set([
  'cost.additional',
  'accelerate.cost',
  'repeat.cost',
  'flow.cost',
]);

/**
 * Compose the normal layer/replacement binder with the cost-only declarations
 * owned by this adapter. Cost declarations are consumed by bindProgramCost at
 * Play/Activate Finalize; they are not continuous effects and must not be sent
 * to a layer mapper.
 */
export function withProgramCostStatics(binder: ProgramStaticBinder): ProgramStaticBinder {
  return {
    bindStatic(ability, source) {
      if (ability.kind === 'static' && COST_ONLY_STATIC_KINDS.has(String(ability.effect.kind))) {
        return { unbind() {} } satisfies StaticBindingHandle;
      }
      return binder.bindStatic?.(ability, source) ?? { unbind() {} };
    },
    bindReplacement(ability, source) {
      return binder.bindReplacement?.(ability, source) ?? { unbind() {} };
    },
  };
}

export function isProgramCostStatic(ability: Ability): boolean {
  return ability.kind === 'static' && COST_ONLY_STATIC_KINDS.has(String(ability.effect.kind));
}
