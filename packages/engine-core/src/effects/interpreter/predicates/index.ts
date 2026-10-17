import type { Condition } from "@riftbound/card-dsl";
import { evaluatePlayedFromHand, evaluatePlayedFromZone } from "./play-origin.js";
import { evaluatePrintedCharacteristic } from "./printed.js";
import { evaluateResult } from "./result.js";
import type { PredicateContext } from "./types.js";

export type { ConditionEventPayload, ConditionCostPlan, ConditionPaymentReceipt, ConditionCostResult, PredicateContext } from "./types.js";
export { evaluatePlayedFromHand, evaluatePlayedFromZone } from "./play-origin.js";
export { evaluatePrintedCharacteristic } from "./printed.js";
export { evaluateResult } from "./result.js";

/** Evaluate the condition members that require event or finalized-result data. */
export function evaluatePredicateCondition(condition: Condition, context: PredicateContext): boolean {
  switch (condition.kind) {
    case "played-from-hand":
    case "playedFromHand":
      return evaluatePlayedFromHand(condition, context);
    case "played-from-zone":
    case "playedFromZone":
      return evaluatePlayedFromZone(condition, context);
    case "event-printed":
    case "printed-characteristic":
    case "event-printed-characteristic":
      return evaluatePrintedCharacteristic(condition, context);
    case "result":
      return evaluateResult(condition, context);
    default:
      throw new Error(`Unsupported predicate condition: ${String((condition as { kind: unknown }).kind)}`);
  }
}
