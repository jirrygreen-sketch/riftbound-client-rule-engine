/**
 * Server-only bridge between the loaded catalog authority and the Core V2
 * source-closure seam.
 *
 * The bridge owns the catalog/match binding and the closure registry. It does
 * not manufacture Core facts: Core lookup, token provenance and the global
 * journal are injected by the trusted server runtime. A missing resolver is a
 * deliberate unknown/pending result, never an empty or no-effect answer.
 */
import {
  assembleDuelPhaseClosureEvidenceV2,
  createDuelPhaseClosureAuthorityV2,
  issueDuelPhaseClosureRequestV2,
  type DuelPhaseClosureAuthorityV2,
  type DuelPhaseClosureCoreRequestV2,
  type DuelPhaseClosureJournalResolutionV2,
  type DuelPhaseClosureProtectedResolversV2,
  type DuelPhaseClosureRegistryResolutionV2,
  type DuelPhaseClosureRequestLocatorV2,
  type DuelPhaseClosureTokenResolutionV2,
  type DuelPhaseClosureRequirementV2,
  type DuelPhaseClosureSourceLocalV2,
  type DuelPhaseClosureRequestV2,
  type DuelCanonicalPlayingStateV2,
  type DuelPhaseSourceClosureContextV2,
  type DuelPhaseSourceClosureInspectionV2,
  type DuelPhaseSourceClosureJournalV2,
  type DuelPhaseSourceClosureProgramIndexV2,
  type DuelPhaseSourceClosureProgramResultV2,
  type DuelPhaseSourceClosureRegistryV2,
  assertAdmittedDuelMatchV2,
  createDuelPhaseSourceClosureRegistryV2,
  inspectDuelPhaseSourceClosureV2,
} from "@riftbound/engine-core/duel";
import type {
  DuelSourceProgramPhaseScopeContext,
  DuelSourceProgramPhaseScopeResult,
} from "@riftbound/card-dsl/duel";
import type { CardProgramAuthority } from "./card-program-authority.js";

export interface DuelPhaseSourceBridgeResolversV2 {
  /** Reads the admitted Core source tuple for a locator on every call. */
  readonly resolveCore?: DuelPhaseClosureProtectedResolversV2["resolveCore"];
  /** Reads independently protected token birth/intrinsic evidence. */
  readonly resolveToken?: DuelPhaseClosureProtectedResolversV2["resolveToken"];
  /** Reads the global runtime/event journal for the exact request. */
  readonly resolveJournal?: DuelPhaseClosureProtectedResolversV2["resolveJournal"];
}

export interface DuelPhaseSourceBridgeErrorV2 extends Error {
  readonly name: "DuelPhaseSourceBridgeErrorV2";
}

class BridgeError extends Error implements DuelPhaseSourceBridgeErrorV2 {
  readonly name = "DuelPhaseSourceBridgeErrorV2" as const;
}

