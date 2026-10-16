import type { Expr, ObjectRef, ResolveContext, Value } from "../contract.js";
import { asValue, MissingInformation } from "./values.js";

export interface ExpressionContext {
  readonly context: ResolveContext;
  linked(instructionId: string, key?: string): Value | undefined;
  canLookBack(ref: ObjectRef): boolean;
  isIgnored(ref: ObjectRef): boolean;
}

export function evaluateExpression(expr: Expr, environment: ExpressionContext): Value {
  switch (expr.kind) {
    case "constant":
    case "literal": return asValue(expr.value);
    case "linked":
    case "linked-value": {
      const value = environment.linked(expr.instructionId, expr.key);
      if (value === undefined) throw new MissingInformation(`Unavailable linked value: ${expr.instructionId}`);
      return asValue(value);
    }
    case "count": return environment.context.query(expr.filter ?? {}).length;
    case "object-property":
    case "object-attribute": {
      if (environment.isIgnored(expr.object)) throw new MissingInformation(`Ignored object: ${expr.object.id}`);
      const context = environment.context;
      let snapshot = context.object(expr.object);
      if (snapshot === null && environment.canLookBack(expr.object)) snapshot = context.lastKnown(expr.object);
      if (snapshot === null && context.source.ref.id === expr.object.id
        && context.source.ref.zoneEntryId === expr.object.zoneEntryId) snapshot = context.source;
      if (snapshot === null) throw new MissingInformation(`Unavailable object: ${expr.object.id}`);
      const property = expr.kind === "object-property" ? expr.property : expr.attribute;
      if (!Object.hasOwn(snapshot, property)) throw new MissingInformation(`Unavailable characteristic: ${property}`);
      return asValue(snapshot[property as keyof typeof snapshot]);
    }
    default: throw new Error(`Unsupported expression: ${String((expr as { kind: unknown }).kind)}`);
  }
}
