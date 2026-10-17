import type { Expr, ObjectFilter, ObjectRef, ObjectSnapshot, ResolveContext, Value } from "../contract.js";
import { queryObjects, resolveObjectSelector, selectorSnapshot } from "./selectors.js";
import { arithmetic, asValue, MissingInformation } from "./values.js";
import { resolveLocationSelector } from "./locations.js";
import type { LocationRef } from "../contract.js";

export interface ExpressionContext {
  readonly context: ResolveContext;
  readonly host?: ObjectRef;
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
    case "count": return queryObjects(expr.filter ?? {}, environment).length;
    case "arithmetic": return arithmetic(expr.operator, expr.operands.map(operand => evaluateExpression(operand, environment)));
    case "object-property":
    case "object-attribute": {
      const ref = resolveObjectSelector(expr.object, environment)[0];
      if (ref === undefined) throw new MissingInformation("Object selector has no object-valued selection");
      const snapshot = selectorSnapshot(ref, environment, expr.object === "source");
      const property = expr.kind === "object-property" ? expr.property : expr.attribute;
      if (!Object.hasOwn(snapshot, property)) throw new MissingInformation(`Unavailable characteristic: ${property}`);
      return asValue(snapshot[property as keyof typeof snapshot]);
    }
    default: throw new Error(`Unsupported expression: ${String((expr as { kind: unknown }).kind)}`);
  }
}
