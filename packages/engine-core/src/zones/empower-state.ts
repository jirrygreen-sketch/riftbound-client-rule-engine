import type { ObjectSnapshot } from "../effects/contract.js";

/**
 * Empowered is carried by the live object snapshot as a count.  The public
 * contract is still consumed by older adapters that do not declare the field,
 * so this module keeps the runtime carrier narrow and validates it at the
 * boundary instead of treating `buffs` as an Empowered surrogate.
 */
export type EmpoweredSnapshot = ObjectSnapshot & {
  readonly empowered?: unknown;
  /** Compatibility spelling used by older card-program fixtures. */
  readonly empoweredCount?: unknown;
};

export type EmpowermentReason =
  | "zero-amount"
  | "already-empowered"
  | "limit-reached"
  | "not-empowered";

export interface EmpowermentTransition {
  readonly previousCount: number;
  readonly currentCount: number;
  readonly appliedAmount: number;
  readonly changed: boolean;
  readonly reason?: EmpowermentReason;
}

export interface EmpowermentPermission {
  readonly amount?: number;
  readonly multiple?: boolean;
  readonly limit?: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeCount(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer`);
  }
  return value;
}

/**
 * Read the authoritative Empowered count from a live snapshot.
 *
 * A missing field is an integration error.  Returning zero here would turn a
 * legacy snapshot into an unauthorised Empower action and would also make a
 * dependent [Empowered] ability appear active or inactive by accident.
 */
export function readEmpowered(snapshot: unknown): number {
  const object = record(snapshot);
  if (object === null) throw new TypeError("Empowered state requires an object snapshot");
  if (Object.hasOwn(object, "empowered")) return safeCount(object.empowered, "empowered");
  if (Object.hasOwn(object, "empoweredCount")) return safeCount(object.empoweredCount, "empoweredCount");
  throw new TypeError("Empowered state is unavailable on the object snapshot");
}

/** Optional read for adapters that need to distinguish an absent field from zero. */
export function tryReadEmpowered(snapshot: unknown): number | null {
  try {
    return readEmpowered(snapshot);
  } catch {
    return null;
  }
}

export function isEmpowered(snapshot: unknown): boolean {
  return readEmpowered(snapshot) > 0;
}

export function empowerTransition(
  currentOrSnapshot: number | unknown,
  permission: EmpowermentPermission = {}
): EmpowermentTransition {
  const current = typeof currentOrSnapshot === "number"
    ? safeCount(currentOrSnapshot, "empowered count")
    : readEmpowered(currentOrSnapshot);
  const amount = permission.amount === undefined ? 1 : safeCount(permission.amount, "Empower amount");
  const multiple = permission.multiple ?? false;
  if (typeof multiple !== "boolean") throw new TypeError("Empower multiple permission must be boolean");
  const limit = permission.limit === undefined ? undefined : safeCount(permission.limit, "Empower limit");
  if (!multiple && limit !== undefined) {
    throw new TypeError("Empower limit requires a multiple-Empower permission");
  }
  if (!multiple && amount > 1) {
    throw new TypeError("A binary Empower permission can add only one status");
  }
  if (amount === 0) {
    return { previousCount: current, currentCount: current, appliedAmount: 0, changed: false, reason: "zero-amount" };
  }
  if (!multiple && current > 0) {
    return { previousCount: current, currentCount: current, appliedAmount: 0, changed: false, reason: "already-empowered" };
  }
  if (multiple && limit !== undefined && current >= limit) {
    return { previousCount: current, currentCount: current, appliedAmount: 0, changed: false, reason: "limit-reached" };
  }
  const available = limit === undefined ? amount : Math.min(amount, limit - current);
  if (available <= 0) {
    return { previousCount: current, currentCount: current, appliedAmount: 0, changed: false, reason: "limit-reached" };
  }
  return {
    previousCount: current,
    currentCount: current + available,
    appliedAmount: available,
    changed: true
  };
}

/** CR 443.1.a–b: no effect at zero; otherwise remove exactly one status. */
export function disempowerTransition(currentOrSnapshot: number | unknown): EmpowermentTransition {
  const current = typeof currentOrSnapshot === "number"
    ? safeCount(currentOrSnapshot, "empowered count")
    : readEmpowered(currentOrSnapshot);
  if (current === 0) {
    return { previousCount: 0, currentCount: 0, appliedAmount: 0, changed: false, reason: "not-empowered" };
  }
  return { previousCount: current, currentCount: current - 1, appliedAmount: 1, changed: true };
}

/** Stable state carrier used by snapshots and event payload adapters. */
export function empoweredState(countOrSnapshot: number | unknown): { readonly empowered: number; readonly empoweredCount: number } {
  const count = typeof countOrSnapshot === "number"
    ? safeCount(countOrSnapshot, "empowered count")
    : readEmpowered(countOrSnapshot);
  return { empowered: count, empoweredCount: count };
}
