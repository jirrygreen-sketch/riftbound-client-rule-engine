import type { CostPlan, CostPlanInput, CostPaymentReceipt } from '../plan-types.js';
import type { Expr, ResolveContext } from '../../effects/contract.js';
import type { PickSpec } from '@riftbound/card-dsl';
import { buildCostPlan } from '../cost-plan.js';
import { payCostPlan } from '../payment.js';

/**
 * Discard cost kind: pays by discarding cards, either through an explicit
 * non-targeting object selection (with an optional exact `amount`) or through
 * a stable PickSpec choice (CR v1.5 357.2). Object choices are private and are
 * checked against the offered options exactly like the planner's other
 * nonstandard costs.
 */
export interface CostObjectSelection {
  readonly choice?: PickSpec;
  readonly object?: Expr;
  readonly objects?: Expr;
  readonly amount?: Expr;
}

export function costPayment(kind: 'discard' | 'recycle' | 'exhaust', selection: CostObjectSelection) {
  return {
    kind,
    ...(selection.choice ? { choice: selection.choice } : {}),
    ...(selection.object !== undefined ? { object: selection.object } : {}),
    ...(selection.objects !== undefined ? { objects: selection.objects } : {}),
    ...(selection.amount !== undefined ? { amount: selection.amount } : {})
  };
}

export function buildDiscardCostPlan(ctx: ResolveContext, selection: CostObjectSelection, input: Omit<CostPlanInput, 'cost'>): CostPlan {
  return buildCostPlan(ctx, { ...input, cost: { payments: [costPayment('discard', selection)] } });
}

export function payDiscardCostPlan(ctx: ResolveContext, plan: CostPlan, options: Parameters<typeof payCostPlan>[2] = {}): CostPaymentReceipt {
  return payCostPlan(ctx, plan, options);
}
