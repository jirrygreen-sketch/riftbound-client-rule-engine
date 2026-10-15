/**
 * Server-owned V2 duel runtime facade.
 *
 * This module is the ONLY server adapter over the V2 capability chain:
 *
 * - it reuses the existing mechanical `buildDuelSetupSeats` adapter and never
 *   re-implements deck/domain/policy rules or allocates UIDs itself;
 * - it delegates the whole private match lifecycle to `createDuelCommandSessionV2`
 *   / `applyDuelResourceCommandV2` / `projectCanonicalDuelMatchV2` and the V2 turn
 *   executor; it NEVER downgrades the schema, never fabricates a Main frame, never
 *   copies board/resources, and never serializes the private session, receipts,
 *   required-task ledger or pending-payment actor to a client;
 * - it publishes no production provider: the trusted card-type resolver, the
 *   `DuelTurnServicesV2` (whole-program phase registry, lethal/fepr/burnout
 *   resolvers) and the `DuelSourceAttestorV2` MUST be injected by a server caller.
 *   Missing attestation availability disables the projected pay action; a missing
 *   attestor fails real pay closed. There is no built-in fixture, no-op provider or
 *   constant verified-no-effect registry here.
 *
 * The V2 session is an admitted, in-memory capability: a command returns an
 * immutable successor and never mutates its input; the projection now uses the
 * Core read-only resource inspector for its authoritative action list without
 * consuming RNG (mulligan is never inspected) or altering authoritative state. Production archive restore,
 * GameRoom wiring and the real phase services remain separate, unimplemented work.
 */
import {
  applyDuelResourceCommandV2,
  createDuelCommandSessionV2,
  inspectDuelResourceCommandV2,
  inspectDuelPendingPaymentV2,
  projectCanonicalDuelMatchV2,
  runDuelEndOfTurnV2,
  runDuelStartOfTurnV2,
  resumeDuelEndOfTurnV2,
  resumeDuelStartOfTurnV2,
  type DuelCommandResultV2,
  type DuelCommandSessionV2,
  type DuelSourceAttestorV2,
  type DuelTrustedCardTypeResolverV2,
  type DuelTurnResultV2,
  type DuelTurnServicesV2,
} from "@riftbound/engine-core/duel";
import {
  DUEL_PROJECTION_SCHEMA_V2,
  isDuelCommandMessage,
  isDuelProjectionV2,
  type DuelProjectionV2,
  type DuelWireAction,
  type DuelWireCommand,
  type DuelWireDomain,
  type DuelWireMatchV2,
  type ServerToClientMessage,
} from "@riftbound/protocol";
import type { CardCatalogRuntime } from "../card-catalog.js";
import type { DeckSubmission } from "../deck-validation.js";
import { buildDuelSetupSeats } from "./setup-seats.js";

/** Seat order and identity are supplied by the trusted room, never by a wire command. */
export type DuelRuntimeSeatV2 = {
  readonly playerId: string;
  readonly displayName: string;
  readonly deck: DeckSubmission;
};

/**
 * Trusted construction inputs. `trustedCardType` is required and MUST resolve a
 * card id against the trusted catalog (it is never inferred from a client slot).
 */
export interface DuelRuntimeSessionOptionsV2 {
  readonly randomIndex: (upperBound: number) => number;
  readonly uidFactory?: () => string;
  readonly trustedCardType: DuelTrustedCardTypeResolverV2;
}

/**
 * Validate both submitted decks through the actual setup adapter before allocating
 * UIDs or consuming setup shuffle RNG, then hand the seats to the V2 factory. The
 * V2 match stays an in-memory capability; no private zone data is emitted here.
 */
export function createDuelRuntimeSessionV2(
  catalog: CardCatalogRuntime,
  trustedRoster: readonly [DuelRuntimeSeatV2, DuelRuntimeSeatV2],
  matchId: string,
  options: DuelRuntimeSessionOptionsV2,
): DuelCommandSessionV2 {
  const setup = buildDuelSetupSeats(catalog, { matchId, seats: trustedRoster }, options.uidFactory);
  if (!setup.ok) throw new TypeError(`Duel V2 setup rejected: ${setup.code}`);
  return createDuelCommandSessionV2(
    setup.seats,
    setup.metadata,
    options.randomIndex,
    options.trustedCardType,
  );
}

