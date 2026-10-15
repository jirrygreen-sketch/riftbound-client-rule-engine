/** Production composition for the physical Gear CardPlay Chain V1 path.
 *
 * This adapter is intentionally narrower than the Equip program registry.  It
 * resolves printed Gear CardPlay cost from the catalog, while treating the
 * colon-prefixed Equip activation IR as a separate pending capability.  All
 * positive answers are tied to the exact current head, native journal and
 * process-local lifecycle proof supplied by engine-core.
 */
import { createHash } from "node:crypto";
import {
  assertAdmittedDuelMatchV2,
  bindDuelPrintedCost,
  createDuelCostResolverAuthorityV2,
  resolveDuelTotalCostV2,
  fingerprintDuelCostCoverageV2,
  enumerateDuelPhaseSourceClosureCandidatesV2,
  createDuelPhaseSourceClosureJournalV2,
  inspectDuelPhaseSourceClosureV2,
  inspectDuelNativeCommandSessionPathV2,
  inspectDuelNativeCommitPathV2,
  type DuelCanonicalPlayingStateV2,
  type DuelCostResolverAuthorityV2,
  type DuelCostVerifiedSourcesV2,
  type DuelCommandSessionV2,
  type DuelRuneCost,
  type DuelPhaseSourceClosureCandidateV2,
  type DuelPhaseSourceClosureContextV2,
  type DuelPhaseSourceClosureJournalV2,
  type DuelPhaseSourceClosureRegistryV2,
  type DuelPhaseClosureCoreRequestV2,
  type DuelPhaseClosureJournalResolutionV2,
  type DuelPhaseClosureRequirementV2,
  type DuelPrintedGearChainCostFactoryRequestV1,
  type DuelPrintedGearCostBindingV1,
  type DuelPrintedGearEntryFactsV1,
  type DuelPrintedGearEntryRequestV1,
  type DuelPrintedGearPlayServicesV1,
  type DuelPrintedGearProgramBindingV1,
  type DuelPrintedGearProgramRequestV1,
  type DuelSourceAttestationRequestV2,
  type DuelSourceBindingV2,
} from "@riftbound/engine-core/duel";
import { assertDuelOfficialProgram, type DuelOfficialProgram } from "@riftbound/card-dsl/duel";
import type { CardCatalogRuntime, PublicCatalogCard } from "../card-catalog.js";
import { getCardProgramRegistryForRuntime, type CardProgramAuthority } from "./card-program-authority.js";
import { inspectDuelNativeOperationJournalBindingV2, type DuelNativeCostCensusV2, type DuelNativeOperationJournalV2 } from "./operation-journal-v2.js";
import { createDuelPhaseSourceServerBridgeV2 } from "./phase-source-bridge-v2.js";

export interface DuelGearChainProductionServicesOptionsV1 {
  readonly catalog: CardCatalogRuntime;
  readonly programs: CardProgramAuthority;
  readonly matchId: string;
  readonly currentHead: () => DuelCanonicalPlayingStateV2 | null;
  readonly currentSession: () => DuelCommandSessionV2;
  readonly currentJournal: () => DuelNativeOperationJournalV2;
}

export interface DuelGearChainProductionServicesV1 extends DuelPrintedGearPlayServicesV1 {
  readonly inspectClosure: (request: Readonly<DuelPrintedGearEntryRequestV1>,
    context: Readonly<DuelPhaseSourceClosureContextV2>) => {
      readonly status: "ready" | "pending";
      readonly registry?: DuelPhaseSourceClosureRegistryV2;
      readonly journal?: DuelPhaseSourceClosureJournalV2;
      readonly reason?: string;
    };
}

type Candidate = DuelPhaseSourceClosureCandidateV2;
type Snapshot = NonNullable<ReturnType<DuelNativeOperationJournalV2["read"]>>;
interface GearCostPin {
  binding?: DuelSourceBindingV2;
  readonly actor: string;
  readonly uid: string;
  readonly cardId: string;
  readonly sourceEpoch: number;
  readonly authority: DuelCostResolverAuthorityV2;
  readonly fixed: ReturnType<typeof resolveDuelTotalCostV2>;
  readonly cost: DuelRuneCost;
  readonly issuedAt: DuelCanonicalPlayingStateV2;
  readonly commandSession: DuelCommandSessionV2;
  readonly journal: DuelNativeOperationJournalV2;
  readonly census: DuelNativeCostCensusV2;
  readonly baseProofId: string;
  readonly coverageProofId: string;
  readonly transactionId: string;
  readonly commandId: string;
  readonly programFingerprint: string;
  readonly baseLocationId: string;
}

