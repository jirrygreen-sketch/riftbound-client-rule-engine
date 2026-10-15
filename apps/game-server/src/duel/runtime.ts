import {
  applyDuelResourceCommand,
  createDuelMatch,
  projectCanonicalDuelMatch,
  type DuelCommandResult,
  type DuelCommandSession,
} from "@riftbound/engine-core/duel";
import {
  DUEL_PROJECTION_SCHEMA,
  isDuelCommandMessage,
  isDuelProjection,
  type DuelProjection,
  type DuelWireAction,
  type DuelWireCommand,
  type ServerToClientMessage,
} from "@riftbound/protocol";
import type { CardCatalogRuntime } from "../card-catalog.js";
import type { DeckSubmission } from "../deck-validation.js";
import { buildDuelSetupSeats } from "./setup-seats.js";

/** Seat order and identity are supplied by the trusted room, never by a wire command. */
export type DuelRuntimeSeat = {
  readonly playerId: string;
  readonly displayName: string;
  readonly deck: DeckSubmission;
};

export interface DuelRuntimeExecutionResult {
  readonly session: DuelCommandSession;
  readonly persistRequired: boolean;
  /** Server-private; NEVER send this or spread it into `outbound`. */
  readonly internalResult: DuelCommandResult | null;
  readonly outbound: ServerToClientMessage;
}

/** Validate both submitted decks before allocating UIDs or consuming setup shuffle RNG. */
export function createDuelRuntimeSession(
  catalog: CardCatalogRuntime,
  trustedRoster: readonly [DuelRuntimeSeat, DuelRuntimeSeat],
  matchId: string,
  options: { readonly randomIndex: (upperBound: number) => number; readonly uidFactory?: () => string },
): DuelCommandSession {
  const setup = buildDuelSetupSeats(catalog, { matchId, seats: trustedRoster }, options.uidFactory);
  if (!setup.ok) throw new TypeError(`Duel setup rejected: ${setup.code}`);
  return { match: createDuelMatch(setup.seats, setup.metadata, options.randomIndex), receipts: [] };
}

const DOMAIN_LABEL = {
  Fury: "炽烈", Calm: "翠意", Mind: "灵光", Body: "摧破", Chaos: "混沌", Order: "序理",
} as const;

