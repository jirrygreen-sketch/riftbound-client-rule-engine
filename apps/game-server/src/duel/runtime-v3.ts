/**
 * Server-owned V3 permanent facade over the audited V2 capability chain.
 *
 * This module is a THIN mechanical adapter. It deliberately does NOT re-implement
 * any rule, permission or command:
 *
 * - session creation reuses `createDuelRuntimeSessionV2` (trusted deck/catalog
 *   validation, UID allocation and constructor RNG stay in the V2/setup path);
 * - the published match is the genuine, independent `projectCanonicalDuelMatchV3`
 *   (schemaVersion 3) run on the live admitted V2 authority with the authenticated
 *   viewer. Gear and Legend are therefore read from the trusted permanent carriers,
 *   NEVER assembled from a V2 wire DTO;
 * - the five existing legal actions are reused verbatim from the existing
 *   viewer-bound V2 action projection over the SAME session/authority; the V2 wire
 *   match it builds is discarded. No CardPlay/Move/Combat action is added and no
 *   action/permission is redefined here;
 * - the five existing commands are forwarded unchanged to
 *   `executeDuelRuntimeCommandV2`; turn progression is forwarded unchanged to the
 *   V2 turn wrappers.
 *
 * No production provider is published: like the V2 facade, a caller MUST inject the
 * trusted card-type resolver, the whole-program turn services and the source
 * attestor. Missing attestation availability only disables the projected pay action;
 * a real pay without a source attestor fails closed. There is no built-in fixture,
 * no-op provider or constant verified-no-effect registry here.
 *
 * The V2 session stays an in-memory capability and this facade is not wired into
 * GameRoom/server/store: production archive restore and lifecycle integration remain
 * separate, unimplemented work.
 */
import {
  projectCanonicalDuelMatchV3,
  type DuelCommandSessionV2,
  type DuelSourceAttestorV2,
  type DuelTurnResultV2,
  type DuelTurnServicesV2,
} from "@riftbound/engine-core/duel";
import {
  DUEL_PROJECTION_SCHEMA_V3,
  isDuelProjectionV3,
  type DuelProjectionV3,
} from "@riftbound/protocol";
import type { CardCatalogRuntime } from "../card-catalog.js";
import {
  createDuelRuntimeSessionV2,
  endDuelRuntimeTurnV2,
  executeDuelRuntimeCommandV2,
  projectDuelRuntimeV2,
  resumeDuelRuntimeEndV2,
  resumeDuelRuntimeTurnV2,
  startDuelRuntimeTurnV2,
  type DuelRuntimeExecutionResultV2,
  type DuelRuntimeProjectionOptionsV2,
  type DuelRuntimeSeatV2,
  type DuelRuntimeSessionOptionsV2,
} from "./runtime-v2.js";

/** Seat order and identity are supplied by the trusted room, never by a wire command. */
export type DuelRuntimeSeatV3 = DuelRuntimeSeatV2;

/** Trusted construction inputs; identical to V2 (trusted catalog card-type resolver required). */
export type DuelRuntimeSessionOptionsV3 = DuelRuntimeSessionOptionsV2;

/** Trusted server availability hint; never accepts or calls the source attestor. */
export type DuelRuntimeProjectionOptionsV3 = DuelRuntimeProjectionOptionsV2;

/** The V3 session is the same admitted in-memory V2 capability; V3 only changes the wire match. */
export type DuelRuntimeSessionV3 = DuelCommandSessionV2;

/** Server-private result shape; only `outbound` is safe for the wire. */
export type DuelRuntimeExecutionResultV3 = DuelRuntimeExecutionResultV2;

/** Trusted execution inputs; identical to V2 (random source / optional live source attestor). */
export interface DuelRuntimeCommandOptionsV3 {
  readonly randomIndex?: (upperBound: number) => number;
  readonly sourceAttestor?: DuelSourceAttestorV2;
}

/**
 * Reuse the V2 session factory verbatim: both trusted decks are validated through the
 * real setup adapter before any UID/RNG use, then the real V2 factory is called. No V3
 * lifecycle, cloning or schema downgrade is introduced here.
 */
export function createDuelRuntimeSessionV3(
  catalog: CardCatalogRuntime,
  trustedRoster: readonly [DuelRuntimeSeatV3, DuelRuntimeSeatV3],
  matchId: string,
  options: DuelRuntimeSessionOptionsV3,
): DuelRuntimeSessionV3 {
  return createDuelRuntimeSessionV2(catalog, trustedRoster, matchId, options);
}

/**
 * Build the exact `riftbound-duel-v3` (schemaVersion 3) projection.
 *
 * The authenticated `viewer` is passed directly into the genuine V3 projector; an
 * unadmitted/V1/cloned/forged authority is rejected there before any field is read
 * (the V3 projector asserts membership first). Legal actions are then taken from the
 * existing V2 action projection over the SAME session and viewer, so the five
 * existing actions stay bound to the same authority and hidden zones. The strict V3
 * public guard is run on the same-viewer DTO before it is returned.
 */
export function projectDuelRuntimeV3(
  session: DuelRuntimeSessionV3,
  viewer: string | null,
  options: DuelRuntimeProjectionOptionsV3 = {},
): DuelProjectionV3 {
  const match = projectCanonicalDuelMatchV3(session.match, viewer);
  // Discard the V2 wire match: only the viewer-bound five-action computation is reused.
  const actions = projectDuelRuntimeV2(session, viewer, options).actions;
  const candidate = {
    projectionSchema: DUEL_PROJECTION_SCHEMA_V3,
    viewerPlayerId: viewer,
    match,
    actions,
  };
  if (!isDuelProjectionV3(candidate)) throw new TypeError("Duel V3 projection violates public protocol");
  return candidate;
}

/**
 * Forward the five existing commands unchanged to the V2 command executor. The full
 * private result stays in the return value; only the constructed ACK/error is safe for
 * the wire. `persistRequired` keeps its V2 semantics.
 */
export function executeDuelRuntimeCommandV3(
  session: DuelRuntimeSessionV3,
  authenticatedActor: string,
  message: unknown,
  options?: DuelRuntimeCommandOptionsV3,
): DuelRuntimeExecutionResultV3 {
  return executeDuelRuntimeCommandV2(session, authenticatedActor, message, options);
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
