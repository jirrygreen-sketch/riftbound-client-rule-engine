/**
 * Trait-layer adapters for continuous tag changes.
 *
 * The layer engine already owns the semantics of `add-tag`, `gain-tag`, and
 * `grant-tag`.  This module only turns a resolved object identity into the
 * per-object registration shape consumed by that engine.  Keeping the filter
 * tied to the object's zone entry prevents an old registration from applying
 * to a later incarnation of the same card.
 */
import type { ContinuousEffect } from "@riftbound/card-dsl";
import type { ContinuousEffectSpec, ObjectRef, ObjectSnapshot } from "../effects/contract.js";
import { effectId, targetFilter, type OpsTarget } from "./ops/index.js";

export interface TraitTagEffect {
  readonly kind: "add-tag" | "gain-tag" | "grant-tag";
  readonly tag: string;
}

export interface TraitTagTarget extends OpsTarget {}

function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

function targetCondition(target: TraitTagTarget): (object: ObjectSnapshot) => boolean {
  return object => sameRef(object.ref, target.ref);
}

/**
 * Build one trait-layer tag registration for one resolved object.
 *
 * `duration` is intentionally left to the instruction adapter: the same
 * registration shape can therefore be used by permanent and expiring effects.
 */
export function buildTraitTagSpec(
  op: string,
  sourceRef: ObjectRef,
  target: TraitTagTarget,
  tag: string,
  effectIdSuffix: string,
  settlement = "settlement-0",
  kind: TraitTagEffect["kind"] = "add-tag",
): ContinuousEffectSpec {
  if (typeof tag !== "string" || tag.trim().length === 0) {
    throw new TypeError("Trait tags must be non-empty strings");
  }
  const effect: TraitTagEffect = { kind, tag };
  return {
    id: effectId(op, sourceRef, target, effectIdSuffix, settlement),
    layer: "trait",
    source: sourceRef,
    filter: targetFilter(target),
    effect: { ...effect, condition: targetCondition(target) } as unknown as ContinuousEffect,
  };
}

/** Alias used by callers that name the operation rather than the layer. */
export const buildAddTagSpec = buildTraitTagSpec;

/** Alias retained for code that uses the rules vocabulary (`grant-tag`). */
export const buildGrantTagSpec = (
  op: string,
  sourceRef: ObjectRef,
  target: TraitTagTarget,
  tag: string,
  effectIdSuffix: string,
  settlement = "settlement-0",
): ContinuousEffectSpec => buildTraitTagSpec(op, sourceRef, target, tag, effectIdSuffix, settlement, "grant-tag");

