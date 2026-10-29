import type { ObjectRef } from "@riftbound/card-dsl";
import type { LocationRef, ObjectSnapshot, PlayerId, ZoneId } from "../effects/contract.js";
import { sameRef, type LayeredObjectSnapshot } from "./types.js";

const COPYABLE_KEYS = [
  "cardId", "name", "types", "tags", "keywords", "might", "energy", "power",
  "text", "effectText",
] as const;
type CopyableKey = (typeof COPYABLE_KEYS)[number];
export type CopiedTextField = "text" | "effectText";

/**
 * Explicit source -> destination trait mappings. Plain "text" and
 * "effectText" copy within their own fields; only the named alias crosses
 * sections for the CR 479.1.d form.
 */
const TEXT_COPY_ALIASES: Readonly<Record<string,
  { readonly source: CopiedTextField; readonly target: CopiedTextField }>> = Object.freeze({
  "text->effectText": { source: "text", target: "effectText" },
});

function copyList<T>(value: readonly T[]): readonly T[] {
  return Object.freeze([...value]);
}

function copyKeywords(value: ObjectSnapshot["keywords"]): ObjectSnapshot["keywords"] {
  return Object.freeze(value.map(keyword => Object.freeze({ ...keyword })));
}

/**
 * Applies the printed characteristics of a source to a target. The target's
 * identity, controller, zone, damage, attachment and state remain its own.
 */
export function copyCharacteristics(
  target: LayeredObjectSnapshot,
  source: ObjectSnapshot,
  properties: readonly string[] = COPYABLE_KEYS,
): LayeredObjectSnapshot {
  const result = { ...target } as LayeredObjectSnapshot;
  for (const property of properties) {
    const mapping = TEXT_COPY_ALIASES[property];
    const sourceKey = mapping?.source ?? property;
    const writeKey = mapping?.target ?? property;
    if (!COPYABLE_KEYS.includes(sourceKey as CopyableKey)) continue;
    const value = sourceKey === "text" || sourceKey === "effectText"
      ? copiedText(source, sourceKey)
      : source[sourceKey as Exclude<CopyableKey, "text" | "effectText">];
    (result as unknown as Record<string, unknown>)[writeKey] = Array.isArray(value) ? copyList(value) : value;
  }
  return Object.freeze(result);
}

/**
 * Select only the source text requested by a Copy Effect. `text` is Rules
 * Text and `effectText` is the separate attach-only Effect Text section
 * (Core Rules v1.5 135, 136, 479.1.b.1, 479.1.d). The value is read from the
 * source's copy-layer view, before trait/ability/arithmetic modifications.
 */
export function copiedText(
  source: ObjectSnapshot,
  field: CopiedTextField,
): string | null {
  const value = source as ObjectSnapshot & Partial<Record<CopiedTextField, string | null>>;
  return value[field] ?? null;
}

export interface CopiedObjectOptions {
  readonly ref: ObjectRef;
  readonly owner?: PlayerId;
  readonly controller?: PlayerId;
  readonly zone?: ZoneId;
  readonly location?: LocationRef | null;
  readonly isToken?: boolean;
  readonly name?: string;
}

/**
 * Materializes the v1.5 copy game action. The returned object already has the
 * copied values as printed values and carries no active copy effect.
 */
export function createCopiedObjectSnapshot(
  source: ObjectSnapshot,
  options: CopiedObjectOptions,
): LayeredObjectSnapshot {
  const object: LayeredObjectSnapshot = Object.freeze({
    ...source,
    ref: options.ref,
    owner: options.owner ?? source.owner,
    controller: options.controller ?? options.owner ?? source.controller,
    zone: options.zone ?? source.zone,
    location: options.location === undefined ? source.location : options.location,
    name: options.name ?? source.name,
    types: copyList(source.types),
    tags: copyList(source.tags),
    keywords: copyKeywords(source.keywords),
    power: source.power === null ? null : copyList(source.power),
    combatRole: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    empowered: 0,
    empoweredCount: 0,
    attachedTo: null,
    faceDown: false,
    facedownLocation: null,
    isToken: options.isToken ?? true,
    printed: source,
    actionTimings: [],
    availableTimings: [],
    movement: { allowed: true, canMove: true, canGank: false, restrictions: [] },
    text: copiedText(source, "text"),
    effectText: copiedText(source, "effectText"),
  });
  return object;
}

export function isCopiedObject(source: ObjectSnapshot, object: ObjectSnapshot): boolean {
  return !sameRef(source.ref, object.ref) && source.cardId === object.cardId &&
    source.name === object.name && source.might === object.might &&
    source.energy === object.energy && source.power === object.power;
}

export { COPYABLE_KEYS };
