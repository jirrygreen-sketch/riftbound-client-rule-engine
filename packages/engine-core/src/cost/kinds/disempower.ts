import type { CostPlan, CostPlanInput, CostPaymentReceipt } from '../plan-types.js';
import type { ObjectRef, ResolveContext } from '../../effects/contract.js';
import type { CostObjectSelection } from './discard.js';
import { buildCostPlan } from '../cost-plan.js';
import { payCostPlan } from '../payment.js';

/** Disempower as a Limited Action cost (CR v1.5 443.2.a). */
export function buildDisempowerCostPlan(
  ctx: ResolveContext,
  selection: CostObjectSelection | ObjectRef,
  input: Omit<CostPlanInput, 'cost'> = typeof selection === 'object' && 'id' in selection
    ? { id: `disempower:${selection.id}:${selection.zoneEntryId}` }
    : { id: 'disempower' }
): CostPlan {
  const value = typeof selection === 'object' && 'id' in selection
    ? { object: selection }
    : selection;
  return buildCostPlan(ctx, { ...input, cost: { payments: [{ kind: 'disempower', ...value }] } });
}

export function payDisempowerCostPlan(ctx: ResolveContext, plan: CostPlan, options: Parameters<typeof payCostPlan>[2] = {}): CostPaymentReceipt {
  return payCostPlan(ctx, plan, options);
}
