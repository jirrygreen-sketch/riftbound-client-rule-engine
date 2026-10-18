import type { Expr, ObjectFilter, ObjectRef, ObjectSnapshot, ResolveContext, Value } from "../contract.js";
import { queryObjects, resolveObjectSelector, selectorSnapshot } from "./selectors.js";
import { arithmetic, asValue, MissingInformation } from "./values.js";
import { resolveLocationSelector } from "./locations.js";
import type { LocationRef } from "../contract.js";
import { evaluateExtendedExpression } from "./expr-ext/evaluate.js";
import { historyExpressionCount } from "./history.js";

export interface ExpressionContext {
  readonly context: ResolveContext;
  readonly host?: ObjectRef;
  /** Trigger payload and finalized result data are read-only predicate inputs. */
  readonly event?: unknown;
  readonly cost?: unknown;
  readonly results?: unknown;
  readonly result?: unknown;
  readonly query?: (filter: ObjectFilter) => ObjectSnapshot[];
  linked(instructionId: string, key?: string): Value | undefined;
  canLookBack(ref: ObjectRef): boolean;
  isIgnored(ref: ObjectRef): boolean;
  locations?: (id: string) => readonly LocationRef[];
}

export function evaluateExpression(expr: Expr, environment: ExpressionContext): Value {
  switch (expr.kind) {
    case "constant":
    case "literal": return asValue(expr.value);
    case "location": {
      const resolved = resolveLocationSelector(expr.value, {
        context: environment.context,
        host: environment.host,
        linked: (id, key) => environment.linked(id, key),
        locationBindings: environment.locations
      });
      return asValue(resolved);
    }
    case "linked":
    case "linked-value": {
      const value = environment.linked(expr.instructionId, expr.key);
      if (value === undefined) throw new MissingInformation(`Unavailable linked value: ${expr.instructionId}`);
      return asValue(value);
    }
    case "player-property":
    case "turn-number":
    case "player-turn-count":
    case "object-designation": return evaluateExtendedExpression(expr, environment);
    case "count":
      if (expr.subject === "controller-xp" || expr.subject === "self-in-combat") return evaluateExtendedExpression(expr, environment);
      return historyExpressionCount(expr, environment) ?? queryObjects(expr.filter ?? {}, environment).length;
    case "arithmetic": return arithmetic(expr.operator, expr.operands.map(operand => evaluateExpression(operand, environment)));
    case "object-property":
    case "object-attribute": {
      const property = expr.kind === "object-property" ? expr.property : expr.attribute;
      if (property === "designation") return evaluateExtendedExpression(expr, environment);
      const ref = resolveObjectSelector(expr.object, environment)[0];
      if (ref === undefined) throw new MissingInformation("Object selector has no object-valued selection");
      const snapshot = selectorSnapshot(ref, environment, expr.object === "source");
      if (!Object.hasOwn(snapshot, property)) throw new MissingInformation(`Unavailable characteristic: ${property}`);
      return asValue(snapshot[property as keyof typeof snapshot]);
    }
    default: throw new Error(`Unsupported expression: ${String((expr as { kind: unknown }).kind)}`);
  }
}
