import type { ContinuousEffect, Expr } from "@riftbound/card-dsl";
import { evaluateExpression, type ExpressionContext } from "../expr.js";

const EXPRESSION_KINDS = new Set<Expr["kind"]>([
  "constant", "literal", "location", "object-property", "object-attribute", "linked", "linked-value",
  "count", "arithmetic", "player-property", "turn-number", "player-turn-count", "object-designation"
]);

/**
 * Materialize a layer's scalar expression slots at the instant of evaluation
 * (CR 478.1), using that layer's current ResolveContext. Never rewrite the IR
 * or interpret expression-shaped literal payloads recursively.
 *
 * The caller owns layer ordering, dependencies, duration and cache invalidation;
 * this helper neither registers effects nor retains an evaluated snapshot.
 */
export function resolveLayerEffectExpressions(effect: ContinuousEffect, environment: ExpressionContext): ContinuousEffect {
  const resolved: { kind: string; value?: Expr; [key: string]: unknown } = { ...effect };
  for (const key of ["amount", "value", "delta", "keywordValue"] as const) {
    const value = effect[key];
    if (value !== null && typeof value === "object" && !Array.isArray(value) && "kind" in value &&
      typeof value.kind === "string" && EXPRESSION_KINDS.has(value.kind as Expr["kind"])) {
      const result = evaluateExpression(value as unknown as Expr, environment);
      if (key === "value") resolved.value = { kind: "constant", value: result };
      else resolved[key] = result;
    }
  }
  return resolved;
}
