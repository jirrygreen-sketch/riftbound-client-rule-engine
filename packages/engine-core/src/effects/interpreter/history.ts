import type { GameAction, HistoryQuery, ObjectFilter, ObjectRef, ObjectSelector, ResolveContext } from "../contract.js";
import { isTimingPointId } from "../../events/timing-points.js";
import { asValue, integer, record, string } from "./values.js";

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

export function historyCount(value: unknown, context: ResolveContext): number {
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
    ...(input.player === undefined ? {} : { player: string(input.player, "History player") }),
    ...(input.object === undefined ? {} : { object: objectRef(input.object) }),
    ...(input.exclude === undefined ? {} : { exclude: objectSelector(input.exclude) }),
    ...(input.objectFilter === undefined ? {} : { objectFilter: asValue(record(input.objectFilter, "History object filter")) as ObjectFilter })
  };
  return integer(context.history(query), "History count");
}
