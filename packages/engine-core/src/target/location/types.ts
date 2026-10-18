import type { LocationFilter, LocationRef, LocationTargetSpec } from "@riftbound/card-dsl";
import type { ObjectRef, ObjectSnapshot, PlayerId, ResolveContext } from "../../effects/contract.js";
import type { ContinuousEffectRegistry } from "../../layers/duration.js";

export type { LocationFilter, LocationRef, LocationTargetSpec };

/** Runtime state used to decide whether a board location is a legal choice. */
export interface LocationState {
  readonly ref: LocationRef;
  readonly owner?: PlayerId;
  readonly controller?: PlayerId | null;
  readonly occupied?: boolean;
  readonly contested?: boolean;
  readonly units?: readonly ObjectRef[];
}

export interface LocationCandidateOptions {
  readonly locations?: readonly LocationState[];
  readonly players?: readonly PlayerId[];
  readonly opponent?: PlayerId;
  readonly exclude?: readonly LocationRef[];
  /** A Move destination must differ from the selected object's current location. */
  readonly current?: LocationRef | null;
  /** Current zone-bound objects whose common legal Move destinations are queried. */
  readonly moving?: readonly ObjectRef[];
  /** Ability-layer rule queries supplied by the host that owns the registry. */
  readonly registry?: ContinuousEffectRegistry;
}

export interface LocationEnvironment extends LocationCandidateOptions {
  readonly context: ResolveContext;
  readonly host?: ObjectRef;
  readonly linked?: (instructionId: string, key?: string) => unknown;
  readonly locationBindings?: (id: string) => readonly LocationRef[];
}

export interface LocationObjectProvider {
  readonly snapshot: ObjectSnapshot;
  readonly state?: LocationState;
}