export interface DuelPhaseSourceServerBridgeV2 {
  readonly matchId: string;
  readonly catalogStamp: Readonly<{
    readonly dataVersion: string;
    readonly digest: string;
  }>;
  /** The opaque Core authority is useful only to other trusted server code. */
  readonly closureAuthority: DuelPhaseClosureAuthorityV2;
  readonly closureRegistry: DuelPhaseSourceClosureRegistryV2;
  /** Detached index copied from the genuine CardProgramAuthority. */
  readonly programIndex: DuelPhaseSourceClosureProgramIndexV2;
  resolvedProgramReference(cardId: string):
    | Readonly<{ readonly cardId: string; readonly programId: string; readonly encodedReference: string }>
    | undefined;
  sourceProgramPhaseScope(
    cardId: string,
    eventOrContext: string | DuelSourceProgramPhaseScopeContext,
  ): DuelSourceProgramPhaseScopeResult;
  /** A fresh Core locator request. The locator has no authority by itself. */
  issueClosureRequest(locator: DuelPhaseClosureRequestLocatorV2): DuelPhaseClosureRequestV2 | null;
  /** Assemble only from a request issued by this bridge's opaque authority. */
  assembleClosureEvidence(request: DuelPhaseClosureRequestV2): DuelPhaseSourceClosureProgramResultV2;
  /** Inspect the bound admitted match at a trusted boundary. */
  inspect(
    context: DuelPhaseSourceClosureContextV2,
    journal: DuelPhaseSourceClosureJournalV2 | undefined,
  ): DuelPhaseSourceClosureInspectionV2;
  /** Alias used by phase-gate callers. */
  phaseGate(
    context: DuelPhaseSourceClosureContextV2,
    journal: DuelPhaseSourceClosureJournalV2 | undefined,
  ): DuelPhaseSourceClosureInspectionV2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sameStamp(
  value: { readonly dataVersion: string; readonly digest: string },
  match: DuelCanonicalPlayingStateV2,
): boolean {
  return value.dataVersion === match.dataVersion && value.digest === match.catalogDigest;
}

function boundContext(
  value: unknown,
  match: DuelCanonicalPlayingStateV2,
): value is DuelPhaseSourceClosureContextV2 {
  if (!isRecord(value) || value.matchId !== match.matchId ||
      value.dataVersion !== match.dataVersion || value.catalogDigest !== match.catalogDigest ||
      value.clock === null || typeof value.clock !== "object" ||
      (value.clock as Record<string, unknown>).stateVersion !== match.stateVersion ||
      (value.clock as Record<string, unknown>).eventSeq !== match.eventSeq ||
      value.turn !== match.frame.turnNumber || !nonBlank(value.taskId) ||
      !value.taskId.includes(`turn-${match.frame.turnNumber}:`)) return false;
  return true;
}

function boundRequest(
  value: unknown,
  match: DuelCanonicalPlayingStateV2,
  locator: DuelPhaseClosureRequestLocatorV2,
): value is DuelPhaseClosureCoreRequestV2 {
  if (!isRecord(value) || !boundContext(value.context, match) ||
      !isRecord(value.source) || value.source.uid !== locator.uid ||
      value.context.matchId !== locator.matchId || value.context.taskId !== locator.taskId ||
      !nonBlank(value.expectedProgramReference)) return false;
  return true;
}

function missingCore(): null {
  return null;
}

function missingToken(): null {
  return null;
}

function missingJournal(): null {
  return null;
}

function phaseScopeContext(
  context: DuelPhaseSourceClosureContextV2,
): DuelSourceProgramPhaseScopeContext {
  // The Core closure vocabulary is intentionally the same reviewed 12-phase
  // vocabulary as card-dsl. Runtime-only event names are represented by the
  // phase field and are never passed as a DSL event.
  return {
    phase: context.phase as DuelSourceProgramPhaseScopeContext["phase"],
    mode: "runtime-subevents",
  };
}

function pendingInspection(reason: string): DuelPhaseSourceClosureInspectionV2 {
  return {
    status: "pending",
    candidates: [],
    sources: [],
    eventSources: [],
    activeSources: [],
    handlers: [],
    runtimeSources: [],
    reason,
  };
}

/**
 * Bind a real loaded server catalog to one admitted V2 match. No caller
 * supplied program index is accepted: every index entry comes from the
 * identity-guarded CardProgramAuthority.
 */
export function createDuelPhaseSourceServerBridgeV2(
  authority: CardProgramAuthority,
  match: DuelCanonicalPlayingStateV2,
  resolvers: DuelPhaseSourceBridgeResolversV2 = {},
): DuelPhaseSourceServerBridgeV2 {
  if (authority === null || typeof authority !== "object") {
    throw new BridgeError("a genuine CardProgramAuthority is required");
  }
  if (match === null || typeof match !== "object" || match.stage !== "playing") {
    throw new BridgeError("an admitted playing V2 match is required");
  }
  try {
    assertAdmittedDuelMatchV2(match);
  } catch {
    throw new BridgeError("an admitted playing V2 match is required");
  }
  let entries: readonly Readonly<{
    readonly cardId: string;
    readonly programId: string;
    readonly encodedReference: string;
  }>[];
  try {
    if (!sameStamp(authority.catalogStamp, match)) {
      throw new BridgeError("catalog and match stamps do not match");
    }
    entries = authority.resolvedProgramReferenceEntries().map((entry) => Object.freeze({
      cardId: entry.cardId,
      programId: entry.programId,
      encodedReference: entry.encodedReference,
    }));
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    throw new BridgeError("CardProgramAuthority identity is not genuine");
  }

  const byCardId = new Map(entries.map((entry) => [entry.cardId, entry]));
  const programIndex: DuelPhaseSourceClosureProgramIndexV2 = Object.freeze({
    matchId: match.matchId,
    dataVersion: match.dataVersion,
    catalogDigest: match.catalogDigest,
    printings: Object.freeze(entries.map((entry) => Object.freeze({
      cardId: entry.cardId,
      programReference: entry.encodedReference,
    }))),
  });

  const resolveCore: DuelPhaseClosureProtectedResolversV2["resolveCore"] =
    (locator) => {
      try {
        const resolved = resolvers.resolveCore === undefined
          ? missingCore()
          : resolvers.resolveCore(locator);
        return boundRequest(resolved, match, locator) ? resolved : null;
      } catch {
        return null;
      }
    };
  const resolveToken: DuelPhaseClosureProtectedResolversV2["resolveToken"] =
    (request) => {
      try {
        if (resolvers.resolveToken === undefined || !boundContext(request.context, match)) {
          return missingToken();
        }
        const resolved = resolvers.resolveToken(request);
        return isRecord(resolved) && boundContext(request.context, match)
          ? resolved as DuelPhaseClosureTokenResolutionV2
          : null;
      } catch {
        return null;
      }
    };
  const resolveJournal: DuelPhaseClosureProtectedResolversV2["resolveJournal"] =
    (request, requirements) => {
      try {
        if (resolvers.resolveJournal === undefined || !boundContext(request.context, match)) {
          return missingJournal();
        }
        const resolved = resolvers.resolveJournal(request, requirements);
        return isRecord(resolved) && boundContext(request.context, match)
          ? resolved as DuelPhaseClosureJournalResolutionV2
          : null;
      } catch {
        return null;
      }
    };
  const resolveRegistry: DuelPhaseClosureProtectedResolversV2["resolveRegistry"] =
    (request) => {
      try {
        if (!boundContext(request.context, match) || request.referenceKind !== "printing" ||
            request.source.cardId === null) return null;
        const entry = byCardId.get(request.source.cardId);
        if (entry === undefined || entry.encodedReference !== request.expectedProgramReference) return null;
        const sourceLocal = authority.sourceProgramPhaseScope(
          request.source.cardId,
          phaseScopeContext(request.context),
        );
        return {
          request,
          encodedProgramReference: entry.encodedReference,
          sourceLocal,
        } as DuelPhaseClosureRegistryResolutionV2;
      } catch {
        return null;
      }
    };

  const closureAuthority = createDuelPhaseClosureAuthorityV2({
    resolveCore,
    resolveRegistry,
    resolveToken,
    resolveJournal,
  });
  const closureRegistry = createDuelPhaseSourceClosureRegistryV2(
    programIndex,
    (request): DuelPhaseSourceClosureProgramResultV2 => {
      try {
        const issued = issueDuelPhaseClosureRequestV2(closureAuthority, {
          matchId: request.context.matchId,
          taskId: request.context.taskId,
          uid: request.source.uid,
        });
        if (issued === null) return { status: "unknown", reason: "unbound-core-request" };
        return assembleDuelPhaseClosureEvidenceV2({
          authority: closureAuthority,
          request: issued,
        });
      } catch {
        return { status: "unknown", reason: "closure-assembly-error" };
      }
    },
  );

  const bridge: DuelPhaseSourceServerBridgeV2 = {
    matchId: match.matchId,
    catalogStamp: Object.freeze({ dataVersion: match.dataVersion, digest: match.catalogDigest }),
    closureAuthority,
    closureRegistry,
    programIndex,
    resolvedProgramReference(cardId) {
      if (typeof cardId !== "string" || cardId.length === 0) return undefined;
      return byCardId.get(cardId);
    },
    sourceProgramPhaseScope(cardId, eventOrContext) {
      if (!byCardId.has(cardId)) {
        return authority.sourceProgramPhaseScope(cardId, eventOrContext);
      }
      return authority.sourceProgramPhaseScope(cardId, eventOrContext);
    },
    issueClosureRequest(locator) {
      try {
        if (locator.matchId !== match.matchId) return null;
        return issueDuelPhaseClosureRequestV2(closureAuthority, locator);
      } catch {
        return null;
      }
    },
    assembleClosureEvidence(request) {
      try {
        return assembleDuelPhaseClosureEvidenceV2({ authority: closureAuthority, request });
      } catch {
        return { status: "unknown", reason: "closure-assembly-error" };
      }
    },
    inspect(context, journal) {
      if (journal === undefined) return pendingInspection("missing-closure-journal");
      try {
        return inspectDuelPhaseSourceClosureV2(match, context, closureRegistry, journal);
      } catch {
        return pendingInspection("closure-inspection-error");
      }
    },
    phaseGate(context, journal) {
      return this.inspect(context, journal);
    },
  };
  return Object.freeze(bridge);
}

/** Stable aliases for server composition code that uses the shorter spelling. */
export const createDuelPhaseSourceBridgeV2 = createDuelPhaseSourceServerBridgeV2;
export const createServerDuelPhaseSourceBridgeV2 = createDuelPhaseSourceServerBridgeV2;

