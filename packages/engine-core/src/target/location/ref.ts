import type { LocationSelector, RelativeLocationKind } from "@riftbound/card-dsl";
import type { LocationRef, ObjectRef, ResolveContext } from "../../effects/contract.js";
import { resolveObjectSelector } from "../../effects/interpreter/selectors.js";
import type { LocationEnvironment } from "./types.js";
import { queryLocationCandidates } from "./candidates.js";
import { MissingInformation } from "../../effects/interpreter/values.js";

export function locationKey(ref: LocationRef): string {
  return ref.type === "base" ? `base:${ref.player}` : `battlefield:${ref.id}`;
}

export function sameLocation(left: LocationRef | null | undefined, right: LocationRef | null | undefined): boolean {
  if (left === null || left === undefined || right === null || right === undefined) return left === right;
  if (left.type !== right.type) return false;
  return left.type === "base" && right.type === "base" ? left.player === right.player :
    left.type === "battlefield" && right.type === "battlefield" ? left.id === right.id : false;
}

function concrete(value: unknown): value is LocationRef {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    ((value as Record<string, unknown>).type === "base" &&
      typeof (value as Record<string, unknown>).player === "string" &&
      !["self", "controller", "opponent", "uncontrolled"].includes(String((value as Record<string, unknown>).player)) ||
     (value as Record<string, unknown>).type === "battlefield" && typeof (value as Record<string, unknown>).id === "string");
}

function linkedLocation(value: unknown): LocationRef | null {
  if (concrete(value)) return value;
  if (Array.isArray(value)) {
    const locations = value.map(linkedLocation).filter((item): item is LocationRef => item !== null);
    return locations.length > 0 && locations.every(item => sameLocation(item, locations[0])) ? locations[0]! : null;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["location", "to", "destination", "there", "movements"]) {
      const resolved = linkedLocation(record[key]);
      if (resolved) return resolved;
    }
  }
  return null;
}

function selectedObject(environment: LocationEnvironment, selector: unknown): ObjectRef | undefined {
  return resolveObjectSelector(selector as never, {
    context: environment.context,
    host: environment.host,
    linked: (id: string) => environment.linked?.(id) as import("@riftbound/card-dsl").Value | undefined
  })[0];
}

/** A Location card identifies itself; a Permanent identifies where it currently is. */
export function locationOfObject(object: ResolveContext["source"]): LocationRef | null {
  if (object.zone !== "board") return null;
  if (object.types.includes("battlefield")) return object.location?.type === "battlefield"
    ? object.location : { type: "battlefield", id: object.ref.id };
  if (object.types.includes("base")) return { type: "base", player: object.controller };
  return object.location;
}

function targetLocation(environment: LocationEnvironment, targetId: string): LocationRef | null {
  const scoped = environment.locationBindings?.(targetId)?.[0];
  if (scoped) return scoped;
  const ref = environment.context.targets(targetId)[0];
  const object = ref ? environment.context.object(ref) : null;
  return object ? locationOfObject(object) : null;
}

function relation(
  relation: RelativeLocationKind,
  environment: LocationEnvironment,
  targetId?: string
): LocationRef | null {
  const source = environment.context.source;
  if (relation === "ability-controller-base" || relation === "controller-base") return { type: "base", player: environment.context.controller };
  if (relation === "opponent-base") {
    const known = environment.players ?? [
      environment.context.controller,
      ...environment.context.query({}).flatMap(object => [object.owner, object.controller])
    ];
    const opponents = [...new Set(known)].filter(id => id !== environment.context.controller);
    const opponent = environment.opponent ?? (opponents.length === 1 ? opponents[0] : undefined);
    return opponent === undefined ? null : { type: "base", player: opponent };
  }
  if (relation === "source-location") return locationOfObject(environment.context.object(source.ref) ?? source);
  const objectRef = targetId === undefined ? undefined : environment.context.targets(targetId)[0];
  const object = objectRef ? environment.context.object(objectRef) : undefined;
  if (relation === "target-location" && targetId !== undefined) return targetLocation(environment, targetId);
  if (relation === "target-controller-base") return object ? { type: "base", player: object.controller } : null;
  if (relation === "target-owner-base") return object ? { type: "base", player: object.owner } : null;
  return null;
}

