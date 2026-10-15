/**
 * Production source provider for the reviewed Point-damage Spell slice.
 *
 * This module is intentionally an evidence provider.  Core still owns marks,
 * lethal planning, zone transitions and Chain commitment.  A missing or
 * ambiguous source fact returns `pending`; no callback in this file invents a
 * replacement, a current Might value, or a damage result.
 */
import {
  assertCurrentDuelPhysicalReferenceV2,
  assertAdmittedDuelMatchV2,
  enumerateDuelPhaseSourceClosureCandidatesV2,
  inspectDuelNativeTokenHistoryV2,
  type DuelCanonicalPlayingStateV2,
} from "@riftbound/engine-core/duel";
import type {
  DuelPointDamageEffectAuthorityOptionsV1,
  DuelPointDamageProposalV1,
} from "@riftbound/engine-core/duel";
import type { DuelOfficialProgramRegistry } from "@riftbound/card-dsl/duel";
import { getCardProgramRegistryForRuntime, type CardProgramAuthority } from "./card-program-authority.js";
import type { DuelPhaseSourceClosureContextV2 } from "@riftbound/engine-core/duel";
import type { DuelProductionSourceServicesV2 } from "./production-source-services-v2.js";

export interface DuelPointEffectProductionServicesOptionsV1 {
  /** The authoritative current Core head. A copied DTO is rejected. */
  readonly currentHead: () => DuelCanonicalPlayingStateV2 | null;
  /** Identity guarded server catalog/program authority. */
  readonly programAuthority?: CardProgramAuthority;
  /** Compatibility spelling used by server owners. */
  readonly programs?: CardProgramAuthority;
  /** Optional direct registry for an already-bound Core caller. */
  readonly programRegistry?: DuelOfficialProgramRegistry;
  /** Complete global source census and derived Might service. */
  readonly sourceServices: DuelProductionSourceServicesV2;
  /** Optional private CardPlay session used to bind effectId to the Chain item. */
  readonly currentSession?: () => unknown;
  /** Optional native journal. It is checked when present, never treated as a DTO. */
  readonly currentJournal?: () => { readonly currentHead?: () => unknown; readonly observedHead?: () => unknown };
}

export interface DuelPointEffectProductionServicesV1 {
  readonly resolveDamage: NonNullable<DuelPointDamageEffectAuthorityOptionsV1["resolveDamage"]>;
  readonly resolveLethal: NonNullable<DuelPointDamageEffectAuthorityOptionsV1["resolveLethal"]>;
}

export type DuelPointDamageProductionServicesOptionsV1 = DuelPointEffectProductionServicesOptionsV1;
export type DuelPointDamageProductionServicesV1 = DuelPointEffectProductionServicesV1;
type PointDamageResolverV1 = NonNullable<DuelPointDamageEffectAuthorityOptionsV1["resolveDamage"]>;
type PointLethalResolverV1 = NonNullable<DuelPointDamageEffectAuthorityOptionsV1["resolveLethal"]>;

const POINT_AMOUNTS = new Set([2, 3, 6, 8]);
interface PointResolvedDamageMarkV1 {
  readonly uid: string;
  readonly amount: number;
  readonly responsiblePlayerId: string;
  readonly sourceObjectIds: readonly string[];
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function safeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}
function plainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every(key => typeof key === "string" &&
    !!Object.getOwnPropertyDescriptor(value, key) &&
    "value" in Object.getOwnPropertyDescriptor(value, key)!);
}
function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!plainRecord(value)) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && keys.every(key => own.includes(key));
}
function immutableData(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== "object") return true;
  if (seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Reflect.ownKeys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !!descriptor && "value" in descriptor && immutableData(descriptor.value, seen);
  });
}
function denseArray(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes("length")) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) return false;
  }
  return true;
}
function stringList(value: unknown): value is readonly string[] {
  return denseArray(value) && value.every(item => nonBlank(item));
}
function sameZone(a: unknown, b: unknown): boolean {
  if (!plainRecord(a) || !plainRecord(b)) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === "board-base" || a.kind === "board-battlefield") return a.locationId === b.locationId;
  return a.zonePlayerId === b.zonePlayerId;
}
function sameSourceCandidate(a: any, b: any): boolean {
  return !!a && !!b && a.uid === b.uid && a.kind === b.kind && a.cardId === b.cardId &&
    a.zoneEpoch === b.zoneEpoch && a.controllerPlayerId === b.controllerPlayerId &&
    a.ownerPlayerId === b.ownerPlayerId && sameZone(a.zone, b.zone);
}
function sumDamage(marks: readonly { readonly amount: number }[]): number | null {
  let total = 0;
  for (const mark of marks) {
    if (!safeInt(mark.amount) || mark.amount < 0 || total > Number.MAX_SAFE_INTEGER - mark.amount) return null;
    total += mark.amount;
  }
  return total;
}
function pending(reason: string): { readonly status: "pending"; readonly reason: string } {
  return Object.freeze({ status: "pending" as const, reason });
}

