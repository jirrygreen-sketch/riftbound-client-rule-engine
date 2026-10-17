import type { Condition, Expr, Value } from "@riftbound/card-dsl";
import type { ObjectSnapshot } from "../../contract.js";
import type { ExpressionContext } from "../expr.js";

/** Read-only event data made available to trigger-condition predicates. */
export interface ConditionEventPayload {
  readonly object?: ObjectSnapshot | Readonly<Record<string, unknown>>;
  readonly source?: ObjectSnapshot | Readonly<Record<string, unknown>>;
  readonly target?: ObjectSnapshot | Readonly<Record<string, unknown>>;
  readonly fromZone?: string;
  readonly toZone?: string;
  readonly playedFromZone?: string;
  readonly playedFromHand?: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

/**
 * The finalized cost facts visible to a resolving ability.  Chain supplies
 * both halves: the plan describes which components exist, while the receipt
 * proves that the whole plan was paid.  Keeping them separate prevents an
 * empty receipt list from being mistaken for a successful payment decision.
 */
export interface ConditionCostPlan {
  readonly components?: readonly Readonly<Record<string, unknown>>[];
  readonly selectedAdditional?: readonly Readonly<Record<string, unknown>>[];
  readonly declinedAdditional?: readonly string[];
  readonly [key: string]: unknown;
}

export interface ConditionPaymentReceipt {
  readonly paid?: boolean;
  readonly additional?: readonly Readonly<Record<string, unknown>>[];
  readonly [key: string]: unknown;
}

/** The subset of a finalized cost result needed by condition.result. */
export interface ConditionCostResult {
  readonly plan?: ConditionCostPlan;
  readonly receipt?: ConditionPaymentReceipt;
  readonly selectedAdditional?: readonly Readonly<Record<string, unknown>>[];
  readonly declinedAdditional?: readonly string[];
  readonly additional?: readonly Readonly<Record<string, unknown>>[];
  readonly optionalAdditional?: readonly Readonly<Record<string, unknown>>[];
  readonly [key: string]: unknown;
}

/** Expression context extended with event and finalized-result read access. */
export type PredicateContext = ExpressionContext & {
  readonly event?: unknown;
  readonly cost?: unknown;
  readonly results?: unknown;
  readonly result?: unknown;
};

export type PredicateCondition = Extract<
  Condition,
  { readonly kind: "played-from-hand" | "playedFromHand" | "played-from-zone" | "playedFromZone" |
    "event-printed" | "printed-characteristic" | "event-printed-characteristic" | "result" }
>;

export type PredicateExpression = Expr;
