/**
 * Atomic location swap between two Board Permanents (CR v1.5 448-452).
 *
 * args:
 * - objects: exactly two distinct ObjectSelectors (source/self, target, pick,
 *   or linked), each naming a current Board Permanent at a location. The
 *   selector list itself is the printed pair; there is no amount or extra
 *   non-target set, so the swap never selects beyond its bound objects.
 *
 * The printed text binds both objects and their destinations to each other:
 * each object moves to the other's current location. Legality is read through
 * the shared Location module before any action is committed (451.2: neither
 * destination may already hold Units from two other players; both objects
 * vacate their origins simultaneously, so neither origin blocks the other).
 * The swap is one instantaneous action with no intermediate state (448.1,
 * 448.3.a-b); the kernel only exposes single-object move-location, so the
 * primitive commits the two relocations back to back and fails closed: if the
 * second relocation is replaced or prevented, the error rejects the whole
 * instruction and the outer transaction rolls back the first relocation
 * instead of leaving one object stranded (448.3). Same-location pairs are
 * already where the instruction would put them: they execute without events,
 * like a same-location effect.move.
 *
 * Exchanging locations is a Move for both objects (448.1: it is not a
 * corrective Recall), so move-location history and object-moved timings are
 * the kernel's existing Move seam; no Recall semantics are claimed here.
 */
import type {
  Expr, GameEvent, InstructionDef, InstructionResult, LocationRef, ObjectRef,
  ObjectSelector, ResolveContext, Value
} from "../contract.js";
import { sameLocation } from "../../target/location/ref.js";

export interface SwapArgs {
  readonly objects: Expr;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function isRef(value: unknown): value is ObjectRef {
  return isRecord(value) && isId(value.id) && typeof value.zoneEntryId === "number" &&
    Number.isSafeInteger(value.zoneEntryId);
}
function isValue(value: unknown, active = new Set<object>()): value is Value {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || active.has(value)) return false;
  active.add(value);
  const valid = Object.values(value).every(item => isValue(item, active));
  active.delete(value);
  return valid;
}
function isSelector(value: unknown): value is ObjectSelector {
  return value === "source" || value === "self" || isRecord(value) &&
    Object.keys(value).length === 1 && ["target", "pick", "linked"].some(key => isId(value[key]));
}
function isExpr(value: unknown, active = new Set<object>()): value is Expr {
  if (!isRecord(value) || active.has(value)) return false;
  active.add(value);
  let valid: boolean;
  switch (value.kind) {
    case "constant": case "literal": valid = Object.hasOwn(value, "value") && isValue(value.value); break;
    case "object-property": valid = isSelector(value.object) && isId(value.property); break;
    case "object-attribute": valid = isSelector(value.object) && isId(value.attribute); break;
    case "linked": case "linked-value":
      valid = isId(value.instructionId) && (value.key === undefined || isId(value.key)); break;
    case "count":
      valid = isId(value.subject) && (value.filter === undefined || isRecord(value.filter) && isValue(value.filter)); break;
    case "arithmetic": {
      const operator = value.operator;
      const arity = operator === "neg" ? 1 :
        ["sub", "subtract", "div", "divide"].includes(String(operator)) ? 2 : undefined;
      valid = typeof operator === "string" &&
        ["add", "sub", "subtract", "mul", "multiply", "div", "divide", "min", "max", "neg"].includes(operator) &&
        Array.isArray(value.operands) && value.operands.length > 0 &&
        (arity === undefined || value.operands.length === arity) &&
        value.operands.every(operand => isExpr(operand, active));
      break;
    }
    default: valid = false;
  }
  active.delete(value);
  return valid;
}
function parseArgs(value: unknown): SwapArgs {
  if (!isRecord(value) || !isExpr(value.objects)) throw new TypeError("effect.swap-location requires an objects Expr");
  for (const key of Object.keys(value)) {
    if (key !== "objects") throw new TypeError("Invalid effect.swap-location argument: " + key);
  }
  return { objects: value.objects };
}
function selectorOf(value: Value): ObjectSelector {
  if (isSelector(value)) return value;
  throw new TypeError("effect.swap-location objects must be source, target, pick, or linked selectors");
}
function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}
function refValue(ref: ObjectRef): Value {
  return { id: ref.id, zoneEntryId: ref.zoneEntryId };
}
function locationValue(location: LocationRef): Value {
  return location.type === "base" ? { type: "base", player: location.player } :
    { type: "battlefield", id: location.id };
}
function objectAt(ctx: ResolveContext, selected: ObjectSelector, label: string): { ref: ObjectRef; location: LocationRef } {
  const candidates = selected === "source" || selected === "self" ? [ctx.source.ref] :
    "target" in selected ? ctx.targets(selected.target) :
      "pick" in selected ? ctx.picks(selected.pick) : [ctx.linked(selected.linked)].flat();
  const refs: ObjectRef[] = [];
  for (const candidate of candidates) {
    if (!isRef(candidate)) continue;
    const object = ctx.object(candidate);
    if (object?.zone === "board" && object.location !== null && object.location.type === "battlefield" &&
        !refs.some(ref => sameRef(ref, candidate))) refs.push(candidate);
  }
  const found = refs[0];
  if (found === undefined) throw new TypeError("effect.swap-location " + label + " must name one Board object at a Battlefield");
  const snapshot = ctx.object(found)!;
  return { ref: found, location: snapshot.location! };
}

