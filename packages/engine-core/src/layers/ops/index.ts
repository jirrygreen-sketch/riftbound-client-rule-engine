/**
 * layers/ops — Adapters that turn resolved instruction arguments into
 * ContinuousEffectSpec / Duration registrations for the layer engine
 * (docs/plans/2026-10-15-p0-contract.md 3.4, 3.8, section 5).
 *
 * These helpers exist because the instructions in
 * src/effects/instructions/continuous.*.ts resolve object references at
 * instruction resolution time, while the layer engine matches objects through
 * ObjectFilters at every evaluation. The bridge shape is one registration per
 * resolved object (per-object filter + deterministic id), which keeps both
 * sides deterministic: the instruction records exactly the objects it saw in
 * ResolveContext, and the layer engine re-checks zone membership each
 * evaluation, so an object that has left the board (or been regenerated with a
 * new zoneEntryId) stops receiving the effect.
 *
 * This directory is intentionally the only new surface; existing layer modules
 * are unchanged. The engine consumes the plain ContinuousEffect values written
 * here:
 * - "continuous.might" with a numeric amount, or "set-might" with a numeric
 *   value (src/layers/engine.ts applyArithmetic);
 * - "continuous.grant-keyword" / "continuous.keyword" with 'keyword' or
 *   'keywords' entries; the value is carried under 'keywordValue' so the
 *   engine's single-keyword additive branch (applyArithmetic:
 *   kind.includes("keyword") && effect.keyword !== undefined) never re-applies
 *   a fixed value a second time on top of applyAbility's grant
 *   (src/layers/engine.ts applyAbility);
 * - "continuous.combat" has no layer branch yet and is persisted as a
 *   deterministic registration for the combat workflow to consume (contract
 *   change request in the RIFT-258 handoff).
 *
 * CR v1.5 references for the clamping helpers:
 * - 143.2.c: if a Unit's Might is less than 0, the Might is referenced as 0
 *   while the actual (negative) value continues to exist for arithmetic;
 * - 478.1.c (Siphon Power example): a "-1 to a minimum of 1" modification is
 *   applied per modification, i.e. the printed-value floor is enforced at
 *   every step rather than after summing all modifications;
 * - 478 (layer order): copy, then trait, then ability, then arithmetic.
 */
import type {
  ContinuousEffectSpec,
  Duration,
  ObjectRef,
  ObjectSnapshot
} from "../../effects/contract.js";
import type { ContinuousEffect } from "@riftbound/card-dsl";
import { isTimingPointId } from "../../events/timing-points.js";

/** Named duration aliases accepted by the continuous.* instruction args. */
export type DurationAlias =
  | "this-turn"
  | "end-of-turn"
  | "this-combat"
  | "end-of-combat"
  | "permanent"
  | "while-source-in-zone"
  | { readonly type: "until"; readonly at: string; readonly player?: string }
  | { readonly type: "while-source-in-zone"; readonly source?: ObjectRef };

/** Duration strings that are not recognized aliases and must reject at parse time. */
export function isDurationAlias(value: unknown): value is DurationAlias {
  return value === "this-turn" || value === "end-of-turn" ||
    value === "this-combat" || value === "end-of-combat" ||
    value === "permanent" || value === "while-source-in-zone" ||
    (typeof value === "object" && value !== null && !Array.isArray(value) &&
      ((value as Record<string, unknown>).type === "until" ||
        (value as Record<string, unknown>).type === "while-source-in-zone"));
}

/**
 * Map a card-visible duration to the layers/duration.ts Duration union.
 * The contract has no "while-source-in-zone" string form, so the instruction
 * supplies the source ref explicitly (see the continuous.* primitives).
 */
export function resolveContinuousDuration(
  value: DurationAlias | undefined,
  sourceRef: ObjectRef | undefined
): Duration {
  if (value === undefined || value === "permanent") return { type: "permanent" };
  if (value === "this-turn" || value === "end-of-turn") return { type: "end-of-turn" };
  if (value === "this-combat" || value === "end-of-combat") return { type: "end-of-combat" };
  if (value === "while-source-in-zone") {
    if (sourceRef === undefined) {
      throw new TypeError("duration while-source-in-zone requires a source object");
    }
    return { type: "while-source-in-zone", source: sourceRef };
  }
  if (typeof value !== "object") {
    throw new TypeError("Unknown continuous effect duration");
  }
  if (value.type === "while-source-in-zone") {
    const source = value.source ?? sourceRef;
    if (source === undefined) {
      throw new TypeError("duration while-source-in-zone requires a source object");
    }
    return { type: "while-source-in-zone", source };
  }
  if (!isTimingPointId(value.at)) {
    throw new TypeError("duration until requires a timing point id");
  }
  return {
    type: "until",
    at: value.at,
    ...(value.player === undefined ? {} : { player: value.player })
  };
}

