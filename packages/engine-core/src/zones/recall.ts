import {
  CONTRACT_ACTION_CAPABILITY_VERSION,
  type ActionOutcome,
  type GameEvent,
  type LocationRef,
  type ObjectRef,
  type ObjectSnapshot,
  type RecallAction,
  type ResolveContext,
} from "../effects/contract.js";
import { sameLocation } from "../target/location/ref.js";

/**
 * Recall is the relocation of a Permanent to its Base without being a Move
 * (CR v1.5 457). The additive contract now has RecallAction. This helper
 * submits the independent action when the host exposes the versioned
 * capability and otherwise fails closed with a blocked receipt:
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
 * - 458.2 / 460: a successful result must keep the exact zone-entry identity,
 *   all non-location characteristics, the original controller, and the Base
 *   of that controller. It must also carry one committed recall receipt and
 *   an independent recall observation. A bare `done` result is rejected.
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

function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

/**
 * CR 457-460 preserves the underlying Permanent. Layer output such as Might,
 * keywords, movement permissions and `printed` is recomputed after Recall and
 * may legitimately differ when the object leaves a location-bound aura.
 * Keep every stored game-state field, including all statuses and resources,
 * but compare those persistent fields separately from derived characteristics.
 */
function persistentState(object: ObjectSnapshot): Readonly<Record<string, unknown>> {
  return {
    ref: object.ref,
    owner: object.owner,
    controller: object.controller,
    zone: object.zone,
    combatRole: object.combatRole,
    exhausted: object.exhausted,
    damage: object.damage,
    stunned: object.stunned,
    buffs: object.buffs,
    empowered: object.empowered,
    empoweredCount: object.empoweredCount,
    attachedTo: object.attachedTo,
    faceDown: object.faceDown,
    facedownLocation: object.facedownLocation,
    isToken: object.isToken,
  };
}

function samePersistentState(before: ObjectSnapshot, after: ObjectSnapshot): boolean {
  return JSON.stringify(persistentState(before)) === JSON.stringify(persistentState(after));
}

function committedRecall(
  action: RecallAction,
  before: ObjectSnapshot,
  after: ObjectSnapshot | null,
  outcome: ActionOutcome,
): boolean {
  const receipt = outcome.receipt;
  if (outcome.status !== "done" || receipt?.status !== "committed" ||
      receipt.actions.length !== 1 || receipt.actions[0]?.type !== "recall" ||
      receipt.actions[0]?.status !== "done" || after === null ||
      !sameRef(after.ref, action.object) || after.zone !== "board" ||
      after.controller !== action.player || after.location === null ||
      !sameLocation(after.location, recallDestination(after)) ||
      !samePersistentState(before, after)) {
    return false;
  }
  return outcome.events.some(event => {
    const observed = event as GameEvent & {
      readonly action?: unknown;
      readonly details?: { readonly recall?: unknown; readonly from?: unknown; readonly to?: unknown };
    };
    return observed.action === "recall" && observed.details?.recall === true &&
      sameLocation(observed.details.from as LocationRef | null | undefined, before.location) &&
      sameLocation(observed.details.to as LocationRef | null | undefined, after.location);
  });
}

class InvalidRecallCommit extends Error {
  constructor() {
    super("RecallAction consumer returned an invalid committed result");
    this.name = "InvalidRecallCommit";
  }
}

class RecallAtomicityError extends Error {
  constructor() {
    super("RecallAction consumer changed persistent state without committing a valid Recall");
    this.name = "RecallAtomicityError";
  }
}

function stateUnchanged(ctx: ResolveContext, before: ObjectSnapshot, ref: ObjectRef): boolean {
  const after = ctx.object(ref);
  return after !== null && sameRef(after.ref, before.ref) &&
    sameLocation(after.location, before.location) && samePersistentState(before, after);
}

function blockedAtomicRecall(ref: ObjectRef, from: LocationRef | null): RecallOutcome {
  return {
    status: "impossible", events: [], count: 0, object: refOf(ref), from, to: null,
    blockedReason: "RecallAction consumer changed persistent state without committing a valid Recall",
  };
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
  const capability = ctx.contractActions;
  if (capability === undefined || capability.version !== CONTRACT_ACTION_CAPABILITY_VERSION) {
    return {
      status: "impossible", events: [], count: 0, object: refOf(ref), from, to: null,
      blockedReason: "RecallAction consumer unavailable (RIFT-849/810/835/837)"
    };
  }
  let outcome: ActionOutcome;
  try {
    const execute = () => {
      const candidate = capability.perform(recall);
      const after = ctx.object(refOf(ref));
      if (candidate.status === "done") {
        if (!committedRecall(recall, before!, after, candidate)) {
          if (after !== null && !stateUnchanged(ctx, before!, refOf(ref))) throw new RecallAtomicityError();
          throw new InvalidRecallCommit();
        }
      } else if (!stateUnchanged(ctx, before!, refOf(ref))) {
        throw new RecallAtomicityError();
      }
      return candidate;
    };
    outcome = ctx.transaction === undefined ? execute() : ctx.transaction(execute);
  } catch (error) {
    if (error instanceof InvalidRecallCommit) {
      if (!stateUnchanged(ctx, before!, refOf(ref))) throw new RecallAtomicityError();
      return {
        status: "impossible", events: [], count: 0, object: refOf(ref), from, to: null,
        blockedReason: "RecallAction consumer did not commit a preserved Recall with an independent observation",
      };
    }
    if (error instanceof RecallAtomicityError) {
      if (ctx.transaction !== undefined && stateUnchanged(ctx, before!, refOf(ref))) {
        return blockedAtomicRecall(ref, from);
      }
      throw error;
    }
    if (error instanceof TypeError || error instanceof Error && /Unknown action type: recall/.test(error.message)) {
      return {
        status: "impossible", events: [], count: 0, object: refOf(ref), from, to: null,
        blockedReason: "RecallAction consumer unavailable (RIFT-849/810/835/837)"
      };
    }
    throw error;
  }
  const after = outcome.status === "done" ? ctx.object(refOf(ref)) : null;
  const moved = committedRecall(recall, before!, after, outcome);
  return {
    status: outcome.status,
    events: [...outcome.events],
    count: moved ? 1 : 0,
    object: refOf(ref),
    from,
    to: moved && after !== null ? after.location : null,
    ...(outcome.receipt === undefined ? {} : { receipt: outcome.receipt })
  };
}
