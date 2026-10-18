/**
 * Recycle the current members of selected zones except an already captured
 * collection. This is the closed complement consumer for raw "Recycle the
 * rest" IR. It only reads the current visible/queryable set and never calls
 * look or reveal, so private information is not widened by the primitive.
 *
 * `keptKey` names a linked ObjectRef/list/result record. Membership is by the
 * exact zone incarnation (`id` plus `zoneEntryId`); a card that left and
 * returned is a new object and is no longer excluded by the stale receipt.
 * Each selected zone may restrict object types. Recycling itself remains the
 * closed GameAction, so the kernel routes every card to its owner's Main or
 * Rune Deck and replacement/prevention results remain authoritative.
 */
import type { Expr, Value } from "@riftbound/card-dsl";
import type {
  GameEvent,
  InstructionDef,
  InstructionResult,
  ObjectRef,
  ObjectSnapshot,
  ResolveContext,
  ZoneId
} from "../contract.js";

export interface RecycleRestZone {
  readonly zone: ZoneId;
  readonly types?: readonly string[];
  /** Descriptive compatibility with the raw Divine Judgment IR. */
  readonly toDeck?: "main" | "rune";
}

export interface RecycleRestArgs {
  readonly keptKey: Expr;
  readonly zones: Expr;
  readonly linkKey?: Expr;
}

const ZONES: readonly ZoneId[] = ["hand", "deck", "rune-deck", "trash", "banishment", "board", "rune-zone", "chain"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExpr(value: unknown): value is Expr {
  return isRecord(value) && typeof value.kind === "string";
}

function isValue(value: unknown, ancestors = new Set<unknown>()): value is Value {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!isRecord(value) && !Array.isArray(value) || ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Object.values(value).every(entry => isValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function isRef(value: unknown): value is ObjectRef {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0 &&
    typeof value.zoneEntryId === "number" && Number.isSafeInteger(value.zoneEntryId) && value.zoneEntryId >= 0;
}

function parseZones(value: unknown): RecycleRestZone[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("effect.recycle-rest zones must be a non-empty array");
  }
  return value.map(item => {
    if (!isRecord(item) || !ZONES.includes(item.zone as ZoneId)) {
      throw new TypeError("effect.recycle-rest zones contain an invalid zone");
    }
    if (item.types !== undefined &&
      (!Array.isArray(item.types) || !item.types.every(type => typeof type === "string" && type.length > 0))) {
      throw new TypeError("effect.recycle-rest zone types must be non-empty strings");
    }
    if (item.toDeck !== undefined && item.toDeck !== "main" && item.toDeck !== "rune") {
      throw new TypeError("effect.recycle-rest toDeck must be main or rune");
    }
    return {
      zone: item.zone as ZoneId,
      ...(item.types === undefined ? {} : { types: [...item.types as string[]] }),
      ...(item.toDeck === undefined ? {} : { toDeck: item.toDeck })
    };
  });
}

function parseArgs(value: unknown): RecycleRestArgs {
  if (!isRecord(value)) throw new TypeError("effect.recycle-rest args must be an object");
  if (!Object.keys(value).every(key => key === "keptKey" || key === "zones" || key === "linkKey")) {
    throw new TypeError("Invalid effect.recycle-rest argument");
  }
  const parse = (key: "keptKey" | "zones" | "linkKey", expression: unknown): Expr => {
    if (isExpr(expression)) return expression;
    if (isValue(expression) && (key !== "zones" || Array.isArray(expression))) {
      return { kind: "constant", value: expression };
    }
    throw new TypeError(`Invalid effect.recycle-rest ${key} Expr argument`);
  };
  if (value.keptKey === undefined || value.zones === undefined) {
    throw new TypeError("effect.recycle-rest requires keptKey and zones");
  }
  const keptKey = parse("keptKey", value.keptKey);
  const zones = parse("zones", value.zones);
  if (zones.kind === "constant" || zones.kind === "literal") parseZones(zones.value);
  return {
    keptKey,
    zones,
    ...(value.linkKey === undefined ? {} : { linkKey: parse("linkKey", value.linkKey) })
  };
}

function linkedRefs(value: Value | undefined): ObjectRef[] | null {
  if (Array.isArray(value)) return value.every(isRef) ? value : null;
  if (isRef(value)) return [value];
  if (isRecord(value) && Array.isArray(value.objects)) return value.objects.every(isRef) ? value.objects : null;
  return null;
}

function refKey(ref: ObjectRef): string {
  return `${ref.id}:${ref.zoneEntryId}`;
}

function matchesZone(snapshot: ObjectSnapshot, zone: RecycleRestZone): boolean {
  return snapshot.zone === zone.zone &&
    (zone.types === undefined || zone.types.some(type =>
      type === "card" ? !snapshot.isToken && snapshot.cardId !== null : snapshot.types.includes(type)));
}

function refValue(ref: ObjectRef): Value {
  return { id: ref.id, zoneEntryId: ref.zoneEntryId };
}

export default {
  op: "effect.recycle-rest",
  argsSchema: { parse: parseArgs },
  execute(ctx: ResolveContext, args: RecycleRestArgs): InstructionResult {
    const keptKey = ctx.evaluate(args.keptKey);
    if (typeof keptKey !== "string" || keptKey.length === 0) {
      throw new TypeError("effect.recycle-rest keptKey must evaluate to a nonempty string");
    }
    const linkKeyValue = args.linkKey === undefined ? "recycledRest" : ctx.evaluate(args.linkKey);
    if (typeof linkKeyValue !== "string" || linkKeyValue.length === 0) {
      throw new TypeError("effect.recycle-rest linkKey must evaluate to a nonempty string");
    }
    const zones = parseZones(ctx.evaluate(args.zones));
    const keptValue = ctx.linked(keptKey);
    const keptRefs = linkedRefs(keptValue);
    if (keptRefs === null) {
      return { status: "ignored", reason: "mistargeted" };
    }
    const kept = new Set(keptRefs.map(refKey));
    const seen = new Set<string>();
    const candidates: ObjectSnapshot[] = [];
    for (const zone of zones) {
      for (const snapshot of ctx.query({ zone: zone.zone })) {
        if (!matchesZone(snapshot, zone) || kept.has(refKey(snapshot.ref)) || seen.has(refKey(snapshot.ref))) continue;
        seen.add(refKey(snapshot.ref));
        candidates.push(snapshot);
      }
    }
    const events: GameEvent[] = [];
    const recycled: ObjectRef[] = [];
    let failure: "replaced" | "skipped" | "impossible" | undefined;
    for (const snapshot of candidates) {
      const outcome = ctx.perform({ type: "recycle", object: snapshot.ref });
      events.push(...outcome.events);
      if (outcome.status === "done") recycled.push({ ...snapshot.ref });
      else failure ??= outcome.status === "replaced" ? "replaced" :
        outcome.status === "prevented" ? "skipped" : "impossible";
    }
    const refs = recycled.map(refValue);
    ctx.link(linkKeyValue, refs);
    ctx.link(`${linkKeyValue}Count`, recycled.length);
    if (failure) return { status: "negated", reason: failure, events };
    return {
      status: "executed",
      events,
      linkedValues: { [linkKeyValue]: refs, [`${linkKeyValue}Count`]: recycled.length }
    };
  }
} satisfies InstructionDef<RecycleRestArgs>;
