import { OBJECT_FILTER_ANCHORS, type ObjectSelector } from "@riftbound/card-dsl";
import type { ObjectFilter, ObjectRef, ObjectSnapshot, Value } from "../contract.js";
import type { ExpressionContext } from "./expr.js";
import { objectRef } from "./history.js";
import { MissingInformation } from "./values.js";
import { matchesObjectPredicates, referenceMatches, sameLocation } from "../filters/predicates.js";

function references(value: unknown): ObjectRef[] {
  if (Array.isArray(value)) return value.flatMap(references);
  if (value !== null && typeof value === "object" && "id" in value && "zoneEntryId" in value) return [objectRef(value)];
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(references);
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
  const unique = new Map(refs.map(ref => [`${ref.id}:${ref.zoneEntryId}`, ref]));
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

const ANCHOR_KEYS = new Set<string>([
  ...(OBJECT_FILTER_ANCHORS as readonly string[]),
  "differentLocationFrom",
  "other",
]);

function locationKey(location: ObjectSnapshot["location"]): string | null {
  if (location === null) return null;
  return location.type === "base"
    ? JSON.stringify(["base", location.player])
    : JSON.stringify(["battlefield", location.id]);
}

function sameRef(left: ObjectRef | null, right: ObjectRef): boolean {
  return referenceMatches(left, right);
}

function uniqueSnapshots(objects: readonly ObjectSnapshot[]): ObjectSnapshot[] {
  const seen = new Set<string>();
  const result: ObjectSnapshot[] = [];
  for (const object of objects) {
    if (object === null || object === undefined) continue;
    const key = `${object.ref.id}:${object.ref.zoneEntryId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(object);
  }
  return result;
}

/** Set queries use every selected anchor, matching any member without duplicates. */
export function queryObjects(filter: ObjectFilter, environment: ExpressionContext): ObjectSnapshot[] {
  const scalar: Record<string, Value> = {};
  const anchors: { key: string; refs: ObjectRef[]; snapshots: ObjectSnapshot[] }[] = [];
  for (const [key, value] of Object.entries(filter)) {
    if (!ANCHOR_KEYS.has(key)) scalar[key] = value;
    else {
      let refs: ObjectRef[];
      try {
        refs = resolveObjectSelector(value as ObjectSelector, environment)
          .filter(ref => value === "source" || !environment.isIgnored(ref));
      } catch {
        refs = [];
      }
      const snapshots = refs.flatMap(ref => {
        try { return [selectorSnapshot(ref, environment, value === "source")]; } catch { return []; }
      });
      anchors.push({ key, refs, snapshots });
    }
  }

  // Always obtain the visible set before applying extension predicates locally.
  // ResolveContext.query implementations intentionally only guarantee a small
  // legacy vocabulary; passing might/keyword/relative fields through them would
  // silently widen or empty the candidate set.
  const candidates = environment.query
    ? environment.query({})
    : environment.context.query({});
  const anchorSnapshots = (selector: unknown): readonly ObjectSnapshot[] => {
    try {
      const refs = resolveObjectSelector(selector as ObjectSelector, environment)
        .filter(ref => selector === "source" || !environment.isIgnored(ref));
      return refs.flatMap(ref => {
        try { return [selectorSnapshot(ref, environment, selector === "source")]; } catch { return []; }
      });
    } catch {
      return [];
    }
  };
  const matchContext = {
    controller: environment.context.controller,
    anchor: environment.context.source,
    references: anchorSnapshots,
  };

  const filtered = candidates.filter(object => {
    if (!matchesObjectPredicates(scalar, object, matchContext)) return false;
    return anchors.every(anchor => {
      if (anchor.key === "sameLocationAs") {
        return object.location !== null && anchor.snapshots.some(reference => sameLocation(object.location, reference.location));
      }
      if (anchor.key === "differentLocationFrom") {
        return object.location !== null && anchor.snapshots.every(reference => !sameLocation(object.location, reference.location));
      }
      if (anchor.key === "exclude") {
        return !anchor.refs.some(ref => sameRef(object.ref, ref));
      }
      if (anchor.key === "other") {
        const refs = anchor.refs.length > 0 ? anchor.refs : [environment.context.source.ref];
        return !refs.some(ref => sameRef(object.ref, ref));
      }
      if (anchor.key === "attachedTo") {
        return anchor.refs.some(ref => sameRef(object.attachedTo, ref));
      }
      return anchor.refs.some(ref => sameRef(object.ref, ref));
    });
  });
  return uniqueSnapshots(filtered);
}
