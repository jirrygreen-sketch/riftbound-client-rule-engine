import type { CostPlan, CostPlanInput, CostPaymentReceipt } from '../plan-types.js';
import type { Expr, ResolveContext } from '../../effects/contract.js';
import { buildCostPlan } from '../cost-plan.js';
import { payCostPlan } from '../payment.js';

/**
 * XP cost kind: pays `amount` XP through the `spend-xp` payment resource
 * (CR v1.5 357.2). The plan is locked with the rest of the cost plan and the
 * spend is sequenced after the combined Energy/Power payment.
 */
export function buildXpCostPlan(ctx: ResolveContext, amount: Expr, input: Omit<CostPlanInput, 'cost'>): CostPlan {
  return buildCostPlan(ctx, {
    ...input,
    cost: { payments: [{ kind: 'xp', amount }] }
  });
}

export function payXpCostPlan(ctx: ResolveContext, plan: CostPlan, options: Parameters<typeof payCostPlan>[2] = {}): CostPaymentReceipt {
  return payCostPlan(ctx, plan, options);
}
