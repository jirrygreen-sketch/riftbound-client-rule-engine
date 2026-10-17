import type { ResolveContext } from "../../contract.js";
import { bindResolveContext } from "../../../events/action-adapter.js";
import type { EventPipeline } from "../../../events/pipeline.js";

/**
 * Supply the existing game-wide turn-start HistoryQuery from the authoritative
 * pipeline. Its live log includes the current turn and follows transaction
 * rollback. Other history queries remain the host's responsibility.
 * The pipeline must contain the complete game history (including the first
 * turn-start); a context with only a retained tail cannot supply turn counts.
 */
export function bindTurnHistory(context: ResolveContext, pipeline: Pick<EventPipeline, "events">): ResolveContext {
  return bindResolveContext(context, {
    history(query) {
      if (query.scope !== "game" || query.timingPoint !== "turn-start" || query.action !== undefined ||
        query.object !== undefined || query.objectFilter !== undefined || query.exclude !== undefined) {
        return context.history(query);
      }
      if (query.player !== undefined) context.player(query.player);
      return pipeline.events.filter(event => event.timingPoint === "turn-start" &&
        (query.player === undefined || event.player === query.player)).length;
    }
  });
}
