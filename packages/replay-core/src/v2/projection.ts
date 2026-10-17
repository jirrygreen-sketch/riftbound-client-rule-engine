import type { ProjectionV2 } from "../../../engine-core/dist/projection/v2/index.js";

/** Pipeline grouping keys may be authoritative hidden object IDs. */
export function publicReplayProjection(projection: ProjectionV2): ProjectionV2 {
  return {
    ...projection,
    events: projection.events.map(({ simultaneousGroup: _internalGroup, ...event }) => event),
  };
}
