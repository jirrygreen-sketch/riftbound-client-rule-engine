import type { CostPlan, CostPlanInput, CostPaymentReceipt, OptionalCostInput } from '../plan-types.js';
import type { ResolveContext } from '../../effects/contract.js';
import { buildCostPlan } from '../cost-plan.js';
import { payCostPlan } from '../payment.js';

/**
 * Additional cost kinds (CR v1.5 356.2; Accelerate default per 805.1.b).
 *
 * `costs` are already-shaped optional components (`additional` / `repeat` /
 * `accelerate`); each locks its own paid/declined decision. The Accelerate
 * default `[1][C]` (one Energy plus one Power matching the source's domains,
 * or all six domains when the source is domainless) comes from the planner.
 * Mandatory additional costs (356.2.a) stay in `input`.
 */
export function buildAdditionalCostPlan(ctx: ResolveContext, input: Omit<CostPlanInput, 'optionalAdditional'>, costs: readonly OptionalCostInput[] = []): CostPlan {
  return buildCostPlan(ctx, { ...input, optionalAdditional: costs });
}

export function payAdditionalCostPlan(ctx: ResolveContext, plan: CostPlan, options: Parameters<typeof payCostPlan>[2] = {}): CostPaymentReceipt {
  return payCostPlan(ctx, plan, options);
}
