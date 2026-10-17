import { buildCostPlan } from "../../cost/cost-plan.js";
import { assessCostPayment } from "../../cost/payment.js";
import { CostPlanError, type CostComponentInput, type CostPlan, type CostPlanInput } from "../../cost/plan-types.js";
import type { ObjectSnapshot, ResolveContext } from "../../effects/contract.js";
import { bindResolveContext } from "../../events/action-adapter.js";
import {
  finalizeTargetPlan, queryTargetCandidates, TargetSelectionError,
  type TargetCandidateOptions, type TargetFinalizeOptions, type TargetPlan,
  type TargetRequirement, type TargetTaxAdapter, type TargetTaxAppendResult, type TargetTaxRequest
} from "../target-plan.js";
import { collectTargetTaxes, deflectCost, type CollectedTargetTax, type TargetTaxCollectionOptions } from "./collect.js";

export type TaxedTargetFinalizeOptions = Omit<TargetFinalizeOptions, "tax" | "taxAdapter">;

interface TaxState {
  readonly taxes: readonly CollectedTargetTax[];
  readonly plan: CostPlan;
}

/**
 * One adapter per pending spell/ability. Adds taxes before discounts and checks
 * the whole cost, without performing any payment or changing game state.
 */
export class TargetTaxCostAdapter implements TargetTaxAdapter {
  private readonly input: CostPlanInput;
  private state: TaxState;
  private readonly batches = new WeakMap<TargetPlan, TaxState>();
  private readonly rejected = new WeakSet<TargetPlan>();

  constructor(
    private readonly context: ResolveContext,
    input: CostPlanInput,
    private readonly options: TargetTaxCollectionOptions
  ) {
    const original = structuredClone(input);
    let baseChoice = original.baseChoice;
    const plan = buildCostPlan(bindResolveContext(context, {
      choose: request => {
        const answer = context.choose(request);
        if (request.id === `${original.id}:base`) baseChoice = answer as string;
        return answer;
      }
    }), original);
    this.input = { ...original, ...(baseChoice === undefined ? {} : { baseChoice }),
      ...(original.optionalAdditional === undefined ? {} : { optionalAdditional: original.optionalAdditional.map(cost => ({
        ...cost, selected: plan.selectedAdditional.some(selected => selected.id === cost.id)
      })) }) };
    this.state = { taxes: [], plan };
  }

  get costPlan(): CostPlan { return this.state.plan; }

  private build(taxes: readonly CollectedTargetTax[]): CostPlan {
    const occupied = new Set(["base", ...(this.input.optionalAdditional ?? []).map(cost => cost.id),
      ...(this.input.mandatoryAdditional ?? []).map(cost => cost.id), ...(this.input.increases ?? []).map(cost => cost.id)]);
    const mandatory: CostComponentInput[] = [...(this.input.mandatoryAdditional ?? [])];
    const increases: CostComponentInput[] = [...(this.input.increases ?? [])];
    let next = 0;
    for (const tax of taxes) {
      let id: string;
      do { id = `target-tax:${next++}`; } while (occupied.has(id));
      occupied.add(id);
      (tax.stage === "increase" ? increases : mandatory).push({ id, cost: tax.cost });
    }
    return buildCostPlan(this.context, { ...this.input, mandatoryAdditional: mandatory, increases });
  }

  private preview(taxes: readonly CollectedTargetTax[]): TaxState | null {
    const all = structuredClone([...this.state.taxes, ...taxes]);
    const plan = this.build(all);
    return assessCostPayment(this.context, plan).payable ? { taxes: all, plan } : null;
  }

  /** RIFT-90's existing explicit Deflect hook, including cumulative affordability. */
  appendTargetTax(request: TargetTaxRequest): TargetTaxAppendResult {
    const baseline = this.batches.get(request.targetPlan) ?? this.state;
    this.batches.set(request.targetPlan, baseline);
    if (this.rejected.has(request.targetPlan)) return { status: "unpayable", reason: "Target plan already rejected" };
    try {
      if (request.kind !== "deflect" || request.payer !== this.context.controller ||
          !request.targetPlan.selected.some(ref => ref.id === request.target.id && ref.zoneEntryId === request.target.zoneEntryId)) {
        throw new CostPlanError("invalid-cost-plan", "Target tax must use the selecting controller and a locked target");
      }
      const target = this.context.object(request.target);
      if (!target) throw new TargetSelectionError("invalid-target-choice", "Target tax reference is no longer valid");
      const cost = deflectCost(request.amount);
      if (target.controller === this.context.controller || target.zone !== "board" || request.amount === 0) return { status: "appended" };
      const next = this.preview([{ id: "deflect", stage: "mandatory-additional", cost }]);
      if (next) { this.state = next; return { status: "appended" }; }
      this.state = baseline;
      this.rejected.add(request.targetPlan);
      return { status: "unpayable", reason: "The complete cost including Deflect is not payable" };
    } catch (error) {
      this.state = baseline;
      this.rejected.add(request.targetPlan);
      throw error;
    }
  }

  private taxes(target: ObjectSnapshot): readonly CollectedTargetTax[] {
    return collectTargetTaxes(this.context, target, this.options);
  }

  private candidates(options: TargetCandidateOptions): TargetCandidateOptions {
    return { ...options, isLegal: (target, phase) =>
      (options.isLegal?.(target, phase) ?? true) && this.preview(this.taxes(target)) !== null };
  }

  queryTargetCandidates(requirement: TargetRequirement, options: TargetCandidateOptions = {}) {
    return queryTargetCandidates(this.context, requirement, this.candidates(options));
  }

  /** Reject a combined selection before publishing any finalized/targeted event. */
  finalizeTargetPlan(requirement: TargetRequirement, options: TaxedTargetFinalizeOptions = {}): TargetPlan {
    const baseline = this.state;
    try {
      return finalizeTargetPlan(this.context, requirement, {
        ...options,
        ...this.candidates(options),
        onTargetsFinalized: event => {
          const taxes = event.targets.flatMap(ref => {
            const target = this.context.object(ref);
            if (!target) throw new TargetSelectionError("invalid-target-choice", "Target disappeared before tax collection");
            return this.taxes(target);
          });
          const next = this.preview(taxes);
          if (!next) throw new TargetSelectionError("target-tax-unpayable", "The combined target taxes and base cost are not payable");
          this.state = next;
          options.onTargetsFinalized?.(event);
        }
      });
    } catch (error) {
      this.state = baseline;
      throw error;
    }
  }
}

export function createTargetTaxAdapter(
  context: ResolveContext, input: CostPlanInput, options: TargetTaxCollectionOptions
): TargetTaxCostAdapter {
  return new TargetTaxCostAdapter(context, input, options);
}
