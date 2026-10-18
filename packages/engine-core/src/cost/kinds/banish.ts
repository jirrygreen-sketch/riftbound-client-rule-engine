import type { CostPlan, CostPlanInput, CostPaymentReceipt } from '../plan-types.js';
import type { ObjectRef, ResolveContext } from '../../effects/contract.js';
import type { CostObjectSelection } from './discard.js';
import { buildCostPlan } from '../cost-plan.js';
import { payCostPlan } from '../payment.js';

/** Banish as a non-target cost (CR v1.5 357.2, 428.5). */
export function buildBanishCostPlan(
  ctx: ResolveContext,
  selection: CostObjectSelection | ObjectRef,
  input: Omit<CostPlanInput, 'cost'> = typeof selection === 'object' && 'id' in selection
    ? { id: `banish:${selection.id}:${selection.zoneEntryId}` }
    : { id: 'banish' }
): CostPlan {
  const value = typeof selection === 'object' && 'id' in selection
    ? { object: selection }
    : selection;
  return buildCostPlan(ctx, { ...input, cost: { payments: [{ kind: 'banish', ...value }] } });
}

export function payBanishCostPlan(ctx: ResolveContext, plan: CostPlan, options: Parameters<typeof payCostPlan>[2] = {}): CostPaymentReceipt {
  return payCostPlan(ctx, plan, options);
}
