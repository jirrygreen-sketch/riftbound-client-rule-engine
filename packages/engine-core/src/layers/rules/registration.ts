import type { ObjectFilter, ObjectRef } from "@riftbound/card-dsl";
import type { ContinuousEffectSpec, Expr, ResolveContext, Value } from "../../effects/contract.js";

export interface TargetBinding {
  readonly refs: readonly ObjectRef[];
  readonly filter: Readonly<Record<string, Value>>;
}

export function bindTarget(ctx: ResolveContext, target: Expr | undefined): TargetBinding | null {
  if (target === undefined) return { refs: [], filter: {} };
  const id = ctx.evaluate(target);
  const selected = ctx.targets(typeof id === "string" ? id : String(id));
  const live = selected.filter(ref => ctx.object(ref) !== null);
  if (live.length === 0) return null;
  if (live.length === 1) {
    const ref = live[0]!;
    return {
      refs: live,
      filter: { objectId: ref.id, zoneEntryId: ref.zoneEntryId, objectRefs: live as unknown as Value },
    };
  }
  return {
    refs: live,
    filter: { objectId: live.map(ref => ref.id), objectRefs: live as unknown as Value },
  };
}

export function mergeFilter(
  appliesTo: ObjectFilter | undefined,
  target: TargetBinding,
): Readonly<Record<string, Value>> {
  return { ...(appliesTo ?? {}), ...target.filter };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return "{" + Object.keys(value as Record<string, unknown>).sort().map(key =>
      JSON.stringify(key) + ":" + stable((value as Record<string, unknown>)[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function digest(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Deterministic identity for one ability/execution instance. Callers that
 * execute the same shape more than once should provide instanceId; otherwise
 * the effect shape remains a stable fallback.
 */
export function continuousId(
  op: string,
  ctx: ResolveContext,
  instance: Value | undefined,
  discriminator: unknown,
): string {
  const explicit = typeof instance === "string" && instance.trim().length > 0 ? instance : undefined;
  const linked = ctx.linked("continuous-instance");
  const linkedId = typeof linked === "string" && linked.trim().length > 0 ? linked : undefined;
  const previous = ctx.linked("registered");
  const previousId = previous !== null && typeof previous === "object" && !Array.isArray(previous) &&
    typeof (previous as Record<string, unknown>).id === "string" ? (previous as Record<string, unknown>).id : undefined;
  const suffix = explicit ?? linkedId ?? digest(stable({ source: ctx.source.ref, discriminator, previousId }));
  return op + ":" + ctx.source.ref.id + ":" + ctx.source.ref.zoneEntryId + ":" + suffix;
}

export function isSelector(value: unknown): boolean {
  if (value === "self" || value === "source") return true;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length !== 1 || !["target", "pick", "linked"].includes(keys[0]!)) return false;
  return typeof (value as Record<string, unknown>)[keys[0]!] === "string" &&
    ((value as Record<string, unknown>)[keys[0]!] as string).trim().length > 0;
}

export function isExpression(value: unknown, active = new Set<object>()): value is Expr {
  if (value === null || typeof value !== "object" || Array.isArray(value) || active.has(value)) return false;
  const item = value as Record<string, unknown>;
  active.add(item);
  let valid = false;
  switch (item.kind) {
    case "constant":
    case "literal":
      valid = Object.hasOwn(item, "value");
      break;
    case "object-property":
      valid = isSelector(item.object) && typeof item.property === "string" && item.property.trim().length > 0;
      break;
    case "object-attribute":
      valid = isSelector(item.object) && typeof item.attribute === "string" && item.attribute.trim().length > 0;
      break;
    case "linked":
    case "linked-value":
      valid = typeof item.instructionId === "string" && item.instructionId.trim().length > 0;
      break;
    case "count":
      valid = typeof item.subject === "string" && item.subject.trim().length > 0;
      break;
    case "arithmetic":
      valid = Array.isArray(item.operands) && item.operands.length > 0 &&
        item.operands.every(operand => isExpression(operand, active));
      break;
    default:
      valid = false;
  }
  active.delete(item);
  return valid;
}

