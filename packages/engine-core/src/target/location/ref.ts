import type { LocationSelector, RelativeLocationKind } from "@riftbound/card-dsl";
import type { LocationRef, ObjectRef, ResolveContext } from "../../effects/contract.js";
import { resolveObjectSelector } from "../../effects/interpreter/selectors.js";
import type { LocationEnvironment } from "./types.js";
import { queryLocationCandidates } from "./candidates.js";

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
      !["controller", "opponent"].includes(String((value as Record<string, unknown>).player)) ||
     (value as Record<string, unknown>).type === "battlefield" && typeof (value as Record<string, unknown>).id === "string");
}

function linkedLocation(value: unknown): LocationRef | null {
  if (concrete(value)) return value;
  if (Array.isArray(value)) return value.map(linkedLocation).find((item): item is LocationRef => item !== null) ?? null;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["location", "to", "destination", "there"]) {
      const resolved = linkedLocation(record[key]);
      if (resolved) return resolved;
    }
  }
  return null;
}

function selectedObject(environment: LocationEnvironment, selector: unknown): ObjectRef | undefined {
  try {
    return resolveObjectSelector(selector as never, {
      context: environment.context,
      host: environment.host,
      linked: (id: string) => environment.linked?.(id) as import("@riftbound/card-dsl").Value | undefined
    })[0];
  } catch {
    return undefined;
  }
}

function targetLocation(environment: LocationEnvironment, targetId: string): LocationRef | null {
  const scoped = environment.locationBindings?.(targetId)?.[0];
  if (scoped) return scoped;
  const ref = environment.context.targets(targetId)[0];
  return ref ? environment.context.object(ref)?.location ?? null : null;
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
    const opponent = environment.opponent ?? known.find(id => id !== environment.context.controller);
    return opponent === undefined ? null : { type: "base", player: opponent };
  }
  if (relation === "source-location") return source.location;
  const objectRef = targetId === undefined ? undefined : environment.context.targets(targetId)[0];
  const object = objectRef ? environment.context.object(objectRef) : undefined;
  if (relation === "target-location") return object?.location ?? null;
  if (relation === "target-controller-base") return object ? { type: "base", player: object.controller } : null;
  if (relation === "target-owner-base") return object ? { type: "base", player: object.owner } : null;
  return null;
}

/** Resolve a symbolic location using the current ability controller and targets. */
export function resolveLocationSelector(selector: LocationSelector | unknown, environment: LocationEnvironment): LocationRef {
  if (concrete(selector)) return selector;
  if (typeof selector === "string") {
    const resolved = relation(selector as RelativeLocationKind, environment);
    if (!resolved) throw new Error(`Location selector ${selector} has no runtime location`);
    return resolved;
  }
  if (selector === null || typeof selector !== "object" || Array.isArray(selector)) throw new Error("Invalid location selector");
  const value = selector as Record<string, unknown>;
  if (value.type === "base" && (value.player === "controller" || value.player === "opponent")) {
    const resolved = relation(value.player === "controller" ? "ability-controller-base" : "opponent-base", environment);
    if (!resolved) throw new Error("Relative base has no runtime player");
    return resolved;
  }
  if (value.kind === "relative") {
    const resolved = relation(value.relation as RelativeLocationKind, environment, typeof value.target === "string" ? value.target : undefined);
    if (!resolved) throw new Error("Relative location has no runtime location");
    return resolved;
  }
  if (value.kind === "location-of" || value.kind === "location-selector") {
    const object = selectedObject(environment, value.kind === "location-of" ? value.object : value.locationOf);
    const resolved = object ? environment.context.object(object)?.location : null;
    if (!resolved) throw new Error("Object has no runtime location");
    return resolved;
  }
  if (value.kind === "target-location") {
    const resolved = targetLocation(environment, String(value.target));
    if (!resolved) throw new Error("Target has no runtime location");
    return resolved;
  }
  if (value.kind === "target-controller-base" || value.kind === "target-owner-base") {
    const resolved = relation(value.kind, environment, String(value.target));
    if (!resolved) throw new Error("Target has no runtime controller or owner base");
    return resolved;
  }
  if (value.kind === "source-location") {
    if (!environment.context.source.location) throw new Error("Source has no runtime location");
    return environment.context.source.location;
  }
  if (value.kind === "linked-location") {
    const linked = environment.linked?.(String(value.instructionId));
    const selected = value.key === undefined ? linked :
      (linked !== null && typeof linked === "object" && !Array.isArray(linked) ? (linked as Record<string, unknown>)[String(value.key)] : undefined);
    const resolved = linkedLocation(selected);
    if (!resolved) throw new Error("Linked value has no runtime location");
    return resolved;
  }
  if (value.kind === "choose") {
    const options = Array.isArray(value.options)
      ? value.options.map(option => resolveLocationSelector(option, environment))
      : value.filter === undefined
        ? []
        : [...queryLocationCandidates(environment.context, value.filter as never, environment)];
    if (options.length === 0) throw new Error("Location choice has no options");
    const answer = environment.context.choose<LocationRef>({
      id: String(value.id), type: "mode", chooser: environment.context.controller, visibility: "public", options
    });
    if (!concrete(answer) || !options.some(option => sameLocation(option, answer))) throw new Error("Invalid location choice answer");
    return answer;
  }
  throw new Error("Unsupported location selector");
}
