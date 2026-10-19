import type { ConstructedRegionContext } from '@riftbound/protocol';
import { verifyConstructedRegion } from '../constructed-regional-context.js';
/**
 * The server-owned P4 owner.
 *
 * This is deliberately a capability owner, rather than another wire facade:
 * the V2 command session, Unit action capability, source registry, cost
 * resolver and closure journal never leave this module.  Public callers only
 * receive a viewer projection and a safe acknowledgement.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  applyDuelResourceCommandV2,
  bindDuelPrintedCost,
  advanceDuelCommandSessionNativeV2,
  advanceDuelUnitCommandSessionV2,
  startDuelEngagementV2, advanceDuelEngagementV2,
  createTrustedDuelBaseCombatFacts, planDuelBaseCombatDamage,
  type DuelEngagementStepV2,
  createDuelCommandSessionV2,
  createDuelCostResolverAuthorityV2,
  createDuelPhaseSourceClosureJournalV2,
  enumerateDuelPhaseSourceClosureCandidatesV2,
  fingerprintDuelCostCoverageV2,
  projectCanonicalDuelMatchV3,
  inspectDuelNativeCommitPathV2,
  type DuelMatchStateV2,
  type DuelCanonicalPlayingStateV2,
  type DuelCommandSessionV2,
  type DuelCostRequestV2,
  type DuelCostVerifiedSourcesV2,
  type DuelPhaseClosureRequirementV2,
  type DuelPhaseEventV2,
  type DuelPhaseSourceClosureContextV2,
  type DuelPhaseSourceClosureJournalInputV2,
  type DuelPhaseSourceClosureRuntimeEntryV2,
  type DuelPhaseSourceClosureCandidateV2,
  type DuelUnitPlaySessionV2,
  type DuelUnitTurnResultV2,
  type DuelUnitMoveResultV2,
  createDuelUnitPlaySessionV2,
  applyDuelUnitResourceCommandV2,
  beginDuelOptionalUnitPaymentV3,
  resumeDuelOptionalUnitPaymentV3,
  commitDuelChoiceOpeningEventV2,
  inspectDuelOptionalUnitPaymentV3,
  createDuelOptionalPlayChoiceAuthorityV1,
  type DuelOptionalPlayChoiceAuthorityV1,
  type DuelOptionalPlayPromptV1,
  type DuelOptionalPlayReceiptV1,
  type DuelOptionalPlayReceiptDataV1,
  type DuelUnitEntryServiceV2,
  createDuelSpellCardPlaySessionV2,
  playDuelSpellCardV2,
  applyDuelSpellResourceCommandV2,
  passDuelSpellPriorityV2,
  resolveDuelSpellCardPlayV2,
  resumeDuelSpellEffectV2,
  resumeDuelSpellPaymentV2,
  finalizeDuelSpellCardPlayV2,
  inspectDuelSpellPrivateStateV2,
  playDuelNoAbilityUnitToBaseV2,
  applyDuelUnitStandardMoveV2,
  startDuelUnitTurnV2,
  endDuelUnitTurnV2,
  resumeDuelUnitTurnV2,
  resumeDuelUnitStandardMoveV2,
  type DuelTurnServicesV2,
  type DuelUnitPlayServicesV2,
  type DuelUnitEntryRequestV2,
  type DuelSpellCardPlaySessionV2,
  type DuelSpellCardPlayResultV2,
  type DuelSourceAttestationRequestV2,
  type DuelSourceBindingV2,
  type DuelSpellCommittedEffectV2,
  createDuelPrintedUnitChainSessionV4,
  beginDuelPrintedUnitPhysicalChainV4,
  answerDuelPrintedUnitPhysicalChainV4,
  applyDuelPrintedUnitPhysicalChainResourceV4,
  resumeDuelPrintedUnitPhysicalChainV4,
  inspectDuelPrintedUnitPhysicalChainV4,
  type DuelPrintedUnitChainSessionV4,
  type DuelPrintedUnitChainResultV4,
  type DuelOptionalPlayPromptV2,
} from "@riftbound/engine-core/duel";
import {
  DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
  DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1,
  isDuelCommandMessageV3Actions1,
  isDuelProjectionV3Actions1,
  type DuelCommandMessageV3Actions1,
  type DuelProjectionV3Actions1,
  type DuelActionV3Actions1,
  type DuelWireCommandV3Actions1,
} from "@riftbound/protocol";
import type { CardCatalogRuntime } from "../card-catalog.js";
import type { DeckSubmission } from "../deck-validation.js";
import { createCardProgramAuthority, createDuelFuryOptionalRosterCardProgramAuthorityV1,
  getCardProgramRegistryForRuntime, type CardProgramAuthority } from "./card-program-authority.js";
import { createCatalogCardTypeResolverV2 } from "./catalog-card-type-v2.js";
import {
  createDuelProductionSourceServicesV2,
  type DuelProductionSourceServicesV2,
  type DuelProductionSourceServicesOptionsV2,
  type DuelProtectedGlobalSourceSnapshotV2,
} from "./production-source-services-v2.js";
import { buildDuelSetupSeats } from "./setup-seats.js";
import { projectDuelRuntimeV3 } from "./runtime/projection.js";
import { createDuelNativeOperationJournalV2, type DuelNativeOperationJournalV2,
  type DuelNativeObservedCommitV2 } from "./operation-journal-v2.js";
import { createDuelEngagementServicesV2 } from "./engagement-services-v2.js";
import { ContinuousEffectRegistry } from "../../../../packages/engine-core/dist/layers/duration.js";
import { createP4SpellServices, type P4SpellServices } from "./p4-spell-services.js";
import { createP4OptionalUnitServices, createDuelOptionalUnitProgramReader } from "./optional-unit-services-p4.js";
import { createOptionalUnitPaymentEntryV3 } from "./optional-unit-payment-entry-v3.js";
import { projectOptionalUnitChoiceP6 } from "./optional-unit-choice-projection-p6.js";
import { inspectDuelNativeOperationJournalBindingV2 } from "./operation-journal-v2.js";
import { createDuelPrintedUnitChainServicesP8, type DuelPrintedUnitChainServicesP8 } from "./printed-unit-chain-services-p8.js";

export type DuelAuthoritativeRuntimeSeatP4 = {
  readonly playerId: string;
  readonly displayName: string;
  readonly deck: DeckSubmission;
};

/**
 * Server-owned execution profiles.  The legacy profile is intentionally
 * narrower than the current profile: its owner never exposes or dispatches
 * Spell actions, which keeps old command journals on their original Unit/
 * turn semantics.  A client packet cannot select this value.
 */
export const DUEL_RUNTIME_PROFILE_P4_LEGACY = "legacy-unit-v1" as const;
export const DUEL_RUNTIME_PROFILE_P4_SPELL = "spell-v1" as const;
export const DUEL_RUNTIME_PROFILE_P4_PUBLIC_CHAIN = "public-chain-v1" as const;
export const DUEL_RUNTIME_PROFILE_P4_REGIONAL = "regional-public-chain-v1" as const;
/** Explicit profile for the complete Fury roster and optional Unit payment.
 * Historical profiles retain their original registry and archive semantics. */
export const DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT = "optional-unit-payment-v3" as const;
export const DUEL_RUNTIME_SEMANTIC_VERSION_P4_OPTIONAL_UNIT = "riftbound-p4-optional-unit-payment-v3" as const;
/** New server-owned profile: opening an optional Unit choice is a canonical
 * state update. Historical optional-unit-payment-v3 retains its original
 * no-clock opening semantics for byte-compatible replay. */
export const DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK = "optional-unit-choice-clock-v4" as const;
export const DUEL_RUNTIME_SEMANTIC_VERSION_P4_OPTIONAL_UNIT_CLOCK = "riftbound-p4-optional-unit-choice-clock-v4" as const;
export const DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN = "optional-unit-physical-chain-v4" as const;
export const DUEL_RUNTIME_SEMANTIC_VERSION_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN = "riftbound-p4-optional-unit-physical-chain-v4" as const;
/** Resolved pre-exit history is admitted only by this explicit version. */
export const DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY = "optional-unit-resolved-history-v5" as const;
export const DUEL_RUNTIME_SEMANTIC_VERSION_P4_OPTIONAL_UNIT_RESOLVED_HISTORY = "riftbound-p4-optional-unit-resolved-history-v5" as const;
export const DUEL_RUNTIME_SEMANTIC_VERSION_P4_REGIONAL = "riftbound-p4-regional-public-chain-v1" as const;
export const DUEL_RUNTIME_SEMANTIC_VERSION_P4 = "riftbound-p4-spell-v1" as const;
export const DUEL_RUNTIME_SEMANTIC_VERSION_P4_PUBLIC_CHAIN = "riftbound-p4-public-chain-v1" as const;
export type DuelRuntimeProfileP4 = typeof DUEL_RUNTIME_PROFILE_P4_LEGACY | typeof DUEL_RUNTIME_PROFILE_P4_SPELL | typeof DUEL_RUNTIME_PROFILE_P4_PUBLIC_CHAIN | typeof DUEL_RUNTIME_PROFILE_P4_REGIONAL | typeof DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT | typeof DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK | typeof DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN | typeof DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY;

/** Compatibility names used by replay callers; the values remain server-owned. */
export const DUEL_REPLAY_PROFILE_P4_LEGACY = DUEL_RUNTIME_PROFILE_P4_LEGACY;
export const DUEL_REPLAY_PROFILE_P4_SPELL = DUEL_RUNTIME_PROFILE_P4_SPELL;
export const DUEL_REPLAY_PROFILE_P4_PUBLIC_CHAIN = DUEL_RUNTIME_PROFILE_P4_PUBLIC_CHAIN;

export interface DuelAuthoritativeRuntimeP4Options {
  readonly catalog: CardCatalogRuntime;
  /** Trusted room roster. This is never read from a P4 command packet. */
  readonly roster: readonly [DuelAuthoritativeRuntimeSeatP4, DuelAuthoritativeRuntimeSeatP4];
  readonly matchId: string;
  readonly randomIndex: (upperBound: number) => number;
  readonly uidFactory?: () => string;
  /** Selected by the trusted room/archive owner. Defaults to the public Chain profile. */
  readonly runtimeProfile?: DuelRuntimeProfileP4;
  /** Trusted room selection pinned by schema 5; absent from historical profiles. */
  readonly constructedRegion?: ConstructedRegionContext;
  /** Optional private test/fault adapter; production uses its owned native journal. */
  readonly globalJournal?: DuelProductionSourceServicesOptionsV2["globalJournal"];
  /** Server-owned effects consumed by the real engagement lethal lifecycle. */
  readonly continuousEffects?: ContinuousEffectRegistry;
}

export interface DuelAuthoritativeRuntimeP4Ack {
  readonly type: "request-result" | "error" | "blocked";
  readonly requestId?: string;
  readonly commandId?: string;
  readonly ok?: true;
  readonly appliedVersion?: number;
  readonly eventSeq?: number;
  readonly duplicate?: boolean;
  readonly code?: string;
  readonly message: string;
  readonly pending?: true;
}

export interface DuelAuthoritativeRuntimeP4Result {
  readonly ack: DuelAuthoritativeRuntimeP4Ack;
  readonly projection: DuelProjectionV3Actions1;
}

export interface DuelAuthoritativeRuntimeP4 {
  /** Viewer-bound P4 DTO. It contains no private session or source proof. */
  readonly project: (viewer: string | null) => DuelProjectionV3Actions1;
  /** The only command entry point. Actor identity is an independent argument. */
  readonly dispatch: (actor: string, packet: unknown) => DuelAuthoritativeRuntimeP4Result;
  /** Resume a currently pending trusted turn/move operation. */
  readonly resumePending: () => DuelAuthoritativeRuntimeP4Result | null;
  /** Explicitly in-memory; no archive/restart claim is made by this owner. */
  readonly durability: "in-memory";
}

type RuntimeCommand = Extract<DuelWireCommandV3Actions1, { type: string }>;
type LedgerValue = { readonly fingerprint: string; readonly ack: DuelAuthoritativeRuntimeP4Ack };
const privateFingerprints = new WeakMap<object, () => string>();

/** Private storage/replay evidence only. Returns a digest, never a session or
 * hidden state, and refuses copied owner objects. A digest cannot restore authority. */
export function fingerprintDuelAuthoritativeRuntimePrivateP4(owner: DuelAuthoritativeRuntimeP4): string {
  const read = privateFingerprints.get(owner);
  if (!read) throw new TypeError("unadmitted P4 owner");
  return read();
}