/** Only deterministic, non-shuffling resource/payment probes. Their result is discarded. */
function projectActions(
  session: DuelCommandSession,
  viewer: string | null,
  match: ReturnType<typeof projectCanonicalDuelMatch>,
): readonly DuelWireAction[] {
  if (viewer === null) return [];
  const actionId = (kind: DuelWireAction["kind"], source: string): string =>
    JSON.stringify([match.matchId, viewer, match.stateVersion, kind, source]);
  if (match.stage === "setup") {
    if (match.setup.stage !== "mulligan" || match.setup.currentMulliganOwner !== viewer) return [];
    const hand = match.setup.players.find(player => player.playerId === viewer)?.hand;
    if (!hand) throw new TypeError("Duel owner hand is unavailable");
    // No mulligan probe: replacing two cards would consume real RNG.
    return [{ id: actionId("mulligan", "hand"), kind: "mulligan", label: "选择重调手牌（最多 2 张）",
      enabled: true, selectableUIDs: hand.map(card => card.uid), maxSelections: 2 }];
  }
  if (match.frame.phase === "awaiting-turn-start" || match.frame.phase === "ended") return [];

  let ordinal = 0;
  const legal = (command: Exclude<DuelWireCommand, { readonly type: "mulligan" }>): boolean => {
    // A unique probe ID cannot hit an existing sticky receipt, even if a player deliberately
    // used our prefix. Core keeps the actual match + required-task ledger, and the temporary
    // session has a copied receipt array. Neither probe outcome nor receipt is installed.
    let commandId: string;
    do {
      commandId = JSON.stringify(["duel-projection-probe", match.matchId, viewer, match.stateVersion, ordinal++]);
    } while (session.receipts.some(receipt => receipt.commandId === commandId));
    // `commitDuelPlayingMutation` protects its input graph. Probe a detached match so that
    // projection cannot freeze or otherwise alter the authoritative session, while retaining
    // the trusted required-task ledger and receipt history that core uses for permission gates.
    const probeSession: DuelCommandSession = {
      ...session,
      match: structuredClone(session.match),
      receipts: [...session.receipts],
    };
    const probe = applyDuelResourceCommand(
      probeSession, viewer, { commandId, expectedVersion: match.stateVersion, command },
    );
    return probe.outcome.status === "applied";
  };
  const base = match.resources.bases.find(item => item.playerId === viewer);
  if (!base) throw new TypeError("Duel resource base is unavailable");
  const actions: DuelWireAction[] = [];
  for (const rune of base.baseRunes) {
    const energy = legal({ type: "rune-energy", uid: rune.uid });
    actions.push({ id: actionId("rune-energy", rune.uid), kind: "rune-energy", uid: rune.uid,
      label: `横置${DOMAIN_LABEL[rune.domain]}符文：+1 能量`, enabled: energy,
      ...(!energy ? { reason: "当前不能横置该符文" } : {}) });
    const power = legal({ type: "rune-power", uid: rune.uid });
    actions.push({ id: actionId("rune-power", rune.uid), kind: "rune-power", uid: rune.uid,
      label: `回收${DOMAIN_LABEL[rune.domain]}符文：+1 ${DOMAIN_LABEL[rune.domain]}符能`, enabled: power,
      ...(!power ? { reason: "当前不能回收该符文" } : {}) });
  }
  for (const gold of base.goldTokens) {
    const enabled = legal({ type: "gold-power", uid: gold.uid });
    actions.push({ id: actionId("gold-power", gold.uid), kind: "gold-power", uid: gold.uid,
      label: "横置并消灭金币：+1 任意符能", enabled,
      ...(!enabled ? { reason: "当前不能消灭该金币" } : {}) });
  }
  // Cost/ID are already owner-only in the canonical public projection. Never use the
  // private frame's sourceReference or let a client supply the trusted resolved cost.
  const payment = match.frame.pendingPayment;
  if (payment?.paymentId !== undefined) {
    const enabled = legal({ type: "pay-pending", paymentId: payment.paymentId });
    actions.push({ id: actionId("pay-pending", payment.paymentId), kind: "pay-pending",
      paymentId: payment.paymentId, label: "支付待结算费用", enabled,
      ...(payment.resolvedCost ? { resolvedCost: payment.resolvedCost } : {}),
      ...(!enabled ? { reason: "当前费用无法支付" } : {}) });
  }
  return actions;
}

/** The canonical projector owns hidden-zone filtering; the strict public DTO guard fails closed. */
export function projectDuelRuntime(session: DuelCommandSession, viewer: string | null): DuelProjection {
  const match = projectCanonicalDuelMatch(session.match, viewer);
  const candidate = { projectionSchema: DUEL_PROJECTION_SCHEMA, viewerPlayerId: viewer,
    match, actions: projectActions(session, viewer, match) };
  if (!isDuelProjection(candidate)) throw new TypeError("Duel projection violates public protocol");
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

/** Keep the entire private result in the return value; only the constructed ACK/error goes on the wire. */
export function executeDuelRuntimeCommand(
  session: DuelCommandSession,
  authenticatedActor: string,
  message: unknown,
  options?: { readonly randomIndex?: (upperBound: number) => number },
): DuelRuntimeExecutionResult {
  if (!isDuelCommandMessage(message)) {
    const requestId = requestIdForInvalid(message);
    return { session, persistRequired: false, internalResult: null,
      outbound: { type: "error", ...(requestId === undefined ? {} : { requestId }),
        code: "command-rejected", message: "Invalid duel command" } };
  }
  const result = applyDuelResourceCommand(session, authenticatedActor,
    { commandId: message.commandId, expectedVersion: message.expectedVersion, command: message.command },
    options);
  // The room must atomically persist result.session whenever persistRequired is true
  // BEFORE sending outbound, including a sticky semantic rejection (no clock advance).
  const outbound: ServerToClientMessage = result.outcome.status === "applied"
    ? { type: "request-result", requestId: message.requestId, ok: true,
        commandId: message.commandId, appliedVersion: result.outcome.appliedVersion,
        eventSeq: result.outcome.eventSeq, duplicate: result.duplicate }
    : { type: "error", requestId: message.requestId, code: "command-rejected",
        message: safeRejectionMessage(result.outcome.reason) };
  return { session: result.session, persistRequired: result.persistRequired,
    internalResult: result, outbound };
}
