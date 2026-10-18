import type {
  Expr,
  GameEvent,
  InstructionDef,
  InstructionResult,
  ObjectRef,
  ResolveContext,
  Value
} from "../contract.js";
import type {
  LegendCandidate,
  LegendContext,
  LegendZoneContext
} from "../../game/legend-zone.js";

/**
 * Creates an additional Legend in the Legend Zone (CR v1.5 107.4.d.1 and
 * 440.2.b.4).  `from` normally evaluates to the deckbuilding binding
 * `"deckbuilding:additional-legends"`; a host may also provide a concrete
 * candidate array for deterministic tests and replay adapters.
 *
 * The frozen primitive contract predates a Legend Zone action.  Consequently
 * this instruction only writes through the optional `LegendZoneContext` port.
 * A context without that port is rejected with a stable blocked reason; it
 * never places a Legend on the Chain or silently treats it as a token.
 */
export interface CreateLegendArgs {
  readonly from: Expr;
  readonly count?: Expr;
  readonly to?: Expr;
  readonly duration?: Expr;
  readonly choiceId?: Expr;
  readonly owner?: Expr;
  readonly linkKey?: Expr;
}

const DURATIONS = new Set(["permanent", "while-source-in-zone"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValue(value: unknown, active = new Set<object>()): value is Value {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || active.has(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null &&
    !Array.isArray(value)) return false;
  active.add(value);
  const valid = Object.values(value).every(item => isValue(item, active));
  active.delete(value);
  return valid;
}

function isExpr(value: unknown): value is Expr {
  if (!isRecord(value) || !isValue(value)) return false;
  switch (value.kind) {
    case "constant":
    case "literal":
      return Object.hasOwn(value, "value");
    case "object-property":
    case "object-attribute":
      return isRecord(value.object) || value.object === "self" || value.object === "source";
    case "linked":
    case "linked-value":
      return isId(value.instructionId) && (value.key === undefined || isId(value.key));
    case "count":
      return isId(value.subject);
    case "arithmetic":
      return Array.isArray(value.operands) && value.operands.length > 0 && value.operands.every(isExpr);
    default:
      return false;
  }
}

function parseArgs(value: unknown): CreateLegendArgs {
  if (!isRecord(value) || !isExpr(value.from)) {
    throw new TypeError("effect.create-legend requires a from Expr");
  }
  const keys = new Set(["from", "count", "to", "duration", "choiceId", "owner", "linkKey"]);
  for (const [key, expression] of Object.entries(value)) {
    if (!keys.has(key) || !isExpr(expression)) {
      throw new TypeError(`Invalid effect.create-legend argument: ${key}`);
    }
  }
  return value as unknown as CreateLegendArgs;
}

function isObjectRef(value: unknown): value is ObjectRef {
  return isRecord(value) && isId(value.id) && typeof value.zoneEntryId === "number" &&
    Number.isSafeInteger(value.zoneEntryId) && value.zoneEntryId >= 0;
}

function candidate(value: unknown): LegendCandidate | null {
  if (!isRecord(value) || !isId(value.cardId) || !isId(value.name)) return null;
  const cardType = value.cardType;
  if (cardType !== undefined && typeof cardType !== "string") return null;
  const types = value.types;
  if (types !== undefined && (!Array.isArray(types) || types.some(item => typeof item !== "string"))) return null;
  const tags = value.tags;
  if (tags !== undefined && (!Array.isArray(tags) || tags.some(item => typeof item !== "string"))) return null;
  const energy = value.energy;
  const might = value.might;
  if (energy !== undefined && energy !== null && (typeof energy !== "number" || !Number.isSafeInteger(energy))) return null;
  if (might !== undefined && might !== null && (typeof might !== "number" || !Number.isSafeInteger(might))) return null;
  if (value.power !== undefined && value.power !== null &&
    (!Array.isArray(value.power) || value.power.some(item => typeof item !== "string"))) return null;
  return {
    cardId: value.cardId,
    ...(value.id === undefined ? {} : { id: String(value.id) }),
    ...(value.canonicalCardId === undefined ? {} : { canonicalCardId: String(value.canonicalCardId) }),
    name: value.name,
    ...(cardType === undefined ? {} : { cardType }),
    ...(types === undefined ? {} : { types }),
    ...(tags === undefined ? {} : { tags }),
    ...(might === undefined ? {} : { might }),
    ...(energy === undefined ? {} : { energy }),
    ...(value.power === undefined ? {} : { power: value.power })
  };
}

function candidatesFrom(ctx: LegendContext, value: Value): readonly LegendCandidate[] {
  if (value === "deckbuilding:additional-legends") {
    const result = ctx.additionalLegends?.(ctx.controller);
    return result === undefined ? [] : result;
  }
  if (typeof value === "string") {
    const linked = ctx.linked(value);
    if (linked !== undefined) return candidatesFrom(ctx, linked);
    return [];
  }
  if (!Array.isArray(value)) return [];
  const result: LegendCandidate[] = [];
  for (const item of value) {
    const parsed = candidate(item);
    if (parsed === null) return [];
    if (!result.some(existing => existing.cardId === parsed.cardId && existing.name === parsed.name)) {
      result.push(parsed);
    }
  }
  return result;
}

function sameCandidate(left: LegendCandidate, right: LegendCandidate): boolean {
  return left.cardId === right.cardId && left.name === right.name;
}

function combinations(candidates: readonly LegendCandidate[], count: number): readonly (readonly LegendCandidate[])[] {
  const result: LegendCandidate[][] = [];
  const current: LegendCandidate[] = [];
  const visit = (start: number): void => {
    if (current.length === count) {
      result.push([...current]);
      return;
    }
    const remaining = count - current.length;
    for (let index = start; index <= candidates.length - remaining; index++) {
      current.push(candidates[index]!);
      visit(index + 1);
      current.pop();
    }
  };
  visit(0);
  return result;
}

function receipt(amount: number, objects: readonly ObjectRef[], blockedReason?: string): Record<string, Value> {
  const references = objects.map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }));
  return {
    amount,
    objects: references,
    objectsComplete: amount === objects.length,
    zone: "legend-zone",
    ...(blockedReason === undefined ? {} : { blockedReason })
  };
}

