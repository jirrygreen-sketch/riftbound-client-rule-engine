import type { CostSpec, Expr, TargetTaxEffect } from "@riftbound/card-dsl";
import type { CostComponentInput } from "../../cost/plan-types.js";
import { CostPlanError } from "../../cost/plan-types.js";
import { DUEL_DOMAINS } from "../../cost/resources.js";
import type { ObjectRef, ObjectSnapshot, ResolveContext } from "../../effects/contract.js";
import { bindResolveContext } from "../../events/action-adapter.js";
import { evaluateExpression } from "../../effects/interpreter/expr.js";

/** An already-active static declaration, bound to its exact target zone entry. */
export interface BoundTargetTax {
  readonly id: string;
  readonly target: ObjectRef;
  readonly effect: TargetTaxEffect;
}

export interface TargetTaxCollectionOptions {
  /** Abilities may have a unit/gear as their source; never infer this from its type. */
  readonly kind: "spell" | "ability";
  /**
   * When supplied, this is the complete active tax set, including expanded
   * Deflect. Otherwise use the target's current layered Deflect keywords.
   * Using one representation prevents charging an expanded keyword twice.
   */
  readonly effects?: readonly BoundTargetTax[];
}

export interface CollectedTargetTax extends CostComponentInput {
  readonly stage: "mandatory-additional" | "increase";
}

export function deflectAmount(target: ObjectSnapshot): number {
  let amount = 0;
  for (const keyword of target.keywords) {
    if (keyword.id.toLowerCase() !== "deflect") continue;
    const value = keyword.value ?? 1;
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(amount + value)) {
      throw new CostPlanError("invalid-cost-plan", "Deflect values must sum to a non-negative safe integer");
    }
    amount += value;
  }
  return amount;
}

/** CR 809.1.c.1: [A], independently of either card's domains. */
export function deflectCost(amount: number): CostComponentInput["cost"] {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new CostPlanError("invalid-cost-plan", "Deflect requires a non-negative safe integer");
  }
  return { payments: [{ kind: "power", amount: { kind: "constant", value: amount }, allowedDomains: [...DUEL_DOMAINS] }] };
}

export function collectTargetTaxes(
  context: ResolveContext,
  target: ObjectSnapshot,
  options: TargetTaxCollectionOptions
): readonly CollectedTargetTax[] {
  if (target.zone !== "board") return [];
  if (options.effects === undefined) {
    // CR 809.1.c limits Deflect specifically to opposing choosers.
    if (target.controller === context.controller) return [];
    const amount = deflectAmount(target);
    return amount === 0 ? [] : [{ id: "deflect", stage: "mandatory-additional", cost: deflectCost(amount) }];
  }
  const ids = new Set<string>();
  const deflect = new Map<CollectedTargetTax["stage"], number>();
  const explicit = options.effects.flatMap(binding => {
    if (binding.target.id !== target.ref.id || binding.target.zoneEntryId !== target.ref.zoneEntryId) return [];
    if (!binding.id || ids.has(binding.id)) throw new CostPlanError("invalid-cost-plan", "Bound target taxes require unique non-empty IDs per target");
    ids.add(binding.id);
    const effect = binding.effect;
    if (effect.kind !== "target.tax" || effect.appliesTo !== undefined && !["spells", "spells-and-abilities"].includes(effect.appliesTo) ||
      effect.stage !== undefined && !["mandatory-additional", "increase"].includes(effect.stage)) {
      throw new CostPlanError("judge-required", "Unsupported target tax declaration");
    }
    if (effect.appliesTo === "spells" && options.kind !== "spell") return [];
    const evaluate = (expression: Expr) => evaluateExpression(expression, {
      context: bindResolveContext(context, { source: target, controller: target.controller }),
      host: target.ref,
      linked: () => { throw new CostPlanError("judge-required", "Static target taxes cannot read resolution-time linked values"); },
      canLookBack: () => false,
      isIgnored: () => false
    });
    let cost = effect.cost;
    if (cost !== undefined && effect.value !== undefined) throw new CostPlanError("invalid-cost-plan", "Target tax cannot specify both cost and Deflect value");
    if (cost === undefined) {
      if (target.controller === context.controller) return [];
      if (effect.value === undefined) throw new CostPlanError("judge-required", "Target tax needs an explicit cost or Deflect value");
      const value = evaluate(effect.value);
      if (typeof value !== "number") throw new CostPlanError("invalid-cost-plan", "Deflect value must evaluate to a number");
      deflectCost(value);
      const stage = effect.stage ?? "mandatory-additional";
      const amount = (deflect.get(stage) ?? 0) + value;
      deflectCost(amount);
      deflect.set(stage, amount);
      return [];
    } else {
      // Lock resource expressions in the tax host's scope before handing the
      // payment to the choosing spell/ability's CostPlan. Other cost kinds need
      // a separate static-host object-choice contract rather than rebinding self.
      if (cost.kind !== undefined && !["explicit", "activated"].includes(cost.kind) || cost.discard !== undefined || cost.rune !== undefined ||
          cost.payments?.some(payment => !["energy", "power", "xp", "cost.energy", "cost.power", "cost.xp"].includes(payment.kind))) {
        throw new CostPlanError("judge-required", "Target tax supports explicit resource costs; object and printed costs need a host binding contract");
      }
      const literal = (expression: Expr): Expr => ({ kind: "constant", value: evaluate(expression) });
      cost = {
        ...cost,
        ...(cost.energy === undefined ? {} : { energy: literal(cost.energy) }),
        ...(cost.power === undefined ? {} : { power: literal(cost.power) }),
        ...(cost.payments === undefined ? {} : { payments: cost.payments.map(payment => ({
          ...payment,
          ...(payment.amount === undefined ? {} : { amount: literal(payment.amount) }),
          ...(payment.value === undefined ? {} : { value: literal(payment.value) })
        })) })
      } satisfies CostSpec;
    }
    return [{ id: binding.id, cost, stage: effect.stage ?? "mandatory-additional" }];
  });
  return [
    ...[...deflect].flatMap(([stage, amount]) => amount === 0 ? [] : [{ id: `deflect:${stage}`, stage, cost: deflectCost(amount) }]),
    ...explicit
  ];
}
