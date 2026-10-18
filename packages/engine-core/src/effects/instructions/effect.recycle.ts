/**
 * effect.recycle — Recycle (回收): take one or more cards from a specific zone and
 * put them on the bottom of the corresponding deck (CR v1.5 rule 417).
 *
 * Rules anchors (CR v1.5):
 * - 417.1: cards move from a specific zone to the bottom of the corresponding deck;
 *   417.1.a Main Deck cards recycle to the Main Deck, 417.1.b Runes recycle to the
 *   Rune Deck (also 161.2.b, 178.1.a.2), 417.1.c cards recycle to their OWN deck,
 *   regardless of which player was instructed. The kernel decides the physical
 *   destination from the object's owner and types; this primitive never picks it.
 * - 417.4: when Recycling is part of an effect, the player recycles as many cards
 *   as possible from the specified zone(s) — a shortfall still resolves with the
 *   smaller count instead of failing.
 * - 417.6: "Recycle X from [Zone]" is a non-targeting choice made as the effect
 *   resolves; those cards are NOT targeted (modeled through args.from + choose).
 *   When the text instead names a specific object ("Recycle a unit from your
 *   trash", "recycle another friendly unit"), the object is a target and arrives
 *   through args.target (a TargetSpec id read via ctx.targets()).
 *
 * Boundaries vs. nearby primitives (zone, order, deck bottom):
 * - vs. effect.zone / move-zone: recycle is its own GameAction so that replacement
 *   effects, triggers ("When you recycle…") and history count it distinctly; the
 *   destination is always the BOTTOM of the owner's Main/Rune deck, never a zone
 *   chosen by arguments.
 * - vs. effect.order / order-top: this primitive performs one atomic
 *   `{ type: "recycle" }` action per card, in the listed order; the resulting
 *   deck-bottom order equals that order. CR 417.5 (2+ cards recycled to the Main
 *   Deck simultaneously land in a RANDOM order) and 417.5.a (Rune Deck: order of
 *   the owner's choosing) are simultaneous-action presentation concerns owned by
 *   the interpreter/kernel (shuffle / choose primitives); this primitive stays
 *   deterministic and never randomizes by itself (P0 3.6 primitive rule 1).
 *
 * Args:
 * - target?: TargetSpec id. The objects locked for that spec are recycled;
 *   every stale reference (object left its zone; old zoneEntryId) is dropped,
 *   and if NONE remain the instruction is `ignored` (P0 3.6 rule 2).
 * - objects?: Expr evaluating to one ObjectRef or an array of ObjectRefs — a
 *   non-targeting selection (picks, queries, linked values). Invalid refs are
 *   dropped like stale targets; zero surviving refs plus no from-selection is
 *   `ignored`.
 * - from?: { zone: ZoneId; owner?: "controller" | "source-owner" |
 *   "opponents" | "all"; amount: Expr }
 *   — the v1.5 417.6 form. Cards are filtered by zone (+ optional owner) via
 *   ctx.query, then the instructed player chooses `min(amount, available)`
 *   of them through a replayable `select-objects` ChoiceRequest
 *   (id `effect.recycle:<zone>:<owner|->:<amount>`). "Up to N" phrasing is
 *   expressed by lowering the amount expression, not by a separate flag.
 *
 * Outcome mapping (P0 3.6 rule 2): all performs done → executed and
 * `ctx.link("recycled", <actual ObjectRef[]>)` / `ctx.link("recycledCount", n)`
 * for "if you do" consumers; any replaced / prevented / impossible → negated;
 * every target invalid and nothing to recycle → ignored.
 */
import type { Expr, ObjectRef } from "@riftbound/card-dsl";
import type {
  GameEvent,
  InstructionDef,
  InstructionResult,
  ObjectSnapshot,
  PlayerId,
  ResolveContext,
  Schema,
  ZoneId
} from "../contract.js";

export interface RecycleFromArgs {
  /** Zone the cards are recycled from ("Recycle X from your trash"). */
  readonly zone: ZoneId;
  /** Owner filter; defaults to the ability controller ("Recycle N from YOUR trash"). */
  readonly owner?: "controller" | "source-owner" | "opponents" | "all";
  /** Requested count; evaluated at resolution time (417.4: shortfall recycles less). */
  readonly amount: Expr;
}