/** Read-only candidate binding; making the choice remains the caller's action. */
export function locationSelectorOptions(
  selector: Extract<LocationSelector, { readonly kind: "choose" }>,
  environment: LocationEnvironment
): readonly LocationRef[] {
  const legal = queryLocationCandidates(environment.context, selector.filter ?? {}, environment);
  const candidates = selector.options?.map(option => resolveLocationSelector(option, environment)) ?? legal;
  return [...new Map(candidates
    .filter(candidate => legal.some(ref => sameLocation(ref, candidate)))
    .map(candidate => [locationKey(candidate), candidate])).values()];
}

/** Resolve a symbolic location using the current ability controller and targets. */
export function resolveLocationSelector(selector: LocationSelector | unknown, environment: LocationEnvironment): LocationRef {
  if (concrete(selector)) return selector;
  if (typeof selector === "string") {
    const resolved = relation(selector as RelativeLocationKind, environment);
    if (!resolved) throw new MissingInformation(`Location selector ${selector} has no runtime location`);
    return resolved;
  }
  if (selector === null || typeof selector !== "object" || Array.isArray(selector)) throw new Error("Invalid location selector");
  const value = selector as Record<string, unknown>;
  if (value.type === "base" && (value.player === "self" || value.player === "controller" || value.player === "opponent")) {
    const resolved = relation(value.player === "opponent" ? "opponent-base" : "ability-controller-base", environment);
    if (!resolved) throw new MissingInformation("Relative base has no runtime player");
    return resolved;
  }
  if (value.kind === "relative") {
    const resolved = relation(value.relation as RelativeLocationKind, environment, typeof value.target === "string" ? value.target : undefined);
    if (!resolved) throw new MissingInformation("Relative location has no runtime location");
    return resolved;
  }
  if (value.kind === "location-of" || value.kind === "location-selector") {
    const object = selectedObject(environment, value.kind === "location-of" ? value.object : value.locationOf);
    const snapshot = object ? environment.context.object(object) : null;
    const resolved = snapshot ? locationOfObject(snapshot) : null;
    if (!resolved) throw new MissingInformation("Object has no runtime location");
    return resolved;
  }
  if (value.kind === "target-location") {
    const resolved = targetLocation(environment, String(value.target));
    if (!resolved) throw new MissingInformation("Target has no runtime location");
    return resolved;
  }
  if (value.kind === "target-controller-base" || value.kind === "target-owner-base") {
    const resolved = relation(value.kind, environment, String(value.target));
    if (!resolved) throw new MissingInformation("Target has no runtime controller or owner base");
    return resolved;
  }
  if (value.kind === "source-location") {
    const resolved = relation("source-location", environment);
    if (!resolved) throw new MissingInformation("Source has no runtime location");
    return resolved;
  }
  if (value.kind === "linked-location") {
    const linked = environment.linked?.(String(value.instructionId));
    const selected = value.key === undefined ? linked :
      (linked !== null && typeof linked === "object" && !Array.isArray(linked) ? (linked as Record<string, unknown>)[String(value.key)] : undefined);
    const resolved = linkedLocation(selected);
    if (!resolved) throw new MissingInformation("Linked value has no runtime location");
    return resolved;
  }
  if (value.kind === "choose") {
    const options = locationSelectorOptions(value as unknown as Extract<LocationSelector, { readonly kind: "choose" }>, environment);
    if (options.length === 0) throw new MissingInformation("Location choice has no options");
    const answer = environment.context.choose<LocationRef>({
      id: String(value.id), type: "mode", chooser: environment.context.controller, visibility: "public", options
    });
    if (!concrete(answer) || !options.some(option => sameLocation(option, answer))) throw new Error("Invalid location choice answer");
    return options.find(option => sameLocation(option, answer))!;
  }
  throw new Error("Unsupported location selector");
}
