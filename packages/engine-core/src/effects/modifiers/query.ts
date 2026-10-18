import type { ObjectRef } from "@riftbound/card-dsl";
import type { RegisteredContinuousEffect } from "../../layers/types.js";
import type { ObjectSnapshot } from "../../effects/contract.js";
import { ContinuousEffectRegistry } from "../../layers/duration.js";
import { matchesObjectPredicates, type FilterMatchContext } from "../filters/predicates.js";

/**
 * Read-only queries over the registered modifier primitives.
 *
 * The registry stays the single source of truth; these helpers only sum or
 * select matching registrations for rule consumers (Deal actions reading
 * Bonus Damage per CR 714/715.2, the lethal check reading 142.4.c overrides,
 * and the arithmetic layer reading 479.4.b additional Might reductions).
 * Nothing here mutates game state and nothing here invents a default value:
 * an empty registry yields an empty result and the caller keeps its own
 * CR-backed default (142.4.b for lethal, no bonus, no extra reduction).
 */

type AnyRecord = Record<string, unknown>;

function record(value: unknown): AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as AnyRecord : {};
}

function sameRef(left: ObjectRef | undefined | null, right: ObjectRef | undefined | null): boolean {
  return left !== undefined && left !== null && right !== undefined && right !== null &&
    left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

function effectRecord(entry: RegisteredContinuousEffect): AnyRecord {
  return record(entry.effect.effect);
}

function kindOf(entry: RegisteredContinuousEffect): string {
  return String(effectRecord(entry).kind ?? "").toLowerCase();
}

function appliesToMatches(entryAppliesTo: unknown, queryScope: unknown): boolean {
  if (queryScope === undefined) return entryAppliesTo === undefined;
  if (entryAppliesTo === undefined) return false;
  if (entryAppliesTo === "any" || entryAppliesTo === "all") return true;
  return stable(entryAppliesTo) === stable(queryScope);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (typeof value === "object" && value !== null) {
    return "{" + Object.keys(value as Record<string, unknown>).sort().map(key =>
      JSON.stringify(key) + ":" + stable((value as Record<string, unknown>)[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

export interface ModifierQueryOptions {
  readonly controller: string;
  readonly appliesTo?: unknown;
  readonly source?: ObjectRef | null;
  readonly anchors?: readonly unknown[];
}

function controllerOf(
  entry: RegisteredContinuousEffect,
  object: (ref: ObjectRef) => unknown = () => null,
): string | undefined {
  const sourcePlayer = effectRecord(entry).sourcePlayer;
  if (typeof sourcePlayer === "string") return sourcePlayer;
  const source = entry.effect.source;
  if (source === undefined) return undefined;
  const controller = record(object(source)).controller;
  return typeof controller === "string" ? controller : undefined;
}

function filterContext(options: ModifierQueryOptions): FilterMatchContext {
  return { controller: options.controller };
}

function anchorCandidates(options: ModifierQueryOptions): readonly unknown[] {
  return options.anchors ?? (options.source === undefined ? [] : [options.source]);
}

function isSnapshot(value: unknown): value is ObjectSnapshot {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (value as { ref?: unknown }).ref !== undefined;
}

function entryFilterMatches(
  entry: RegisteredContinuousEffect,
  options: ModifierQueryOptions,
  object: (ref: ObjectRef) => unknown,
): boolean {
  const filter = entry.effect.filter;
  if (!filter || Object.keys(filter).length === 0) return true;
  let anchors = anchorCandidates(options);
  const entrySource = entry.effect.source;
  if (anchors.length === 0 && entrySource !== undefined) {
    const sourceSnapshot = object(entrySource);
    anchors = sourceSnapshot === null || sourceSnapshot === undefined ? [] : [sourceSnapshot];
  }
  if (anchors.length === 0) return false;
  return anchors.every(anchor => {
    const snapshot = isSnapshot(anchor) ? anchor : object(anchor as ObjectRef);
    return snapshot !== null && snapshot !== undefined &&
      matchesObjectPredicates(filter, snapshot as never, filterContext(options));
  });
}

function activeEntries(
  registry: ContinuousEffectRegistry,
  object: (ref: ObjectRef) => unknown,
): readonly RegisteredContinuousEffect[] {
  return registry.active(
    undefined,
    ref => (ref === undefined ? null : object(ref) as ObjectSnapshot | null),
  );
}

export interface BonusDamageGrant {
  readonly id: string;
  readonly amount: number;
  readonly appliesTo?: unknown;
  readonly sourcePlayer?: string;
}

function grantFrom(
  entry: RegisteredContinuousEffect,
  object: (ref: ObjectRef) => unknown,
): Record<string, unknown> {
  const effect = effectRecord(entry);
  return {
    id: entry.effect.id,
    amount: effect.amount,
    appliesTo: effect.appliesTo,
    sourcePlayer: controllerOf(entry, object),
  };
}

/**
 * Active Bonus Damage grants for one Deal action (CR 714: instances are
 * summed and applied once by the consumer). Only positive amounts are
 * returned, so the consumer can add them directly (714.1/714.2).
 */
export function bonusDamageGrantsForDeal(
  registry: ContinuousEffectRegistry,
  options: ModifierQueryOptions,
  object: (ref: ObjectRef) => unknown = () => null,
): readonly BonusDamageGrant[] {
  return activeEntries(registry, object)
    .filter(entry => kindOf(entry) === "continuous.bonus-damage")
    .filter(entry => controllerOf(entry, object) === options.controller)
    .filter(entry => appliesToMatches(effectRecord(entry).appliesTo, options.appliesTo))
    .filter(entry => entryFilterMatches(entry, options, object))
    .map(entry => grantFrom(entry, object) as unknown as BonusDamageGrant)
    .filter(grant => typeof grant.amount === "number" && Number.isSafeInteger(grant.amount) && grant.amount > 0);
}

export function bonusDamageForDeal(
  registry: ContinuousEffectRegistry,
  options: ModifierQueryOptions,
  object: (ref: ObjectRef) => unknown = () => null,
): number {
  return bonusDamageGrantsForDeal(registry, options, object).reduce((sum, grant) => sum + grant.amount, 0);
}

export interface LethalThresholdGrant {
  readonly id: string;
  readonly amount: number;
  readonly appliesTo?: unknown;
  readonly sourcePlayer?: string;
}

/**
 * Active Lethal Damage threshold overrides for one controller (CR 142.4.c).
 * An empty result means the default 142.4.b threshold stays in force.
 */
export function lethalThresholdFor(
  registry: ContinuousEffectRegistry,
  options: ModifierQueryOptions,
  object: (ref: ObjectRef) => unknown = () => null,
): readonly LethalThresholdGrant[] {
  return activeEntries(registry, object)
    .filter(entry => kindOf(entry) === "continuous.lethal-threshold")
    .filter(entry => controllerOf(entry, object) === options.controller)
    .filter(entry => appliesToMatches(effectRecord(entry).appliesTo, options.appliesTo))
    .filter(entry => entryFilterMatches(entry, options, object))
    .map(entry => grantFrom(entry, object) as unknown as LethalThresholdGrant)
    .filter(grant => typeof grant.amount === "number" && Number.isSafeInteger(grant.amount) && grant.amount > 0);
}

export interface MightReductionModifier {
  readonly id: string;
  readonly mode: string;
  readonly amount: number;
  readonly appliesTo?: unknown;
  readonly sourcePlayer?: string;
}

/**
 * Active additional Might-reduction modifiers for one controller's effects
 * (CR 479.4.b). Each entry is one modification the arithmetic consumer adds
 * to the reduction it is settling.
 */
export function additionalMightReductions(
  registry: ContinuousEffectRegistry,
  options: ModifierQueryOptions,
  object: (ref: ObjectRef) => unknown = () => null,
): readonly MightReductionModifier[] {
  return activeEntries(registry, object)
    .filter(entry => kindOf(entry) === "continuous.modify-might-reduction")
    .filter(entry => controllerOf(entry, object) === options.controller)
    .filter(entry => effectRecord(entry).mode === "additional")
    .filter(entry => appliesToMatches(effectRecord(entry).appliesTo, options.appliesTo))
    .filter(entry => entryFilterMatches(entry, options, object))
    .map(entry => grantFrom(entry, object) as unknown as MightReductionModifier)
    .filter(grant => typeof grant.amount === "number" && Number.isSafeInteger(grant.amount) && grant.amount !== 0);
}

export type { RegisteredContinuousEffect };
export { sameRef };