export interface RecycleArgs {
  /** TargetSpec id whose locked targets are recycled. */
  readonly target?: string;
  /** Expr evaluating to ObjectRef | ObjectRef[] — non-targeting object selection. */
  readonly objects?: Expr;
  /** Non-targeting "Recycle X from [Zone]" form (417.6). */
  readonly from?: RecycleFromArgs;
  /** Stable link key for the actual recycle receipt. */
  readonly linkKey?: Expr;
}

const ZONES: readonly ZoneId[] = [
  "hand",
  "deck",
  "rune-deck",
  "trash",
  "banishment",
  "board",
  "rune-zone",
  "chain"
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isExpr(value: unknown): value is Expr {
  return isRecord(value) && typeof value.kind === "string";
}

function isObjectRef(value: unknown): value is ObjectRef {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.zoneEntryId === "number" &&
    Number.isInteger(value.zoneEntryId)
  );
}

function parseArgs(value: unknown): RecycleArgs {
  if (!isRecord(value)) {
    throw new Error("effect.recycle args must be an object");
  }
  const args: {
    target?: string;
    objects?: Expr;
    from?: { zone: ZoneId; owner?: "controller" | "source-owner" | "opponents" | "all"; amount: Expr };
    linkKey?: Expr;
  } = {};
  if (value.target !== undefined) {
    if (typeof value.target !== "string" || value.target.length === 0) {
      throw new Error("effect.recycle target must be a non-empty TargetSpec id");
    }
    args.target = value.target;
  }
  if (value.objects !== undefined) {
    if (!isExpr(value.objects)) {
      throw new Error("effect.recycle objects must be a card-dsl Expr");
    }
    args.objects = value.objects;
  }
  if (value.from !== undefined) {
    if (!isRecord(value.from)) {
      throw new Error("effect.recycle from must be an object");
    }
    if (!ZONES.includes(value.from.zone as ZoneId)) {
      throw new Error(`effect.recycle from.zone must be one of ${ZONES.join(", ")}`);
    }
    if (value.from.owner !== undefined &&
      !["controller", "source-owner", "opponents", "all"].includes(String(value.from.owner))) {
      throw new Error('effect.recycle from.owner must be "controller", "source-owner", "opponents", or "all"');
    }
    if (!isExpr(value.from.amount)) {
      throw new Error("effect.recycle from.amount must be a card-dsl Expr");
    }
    args.from = {
      zone: value.from.zone as ZoneId,
      amount: value.from.amount,
      ...(value.from.owner === undefined ? {} : { owner: value.from.owner as RecycleFromArgs["owner"] })
    };
  }
  if (value.linkKey !== undefined) {
    if (!isExpr(value.linkKey)) throw new Error("effect.recycle linkKey must be a card-dsl Expr");
    args.linkKey = value.linkKey;
  }
  if (args.target === undefined && args.objects === undefined && args.from === undefined) {
    throw new Error("effect.recycle requires at least one of target, objects, or from");
  }
  return args;
}

const argsSchema: Schema<RecycleArgs> = { parse: parseArgs };

