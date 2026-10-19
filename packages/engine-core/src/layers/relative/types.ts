import type { ObjectSnapshot } from "../../effects/contract.js";

/** The object that owns a static ability. Relative filters are evaluated
 * against this snapshot at layer evaluation time, rather than when the
 * ability is registered. */
export type RelativeFilterAnchor = ObjectSnapshot;

export type RelativeSelector =
  | "self"
  | "source"
  | "controller"
  | "you"
  | "opponent"
  | "their"
  | "here"
  | { readonly kind?: string; readonly value?: unknown; readonly source?: unknown };

export interface RelativeFilterContext {
  readonly anchor?: RelativeFilterAnchor | null;
}
