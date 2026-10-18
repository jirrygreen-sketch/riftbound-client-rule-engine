import type { GameEvent, LocationRef, ObjectRef, ObjectSnapshot, ResolveContext } from "../effects/contract.js";
import { sameLocation } from "../target/location/ref.js";

/**
 * Recall is the relocation of a Permanent to its Base without being a Move
 * (CR v1.5 457). The engine vocabulary has no dedicated Recall game action
 * yet, so this helper drives the identity-preserving physical relocation
 * through the existing move-location action and marks the seam explicitly:
 *
 * - 458.1: a Recall must not trigger abilities keyed to Move actions. The
 *   reference kernel records move-location history and the action adapter
 *   emits object-moved for it, so until owners add a distinct Recall action
 *   the Move-trigger vocabulary remains judge-required for real cards. Callers
 *   must not read move-location history or object-moved timings as Move
 *   evidence for a recall performed here (see the EG-RECALL contract change
 *   request for the dedicated action and history distinction).
 * - 458.3: a Recall is not prevented by Move restrictions, so legality is not
 *   evaluated through the Location module's Move permissions (allowsMove /
 *   movement restrictions / 451.2 two-controller occupancy). Only the printed
 *   object shape and the Base-of-its-controller destination are enforced.
 * - 458.2 / 460: the relocation changes position while preserving object
 *   identity (the same zone entry) and its damage and statuses. move-location
 *   relocates the same zone entry, which is the engine's identity-preserving
 *   path; statuses are preserved because nothing resets them.
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
  const outcome = ctx.perform({ type: "move-location", object: refOf(ref), to: destination });
  const after = outcome.status === "done" ? ctx.object(refOf(ref)) : null;
  const moved = after !== null && after.zone === "board" && after.location !== null &&
    !sameLocation(from, after.location);
  return {
    status: outcome.status,
    events: [...outcome.events],
    count: moved ? 1 : 0,
    object: refOf(ref),
    from,
    to: moved ? after.location : null
  };
}
