import {
  runDuelEndOfTurnV2,
  runDuelStartOfTurnV2,
  resumeDuelEndOfTurnV2,
  resumeDuelStartOfTurnV2,
  type DuelCommandSessionV2,
  type DuelTurnResultV2,
  type DuelTurnServicesV2,
} from "@riftbound/engine-core/duel";
import type { DuelRuntimeSessionV3 } from "./session.js";

/**
 * Forward the trusted V2 turn executor. `services` is required: a caller must inject
 * the real whole-program registry and resolvers; this facade never supplies a no-op
 * provider and never reaches a Main/Ending result without them. The private turn
 * result (session + pending task identity) is returned as-is.
 */
export function startDuelRuntimeTurnV2(
  session: DuelCommandSessionV2,
  services: DuelTurnServicesV2,
): DuelTurnResultV2 {
  return runDuelStartOfTurnV2(session, services);
}

export function resumeDuelRuntimeTurnV2(
  session: DuelCommandSessionV2,
  taskId: string,
  resolution: unknown,
  services: DuelTurnServicesV2,
): DuelTurnResultV2 {
  return resumeDuelStartOfTurnV2(session, taskId, resolution, services);
}

export function endDuelRuntimeTurnV2(
  session: DuelCommandSessionV2,
  actor: string,
  services: DuelTurnServicesV2,
): DuelTurnResultV2 {
  return runDuelEndOfTurnV2(session, actor, services);
}

export function resumeDuelRuntimeEndV2(
  session: DuelCommandSessionV2,
  taskId: string,
  resolution: unknown,
  services: DuelTurnServicesV2,
): DuelTurnResultV2 {
  return resumeDuelEndOfTurnV2(session, taskId, resolution, services);
}

/** Forward turn progression unchanged to the V2 turn wrappers (no V3 turn semantics). */
export function startDuelRuntimeTurnV3(
  session: DuelRuntimeSessionV3,
  services: DuelTurnServicesV2,
): DuelTurnResultV2 {
  return startDuelRuntimeTurnV2(session, services);
}

export function resumeDuelRuntimeTurnV3(
  session: DuelRuntimeSessionV3,
  taskId: string,
  resolution: unknown,
  services: DuelTurnServicesV2,
): DuelTurnResultV2 {
  return resumeDuelRuntimeTurnV2(session, taskId, resolution, services);
}

export function endDuelRuntimeTurnV3(
  session: DuelRuntimeSessionV3,
  actor: string,
  services: DuelTurnServicesV2,
): DuelTurnResultV2 {
  return endDuelRuntimeTurnV2(session, actor, services);
}

export function resumeDuelRuntimeEndV3(
  session: DuelRuntimeSessionV3,
  taskId: string,
  resolution: unknown,
  services: DuelTurnServicesV2,
): DuelTurnResultV2 {
  return resumeDuelRuntimeEndV2(session, taskId, resolution, services);
}
