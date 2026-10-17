import type { Condition } from "../contract.js";
import { evaluateExpression, type ExpressionContext } from "./expr.js";
import { evaluatePredicateCondition } from "./predicates/index.js";
import { compareValues } from "./values.js";

export function evaluateCondition(condition: Condition, environment: ExpressionContext): boolean {
  switch (condition.kind) {
    case "always": return true;
    case "never": return false;
    case "expression": return Boolean(evaluateExpression(condition.value, environment));
    case "compare": return compareValues(
      evaluateExpression(condition.left, environment), condition.operator,
      evaluateExpression(condition.right, environment)
    );
    case "all": return condition.conditions.every(item => evaluateCondition(item, environment));
    case "any": return condition.conditions.some(item => evaluateCondition(item, environment));
    case "not": return !evaluateCondition(condition.condition, environment);
    case "played-from-hand":
    case "playedFromHand":
    case "played-from-zone":
    case "playedFromZone":
    case "event-printed":
    case "printed-characteristic":
    case "event-printed-characteristic":
    case "result":
      return evaluatePredicateCondition(condition, environment as import("./predicates/types.js").PredicateContext);
    default: throw new Error(`Unsupported condition: ${String((condition as { kind: unknown }).kind)}`);
  }
}