function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function digest(value: unknown): string { return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }
function key(source: Candidate): string {
  const zone = source.zone;
  return JSON.stringify([source.carrier, source.uid, source.zoneEpoch, zone.kind,
    "locationId" in zone ? zone.locationId : zone.zonePlayerId]);
}
function sourceCard(catalog: CardCatalogRuntime, cardId: string): PublicCatalogCard | undefined {
  return catalog.publicCatalog.cards.find(card => card.id === cardId);
}
function currentCandidates(match: DuelCanonicalPlayingStateV2): readonly Candidate[] {
  const values = enumerateDuelPhaseSourceClosureCandidatesV2(match);
  if (!values.length || new Set(values.map(value => value.uid)).size !== values.length) throw new TypeError("invalid Gear source census");
  return values;
}
function exactEquip(program: DuelOfficialProgram): boolean {
  const value = program.semantics as unknown as Record<string, unknown>;
  if (value.kind !== "equip-activated-ability") return false;
  const cost = value.cost as Record<string, unknown> | undefined;
  const target = value.target as Record<string, unknown> | undefined;
  const attach = value.attach as Record<string, unknown> | undefined;
  const runtime = value.runtime as Record<string, unknown> | undefined;
  return !!cost && !!target && !!attach && !!runtime &&
    exactKeys(value, ["kind", "event", "sourceScope", "abilityClass", "cost", "costAlternatives", "costAlterations", "target", "attach", "timing", "runtime"]) &&
    exactKeys(cost, ["kind", "literal", "energy", "power", "nonResourceLiteral"]) &&
    exactKeys(target, ["kind", "controller", "scope", "selection"]) &&
    exactKeys(attach, ["kind", "destination", "resolution"]) &&
    exactKeys(runtime, ["status", "required"]) &&
    cost.kind === "base-cost" && typeof cost.literal === "string" && cost.literal.length > 0 &&
    typeof cost.energy === "number" && Number.isSafeInteger(cost.energy) && cost.energy >= 0 &&
    (cost.power === null || same(cost.power, { kind: "wildcard" }) ||
      exactKeys(cost.power, ["kind", "domain"]) && cost.power.kind === "specific-domain" &&
      ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"].includes(cost.power.domain as string)) && cost.nonResourceLiteral === null &&
    Array.isArray(value.costAlternatives) && value.costAlternatives.length === 0 &&
    Array.isArray(value.costAlterations) && value.costAlterations.length === 0 &&
    target.kind === "unit" && target.controller === "source-controller" && target.scope === "controlled-unit" && target.selection === "target" &&
    attach.kind === "attach-source-gear" && attach.destination === "target-unit" && attach.resolution === "deferred-attachment" &&
    value.event === "activate" && value.sourceScope === "source-gear-on-board" && value.abilityClass === "activated-ability" &&
    value.timing === "main-open-outside-showdown" && runtime.status === "pending" &&
    same(runtime.required, ["canonical-source-controller", "equip-activation-executor"]);
}
function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => typeof key === "string" && keys.includes(key)) &&
    keys.every(key => "value" in Object.getOwnPropertyDescriptor(value, key)!);
}
/** Whole-IR source check for CardPlay/entry. Equip's activation is a distinct
 * event and therefore contributes no CardPlay cost or Gear entry effect. */
