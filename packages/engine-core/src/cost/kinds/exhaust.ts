import type { CostPlan, CostPlanInput, CostPaymentReceipt } from '../plan-types.js';
import type { ResolveContext } from '../../effects/contract.js';
import { buildCostPlan } from '../cost-plan.js';
import { payCostPlan } from '../payment.js';
import { costPayment, type CostObjectSelection } from './discard.js';

/**
 * Exhaust cost kind: exhausts ready controlled permanents on the Board (or the
 * selected Rune in the Rune Zone), reusing the existing payment kind and the
 * CR v1.5 357.2 ordering.
 */
export function buildExhaustCostPlan(ctx: ResolveContext, selection: CostObjectSelection, input: Omit<CostPlanInput, 'cost'>): CostPlan {
  return buildCostPlan(ctx, { ...input, cost: { payments: [costPayment('exhaust', selection)] } });
}

export function payExhaustCostPlan(ctx: ResolveContext, plan: CostPlan, options: Parameters<typeof payCostPlan>[2] = {}): CostPaymentReceipt {
  return payCostPlan(ctx, plan, options);
}