/** One object resolved by the instruction, with optional per-effect printed-value floor. */
export interface OpsTarget {
  readonly ref: ObjectRef;
  readonly snapshot: ObjectSnapshot;
  /** CR 478.1.c printed-value floor applied by this one modification. */
  readonly minimum?: number;
}

/** Deterministic per-registration effect id; stable for replay and registry dedupe. */
export function effectId(op: string, sourceRef: ObjectRef, target: OpsTarget, suffix: string): string {
  return op + ":" + sourceRef.id + ":" + sourceRef.zoneEntryId + ":" +
    target.ref.id + ":" + target.ref.zoneEntryId + ":" + suffix;
}

/** Per-object board filter; stale zoneEntryIds and off-board zones no longer match. */
export function targetFilter(target: OpsTarget): ContinuousEffectSpec["filter"] {
  return { objectId: target.ref.id, zone: "board" };
}

export interface MightEffect {
  readonly kind: "continuous.might" | "set-might";
  readonly amount?: number;
  readonly value?: number;
  readonly minimum?: number;
}

/**
 * Build one arithmetic-layer registration for one resolved object.
 * mode "add" writes the signed delta as 'amount' (kind "continuous.might");
 * mode "set" writes the absolute value as 'value' (kind "set-might"), which
 * the engine's set-might branch consumes (engine.ts applyArithmetic).
 */
export function buildMightSpec(
  op: string,
  sourceRef: ObjectRef,
  target: OpsTarget,
  mode: "add" | "set",
  amount: number,
  effectIdSuffix: string
): { effect: ContinuousEffectSpec; duration: Duration } & { readonly minimum?: number } {
  const effect: MightEffect = mode === "set"
    ? { kind: "set-might", value: amount, ...(target.minimum === undefined ? {} : { minimum: target.minimum }) }
    : { kind: "continuous.might", amount, ...(target.minimum === undefined ? {} : { minimum: target.minimum }) };
  const spec: ContinuousEffectSpec = {
    id: effectId(op, sourceRef, target, effectIdSuffix),
    layer: "arithmetic",
    source: sourceRef,
    filter: targetFilter(target),
    effect: effect as unknown as ContinuousEffect
  };
  return { effect: spec, duration: { type: "permanent" }, ...(target.minimum === undefined ? {} : { minimum: target.minimum }) };
}

export interface KeywordGrant {
  readonly id: string;
  readonly value?: number;
}

export interface KeywordEffect {
  readonly kind: "continuous.grant-keyword" | "continuous.keyword" | "continuous.combat";
  readonly keyword?: string;
  readonly keywords?: readonly KeywordGrant[];
  readonly keywordValue?: number;
  readonly value?: number;
  readonly flags?: readonly string[];
}

/**
 * Build one ability-layer registration for one resolved object.
 * A single keyword goes under both 'keyword' and 'keywordValue':
 * applyAbility grants the keyword with the value from 'keywordValue', and the
 * arithmetic engine's keyword-additive branch is deliberately not triggered
 * again because 'value' is not set for the single-keyword form. A keyword list
 * goes under 'keywords' as {id, value} pairs (no 'keyword' field), which
 * applyAbility consumes item by item and applyArithmetic skips.
 */
export function buildKeywordGrantSpec(
  op: string,
  sourceRef: ObjectRef,
  target: OpsTarget,
  kind: "continuous.grant-keyword" | "continuous.keyword" | "continuous.combat",
  keywords: readonly KeywordGrant[],
  effectIdSuffix: string,
  options?: { readonly forceList?: boolean }
): { effect: ContinuousEffectSpec; duration: Duration } {
  const single = options?.forceList === true ? undefined : keywords.length === 1 ? keywords[0]! : undefined;
  const effect: KeywordEffect = single !== undefined
    ? { kind, keyword: single.id, keywordValue: single.value }
    : { kind, keywords: [...keywords] };
  const spec: ContinuousEffectSpec = {
    id: effectId(op, sourceRef, target, effectIdSuffix),
    layer: "ability",
    source: sourceRef,
    filter: targetFilter(target),
    effect: effect as unknown as ContinuousEffect
  };
  return { effect: spec, duration: { type: "permanent" } };
}

/** One arithmetic-layer modification with an optional per-effect printed-value floor. */
export interface MightMinimumEntry {
  readonly effect: ContinuousEffectSpec;
  readonly minimum?: number;
}

/**
 * CR 478.1.c (Siphon Power): each modification with a printed-value minimum is
 * clamped at its own step, before the next modification is applied. The
 * generic engine clamps the final total at 0 only (143.2.c), so callers that
 * need per-effect floors apply this helper over the registry order.
 */
export function applyMightMinimums(
  snapshot: ObjectSnapshot,
  entries: readonly MightMinimumEntry[]
): number | null {
  let might = snapshot.might;
  if (might === null) return null;
  for (const entry of entries) {
    if (entry.minimum === undefined) continue;
    const amount = entry.effect.effect.amount;
    if (typeof amount !== "number") continue;
    might = Math.max(entry.minimum, might + amount);
  }
  return might;
}