const DOMAIN_LABEL: Readonly<Record<DuelWireDomain, string>> = {
  Fury: "炽烈",
  Calm: "翠意",
  Mind: "灵光",
  Body: "摧破",
  Chaos: "混沌",
  Order: "序理",
};

/**
 * The authoritative legal commands are checked by the Core V2 read-only resource
 * inspector. It reuses the resource kernels on detached values and never allocates a
 * successor, receipt, native commit or source attestation. Mulligan is never probed
 * (it would consume real shuffle RNG). Pay-pending instead uses its dedicated inspector:
 * probing a real pay would invoke a potentially one-use source attestor.
 */
function projectActionsV2(
  session: DuelCommandSessionV2,
  viewer: string | null,
  match: DuelWireMatchV2,
  options: DuelRuntimeProjectionOptionsV2,
): readonly DuelWireAction[] {
  if (viewer === null) return [];
  const actionId = (kind: DuelWireAction["kind"], source: string): string =>
    JSON.stringify([match.matchId, viewer, match.stateVersion, kind, source]);
  if (match.stage === "setup") {
    if (match.setup.stage !== "mulligan" || match.setup.currentMulliganOwner !== viewer) return [];
    const hand = match.setup.players.find((player) => player.playerId === viewer)?.hand;
    if (!hand) throw new TypeError("Duel V2 owner hand is unavailable");
    return [{
      id: actionId("mulligan", "hand"),
      kind: "mulligan",
      label: "选择重调手牌（最多 2 张）",
      enabled: true,
      selectableUIDs: hand.map((card) => card.uid),
      maxSelections: 2,
    }];
  }
  // The public V2 guard forbids any action at the constructor handoff and once ended.
  if (match.frame.phase === "awaiting-turn-start" || match.frame.phase === "ended") return [];

  const legal = (command: Extract<DuelWireCommand,
    { readonly type: "rune-energy" | "rune-power" | "gold-power" }>): boolean => {
    return inspectDuelResourceCommandV2(session, viewer, match.stateVersion, command).status === "legal";
  };

  const base = match.resources.bases.find((item) => item.playerId === viewer);
  if (!base) throw new TypeError("Duel V2 resource base is unavailable");
  const actions: DuelWireAction[] = [];
  for (const rune of base.baseRunes) {
    const energy = legal({ type: "rune-energy", uid: rune.uid });
    actions.push({
      id: actionId("rune-energy", rune.uid), kind: "rune-energy", uid: rune.uid,
      label: `横置${DOMAIN_LABEL[rune.domain]}符文：+1 能量`, enabled: energy,
      ...(!energy ? { reason: "当前不能横置该符文" } : {}),
    });
    const power = legal({ type: "rune-power", uid: rune.uid });
    actions.push({
      id: actionId("rune-power", rune.uid), kind: "rune-power", uid: rune.uid,
      label: `回收${DOMAIN_LABEL[rune.domain]}符文：+1 ${DOMAIN_LABEL[rune.domain]}符能`, enabled: power,
      ...(!power ? { reason: "当前不能回收该符文" } : {}),
    });
  }
  for (const gold of base.goldTokens) {
    const enabled = legal({ type: "gold-power", uid: gold.uid });
    actions.push({
      id: actionId("gold-power", gold.uid), kind: "gold-power", uid: gold.uid,
      label: "横置并消灭金币：+1 任意符能", enabled,
      ...(!enabled ? { reason: "当前不能消灭该金币" } : {}),
    });
  }
  // Cost/ID are already owner-only in the canonical public projection: only the payment
  // actor sees the payment ID, so only that viewer ever builds a pay-pending action.
  const payment = match.frame.pendingPayment;
  if (payment?.paymentId !== undefined) {
    const inspection = inspectDuelPendingPaymentV2(session, viewer, match.stateVersion,
      { type: "pay-pending", paymentId: payment.paymentId });
    // Availability is a trusted server configuration hint, not an attestation or
    // payment authority. Even an enabled action can fail on real re-attestation.
    const enabled = inspection.status === "requires-reattest" &&
      options.paymentAttestationAvailable === true;
    actions.push({
      id: actionId("pay-pending", payment.paymentId), kind: "pay-pending",
      paymentId: payment.paymentId, label: "支付待结算费用", enabled,
      ...(payment.resolvedCost ? { resolvedCost: payment.resolvedCost } : {}),
      ...(!enabled ? { reason: inspection.status === "blocked"
        ? "当前费用无法支付" : "支付来源验证暂不可用" } : {}),
    });
  }
  return actions;
}

