import type { CostPlan, CostPlanInput, CostPaymentReceipt } from '../plan-types.js';
import type { ResolveContext } from '../../effects/contract.js';
import type { PickSpec } from '@riftbound/card-dsl';
import { buildCostPlan } from '../cost-plan.js';
import { payCostPlan } from '../payment.js';
import { costPayment, type CostObjectSelection } from './discard.js';

/**
 * Recycle cost kind: pays by recycling owned cards from Trash or Runes from
 * the Rune Zone (CR v1.5 357.2), using the same selection forms as the
 * discard kind.
 */
export function buildRecycleCostPlan(ctx: ResolveContext, selection: CostObjectSelection, input: Omit<CostPlanInput, 'cost'>): CostPlan {
  return buildCostPlan(ctx, { ...input, cost: { payments: [costPayment('recycle', selection)] } });
}

export function payRecycleCostPlan(ctx: ResolveContext, plan: CostPlan, options: Parameters<typeof payCostPlan>[2] = {}): CostPaymentReceipt {
  return payCostPlan(ctx, plan, options);
}

export type { CostObjectSelection, PickSpec };
