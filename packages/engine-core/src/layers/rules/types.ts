/**
 * Rule-query types for rule-modifying continuous effects (contract 3.4).
 *
 * Permission and restriction are separate shapes; requirements are modeled
 * apart from restrictions. The registry stores raw effects; these types give
 * rule wiring (chain, turn, combat) a stable vocabulary.
 */
import type { ObjectRef } from "@riftbound/card-dsl";
import type { ContinuousEffectRegistry } from "../duration.js";
import type { ObjectSnapshot, PlayerId } from "../../effects/contract.js";

export type GameActionName = string;

export interface RuleRestriction {
  readonly kind: "restriction";
  readonly actions: readonly GameActionName[];
  readonly name?: string;
  readonly cap?: boolean;
  readonly amount?: number;
  readonly cost?: unknown;
}

export interface RuleRequirement {
  readonly kind: "requirement";
  readonly actions: readonly GameActionName[];
  readonly name?: string;
}

export interface RulePermission {
  readonly kind: "permission";
  readonly routes: readonly string[];
  readonly move?: string;
  readonly endpoints?: {
    readonly source?: string;
    readonly destination?: string;
  };
}

export interface RuleAppliedCost {
  readonly kind: "applied-cost";
  readonly actions: readonly GameActionName[];
  readonly cost: unknown;
}

export interface RulePermissionQuery extends RulePermission {
  readonly source: ObjectRef;
  readonly filter: Readonly<Record<string, unknown>>;
}

export interface RuleRestrictionQuery extends RuleRestriction {
  readonly source: ObjectRef;
  readonly filter: Readonly<Record<string, unknown>>;
}

export interface RuleRequirementQuery extends RuleRequirement {
  readonly source: ObjectRef;
  readonly filter: Readonly<Record<string, unknown>>;
}

export interface RuleAppliedCostQuery extends RuleAppliedCost {
  readonly source: ObjectRef;
  readonly filter: Readonly<Record<string, unknown>>;
}

export interface RuleLocationPermission {
  readonly kind: "location";
  readonly name: string;
  readonly source: ObjectRef;
  readonly filter: Readonly<Record<string, unknown>>;
}

export interface RuleLocationRestriction {
  readonly kind: "location";
  readonly name: string;
  readonly source: ObjectRef;
  readonly filter: Readonly<Record<string, unknown>>;
}

export type DeckLimit =
  | { readonly mode: "unlimited" }
  | { readonly mode: "max"; readonly amount: number };

/** Input for the standalone canAct truth table (CR v1.5 308-313). */
export interface CanActInput {
  readonly player: PlayerId;
  readonly speed: "normal" | "action" | "reaction";
  readonly showdown: boolean;
  readonly closedState: boolean;
  readonly turnPlayer: PlayerId | null;
  readonly priorityHolder: PlayerId | null;
  readonly focusHolder?: PlayerId | null;
  readonly chainDepth?: number;
  /** Optional ability-layer registry used to consume Action/Reaction grants. */
  readonly registry?: ContinuousEffectRegistry;
  /** Object whose continuous timing grants are being queried. */
  readonly ref?: ObjectRef;
  /** Snapshot used to evaluate controller/type/zone and other filter fields. */
  readonly object?: ObjectSnapshot | null;
  /** Direct grant inputs for callers that have already evaluated the layer. */
  readonly grants?: readonly string[];
  readonly timings?: readonly string[];
}
