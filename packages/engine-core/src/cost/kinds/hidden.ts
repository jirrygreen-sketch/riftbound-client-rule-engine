import type { CostPlan, CostPlanInput, CostPaymentReceipt } from '../plan-types.js';
import type { ResolveContext } from '../../effects/contract.js';
import { buildHiddenCostPlan as buildPlan } from '../cost-plan.js';
import { payCostPlan } from '../payment.js';

/**
 * Hidden cost kinds (CR v1.5 811.1.b).
 *
 * - `mode: 'hide'` locks the `[A]` (any-domain Power) hiding cost. `domains`
 *   keeps its planner meaning: an empty array explicitly means universal `[A]`.
 * - `mode: 'play'` ignores base Energy and Power while retaining additional
 *   fees supplied in `cost`.
 *
 * This wrapper locks and pays the plan only. Hide/play permission, facedown
 * zones, the Hidden movement, and the Flow banishment replacement stay with
 * the zone/timing owners (see `src/cost/README.md` integration request 3).
 */
export function buildHiddenCostPlan(ctx: ResolveContext, input: Omit<CostPlanInput, 'cost'> & {
  readonly mode: 'hide' | 'play';
  readonly cost?: CostPlanInput['cost'];
}): CostPlan {
  return buildPlan(ctx, input);
}

export function payHiddenCostPlan(ctx: ResolveContext, plan: CostPlan, options: Parameters<typeof payCostPlan>[2] = {}): CostPaymentReceipt {
  return payCostPlan(ctx, plan, options);
}