function noGearCardPlayEffect(program: DuelOfficialProgram, source?: Candidate): boolean {
  assertDuelOfficialProgram(program);
  if (exactEquip(program)) return true;
  const scope = program.semantics as unknown as Record<string, unknown>;
  if (scope.kind === "no-ability") {
    const playability = scope.playability;
    return exactKeys(scope, ["kind", "playability"]) && exactKeys(playability, ["kind", "fromHand", "energyCost", "tokenOnly"]) &&
      (playability.kind === "printed-unit" || playability.kind === "recruit-token") && typeof playability.fromHand === "boolean" &&
      (playability.energyCost === null || (typeof playability.energyCost === "number" && Number.isSafeInteger(playability.energyCost) && playability.energyCost >= 0)) &&
      typeof playability.tokenOnly === "boolean";
  }
  if (scope.kind === "static") {
    if (!exactKeys(scope, ["kind", "abilities"]) || !Array.isArray(scope.abilities)) return false;
    return scope.abilities.every(ability => {
      const value = ability as Record<string, unknown>;
      return exactKeys(value, ["kind", ...(value.kind === "ganking" ? ["subject", "scope", "mode"] : value.kind === "enter-ready" ? ["subject", "scope", "mode"] : [])]) &&
        (same(value, { kind: "ganking", subject: "self", scope: "standard-move", mode: "permission" }) ||
          same(value, { kind: "enter-ready", subject: "self", scope: "unit-enter", mode: "replacement" }));
    });
  }
  if (scope.kind === "passive") {
    const modifier = scope.modifier as Record<string, unknown> | undefined;
    return !!modifier && ((["attacker", "defender"].includes(scope.event as string) && same(scope, { kind: "passive", event: scope.event, sourceScope: "source-unit-on-board", modifier })) ||
      (scope.event === "hide" && same(scope, { kind: "passive", event: "hide", sourceScope: "source-battlefield", modifier }))) &&
      ((["attacker", "defender"].includes(scope.event as string) && exactKeys(modifier, ["kind", "amount"]) &&
        modifier.kind === (scope.event === "attacker" ? "self-assault" : "self-shield") &&
        typeof modifier.amount === "number" && Number.isSafeInteger(modifier.amount)) ||
        (scope.event === "hide" && same(modifier, { kind: "additional-hide-permission", amount: 1, optional: true, scope: "source-battlefield" })));
  }
  // These two reviewed Battlefield hold programs are complete IR, but their
  // handlers can only run on a hold event.  A CardPlay/Chain cost census sees
  // the physical Battlefield on the board, so the trigger is provably inert at
  // this boundary.  Keep this gated by the actual board source; an unbound
  // trigger or any other event remains pending.
  if (scope.kind === "trigger" && scope.event === "hold" &&
      source?.kind === "battlefield" && source.zone.kind === "board-battlefield" &&
      exactKeys(scope, ["kind", "event", "sourceScope", "condition", "optional", "costs", "effects"]) &&
      scope.sourceScope === "battlefield-controller" && scope.condition === null &&
      scope.optional === false && Array.isArray(scope.costs) && scope.costs.length === 0 &&
      Array.isArray(scope.effects) && scope.effects.length === 1) {
    const effect = scope.effects[0] as Record<string, unknown>;
    const recruit = effect.kind === "play-recruit-token" && same(effect, {
      kind: "play-recruit-token",
      token: { kind: "unit-token", cardType: "Unit", domains: [], domainless: true,
        tags: ["Recruit"], energy: null, power: null, might: 1, physicalPrintingCardId: null },
      controller: "effect-controller", owner: "effect-controller", destination: "base",
      resolution: "deferred-token-play",
    });
    const draw = same(effect, { kind: "draw-cards", amount: 1, recipient: "effect-controller" });
    return program.cardId === "ogn-275-298" && recruit || program.cardId === "ogn-280-298" && draw;
  }
  if (scope.kind === "continuous") return same(scope, { kind: "continuous", sourceScope: "source-unit-on-board", modifier: { kind: "token-unit-might", amount: 1, controller: "ability-controller", scope: "board" } });
  if (scope.kind === "trigger" && source?.kind === "legend" && source.zone.kind === "legend-zone")
    return same(scope, { kind: "trigger", event: "conquer", sourceScope: "ability-source",
      condition: { kind: "assigned-excess-damage-at-least", amount: 3 }, optional: true,
      costs: [{ kind: "exhaust-source" }], effects: [{ kind: "ready-unit",
        target: { kind: "unit", controller: "any", scope: "legal-unit" } }] });
  if (scope.kind === "basic-rune") return exactKeys(scope, ["kind", "sourceRule", "domain", "abilities"]) && Array.isArray(scope.abilities) && scope.abilities.length === 2;
  if (scope.kind === "activated") return exactKeys(scope, ["kind", "event", "sourceScope", "costs", "effects"]) && scope.event === "activate" && Array.isArray(scope.costs) && Array.isArray(scope.effects);
  if (scope.kind === "compound-vi-self") return exactKeys(scope, ["kind", "sourceScope", "ganking", "activation"]);
  if (scope.kind === "deflect") return exactKeys(scope, ["kind", "sourceScope", "event", "modifier"]) && scope.event === "opponent-choice";
  if (scope.kind === "accelerate") return exactKeys(scope, ["kind", "choiceTiming", "optional", "additionalCost", "paidEffect"]) && scope.choiceTiming === "card-play-choices" && scope.optional === true;
  // Spell, trigger, beginning-phase and any future IR are never inferred inert.
  return false;
}
function programFingerprint(program: DuelOfficialProgram): string { return digest({ programId: program.programId, source: program.source, semantics: program.semantics }); }
function contextFor(match: DuelCanonicalPlayingStateV2, request: DuelPrintedGearEntryRequestV1): DuelPhaseSourceClosureContextV2 {
  return Object.freeze({ matchId: match.matchId, dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
    turn: match.frame.turnNumber, taskId: `duel-gear-v1:${match.matchId}:turn-${match.frame.turnNumber}:printed-gear:${request.uid}:${match.stateVersion}`,
    phase: "main", event: "chain", clock: { stateVersion: match.stateVersion, eventSeq: match.eventSeq } });
}
function sourceMatch(match: DuelCanonicalPlayingStateV2, request: DuelPrintedGearEntryRequestV1): boolean {
  return match.matchId === request.matchId && match.stateVersion === request.stateVersion && match.eventSeq === request.eventSeq &&
    match.frame.phase === "main" && !match.frame.stateOpen && match.frame.pendingPayment === null;
}

