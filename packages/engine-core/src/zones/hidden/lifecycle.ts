import type { CostSpec } from '@riftbound/card-dsl';
import type { ResolveContext } from '../../effects/contract.js';
import {
  buildHiddenCostPlan,
  payHiddenCostPlan,
} from '../../cost/kinds/hidden.js';
import type { CostPaymentOptions, CostPaymentReceipt, CostPlan, CostPlanInput } from '../../cost/plan-types.js';
import { hideCard, type HideCardInput, type HideCardResult } from './state.js';
import { playFromHidden, type HiddenPlayInput, type HiddenPlayResult } from './play.js';
import type { HiddenState } from './types.js';

export interface HiddenCostInput extends Omit<CostPlanInput, 'id' | 'cost'> {
  readonly ctx: ResolveContext;
  readonly costId: string;
  readonly cost?: CostSpec;
  readonly paymentOptions?: CostPaymentOptions;
}

export interface HiddenHideWithCostInput extends HideCardInput, HiddenCostInput {}
export interface HiddenPlayWithCostInput extends HiddenPlayInput, HiddenCostInput {}

export interface HiddenCostResult<T> {
  readonly state: HiddenState;
  readonly plan: CostPlan;
  readonly receipt: CostPaymentReceipt;
  readonly result: T;
}

/**
 * Validate the Hide transition before paying, then pay the existing [A]
 * helper and return the immutable sidecar transition.  The canonical owner
 * applies `result.transition` to the live object store; this function never
 * performs a second hand/board mutation or fabricates a payment receipt.
 */
export function hideWithCost(
  state: HiddenState,
  input: HiddenHideWithCostInput
): HiddenCostResult<HideCardResult> {
  const candidate = hideCard(state, input);
  const { ctx, costId, paymentOptions, ...planInput } = input;
  const plan = buildHiddenCostPlan(ctx, { ...planInput, id: costId, mode: 'hide' });
  const receipt = payHiddenCostPlan(ctx, plan, paymentOptions);
  return { state: candidate.state, plan, receipt, result: candidate };
}

/**
 * Pay a Hidden card's from-Hidden cost only after all destination/target
 * restrictions have been validated.  Base Energy/Power is ignored by the
 * existing planner; additional fees remain payable through the normal cost
 * plan fields.
 */
export function playFromHiddenWithCost(
  state: HiddenState,
  input: HiddenPlayWithCostInput
): HiddenCostResult<HiddenPlayResult> {
  // Preflight before payment so an illegal destination cannot consume [A] or
  // any additional fee.  The second call after payment is against immutable
  // sidecar state and therefore cannot change the preflight decision.
  const candidate = playFromHidden(state, input);
  const { ctx, costId, paymentOptions, ...planInput } = input;
  const plan = buildHiddenCostPlan(ctx, { ...planInput, id: costId, mode: 'play' });
  const receipt = payHiddenCostPlan(ctx, plan, paymentOptions);
  return { state: candidate.state, plan, receipt, result: candidate };
}