export default {
  op: "effect.swap-location",
  argsSchema: { parse: parseArgs },
  execute(ctx, args): InstructionResult {
    const evaluated = ctx.evaluate(args.objects);
    if (!Array.isArray(evaluated) || evaluated.length !== 2) {
      throw new TypeError("effect.swap-location objects must evaluate to exactly two selectors");
    }
    const selectors = evaluated.map(selectorOf);
    const a = objectAt(ctx, selectors[0]!, "objects[0]");
    const b = objectAt(ctx, selectors[1]!, "objects[1]");
    if (sameRef(a.ref, b.ref)) throw new TypeError("effect.swap-location objects must be two distinct objects");
    if (sameLocation(a.location, b.location)) {
      const receipt: Value = { count: 0, objects: [refValue(a.ref), refValue(b.ref)], movements: [] };
      ctx.link("swapped", receipt);
      return { status: "executed", events: [], linkedValues: { swapped: receipt } };
    }
    // 451.2 occupancy read through the shared Location module's unit view:
    // a swap destination is the other object's origin, and both objects leave
    // their origins simultaneously (448.3.a-b), so each pair checks only the
    // remaining units. queryMoveDestinations cannot express that simultaneous
    // vacating because allowsMove always excludes a mover's current location.
    const conflictAt = (destination: LocationRef, mover: ObjectRef): boolean => {
      const others = new Set(ctx.query({ zone: "board", type: "unit" })
        .filter(unit => sameLocation(unit.location, destination) &&
          !sameRef(unit.ref, mover) && unit.controller !== ctx.object(mover)!.controller)
        .map(unit => unit.controller));
      return others.size >= 2;
    };
    if (conflictAt(b.location, a.ref) || conflictAt(a.location, b.ref)) {
      const receipt: Value = { count: 0, objects: [refValue(a.ref), refValue(b.ref)], movements: [] };
      ctx.link("swapped", receipt);
      return { status: "negated", reason: "impossible", events: [] };
    }
    const originA = { ...a.location };
    const originB = { ...b.location };
    const firstOutcome = ctx.perform({ type: "move-location", object: a.ref, to: originB });
    if (firstOutcome.status !== "done") {
      return {
        status: "negated",
        reason: firstOutcome.status === "prevented" ? "skipped" : firstOutcome.status,
        events: [...firstOutcome.events]
      };
    }
    const secondOutcome = ctx.perform({ type: "move-location", object: b.ref, to: originA });
    if (secondOutcome.status !== "done") {
      // Atomic single action (448.3): fail closed so the outer transaction
      // rolls back the first relocation instead of stranding one object.
      throw new Error("effect.swap-location second relocation failed; rolling back the atomic swap");
    }
    const receipt: Value = {
      count: 2,
      objects: [refValue(a.ref), refValue(b.ref)],
      movements: [
        { object: refValue(a.ref), from: locationValue(originA), to: locationValue(originB) },
        { object: refValue(b.ref), from: locationValue(originB), to: locationValue(originA) }
      ]
    };
    ctx.link("swapped", receipt);
    return { status: "executed", events: [...firstOutcome.events, ...secondOutcome.events], linkedValues: { swapped: receipt } };
  }
} satisfies InstructionDef<SwapArgs>;
