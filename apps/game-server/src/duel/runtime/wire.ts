import {
  applyDuelResourceCommandV2,
  type DuelCommandResultV2,
  type DuelCommandSessionV2,
  type DuelSourceAttestorV2,
} from "@riftbound/engine-core/duel";
import { isDuelCommandMessage, type ServerToClientMessage } from "@riftbound/protocol";
import type { DuelRuntimeSessionV3 } from "./session.js";

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

/** Server-private result shape; only `outbound` is safe for the wire. */
export type DuelRuntimeExecutionResultV3 = DuelRuntimeExecutionResultV2;

/** Trusted execution inputs; identical to V2 (random source / optional live source attestor). */
export interface DuelRuntimeCommandOptionsV3 {
  readonly randomIndex?: (upperBound: number) => number;
  readonly sourceAttestor?: DuelSourceAttestorV2;
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
