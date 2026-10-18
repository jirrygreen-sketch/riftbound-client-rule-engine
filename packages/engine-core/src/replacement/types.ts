import type {
  Condition,
  Instruction,
  ObjectRef,
  ObjectSnapshot,
  PlayerId,
  ResolveContext,
  Value
} from "../effects/contract.js";
import type { ReplacementRegistration } from "../events/pipeline-types.js";

/**
 * A card program's replacement ability (contract 3.1
 * { kind: "replacement", replaces, with, condition? }) bound to a host
 * object. The pattern stays the card's own EventPattern vocabulary; this
 * layer turns it into an action matcher on the event pipeline.
 */
export interface ReplacementAbilityInput {
  readonly replaces: Readonly<Record<string, unknown>>;
  readonly with: readonly Instruction[];
  readonly condition?: Condition;
  /** Runtime declaration fields may be added by card adapters without changing the frozen IR. */
  readonly optional?: boolean;
  readonly oncePerTurn?: boolean;
}

/**
 * The host supplies authoritative snapshots and a full ResolveContext for
 * expression and condition evaluation (TestWorld satisfies this directly).
 */
export interface ReplacementHostAdapter {
  object(ref: ObjectRef): ObjectSnapshot | null;
  objects(): readonly ObjectSnapshot[];
  context(source: ObjectSnapshot, controller: PlayerId): ResolveContext;
}

/** The event pipeline is the only execution surface for bound replacements. */
export interface ReplacementPipelineAdapter {
  readonly clock: { readonly turn: number };
  registerReplacement(registration: ReplacementRegistration): void;
  /** Optional: RIFT-120 pipelines without removal keep cancelled flags local. */
  unregisterReplacement?(id: string): void;
  /** Optional pipeline checkpoint used to roll back a replacement body. */
  checkpoint?(): unknown;
  restore?(checkpoint: unknown): void;
}

export interface ReplacementDependencies {
  readonly host: ReplacementHostAdapter;
  readonly pipeline: ReplacementPipelineAdapter;
}

export interface BoundReplacement {
  readonly registration: ReplacementRegistration;
  cancel(): void;
}

/** The planner input for one application of a replacement. */
export interface ReplacementPlanInput {
  /** The ability host (the registered object). */
  readonly hostRef: ObjectRef;
  /** The replaced event object binding for { linked: replacement.object }. */
  readonly replacedObject: ObjectRef | null;
  /** True when the ability is a one-shot window replacement. */
  readonly usedWindow: boolean;
}

/**
 * Local failure for replacement abilities that need capabilities this layer
 * deliberately does not approximate (blocked opcodes, unknown windows).
 * Callers surface it as judge-required evidence instead of executing a guess.
 */
export class BlockedReplacementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedReplacementError";
  }
}

/** The replaced event's object binding, addressable as a linked selector. */
export const REPLACED_EVENT_LINK = "replacement.object";

/**
 * CR 370.3/370.4: a replacement is evaluated from the zone its effect is
 * active in, including events simultaneous with leaving that zone. Card data
 * does not restrict zones, so bindings stay active wherever the host is.
 */
export const REPLACEMENT_ACTIVE_ZONES = [
  "hand",
  "deck",
  "rune-deck",
  "trash",
  "banishment",
  "board",
  "rune-zone",
  "chain"
] as const;