const REQUIREMENTS: readonly DuelPhaseClosureRequirementV2[] = [
  "all-source-candidate-closure", "hidden-zone-event-subjects", "continuous-effect-registry",
  "cleanup-queue-and-replacements", "runtime-subevent-journal", "recursive-conquer-event-journal",
  "draw-subject-journal", "pre-exit-event-journal", "kill-trigger-effect-cases", "zone-transition-journal",
];

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function safeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
function cardKey(source: DuelPhaseSourceClosureCandidateV2): string {
  return stable([source.carrier, source.uid, source.zoneEpoch, source.zone.kind,
    "locationId" in source.zone ? source.zone.locationId : source.zone.zonePlayerId]);
}
function commandFingerprint(packet: DuelCommandMessageV3Actions1): string {
  return stable({ commandId: packet.commandId, expectedVersion: packet.expectedVersion, command: packet.command });
}
function requestId(raw: unknown): string | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(raw, "requestId");
  return descriptor && "value" in descriptor && text(descriptor.value) ? descriptor.value : undefined;
}
function genericError(packet: unknown, message: string, code = "command-rejected"): DuelAuthoritativeRuntimeP4Ack {
  const id = requestId(packet);
  return { type: "error", ...(id ? { requestId: id } : {}), code, message };
}
function blocked(packet: DuelCommandMessageV3Actions1, message: string): DuelAuthoritativeRuntimeP4Ack {
  return { type: "blocked", requestId: packet.requestId, commandId: packet.commandId,
    pending: true, message };
}
function keyFor(actor: string, commandId: string): string { return `${actor}\u0000${commandId}`; }
function phaseFor(step: string): DuelPhaseEventV2 {
  if (step === "hold" || step === "hold-effects") return "hold";
  if (step === "channel" || step === "channel-effects") return "channel";
  if (step === "draw" || step === "draw-effects") return "draw";
  if (step.startsWith("burnout")) return "burnout";
  if (step === "main" || step === "main-effects") return "main";
  if (step === "ending") return "ending";
  if (step.endsWith("-lethal")) return "lethal-kill";
  if (step.endsWith("-fepr")) return "fepr";
  if (step.endsWith("-expiration")) return "expiration";
  return step === "awaken" || step === "begin" ? step : "required-cleanup";
}
function contextFor(match: DuelCanonicalPlayingStateV2, event: DuelPhaseEventV2, taskId: string): DuelPhaseSourceClosureContextV2 {
  return { matchId: match.matchId, dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
    turn: match.frame.turnNumber, taskId, phase: event, event,
    clock: { stateVersion: match.stateVersion, eventSeq: match.eventSeq } };
}

// Global closure comes only from the separately owned journal; no empty proof is synthesized.

function makeCostAuthority(
  catalog: CardCatalogRuntime,
  source: DuelProductionSourceServicesV2,
  head: () => DuelCanonicalPlayingStateV2 | null,
) {
  const cardById = new Map(catalog.publicCatalog.cards.map(card => [card.id, card]));
  const snapshotFor = (request: DuelCostRequestV2) => {
    const match = head();
    if (!match) throw new TypeError("stale head");
    let tuple: unknown;
    try { tuple = JSON.parse(request.transactionId); } catch { throw new TypeError("invalid cost transaction"); }
    if (!Array.isArray(tuple) || tuple.length !== 7 || tuple[0] !== match.matchId ||
        tuple[1] !== match.stateVersion || typeof tuple[2] !== "string" || typeof tuple[3] !== "string" ||
        tuple[4] === undefined || tuple[5] === undefined || typeof tuple[6] !== "string")
      throw new TypeError("unbound cost transaction");
    const uid = tuple[4] as string;
    const context = contextFor(match, "main", `duel-v2:${match.matchId}:turn-${match.frame.turnNumber}:unit-entry:${uid}`);
    const inspection = source.inspect(context);
    if (inspection.status !== "ready" || inspection.handlers.length > 0 || inspection.activeSources.length > 0)
      throw new TypeError("unresolved cost source closure");
    const candidates = inspection.candidates;
    const subject = candidates.find(item => item.uid === uid && item.cardId === request.subjectId);
    if (!subject || subject.zoneEpoch === null) throw new TypeError("cost subject is not current");
    const card = cardById.get(request.subjectId);
    if (!card) throw new TypeError("unknown printed cost");
    const binding = source.costBinding({ matchId: match.matchId, stateVersion: match.stateVersion,
      actor: tuple[2] as string, uid, cardId: request.subjectId, sourceEpoch: subject.zoneEpoch,
      baseLocationId: tuple[6] as string, transactionId: request.transactionId,
      baseProofId: "base", coverageProofId: "coverage" });
    if (binding.status !== "complete") throw new TypeError("unresolved printed cost census");
    const printed = bindDuelPrintedCost(card);
    if (printed.kind !== "numeric" || card.cardType !== "Unit") throw new TypeError("unsupported printed cost");
    const base = printed.cost;
    const candidatesForCost = candidates.map(item => {
      if (item.zoneEpoch === null) throw new TypeError("unbound cost source epoch");
      return { sourceUid: item.uid, sourceEpoch: item.zoneEpoch, choice: "not-applicable" as const, modifierIds: [] as readonly string[] };
    });
    const verified: DuelCostVerifiedSourcesV2 = {
      registryRevision: `${match.catalogDigest}:${match.stateVersion}`,
      catalogRevision: `${match.dataVersion}:${match.catalogDigest}`,
      nonResourceCosts: "none", base: { cost: base, sourceUid: uid, sourceEpoch: subject.zoneEpoch },
      candidates: candidatesForCost, orderedModifiers: [],
    };
    const fingerprints = fingerprintDuelCostCoverageV2(verified);
    return { match, request, uid, sourceEpoch: subject.zoneEpoch, base, verified, fingerprints,
      registryRevision: verified.registryRevision, catalogRevision: verified.catalogRevision };
  };
  const service = (request: DuelCostRequestV2) => {
    const snapshot = snapshotFor(request);
    return { request, base: { cost: snapshot.base, proofId: `base:${request.transactionId}`,
      status: "complete" as const, request, sourceUid: snapshot.uid, sourceEpoch: snapshot.sourceEpoch,
      registryRevision: snapshot.registryRevision, catalogRevision: snapshot.catalogRevision },
      coverage: { proofId: `coverage:${request.transactionId}`, status: "complete" as const, request,
        allModifierSourcesCovered: true, choicesResolved: true, nonResourceCosts: "none" as const,
        registryRevision: snapshot.registryRevision, catalogRevision: snapshot.catalogRevision,
        candidateSourcesFingerprint: snapshot.fingerprints.candidateSourcesFingerprint,
        resolvedChoicesFingerprint: snapshot.fingerprints.resolvedChoicesFingerprint },
      proofs: [], modifiers: [] };
  };
  const verifier = (request: DuelCostRequestV2): DuelCostVerifiedSourcesV2 => snapshotFor(request).verified;
  return createDuelCostResolverAuthorityV2(service, verifier);
}

function isNoAbilityUnit(authority: CardProgramAuthority, catalog: CardCatalogRuntime, cardId: string): boolean {
  const card = catalog.publicCatalog.cards.find(item => item.id === cardId);
  if (!card || card.cardType !== "Unit") return false;
  const reference = authority.resolvedProgramReference(cardId);
  if (!reference) return false;
  const program = getCardProgramRegistryForRuntime(authority).getProgram(cardId);
  return program?.semantics.kind === "no-ability" && program.semantics.playability.kind === "printed-unit";
}

function isDrawSpell(authority: CardProgramAuthority, catalog: CardCatalogRuntime, cardId: string): boolean {
  const card = catalog.publicCatalog.cards.find(item => item.id === cardId);
  if (!card || card.cardType !== "Spell") return false;
  const program = getCardProgramRegistryForRuntime(authority).getProgram(cardId);
  return !!program && program.source.cardType === "Spell" &&
    program.semantics.kind === "spell-resolution" && program.semantics.effects.length === 1 &&
    program.semantics.effects[0]?.kind === "draw-cards";
}

/**
 * A Spell the Core response window accepts as a second Chain item: whole,
 * source-complete Spell program whose single effect draws cards and whose
 * semantics carry the `reaction` timing permission. This only mirrors the Core
 * play permission (cardplay-spell-v2 responseWindow); it grants no new rules.
 */
function isReactionDrawSpell(authority: CardProgramAuthority, catalog: CardCatalogRuntime,
  cardId: string): boolean {
  if (!isDrawSpell(authority, catalog, cardId)) return false;
  const program = getCardProgramRegistryForRuntime(authority).getProgram(cardId);
  if (!program || program.semantics.kind !== "spell-resolution" ||
      program.semantics.permission !== "reaction") return false;
  return authority.sourceProgramPhaseScope(cardId, "main").sourceProgramComplete === true;
}

function matchWindow(match: DuelCanonicalPlayingStateV2): string {
  return stable([match.matchId, match.stateVersion, match.frame.turnNumber, match.frame.phase,
    match.frame.turnPlayerId, match.frame.priorityPlayerId, match.frame.focusPlayerId]);
}