function dedupe(refs: readonly ObjectRef[]): ObjectRef[] {
  const seen = new Set<string>();
  const result: ObjectRef[] = [];
  for (const ref of refs) {
    const key = `${ref.id}:${ref.zoneEntryId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ id: ref.id, zoneEntryId: ref.zoneEntryId });
  }
  return result;
}

function flattenObjectRefs(value: unknown): ObjectRef[] {
  if (value === null || value === undefined) return [];
  if (isObjectRef(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(flattenObjectRefs);
  if (isRecord(value) && Array.isArray(value.objects)) return value.objects.flatMap(flattenObjectRefs);
  throw new Error("effect.recycle objects must evaluate to an ObjectRef or an array of ObjectRefs");
}

function requestAmount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("effect.recycle from.amount must evaluate to a finite number");
  }
  return Math.max(0, Math.floor(value));
}

/** Live (still valid) references among the candidates, in the given order. */
function liveObjects(ctx: ResolveContext, candidates: readonly ObjectRef[]): ObjectSnapshot[] {
  const live: ObjectSnapshot[] = [];
  for (const ref of dedupe(candidates)) {
    const snapshot = ctx.object(ref);
    if (snapshot !== null) live.push(snapshot);
  }
  return live;
}

function chooseFromZone(ctx: ResolveContext, from: RecycleFromArgs): ObjectRef[] {
  const requested = requestAmount(ctx.evaluate(from.amount));
  const owner: PlayerId = from.owner === "source-owner" ? ctx.source.owner : ctx.controller;
  const candidates = ctx.query({ zone: from.zone }).filter(object => {
    if (from.owner === "all") return true;
    if (from.owner === "opponents") return object.owner !== ctx.controller;
    return object.owner === owner;
  });
  const count = Math.min(requested, candidates.length); // 417.4: recycle as many as possible.
  if (count === 0) return [];
  const options = candidates.map((snapshot) => ({
    id: snapshot.ref.id,
    zoneEntryId: snapshot.ref.zoneEntryId
  }));
  const chosen = ctx.choose<ObjectRef[]>({
    id: `effect.recycle:${from.zone}:${from.owner ?? "controller"}:${requested}`,
    type: "select-objects",
    chooser: ctx.controller,
    visibility: "chooser-only",
    options,
    min: count,
    max: count
  });
  if (!Array.isArray(chosen)) {
    throw new Error("effect.recycle choice answer must be an array of ObjectRefs");
  }
  for (const ref of chosen) {
    if (!isObjectRef(ref)) {
      throw new Error("effect.recycle choice answer must be an array of ObjectRefs");
    }
  }
  if (chosen.length !== count) {
    throw new Error(`effect.recycle expected exactly ${count} chosen object(s), got ${chosen.length}`);
  }
  const allowed = new Set(options.map((ref) => `${ref.id}:${ref.zoneEntryId}`));
  const chosenKeys = chosen.map((ref) => `${ref.id}:${ref.zoneEntryId}`);
  if (chosenKeys.some((key) => !allowed.has(key)) || new Set(chosenKeys).size !== chosenKeys.length) {
    throw new Error("effect.recycle choice answer must pick distinct objects from the offered options");
  }
  return chosen.map((ref) => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }));
}

function execute(ctx: ResolveContext, args: RecycleArgs): InstructionResult {
  const targetRefs = args.target === undefined ? [] : ctx.targets(args.target);
  const objectRefs = args.objects === undefined ? [] : flattenObjectRefs(ctx.evaluate(args.objects));
  const chosenRefs = args.from === undefined ? [] : chooseFromZone(ctx, args.from);

  const candidates = [...targetRefs, ...objectRefs, ...chosenRefs];
  const live = liveObjects(ctx, candidates);
  if (candidates.length > 0 && live.length === 0) {
    return { status: "ignored", reason: "mistargeted" };
  }

  const events: GameEvent[] = [];
  const recycled: ObjectRef[] = [];
  let failure: "replaced" | "impossible" | undefined;
  for (const snapshot of live) {
    // 417.1.a/b: the kernel derives Main vs. Rune deck from the object's types.
    // 417.1.c: each object recycles to its OWNER's deck, whoever was instructed.
    const outcome = ctx.perform({ type: "recycle", object: snapshot.ref });
    events.push(...outcome.events);
    if (outcome.status !== "done") {
      failure ??= outcome.status === "replaced" ? "replaced" : "impossible";
      continue;
    }
    recycled.push(snapshot.ref);
  }

  const recycledRefs = recycled.map((ref) => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }));
  const linkKeyValue = args.linkKey === undefined ? "recycled" : ctx.evaluate(args.linkKey);
  if (typeof linkKeyValue !== "string" || linkKeyValue.length === 0) {
    throw new Error("effect.recycle linkKey must evaluate to a nonempty string");
  }
  ctx.link(linkKeyValue, recycledRefs);
  ctx.link(linkKeyValue + "Count", recycled.length);
  if (failure) return { status: "negated", reason: failure, events };
  return {
    status: "executed",
    events,
    linkedValues: { [linkKeyValue]: recycledRefs, [linkKeyValue + "Count"]: recycled.length }
  };
}

export default {
  op: "effect.recycle",
  argsSchema: { parse: parseArgs },
  execute
} satisfies InstructionDef<RecycleArgs>;