export function createDuelGearChainProductionServicesV1(options: DuelGearChainProductionServicesOptionsV1): DuelGearChainProductionServicesV1 {
  const { catalog, programs, matchId, currentHead, currentSession, currentJournal } = options;
  if (!text(matchId) || typeof currentHead !== "function" || typeof currentSession !== "function" || typeof currentJournal !== "function" ||
      catalog?.publicCatalog?.dataVersion !== programs?.catalogStamp?.dataVersion || catalog.publicCatalog.digest !== programs.catalogStamp.digest)
    throw new TypeError("loaded catalog, program authority and native journal required");
  const first = currentHead();
  if (!first || first.matchId !== matchId || first.dataVersion !== catalog.publicCatalog.dataVersion || first.catalogDigest !== catalog.publicCatalog.digest) throw new TypeError("admitted current head required");
  assertAdmittedDuelMatchV2(first);
  const registry = getCardProgramRegistryForRuntime(programs);
  const byCard = new Map(catalog.publicCatalog.cards.map(card => [card.id, card]));
  const head = (): DuelCanonicalPlayingStateV2 | null => {
    try {
      const value = currentHead();
      if (!value || value.stage !== "playing" || value.matchId !== matchId || value.dataVersion !== catalog.publicCatalog.dataVersion || value.catalogDigest !== catalog.publicCatalog.digest) return null;
      assertAdmittedDuelMatchV2(value); return value;
    } catch { return null; }
  };
  const inspectSnapshot = (match: DuelCanonicalPlayingStateV2, context: DuelPhaseSourceClosureContextV2): Snapshot => {
    const journal = currentJournal();
    const binding = inspectDuelNativeOperationJournalBindingV2(journal);
    if (!binding || binding.head !== match || binding.observed !== match || binding.census.unresolvedNativeHistory)
      throw new TypeError("native Gear journal unavailable");
    const value = journal.read(context);
    if (!value) throw new TypeError("exact source journal unavailable");
    if (value.scope !== "exact" || value.status !== "resolved" || value.input.matchId !== match.matchId ||
        value.input.dataVersion !== match.dataVersion || value.input.catalogDigest !== match.catalogDigest ||
        value.input.clock.stateVersion !== match.stateVersion || value.input.clock.eventSeq !== match.eventSeq ||
        value.input.taskId !== context.taskId || !Array.isArray(value.candidateKeys) || !Array.isArray(value.coverage) ||
        currentHead() !== match) throw new TypeError("exact source journal unavailable");
    const actual = [...currentCandidates(match).map(key), ...value.input.preExitSources.map(item => key(item.source)),
      ...[value.input.activeEffects, value.input.chain, value.input.effectQueue, value.input.feprOutstanding].flatMap(ledger => ledger.entries.map(entry => JSON.stringify(["runtime-effect", `effect:${entry.effectId}`, entry.sourceZoneEpoch, entry.zone.kind, "locationId" in entry.zone ? entry.zone.locationId : entry.zone.zonePlayerId])))];
    if (actual.length !== value.candidateKeys.length || new Set(actual).size !== actual.length || !same([...actual].sort(), [...value.candidateKeys].sort()) ||
        value.coverage.some(item => item.journalRevision !== value.journalRevision || !text(item.proofId))) throw new TypeError("source journal census drift");
    return value;
  };
  const closureFor = (request: Readonly<DuelPrintedGearEntryRequestV1>, context: Readonly<DuelPhaseSourceClosureContextV2>) => {
    try {
      const match = head();
      if (!match || request.match !== match || !sourceMatch(match, request) ||
          !same(context, contextFor(match, request))) return { status: "pending" as const, reason: "stale-head-or-event" };
      const snapshot = inspectSnapshot(match, context);
      for (const source of currentCandidates(match)) {
        const official = source.cardId && registry.getProgram(source.cardId);
        if (!official || !noGearCardPlayEffect(official, source))
          return { status: "pending" as const, reason: `unreviewed-Gear-source:${source.cardId}:${source.zone.kind}` };
      }
      const bridge = createDuelPhaseSourceServerBridgeV2(programs, match, {
        resolveCore(locator): DuelPhaseClosureCoreRequestV2 | null {
          if (locator.matchId !== match.matchId || locator.taskId !== context.taskId || currentHead() !== match) return null;
          const candidate = [...currentCandidates(match), ...snapshot.input.preExitSources.map(item => item.source)].find(item => item.uid === locator.uid);
          if (!candidate || candidate.cardId === null) return null;
          const official = registry.getProgram(candidate.cardId);
          const reference = programs.resolvedProgramReference(candidate.cardId);
          if (!official || !reference || !noGearCardPlayEffect(official, candidate)) return null;
          return { context, source: candidate, expectedProgramReference: reference.encodedReference, referenceKind: "printing" };
        },
        resolveJournal(request, requirements: readonly DuelPhaseClosureRequirementV2[]): DuelPhaseClosureJournalResolutionV2 | null {
          if (request.context.taskId !== context.taskId || currentHead() !== match) return null;
          const fresh = inspectSnapshot(match, request.context);
          if (fresh.journalRevision !== snapshot.journalRevision || fresh.candidateSetRevision !== snapshot.candidateSetRevision ||
              !same(fresh.candidateKeys, snapshot.candidateKeys) || requirements.some(requirement => !fresh.coverage.some(item => item.requirement === requirement))) return null;
          return { request, proofId: `${fresh.proofId}:${request.source.uid}`, journalRevision: fresh.journalRevision,
            candidateSetRevision: fresh.candidateSetRevision, coverage: fresh.coverage.filter(item => requirements.includes(item.requirement)) };
        },
      });
      const journal = createDuelPhaseSourceClosureJournalV2(snapshot.input);
      const inspection = bridge.inspect(context, journal);
      if (inspection.status !== "ready") {
        for (const source of currentCandidates(match)) {
          const issued = bridge.issueClosureRequest({ matchId: match.matchId, taskId: context.taskId, uid: source.uid });
          const evidence = issued && bridge.assembleClosureEvidence(issued);
          if (!evidence || evidence.status !== "complete")
            return { status: "pending" as const, reason: `${source.cardId}:${evidence?.status === "unknown" ? evidence.reason : "unbound"}` };
        }
      }
      return inspection.status === "ready" ? { status: "ready" as const, registry: bridge.closureRegistry, journal } : { status: "pending" as const, reason: inspection.reason };
    } catch (error) { return { status: "pending" as const, reason: error instanceof Error ? error.message : "closure-failure" }; }
  };
  const program = (request: Readonly<DuelPrintedGearProgramRequestV1>): DuelPrintedGearProgramBindingV1 => {
    const match = head();
    const candidate = match && request.match === match ? currentCandidates(match).find(item => item.uid === request.uid) : undefined;
    const physical = match?.physicalCardsByUID[request.uid];
    const hand = match?.players.find(player => player.playerId === request.actor)?.hand.filter(card => card.uid === request.uid);
    const ownedHand = candidate?.zone.kind === "hand" && candidate.zone.zonePlayerId === request.actor &&
      candidate.controllerPlayerId === null && hand?.length === 1 && hand[0]?.cardId === request.cardId &&
      match?.players.flatMap(player => player.hand).filter(card => card.uid === request.uid).length === 1 &&
      physical?.ownerPlayerId === request.actor && physical.cardId === request.cardId && physical.zoneEpoch === request.sourceEpoch;
    const controlledChain = candidate?.zone.kind === "chain" && candidate.controllerPlayerId === request.actor;
    if (!match || request.match !== match || request.matchId !== matchId || !Number.isSafeInteger(request.sourceEpoch) ||
        request.dataVersion !== match.dataVersion || request.catalogDigest !== match.catalogDigest ||
        !candidate || candidate.cardId !== request.cardId || candidate.zoneEpoch !== request.sourceEpoch ||
        candidate.ownerPlayerId !== request.actor || (!ownedHand && !controlledChain))
      return { status: "unknown", kind: "other", cardId: request.cardId, programId: "unknown", programFingerprint: "unknown" };
    const card = byCard.get(request.cardId), actual = registry.getProgram(request.cardId);
    if (!card || card.cardType !== "Gear" || !actual || !exactEquip(actual) || actual.source.dataVersion !== match.dataVersion || actual.source.sourceCatalogDigest !== match.catalogDigest)
      return { status: "unknown", kind: card?.cardType === "Gear" ? "Gear" : "other", cardId: request.cardId, programId: actual?.programId ?? "unknown", programFingerprint: actual ? programFingerprint(actual) : "unknown" };
    return { status: "known", kind: "Gear", cardId: request.cardId, programId: actual.programId, programFingerprint: programFingerprint(actual) };
  };
  const entry = (request: Readonly<DuelPrintedGearEntryRequestV1>): DuelPrintedGearEntryFactsV1 => {
    const unknown = (): DuelPrintedGearEntryFactsV1 => ({ ...request, sourceCensus: "unknown", scopes: { play: "unknown", replacement: "unknown", static: "unknown", trigger: "unknown", pendingTasks: "unknown", chain: "unknown" }, resolution: "unknown", sources: [] });
    try {
      const match = head();
      if (!match || request.match !== match || !sourceMatch(match, request)) return unknown();
      const actual = registry.getProgram(request.cardId);
      if (!actual || !exactEquip(actual) || request.programId !== programFingerprint(actual) ||
          !match.board.bases.some(base => base.ownerPlayerId === request.actor && base.locationId === request.baseLocationId))
        return unknown();
      const candidate = currentCandidates(match).find(item => item.uid === request.uid);
      if (!candidate || candidate.zone.kind !== "chain" || candidate.zoneEpoch !== request.sourceEpoch || candidate.cardId !== request.cardId || candidate.controllerPlayerId !== request.actor || candidate.ownerPlayerId !== request.actor) return unknown();
      const inspected = closureFor(request, contextFor(match, request));
      if (inspected.status !== "ready") return unknown();
      const result = inspectDuelPhaseSourceClosureV2(match, contextFor(match, request), inspected.registry!, inspected.journal!);
      if (result.status !== "ready" || result.activeSources.length || result.handlers.length || result.runtimeSources.length || currentHead() !== match) return unknown();
      const sources = result.candidates.map(item => {
        if (item.cardId === null || item.zoneEpoch === null) throw new Error("null source");
        const sourceProgram = registry.getProgram(item.cardId);
        const reference = programs.resolvedProgramReference(item.cardId);
        if (!sourceProgram || !reference || !noGearCardPlayEffect(sourceProgram, item)) throw new Error("unknown source program");
        return { uid: item.uid, zoneEpoch: item.zoneEpoch, programId: item.uid === request.uid ? request.programId : reference.programId, disposition: "known-no-effect" as const };
      });
      if (!sources.some(item => item.uid === request.uid && item.zoneEpoch === request.sourceEpoch && item.programId === request.programId)) return unknown();
      return { ...request, sourceCensus: "complete", scopes: { play: "clear", replacement: "clear", static: "clear", trigger: "clear", pendingTasks: "clear", chain: "clear" }, resolution: "complete", sources };
    } catch { return unknown(); }
  };
  const pins = new Map<string, GearCostPin>();
  const costForChain = (request: Readonly<DuelPrintedGearChainCostFactoryRequestV1>): DuelCostResolverAuthorityV2 => {
    const match = head();
    if (!match || request.match !== match || request.matchId !== match.matchId || request.commandSession.match !== match || match.frame.stateOpen || request.actor !== match.frame.turnPlayerId || request.chainVersion !== match.stateVersion || !text(request.commandId) || !text(request.transactionId)) throw new TypeError("Gear cost head mismatch");
    if (currentSession() !== request.commandSession) throw new TypeError("Gear command session changed");
    inspectDuelNativeCommandSessionPathV2(request.commandSession, request.commandSession);
    const target = currentCandidates(match).find(item => item.uid === request.cardUID);
    const card = sourceCard(catalog, request.cardId);
    const printed = card && bindDuelPrintedCost(card);
    const actualProgram = registry.getProgram(request.cardId);
    if (!actualProgram || !exactEquip(actualProgram) || request.program.status !== "known" || request.program.kind !== "Gear" ||
        request.program.cardId !== request.cardId || request.program.programId !== actualProgram.programId ||
        request.program.programFingerprint !== programFingerprint(actualProgram)) throw new TypeError("Gear program binding drift");
    let transaction: unknown;
    try { transaction = JSON.parse(request.transactionId) as unknown; } catch { throw new TypeError("Gear transaction identity invalid"); }
    if (!Array.isArray(transaction) || transaction.length !== 6 || transaction[0] !== "printed-gear-chain-v1" ||
        transaction[1] !== match.matchId || transaction[2] !== request.actor || transaction[3] !== request.commandId ||
        transaction[4] !== request.cardUID || transaction[5] !== request.sourceEpoch) throw new TypeError("Gear transaction identity drift");
    const journal = currentJournal();
    const journalBinding = inspectDuelNativeOperationJournalBindingV2(journal);
    const census = journal.readCostCensus();
    if (!target || target.zone.kind !== "chain" || target.zoneEpoch !== request.sourceEpoch || target.cardId !== request.cardId || target.ownerPlayerId !== request.actor || target.controllerPlayerId !== request.actor || !card || card.cardType !== "Gear" || !printed || printed.kind !== "numeric" || !journalBinding || journalBinding.journal !== journal || journalBinding.head !== match || journalBinding.observed !== match || !census || census.matchId !== match.matchId || census.stateVersion !== match.stateVersion || census.eventSeq !== match.eventSeq || census.unresolvedNativeHistory) throw new TypeError("Gear cost census unavailable");
    const actual = currentCandidates(match);
    if (census.sources.length !== actual.length || census.sources.some(source => { const value = actual.find(item => item.uid === source.uid); return source.carrier !== "object" || source.status !== "live" || !value || source.cardId !== value.cardId || source.sourceEpoch !== value.zoneEpoch || !same(source.zone, value.zone) || source.programReference !== programs.resolvedProgramReference(value.cardId!)?.encodedReference; })) throw new TypeError("Gear native census drift");
    const candidates = actual.map(source => { const reference = source.cardId && programs.resolvedProgramReference(source.cardId); const p = source.cardId && registry.getProgram(source.cardId); if (!source.cardId || source.zoneEpoch === null || !reference || !p || !noGearCardPlayEffect(p, source)) throw new TypeError("unknown Gear cost source"); return { sourceUid: source.uid, sourceEpoch: source.zoneEpoch, choice: "not-applicable" as const, modifierIds: [] as readonly string[] }; });
    const verified: DuelCostVerifiedSourcesV2 = { registryRevision: `${match.catalogDigest}:${census.journalRevision}:${census.candidateSetRevision}`, catalogRevision: `${match.dataVersion}:${match.catalogDigest}`, nonResourceCosts: "none", base: { cost: printed.cost, sourceUid: request.cardUID, sourceEpoch: request.sourceEpoch }, candidates, orderedModifiers: [] };
    const coverage = fingerprintDuelCostCoverageV2(verified);
    const tx = request.transactionId;
    const makeDecision = () => {
      if (currentHead() !== match || currentJournal() !== journal || JSON.stringify(currentJournal().readCostCensus()) !== JSON.stringify(census)) throw new TypeError("Gear cost snapshot changed");
      return { request: { transactionId: tx, subjectId: request.cardId, kind: "card-play" as const }, base: { request: { transactionId: tx, subjectId: request.cardId, kind: "card-play" as const }, cost: printed.cost, proofId: `gear-v1:base:${tx}:${census.journalRevision}`, status: "complete" as const, sourceUid: request.cardUID, sourceEpoch: request.sourceEpoch, registryRevision: verified.registryRevision, catalogRevision: verified.catalogRevision }, coverage: { request: { transactionId: tx, subjectId: request.cardId, kind: "card-play" as const }, proofId: `gear-v1:coverage:${tx}:${census.journalRevision}`, status: "complete" as const, allModifierSourcesCovered: true, choicesResolved: true, nonResourceCosts: "none" as const, registryRevision: verified.registryRevision, catalogRevision: verified.catalogRevision, ...coverage }, proofs: [], modifiers: [] };
    };
    const fixed = resolveDuelTotalCostV2(createDuelCostResolverAuthorityV2(makeDecision, () => verified),
      { transactionId: tx, subjectId: request.cardId, kind: "card-play" });
    const authority = createDuelCostResolverAuthorityV2(makeDecision, () => verified);
    const paymentId = `printed-gear-chain-v1-payment:${request.actor}:${request.commandId}`;
    const base = match.board.bases.find(item => item.ownerPlayerId === request.actor);
    if (!base || !match.resources.bases.some(item => item.playerId === request.actor && item.locationId === base.locationId)) throw new TypeError("Gear base unavailable");
    if (pins.has(paymentId)) throw new TypeError("Gear payment transaction already pinned");
    pins.set(paymentId, { actor: request.actor, uid: request.cardUID, cardId: request.cardId,
      sourceEpoch: request.sourceEpoch, authority, fixed, cost: fixed.finalResolvedCost, issuedAt: match,
      commandSession: request.commandSession, journal, census, baseProofId: fixed.baseProofId,
      coverageProofId: fixed.coverageProofId, transactionId: request.transactionId, commandId: request.commandId,
      programFingerprint: request.program.programFingerprint, baseLocationId: base.locationId });
    return authority;
  };
  const costBinding = (request: Readonly<DuelPrintedGearCostBindingV1>) => {
    try {
      const match = head();
      const tuple = JSON.parse(request.transactionId) as unknown;
      if (!match || !Array.isArray(tuple) || tuple.length !== 6 || !text(tuple[3]) || request.decision !== "none") throw new TypeError("Gear payment identity unavailable");
      const paymentId = `printed-gear-chain-v1-payment:${request.actor}:${tuple[3]}`;
      const pin = pins.get(paymentId);
      if (!pin || pin.issuedAt !== match || pin.transactionId !== request.transactionId || pin.commandId !== tuple[3] ||
          pin.baseLocationId !== request.baseLocationId || pin.programFingerprint !== request.programFingerprint ||
          currentSession() !== pin.commandSession || pin.commandSession.match !== match || currentJournal() !== pin.journal)
        throw new TypeError("Gear payment pin unavailable");
      inspectDuelNativeCommandSessionPathV2(pin.commandSession, pin.commandSession);
      const journalBinding = inspectDuelNativeOperationJournalBindingV2(pin.journal);
      const census = pin.journal.readCostCensus();
      if (!journalBinding || journalBinding.journal !== pin.journal || journalBinding.head !== match ||
          journalBinding.observed !== match || !census || !same(census, pin.census) ||
          census.matchId !== match.matchId || census.stateVersion !== match.stateVersion ||
          census.eventSeq !== match.eventSeq || census.unresolvedNativeHistory || census.phaseClosed !== false)
        throw new TypeError("Gear payment census drift");
      const fixed = pin.fixed;
      const card = sourceCard(catalog, request.cardId); const printed = card && bindDuelPrintedCost(card);
      const target = currentCandidates(match).find(item => item.uid === request.uid);
      const actualProgram = registry.getProgram(request.cardId);
      const ok = !!pin.authority && !!target && target.zone.kind === "chain" && target.zoneEpoch === request.sourceEpoch && target.cardId === request.cardId && target.ownerPlayerId === request.actor && target.controllerPlayerId === request.actor && card?.cardType === "Gear" && printed?.kind === "numeric" && !!actualProgram && exactEquip(actualProgram) && request.programFingerprint === programFingerprint(actualProgram) && tuple[0] === "printed-gear-chain-v1" && tuple[1] === match.matchId && tuple[2] === request.actor && tuple[4] === request.uid && tuple[5] === request.sourceEpoch && request.matchId === match.matchId && request.stateVersion === match.stateVersion && match.board.bases.some(base => base.ownerPlayerId === request.actor && base.locationId === request.baseLocationId) && request.baseProofId === pin.baseProofId && request.coverageProofId === pin.coverageProofId && fixed.baseProofId === pin.baseProofId && fixed.coverageProofId === pin.coverageProofId && same(fixed.finalResolvedCost, pin.cost) && same(fixed.baseCost, printed.cost);
      return { ...request, status: ok ? "complete" as const : "unknown" as const };
    } catch { return { ...request, status: "unknown" as const }; }
  };
  const sourceAttestor = (request: Readonly<DuelSourceAttestationRequestV2>) => {
    const match = head();
    if (!match || match.frame.stateOpen || request.match !== match || request.sourceReference.kind !== "card") throw new TypeError("Gear source head mismatch");
    const source = currentCandidates(match).find(item => item.uid === request.sourceReference.sourceUID);
    if (!source || source.zone.kind !== "chain" || source.cardId !== request.sourceReference.referenceId || source.controllerPlayerId !== request.actor || source.zoneEpoch === null) throw new TypeError("Gear source disappeared");
    const pin = pins.get(request.paymentId);
    if (!pin) throw new TypeError("unknown Gear payment pin");
    if (request.actor !== pin.actor || source.uid !== pin.uid || source.cardId !== pin.cardId ||
        source.zoneEpoch !== pin.sourceEpoch || source.ownerPlayerId !== pin.actor ||
        source.controllerPlayerId !== pin.actor ||
        request.taskId !== `printed-gear-chain-v1-task:${pin.actor}:${pin.commandId}` ||
        request.continuationId !== `printed-gear-chain-v1-continuation:${pin.actor}:${pin.commandId}`)
      throw new TypeError("Gear payment source binding drift");
    const liveSession = currentSession();
    if (!liveSession || liveSession.match !== match) throw new TypeError("Gear command session unavailable");
    inspectDuelNativeCommandSessionPathV2(pin.commandSession, liveSession);
    inspectDuelNativeCommitPathV2(pin.issuedAt, match);
    const originalSource = currentCandidates(pin.issuedAt).find(item => item.uid === source.uid);
    if (!originalSource || originalSource.zoneEpoch !== source.zoneEpoch ||
        request.previous && request.previous.sourceZoneEpoch !== source.zoneEpoch)
      throw new TypeError("Gear source epoch changed");
    const journal = currentJournal();
    const journalBinding = inspectDuelNativeOperationJournalBindingV2(journal);
    const census = journal.readCostCensus();
    if (journal !== pin.journal || !journalBinding || journalBinding.journal !== journal || journalBinding.head !== match || journalBinding.observed !== match || !census ||
        census.matchId !== match.matchId || census.stateVersion !== match.stateVersion || census.eventSeq !== match.eventSeq ||
        census.unresolvedNativeHistory || census.phaseClosed !== false)
      throw new TypeError("Gear source journal drift");
    if (!same(request.finalResolvedCost, pin.cost) || !same(request.sourceReference, {
      kind: "card", referenceId: source.cardId, sourceUID: source.uid,
    })) throw new TypeError("Gear task cost/source drift");
    const binding = pin.binding ?? Object.freeze({ matchId: match.matchId, actor: request.actor, paymentId: request.paymentId, sourceReference: request.sourceReference, sourceProofId: digest({ matchId, actor: request.actor, uid: source.uid, epoch: source.zoneEpoch, paymentId: request.paymentId, taskId: request.taskId, continuationId: request.continuationId, transactionId: pin.transactionId, commandId: pin.commandId, programFingerprint: pin.programFingerprint, cost: request.finalResolvedCost }), mode: "current" as const, sourceZoneEpoch: source.zoneEpoch, taskId: request.taskId, continuationId: request.continuationId });
    if (!pin.binding) {
      if (request.previous) throw new TypeError("unexpected prior Gear binding");
      pin.binding = binding;
    } else {
      if (!pin.binding || !request.previous || !same(request.previous, pin.binding)) throw new TypeError("Gear binding drift");
    }
    return binding;
  };
  const services: DuelGearChainProductionServicesV1 = { programs: registry, program, costForChain, costBinding, entry, closure(request, context) { const value = closureFor(request, context); if (value.status !== "ready") throw new TypeError(value.reason ?? "Gear closure pending"); return { registry: value.registry!, journal: value.journal! }; }, sourceAttestor, isGearPrinting(cardId) { return sourceCard(catalog, cardId)?.cardType === "Gear"; }, inspectClosure: closureFor };
  return Object.freeze(services);
}

export const createDuelPrintedGearChainServicesV1 = createDuelGearChainProductionServicesV1;
