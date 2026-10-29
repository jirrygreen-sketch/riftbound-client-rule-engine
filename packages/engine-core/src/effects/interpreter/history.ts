import type { Expr, GameAction, HistoryQuery, ObjectFilter, ObjectRef, ObjectSelector, ResolveContext } from "../contract.js";
import { isTimingPointId } from "../../events/timing-points.js";
import type { PipelineEvent } from "../../events/pipeline-types.js";
import { matchesObjectPredicates } from "../filters/predicates.js";
import { asValue, integer, MissingInformation, record, string } from "./values.js";
import type { ExpressionContext } from "./expr.js";
import { resolveObjectSelector } from "./selectors.js";

const actions = new Set<GameAction["type"]>([
  "draw", "mill", "shuffle", "order-top", "discard", "recycle", "banish", "return-to-hand",
  "move-zone", "move-location", "ready", "exhaust", "stun", "kill", "attach", "detach",
  "take-control", "damage", "heal", "channel-rune", "gain-energy", "gain-power", "pay",
  "gain-xp", "spend-xp", "buff", "spend-buff", "empower", "disempower", "add-counter",
  "remove-counter", "create-token", "copy", "play", "reveal", "look", "show-off", "counter", "score", "win"
]);

export function objectRef(value: unknown): ObjectRef {
  const input = record(value, "Object reference");
  return { id: string(input.id, "Object id"), zoneEntryId: integer(input.zoneEntryId, "Zone entry id") };
}

function objectSelector(value: unknown): ObjectSelector {
  if (value === "self" || value === "source") return value;
  const input = record(value, "History exclusion selector");
  const keys = Object.keys(input);
  const key = keys[0];
  if (keys.length !== 1 || (key !== "target" && key !== "pick" && key !== "linked")) {
    throw new Error("Unsupported history exclusion selector");
  }
  return { [key]: string(input[key], "History exclusion binding") } as ObjectSelector;
}

export function readHistoryQuery(value: unknown, context: ResolveContext): HistoryQuery {
  const input = record(value, "History query");
  const allowedKeys = new Set(["scope", "action", "timingPoint", "player", "object", "exclude", "objectFilter"]);
  if (Object.keys(input).some(key => !allowedKeys.has(key))) throw new Error("Unsupported history query field");
  const scope = input.scope ?? "turn";
  if (scope !== "turn" && scope !== "combat" && scope !== "game") throw new Error("Unsupported history scope");
  const action = input.action === undefined ? undefined : string(input.action, "History action");
  if (action !== undefined && !actions.has(action as GameAction["type"])) throw new Error(`Unsupported history action: ${action}`);
  const timingPoint = input.timingPoint;
  if (timingPoint !== undefined && (typeof timingPoint !== "string" || !isTimingPointId(timingPoint))) {
    throw new Error("Unsupported history timing point");
  }
  const query: HistoryQuery = {
    scope,
    ...(action === undefined ? {} : { action: action as GameAction["type"] }),
    ...(timingPoint === undefined ? {} : { timingPoint }),
    ...(input.player === undefined ? {} : { player: historyPlayer(input.player, context) }),
    ...(input.object === undefined ? {} : { object: objectRef(input.object) }),
    ...(input.exclude === undefined ? {} : { exclude: objectSelector(input.exclude) }),
    ...(input.objectFilter === undefined ? {} : { objectFilter: asValue(record(input.objectFilter, "History object filter")) as ObjectFilter })
  };
  return query;
}

function historyPlayer(value: unknown, context: ResolveContext): string {
  const player = string(value, "History player");
  return ["controller", "self", "you"].includes(player) ? context.controller : player;
}

export function historyCount(value: unknown, context: ResolveContext): number {
  return integer(context.history(readHistoryQuery(value, context)), "History count");
}

/**
 * Internal, non-serialized discriminator used only while mapping an authored
 * "card played/finalized this turn" count to the authoritative
 * chain-item-finalize event. CR 420.4.b distinguishes those events from an
 * ability sharing the same timing point through the published cardFinalize
 * payload bit.
 */
export const CARD_FINALIZE_HISTORY = Symbol("riftbound.card-finalize-history");
const AUTHORITATIVE_HISTORY = Symbol("riftbound.authoritative-history");

type EventHistoryQuery = HistoryQuery & { readonly [CARD_FINALIZE_HISTORY]?: true };

function eventPlayer(event: PipelineEvent): string | undefined {
  // The event snapshot identifies whose Hand card was discarded even when an
  // effect controlled by the other player caused it (CR 423.1).
  return event.timingPoint === "card-discarded" ? event.object?.controller : event.player;
}

function historyEventMatches(
  event: PipelineEvent,
  query: EventHistoryQuery,
  controller: string,
): boolean {
  if (event.timingPoint !== query.timingPoint) return false;
  if (query[CARD_FINALIZE_HISTORY] === true &&
      (event.timingPoint !== "chain-item-finalize" || event.details?.cardFinalize !== true)) return false;
  if (query.player !== undefined && eventPlayer(event) !== query.player) return false;
  const object = event.object;
  if (query.object !== undefined && (object === undefined ||
      object.ref.id !== query.object.id || object.ref.zoneEntryId !== query.object.zoneEntryId)) return false;
  if (query.objectFilter !== undefined) {
    // A Chain Finalize carries its card identity through the Pending item's
    // source snapshot even though the capsule event's object field represents
    // the play slot. Other event histories inspect their immutable object
    // snapshot directly and fail closed when it is absent.
    const candidate = object ?? (event.timingPoint === 'chain-item-finalize' ? event.source : undefined);
    if (candidate === undefined ||
        !matchesObjectPredicates(query.objectFilter, candidate, { controller, anchor: event.source ?? candidate })) return false;
  }
  return true;
}

