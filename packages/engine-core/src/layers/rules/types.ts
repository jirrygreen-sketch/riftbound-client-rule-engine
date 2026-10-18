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

/**
 * The action families that can be constrained by a rule-modifying effect.
 *
 * `GameActionName` remains open ended for backwards compatibility with the
 * card data.  These aliases are used by the rule consumers when a caller
 * needs to say whether a permission applies to playing a card or activating
 * an ability.
 */
export type RuleActionKind =
  | "play"
  | "activate"
  | "target"
  | "cost"
  | "resource"
  | "ability-count"
  | "move"
  | "combat"
  | (string & {});

export type RuleUseScope =
  | "turn"
  | "combat"
  | "round"
  | "game"
  | "source"
  | "player"
  | (string & {});

/** A source-relative query scope shared by all rule consumers. */
export interface RuleQueryScope {
  /** The player from whose perspective `self`/`opponent` are resolved. */
  readonly player?: PlayerId;
  /** Explicit source controller when the source snapshot is unavailable. */
  readonly sourcePlayer?: PlayerId;
  /** The ability/card source. A snapshot supplies its current controller. */
  readonly source?: ObjectRef | ObjectSnapshot | null;
  /** The object whose legality is being queried. */
  readonly affected?: ObjectRef | ObjectSnapshot | null;
  /** Alias accepted by callers that already use the filter vocabulary. */
  readonly object?: ObjectSnapshot | null;
  /** The actor reference for action restrictions. */
  readonly actor?: ObjectRef;
  /** `play` and `activate` are intentionally distinct action families. */
  readonly actionKind?: "play" | "activate";
  /** Optional operation name such as `play-spell` or `choose-as-target`. */
  readonly action?: GameActionName;
}

export interface RuleRestriction {
  readonly kind: "restriction";
  readonly actions: readonly GameActionName[];
  readonly name?: string;
  readonly cap?: boolean;
  readonly amount?: number;
  readonly cost?: unknown;
  readonly actionKind?: RuleActionKind;
  readonly scope?: RuleUseScope;
  readonly sourcePlayer?: PlayerId;
  readonly by?: unknown;
  readonly unless?: unknown;
}

export interface RuleRequirement {
  readonly kind: "requirement";
  readonly actions: readonly GameActionName[];
  readonly name?: string;
  readonly actionKind?: RuleActionKind;
  readonly sourcePlayer?: PlayerId;
}

export interface RulePermission {
  readonly kind: "permission";
  readonly routes: readonly string[];
  readonly move?: string;
  readonly endpoints?: {
    readonly source?: string;
    readonly destination?: string;
  };
  readonly actions?: readonly GameActionName[];
  readonly actionKind?: RuleActionKind;
  readonly sourcePlayer?: PlayerId;
}

export interface RuleAppliedCost {
  readonly kind: "applied-cost";
  readonly actions: readonly GameActionName[];
  readonly cost: unknown;
  readonly actionKind?: RuleActionKind;
  readonly sourcePlayer?: PlayerId;
}

export interface RulePermissionQuery extends RulePermission {
  readonly source: ObjectRef;
  readonly filter: Readonly<Record<string, unknown>>;
  readonly affected?: ObjectRef;
}

export interface RuleRestrictionQuery extends RuleRestriction {
  readonly source: ObjectRef;
  readonly filter: Readonly<Record<string, unknown>>;
  readonly affected?: ObjectRef;
}

export interface RuleRequirementQuery extends RuleRequirement {
  readonly source: ObjectRef;
  readonly filter: Readonly<Record<string, unknown>>;
  readonly affected?: ObjectRef;
}

export interface RuleAppliedCostQuery extends RuleAppliedCost {
  readonly source: ObjectRef;
  readonly filter: Readonly<Record<string, unknown>>;
  readonly affected?: ObjectRef;
}

export interface RuleLocationPermission {
  readonly kind: "location";
  readonly name: string;
  readonly source: ObjectRef;
  readonly filter: Readonly<Record<string, unknown>>;
  readonly actionKind?: RuleActionKind;
  readonly sourcePlayer?: PlayerId;
}

export interface RuleLocationRestriction {
  readonly kind: "location";
  readonly name: string;
  readonly source: ObjectRef;
  readonly filter: Readonly<Record<string, unknown>>;
  readonly actionKind?: RuleActionKind;
  readonly sourcePlayer?: PlayerId;
}

export interface RuleLocationView {
  readonly permissions: readonly RuleLocationPermission[];
  readonly restrictions: readonly RuleLocationRestriction[];
}

/** A normalized combat declaration consumed by combat/assignment code. */
export interface RuleCombatQuery {
  readonly kind: "combat";
  readonly flags: readonly string[];
  readonly source: ObjectRef;
  readonly filter: Readonly<Record<string, unknown>>;
  readonly affected?: ObjectRef;
  readonly sourcePlayer?: PlayerId;
}

/** A normalized per-source usage limit. */
export interface RuleUsageQuery {
  readonly kind: "ability-count";
  readonly limit: number;
  readonly scope: RuleUseScope;
  readonly activator: "controller" | "any-player" | PlayerId;
  readonly source: ObjectRef;
  readonly filter: Readonly<Record<string, unknown>>;
  readonly affected?: ObjectRef;
  readonly sourcePlayer?: PlayerId;
}

/** A normalized resource restriction/permission. */
export interface RuleResourceQuery {
  readonly kind: "resource";
  readonly resource: string;
  readonly actions: readonly GameActionName[];
  readonly source: ObjectRef;
  readonly filter: Readonly<Record<string, unknown>>;
  readonly allowed?: boolean;
  readonly amount?: number;
  readonly scope?: RuleUseScope;
  readonly sourcePlayer?: PlayerId;
}

export interface RuleActionQuery {
  readonly action: GameActionName;
  readonly actionKind?: "play" | "activate";
  readonly allowed: boolean;
  readonly restrictions: readonly RuleRestrictionQuery[];
  readonly requirements: readonly RuleRequirementQuery[];
  readonly permissions: readonly RulePermissionQuery[];
  readonly appliedCosts: readonly RuleAppliedCostQuery[];
  readonly locations: RuleLocationView;
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