/** Trusted server availability hint; never accepts or calls the source attestor. */
export interface DuelRuntimeProjectionOptionsV2 {
  readonly paymentAttestationAvailable?: boolean;
}

/**
 * Build the V2 public projection from the trusted V2 match. Hidden-zone filtering is
 * owned by the canonical V2 projector; the strict V2 public DTO guard fails closed.
 */
export function projectDuelRuntimeV2(
  session: DuelCommandSessionV2,
  viewer: string | null,
  options: DuelRuntimeProjectionOptionsV2 = {},
): DuelProjectionV2 {
  const match = projectCanonicalDuelMatchV2(session.match, viewer);
  const candidate = {
    projectionSchema: DUEL_PROJECTION_SCHEMA_V2,
    viewerPlayerId: viewer,
    match,
    actions: projectActionsV2(session, viewer, match, options),
  };
  if (!isDuelProjectionV2(candidate)) throw new TypeError("Duel V2 projection violates public protocol");
  return candidate;
}

function requestIdForInvalid(raw: unknown): string | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  // No getter invocation on invalid transport input. This is for correlation only.
  const descriptor = Object.getOwnPropertyDescriptor(raw, "requestId");
  const id = descriptor && "value" in descriptor ? descriptor.value : undefined;
  return typeof id === "string" && id.trim().length > 0 ? id : undefined;
}

const SAFE_REJECTION_MESSAGES: Readonly<Record<string, string>> = {
  "invalid-command": "Invalid duel command",
  "unknown-actor": "The authenticated duel actor is not seated",
  "command-conflict": "The command ID conflicts with an earlier request",
  "stale-version": "The duel state version is stale",
  "invalid-stage": "The duel command is not valid at this stage",
  "invalid-phase": "The duel command is not valid in this phase",
  "no-permission": "The authenticated actor cannot perform this command now",
  "mulligan-rejected": "The mulligan selection is not legal",
  "resource-rejected": "The resource action is not legal",
  "payment-rejected": "The pending payment is not legal",
  "version-overflow": "The duel state version cannot advance",
};

function safeRejectionMessage(reason: string): string {
  return SAFE_REJECTION_MESSAGES[reason] ?? "The duel command was rejected";
}

export interface DuelRuntimeExecutionResultV2 {
  readonly session: DuelCommandSessionV2;
  readonly persistRequired: boolean;
  /** Server-private; NEVER send this or spread it into `outbound`. */
  readonly internalResult: DuelCommandResultV2 | null;
  readonly outbound: ServerToClientMessage;
}

/**
 * Strictly parse the public wire packet, apply it through the V2 command session and
 * construct only a safe ACK/error for the wire. The full private result (receipts,
 * ledger, pending payment, payment-completed sidecar) stays in the return value.
 * `persistRequired` retains its V2 semantics: the room must persist the returned
 * session before sending `outbound`, including a sticky semantic rejection.
 */
export function executeDuelRuntimeCommandV2(
  session: DuelCommandSessionV2,
  authenticatedActor: string,
  message: unknown,
  options?: {
    readonly randomIndex?: (upperBound: number) => number;
    readonly sourceAttestor?: DuelSourceAttestorV2;
  },
): DuelRuntimeExecutionResultV2 {
  if (!isDuelCommandMessage(message)) {
    const requestId = requestIdForInvalid(message);
    return {
      session, persistRequired: false, internalResult: null,
      outbound: {
        type: "error",
        ...(requestId === undefined ? {} : { requestId }),
        code: "command-rejected",
        message: "Invalid duel command",
      },
    };
  }
  const result = applyDuelResourceCommandV2(
    session,
    authenticatedActor,
    { commandId: message.commandId, expectedVersion: message.expectedVersion, command: message.command },
    options,
  );
  const outbound: ServerToClientMessage = result.outcome.status === "applied"
    ? {
        type: "request-result", requestId: message.requestId, ok: true,
        commandId: message.commandId, appliedVersion: result.outcome.appliedVersion,
        eventSeq: result.outcome.eventSeq, duplicate: result.duplicate,
      }
    : {
        type: "error", requestId: message.requestId, code: "command-rejected",
        message: safeRejectionMessage(result.outcome.reason),
      };
  return { session: result.session, persistRequired: result.persistRequired, internalResult: result, outbound };
}

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
