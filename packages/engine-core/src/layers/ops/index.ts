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
  if (value === "this-turn" || value === "end-of-turn" ||
    value === "this-combat" || value === "end-of-combat" ||
    value === "permanent" || value === "while-source-in-zone") return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item.type === "until") {
    return Object.keys(item).every(key => ["type", "at", "player"].includes(key)) && isTimingPointId(item.at) &&
      (item.player === undefined || typeof item.player === "string" && item.player.length > 0);
  }
  if (item.type === "while-source-in-zone") {
    if (Object.keys(item).some(key => key !== "type" && key !== "source")) return false;
    if (item.source === undefined) return true;
    return typeof item.source === "object" && item.source !== null &&
      typeof (item.source as Record<string, unknown>).id === "string" &&
      ((item.source as Record<string, unknown>).id as string).length > 0 &&
      Number.isSafeInteger((item.source as Record<string, unknown>).zoneEntryId) &&
      ((item.source as Record<string, unknown>).zoneEntryId as number) >= 0;
  }
  return false;
}

/** A stable settlement identity may be supplied by a replay/event owner. */
export function settlementIdentity(
  source: ObjectRef,
  op: string,
  read: (key: string) => unknown,
  write: (key: string, value: number) => void,
  requested?: string
): string {
  if (requested !== undefined) {
    if (requested.length === 0) throw new TypeError("settlement identity must be non-empty");
    return requested;
  }
  const key = "__continuous.settlement." + op + "." + source.id + "." + String(source.zoneEntryId);
  const previous = read(key);
  const next = (typeof previous === "number" && Number.isSafeInteger(previous) ? previous : 0) + 1;
  write(key, next);
  return "settlement-" + String(next);
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
  if (value !== undefined && !isDurationAlias(value)) throw new TypeError("Unknown continuous effect duration");
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
  /** Might at the time the reduction instruction resolved; used by 479.4.b. */
  readonly snapshotMight?: number;
}

/** Deterministic per-registration effect id; stable for replay and registry dedupe. */
export function effectId(
  op: string,
  sourceRef: ObjectRef,
  target: OpsTarget,
  suffix: string,
  settlement = "settlement-0"
): string {
  return op + ":" + settlement + ":" + sourceRef.id + ":" + sourceRef.zoneEntryId + ":" +
    target.ref.id + ":" + target.ref.zoneEntryId + ":" + suffix;
}

/** Per-object board filter; stale zoneEntryIds and off-board zones no longer match. */
export function targetFilter(target: OpsTarget): ContinuousEffectSpec["filter"] {
  return { objectId: target.ref.id, zone: "board", zoneEntryId: target.ref.zoneEntryId };
}

function targetCondition(target: OpsTarget): (object: ObjectSnapshot) => boolean {
  return object => object.ref.id === target.ref.id && object.ref.zoneEntryId === target.ref.zoneEntryId;
}

export interface MightEffect {
  readonly kind: "continuous.might" | "set-might";
  readonly amount?: number;
  readonly value?: number;
  readonly minimum?: number;
  /** Non-passive changes remember their actual delta (CR 479.4.b). */
  readonly snapshotDelta?: number;
  /**
   * A signed reduction registered by a spell or ability instruction. The
   * arithmetic consumer uses this marker to find matching
   * `continuous.modify-might-reduction` registrations before the reduction is
   * applied. Passive layer effects (for example Shield) omit it.
   */
  readonly reductionScope?: "controller-spells-and-abilities";
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
  effectIdSuffix: string,
  settlement = "settlement-0"
): { effect: ContinuousEffectSpec; duration: Duration } & { readonly minimum?: number } {
  const snapshotMight = target.snapshot.might;
  const snapshottedAmount = mode === "add" && target.minimum !== undefined &&
    snapshotMight !== null && amount < 0
    ? Math.min(0, Math.max(amount, target.minimum - snapshotMight))
    : mode === "set" && target.minimum !== undefined
      ? Math.max(amount, target.minimum)
      : amount;
  // CR 479.4.b: preserve the authored signed delta and the Might used as the
  // limitation basis. The production layer consumer adds matching modifiers
  // and remembers the limited result when the effect is first applied.
  const effect: MightEffect = mode === "set"
    ? { kind: "set-might", value: snapshottedAmount,
      ...(snapshotMight === null ? {} : { snapshotDelta: snapshottedAmount - snapshotMight }),
      ...(target.minimum === undefined ? {} : { minimum: target.minimum }) }
    : { kind: "continuous.might", amount,
      ...(target.minimum === undefined ? {} : { minimum: target.minimum }),
      ...(snapshotMight === null ? {} : { snapshotMight }),
      // Only a signed decrease is eligible for the additional-reduction
      // modifier. Zero and positive arithmetic stay ordinary layer effects.
      ...(amount < 0 ? { reductionScope: "controller-spells-and-abilities" as const } : {}) };
  const spec: ContinuousEffectSpec = {
    id: effectId(op, sourceRef, target, effectIdSuffix, settlement),
    layer: "arithmetic",
    source: sourceRef,
    filter: targetFilter(target),
    effect: { ...effect, condition: targetCondition(target) } as unknown as ContinuousEffect
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
  options?: { readonly forceList?: boolean; readonly settlement?: string; readonly condition?: (object: ObjectSnapshot) => boolean }
): { effect: ContinuousEffectSpec; duration: Duration } {
  const single = options?.forceList === true ? undefined : keywords.length === 1 ? keywords[0]! : undefined;
  const effect: KeywordEffect = single !== undefined
    ? { kind, keyword: single.id, keywordValue: single.value }
    : { kind, keywords: [...keywords] };
  const spec: ContinuousEffectSpec = {
    id: effectId(op, sourceRef, target, effectIdSuffix, options?.settlement),
    layer: "ability",
    source: sourceRef,
    filter: targetFilter(target),
    effect: { ...effect, condition: options?.condition ?? targetCondition(target) } as unknown as ContinuousEffect
  };
  return { effect: spec, duration: { type: "permanent" } };
}

/** Arithmetic companion used to sum valued keywords such as Assault. */
export function buildKeywordArithmeticSpec(
  op: string,
  sourceRef: ObjectRef,
  target: OpsTarget,
  grant: KeywordGrant,
  effectIdSuffix: string,
  settlement = "settlement-0",
): { effect: ContinuousEffectSpec; duration: Duration } {
  if (grant.value === undefined) throw new TypeError("keyword arithmetic requires a value");
  const effect = {
    kind: "continuous.keyword",
    keyword: grant.id,
    amount: grant.value,
    condition: targetCondition(target),
  } as unknown as ContinuousEffect;
  return {
    effect: {
      id: effectId(op, sourceRef, target, effectIdSuffix, settlement),
      layer: "arithmetic",
      source: sourceRef,
      filter: targetFilter(target),
      effect,
    },
    duration: { type: "permanent" },
  };
}

/** Preserve an existing valued keyword, then add the newly granted value. */
export function normaliseKeywordGrants(target: OpsTarget, grants: readonly KeywordGrant[]): KeywordGrant[] {
  return grants.map(grant => {
    if (grant.value === undefined) return grant;
    const existing = target.snapshot.keywords.find(keyword => keyword.id === grant.id);
    if (existing === undefined) return grant;
    // An existing valued keyword must keep its current value in the ability
    // layer. The arithmetic companion adds the new grant; carrying the old
    // value here would make the post-arithmetic ability recheck overwrite the
    // sum. An unvalued keyword is promoted to its base value of one so the
    // arithmetic companion can then add the granted value.
    return existing.value === undefined ? { id: grant.id, value: 1 } : { id: grant.id };
  });
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
