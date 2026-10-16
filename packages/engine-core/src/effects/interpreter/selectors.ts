import { OBJECT_FILTER_ANCHORS, type ObjectSelector } from "@riftbound/card-dsl";
import type { ObjectFilter, ObjectRef, ObjectSnapshot, Value } from "../contract.js";
import type { ExpressionContext } from "./expr.js";
import { objectRef } from "./history.js";
import { MissingInformation } from "./values.js";

function references(value: unknown): ObjectRef[] {
  if (Array.isArray(value)) return value.flatMap(references);
  if (value !== null && typeof value === "object" && "id" in value && "zoneEntryId" in value) return [objectRef(value)];
  return [];
}

/** Preserve selection order and zone identity; never rebind a stale target by id. */
export function resolveObjectSelector(selector: ObjectSelector, environment: Pick<ExpressionContext, "context" | "host" | "linked">): ObjectRef[] {
  const context = environment.context;
  if (selector === "self") return [environment.host ?? context.source.ref];
  if (selector === "source") return [context.source.ref];
  if (selector === null || typeof selector !== "object" || Array.isArray(selector) || Object.keys(selector).length !== 1) {
    throw new Error("Invalid ObjectSelector; runtime ObjectRefs are not static IR selectors");
  }
  const key = Object.keys(selector)[0]!;
  const id = (selector as Readonly<Record<string, unknown>>)[key];
  if (!["target", "pick", "linked"].includes(key) || typeof id !== "string" || id.length === 0) throw new Error("Invalid ObjectSelector");
  if (key === "target") return context.targets(id);
  if (key === "pick") return references(context.picks(id));
  const value = environment.linked(id);
  if (value === undefined) throw new MissingInformation(`Unavailable linked object: ${id}`);
  const direct = references(value);
  // Instruction results are records of named bindings. Only object-valued
  // bindings contribute; scalar counters and amounts are not object identities.
  const refs = direct.length > 0 || Array.isArray(value) || value === null || typeof value !== "object"
    ? direct : Object.values(value).flatMap(references);
  const unique = new Map(refs.map(ref => [JSON.stringify([ref.id, ref.zoneEntryId]), ref]));
  return [...unique.values()];
}

export function selectorSnapshot(ref: ObjectRef, environment: ExpressionContext, source = false): ObjectSnapshot {
  if (!source && environment.isIgnored(ref)) throw new MissingInformation(`Ignored object: ${ref.id}`);
  const context = environment.context;
  let snapshot = context.object(ref);
  if (snapshot === null && environment.canLookBack(ref)) snapshot = context.lastKnown(ref);
  if (snapshot === null && source) snapshot = context.source;
  if (snapshot === null) throw new MissingInformation(`Unavailable object: ${ref.id}`);
  return snapshot;
}

/** Set queries use every selected anchor, matching any member without duplicates. */
export function queryObjects(filter: ObjectFilter, environment: ExpressionContext): ObjectSnapshot[] {
  const scalar: Record<string, Value> = {};
  const anchors: { key: string; refs: ObjectRef[]; locations?: readonly ObjectSnapshot["location"][] }[] = [];
  for (const [key, value] of Object.entries(filter)) {
    if (!(OBJECT_FILTER_ANCHORS as readonly string[]).includes(key)) scalar[key] = value;
    else {
      const selector = value as ObjectSelector;
      const refs = resolveObjectSelector(selector, environment).filter(ref => selector === "source" || !environment.isIgnored(ref));
      anchors.push({ key, refs, ...(key === "sameLocationAs" ? {
        locations: refs.map(ref => selectorSnapshot(ref, environment, selector === "source").location)
      } : {}) });
    }
  }
  const same = (left: ObjectRef | null, right: ObjectRef) => left?.id === right.id && left.zoneEntryId === right.zoneEntryId;
  const locationKey = (location: ObjectSnapshot["location"]) => location === null ? null : JSON.stringify(
    location.type === "base" ? ["base", location.player] : ["battlefield", location.id]
  );
  return (environment.query ?? (value => environment.context.query(value)))(scalar).filter(object => anchors.every(anchor => {
    if (anchor.key === "sameLocationAs") return object.location !== null && anchor.locations!.some(location => locationKey(location) === locationKey(object.location));
    if (anchor.key === "exclude") return !anchor.refs.some(ref => same(object.ref, ref));
    return anchor.refs.some(ref => same(anchor.key === "attachedTo" ? object.attachedTo : object.ref, ref));
  }));
}