function contextPort(ctx: ResolveContext): LegendZoneContext | null {
  const port = (ctx as LegendContext).legendZone;
  return port === undefined ? null : port;
}

function negated(
  ctx: ResolveContext,
  linkKey: string,
  objects: readonly ObjectRef[],
  reason: "replaced" | "impossible",
  events: readonly GameEvent[],
  blockedReason?: string
): InstructionResult {
  const linked = receipt(objects.length, objects, blockedReason);
  ctx.link(linkKey, linked);
  ctx.link(`${linkKey}.amount`, linked.amount as Value);
  ctx.link(`${linkKey}.objects`, linked.objects as Value);
  return { status: "negated", reason, events: [...events] };
}

export default {
  op: "effect.create-legend",
  argsSchema: { parse: parseArgs },
  execute(ctx: ResolveContext, args: CreateLegendArgs): InstructionResult {
    const linkKeyValue = args.linkKey === undefined ? "created" : ctx.evaluate(args.linkKey);
    if (!isId(linkKeyValue)) {
      return { status: "negated", reason: "impossible", events: [] };
    }
    const port = contextPort(ctx);
    if (port === null) {
      return negated(ctx, linkKeyValue, [], "impossible", [], "legend-zone-contract-required");
    }

    const destination = args.to === undefined ? "legend-zone" : ctx.evaluate(args.to);
    if (destination !== "legend-zone") {
      return negated(ctx, linkKeyValue, [], "impossible", [], "legend-zone-destination-required");
    }

    const durationValue = args.duration === undefined ? "permanent" : ctx.evaluate(args.duration);
    if (typeof durationValue !== "string" || !DURATIONS.has(durationValue)) {
      return negated(ctx, linkKeyValue, [], "impossible", [], "legend-duration-unsupported");
    }
    const duration = durationValue as "permanent" | "while-source-in-zone";
    if (duration === "while-source-in-zone" && ctx.source.zone !== "board") {
      return negated(ctx, linkKeyValue, [], "impossible", [], "legend-source-not-on-board");
    }

    const countValue = args.count === undefined ? 1 : ctx.evaluate(args.count);
    if (typeof countValue !== "number" || !Number.isSafeInteger(countValue) || countValue < 0) {
      return negated(ctx, linkKeyValue, [], "impossible", [], "legend-count-invalid");
    }
    if (countValue === 0) {
      const linked = receipt(0, []);
      ctx.link(linkKeyValue, linked);
      ctx.link(`${linkKeyValue}.amount`, 0);
      ctx.link(`${linkKeyValue}.objects`, []);
      return { status: "executed", events: [], linkedValues: linked };
    }

    const candidates = candidatesFrom(ctx as LegendContext, ctx.evaluate(args.from));
    if (candidates.length < countValue || candidates.length === 0) {
      return negated(ctx, linkKeyValue, [], "impossible", [], "deckbuilding-legend-choice-unavailable");
    }
    const ownerValue = args.owner === undefined ? ctx.controller : ctx.evaluate(args.owner);
    if (!isId(ownerValue)) return negated(ctx, linkKeyValue, [], "impossible", [], "legend-owner-invalid");

    let selected: LegendCandidate[];
    if (countValue === 1) {
      if (candidates.length === 1 || args.choiceId === undefined) {
        if (candidates.length > 1 && args.choiceId === undefined) {
          return negated(ctx, linkKeyValue, [], "impossible", [], "legend-choice-required");
        }
        selected = [candidates[0]!];
      } else {
        const choiceId = ctx.evaluate(args.choiceId);
        if (!isId(choiceId)) return negated(ctx, linkKeyValue, [], "impossible", [], "legend-choice-id-invalid");
        const answer = ctx.choose<LegendCandidate>({
          id: choiceId,
          type: "mode",
          chooser: ctx.controller,
          visibility: "public",
          options: candidates
        });
        const picked = candidate(answer);
        if (picked === null || !candidates.some(option => sameCandidate(option, picked))) {
          return negated(ctx, linkKeyValue, [], "impossible", [], "legend-choice-invalid");
        }
        selected = [picked];
      }
    } else if (candidates.length === countValue && args.choiceId === undefined) {
      selected = [...candidates];
    } else {
      if (args.choiceId === undefined) {
        return negated(ctx, linkKeyValue, [], "impossible", [], "legend-choice-required");
      }
      const choiceId = ctx.evaluate(args.choiceId);
      if (!isId(choiceId)) return negated(ctx, linkKeyValue, [], "impossible", [], "legend-choice-id-invalid");
      const options = combinations(candidates, countValue);
      const answer = ctx.choose<readonly LegendCandidate[]>({
        id: choiceId,
        type: "mode",
        chooser: ctx.controller,
        visibility: "public",
        options
      });
      if (!Array.isArray(answer) || answer.length !== countValue ||
        new Set(answer.map(item => item.cardId + "\u0000" + item.name)).size !== countValue ||
        !answer.every(item => candidate(item) !== null && candidates.some(option => sameCandidate(option, item)))) {
        return negated(ctx, linkKeyValue, [], "impossible", [], "legend-choice-invalid");
      }
      selected = [...answer];
    }

    const created: ObjectRef[] = [];
    const events: GameEvent[] = [];
    for (const picked of selected) {
      const outcome = port.createLegend({
        candidate: picked,
        owner: ownerValue,
        controller: ctx.controller,
        source: ctx.source.ref,
        duration
      });
      events.push(...outcome.events);
      if (outcome.status !== "done" || !isObjectRef(outcome.result)) {
        for (const ref of created) port.removeLegend(ref);
        return negated(
          ctx,
          linkKeyValue,
          [],
          outcome.status === "replaced" ? "replaced" : "impossible",
          events,
          outcome.status === "replaced" ? "legend-creation-replaced" : "legend-creation-rejected"
        );
      }
      created.push({ id: outcome.result.id, zoneEntryId: outcome.result.zoneEntryId });
    }
    const linked = receipt(created.length, created);
    ctx.link(linkKeyValue, linked);
    ctx.link(`${linkKeyValue}.amount`, linked.amount as Value);
    ctx.link(`${linkKeyValue}.objects`, linked.objects as Value);
    return { status: "executed", events, linkedValues: linked };
  }
} satisfies InstructionDef<CreateLegendArgs>;