export function createAuthoritativeDuelRuntimeP4(options: DuelAuthoritativeRuntimeP4Options): DuelAuthoritativeRuntimeP4 {
  if (!options || !options.catalog || !text(options.matchId) || typeof options.randomIndex !== "function")
    throw new TypeError("loaded catalog, trusted roster, matchId and RNG are required");
  const runtimeProfile = options.runtimeProfile ?? DUEL_RUNTIME_PROFILE_P4_PUBLIC_CHAIN;
  if (runtimeProfile !== DUEL_RUNTIME_PROFILE_P4_LEGACY && runtimeProfile !== DUEL_RUNTIME_PROFILE_P4_SPELL && runtimeProfile !== DUEL_RUNTIME_PROFILE_P4_PUBLIC_CHAIN && runtimeProfile !== DUEL_RUNTIME_PROFILE_P4_REGIONAL && runtimeProfile !== DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT && runtimeProfile !== DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK && runtimeProfile !== DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN && runtimeProfile !== DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY)
    throw new TypeError("unknown server-owned P4 runtime profile");
  const resolvedCostHistoryEnabled = runtimeProfile === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY;
  const physicalUnitEnabled = runtimeProfile === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN || resolvedCostHistoryEnabled;
  const optionalUnitEnabled = runtimeProfile === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT || runtimeProfile === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK;
  const optionalUnitClockEnabled = runtimeProfile === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK;
  const publicChainEnabled = runtimeProfile === DUEL_RUNTIME_PROFILE_P4_PUBLIC_CHAIN || runtimeProfile === DUEL_RUNTIME_PROFILE_P4_REGIONAL || optionalUnitEnabled || physicalUnitEnabled;
  if (runtimeProfile === DUEL_RUNTIME_PROFILE_P4_REGIONAL) {
    if (!options.constructedRegion) throw new TypeError("regional runtime requires trusted room context");
    verifyConstructedRegion(options.constructedRegion);
  } else if ((optionalUnitEnabled || physicalUnitEnabled) && options.constructedRegion) {
    verifyConstructedRegion(options.constructedRegion);
  } else if (options.constructedRegion) throw new TypeError("historical runtime cannot acquire a regional context");
  const spellEnabled = !physicalUnitEnabled && (runtimeProfile === DUEL_RUNTIME_PROFILE_P4_SPELL || publicChainEnabled);
  const typeResolver = createCatalogCardTypeResolverV2(options.catalog);
  const setup = buildDuelSetupSeats(options.catalog, { matchId: options.matchId, seats: options.roster }, options.uidFactory);
  if (!setup.ok) throw new TypeError(`Duel P4 setup rejected: ${setup.code}`);
  let session: DuelCommandSessionV2 = createDuelCommandSessionV2(setup.seats, setup.metadata,
    options.randomIndex, typeResolver.forMatch(setup.metadata));
  const authority = optionalUnitEnabled || physicalUnitEnabled
    ? createDuelFuryOptionalRosterCardProgramAuthorityV1(options.catalog)
    : createCardProgramAuthority(options.catalog);
  let sourceServices: DuelProductionSourceServicesV2 | null = null;
  let unit: DuelUnitPlaySessionV2 | null = null;
  let physicalUnit: DuelPrintedUnitChainSessionV4 | null = null;
  let physicalChoice: { readonly actor: string; readonly commandId: string; readonly cardUID: string;
    readonly prompt: DuelOptionalPlayPromptV2; readonly promptId: string } | null = null;
  let physicalServices: DuelPrintedUnitChainServicesP8 | null = null;
  let operationHead: DuelMatchStateV2 | null = null;
  let pendingTurn: { actor: string; commandId: string; requestId?: string } | null = null;
  let pendingMove: { actor: string; commandId: string; requestId: string; taskId: string } | null = null;
  let engagement: DuelEngagementStepV2 | null = null;
  let spellServices: P4SpellServices | null = null;
  let spellSession: DuelSpellCardPlaySessionV2 | null = null;
  let optionalChoiceAuthority: DuelOptionalPlayChoiceAuthorityV1 | null = null;
  let optionalChoice: { readonly actor: string; readonly commandId: string; readonly cardUID: string;
    readonly prompt: DuelOptionalPlayPromptV1; readonly promptId: string } | null = null;
  let optionalSelected: { readonly receipt: DuelOptionalPlayReceiptV1;
    readonly data: DuelOptionalPlayReceiptDataV1; readonly entry: DuelUnitEntryServiceV2 } | null = null;
  let optionalPaymentPin: { readonly authority: symbol; readonly proofId: string;
    readonly paymentId: string; readonly taskId: string; readonly continuationId: string;
    readonly cost: string } | null = null;
  const optionalProgramReader = optionalUnitEnabled
    ? createDuelOptionalUnitProgramReader({ catalog: options.catalog, programs: authority }) : null;
  const spellPrivateHistory: unknown[] = [];
  const spellClaims = new Map<string, { readonly fingerprint: string; readonly claim: object; readonly outcome?: unknown }>();
  const spellCommitted = new Map<string, DuelSpellCommittedEffectV2>();
  let inFlight = false;
  /**
   * A native successor is not a live owner until its complete journal path has
   * been observed.  If that observation fails after any authoritative value
   * was replaced, the old capability cannot be safely restored by assigning
   * old session references back.  Fail closed so an outer proposal/archive
   * boundary can discard this owner and rebuild it from protected state.
   */
  let ownerFailure: Error | null = null;
  const commandLedger = new Map<string, LedgerValue>();
  const ownedHead = (): DuelMatchStateV2 => operationHead ?? physicalUnit?.commandSession.match ?? unit?.commandSession.match ?? session.match;
  let journal = createDuelNativeOperationJournalV2({ genesis: session.match, programs: authority, currentHead: ownedHead });
  let proposal: DuelNativeOperationJournalV2 | null = null;
  const snapshotCache = new WeakMap<object, Map<string, { revision: number; value: DuelProtectedGlobalSourceSnapshotV2 | null }>>();
  const activeJournal = () => proposal ?? journal;
  const assertOperational = (): void => {
    if (ownerFailure) throw ownerFailure;
  };
  const failClosed = (cause: unknown): never => {
    if (!ownerFailure) {
      ownerFailure = new TypeError("P4 authoritative owner failed closed after an unconfirmed native operation");
      if (cause instanceof Error) Object.defineProperty(ownerFailure, "cause", { value: cause });
    }
    throw ownerFailure;
  };
  const ownerSnapshot = () => ({ session, unit, physicalUnit, physicalChoice, operationHead, pendingTurn, pendingMove, engagement, spellSession,
    optionalChoice, optionalSelected, optionalPaymentPin });
  const ownerAdvanced = (before: ReturnType<typeof ownerSnapshot>): boolean =>
    session !== before.session || unit !== before.unit || operationHead !== before.operationHead ||
    physicalUnit !== before.physicalUnit || physicalChoice !== before.physicalChoice ||
    pendingTurn !== before.pendingTurn || pendingMove !== before.pendingMove || engagement !== before.engagement ||
    spellSession !== before.spellSession || optionalChoice !== before.optionalChoice ||
    optionalSelected !== before.optionalSelected || optionalPaymentPin !== before.optionalPaymentPin;
  const recordHead = (next: DuelMatchStateV2, taskId?: string) => {
    assertOperational();
    try {
      const target = activeJournal();
      const ancestor = target.observedHead();
      const path = inspectDuelNativeCommitPathV2(ancestor, next);
      if (!path.length) return;
      const physical = physicalUnit ? inspectDuelPrintedUnitPhysicalChainV4(physicalUnit) : null;
      const chainOpening = physical?.phase === "choice" && next.stage === "playing" && path.length === 2 &&
        path[0]!.transitions.length === 1 && path[0]!.transitions[0]!.uid === physical.cardUID &&
        path[0]!.transitions[0]!.from.kind === "hand" && path[0]!.transitions[0]!.to.kind === "chain" &&
        path[1]!.transitions.length === 0;
      const labels: DuelNativeObservedCommitV2[] = path.map((commit, index) => {
        const event = chainOpening ? "chain" : commit.before.stage === "setup" ? "mulligan" :
          commit.transitions.some(t => t.from.kind === "main-deck" && t.to.kind === "hand") ? "draw" :
            commit.transitions.some(t => t.to.kind === "trash") ? "pre-exit" :
              commit.transitions.length ? "zone-transition" : "intrinsic-step";
        return { operationId: `p4-native:${next.matchId}:${commit.after.stateVersion}`,
          eventId: `p4-event:${next.matchId}:${commit.after.eventSeq}`, event,
          ...(chainOpening && index === 0 ? { sourceUID: physical!.cardUID! } : {}),
          ...(taskId ? { taskId } : {}) };
      });
      target.observe({ ancestor, descendant: next, commits: labels });
      if (next.stage === "playing") {
        const latest = labels.at(-1)!;
        if (physical && physical.cardUID && physical.phase !== "completed" &&
            next.chainCards?.some(card => card.uid === physical.cardUID)) {
          target.bindContext({ matchId: next.matchId, dataVersion: next.dataVersion,
            catalogDigest: next.catalogDigest, turn: next.frame.turnNumber,
            taskId: `duel-v4:${next.matchId}:turn-${next.frame.turnNumber}:printed-unit:${physical.cardUID}:${next.stateVersion}`,
            phase: "main", event: "chain",
            clock: { stateVersion: next.stateVersion, eventSeq: next.eventSeq } });
        }
        if (latest.event === "draw" || latest.event === "pre-exit" || latest.event === "zone-transition") {
          target.bindContext({ matchId: next.matchId, dataVersion: next.dataVersion, catalogDigest: next.catalogDigest,
            turn: next.frame.turnNumber, taskId: taskId ?? `duel-v2:${next.matchId}:turn-${next.frame.turnNumber}:native:${next.stateVersion}`,
            phase: "main", event: latest.event, clock: { stateVersion: next.stateVersion, eventSeq: next.eventSeq } });
        }
      }
    } catch (error) { failClosed(error); }
  };
  const globalReader: DuelProductionSourceServicesOptionsV2["globalJournal"] = {
    read: context => {
      if (options.globalJournal) return options.globalJournal.read(context);
      try {
        const source = activeJournal();
        if (source.observedHead() !== ownedHead()) return null;
        const key = JSON.stringify(context);
        let cache = snapshotCache.get(source);
        if (!cache) { cache = new Map(); snapshotCache.set(source, cache); }
        const prior = cache.get(key);
        if (prior?.revision === source.revision()) return prior.value;
        const snapshot = source.fork(ownedHead);
        snapshot.bindContext(context);
        const value = snapshot.read(context);
        cache.set(key, { revision: source.revision(), value });
        return value;
      } catch (error) { return failClosed(error); }
    },
    tokenBirth: uid => options.globalJournal ? options.globalJournal.tokenBirth(uid) : activeJournal().tokenBirth(uid),
  };

  const head = (): DuelCanonicalPlayingStateV2 | null => {
    const value = ownedHead();
    return value.stage === "playing" ? value : null;
  };
  const optionalSourceAttestor = (request: DuelSourceAttestationRequestV2): DuelSourceBindingV2 => {
    const selected = optionalSelected;
    const current = head();
    const binding = inspectDuelNativeOperationJournalBindingV2(activeJournal());
    const data = selected?.data;
    const physical = data && current?.physicalCardsByUID[data.uid];
    if (!optionalUnitEnabled || !data || !current || current !== request.match || !binding ||
        binding.head !== current || binding.observed !== current ||
        current.matchId !== data.matchId || request.actor !== data.actor ||
        request.sourceReference.kind !== "card" || request.sourceReference.sourceUID !== data.uid ||
        request.sourceReference.referenceId !== data.cardId || physical?.cardId !== data.cardId ||
        physical.ownerPlayerId !== data.actor || physical.zoneEpoch !== data.sourceEpoch ||
        !current.players.find(player => player.playerId === data.actor)?.hand.some(card =>
          card.uid === data.uid && card.cardId === data.cardId) ||
        request.paymentId !== `unit-optional-v3-payment:${data.actor}:${data.commandId}` ||
        request.taskId !== `unit-optional-v3-task:${data.actor}:${data.commandId}` ||
        request.continuationId !== `unit-optional-v3-continuation:${data.actor}:${data.commandId}`)
      throw new TypeError("optional Unit source/task attestation rejected");
    const cost = stable(request.finalResolvedCost);
    if (!optionalPaymentPin) {
      if (request.previous || current.stateVersion !== data.stateVersion ||
          current.frame.pendingPayment !== null) throw new TypeError("optional payment issue head changed");
      optionalPaymentPin = Object.freeze({ authority: binding.authority,
        proofId: createHash("sha256").update(stable({ matchId: data.matchId, actor: data.actor,
          commandId: data.commandId, uid: data.uid, epoch: data.sourceEpoch, decision: data.decision,
          paymentId: request.paymentId, taskId: request.taskId, continuationId: request.continuationId, cost })).digest("hex"),
        paymentId: request.paymentId, taskId: request.taskId, continuationId: request.continuationId, cost });
    }
    const pin = optionalPaymentPin;
    if (binding.authority !== pin.authority || cost !== pin.cost ||
        request.paymentId !== pin.paymentId || request.taskId !== pin.taskId ||
        request.continuationId !== pin.continuationId || (request.previous &&
          (request.previous.sourceProofId !== pin.proofId || request.previous.sourceZoneEpoch !== data.sourceEpoch ||
           request.previous.mode !== "current" || request.previous.actor !== data.actor ||
           request.previous.matchId !== data.matchId || request.previous.paymentId !== pin.paymentId ||
           request.previous.taskId !== pin.taskId || request.previous.continuationId !== pin.continuationId ||
           stable(request.previous.sourceReference) !== stable(request.sourceReference))))
      throw new TypeError("optional Unit payment binding changed");
    return Object.freeze({ matchId: current.matchId, actor: data.actor, paymentId: pin.paymentId,
      sourceReference: Object.freeze({ ...request.sourceReference }), sourceProofId: pin.proofId,
      mode: "current" as const, sourceZoneEpoch: data.sourceEpoch,
      taskId: pin.taskId, continuationId: pin.continuationId });
  };
  const isPureAccelerateUnit = (cardId: string): boolean => (optionalUnitEnabled || physicalUnitEnabled) &&
    getCardProgramRegistryForRuntime(authority).getProgram(cardId)?.semantics.kind === "accelerate";
  const optionalContinuation = () => unit ? inspectDuelOptionalUnitPaymentV3(unit) : null;
  const ensureOptionalChoice = () => {
    if (!optionalProgramReader) throw new TypeError("optional Unit profile required");
    return optionalChoiceAuthority ??= createDuelOptionalPlayChoiceAuthorityV1({
      readHead: () => { const current = head(); if (!current) throw new TypeError("playing head required"); return current; },
      readSource: optionalProgramReader.readSource,
      nextOpaqueId: options.uidFactory ?? randomUUID,
    });
  };
  const ensureServices = (): DuelUnitPlayServicesV2 | null => {
    const current = head();
    if (!current) return null;
    if (!sourceServices) {
      sourceServices = createDuelProductionSourceServicesV2({
        catalog: options.catalog, matchId: options.matchId, currentHead: head, programs: authority,
        globalJournal: globalReader,
        effectExecutor: {
          verifyUnitEntry: (request, context, candidateKeys) => {
            const currentHead = head();
            if (!currentHead || currentHead !== request.match || request.stateVersion !== currentHead.stateVersion ||
                request.eventSeq !== currentHead.eventSeq || request.actor !== currentHead.frame.turnPlayerId)
              return null;
            const inspection = sourceServices!.inspect(context);
            const reference = authority.resolvedProgramReference(request.cardId);
            return inspection.status === "ready" && inspection.handlers.length === 0 &&
              inspection.activeSources.length === 0 && reference !== undefined &&
              isNoAbilityUnit(authority, options.catalog, request.cardId) && candidateKeys.length === inspection.candidates.length
              ? { status: "resolved" as const, scope: "exact" as const, matchId: currentHead.matchId,
                stateVersion: currentHead.stateVersion, uid: request.uid, candidateKeys, effects: "none" as const } : null;
          },
          resolveTokenDecision: () => null,
        },
        verifyCostBinding: request => {
          const currentHead = head();
          const card = options.catalog.publicCatalog.cards.find(item => item.id === request.cardId);
          return !!currentHead && request.matchId === currentHead.matchId && request.stateVersion === currentHead.stateVersion &&
            !!card && card.cardType === "Unit" && text(request.transactionId) && text(request.baseProofId) && text(request.coverageProofId);
        },
      });
    }
    const cost = makeCostAuthority(options.catalog, sourceServices, head);
    const cleanup = createDuelEngagementServicesV2({ currentHead: head, sources: sourceServices,
      randomIndex: options.randomIndex, ...(options.continuousEffects ? { effects: options.continuousEffects } : {}) });
    const turn: DuelTurnServicesV2 = {
      sources: sourceServices.phaseRegistry, randomIndex: options.randomIndex,
      lethalEvaluators: cleanup.lethalEvaluators, approveLethal: cleanup.approveLethal,
      observeCheckpoint: checkpoint => {
        assertOperational();
        operationHead = checkpoint.match;
        recordHead(checkpoint.match, checkpoint.taskId);
        try { activeJournal().bindContext(contextFor(checkpoint.match, checkpoint.event, checkpoint.taskId)); }
        catch (error) { failClosed(error); }
        return true;
      },
      fepr: (match, taskId) => {
        const closed = globalReader.read(contextFor(match, "fepr", taskId));
        return closed && closed.input.chain.entries.length === 0 && closed.input.effectQueue.entries.length === 0 &&
          closed.input.feprOutstanding.entries.length === 0 ? { status: "none" as const } : { status: "pending" as const };
      },
      firstBurnout: () => ({ status: "pending" as const }),
      burnoutIntervention: () => ({ status: "pending" as const }),
    };
    const optional = optionalUnitEnabled ? createP4OptionalUnitServices({
      catalog: options.catalog, programs: authority,
      getOperationHead: () => { const current = head(); if (!current) throw new TypeError("playing head required"); return current; },
      currentJournal: activeJournal,
      inspectChoice: receipt => ensureOptionalChoice().inspectReceipt(receipt),
      entry: request => optionalSelected ? optionalSelected.entry(request) : sourceServices!.entry(request),
    }) : null;
    return { programs: getCardProgramRegistryForRuntime(authority), cost,
      costBinding: request => sourceServices!.costBinding(request),
      entry: request => sourceServices!.entry(request), turn,
      ...(optional ? { optional: optional.unitServices, optionalPaymentV3: { sourceAttestor: optionalSourceAttestor } } : {}),
      move: {
        timing: (match, actor) => {
          if (head() !== match || engagement || pendingMove) throw new TypeError("outstanding engagement");
          const inspected = sourceServices!.inspect(contextFor(match, "main",
            `duel-v2:${match.matchId}:turn-${match.frame.turnNumber}:move:${actor}`));
          if (inspected.status !== "ready" || inspected.handlers.length || inspected.activeSources.length)
            throw new TypeError("unresolved Move source closure");
          return { phase: match.frame.phase === "main" ? "main" as const : "other" as const,
            stateOpen: match.frame.stateOpen, turnPlayerId: match.frame.turnPlayerId,
            priorityPlayerId: match.frame.priorityPlayerId };
        },
        ganking: (match, _actor, uid) => {
          const object = match.unitMeta[uid];
          if (!object || object.trait.kind !== "card" ||
              !(isNoAbilityUnit(authority, options.catalog, object.trait.cardId) || isPureAccelerateUnit(object.trait.cardId)))
            throw new TypeError("unresolved movement keyword");
          return false;
        },
        triggers: request => {
          operationHead = request.currentState;
          const ownerTask = `duel-v2:${request.currentState.matchId}:turn-${request.currentState.frame.turnNumber}:${request.obligation.taskId}`;
          recordHead(request.currentState, ownerTask);
          const inspected = sourceServices!.inspect(contextFor(request.currentState, "required-cleanup", ownerTask));
          return inspected.status === "ready" && inspected.handlers.length === 0 && inspected.activeSources.length === 0
            ? { status: "settled" as const, taskId: request.obligation.taskId,
              movedVersion: request.obligation.movedVersion, events: request.obligation.events,
              disposition: "no-triggers" as const } : { status: "pending" as const };
        },
      } };
  };
  const sync = (next: DuelUnitPlaySessionV2 | null, fallback?: DuelCommandSessionV2) => {
    assertOperational();
    if (next) { unit = next; session = next.commandSession; }
    else if (fallback) session = fallback;
    operationHead = session.match;
    recordHead(session.match);
  };
  const ensurePhysicalServices = (): DuelPrintedUnitChainServicesP8 =>
    physicalServices ??= createDuelPrintedUnitChainServicesP8({
      allowResolvedPreExitCostHistory: resolvedCostHistoryEnabled,
      catalog: options.catalog, programs: authority, currentHead: head, currentJournal: activeJournal,
      currentSession: () => physicalUnit?.commandSession ?? unit?.commandSession ?? session,
      nextOpaqueId: options.uidFactory ?? randomUUID,
    });
  const syncPhysical = (result: DuelPrintedUnitChainResultV4): void => {
    if (!result.persistRequired) return;
    physicalUnit = result.session;
    operationHead = result.session.commandSession.match;
    recordHead(operationHead);
    if (result.outcome.status === "applied") {
      if (!unit) throw new TypeError("Unit owner missing after physical finalize");
      sync(advanceDuelUnitCommandSessionV2(unit, result.session.commandSession));
      physicalUnit = null;
      physicalChoice = null;
    }
  };
  /** Allocate the choice-opening clock through Core's admitted session path.
   * The mutation intentionally changes no game carrier; Core owns the single
   * stateVersion/eventSeq allocation and the Unit handoff preserves its cursor
   * and receipt lineage. */
  const advanceOptionalChoiceClock = (actor: string, cardUID: string, commandId: string,
    expectedVersion: number) => {
    if (!optionalUnitClockEnabled || !unit) return;
    const before = unit.commandSession.match;
    const committed = commitDuelChoiceOpeningEventV2(unit.commandSession,
      { actor, cardUID, commandId, expectedVersion });
    if (!committed.persistRequired || committed.session.match.stateVersion !== before.stateVersion + 1 ||
        committed.session.match.eventSeq !== before.eventSeq + 1)
      throw new TypeError("optional choice clock allocation rejected");
    sync(advanceDuelUnitCommandSessionV2(unit, committed.session));
  };
  const autoStart = () => {
    if (!unit && session.match.stage === "playing") {
      const services = ensureServices();
      if (services) unit = createDuelUnitPlaySessionV2(session, services, { randomIndex: options.randomIndex });
    }
    if (!unit || unit.commandSession.match.stage !== "playing" || unit.commandSession.match.frame.phase !== "awaiting-turn-start") return;
    if (unit.commandSession.turnCursorV2?.pendingTaskID) return;
    const actor = unit.commandSession.match.frame.turnPlayerId;
    const commandId = `__p4-internal:start-turn:${unit.commandSession.match.stateVersion}`;
    try {
      const result = startDuelUnitTurnV2(unit, actor, { commandId,
        expectedVersion: unit.commandSession.match.stateVersion, command: { type: "start-turn" } });
      sync(result.session);
      pendingTurn = result.outcome.status === "pending" ? { actor, commandId } : null;
    } finally { operationHead = null; }
  };
  const resumeOptionalEntry = () => {
    const pending = optionalContinuation();
    if (!unit || !pending || pending.status !== "pending" ||
        unit.commandSession.match.stage !== "playing" || unit.commandSession.match.frame.pendingPayment !== null)
      return null;
    const result = resumeDuelOptionalUnitPaymentV3(unit, pending.actor, {
      commandId: `__p4-internal:optional-entry:${pending.paymentId}`,
      expectedVersion: unit.commandSession.match.stateVersion, command: { cardUID: pending.cardUID },
    });
    sync(result.session);
    if (result.outcome.status === "applied") {
      optionalSelected = null;
      optionalPaymentPin = null;
    }
    return result;
  };

  const engagementServices = () => {
    ensureServices();
    if (!sourceServices) throw new TypeError("source services unavailable");
    return createDuelEngagementServicesV2({ currentHead: head, sources: sourceServices, randomIndex: options.randomIndex,
      ...(options.continuousEffects ? { effects: options.continuousEffects } : {}) });
  };
  const spellDispatcher = {
    claim: (request: { readonly actor: string; readonly commandId: string; readonly payloadFingerprint: string }) => {
      const key = keyFor(request.actor, request.commandId);
      const prior = spellClaims.get(key);
      if (prior && prior.fingerprint !== request.payloadFingerprint) return { status: "conflict" as const };
      if (prior) return { status: "duplicate" as const, outcome: prior.outcome as never };
      const claim = Object.freeze({ key, actor: request.actor, commandId: request.commandId });
      spellClaims.set(key, { fingerprint: request.payloadFingerprint, claim });
      return { status: "new" as const, claim };
    },
    finish: (request: { readonly claim: unknown; readonly outcome: unknown }) => {
      if (!request.claim || typeof request.claim !== "object") return;
      const key = (request.claim as { readonly key?: unknown }).key;
      if (typeof key !== "string") return;
      const prior = spellClaims.get(key);
      if (prior) spellClaims.set(key, { ...prior, outcome: request.outcome });
    },
    readCommitted: (ticket: { readonly idempotencyKey: string }) => spellCommitted.get(ticket.idempotencyKey) ?? null,
    commitEffect: (request: { readonly receipt: DuelSpellCommittedEffectV2 }) => {
      const prior = spellCommitted.get(request.receipt.idempotencyKey);
      if (prior && JSON.stringify(prior) !== JSON.stringify(request.receipt)) throw new TypeError("conflicting Spell receipt");
      spellCommitted.set(request.receipt.idempotencyKey, request.receipt);
    },
    notifyCommitted: () => undefined,
  };
  const spellSourceAttestor = (request: DuelSourceAttestationRequestV2): DuelSourceBindingV2 => {
    const current = request.match;
    const sourceUID = request.sourceReference.sourceUID;
    const physical = sourceUID ? current?.physicalCardsByUID[sourceUID] : undefined;
    if (current.stage !== "playing" || current.matchId !== options.matchId || !physical || request.sourceReference.kind !== "card" ||
        request.sourceReference.referenceId !== physical.cardId || !sourceUID || physical.ownerPlayerId !== request.actor)
      throw new TypeError("Spell source attestation rejected");
    const candidate = enumerateDuelPhaseSourceClosureCandidatesV2(current).find(item =>
      item.uid === sourceUID && item.cardId === physical.cardId && item.zoneEpoch === physical.zoneEpoch);
    const chainCard = current.chainCards?.find(item => item.uid === sourceUID && item.cardId === physical.cardId &&
      item.controllerPlayerId === request.actor);
    if ((!candidate && !chainCard) || (candidate && (candidate.ownerPlayerId !== request.actor ||
        !["hand", "chain"].includes(candidate.zone.kind)))) throw new TypeError("Spell source is not live");
    if (request.previous && (!text(request.previous.sourceProofId) ||
        request.previous.sourceReference.sourceUID !== sourceUID ||
        request.previous.sourceZoneEpoch !== physical.zoneEpoch)) throw new TypeError("Spell source binding changed");
    const sourceProofId = request.previous?.sourceProofId ?? createHash("sha256").update(stable({ matchId: current.matchId,
      actor: request.actor,
      paymentId: request.paymentId, sourceUID, zoneEpoch: physical.zoneEpoch,
      taskId: request.taskId ?? null, continuationId: request.continuationId ?? null })).digest("hex");
    return Object.freeze({ matchId: current.matchId, actor: request.actor, paymentId: request.paymentId,
      sourceReference: Object.freeze({ ...request.sourceReference }), sourceProofId,
      mode: "current" as const, sourceZoneEpoch: physical.zoneEpoch,
      ...(request.taskId ? { taskId: request.taskId } : {}),
      ...(request.continuationId ? { continuationId: request.continuationId } : {}) });
  };
  const createSpell = (): void => {
    if (!unit || spellSession || !sourceServices) throw new TypeError("Spell branch is unavailable");
    const current = head();
    if (!current) throw new TypeError("playing Spell head required");
    const services = createP4SpellServices({
      catalog: options.catalog, programs: authority, getOperationHead: () => {
        const value = head(); if (!value) throw new TypeError("stale Spell head"); return value;
      }, setOperationHead: value => { operationHead = value; }, currentJournal: activeJournal,
      observeNativePath: request => ({ ancestor: request.ancestor, descendant: request.descendant,
        commits: request.commits.map((commit, index) => {
          const event = commit.before.stage === "setup" ? "mulligan" as const :
            commit.transitions.some(t => t.from.kind === "main-deck" && t.to.kind === "hand") ? "draw" as const :
              commit.transitions.some(t => t.to.kind === "trash") ? "pre-exit" as const :
                commit.transitions.length ? "zone-transition" as const : "intrinsic-step" as const;
          return { operationId: `p4-spell:${request.descendant.matchId}:${commit.after.stateVersion}:${index}`,
            eventId: `p4-spell-event:${request.descendant.matchId}:${commit.after.eventSeq}:${index}`, event,
            stateVersion: commit.after.stateVersion, eventSeq: commit.after.eventSeq };
        }) }),
      dispatcher: spellDispatcher, sourceAttestor: spellSourceAttestor,
      closure: { draw: { randomIndex: options.randomIndex } },
      uidFactory: options.uidFactory ?? (() => `p4-spell-${randomUUID()}`),
      dispatcherSnapshot: () => ({ claims: [...spellClaims], committed: [...spellCommitted] }),
    });
    spellServices = services;
    spellSession = services.createSession(unit.commandSession);
    operationHead = current;
  };
  const syncSpellResult = (result: DuelSpellCardPlayResultV2): void => {
    if (!unit || !spellSession || !spellServices) throw new TypeError("Spell branch is unavailable");
    const before = spellSession;
    const changed = result.session.commandSession !== before.commandSession;
    if (changed) spellServices.handoff(result);
    const nextMatch = result.session.commandSession.match as DuelCanonicalPlayingStateV2;
    const canHandoffUnit = nextMatch.frame.pendingPayment === null &&
      result.session.commandSession.requiredTasks.every(task => task.status === "completed") &&
      result.session.commandSession.priorityPayments.every(payment => payment.status === "completed");
    if (changed && canHandoffUnit && result.session.commandSession !== unit.commandSession) {
      unit = advanceDuelUnitCommandSessionV2(unit, result.session.commandSession);
      session = unit.commandSession;
    }
    spellSession = result.session;
    operationHead = result.session.commandSession.match;
    const match = result.session.commandSession.match as DuelCanonicalPlayingStateV2;
    if (result.outcome.status === "applied" && result.session.chain.items.length === 0 &&
        match.frame.pendingPayment === null && match.frame.stateOpen) {
      spellPrivateHistory.push(spellServices.privateFingerprintData());
      spellSession = null;
      spellServices = null;
    }
  };
  const adoptEngagementStep = (step: DuelEngagementStepV2) => {
    if (!unit) throw new TypeError("playing Unit branch required");
    operationHead = step.match;
    recordHead(step.match);
    const canonical = advanceDuelCommandSessionNativeV2(unit.commandSession, step.match).session;
    sync(advanceDuelUnitCommandSessionV2(unit, canonical));
    engagement = step.status === "complete" ? null : step;
  };
  const pumpEngagement = () => {
    for (let count = 0; count < 32 && engagement?.status === "active"; count++) {
      if (engagement.cursor.phase === "focus" || engagement.cursor.phase === "damage") return;
      const step = advanceDuelEngagementV2(engagement.cursor,
        { kind: "continue", expectedStateVersion: engagement.match.stateVersion });
      adoptEngagementStep(step);
    }
  };
  const openStagedEngagement = () => {
    const match = head();
    if (!match || engagement || match.frame.phase !== "main") return;
    const field = match.board.battlefields.find(value => value.showdown === "staged");
    if (field) adoptEngagementStep(startDuelEngagementV2(match, field.locationId, engagementServices()));
  };
  const combatChoice = () => {
    if (!engagement || engagement.status === "complete" || engagement.cursor.phase !== "damage") return null;
    const services = engagementServices();
    const plan = planDuelBaseCombatDamage(engagement.match, engagement.cursor.fieldId,
      createTrustedDuelBaseCombatFacts(engagement.match.stateVersion, engagement.cursor.fieldId, services.combat));
    const side = engagement.cursor.expectedActorPlayerId === plan.attacker.playerId ? plan.attacker : plan.defender;
    return { active: true as const, kind: "combat-allocation" as const,
      choiceId: stable([engagement.match.matchId, engagement.match.stateVersion, engagement.cursor.fieldId,
        engagement.cursor.phase, engagement.cursor.expectedActorPlayerId]),
      fieldLocationId: engagement.cursor.fieldId, side: side.side, budget: side.budget,
      targets: side.targets.map(target => ({ unitObjectId: target.uid, lethalNeed: target.lethalNeed })) };
  };

  const project = (viewer: string | null): DuelProjectionV3Actions1 => {
    assertOperational();
    const current = physicalUnit?.commandSession.match ?? spellSession?.commandSession.match ?? unit?.commandSession.match ?? session.match;
    const base = projectCanonicalDuelMatchV3(current, viewer);
    const cursor = physicalUnit?.commandSession.turnCursorV2 ?? unit?.commandSession.turnCursorV2;
    const spellActive = spellEnabled && spellSession !== null && spellSession.chain.items.length > 0;
    const physical = physicalUnit ? inspectDuelPrintedUnitPhysicalChainV4(physicalUnit) : null;
    const optionalState = optionalUnitEnabled ? optionalContinuation() : null;
    const optionalBusy = optionalState?.status === "pending";
    const main = current.stage === "playing" && current.frame.phase === "main" &&
      cursor?.step === "main" && cursor.pendingTaskID === null && !engagement && !pendingMove && !spellActive &&
      !optionalChoice && !optionalBusy && !physical;
    const inspection = main && sourceServices ? sourceServices.inspect(contextFor(current, "main",
      `${cursor.rootTaskID}:main:0`)) : null;
    const ready = main && inspection?.status === "ready" && inspection.handlers.length === 0 &&
      inspection.activeSources.length === 0;
    let choice: ReturnType<typeof combatChoice> = null;
    try { choice = combatChoice(); } catch { /* An unresolved allocation has no fabricated budget. */ }
    const engagementReady = engagement?.status === "active" &&
      (engagement.cursor.phase !== "damage" || choice !== null);
    let publicCards: readonly { cardId: string; controllerPlayerId: string; status: "pending" | "finalized" }[] | undefined;
    if (publicChainEnabled && spellActive) {
      const canonicalCards = (current as DuelCanonicalPlayingStateV2).chainCards ?? [];
      const bindings = inspectDuelSpellPrivateStateV2(spellSession!).bindings;
      const liveUIDs = new Set<string>();
      publicCards = spellSession!.chain.items.map(item => {
        const binding = bindings.find(value => value.itemId === item.id);
        const card = binding && canonicalCards.find(value => value.uid === binding.uid);
        if (!binding || !card || liveUIDs.has(card.uid) || card.cardId !== binding.cardId ||
            card.controllerPlayerId !== binding.controller || card.controllerPlayerId !== item.controllerPlayerId)
          throw new TypeError("unresolved public Chain card binding");
        liveUIDs.add(card.uid);
        return { cardId: card.cardId, controllerPlayerId: card.controllerPlayerId, status: item.status };
      });
      if (liveUIDs.size !== canonicalCards.length) throw new TypeError("unresolved public Chain card count");
    }
    const match: DuelProjectionV3Actions1["match"] = base.stage === "setup" ? base : {
      ...base, frame: { ...base.frame,
        chain: physical && physical.phase !== "completed" ? {
          active: true as const, itemCount: 1, pendingCount: 1,
          cards: (current as DuelCanonicalPlayingStateV2).chainCards?.filter(card => card.uid === physical.cardUID)
            .map(card => ({ cardId: card.cardId, controllerPlayerId: card.controllerPlayerId,
              status: "pending" as const })) ?? [],
        } : spellActive ? { active: true as const, itemCount: spellSession!.chain.items.length,
          pendingCount: spellSession!.chain.items.filter(item => item.status === "pending").length,
          ...(publicCards ? { cards: publicCards } : {}) } : { active: false }, pendingChoice: optionalChoice
          ? projectOptionalUnitChoiceP6({ prompt: optionalChoice.prompt, ownerPlayerId: optionalChoice.actor,
              viewerPlayerId: viewer, opaquePromptId: optionalChoice.promptId }) : physicalChoice
          ? projectOptionalUnitChoiceP6({ prompt: physicalChoice.prompt, ownerPlayerId: physicalChoice.actor,
              viewerPlayerId: viewer, opaquePromptId: physicalChoice.promptId }) : choice
          ? viewer === (engagement?.status !== "complete" ? engagement?.cursor.expectedActorPlayerId : null)
            ? choice : { active: true } : null,
        execution: { status: ready || engagementReady || base.frame.phase === "ended" ? "ready" : "pending" } },
    };
    let actions: readonly DuelActionV3Actions1[] = [];
    if (base.stage === "setup") {
      if (viewer && base.setup.stage === "mulligan" && base.setup.currentMulliganOwner === viewer) {
        const hand = base.setup.players.find(player => player.playerId === viewer)?.hand ?? [];
        actions = [{ id: stable([base.matchId, viewer, base.stateVersion, "mulligan"]), kind: "mulligan",
          label: "选择重调手牌（最多 2 张）", enabled: true,
          selectableUIDs: hand.map(card => card.uid), maxSelections: 2 }];
      }
    } else if (viewer && base.frame.phase !== "awaiting-turn-start" && base.frame.phase !== "ended") {
      const playing = current as DuelCanonicalPlayingStateV2;
      const frame = base.frame;
      const windowId = matchWindow(current as DuelCanonicalPlayingStateV2);
      const isOwner = viewer === frame.turnPlayerId && viewer === frame.priorityPlayerId && frame.stateOpen;
      const ownHand = playing.players.find(player => player.playerId === viewer)?.hand ?? [];
      const playable = ownHand.filter(card => {
        if (physicalUnitEnabled) {
          const source = playing.physicalCardsByUID[card.uid];
          return !!source && ensurePhysicalServices().program({ match: playing, matchId: playing.matchId,
            dataVersion: playing.dataVersion, catalogDigest: playing.catalogDigest, actor: viewer,
            uid: card.uid, cardId: card.cardId, sourceEpoch: source.zoneEpoch }).status === "known";
        }
        return isNoAbilityUnit(authority, options.catalog, card.cardId) || isPureAccelerateUnit(card.cardId) ||
          spellEnabled && isDrawSpell(authority, options.catalog, card.cardId);
      });
      const pendingPayment = playing.frame.pendingPayment;
      let resources: readonly DuelActionV3Actions1[] = engagement || pendingMove ? [] : projectDuelRuntimeV3(physicalUnit?.commandSession ?? spellSession?.commandSession ?? unit?.commandSession ?? session, viewer,
        optionalUnitEnabled || physicalUnitEnabled ? { paymentAttestationAvailable: optionalBusy || physical?.phase === "payment" } : undefined).actions
        .filter(action => action.kind !== "mulligan").map(action =>
          spellActive && pendingPayment && pendingPayment.actor === viewer && action.kind === "pay-pending"
            ? { ...action, enabled: true } : action);
      if (spellActive && pendingPayment?.actor === viewer &&
          !resources.some(action => action.kind === "pay-pending")) {
        resources = [...resources, { id: stable([playing.matchId, viewer, playing.stateVersion, "pay-pending", pendingPayment.paymentId]),
          kind: "pay-pending" as const, paymentId: pendingPayment.paymentId,
          label: "支付待结算费用", enabled: true }];
      }
      actions = [...resources, ...playable.map(card => ({
        id: stable([playing.matchId, viewer, playing.stateVersion, "play-card", card.uid]),
        kind: "play-card" as const, label: isDrawSpell(authority, options.catalog, card.cardId) ? "施放法术" : "打出单位",
        enabled: !!(isOwner && ready && !spellActive), cardUID: card.uid, windowId,
        ...(isOwner && ready && !spellActive ? {} : { reason: "等待规则闭合" }) }))];
      if (spellActive) {
        const payment = playing.frame.pendingPayment;
        if (!payment) {
          const privateState = spellSession ? inspectDuelSpellPrivateStateV2(spellSession) : null;
          const inResponseWindow = frame.stateOpen === false && spellSession !== null &&
            spellSession.chain.stateOpen === false && spellSession.chain.phase === "execute" &&
            privateState !== null && privateState.pendingCost === null && privateState.pendingEffect === null;
          if (inResponseWindow && playing.frame.priorityPlayerId === viewer) {
            const reactions = ownHand.filter(card => isReactionDrawSpell(authority, options.catalog, card.cardId));
            actions = [...reactions.map(card => ({
              id: stable([playing.matchId, viewer, playing.stateVersion, "play-card", card.uid]),
              kind: "play-card" as const, label: "施放法术", enabled: true, cardUID: card.uid, windowId })),
              { id: stable([playing.matchId, viewer, playing.stateVersion, "pass-priority"]), kind: "pass-priority" as const,
                label: "让过优先权", enabled: true, windowId }];
          } else {
            actions = [];
          }
        }
      }
      const movable = playing.board.units.filter(value => value.controllerPlayerId === viewer &&
        playing.unitMeta[value.objectId]?.readied &&
        playing.unitMeta[value.objectId]?.trait.kind === "card" &&
        (isNoAbilityUnit(authority, options.catalog, (playing.unitMeta[value.objectId]!.trait as { cardId: string }).cardId) ||
          isPureAccelerateUnit((playing.unitMeta[value.objectId]!.trait as { cardId: string }).cardId)));
      const destinations = [
        ...playing.board.bases.filter(base => base.ownerPlayerId === viewer), ...playing.board.battlefields,
      ].map(location => ({ locationId: location.locationId,
        eligibleUnitUIDs: movable.filter(value => value.locationId !== location.locationId &&
          (playing.board.bases.some(base => base.locationId === value.locationId) ||
           playing.board.bases.some(base => base.locationId === location.locationId)))
          .map(value => value.objectId) })).filter(location => location.eligibleUnitUIDs.length > 0);
      const moveEnabled = !!(isOwner && ready && destinations.length);
      if (spellActive) {
        const candidate = { projectionSchema: DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1, viewerPlayerId: viewer, match, actions };
        if (!isDuelProjectionV3Actions1(candidate)) throw new TypeError("P4 projection guard rejected owner output");
        return candidate;
      }
      actions = [...actions,
        { id: stable([playing.matchId, viewer, playing.stateVersion, "standard-move"]), kind: "standard-move" as const,
          label: "移动", enabled: moveEnabled, ...(moveEnabled ? {} : { reason: "当前没有可移动的单位" }), windowId,
          selectableUnitUIDs: [...new Set(destinations.flatMap(destination => destination.eligibleUnitUIDs))], destinations },
        { id: stable([playing.matchId, viewer, playing.stateVersion, "end-turn"]), kind: "end-turn" as const,
          label: "结束回合", enabled: !!(isOwner && ready), windowId,
          ...(isOwner && ready ? {} : { reason: "当前回合仍有待处理规则" }) }];
      if (engagementReady && engagement?.status !== "complete") {
        if (engagement?.cursor.phase === "focus" && engagement.cursor.expectedActorPlayerId === viewer)
          actions = [{ id: stable([playing.matchId, playing.stateVersion, viewer, "pass-focus"]),
            kind: "pass-focus", label: "让过焦点", enabled: true, windowId }];
        else if (choice && engagement?.cursor.expectedActorPlayerId === viewer)
          actions = [{ id: stable([playing.matchId, playing.stateVersion, viewer, "assign-combat-damage"]),
            kind: "assign-combat-damage", label: "分配战斗伤害", enabled: true, choiceId: choice.choiceId }];
        else actions = [];
      }
      if (optionalChoice) {
        actions = viewer === optionalChoice.actor ? [{
          id: stable([playing.matchId, viewer, playing.stateVersion, "answer-pending-choice", optionalChoice.prompt.choiceId]),
          kind: "answer-pending-choice", label: "选择额外费用", enabled: true, choiceId: optionalChoice.prompt.choiceId,
        }] : [];
      } else if (optionalBusy) {
        actions = pendingPayment ? resources : [];
      } else if (physicalChoice) {
        actions = viewer === physicalChoice.actor ? [{
          id: stable([playing.matchId, viewer, playing.stateVersion, "answer-pending-choice", physicalChoice.prompt.choiceId]),
          kind: "answer-pending-choice", label: "选择额外费用", enabled: true,
          choiceId: physicalChoice.prompt.choiceId,
        }] : [];
      } else if (physical) {
        actions = physical.phase === "payment" && pendingPayment?.actor === viewer
          ? resources.filter(action => ["rune-energy", "rune-power", "gold-power", "pay-pending"].includes(action.kind)) : [];
      }
    }
    const candidate = { projectionSchema: DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1, viewerPlayerId: viewer, match, actions };
    if (!isDuelProjectionV3Actions1(candidate)) throw new TypeError("P4 projection guard rejected owner output");
    return candidate;
  };

  const finish = (packet: DuelCommandMessageV3Actions1, ack: DuelAuthoritativeRuntimeP4Ack): DuelAuthoritativeRuntimeP4Result =>
    Object.freeze({ ack: Object.freeze({ ...ack }), projection: project(null) });
  const dispatch = (actor: string, packet: unknown): DuelAuthoritativeRuntimeP4Result => {
    assertOperational();
    let parsed: DuelCommandMessageV3Actions1;
    try {
      if (!isDuelCommandMessageV3Actions1(packet) || !text(actor)) return { ack: genericError(packet, "对局命令格式无效"), projection: project(null) };
      parsed = packet;
      if (parsed.commandProfile !== DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1) throw new TypeError();
      if (parsed.commandId.startsWith("__p4-internal:"))
        return { ack: genericError(parsed, "命令标识使用了服务器保留名称"), projection: project(actor) };
    } catch { return { ack: genericError(packet, "对局命令格式无效"), projection: project(null) }; }
    if (inFlight) return { ack: blocked(parsed, "对局正在结算，请稍后再试"), projection: project(actor) };
    const ledgerKey = keyFor(actor, parsed.commandId), fingerprint = commandFingerprint(parsed);
    const prior = commandLedger.get(ledgerKey);
    const spellRetry = !!(prior && prior.fingerprint === fingerprint && prior.ack.pending && spellSession &&
      (parsed.command.type === "play-card" || parsed.command.type === "pass-priority"));
    if (prior && !spellRetry) return finish(parsed, prior.fingerprint === fingerprint ? { ...prior.ack, requestId: parsed.requestId, duplicate: true } :
      genericError(parsed, "命令标识与此前请求冲突"));
    if (!((physicalUnit?.commandSession.match ?? unit?.commandSession.match ?? session.match).roster.some(seat => seat.playerId === actor)))
      return finish(parsed, genericError(parsed, "当前玩家不在本局座位中"));
    inFlight = true;
    const before = ownerSnapshot();
    let forkAttempt = true;
    try {
      proposal = journal.fork(ownedHead);
      forkAttempt = false;
      const current = physicalUnit?.commandSession.match ?? spellSession?.commandSession.match ?? unit?.commandSession.match ?? session.match;
      const command = parsed.command as RuntimeCommand;
      let ack: DuelAuthoritativeRuntimeP4Ack;
      const appliedAction = (): DuelAuthoritativeRuntimeP4Ack => {
        const match = physicalUnit?.commandSession.match ?? unit?.commandSession.match ?? session.match;
        return { type: "request-result", requestId: parsed.requestId, commandId: parsed.commandId,
          ok: true, appliedVersion: match.stateVersion, eventSeq: match.eventSeq, message: "已完成" };
      };
      if (physicalChoice && command.type !== "answer-pending-choice") {
        ack = blocked(parsed, "请先选择是否支付额外费用");
      } else if (physicalUnit && !physicalChoice &&
          !["rune-energy", "rune-power", "gold-power", "pay-pending"].includes(command.type)) {
        ack = blocked(parsed, "请先完成当前单位的费用支付与入场");
      } else if (command.type === "answer-pending-choice" && physicalUnitEnabled) {
        const choice = physicalChoice;
        const answer = command.answers[0];
        const optionId = answer?.optionIds[0];
        if (!choice || !physicalUnit || actor !== choice.actor || parsed.expectedVersion !== current.stateVersion ||
            command.choiceId !== choice.prompt.choiceId || command.answers.length !== 1 ||
            answer?.promptId !== choice.promptId || answer.optionIds.length !== 1 ||
            (optionId !== choice.prompt.payOptionId && optionId !== choice.prompt.declineOptionId)) {
          ack = genericError(parsed, "额外费用选择窗口已变化");
        } else {
          const result = answerDuelPrintedUnitPhysicalChainV4(physicalUnit, actor, {
            commandId: choice.commandId, expectedVersion: parsed.expectedVersion,
            command: { choiceId: command.choiceId, optionId },
          });
          syncPhysical(result);
          if (result.outcome.status === "pending") {
            physicalChoice = null;
            ack = appliedAction();
          } else ack = result.outcome.status === "blocked"
            ? blocked(parsed, "单位费用或入场仍在等待规则闭合") : genericError(parsed, "额外费用选择未通过规则校验");
        }
      } else if (optionalChoice && command.type !== "answer-pending-choice") {
        ack = blocked(parsed, "请先选择是否支付额外费用");
      } else if (optionalContinuation()?.status === "pending" &&
          !["rune-energy", "rune-power", "gold-power", "pay-pending"].includes(command.type)) {
        ack = blocked(parsed, "请先完成当前单位的费用支付与入场");
      } else if (command.type === "answer-pending-choice" && optionalUnitEnabled) {
        const choice = optionalChoice;
        const answer = command.answers[0];
        const optionId = answer?.optionIds[0];
        if (!choice || actor !== choice.actor || parsed.expectedVersion !== current.stateVersion ||
            command.choiceId !== choice.prompt.choiceId || command.answers.length !== 1 ||
            answer?.promptId !== choice.promptId || answer.optionIds.length !== 1 ||
            (optionId !== choice.prompt.payOptionId && optionId !== choice.prompt.declineOptionId)) {
          ack = genericError(parsed, "额外费用选择窗口已变化");
        } else {
          const choices = ensureOptionalChoice();
          const receipt = choices.answer({ actor, commandId: choice.commandId,
            expectedVersion: parsed.expectedVersion, choiceId: command.choiceId, optionId });
          const data = choices.inspectReceipt(receipt);
          const adapter = createOptionalUnitPaymentEntryV3({ catalog: options.catalog, programs: authority,
            currentHead: () => { const value = head(); if (!value) throw new TypeError("playing head required"); return value; },
            currentJournal: activeJournal,
            currentUnitSession: () => { if (!unit) throw new TypeError("Unit session required"); return unit; },
            inspectChoice: value => choices.inspectReceipt(value) });
          optionalSelected = { receipt, data, entry: adapter.entryForReceipt(receipt) };
          const result = beginDuelOptionalUnitPaymentV3(unit!, actor, { commandId: choice.commandId,
            expectedVersion: parsed.expectedVersion, command: { cardUID: choice.cardUID, choiceReceipt: receipt } });
          sync(result.session);
          if (result.outcome.status === "pending") {
            optionalChoice = null;
            ack = appliedAction();
          } else ack = result.outcome.status === "blocked" ? blocked(parsed, "单位费用或入场仍在等待规则闭合") :
            genericError(parsed, "额外费用选择未通过规则校验");
        }
      } else if ((engagement || pendingMove) && !["pass-focus", "assign-combat-damage"].includes(command.type)) {
        ack = blocked(parsed, "请先完成当前对决或待处理移动");
      } else if (["mulligan", "rune-energy", "rune-power", "gold-power", "pay-pending"].includes(command.type)) {
        const legacy = { type: "duel-command" as const, requestId: parsed.requestId, commandId: parsed.commandId,
          expectedVersion: parsed.expectedVersion, command };
        if (physicalUnit) {
          const authorizedPay = command.type !== "pay-pending" || project(actor).actions.some(action =>
            action.kind === "pay-pending" && action.enabled && action.paymentId === command.paymentId);
          if (!authorizedPay) ack = blocked(parsed, "当前资源不足或付款窗口已变化");
          else {
            const result = applyDuelPrintedUnitPhysicalChainResourceV4(physicalUnit, actor, {
              commandId: parsed.commandId, expectedVersion: parsed.expectedVersion, command: command as never,
            });
            syncPhysical(result);
            if (result.outcome.status === "paid" && physicalUnit) {
              const inspected = inspectDuelPrintedUnitPhysicalChainV4(physicalUnit);
              const finishResult = resumeDuelPrintedUnitPhysicalChainV4(physicalUnit, actor, {
                commandId: `__p4-internal:physical-unit:${parsed.commandId}`,
                expectedVersion: physicalUnit.commandSession.match.stateVersion,
                command: { cardUID: inspected.cardUID! },
              });
              syncPhysical(finishResult);
            }
            ack = result.outcome.status === "pending" || result.outcome.status === "paid"
              ? appliedAction() : result.outcome.status === "blocked"
                ? blocked(parsed, "资源操作仍在等待规则闭合") : genericError(parsed, "资源命令未通过规则校验");
          }
        } else if (spellSession && unit) {
          const pendingPayment = spellSession.commandSession.match.stage === "playing"
            ? spellSession.commandSession.match.frame.pendingPayment : null;
          if (command.type === "pay-pending" && pendingPayment) {
            const task = spellSession.commandSession.requiredTasks.find(entry => entry.paymentId === pendingPayment.paymentId);
            if (!task) throw new TypeError("Spell payment task is not bound");
            spellSourceAttestor({ match: spellSession.commandSession.match as DuelCanonicalPlayingStateV2,
              actor, paymentId: pendingPayment.paymentId, sourceReference: pendingPayment.sourceReference,
              finalResolvedCost: pendingPayment.resolvedCost, taskId: task.taskId,
              continuationId: task.continuationId, previous: task.sourceBinding });
          }
          const result = applyDuelSpellResourceCommandV2(spellSession, actor, { commandId: parsed.commandId,
            expectedVersion: parsed.expectedVersion, command: command as never });
          syncSpellResult(result);
          let paymentResult = result;
          if (result.outcome.status === "pending" && result.outcome.step === "priority" && spellSession &&
              spellSession.chain.phase === "finalize") {
            paymentResult = finalizeDuelSpellCardPlayV2(spellSession, actor);
            syncSpellResult(paymentResult);
          }
          // The resource operation has its own canonical receipt. An outstanding
          // Spell payment describes the next step, not failure of this Rune action.
          // Historical spell-v1 ACK bytes are kept for strict schema-3 replay.
          const resourceReceipt = publicChainEnabled &&
            result.outcome.status !== "blocked" && result.outcome.status !== "rejected"
            ? result.session.commandSession.receipts.find(receipt => receipt.actor === actor &&
              receipt.commandId === parsed.commandId && receipt.outcome.status === "applied") : undefined;
          ack = resourceReceipt?.outcome.status === "applied"
            ? { type: "request-result", requestId: parsed.requestId, commandId: parsed.commandId,
              ok: true, appliedVersion: resourceReceipt.outcome.appliedVersion,
              eventSeq: resourceReceipt.outcome.eventSeq, message: "已完成" }
            : paymentResult.outcome.status === "applied" || paymentResult.outcome.status === "pending" && paymentResult.outcome.step === "priority" ? appliedAction() :
              paymentResult.outcome.status === "pending" ? blocked(parsed, "法术付款仍在等待资源") :
              paymentResult.outcome.status === "blocked" ? blocked(parsed, "法术付款仍在等待规则闭合") :
              genericError(parsed, "法术资源命令未通过规则校验");
        } else if (unit) {
          const result = applyDuelUnitResourceCommandV2(unit, actor, { commandId: parsed.commandId,
            expectedVersion: parsed.expectedVersion, command: command as never });
          sync(result.session);
          if (optionalUnitEnabled && command.type === "pay-pending" && result.outcome.status === "applied")
            resumeOptionalEntry();
          ack = result.outcome.status === "applied" ? { type: "request-result", requestId: parsed.requestId, commandId: parsed.commandId,
            ok: true, appliedVersion: result.outcome.appliedVersion, eventSeq: result.outcome.eventSeq, message: "已完成" } :
            result.outcome.status === "blocked" ? blocked(parsed, "资源操作仍在等待规则闭合") :
            genericError(parsed, "资源命令未通过规则校验");
        } else {
          const result = applyDuelResourceCommandV2(session, actor, { commandId: parsed.commandId,
            expectedVersion: parsed.expectedVersion, command: command as never }, {});
          sync(null, result.session);
          ack = result.outcome.status === "applied" ? { type: "request-result", requestId: parsed.requestId, commandId: parsed.commandId,
            ok: true, appliedVersion: result.outcome.appliedVersion, eventSeq: result.outcome.eventSeq, message: "已完成" } :
            genericError(parsed, "资源命令未通过规则校验");
          autoStart();
        }
      } else if (!unit) {
        ack = genericError(parsed, "对局回合尚未准备完成");
      } else if (command.type === "play-card") {
        const expectedWindow = matchWindow(current as DuelCanonicalPlayingStateV2);
        const spellContinuation = !!(spellSession && (current as DuelCanonicalPlayingStateV2).chainCards?.some(card => card.uid === command.cardUID));
        if (command.windowId !== expectedWindow && !spellContinuation) ack = genericError(parsed, "操作窗口已变化，请使用最新对局状态");
        else {
          const services = ensureServices();
          if (!services) ack = blocked(parsed, "对局仍在等待规则闭合");
          else {
            const card = (current as DuelCanonicalPlayingStateV2).players.find(player => player.playerId === actor)?.hand
              .find(value => value.uid === command.cardUID);
            const spellCardId = card?.cardId ?? (current as DuelCanonicalPlayingStateV2).chainCards?.find(value =>
              value.uid === command.cardUID)?.cardId;
            if (physicalUnitEnabled && card && isPureAccelerateUnit(card.cardId)) {
              const permitted = project(actor).actions.some(action => action.kind === "play-card" &&
                action.enabled && action.cardUID === card.uid);
              if (!permitted || parsed.expectedVersion !== current.stateVersion)
                ack = genericError(parsed, "当前时点不能打出该单位");
              else {
                const started = beginDuelPrintedUnitPhysicalChainV4(
                  createDuelPrintedUnitChainSessionV4(unit!.commandSession, ensurePhysicalServices()), actor,
                  { commandId: parsed.commandId, expectedVersion: parsed.expectedVersion,
                    command: { cardUID: card.uid } });
                syncPhysical(started);
                if (started.outcome.status === "choice") {
                  physicalChoice = Object.freeze({ actor, commandId: parsed.commandId, cardUID: card.uid,
                    prompt: started.outcome.prompt, promptId: (options.uidFactory ?? randomUUID)() });
                  ack = appliedAction();
                } else ack = started.outcome.status === "blocked"
                  ? blocked(parsed, "单位物理链仍在等待规则闭合") : genericError(parsed, "单位出牌未通过规则校验");
              }
            } else if (physicalUnitEnabled) {
              ack = blocked(parsed, "此单位或法术来源尚未完成物理链规则证明");
            } else if (spellEnabled && spellCardId && isDrawSpell(authority, options.catalog, spellCardId)) {
              if (!spellSession) createSpell();
              const result = playDuelSpellCardV2(spellSession!, actor, { commandId: parsed.commandId,
                expectedVersion: parsed.expectedVersion, command: { cardUID: command.cardUID } });
              syncSpellResult(result);
              ack = result.outcome.status === "applied" ? { ...appliedAction(), ...(result.duplicate ? { duplicate: true } : {}) } :
                result.outcome.status === "pending" ? { ...blocked(parsed, "法术付款仍在等待资源"), ...(result.duplicate ? { duplicate: true } : {}) } :
                result.outcome.status === "blocked" ? blocked(parsed, "法术仍在等待规则闭合") :
                genericError(parsed, "法术出牌未通过规则校验");
            } else if (card && isPureAccelerateUnit(card.cardId)) {
              const permitted = project(actor).actions.some(action => action.kind === "play-card" &&
                action.enabled && action.cardUID === card.uid);
              if (!permitted || parsed.expectedVersion !== current.stateVersion)
                ack = genericError(parsed, "当前时点不能打出该单位");
              else {
                advanceOptionalChoiceClock(actor, card.uid, parsed.commandId, parsed.expectedVersion);
                const choiceHead = head();
                if (!choiceHead) throw new TypeError("optional choice head unavailable");
                const prompt = ensureOptionalChoice().issue({ actor, commandId: parsed.commandId,
                  expectedVersion: choiceHead.stateVersion, uid: card.uid });
                optionalChoice = Object.freeze({ actor, commandId: parsed.commandId, cardUID: card.uid,
                  prompt, promptId: (options.uidFactory ?? randomUUID)() });
                ack = appliedAction();
              }
            } else {
              const result = playDuelNoAbilityUnitToBaseV2(unit, actor, { commandId: parsed.commandId,
                expectedVersion: parsed.expectedVersion, command: { cardUID: command.cardUID } });
              sync(result.session);
              ack = result.outcome.status === "applied" ? { type: "request-result", requestId: parsed.requestId, commandId: parsed.commandId,
                ok: true, appliedVersion: result.outcome.appliedVersion, eventSeq: result.outcome.eventSeq, message: "已完成" } :
                result.outcome.status === "blocked" ? blocked(parsed, "单位出牌仍在等待规则闭合") :
                genericError(parsed, "单位出牌未通过规则校验");
            }
          }
        }
      } else if (command.type === "pass-priority") {
        const playing = current as DuelCanonicalPlayingStateV2;
        if (!spellSession || command.windowId !== matchWindow(playing) ||
            playing.frame.pendingPayment !== null || playing.frame.priorityPlayerId !== actor ||
            parsed.expectedVersion !== current.stateVersion) {
          ack = genericError(parsed, "优先权窗口已变化");
        } else {
          let result = passDuelSpellPriorityV2(spellSession, actor);
          syncSpellResult(result);
          if (result.outcome.status === "pending" && result.session.chain.phase === "resolve") {
            result = resolveDuelSpellCardPlayV2(result.session);
            syncSpellResult(result);
          }
          ack = result.outcome.status === "applied" || result.outcome.status === "pending" && result.outcome.step === "priority" ? appliedAction() :
            result.outcome.status === "pending" ? blocked(parsed, "法术效果仍在等待规则闭合") :
            result.outcome.status === "blocked" ? blocked(parsed, "法术链仍在等待规则闭合") :
            genericError(parsed, "优先权命令未通过规则校验");
        }
      } else if (command.type === "standard-move") {
        if (command.windowId !== matchWindow(current as DuelCanonicalPlayingStateV2))
          ack = genericError(parsed, "操作窗口已变化，请使用最新对局状态");
        else {
          const result = applyDuelUnitStandardMoveV2(unit, actor, { commandId: parsed.commandId,
            expectedVersion: parsed.expectedVersion, command: { unitUIDs: command.unitUIDs,
              destinationLocationId: command.destinationLocationId } });
          sync(result.session);
          pendingMove = result.outcome.status === "pending" ? { actor, commandId: parsed.commandId,
            requestId: parsed.requestId, taskId: result.outcome.taskId } : null;
          if (result.outcome.status === "applied") { openStagedEngagement(); pumpEngagement(); ack = appliedAction(); }
          else ack = result.outcome.status === "pending" || result.outcome.status === "blocked"
            ? blocked(parsed, "移动仍在等待规则闭合") : genericError(parsed, "移动未通过规则校验");
        }
      } else if (command.type === "pass-focus") {
        if (!engagement || engagement.status === "complete" || engagement.cursor.phase !== "focus" ||
            command.windowId !== matchWindow(current as DuelCanonicalPlayingStateV2) ||
            parsed.expectedVersion !== current.stateVersion)
          ack = genericError(parsed, "焦点操作窗口已变化");
        else {
          adoptEngagementStep(advanceDuelEngagementV2(engagement.cursor, { kind: "pass-focus",
            actorPlayerId: actor, expectedStateVersion: parsed.expectedVersion }));
          pumpEngagement();
          ack = appliedAction();
        }
      } else if (command.type === "assign-combat-damage") {
        const choice = combatChoice();
        if (!engagement || engagement.status === "complete" || !choice || command.choiceId !== choice.choiceId ||
            engagement.cursor.expectedActorPlayerId !== actor || parsed.expectedVersion !== current.stateVersion)
          ack = genericError(parsed, "伤害分配窗口已变化");
        else {
          adoptEngagementStep(advanceDuelEngagementV2(engagement.cursor, { kind: "assign-damage",
            choice: { actorPlayerId: actor, expectedStateVersion: parsed.expectedVersion,
              orderedUIDAmounts: command.assignments.map(value => ({ uid: value.unitObjectId, amount: value.amount })) } }));
          pumpEngagement();
          ack = appliedAction();
        }
      } else if (command.type === "end-turn") {
        const expectedWindow = matchWindow(current as DuelCanonicalPlayingStateV2);
        if (command.windowId !== expectedWindow) ack = genericError(parsed, "操作窗口已变化，请使用最新对局状态");
        else {
          const result = endDuelUnitTurnV2(unit, actor, { commandId: parsed.commandId,
            expectedVersion: parsed.expectedVersion, command: { type: "end-turn" } });
          sync(result.session);
          pendingTurn = result.outcome.status === "pending"
            ? { actor, commandId: parsed.commandId, requestId: parsed.requestId } : null;
          ack = result.outcome.status === "applied" ? { type: "request-result", requestId: parsed.requestId, commandId: parsed.commandId,
            ok: true, appliedVersion: result.outcome.appliedVersion, eventSeq: result.outcome.eventSeq, message: "已完成" } :
            result.outcome.status === "pending" ? blocked(parsed, "回合结束仍在等待规则闭合") :
            genericError(parsed, "当前不能结束回合");
          if (result.outcome.status === "applied") autoStart();
        }
      } else {
        ack = blocked(parsed, "此效果或选择尚未实现，需要裁判处理");
      }
      if (!(spellRetry && prior)) commandLedger.set(ledgerKey, Object.freeze({ fingerprint, ack: Object.freeze({ ...ack }) }));
      if (proposal) journal = proposal;
      proposal = null;
      return finish(parsed, ack);
    } catch (error) {
      if (forkAttempt || ownerAdvanced(before)) failClosed(error);
      proposal = null;
      const ack = genericError(parsed, "对局命令未通过规则校验");
      commandLedger.set(ledgerKey, Object.freeze({ fingerprint, ack: Object.freeze({ ...ack }) }));
      return finish(parsed, ack);
    } finally { proposal = null; operationHead = spellSession?.commandSession.match ?? null; inFlight = false; }
  };
  const resumePending = (): DuelAuthoritativeRuntimeP4Result | null => {
    assertOperational();
    if (!unit || inFlight) return null;
    if (physicalUnit && inspectDuelPrintedUnitPhysicalChainV4(physicalUnit).phase === "paid") {
      inFlight = true;
      const before = ownerSnapshot();
      let forkAttempt = true;
      try {
        proposal = journal.fork(ownedHead);
        forkAttempt = false;
        const inspected = inspectDuelPrintedUnitPhysicalChainV4(physicalUnit);
        const result = resumeDuelPrintedUnitPhysicalChainV4(physicalUnit, inspected.actor!, {
          commandId: `__p4-internal:physical-unit:resume:${physicalUnit.commandSession.match.stateVersion}`,
          expectedVersion: physicalUnit.commandSession.match.stateVersion,
          command: { cardUID: inspected.cardUID! },
        });
        syncPhysical(result);
        if (proposal) journal = proposal;
        return Object.freeze({ ack: Object.freeze(result.outcome.status === "applied"
          ? { type: "request-result" as const, ok: true as const,
              appliedVersion: unit!.commandSession.match.stateVersion,
              eventSeq: unit!.commandSession.match.eventSeq, message: "已完成" }
          : { type: "blocked" as const, pending: true as const, message: "单位入场仍在等待规则闭合" }),
          projection: project(null) });
      } catch (error) {
        if (forkAttempt || ownerAdvanced(before)) failClosed(error);
        throw error;
      } finally { proposal = null; operationHead = null; inFlight = false; }
    }
    if (optionalUnitEnabled && optionalContinuation()?.status === "pending") {
      if (unit.commandSession.match.stage !== "playing" || unit.commandSession.match.frame.pendingPayment !== null)
        return null;
      inFlight = true;
      const before = ownerSnapshot();
      let forkAttempt = true;
      try {
        proposal = journal.fork(ownedHead);
        forkAttempt = false;
        const result = resumeOptionalEntry();
        if (proposal) journal = proposal;
        return result ? Object.freeze({ ack: Object.freeze(result.outcome.status === "applied"
          ? { type: "request-result" as const, ok: true as const,
              appliedVersion: unit!.commandSession.match.stateVersion,
              eventSeq: unit!.commandSession.match.eventSeq, message: "已完成" }
          : { type: "blocked" as const, pending: true as const, message: "单位入场仍在等待规则闭合" }),
          projection: project(null) }) : null;
      } catch (error) {
        if (forkAttempt || ownerAdvanced(before)) failClosed(error);
        throw error;
      } finally { proposal = null; operationHead = null; inFlight = false; }
    }
    if (spellSession) {
      const privateState = inspectDuelSpellPrivateStateV2(spellSession);
      if (privateState.pendingCost || privateState.pendingEffect || spellSession.chain.phase === "resolve") {
        inFlight = true;
        const before = ownerSnapshot();
        let forkAttempt = true;
        try {
          proposal = journal.fork(ownedHead);
          forkAttempt = false;
          let result: DuelSpellCardPlayResultV2;
          if (privateState.pendingCost) result = resumeDuelSpellPaymentV2(spellSession);
          else if (privateState.pendingEffect) result = resumeDuelSpellEffectV2(spellSession);
          else result = resolveDuelSpellCardPlayV2(spellSession);
          syncSpellResult(result);
          if (result.outcome.status === "applied") {
            for (const [key, value] of commandLedger) if (value.ack.pending)
              commandLedger.set(key, Object.freeze({ ...value, ack: Object.freeze({ type: "request-result" as const,
                commandId: value.ack.commandId, requestId: value.ack.requestId, ok: true as const,
                appliedVersion: result.outcome.appliedVersion, eventSeq: result.outcome.eventSeq, message: "已完成" }) }));
          }
          if (proposal) journal = proposal;
          const ack: DuelAuthoritativeRuntimeP4Ack = result.outcome.status === "applied"
            ? { type: "request-result", ok: true, appliedVersion: result.outcome.appliedVersion,
              eventSeq: result.outcome.eventSeq, message: "已完成" }
            : { type: "blocked", pending: true, message: "法术仍在等待规则闭合" };
          return Object.freeze({ ack: Object.freeze(ack), projection: project(null) });
        } catch (error) {
          if (forkAttempt || ownerAdvanced(before)) failClosed(error);
          throw error;
        } finally { proposal = null; operationHead = spellSession?.commandSession.match ?? null; inFlight = false; }
      }
    }
    if (pendingMove || engagement?.status === "pending") {
      inFlight = true;
      const before = ownerSnapshot();
      let forkAttempt = true;
      try {
        proposal = journal.fork(ownedHead);
        forkAttempt = false;
        if (pendingMove) {
          const continuation = pendingMove;
          const result = resumeDuelUnitStandardMoveV2(unit, continuation.actor, continuation.commandId, continuation.taskId);
          sync(result.session);
          if (result.outcome.status === "applied") {
            pendingMove = null;
            openStagedEngagement(); pumpEngagement();
            const current = unit!.commandSession.match;
            const receipt = commandLedger.get(keyFor(continuation.actor, continuation.commandId));
            if (receipt) commandLedger.set(keyFor(continuation.actor, continuation.commandId), Object.freeze({ ...receipt,
              ack: Object.freeze({ type: "request-result" as const, requestId: continuation.requestId,
                commandId: continuation.commandId, ok: true as const, appliedVersion: current.stateVersion,
                eventSeq: current.eventSeq, message: "已完成" }) }));
          }
        } else if (engagement?.status === "pending" && !["focus", "damage"].includes(engagement.cursor.phase)) {
          adoptEngagementStep(advanceDuelEngagementV2(engagement.cursor,
            { kind: "continue", expectedStateVersion: engagement.match.stateVersion }));
          pumpEngagement();
        }
        if (proposal) journal = proposal;
        return Object.freeze({ ack: Object.freeze(pendingMove || engagement?.status === "pending"
          ? { type: "blocked" as const, pending: true as const, message: "对决仍在等待规则闭合" }
          : { type: "request-result" as const, ok: true as const, appliedVersion: unit!.commandSession.match.stateVersion,
            eventSeq: unit!.commandSession.match.eventSeq, message: "已完成" }), projection: project(null) });
      } catch (error) {
        if (forkAttempt || ownerAdvanced(before)) failClosed(error);
        throw error;
      } finally { proposal = null; operationHead = null; inFlight = false; }
    }
    if (!pendingTurn) return null;
    const current = unit.commandSession.match;
    if (current.stage !== "playing") return null;
    const cursor = unit.commandSession.turnCursorV2;
    if (!cursor?.pendingTaskID) return null;
    inFlight = true;
    const before = ownerSnapshot();
    let forkAttempt = true;
    const continuation = pendingTurn;
    try {
      proposal = journal.fork(ownedHead);
      forkAttempt = false;
      const result = resumeDuelUnitTurnV2(unit, continuation.actor, continuation.commandId, cursor.pendingTaskID);
      sync(result.session);
      const ack: DuelAuthoritativeRuntimeP4Ack = result.outcome.status === "applied"
        ? { type: "request-result", ok: true, commandId: continuation.commandId,
          ...(continuation.requestId ? { requestId: continuation.requestId } : {}),
          appliedVersion: result.outcome.appliedVersion, eventSeq: result.outcome.eventSeq, message: "已完成" }
        : { type: "blocked", pending: true, message: "回合仍在等待规则闭合" };
      if (result.outcome.status === "applied") {
        pendingTurn = null;
        const receipt = commandLedger.get(keyFor(continuation.actor, continuation.commandId));
        if (receipt) commandLedger.set(keyFor(continuation.actor, continuation.commandId),
          Object.freeze({ ...receipt, ack: Object.freeze({ ...ack }) }));
        autoStart();
      }
      if (proposal) journal = proposal;
      proposal = null;
      return Object.freeze({ ack: Object.freeze({ ...ack }), projection: project(null) });
    } catch (error) {
      if (forkAttempt || ownerAdvanced(before)) failClosed(error);
      throw error;
    } finally { proposal = null; operationHead = null; inFlight = false; }
  };
  const owner = Object.freeze({ project, dispatch, resumePending, durability: "in-memory" as const });
  privateFingerprints.set(owner, () => {
    assertOperational();
    const currentSession = physicalUnit?.commandSession ?? spellSession?.commandSession ?? unit?.commandSession ?? session;
    return createHash("sha256").update(stable({
    profile: resolvedCostHistoryEnabled ? DUEL_RUNTIME_SEMANTIC_VERSION_P4_OPTIONAL_UNIT_RESOLVED_HISTORY : physicalUnitEnabled ? DUEL_RUNTIME_SEMANTIC_VERSION_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN :
      (spellSession || spellServices || spellPrivateHistory.length)
        ? "riftbound-p4-native-owner-private-v2" : "riftbound-p4-native-owner-private-v1",
    match: currentSession.match,
    canonicalReceipts: currentSession.receipts,
    requiredTasks: currentSession.requiredTasks,
    priorityPayments: currentSession.priorityPayments,
    turnCursor: currentSession.turnCursorV2 ?? null,
    unitReceipts: unit?.receipts ?? [], pendingTurn, pendingMove,
    ...(physicalUnitEnabled ? { physicalChoice,
      physicalUnit: physicalUnit ? inspectDuelPrintedUnitPhysicalChainV4(physicalUnit) : null } : {}),
    ...(optionalUnitEnabled ? { optionalChoice, optionalSelected: optionalSelected?.data ?? null,
      optionalPayment: optionalContinuation(), optionalPaymentPin: optionalPaymentPin
        ? { proofId: optionalPaymentPin.proofId, paymentId: optionalPaymentPin.paymentId,
            taskId: optionalPaymentPin.taskId, continuationId: optionalPaymentPin.continuationId,
            cost: optionalPaymentPin.cost } : null } : {}),
    engagement: engagement?.status === "complete" ? null : engagement?.cursor ?? null,
    ...(spellSession || spellServices || spellPrivateHistory.length ? { runtimeProfile,
      spell: spellSession ? inspectDuelSpellPrivateStateV2(spellSession) : null,
      spellService: spellServices?.privateFingerprintData() ?? null,
      spellPrivateHistory,
    } : {}),
    commandLedger: [...commandLedger],
    })).digest("hex");
  });
  return owner;
}

/** Short alias used by room integration work. */
export const createDuelAuthoritativeRuntimeP4 = createAuthoritativeDuelRuntimeP4;
