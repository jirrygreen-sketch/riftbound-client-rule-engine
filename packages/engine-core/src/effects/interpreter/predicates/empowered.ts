import type { ConditionOperator, Expr, ObjectSelector, Value } from "@riftbound/card-dsl";
import type { ObjectSnapshot } from "../../contract.js";
import { resolveObjectSelector, selectorSnapshot } from "../selectors.js";
import { MissingInformation, compareValues } from "../values.js";
import { eventObject, record } from "./helpers.js";
import type { PredicateContext } from "./types.js";
import { isEmpowered, readEmpowered } from "../../../zones/empower-state.js";

export type EmpoweredSelector = ObjectSelector | "object" | "target" | "it";

/** Additive predicate shape for callers that have a condition-specific IR extension. */
export interface EmpoweredCondition {
  readonly kind?: "empowered";
  readonly object?: EmpoweredSelector;
  readonly operator?: ConditionOperator;
  readonly right?: Expr | Value;
  readonly value?: Expr | Value;
  readonly expected?: boolean;
}

function eventRole(context: PredicateContext, selector: EmpoweredSelector): ObjectSnapshot | null {
  if (selector === "object" || selector === "target" || selector === "it") {
    const candidate = record((context.event as Record<string, unknown> | undefined)?.[selector]);
    if (candidate !== null) return candidate as unknown as ObjectSnapshot;
    try {
      return eventObject(context, selector) as unknown as ObjectSnapshot;
    } catch (error) {
      if (error instanceof MissingInformation) return null;
      throw error;
    }
  }
  return null;
}

function selectedSnapshot(context: PredicateContext, selector: EmpoweredSelector = "self"): ObjectSnapshot {
  const fromEvent = eventRole(context, selector);
  if (fromEvent !== null) return fromEvent;
  if (selector === "self") {
    const host = context.host;
    if (host !== undefined) return selectorSnapshot(host, context, true);
    return context.context.source;
  }
  if (selector === "source") return context.context.source;
  const refs = resolveObjectSelector(selector as ObjectSelector, context);
  const ref = refs[0];
  if (ref === undefined) throw new MissingInformation("Empowered predicate has no selected object");
  return selectorSnapshot(ref, context);
}

function rhs(context: PredicateContext, value: Expr | Value | undefined): Value | undefined {
  if (value === undefined) return undefined;
  if (value !== null && typeof value === "object" && !Array.isArray(value) && "kind" in value) {
    return context.context.evaluate(value as Expr);
  }
  return value as Value;
}

/**
 * Evaluate an Empowered state predicate against an authoritative context.
 * With one argument this is also a convenient snapshot boolean predicate.
 */
export function evaluateEmpowered(snapshot: unknown): boolean;
export function evaluateEmpowered(condition: EmpoweredCondition, context: PredicateContext): boolean;
export function evaluateEmpowered(
  conditionOrSnapshot: EmpoweredCondition | unknown,
  context?: PredicateContext
): boolean {
  if (context === undefined) return isEmpowered(conditionOrSnapshot);
  const condition = conditionOrSnapshot as EmpoweredCondition;
  const snapshot = selectedSnapshot(context, condition.object ?? "self");
  const count = readEmpowered(snapshot);
  if (condition.expected !== undefined) return (count > 0) === condition.expected;
  const right = rhs(context, condition.right ?? condition.value);
  if (condition.operator === undefined && right === undefined) return count > 0;
  return compareValues(count as Value, condition.operator ?? "eq", right ?? 1 as Value);
}

export const evaluateEmpoweredPredicate = evaluateEmpowered;
export const empoweredPredicate = evaluateEmpowered;

/** Read the count for layer/condition adapters that need stacking semantics. */
export function empoweredCount(context: PredicateContext, selector: EmpoweredSelector = "self"): number {
  return readEmpowered(selectedSnapshot(context, selector));
}
