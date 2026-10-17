import type { PrintedCharacteristicCondition } from "@riftbound/card-dsl";
import { readPrintedCharacteristic, comparePredicate, valueOrExpression } from "./helpers.js";
import type { PredicateContext } from "./types.js";

export function evaluatePrintedCharacteristic(
  condition: PrintedCharacteristicCondition,
  context: PredicateContext
): boolean {
  const left = readPrintedCharacteristic(context, condition.object, condition.characteristic);
  const right = valueOrExpression(context, condition.right);
  return comparePredicate(left, condition.operator, right);
}
