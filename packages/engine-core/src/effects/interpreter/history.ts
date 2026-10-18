import type { Expr, GameAction, HistoryQuery, ObjectFilter, ObjectRef, ObjectSelector, ResolveContext } from "../contract.js";
import { isTimingPointId } from "../../events/timing-points.js";
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

/** Existing authored history subjects are event queries, never live set queries. */
export function historyExpressionCount(expr: Extract<Expr, { kind: "count" }>, environment: ExpressionContext): number | undefined {
  const filter = { ...expr.filter };
  let timingPoint: HistoryQuery["timingPoint"];
  let player: unknown;
  let object: ObjectRef | undefined;
  switch (expr.subject) {
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
  return historyCount({ scope: "turn", timingPoint, ...(player === undefined ? {} : { player }),
    ...(object === undefined ? {} : { object }), ...(exclude === undefined ? {} : { exclude }),
    ...(Object.keys(filter).length === 0 ? {} : { objectFilter: filter }) }, environment.context);
}