/**
 * Bind event-history reads to the live authoritative EventPipeline. No count is
 * reconstructed from current objects. Action-only queries continue to use the
 * state owner's action journal because the pipeline event log does not retain
 * every action's journal receipt.
 */
export function bindAuthoritativeHistory(
  context: ResolveContext,
  pipeline: { readonly events: readonly PipelineEvent[] },
): ResolveContext {
  const eventHistory = (input: HistoryQuery) => {
    const query = input as EventHistoryQuery;
    if (query.timingPoint === undefined || query.action !== undefined) return context.history(input);
    const player = query.player !== undefined && ["controller", "self", "you"].includes(query.player)
      ? context.controller : query.player;
    const excluded = new Set(query.exclude === undefined ? [] :
      resolveObjectSelector(query.exclude, {
        context,
        linked: id => context.linked(id),
      }).map(ref => ref.id));
    const events = pipeline.events;
    let start = 0;
    if (query.scope !== "game") {
      for (let index = events.length - 1; index >= 0; index--) {
        if (events[index]!.timingPoint === "turn-start") { start = index; break; }
      }
      if (query.scope === "combat") {
        let combat: number | undefined;
        for (let index = events.length - 1; index >= start; index--) {
          if (events[index]!.timingPoint === "combat-start") { combat = index; break; }
        }
        if (combat === undefined) return 0;
        start = combat;
      }
    }
    return events.slice(start).filter(event => {
      if (!historyEventMatches(event, { ...query, ...(player === undefined ? {} : { player }) }, context.controller)) return false;
      return event.object === undefined || !excluded.has(event.object.ref.id);
    }).length;
  };
  return new Proxy(context, {
    get(target, key) {
      if (key === AUTHORITATIVE_HISTORY) return true;
      if (key === "history") return eventHistory;
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Existing authored history subjects are event queries, never live set queries. */
export function historyExpressionCount(expr: Extract<Expr, { kind: "count" }>, environment: ExpressionContext): number | undefined {
  const filter = { ...expr.filter };
  let timingPoint: HistoryQuery["timingPoint"];
  let player: unknown;
  let object: ObjectRef | undefined;
  switch (expr.subject) {
    case "cards-played-this-turn":
    case "cards-finalized-this-turn": {
      if ((environment.context as ResolveContext & { readonly [AUTHORITATIVE_HISTORY]?: true })[AUTHORITATIVE_HISTORY] !== true) {
        throw new MissingInformation(`Unavailable history subject: ${expr.subject}`);
      }
      timingPoint = "chain-item-finalize";
      player = filter.player ?? "controller";
      break;
    }
    case "cards-discarded-this-turn": timingPoint = "card-discarded"; player = filter.player ?? "controller"; break;
    case "cards-drawn-this-turn": timingPoint = "card-drawn"; player = filter.player ?? "controller"; break;
    case "controller-xp-gained-this-turn": timingPoint = "xp-gained"; player = filter.player ?? "controller"; break;
    case "units-died-this-turn": timingPoint = "object-killed"; filter.type ??= "unit"; break;
    case "friendly-unit-or-gear-died-this-turn":
      timingPoint = "object-killed";
      filter.type ??= ["unit", "gear"];
      filter.controller ??= "controller";
      break;
    case "moves-this-turn":
    case "self-moves-this-turn": {
      timingPoint = "object-moved";
      const refs = resolveObjectSelector((filter.object ?? "self") as ObjectSelector, environment);
      if (refs.length !== 1) throw new MissingInformation("Movement history requires exactly one object");
      object = refs[0];
      delete filter.object;
      // These two spellings are metadata on the existing authored history IR.
      if (filter.action !== undefined && filter.action !== "move-location") throw new MissingInformation("Unsupported movement history action");
      if (filter.scope !== undefined && filter.scope !== "turn") throw new MissingInformation("Unsupported movement history scope");
      delete filter.action;
      delete filter.scope;
      break;
    }
    default:
      // Finalize history cannot be replaced by resolved plays: the current
      // chain-item-finalize event also includes abilities, without a card-kind
      // discriminator. Amount/receipt/phase histories likewise need contracts.
      if (/this-(turn|combat|event)|spent|cost-of|open-showdowns/.test(expr.subject)) {
        throw new MissingInformation(`Unavailable history subject: ${expr.subject}`);
      }
      return undefined;
  }
  if (filter.zone === "history-record") delete filter.zone;
  if (filter.player !== undefined) player = filter.player;
  const exclude = filter.exclude;
  delete filter.player;
  delete filter.exclude;
  for (const key of ["controller", "owner"] as const) {
    if (["controller", "self", "you"].includes(String(filter[key]))) filter[key] = environment.context.controller;
  }
  const query: EventHistoryQuery = { scope: "turn", timingPoint, ...(player === undefined ? {} : { player: player as string }),
    ...(object === undefined ? {} : { object }), ...(exclude === undefined ? {} : { exclude: exclude as ObjectSelector }),
    ...(Object.keys(filter).length === 0 ? {} : { objectFilter: filter }) };
  if (expr.subject === "cards-played-this-turn" || expr.subject === "cards-finalized-this-turn") {
    Object.defineProperty(query, CARD_FINALIZE_HISTORY, { value: true, enumerable: false });
  }
  return integer(environment.context.history(query), "History count");
}
