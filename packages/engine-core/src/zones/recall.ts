import type {
  ActionOutcome, GameEvent, LocationRef, ObjectRef, ObjectSnapshot,
  RecallAction, ResolveContext
} from "../effects/contract.js";
import { sameLocation } from "../target/location/ref.js";

/**
 * Recall is the relocation of a Permanent to its Base without being a Move
 * (CR v1.5 457). The additive contract now has RecallAction, but the default
 * production adapters have not yet installed its capability. This helper
 * submits the independent action when the host exposes that capability and
 * otherwise fails closed with a blocked receipt:
 *
 * - 458.1: a Recall must not trigger abilities keyed to Move actions. The
 *   reference kernel records move-location history and the action adapter
 *   emits object-moved for it, so until owners add a distinct Recall action
 *   a Recall never becomes move-location and therefore cannot emit
 *   object-moved or create Move history. Until the 849/810/835/837 consumers
 *   install RecallAction, callers receive negated/impossible rather than an
 *   approximation through Move.
 * - 458.3: a Recall is not prevented by Move restrictions, so legality is not
 *   evaluated through the Location module's Move permissions (allowsMove /
 *   movement restrictions / 451.2 two-controller occupancy). Only the printed
 *   object shape and the Base-of-its-controller destination are enforced.
 * - 458.2 / 460: the relocation changes position while preserving object
 *   identity (the same zone entry) and its damage and statuses. Those
 *   obligations belong to the RecallAction consumer and are not simulated by
 *   this primitive when that consumer is unavailable.
 * - 459: Gear is a Permanent and can be recalled exactly like a Unit.
 * - The Cleanup recall-action obligation (CR 323.6) stays with turn flow.
 *
 * This helper is a rules seam for primitives, never a player-facing action:
 * it validates the Recall shape, submits the relocation, and reports what
 * happened. Unknown official semantics remain judge-required; nothing here
 * invents Move-trigger or restriction behavior for Recalled objects.
 */

/** A Recall relocates a Permanent (Unit or Gear) that is on the Board (457). */
export function isRecallableObject(object: ObjectSnapshot | null): boolean {
  return object !== null && object.zone === "board" && object.location !== null &&
    object.types.some(type => type === "unit" || type === "gear");
}

/** A Recall destination is always the Base of the object's current controller. */
export function recallDestination(object: ObjectSnapshot): LocationRef {
  return { type: "base", player: object.controller };
}

export interface RecallOutcome {
  readonly status: "done" | "replaced" | "prevented" | "impossible";
  readonly events: readonly GameEvent[];
  readonly count: number;
  readonly object: ObjectRef;
  readonly from: LocationRef | null;
  readonly to: LocationRef | null;
  readonly blockedReason?: string;
  readonly receipt?: ActionOutcome["receipt"];
}

export interface RecallOptions {
  /** Relocate only when the object currently sits at this exact location. */
  readonly from?: LocationRef;
}

function refOf(ref: ObjectRef): ObjectRef {
  return { id: ref.id, zoneEntryId: ref.zoneEntryId };
}

/**
 * Perform one Recall (CR v1.5 457-460): relocate a Board Permanent to its
 * current controller's Base without Move restrictions and without claiming a
 * Move. The object and its zone entry are validated first; an object already
 * at its controller's Base has no recall outcome at all (no action, no event).
 */
export function performRecall(ctx: ResolveContext, ref: ObjectRef, options: RecallOptions = {}): RecallOutcome {
  const before = ctx.object(ref);
  if (!isRecallableObject(before)) {
    return { status: "impossible", events: [], count: 0, object: refOf(ref), from: null, to: null };
  }
  const from = before!.location;
  if (options.from !== undefined && !sameLocation(from, options.from)) {
    return { status: "impossible", events: [], count: 0, object: refOf(ref), from, to: null };
  }
  const destination = recallDestination(before!);
  if (sameLocation(from, destination)) {
    return { status: "done", events: [], count: 0, object: refOf(ref), from, to: from };
  }
  const recall: RecallAction = { type: "recall", object: refOf(ref), player: before!.controller };
  // ResolveContext still freezes perform() to GameAction. The additive
  // ContractGameAction capability is probed without lying to that type: a
  // future consumer must accept the independent recall action at runtime.
  // The versioned contract capability is additive. Use it when the host has
  // installed the owner task's bridge; do not probe the legacy perform()
  // method with an action outside its closed GameAction type.
  const capability = (ctx as ResolveContext & {
    readonly contractActions?: { readonly perform: (action: RecallAction) => ActionOutcome };
  }).contractActions;
  if (capability === undefined) {
    return {
      status: "impossible", events: [], count: 0, object: refOf(ref), from, to: null,
      blockedReason: "RecallAction consumer unavailable (RIFT-849/810/835/837)"
    };
  }
  let outcome: ActionOutcome;
  try {
    outcome = capability.perform(recall);
  } catch (error) {
    if (error instanceof TypeError || error instanceof Error && /Unknown action type: recall/.test(error.message)) {
      return {
        status: "impossible", events: [], count: 0, object: refOf(ref), from, to: null,
        blockedReason: "RecallAction consumer unavailable (RIFT-849/810/835/837)"
      };
    }
    throw error;
  }
  const after = outcome.status === "done" ? ctx.object(refOf(ref)) : null;
  const moved = after !== null && after.zone === "board" && after.location !== null &&
    !sameLocation(from, after.location);
  return {
    status: outcome.status,
    events: [...outcome.events],
    count: moved ? 1 : 0,
    object: refOf(ref),
    from,
    to: moved ? after.location : null,
    ...(outcome.receipt === undefined ? {} : { receipt: outcome.receipt })
  };
}
