import type { HistoryQuery, ObjectFilter, ObjectSnapshot, ResolveContext } from "../../contract.js";
import { bindResolveContext } from "../../../events/action-adapter.js";
import type { EventPipeline } from "../../../events/pipeline.js";
import { readHistoryQuery } from "../history.js";
import { resolveObjectSelector } from "../selectors.js";
import { equalValues, MissingInformation } from "../values.js";

const list = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [value];
const FILTER_KEYS = new Set([
  "objectId", "zoneEntryId", "cardId", "canonicalCardId", "type", "types", "controller", "owner",
  "zone", "location", "states", "state", "tags", "characteristics", "isToken"
]);

function eventPlayer(event: { readonly timingPoint: string; readonly player?: string; readonly object?: ObjectSnapshot }): string | undefined {
  // A discard is performed by the player whose Hand card moves to their Trash
  // (CR 423.1). The action adapter's event.player records the effect controller,
  // which can differ when an effect discards an opponent's card. The immutable
  // action-time object snapshot identifies the actual discarder and survives a
  // later zone change such as Recycle.
  return event.timingPoint === "card-discarded" ? event.object?.controller : event.player;
}

function matches(filter: ObjectFilter, object: ObjectSnapshot, controller: string): boolean {
  const playerMatches = (expected: unknown, actual: string): boolean =>
    expected === undefined || expected === "any" ||
    (["controller", "self", "you"].includes(String(expected)) ? actual === controller :
      expected === "opponent" ? actual !== controller : expected === actual);
  if (filter.objectId !== undefined && filter.objectId !== object.ref.id ||
    filter.zoneEntryId !== undefined && filter.zoneEntryId !== object.ref.zoneEntryId ||
    filter.isToken !== undefined && filter.isToken !== object.isToken) return false;
  const cardId = filter.cardId ?? filter.canonicalCardId;
  if (cardId !== undefined && cardId !== object.cardId) return false;
  const types = filter.type ?? filter.types;
  if (types !== undefined && !list(types).some(type => type === "object" ||
    type === "card" && object.cardId !== null || type === "token" && object.isToken || object.types.includes(String(type)))) return false;
  if (!playerMatches(filter.controller, object.controller) || !playerMatches(filter.owner, object.owner)) return false;
  if (filter.zone !== undefined && !list(filter.zone).some(zone => zone === object.zone ||
    zone === "discard" && object.zone === "trash" || zone === "banish" && object.zone === "banishment")) return false;
  if (filter.location !== undefined && !equalValues(filter.location, object.location) && filter.location !== object.location?.type) return false;
  const states = filter.states ?? filter.state;
  if (states !== undefined && !list(states).every(state => state === "ready" ? !object.exhausted :
    state === "exhausted" ? object.exhausted : state === "stunned" ? object.stunned :
      state === "attached" ? object.attachedTo !== null : state === "face-down" ? object.faceDown : false)) return false;
  if (filter.tags !== undefined && !list(filter.tags).every(tag => object.tags.includes(String(tag)))) return false;
  if (filter.characteristics !== undefined) {
    const characteristics = filter.characteristics;
    if (characteristics === null || typeof characteristics !== "object" || Array.isArray(characteristics)) {
      throw new MissingInformation("Invalid historical characteristics filter");
    }
    for (const [key, expected] of Object.entries(characteristics)) {
      if (!Object.hasOwn(object, key)) throw new MissingInformation(`Unavailable historical characteristic: ${key}`);
      const actual = object[key as keyof ObjectSnapshot];
      if (!equalValues(expected, actual as import("../../contract.js").Value)) return false;
    }
  }
  return true;
}

/**
 * Read timing histories from the live authoritative event log, including its
 * transaction rollback. Action-only queries retain the host's action journal.
 * The caller must supply the complete log; no counts are cached or reconstructed
 * from the objects currently present. Controller-relative filters use the
 * resolving context's captured controller, never a source's later controller.
 */
export function bindEventHistory(context: ResolveContext, pipeline: Pick<EventPipeline, "events">): ResolveContext {
  return bindResolveContext(context, {
    history(input: HistoryQuery) {
      const query = readHistoryQuery(input, context);
      if (query.timingPoint === undefined || query.action !== undefined) return context.history(query);
      if (query.player !== undefined) context.player(query.player);
      if (query.objectFilter && Object.keys(query.objectFilter).some(key => !FILTER_KEYS.has(key))) {
        throw new MissingInformation("Unsupported historical object filter");
      }
      const excluded = new Set(query.exclude === undefined ? [] : resolveObjectSelector(query.exclude, {
        context, linked: id => context.linked(id)
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
        if (event.timingPoint !== query.timingPoint || query.player !== undefined && eventPlayer(event) !== query.player) return false;
        const object = event.object;
        if (query.object && (object?.ref.id !== query.object.id || object.ref.zoneEntryId !== query.object.zoneEntryId)) return false;
        if (object && excluded.has(object.ref.id)) return false;
        return query.objectFilter === undefined || object !== undefined && matches(query.objectFilter, object, context.controller);
      }).length;
    }
  });
}
