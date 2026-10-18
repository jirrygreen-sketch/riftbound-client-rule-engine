import { payCostPlan } from "../../cost/payment.js";
import type {
  CostPaymentOptions,
  CostPlan,
  CostPlanInput,
  CostPaymentReceipt,
} from "../../cost/plan-types.js";
import type { ResolveContext } from "../../effects/contract.js";
import {
  createTargetTaxAdapter,
  type BoundTargetTax,
  type TargetTaxCollectionOptions,
  type TargetTaxCostAdapter,
  type TaxedTargetFinalizeOptions,
} from "../../target/tax/index.js";
import type { TargetPlan, TargetRequirement } from "../../target/target-plan.js";

/** One target requirement as it enters a Chain item's Finalize step. */
export interface TargetTaxFinalizeTarget {
  readonly requirement: TargetRequirement;
  readonly options?: TaxedTargetFinalizeOptions;
}

/**
 * The smallest production-facing seam needed by Chain Finalize to consume
 * target taxes.  The Chain owner still owns its larger atomic transaction,
 * event queue, and Chain item state; this function only owns target pricing
 * and the existing CostPlan payment.
 */
export interface TargetTaxFinalizeRequest {
  readonly context: ResolveContext;
  readonly kind: TargetTaxCollectionOptions["kind"];
  /** Defaults to the spell's printed cost, or no base cost for an ability. */
  readonly cost?: CostPlanInput;
  readonly targets?: readonly TargetTaxFinalizeTarget[];
  /** Complete active bound set, including expanded/granted Deflect. */
  readonly effects?: readonly BoundTargetTax[];
  /** Temporary 809.1.c ignore window for value-based Deflect. */
  readonly ignoreDeflect?: boolean;
  /** Alias matching the target-tax collection option. */
  readonly ignoreTax?: boolean;
  /** Skip payment when a caller is only asking for a finalized plan. */
  readonly pay?: boolean;
  readonly payment?: CostPaymentOptions;
  /**
   * Optional outer transaction.  When omitted, an available context
   * transaction is used.  This wraps target choice, notifications, and pay.
   */
  readonly transaction?: <T>(run: () => T) => T;
}

export interface TargetTaxFinalizeResult {
  readonly adapter: TargetTaxCostAdapter;
  readonly targetPlans: readonly TargetPlan[];
  readonly costPlan?: CostPlan;
  readonly payment?: CostPaymentReceipt;
}

const zeroCost = (id: string): CostPlanInput => ({
  id,
  cost: { energy: { kind: "constant", value: 0 } },
});

function hasAdditionalCost(plan: CostPlan): boolean {
  return plan.components.some(component => component.stage !== "base");
}

/**
 * Finalize all target requirements against one accumulated CostPlan.  Every
 * selection is priced against the base cost plus earlier taxes; payment is
 * performed only after all target choices have passed the combined
 * affordability check. The transaction also covers cost choices and target
 * notifications, which may have caller-owned side effects.
 */
export function finalizeTargetTax(request: TargetTaxFinalizeRequest): TargetTaxFinalizeResult {
  const transaction = request.transaction ?? request.context.transaction ?? request.payment?.transaction;

  const run = (): TargetTaxFinalizeResult => {
    const source = request.context.source.ref;
    const id = `cost:target-tax:${source.id}:${source.zoneEntryId}`;
    const input = request.cost ?? (request.kind === "spell"
      ? { id, cost: { kind: "printed" } } satisfies CostPlanInput
      : zeroCost(id));
    const adapter = createTargetTaxAdapter(request.context, input, {
      kind: request.kind,
      effects: request.effects,
      ignoreDeflect: request.ignoreDeflect,
      ignoreTax: request.ignoreTax,
    });
    const targetPlans: TargetPlan[] = [];
    for (const target of request.targets ?? []) {
      targetPlans.push(adapter.finalizeTargetPlan(target.requirement, target.options));
    }

    const costPlan = adapter.costPlan;
    // An ability that supplied no cost and selected no taxed target has no
    // payment action to emit.  Keep the internal zero plan on the adapter so
    // later target selections can still be appended in the same transaction.
    const needsPayment = request.kind === "spell" || request.cost !== undefined || hasAdditionalCost(costPlan);
    const shouldPay = request.pay !== false && needsPayment;
    if (!shouldPay) return { adapter, targetPlans: Object.freeze(targetPlans), costPlan: needsPayment ? costPlan : undefined };

    const paymentOptions = request.payment === undefined
      ? {}
      : transaction === undefined
        ? request.payment
        : { ...request.payment, transaction: undefined };
    const payment = payCostPlan(request.context, costPlan, paymentOptions);
    return { adapter, targetPlans: Object.freeze(targetPlans), costPlan, payment };
  };

  return transaction === undefined ? run() : transaction(run);
}

/** Alias emphasizing that this is the Chain Finalize consumer. */
export const finalizeTargetsWithTax = finalizeTargetTax;