/**
 * Build the two callbacks consumed by `createDuelPointDamageEffectAuthorityV1`.
 * The factory performs a positive catalog census up front so a misconfigured
 * server cannot present an all-negative provider as a production closure.
 */
export function createDuelPointEffectProductionServicesV1(
  options: DuelPointEffectProductionServicesOptionsV1,
): DuelPointEffectProductionServicesV1 {
  if (!options || typeof options.currentHead !== "function" || !options.sourceServices ||
      typeof options.sourceServices.inspect !== "function" ||
      typeof options.sourceServices.derivedMight !== "function") {
    throw new TypeError("Point production source services require a current head and complete source services");
  }
  const authority = options.programAuthority ?? options.programs;
  if (!authority && !options.programRegistry) throw new TypeError("Point program authority required");
  let registry: DuelOfficialProgramRegistry;
  try {
    registry = options.programRegistry ?? getCardProgramRegistryForRuntime(authority!);
  } catch {
    throw new TypeError("genuine Point program authority required");
  }
  if (authority && authority.census.resolvedPrograms <= 0) {
    throw new TypeError("positive Point catalog/program census required");
  }
  if (!authority && registry.knownProgramCount <= 0) {
    throw new TypeError("positive Point registry census required");
  }
  let pointProgramCount = 0;
  try {
    for (const cardId of registry.cardIds()) {
      const program = registry.getProgram(cardId);
      if (program?.semantics.kind === "point-damage-spell-resolution" &&
          program.semantics.effects.length === 1 && program.semantics.effects[0]?.kind === "point-damage") pointProgramCount += 1;
    }
  } catch { pointProgramCount = 0; }
  if (pointProgramCount <= 0) throw new TypeError("positive Point program census required");

  function current(state: DuelCanonicalPlayingStateV2): boolean {
    try {
      const head = options.currentHead();
      if (head !== state || state.stage !== "playing") return false;
      assertAdmittedDuelMatchV2(state);
      if (options.currentJournal) {
        const journal = options.currentJournal();
        if (!journal || typeof journal !== "object") return false;
        if (journal.currentHead && journal.currentHead() !== state) return false;
        if (journal.observedHead && journal.observedHead() !== state) return false;
      }
      return true;
    } catch { return false; }
  }

  function sourceProgram(state: DuelCanonicalPlayingStateV2, source: any): any | null {
    if (!plainRecord(source) || !nonBlank(source.sourceUID) || !safeInt(source.sourceZoneEpoch) ||
        !nonBlank(source.controllerPlayerId) || !nonBlank(source.cardId) || !nonBlank(source.programId) ||
        !nonBlank(source.dataVersion) || !nonBlank(source.catalogDigest) || !nonBlank(source.effectId) ||
        !nonBlank(source.window)) return null;
    if (source.dataVersion !== state.dataVersion || source.catalogDigest !== state.catalogDigest ||
        source.phase !== "spell-resolution" || source.window !== "main") return null;
    try {
      const reference = registry.reference(source.cardId);
      if (!reference || reference.cardId !== source.cardId || reference.programId !== source.programId ||
          reference.dataVersion !== source.dataVersion || reference.sourceCatalogDigest !== source.catalogDigest)
        return null;
      const resolved = registry.resolve(reference);
      const program = resolved.status === "resolved" ? resolved.program : null;
      if (!program || program.semantics.kind !== "point-damage-spell-resolution" ||
          program.semantics.effects.length !== 1 || program.semantics.effects[0]?.kind !== "point-damage") return null;
      const candidate = enumerateDuelPhaseSourceClosureCandidatesV2(state).find(item => item.uid === source.sourceUID);
      const physical = state.physicalCardsByUID[source.sourceUID];
      const chainCard = state.chainCards?.find(item => item.uid === source.sourceUID);
      if (!candidate || candidate.kind !== "card" || candidate.zone.kind !== "chain" ||
          candidate.cardId !== source.cardId || candidate.zoneEpoch !== source.sourceZoneEpoch ||
          candidate.controllerPlayerId !== source.controllerPlayerId || !physical ||
          physical.cardId !== source.cardId || physical.zoneEpoch !== source.sourceZoneEpoch ||
          !chainCard || chainCard.controllerPlayerId !== source.controllerPlayerId || chainCard.cardId !== source.cardId)
        return null;
      if (options.currentSession) {
        const session = options.currentSession();
        if (!plainRecord(session) || !plainRecord(session.chain) || !denseArray(session.chain.items)) return null;
        const effectId = source.effectId as string;
        const itemIds = effectId.endsWith(":effect") ? [effectId, effectId.slice(0, -7)] : [effectId];
        const items = session.chain.items as readonly any[];
        const item = items.find((item: any) => plainRecord(item) && itemIds.includes(item.id as string));
        if (!item || item.controllerPlayerId !== source.controllerPlayerId ||
            item.status !== "finalized" || item.resolutionMode !== "fepr") return null;
      }
      return program;
    } catch { return null; }
  }

  function context(state: DuelCanonicalPlayingStateV2, source: any, event: "lethal-kill" | "fepr" | "required-cleanup" | "continuous"): DuelPhaseSourceClosureContextV2 {
    return Object.freeze({ matchId: state.matchId, dataVersion: state.dataVersion,
      catalogDigest: state.catalogDigest, turn: state.frame.turnNumber,
      taskId: `duel-v2:${state.matchId}:turn-${state.frame.turnNumber}:point-effect:${source.effectId}:${event}`,
      phase: event === "continuous" ? "required-cleanup" : event, event: event === "continuous" ? "continuous" : event,
      clock: Object.freeze({ stateVersion: state.stateVersion, eventSeq: state.eventSeq }) });
  }
  function ownRuntime(source: any, candidate: any): boolean {
    return candidate?.carrier === "runtime-effect" && candidate.effectId === source.effectId &&
      candidate.sourceUID === source.sourceUID && candidate.zoneEpoch === source.sourceZoneEpoch &&
      candidate.controllerPlayerId === source.controllerPlayerId;
  }
  function closed(state: DuelCanonicalPlayingStateV2, source: any, event: "lethal-kill" | "fepr" | "required-cleanup"): boolean {
    try {
      const inspected = options.sourceServices.inspect(context(state, source, event));
      if (!inspected || inspected.status !== "ready" ||
          inspected.handlers.some(candidate => !ownRuntime(source, candidate)) ||
          inspected.activeSources.some(candidate => !ownRuntime(source, candidate)))
        return false;
      const sourceCandidate = enumerateDuelPhaseSourceClosureCandidatesV2(state).find(item => item.uid === source.sourceUID);
      if (!sourceCandidate || !inspected.candidates.some(candidate => sameSourceCandidate(candidate, sourceCandidate))) return false;
      return inspected.runtimeSources.every(candidate => ownRuntime(source, candidate));
    } catch { return false; }
  }
  function target(state: DuelCanonicalPlayingStateV2, uid: string, location: "battlefield" | "any"): boolean {
    if (!nonBlank(uid)) return false;
    const unit = state.board.units.find(value => value.objectId === uid);
    const meta = state.unitMeta[uid];
    if (!unit || !meta || (location === "battlefield" && !state.board.battlefields.some(field => field.locationId === unit.locationId)) ||
        (location === "any" && !state.board.bases.some(base => base.locationId === unit.locationId) &&
          !state.board.battlefields.some(field => field.locationId === unit.locationId))) return false;
    if (meta.trait.kind === "token") {
      const birth = inspectDuelNativeTokenHistoryV2(state).births.filter(item => item.kind === "recruit" && item.tokenUID === uid);
      return birth.length === 1 && !state.retiredUnitTokenUIDs.includes(uid);
    }
    const view = enumerateDuelPhaseSourceClosureCandidatesV2(state).find(item => item.uid === uid);
    if (!view || view.kind !== "unit" || view.zoneEpoch === null) return false;
    try { assertCurrentDuelPhysicalReferenceV2(state, { uid, zoneEpoch: view.zoneEpoch }); return true; }
    catch { return false; }
  }
  function sameDamageMark(actual: any, expected: any): boolean {
    return exactRecord(actual, ["amount", "responsiblePlayerId", "sourceObjectIds"]) &&
      actual.amount === expected.amount && actual.responsiblePlayerId === expected.responsiblePlayerId &&
      stringList(actual.sourceObjectIds) && stringList(expected.sourceObjectIds) &&
      actual.sourceObjectIds.length === expected.sourceObjectIds.length &&
      actual.sourceObjectIds.every((value: string, index: number) => value === expected.sourceObjectIds[index]);
  }
  function sameTrait(actual: any, expected: any): boolean {
    if (!plainRecord(actual) || !plainRecord(expected) || actual.kind !== expected.kind) return false;
    if (expected.kind === "card")
      return exactRecord(actual, ["kind", "cardId"]) && actual.cardId === expected.cardId;
    return exactRecord(actual, ["kind", "name", "baseMight", "tags"]) && actual.name === expected.name &&
      actual.baseMight === expected.baseMight && stringList(actual.tags) && stringList(expected.tags) &&
      actual.tags.length === (expected.tags as readonly string[]).length &&
      actual.tags.every((value: string, index: number) => value === (expected.tags as readonly string[])[index]);
  }
  function sameSnapshot(actual: any, expected: any): boolean {
    if (!exactRecord(actual, ["objectId", "controllerPlayerId", "locationId", "ownerPlayerId", "readied", "trait", "totalDamage", "damageMarks"]) ||
        actual.objectId !== expected.objectId || actual.controllerPlayerId !== expected.controllerPlayerId ||
        actual.locationId !== expected.locationId || actual.ownerPlayerId !== expected.ownerPlayerId ||
        actual.readied !== expected.readied || actual.totalDamage !== expected.totalDamage ||
        !sameTrait(actual.trait, expected.trait) || !denseArray(actual.damageMarks) ||
        actual.damageMarks.length !== expected.damageMarks.length) return false;
    return actual.damageMarks.every((mark: any, index: number) => sameDamageMark(mark, expected.damageMarks[index]));
  }
  function expectedSnapshot(state: DuelCanonicalPlayingStateV2, uid: string, amount: number, source: any): any | null {
    const unit = state.board.units.find(value => value.objectId === uid);
    const meta = state.unitMeta[uid];
    if (!unit || !meta || !denseArray(meta.damageMarks)) return null;
    const before = sumDamage(meta.damageMarks);
    if (before === null || before > Number.MAX_SAFE_INTEGER - amount) return null;
    const mark = { amount, responsiblePlayerId: source.controllerPlayerId, sourceObjectIds: [source.sourceUID] };
    const damageMarks = [...meta.damageMarks, mark];
    return { objectId: uid, controllerPlayerId: unit.controllerPlayerId, locationId: unit.locationId,
      ownerPlayerId: meta.ownerPlayerId, readied: meta.readied, trait: meta.trait, totalDamage: before + amount, damageMarks };
  }
  function validRequest(request: any): { state: DuelCanonicalPlayingStateV2; source: any; program: any; ids: readonly string[]; amount: number } | null {
    if (!plainRecord(request) || !current(request.state as DuelCanonicalPlayingStateV2) || !plainRecord(request.source) || !stringList(request.targetUIDs) ||
        request.targetUIDs.length !== 1 || !safeInt(request.amount) || !POINT_AMOUNTS.has(request.amount)) return null;
    const state = request.state as DuelCanonicalPlayingStateV2;
    const program = sourceProgram(state, request.source);
    if (!program) return null;
    const effect = program.semantics.effects[0];
    if (effect.amount !== request.amount || effect.target.kind !== "unit" || effect.target.controller !== "any" ||
        effect.target.minSelections !== 1 || effect.target.maxSelections !== 1 || !target(state, request.targetUIDs[0]!, effect.target.location)) return null;
    if (!closed(state, request.source, "lethal-kill") || !closed(state, request.source, "fepr") ||
        !closed(state, request.source, "required-cleanup")) return null;
    return { state, source: request.source, program, ids: request.targetUIDs, amount: request.amount };
  }

  const resolveDamage: PointDamageResolverV1 = request => {
    try {
      const valid = validRequest(request);
      if (!valid) return pending("point-source-or-closure-pending");
      const marks: readonly PointResolvedDamageMarkV1[] = Object.freeze(valid.ids.map(uid => Object.freeze({
        uid, amount: valid.amount, responsiblePlayerId: valid.source.controllerPlayerId,
        sourceObjectIds: Object.freeze([valid.source.sourceUID]),
      })));
      return Object.freeze({ status: "approved" as const, resolvedMarks: marks,
        proofId: `point-damage:${valid.state.matchId}:${valid.state.stateVersion}:${valid.source.effectId}:${valid.ids[0]}:${valid.amount}`,
        targetLegality: "approved" as const, preventionReplacement: "resolved" as const,
        attribution: "approved" as const, requiredCleanup: "scheduled" as const });
    } catch { return pending("point-source-or-closure-pending"); }
  };

  function validProposal(request: any, valid: NonNullable<ReturnType<typeof validRequest>>): boolean {
    const proposal: DuelPointDamageProposalV1 = request.proposedDamage;
    if (!exactRecord(proposal, ["kind", "baseStateVersion", "resultStateVersion", "marks", "plan"]) ||
        !immutableData(proposal) ||
        proposal.kind !== "duel-damage-proposal-v2" || proposal.plan !== request.plan ||
        proposal.baseStateVersion !== valid.state.stateVersion || proposal.resultStateVersion !== valid.state.stateVersion + 1 ||
        !denseArray(proposal.marks) || proposal.marks.length !== 1 || !plainRecord(request.plan) ||
        request.plan.kind !== "passive" ||
        request.plan.stateVersion !== valid.state.stateVersion + 1 || !denseArray(request.plan.snapshots) || request.plan.snapshots.length !== 1)
      return false;
    const mark = proposal.marks[0];
    if (!exactRecord(mark, ["uid", "amount", "responsiblePlayerId", "sourceObjectIds"]) || mark.uid !== valid.ids[0] || mark.amount !== valid.amount ||
        mark.responsiblePlayerId !== valid.source.controllerPlayerId || !stringList(mark.sourceObjectIds) ||
        mark.sourceObjectIds.length !== 1 || mark.sourceObjectIds[0] !== valid.source.sourceUID) return false;
    const snapshot: any = request.plan.snapshots[0];
    const expected = expectedSnapshot(valid.state, valid.ids[0]!, valid.amount, valid.source);
    return expected !== null && sameSnapshot(snapshot, expected);
  }

  const resolveLethal: PointLethalResolverV1 = request => {
    try {
      const valid = validRequest({ state: request.state, source: request.source, targetUIDs: [request.plan?.snapshots?.[0]?.objectId], amount: request.proposedDamage?.marks?.[0]?.amount });
      if (!valid || !validProposal(request, valid)) return pending("point-lethal-proposal-pending");
      const uid = valid.ids[0]!;
      const might = options.sourceServices.derivedMight(uid, context(valid.state, valid.source, "continuous"));
      if (!plainRecord(might) || might.status !== "complete" || might.uid !== uid ||
          !safeInt(might.baseMight) || might.baseMight < 0 || !safeInt(might.currentMight) || might.currentMight < 0 ||
          !current(valid.state) || !closed(valid.state, valid.source, "lethal-kill"))
        return pending("current-might-or-lethal-closure-pending");
      const snapshot = request.plan.snapshots[0]!;
      const candidate = Object.freeze({ unitUID: uid, currentMight: might.currentMight,
        lethalDamageThreshold: might.currentMight, totalDamage: snapshot.totalDamage });
      const lethal = snapshot.totalDamage >= might.currentMight;
      return Object.freeze({ status: "approved" as const, approvedUnitUIDs: Object.freeze(lethal ? [uid] : []),
        proofId: `point-lethal:${valid.state.matchId}:${valid.state.stateVersion}:${valid.source.effectId}:${uid}:${snapshot.totalDamage}:${might.currentMight}`,
        targetLegality: "approved" as const, deathknell: "resolved" as const, replacements: "resolved" as const,
        proposal: request.proposedDamage, lethalProof: Object.freeze({ kind: "duel-lethal-candidate-proof-v2" as const,
          proposal: request.proposedDamage, candidates: Object.freeze(lethal ? [candidate] : []),
          evaluatorProofId: `might:${valid.state.matchId}:${valid.state.stateVersion}:${uid}:${might.currentMight}` }) });
    } catch { return pending("point-lethal-proposal-pending"); }
  };

  return Object.freeze({ resolveDamage, resolveLethal });
}

export const createDuelPointDamageProductionServicesV1 = createDuelPointEffectProductionServicesV1;
export const createDuelPointEffectProductionProviderV1 = createDuelPointEffectProductionServicesV1;
export const createDuelPointDamageProductionProviderV1 = createDuelPointEffectProductionServicesV1;
