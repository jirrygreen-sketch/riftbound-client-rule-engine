import type { CostPlan, CostPlanInput, CostPaymentReceipt } from '../plan-types.js';
import type { ObjectRef, ResolveContext } from '../../effects/contract.js';
import { buildCostPlan } from '../cost-plan.js';
import { payCostPlan } from '../payment.js';

/**
 * Sacrifice cost kind (CR v1.5 356.7).
 *
 * The official nonstandard-cost example is killing a friendly unit, and the
 * frozen primitive action set has no separate sacrifice action, so the wording
 * maps to the existing `kill` payment for a permanent the paying player
 * controls. Payment order follows 357.2, and replacements/prevention still
 * apply to the underlying action. If a ruling ever separates sacrifice from
 * kill (for example death-trigger timing), that is a parent-owned closed-set
 * change; this wrapper must not approximate it.
 */
export function buildSacrificeCostPlan(ctx: ResolveContext, object: ObjectRef, input: Omit<CostPlanInput, 'cost'> = defaultSacrificeInput(object)): CostPlan {
  return buildCostPlan(ctx, {
    ...input,
    cost: { payments: [{ kind: 'kill', object }] }
  });
}

export function paySacrificeCostPlan(ctx: ResolveContext, plan: CostPlan, options: Parameters<typeof payCostPlan>[2] = {}): CostPaymentReceipt {
  return payCostPlan(ctx, plan, options);
}

function defaultSacrificeInput(object: ObjectRef): Omit<CostPlanInput, 'cost'> {
  return { id: `sacrifice:${object.id}:${object.zoneEntryId}` };
}
