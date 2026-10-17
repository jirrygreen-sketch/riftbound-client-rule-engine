import type { ResultCondition } from "@riftbound/card-dsl";
import { comparePredicate, readResultValue, valueOrExpression } from "./helpers.js";
import type { PredicateContext } from "./types.js";

export function evaluateResult(condition: ResultCondition, context: PredicateContext): boolean {
  const actual = readResultValue(context, condition.result, condition.id, condition.key);
  const rhs = condition.right ?? condition.value;
  if (condition.operator === undefined && rhs === undefined) return Boolean(actual);
  const right = rhs === undefined ? true : valueOrExpression(context, rhs);
  return comparePredicate(actual, condition.operator ?? "eq", right);
}
